require('dotenv').config();

module.exports = {
    subdomain: process.env.KOMMO_SUBDOMAIN,
    token: process.env.KOMMO_ACCESS_TOKEN,
    fields: {
        cnpj: process.env.ID_CAMPO_CNPJ,
        menuBot: process.env.ID_CAMPO_MENU_BOT,
        respostaCliente: process.env.ID_CAMPO_RESPOSTA_CLIENTE,
        dadosTemporarios: process.env.ID_CAMPO_DADOS_TEMPORARIOS,
        boletos: [
            process.env.ID_CAMPO_BOLETO_1,
            process.env.ID_CAMPO_BOLETO_2,
            process.env.ID_CAMPO_BOLETO_3,
            process.env.ID_CAMPO_BOLETO_4,
            process.env.ID_CAMPO_BOLETO_5
        ]
    }
};