'use strict';

const {BrowserWindow, ipcMain} = require('electron');
const {machineIdSync} = require('node-machine-id');
const Store = require('electron-store');
const dayjs = require('dayjs');
const axios = require('axios');

module.exports = class Unlock {
    constructor(config) {
        this.config = config;
        this.store = new Store({ name: 'unlock', encryptionKey: this.config.api.productId });

        if (this.config.fingerprint) {
            this.handleFingerprint()
        }
    }

    hasActiveLicense() {
        if (this.store.has('license')) {

            this.hasValidLicense();
            if(this.checkinRequired()) {
            }

            return true;
        }

        this.promptLicenseWindow();
    }

    promptLicenseWindow() {
        // Create the browser window.
        const licenseWindow = new BrowserWindow({
            width: 400,
            height: 450,
            resizable: false,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            }
        });

        // and load the index.html of the app.
        licenseWindow.loadFile(`${__dirname}/../../node_modules/unlock-electron-license/src/app.html`, {query: {"data": JSON.stringify(this.config)}});

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

                if(valid === false) {
                    this.store.delete('license');
                }

                console.log('success', response);
            })
            .catch((error) => {
                console.log('fail', error);
            })
            .then(() => {
            });
    }

    handleFingerprint() {
        ipcMain.on('get-device-fingerprint', (event, arg) => {
            event.reply('set-device-fingerprint', machineIdSync())
        })
    }
}
