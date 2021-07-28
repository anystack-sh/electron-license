import Alpine from 'alpinejs';


const { ipcRenderer } = require('electron');
const axios = require('axios');



window.Unlock = () => {    

    return {
        prompt: {
            title: 'Unlock',
            subtitle: 'Activate your license to get started',
            logo: 'https://unlock.sh/img/unlock-logo-grey.svg'
        },
        
        confirmation: {
            title: 'License activated',
            subtitle: 'Thank you for your support',
            action: 'Open Application'
        },

        productId: null,
        apiKey: null,

        loading: false,
        email: 'john@snow.com',
        licenseKey: '8d562d27-43d4-4032-b988-4f697f17e487',
        error: null,

        activated: false,
        activation: {},

        init() {
            const params = new URLSearchParams(global.location.search);
    
            var data =  JSON.parse(params.get('data'))        

            this.title = data.title;
            this.subtitle = data.subtitle;
            this.logo = data.logo;
            this.productId = data.productId;
            this.apiKey = data.apiKey;
        },

        activateLicense() {
            this.loading = true;
            this.error = null;

            axios.post(`http://api.unlock.test/v1/products/${this.productId}/licenses/activate-key`, {
                key: this.licenseKey
            }, 
            {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            })
            .then((response) => {        
                if(response.status === 201) {
                    this.activation = response.data;
                    this.activated = true;
                }              
            })
            .catch((error) => {
                this.loading = false;
                if(error.response.status === 422) {
                    this.error = error.response.data.meta.message;
                }
            })
            .then(() => {
                
            });
        },

        openApplication() {
            
            ipcRenderer.sendSync('license-activated');
        }
    }

}

Alpine.start();