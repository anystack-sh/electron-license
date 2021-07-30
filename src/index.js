'use strict';

const {app, dialog, BrowserWindow, ipcMain} = require('electron');
const {machineIdSync} = require('node-machine-id');
const Store = require('electron-store');
const dayjs = require('dayjs');
const axios = require('axios');
const path = require('path');
const _ = require('lodash');

module.exports = class Unlock {
    constructor(mainWindow, config, autoUpdater) {
        this.mainWindow = mainWindow;
        this.config = this.buildConfig(config);
        this.store = new Store({name: 'unlock', encryptionKey: this.config.api.productId});
        this.autoUpdater = autoUpdater;

        this.licenseKey = this.store.get('license.key', false);
        this.fingerprint = null;

        this.registerHandlers();
    }

    buildConfig(config) {
        return _.merge({
            api: {
                url: 'https://api.unlock.sh/v1',
                productVersion: app.getVersion(),
            },
            updater: {
                url: 'https://dist.unlock.sh/v1/electron',
            }
        }, config);
    }

    registerHandlers() {
        if (this.config.license.fingerprint) {
            this.registerFingerprint()
        }

        if (this.autoUpdater) {
            this.registerAutoUpdater();
        }

        this.registerRendererHandlers();
    }

    app() {
        if (this.licenseExistsOnDevice()) {
            if (this.checkinRequired()) {
                this.verifyDeviceLicense();
            }

            return this.mainWindow.show();
        }

        this.promptLicenseWindow();
    }

    promptLicenseWindow() {
        const licenseWindow = new BrowserWindow({
            width: 400,
            height: 450,
            resizable: false,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false,
            }
        });

        if (process.env.NODE_ENV === 'development') {
            let offset = (__dirname.includes('.webpack')) ? '../../' : '../';
            licenseWindow.loadFile(path.resolve(__dirname, offset + 'node_modules/@unlocksh/unlock-electron-license/dist/license.html'), {query: {"data": JSON.stringify(this.config)}});
        } else {
            licenseWindow.loadFile(process.resourcesPath + '/dist/license.html', {query: {"data": JSON.stringify(this.config)}});
        }

        // Open the DevTools.
        // licenseWindow.webContents.openDevTools();

        ipcMain.on('license-activated', (event, arg) => {
            this.store.set('license', {
                key: arg.licenseKey,
                email: arg.email,
                fingerprint: arg.fingerprint,
                lastCheckIn: dayjs().unix()
            });

            licenseWindow.close();
            this.mainWindow.show();
        });
    }

    checkinRequired() {
        const lastCheckIn = this.store.get('license.lastCheckIn');

        console.log(dayjs().subtract(1, 'minutes').isAfter(dayjs.unix(lastCheckIn)));
        return dayjs().subtract(1, 'minutes').isAfter(dayjs.unix(lastCheckIn));
        // return dayjs().subtract(24, 'hours').isAfter(dayjs.unix(lastCheckIn));
    }

    verifyDeviceLicense() {
        this.validateLicense({
            key: this.licenseKey,
            fingerprint: this.fingerprint,
            tag: app.getVersion(),
        }).then((response) => {
            const valid = response.data.meta.valid;
            const status = response.data.meta.status;

            if (valid === false) {
                this.invalidateDeviceLicenseAndNotify(status);
            }
        })
        .catch((error) => {
            dialog.showMessageBox(null, {
                title: 'An unexpected error occurred',
                buttons: ['Continue'],
                type: 'warning',
                message: error.response.data,
            });
        })
        .then(() => {
        });
    }

    invalidateDeviceLicenseAndNotify(status) {
        this.store.delete('license');

        let messages = {
            SUSPENDED: 'You license has been suspended.',
            EXPIRED: 'You license has been expired.',
            FINGERPRINT_INVALID: 'Your device identifier was not recognized.',
            FINGERPRINT_MISSING: 'Your device identifier is missing.',
            RELEASE_CONSTRAINT: 'You license does not have access this application version.',
        }

        dialog.showMessageBox(null, {
            title: 'Your license is invalid',
            buttons: ['Continue'],
            type: 'warning',
            message: messages[status],
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

    registerRendererHandlers() {
        // ipcMain.on('attempt-license-activation', (event, arg) => {
        //     event.reply('set-device-fingerprint', this.fingerprint)
        // })
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
