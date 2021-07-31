'use strict';

const {app, dialog, BrowserWindow, ipcMain} = require('electron');
const {machineIdSync} = require('node-machine-id');
const Store = require('electron-store');
const dayjs = require('dayjs');
const axios = require('axios');
const path = require('path');
const _ = require('lodash');

module.exports = class Unlock {
    constructor(config, autoUpdater) {
        this.mainWindow = null;
        this.licenseWindow = null;
        this.autoUpdater = autoUpdater;
        this.config = this.buildConfig(config);
        this.store = new Store({name: 'unlock', clearInvalidConfig: true, encryptionKey: this.config.license.encryptionKey});

        this.registerHandlers();
    }

    buildConfig(config) {
        return _.merge({
            api: {
                url: 'https://api.unlock.sh/v1',
            },
            license: {
                requireEmail: false,
                checkin: {
                    value: 24,
                    unit: 'hours'
                },
                encryptionKey: config.api.productId,
            },
            updater: {
                url: 'https://dist.unlock.sh/v1/electron',
            },
            prompt: {
                title: 'Unlock',
                subtitle: 'Activate your license to get started',
                logo: 'https://unlock.sh/img/unlock-logo-grey.svg',
                email: 'Email address',
                licenseKey: 'License key',
                activateLicense: 'Activate license',
                errors: {
                    'NOT_FOUND': 'Your license information did not match our records.',
                    'SUSPENDED': 'Your license has been suspended.',
                    'EXPIRED': 'Your license has been expired.',
                    'FINGERPRINT_INVALID': 'No license found for this device.',
                    'FINGERPRINT_ALREADY_EXISTS': 'An active license already exist for this device.',
                    'MAX_USAGE_REACHED': 'Your license has reached it\'s activation limit.',
                    'RELEASE_CONSTRAINT': 'Your license has no access to this version.',
                }
            },
            confirmation: {
                title: 'You are awesome!',
                subtitle: 'Thank you for activating your product license.',
            }
        }, config);
    }

    registerHandlers() {
        if (this.autoUpdater) {
            this.registerAutoUpdater();
        }

        this.registerFingerprint();
        this.registerRendererHandlers();
    }

    ifAuthorized(mainWindow) {
        this.mainWindow = mainWindow;

        if (this.licenseExistsOnDevice()) {
            if (this.checkinRequired()) {
                this.verifyDeviceLicense();
            }

            return this.mainWindow.show();
        }

        this.promptLicenseWindow();
    }

    promptLicenseWindow() {
        this.licenseWindow = new BrowserWindow({
            width: 400,
            height: 450,
            resizable: false,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false,
                devTools: false,
            }
        });

        if (process.env.NODE_ENV === 'development') {
            let offset = (__dirname.includes('.webpack')) ? '../../' : '../';
            this.licenseWindow.loadFile(path.resolve(__dirname, offset + 'node_modules/@unlocksh/electron-license/dist/license.html'), {query: {"data": JSON.stringify(this.config)}});
        } else {
            this.licenseWindow.loadFile(process.resourcesPath + '/dist/license.html', {query: {"data": JSON.stringify(this.config)}});
        }

        // Open the DevTools.
        // licenseWindow.webContents.openDevTools();
    }

    checkinRequired() {
        const lastCheckIn = this.store.get('license.lastCheckIn');

        return dayjs().subtract(this.config.license.checkin.value, this.config.license.checkin.unit).isAfter(dayjs.unix(lastCheckIn));
    }

    verifyDeviceLicense() {
        this.validateLicense({
            key: this.store.get('license.key', false),
            fingerprint: this.fingerprint,
            tag: app.getVersion(),
        }).then((response) => {
            const valid = response.data.meta.valid;
            const status = response.data.meta.status;

            if (valid === true) {
                this.store.set('license.lastCheckIn', dayjs().unix());
            }

            if (valid === false && status !== 'RESTRICTED') {
                this.invalidateDeviceLicenseAndNotify(status);
            }
        }).catch((error) => {
            this.showRequestErrorDialog(error);
        }).then(() => {
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
            let data = this.getLicenseRequestData(arg.licenseKey, arg.email);
            this.validateLicense(data)
                .then((response) => {

                    if (response.data.meta.valid === true || response.data.meta.status === 'RESTRICTED') {
                        event.reply('license-activated');

                        this.store.set('license', {
                            key: arg.licenseKey,
                            email: arg.email,
                            fingerprint: arg.fingerprint,
                            lastCheckIn: dayjs().unix()
                        });

                        setTimeout(() => {
                            this.licenseWindow.close();
                            this.mainWindow.show();
                        }, 3000);
                    } else {
                        this.activateLicense(data)
                            .then((response) => {
                                if (response.status === 201) {
                                    event.reply('license-activated');

                                    this.store.set('license', {
                                        key: data.licenseKey,
                                        email: data.email,
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
                                if (error.response.status === 422) {
                                    event.reply('license-activation-failed', {
                                        licenseError: this.config.prompt.errors[error.response.data.errors['license']],
                                        emailError: error.response.data.errors['scope.licensee.email'],
                                    });
                                }
                            })
                            .then(() => {
                            });
                    }
                })
                .catch((error) => {
                    this.showRequestErrorDialog(error);
                })
                .then(() => {
                });
        })
    }

    getLicenseRequestData(licenseKey, email = null) {
        let data = {
            key: licenseKey,
            tag: app.getVersion(),
            fingerprint: this.fingerprint,
        };

        if (this.config.license.requireEmail) {
            data = _.merge(data, {
                scope: {
                    licensee: {
                        email: email,
                    }
                }
            })
        }

        return data;
    }

    registerFingerprint() {
        this.fingerprint = machineIdSync();

        ipcMain.on('get-device-fingerprint', (event, arg) => {
            event.reply('set-device-fingerprint', this.fingerprint)
        })
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
        const licenseKey = this.store.get('license.key');
        const updaterType = (typeof this.autoUpdater.checkForUpdatesAndNotify === "function") ? 'electron-builder' : 'electron-native';

        if (!licenseKey) {
            return;
        }

        if (updaterType === 'electron-builder') {
            this.autoUpdater.setFeedURL({
                url: this.config.updater.url + '/' + this.config.api.productId + '/releases?key=' + licenseKey,
                serverType: 'json',
                provider: "generic",
                useMultipleRangeRequest: false
            });

            setInterval(() => {
                this.autoUpdater.checkForUpdatesAndNotify();
            }, 300000);
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
            }, 300000);
        }
    }
}
