'use strict';

const { app, dialog, BrowserWindow, ipcMain } = require('electron');
const { machineIdSync } = require('node-machine-id');
const Store = require('electron-store');
const log = require('electron-log');
const dayjs = require('dayjs');
const axios = require('axios');
const path = require('path');
const _ = require('lodash');
const os = require('os');

if (process.env.NODE_ENV === 'development') {
    log.transports.file.level = false;
} else {
    log.transports.file.level = false;
    log.transports.console.level = false;
}

module.exports = class Unlock {
    constructor(config, autoUpdater) {
        this.mainWindow = null;
        this.licenseWindow = null;
        this.autoUpdater = autoUpdater;
        this.config = this.buildConfig(config);
        this.store = new Store({
            name: 'unlock',
            clearInvalidConfig: true,
            encryptionKey: this.config.license.encryptionKey
        });

        this.registerHandlers();
    }

    buildConfig(config) {
        return _.merge({
            api: {
                url: "https://api.anystack.sh/v1",
            },
            license: {
                requireEmail: false,
                checkIn: {
                    value: 24,
                    unit: "hours"
                },
                encryptionKey: config.api.productId,
                trial: {
                    enabled: false,
                    value: 7,
                    unit: "days",
                },
            },
            updater: {
                url: "https://dist.anystack.sh/v1/electron",
            },
            prompt: {
                title: "Anystack",
                subtitle: "Activate your license to get started",
                logo: "https://anystack.sh/img/emblem.svg",
                email: "Email address",
                licenseKey: "License key",
                activateLicense: "Activate license",
                trial: "Try for 7 days",
                trialExpired: "Thank you for trying Anystack. Your trial has expired; to continue, please purchase a license.",
                errors: {
                    "NOT_FOUND": "Your license information did not match our records.",
                    "SUSPENDED": "Your license has been suspended.",
                    "EXPIRED": "Your license has been expired.",
                    "FINGERPRINT_INVALID": "No license was found for this device.",
                    "FINGERPRINT_ALREADY_EXISTS": "An active license already exists for this device.",
                    "MAX_USAGE_REACHED": "Your license has reached its activation limit.",
                    "RELEASE_CONSTRAINT": "Your license has no access to this version."
                }
            },
            confirmation: {
                title: "You are awesome!",
                subtitle: "Thank you for activating your product license.",
            }
        }, config);
    }

    registerHandlers() {
        if (this.autoUpdater) {
            this.registerAutoUpdater();
        }

        this.registerFingerprint();
        this.registerRendererHandlers();

        setInterval(() => {
            if (this.checkinRequired()) {
                log.debug('A license check-in is required.');
                this.verifyDeviceLicense();
            }
        }, 10000);
    }

    ifAuthorized(mainWindow) {
        this.mainWindow = mainWindow;

        if (this.licenseExistsOnDevice()) {
            log.debug('A license exists on this device.');

            if (this.checkinRequired()) {
                log.debug('A license check-in is required.');
                this.verifyDeviceLicense();
            }

            log.debug('Opening main application.');
            return this.mainWindow.show();
        }

        log.debug('No license found on this device.');
        this.promptLicenseWindow();
    }

    promptLicenseWindow() {
        log.debug('Prompting license window.');

        this.licenseWindow = new BrowserWindow({
            width: 400,
            height: 480,
            resizable: false,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false,
                devTools: process.env.NODE_ENV === 'development',
            }
        });

        if (process.env.NODE_ENV === 'development') {
            let prepend = '';

            if (path.resolve(__dirname).includes('dist_electron') == true) {
                prepend += '../'
            }

            if (path.resolve(__dirname).includes('@anystack') == true) {
                prepend += '../'
            }

            if (path.resolve(__dirname).includes('node_modules') == false) {
                prepend += 'node_modules/@anystack/electron-license/';
            }

            if (process.platform === 'darwin') {
                prepend += '/';
            }

            this.licenseWindow.loadFile(path.resolve(__dirname, prepend + 'license/license.html'), { query: { "data": JSON.stringify(this.config) } });
        } else {
            this.licenseWindow.loadFile(process.resourcesPath + '/license/license.html', { query: { "data": JSON.stringify(this.config) } });
        }

        // Open the DevTools.
        // licenseWindow.webContents.openDevTools();
    }

    checkinRequired() {
        const lastCheckIn = this.store.get('license.lastCheckIn', false);

        if (lastCheckIn === false) {
            return false;
        }

        return dayjs().subtract(this.config.license.checkIn.value, this.config.license.checkIn.unit).isAfter(dayjs.unix(lastCheckIn));
    }

    verifyDeviceLicense() {
        this.validateLicense({
            key: this.store.get('license.key', false),
            scope: {
                fingerprint: this.fingerprint,
                release: {
                    tag: app.getVersion(),
                }
            }
        }).then((response) => {
            const valid = response.data.meta.valid;
            const status = response.data.meta.status;

            if (valid === true) {
                log.debug('License check in complete and the device license is valid.');
                this.store.set('license.lastCheckIn', dayjs().unix());
            }

            if (valid === false && status !== 'RESTRICTED') {
                log.debug('License invalid: ' + status);
                this.invalidateDeviceLicenseAndNotify(status);
            }
        }).catch((error) => {
            log.debug('An error occurred during the license check.');
            log.debug(error.response.data);
            this.showRequestErrorDialog(error);
        });
    }

    showRequestErrorDialog(error) {
        let errorMessage;

        if (error.response.status === 422) {
            errorMessage = _.flatten(_.toArray(error.response.data.errors)).join(", ");
        } else {
            errorMessage = JSON.stringify(error.response.data);
        }

        dialog.showMessageBox(null, {
            title: 'An unexpected error occurred',
            buttons: ['Continue'],
            type: 'warning',
            message: errorMessage,
        });
    }

    invalidateDeviceLicenseAndNotify(status) {
        this.store.delete('license');

        dialog.showMessageBox(null, {
            title: 'Your license is invalid',
            buttons: ['Continue'],
            type: 'warning',
            message: this.config.prompt.errors[status],
        });

        app.relaunch();
        app.exit();
    }

    licenseExistsOnDevice() {
        return this.store.has('license');
    }

    validateLicense(data) {
        return this.doRequest('validate-key', data);
    }

    activateLicense(data) {
        return this.doRequest('activate-key', _.merge(data, {
            platform: process.platform
        }));
    }

    registerRendererHandlers() {
        ipcMain.on('attempt-license-activation', (event, arg) => {
            log.debug('Attempting license activation.');
            let data = this.getLicenseValidationRequestData(arg.licenseKey, arg.email);
            this.validateLicense(data)
                .then((response) => {
                    log.debug('Validate license request was made successfully.');

                    if (response.data.meta.valid === true || response.data.meta.status === 'RESTRICTED') {
                        log.debug('Restoring existing device license.');

                        event.reply('license-activated');

                        this.store.set('license', {
                            key: arg.licenseKey,
                            email: arg.email,
                            fingerprint: this.fingerprint,
                            lastCheckIn: dayjs().unix()
                        });

                        setTimeout(() => {
                            this.licenseWindow.close();
                            this.mainWindow.show();
                        }, 3000);
                    } else if (response.data.meta.status === 'FINGERPRINT_INVALID') {
                        log.debug('Attempting to activate license for this device.');
                        this.activateLicense({
                            key: arg.licenseKey,
                            fingerprint: this.fingerprint,
                            name: os.hostname()
                        })
                            .then((response) => {
                                if (response.status === 201) {
                                    log.debug('License was activated successfully.');
                                    event.reply('license-activated');

                                    this.store.set('license', {
                                        key: arg.licenseKey,
                                        email: arg.email,
                                        fingerprint: this.fingerprint,
                                        lastCheckIn: dayjs().unix()
                                    });

                                    setTimeout(() => {
                                        this.licenseWindow.close();
                                        this.mainWindow.show();
                                    }, 3000);
                                }
                            })
                            .catch((error) => {
                                log.debug('License activation has failed.');
                                if (error.response.status === 422) {
                                    event.reply('license-activation-failed', {
                                        licenseError: this.config.prompt.errors[error.response.data.errors['license']],
                                        emailError: error.response.data.errors['scope.contact.email'],
                                    });
                                }
                            });
                    } else {
                        log.debug('License activation has failed.');
                        event.reply('license-activation-failed', {
                            licenseError: this.config.prompt.errors[response.data.meta.status],
                        });
                    }
                })
                .catch((error) => {
                    log.debug('Validate license request resulted in an error.');
                    log.debug(error.response.data);
                    this.showRequestErrorDialog(error);
                });
        })

        ipcMain.on('attempt-trial-run', (event, arg) => {
            if (this.store.has('trial.start') == false) {
                log.debug('Starting trial');

                this.store.set('trial', {
                    start: dayjs().unix()
                });
            }

            if (this.trialExpired()) {
                log.debug('Trial has expired.');

                event.reply('trial-expired');
                return;
            }

            setTimeout(() => {
                this.licenseWindow.close();
                this.mainWindow.show();
            }, 3000);
        })
    }

    getLicenseValidationRequestData(licenseKey, email = null) {
        let data = {
            key: licenseKey,
            scope: {
                fingerprint: this.fingerprint,
                release: {
                    tag: app.getVersion(),
                }
            },
        };

        if (this.config.license.requireEmail) {
            data = _.merge(data, {
                scope: {
                    contact: {
                        email: email,
                    }
                }
            })
        }

        return data;
    }

    trialExpired() {
        const trialStart = this.store.get('trial.start');

        return dayjs().subtract(this.config.license.trial.value, this.config.license.trial.unit).isAfter(dayjs.unix(trialStart));
    }

    registerFingerprint() {
        this.fingerprint = machineIdSync();
        log.debug('Device fingerprint registered: ' + this.fingerprint);
    }

    doRequest(endpoint, data) {
        return axios.post(
            `${this.config.api.url}/products/${this.config.api.productId}/licenses/${endpoint}`, data, {
            headers: {
                'Authorization': `Bearer ${this.config.api.key}`
            }
        });
    }

    registerAutoUpdater() {
        const licenseKey = this.store.get('license.key', '');
        const updaterType = (typeof this.autoUpdater.checkForUpdatesAndNotify === "function") ? 'electron-builder' : 'electron-native';

        if (!licenseKey && this.config.license.trial.enabled == false) {
            log.debug('Skipped registration of auto updater because no license key is provided.');
            return;
        }

        log.debug('Registering auto updater for ' + updaterType);

        if (updaterType === 'electron-builder') {
            this.autoUpdater.setFeedURL({
                url: this.config.updater.url + '/' + this.config.api.productId + '/releases?key=' + licenseKey,
                serverType: 'json',
                provider: "generic",
                useMultipleRangeRequest: false
            });

            setInterval(() => {
                this.autoUpdater.checkForUpdatesAndNotify();
            }, 1800000);
        }
        if (updaterType === 'electron-native') {
            this.autoUpdater.setFeedURL({
                url: this.config.updater.url + '/' + this.config.api.productId + '/update/' + process.platform + '/' + process.arch + '/' + app.getVersion() + '?key=' + licenseKey,
                serverType: 'json',
                provider: "generic",
                useMultipleRangeRequest: false
            });

            setInterval(() => {
                this.autoUpdater.checkForUpdates();
            }, 1800000);
        }

        log.debug('Checking for inital updates');
        this.autoUpdater.checkForUpdatesAndNotify();
    }
}
