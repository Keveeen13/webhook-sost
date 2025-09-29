const config = {
    kommo: {
        subdomain: process.env.KOMMO_SUBDOMAIN,
        accessToken: process.env.KOMMO_ACCESS_TOKEN,
        fieldIds: {
            pdfBoleto: parseInt(process.env.FIELD_ID_DO_CAMPO_PDF_NA_KOMMO, 10),
            numNota: parseInt(process.env.ID_CAMPO_NUMNOTA_KOMMO, 10),
            documento: parseInt(process.env.ID_CAMPO_DOCUMENTO_KOMMO, 10),
            parcela: parseInt(process.env.ID_CAMPO_PARCELA_KOMMO, 10)
        }
    },
    sost: {
        apiKey: process.env.X_API_KEY_BOLETO,
        baseUrl: 'http://vpn.sost.com.br:8000/api'
    }
};

// Validação
if (!config.kommo.subdomain || !config.kommo.accessToken || !config.sost.apiKey) {
    throw new Error("Erro Crítico: Variáveis de ambiente KOMMO_SUBDOMAIN, KOMMO_ACCESS_TOKEN, ou X_API_KEY_BOLETO não definidas no .env.");
}

if (isNaN(config.kommo.fieldIds.pdfBoleto) || isNaN(config.kommo.fieldIds.numNota) || isNaN(config.kommo.fieldIds.documento)) {
    throw new Error("Erro Crítico: IDs de campos personalizados da Kommo não foram carregados corretamente do .env ou não são números válidos.");
}

module.exports = config;