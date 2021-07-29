'use strict';

const {app, dialog, BrowserWindow, ipcMain} = require('electron');
const {machineIdSync} = require('node-machine-id');
const Store = require('electron-store');
const dayjs = require('dayjs');
const axios = require('axios');
const path = require('path');

module.exports = class Unlock {
    constructor(mainWindow, config, autoUpdater) {
        this.mainWindow = mainWindow;

        this.config = Object.assign({
            updater: {
                url: 'https://dist.unlock.sh/v1/electron'
            }
        }, config);
        this.store = new Store({name: 'unlock', encryptionKey: this.config.api.productId});
        this.autoUpdater = autoUpdater;

        if (this.config.license.fingerprint) {
            this.handleFingerprint()
        }

        if (this.autoUpdater) {
            this.registerAutoUpdater();
        }
    }

    app() {
        if (this.store.has('license')) {
            if (this.checkinRequired()) {
                this.hasValidLicense();
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

        // console.log(__dirname, __filename);
        // console.log(require('electron').app.getAppPath());
        // console.log(require("path").dirname(require('electron').app.getPath("exe")));

        // console.log(path.resolve(`${rootPath()}/node_modules/@unlocksh/unlock-electron-license/src/app.html`));
        // licenseWindow.loadFile(`${app.getAppPath()}/node_modules/@unlocksh/unlock-electron-license/src/app.html`, {query: {"data": JSON.stringify(this.config)}});
        // console.log(app.getAppPath());
        // console.log(path.relative(__dirname, app.getAppPath()));


        if (process.env.NODE_ENV === 'development') {
            let offset = (__dirname.includes('.webpack')) ? '../../' : '../';
            licenseWindow.loadFile(path.resolve(__dirname, offset + 'node_modules/@unlocksh/unlock-electron-license/dist/license.html'), {query: {"data": JSON.stringify(this.config)}});
        } else {
            let p = process.resourcesPath + '/dist/license.html';
            licenseWindow.loadFile(p, {query: {"data": JSON.stringify(this.config)}});
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

        return dayjs().subtract(24, 'hours').isAfter(dayjs.unix(lastCheckIn));
    }

    hasValidLicense() {
        const licenseKey = this.store.get('license.key');
        const fingerprint = this.store.get('license.fingerprint');
        const data = {
            key: licenseKey,
            fingerprint: fingerprint
        };

        axios.post(`${this.config.api.url}/products/${this.config.api.productId}/licenses/validate-key`, data,
            {
                headers: {
                    'Authorization': `Bearer ${this.config.api.key}`
                }
            })
            .then((response) => {
                const valid = response.data.meta.valid;
                const status = response.data.meta.status;

                if (valid === false) {
                    this.store.delete('license');

                    let messages = {
                        SUSPENDED: 'You license has been suspended.',
                        EXPIRED: 'You license has been expired.',
                        FINGERPRINT_INVALID: 'Your device identifier was not recognized.',
                        FINGERPRINT_MISSING: 'Your device identifier is missing.',
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
            })
            .catch((error) => {
            })
            .then(() => {
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
                console.log('checking for updates');
                this.autoUpdater.checkForUpdatesAndNotify();
            }, 30000);
        }
        if (updaterType === 'electron-native') {
            this.autoUpdater.setFeedURL({
                url: this.config.updater.url + '/' + this.config.api.productId + '/update/' + process.platform + '/' + process.arch + '/' + app.getVersion() + '?key=' + licenseKey,
                serverType: 'json',
                provider: "generic",
                useMultipleRangeRequest: false
            });

            setInterval(() => {
                console.log('checking for updates');
                this.autoUpdater.checkForUpdates();
            }, 30000);
        }
    }

    handleFingerprint() {
        ipcMain.on('get-device-fingerprint', (event, arg) => {
            event.reply('set-device-fingerprint', machineIdSync())
        })
    }
}
