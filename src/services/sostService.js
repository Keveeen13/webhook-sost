const axios = require('axios');

const SOST_URL = 'http://vpn.sost.com.br:8000/api';
const headers = { 'X-API-KEY': process.env.X_API_KEY_BOLETO };

module.exports = {
    async getParcelas(cnpj, tipo) {
        const res = await axios.get(`${SOST_URL}/parcelas/${cnpj}/${tipo}`, { headers });
        return res.data.dados || [];
    },

    async getBoleto(numnota, cnpj, parcela) {
        const res = await axios.get(`${SOST_URL}/boleto/${numnota}/${cnpj}/${parcela}`, {
            headers, responseType: 'arraybuffer'
        });
        return res.data;
    }
};