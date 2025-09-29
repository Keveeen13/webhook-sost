const axios = require('axios');
const config = require('../config/env');

const sostApiClient = axios.create({
    baseURL: config.sost.baseUrl,
    headers: {
        'X-API-KEY': config.sost.apiKey
    }
});

const getParcelas = async (numnota, documento) => {
    console.log(`Buscando parcelas para numnota=${numnota}, documento=${documento}`);
    const response = await sostApiClient.get(`/parcelas/${numnota}/${documento}`);
    return response.data.parcelas;
};

const getBoleto = async (numnota, documento, parcela) => {
    console.log(`Gerando boleto para a parcela: ${parcela}`);

    const boletoApiUrl = `${config.sost.baseUrl}/boleto/${numnota}/${documento}/${parcela}`;

    console.log(`Tentando fazer a requisição GET para a URL do boleto: ${boletoApiUrl}`);

    try {
        const response = await axios.get(boletoApiUrl, {
            headers: {
                'X-API-KEY': config.sost.apiKey
            },
            responseType: 'arraybuffer' 
        });
        
        return response.data;

    } catch (error) {
        console.error(`Erro específico do Axios ao chamar a API de Boleto: ${error.message}`);
        throw error;
    }
};

module.exports = {
    getParcelas,
    getBoleto
};