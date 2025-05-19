require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const API_KEY_SOST = process.env.API_KEY_SOST;
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_ACCESS_TOKEN = process.env.KOMMO_ACCESS_TOKEN;

const ID_NUMNOTA = 1299400; // ID do campo Número da Nota Fiscal
const ID_DOCUMENTO = 1277678; // ID do campo CNPJ

function getCustomFieldValue(fields, fieldId) {
    const field = fields.find(f => f.field_id == fieldId);
    return field?.values?.[0]?.value || null;
}

app.post('/webhook-sost', async (req, res) => {
    try {
        // console.log('Body recebido:', JSON.stringify(req.body, null, 2));

        const leadId = req.body?.leads?.status?.[0]?.id;
        if (!leadId) {
            return res.status(400).json({ error: 'ID do lead não encontrado no webhook.' });
        }

        const kommoResponse = await axios.get(`https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`, {
            headers: {
                Authorization: `Bearer ${KOMMO_ACCESS_TOKEN}`
            }
        });
        
        const fields = kommoResponse.data.custom_fields_values;
        if (!fields) {
            return res.status(400).json({ error: 'Campos personalizados não encontrados no lead.' });
        }

        const numnota = getCustomFieldValue(fields, ID_NUMNOTA);
        const documento = getCustomFieldValue(fields, ID_DOCUMENTO);

        if (!numnota || !documento) {
            return res.status(400).json({ error: 'numnota ou documento não encontrados nos campos personalizados.' });
        }

        const url = `http://vpn.sost.com.br:8000/api/boleto/${numnota}/${documento}`;

        const response = await axios.get(url, {
            headers: {
                'X-API-KEY': API_KEY_SOST
            }
        });

        res.status(200).json({
            message: 'Requisição enviada com sucesso para API externa.',
            data: response.data
        });
    } catch (error) {
        console.error('Erro:', error.message);
        res.status(500).json({ error: 'Erro ao processar o webhook.' });
    }
});

const PORT = process.env.PORT
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});