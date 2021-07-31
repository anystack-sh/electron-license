import Alpine from 'alpinejs';
const { ipcRenderer } = require('electron');

window.Unlock = () => {    
    return {
        isReady: false,
        loading: false,
        email: null,
        emailError: null,
        licenseKey: null,
        licenseError: null,
        activated: false,

        init() {
            const params = new URLSearchParams(global.location.search);
            const data = JSON.parse(params.get('data'));

            this.prompt = data.prompt ?? {};
            this.confirmation = data.confirmation ?? {};
            this.api = data.api ?? {};
            this.license = data.license ?? {};
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
                this.emailError = arg.emailError;
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
            this.emailError = null;
            this.licenseError = null;

            ipcRenderer.send('attempt-license-activation', { licenseKey: this.licenseKey, email: this.email });
        }
    }
}

Alpine.start();