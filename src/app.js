import Alpine from 'alpinejs';

const { ipcRenderer } = require('electron');
const axios = require('axios');

window.Unlock = () => {    

    return {
        isReady: false,

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
                'FINGERPRINT_MISSING': 'Device fingerprint is missing.',
                'FINGERPRINT_ALREADY_EXISTS': 'An active license already exist for this device.',
                'MAX_USAGE_REACHED': 'Your license has reached it\'s activation limit.',
            }
        },
        
        confirmation: {
            title: 'License activated',
            subtitle: 'Thank you for your support',
        },

        api: {
            productId: null,
            key: null,
            url: 'https://api.unlock.sh/v1',
        },

        license: {
            fingerprint: false,
            requireEmail: false,
        },

        loading: false,

        email: 'john@snow.com',
        emailError: null,
        licenseKey: '8d562d27-43d4-4032-b988-4f697f17e487',
        licenseError: null,

        activated: false,
        activation: {},

        init() {
            const params = new URLSearchParams(global.location.search);
            const data = JSON.parse(params.get('data'));

            Object.assign(this.prompt, data.prompt ?? {});
            Object.assign(this.confirmation, data.confirmation ?? {});
            Object.assign(this.api, data.api ?? {});
            Object.assign(this.license, data.license ?? {});

            this.logo = data.logo;

            if(this.api.fingerprint === true) {
                ipcRenderer.send('get-device-fingerprint');
                ipcRenderer.on('set-device-fingerprint', (event, arg) => {
                    this.api.fingerprint = arg;
                });
            }

            setTimeout(() => {
                this.isReady = true;
            }, 1000);
        },

        activateLicense() {
            this.loading = true;
            this.error = null;

            let data = {
                key: this.licenseKey
            };

            if(this.license.requireEmail) {
                data = Object.assign(data, {
                    scope: {
                        licensee: {
                            email: this.email,
                        }
                    }
                })
            }

            if(this.api.fingerprint) {
                data.fingerprint = this.api.fingerprint;
            }

            axios.post(`${this.api.url}/products/${this.api.productId}/licenses/activate-key`, data,
            {
                headers: {
                    'Authorization': `Bearer ${this.api.key}`
                }
            })
            .then((response) => {        
                if(response.status === 201) {
                    setTimeout(() => {
                        this.activation = response.data;
                        this.activated = true;

                        setTimeout(() => {
                            ipcRenderer.sendSync('license-activated', { licenseKey: this.licenseKey, email: this.email, fingerprint: this.activation.fingerprint});
                        }, 3000);
                    }, 500);
                }              
            })
            .catch((error) => {
                this.loading = false;
                if(error.response.status === 422) {
                    this.licenseError = this.prompt.errors[error.response.data.errors['license']] ?? null;
                    this.emailError = error.response.data.errors['scope.licensee.email'] ?? null;
                }
            })
            .then(() => {
                
            });
        }
    }

}

Alpine.start();