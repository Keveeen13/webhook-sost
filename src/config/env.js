const config = {
    kommo: {
        subdomain: process.env.KOMMO_SUBDOMAIN,
        accessToken: process.env.KOMMO_ACCESS_TOKEN,
        fieldIds: {
            pdfBoleto: parseInt(process.env.FIELD_ID_DO_CAMPO_PDF_NA_KOMMO, 10),
            numNota: parseInt(process.env.ID_CAMPO_NUMNOTA_KOMMO, 10),
            documento: parseInt(process.env.ID_CAMPO_DOCUMENTO_KOMMO, 10),
            parcela: parseInt(process.env.ID_CAMPO_PARCELA_KOMMO, 10),
            mensagemBot: parseInt(process.env.ID_CAMPO_MENSAGEM_BOT, 10)
        }
    },
    sost: {
        apiKey: process.env.X_API_KEY_BOLETO,
        baseUrl: 'http://vpn.sost.com.br:8000/api'
    }
};

// Validação
if (Object.values(config.kommo.fieldIds).some(id => isNaN(id))) {
    throw new Error("Erro Crítico: Um ou mais IDs de campos da Kommo não foram carregados do .env ou são inválidos.");
}

module.exports = config;