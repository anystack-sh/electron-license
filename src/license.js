import Alpine from 'alpinejs';

const { ipcRenderer } = require('electron');
const axios = require('axios');
const _ = require('lodash');

window.Unlock = () => {    

    return {
        isReady: false,
        loading: false,
        email: 'john@snow.com',
        emailError: null,
        licenseKey: '8d562d27-43d4-4032-b988-4f697f17e487',
        licenseError: null,
        activated: false,

        init() {
            const params = new URLSearchParams(global.location.search);
            const data = JSON.parse(params.get('data'));

            this.prompt = _.merge(this.prompt, data.prompt ?? {});
            this.confirmation = _.merge(this.confirmation, data.confirmation ?? {});
            this.api = _.merge(this.api, data.api ?? {});
            this.license = _.merge(this.license, data.license ?? {});

            this.logo = data.logo;

            if(this.license.fingerprint === true) {
                ipcRenderer.send('get-device-fingerprint');
                ipcRenderer.on('set-device-fingerprint', (event, arg) => {
                    this.license.fingerprint = arg;
                });
            }

            ipcRenderer.on('license-activation-failed', (event, arg) => {
                this.loading = false;
                this.licenseError = arg.licenseError;
            });

            ipcRenderer.on('license-activated', (event, arg) => {
                setTimeout(() => {
                    this.activated = true;
                }, 500);
            });

            setTimeout(() => {
                this.isReady = true;
            }, 1000);
        },

        activateLicense() {
            this.loading = true;
            this.error = null;

            ipcRenderer.send('attempt-license-activation', { licenseKey: this.licenseKey, email: this.email });
        }
    }

}

Alpine.start();