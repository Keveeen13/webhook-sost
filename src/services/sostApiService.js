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
    const response = await sostApiClient.get(`/boleto/${numnota}/${documento}/${parcela}`);
    
    if (!response.data || !response.data.boleto) {
        throw new Error('A resposta da API de boleto não continha a string Base64 esperada.');
    }
    // Decodifica a string Base64 para um Buffer (dados binários do PDF)
    return Buffer.from(response.data.boleto, 'base64');
};

module.exports = {
    getParcelas,
    getBoleto
};