require('dotenv').config();
const express = require('express');
const axios = require('axios');

// ... (imports e constantes como antes, sem alterações aqui) ...
const app = express();
const port = process.env.PORT;

app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_ACCESS_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const X_API_KEY_BOLETO = process.env.X_API_KEY_BOLETO;

const FIELD_ID_DO_CAMPO_PDF_NA_KOMMO = process.env.FIELD_ID_DO_CAMPO_PDF_NA_KOMMO;
const ID_CAMPO_NUMNOTA_KOMMO = process.env.ID_CAMPO_NUMNOTA_KOMMO;
const ID_CAMPO_DOCUMENTO_KOMMO = process.env.ID_CAMPO_DOCUMENTO_KOMMO;

async function fetchLeadDetailsFromKommo(leadId) { /* ...código como antes... */
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    const url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=custom_fields_values`;
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log('Detalhes do Lead obtidos da Kommo com sucesso.');
        return response.data;
    } catch (error) {
        console.error('Erro ao buscar detalhes do lead na Kommo:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}
async function getKommoDriveUrl() { /* ...código como antes... */
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado para buscar Drive URL.');
    console.log('Buscando Drive URL da conta Kommo...');
    const accountUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/account?with=drive_url`;
    try {
        const response = await axios.get(accountUrl, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        if (response.data && response.data.drive_url) {
            console.log('Drive URL obtido:', response.data.drive_url);
            return response.data.drive_url;
        }
        throw new Error('Drive URL não encontrado na resposta da API da conta Kommo.');
    } catch (error) {
        console.error('Erro ao buscar Drive URL da Kommo:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}
// decodeJwtPayload não é mais estritamente necessário para os UUIDs finais, mas pode ser mantido se quiser inspecionar o JWT da upload_url por outros motivos.
function decodeJwtPayload(jwtToken) {
    try {
        const tokenParts = jwtToken.split('.');
        if (tokenParts.length === 3) {
            const payloadBase64Url = tokenParts[1];
            const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
            const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
            return JSON.parse(payloadJson);
        }
    } catch (e) { console.error('Erro ao decodificar JWT payload:', e); }
    return null;
}

app.post('/webhook-sost2', async (req, res) => {
    console.log('--- Novo Webhook Recebido ---');
    let leadId, numnota, documento;

    try {
        // Etapa 1 e 2 (OK)
        if (req.body.leads && req.body.leads.status && req.body.leads.status[0]) {
            leadId = req.body.leads.status[0].id;
            console.log(`Lead ID extraído (do status): ${leadId}`);
            if (leadId) {
                const leadDetails = await fetchLeadDetailsFromKommo(leadId);
                const customFields = leadDetails.custom_fields_values || [];
                const campoNota = customFields.find(field => field.field_id === ID_CAMPO_NUMNOTA_KOMMO);
                if (campoNota && campoNota.values && campoNota.values[0]) numnota = campoNota.values[0].value;
                const campoDocumento = customFields.find(field => field.field_id === ID_CAMPO_DOCUMENTO_KOMMO);
                if (campoDocumento && campoDocumento.values && campoDocumento.values[0]) documento = campoDocumento.values[0].value;
                console.log(`Valores de numnota (${numnota}) e documento (${documento}) buscados da API Kommo.`);
            }
        }
        if (!leadId || !numnota || !documento) {
            const missing = ["ID do Lead", "Número da Nota", "Documento"].filter((v, i) => ![leadId, numnota, documento][i]);
            console.error(`${missing.join(', ')} não encontrado(s).`);
            return res.status(400).send({ message: `${missing.join(', ')} não encontrado(s).` });
        }
        console.log(`Chamando API de boletos para numnota=${numnota}, documento=${documento}`);
        const boletoApiUrl = `http://vpn.sost.com.br:8000/api/boleto/${numnota}/${documento}`;
        const boletoResponse = await axios.get(boletoApiUrl, {
            headers: { 'X-API-KEY': X_API_KEY_BOLETO }, responseType: 'arraybuffer'
        });
        const pdfData = boletoResponse.data;
        const nomeArquivoBoleto = `boleto_${numnota}_${documento}.pdf`;
        const tamanhoArquivoBoleto = pdfData.length;
        console.log(`PDF do boleto recebido (${tamanhoArquivoBoleto} bytes). Nome: ${nomeArquivoBoleto}`);

        // Etapa 3: Upload do PDF para Kommo Drive
        const driveUrl = await getKommoDriveUrl();
        console.log('Criando sessão de upload na Kommo...');
        const sessionUrl = `${driveUrl}/v1.0/sessions`;
        const sessionPayload = {
            file_name: nomeArquivoBoleto, file_size: tamanhoArquivoBoleto,
            content_type: 'application/pdf', conflict_resolution: { policy: "autorename" }
        };
        const sessionResponse = await axios.post(sessionUrl, sessionPayload, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const kommoUploadUrl = sessionResponse.data.upload_url; // URL temporária para upload dos bytes
        console.log(`Sessão de upload criada. Upload URL: ${kommoUploadUrl}`);
        if (!kommoUploadUrl) {
            throw new Error('Falha ao obter Upload URL da sessão da Kommo.');
        }
        
        console.log(`Fazendo upload do PDF para: ${kommoUploadUrl}`);
        const fileDataUploadResponse = await axios.post(kommoUploadUrl, pdfData, {
            headers: {
                'Content-Type': 'application/octet-stream', 'Content-Length': tamanhoArquivoBoleto,
                'Content-Range': `bytes 0-${tamanhoArquivoBoleto - 1}/${tamanhoArquivoBoleto}`
            }
        });
        console.log('Resposta do upload dos BYTES - Status:', fileDataUploadResponse.status);
        console.log('Resposta do upload dos BYTES - Data:', JSON.stringify(fileDataUploadResponse.data, null, 2)); // Logar o corpo completo
        
        // Extrair os UUIDs FINAIS da resposta do upload dos bytes
        let finalFileUuid;
        let finalVersionUuid;
        if (fileDataUploadResponse.data && fileDataUploadResponse.data.uuid && fileDataUploadResponse.data.version_uuid) {
            finalFileUuid = fileDataUploadResponse.data.uuid;
            finalVersionUuid = fileDataUploadResponse.data.version_uuid;
            console.log(`UUIDs FINAIS obtidos da resposta do upload: File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid}`);
        } else {
            console.error('Não foi possível obter os UUIDs finais da resposta do upload dos bytes:', fileDataUploadResponse.data);
            throw new Error('Falha ao obter UUIDs finais do arquivo após upload para o Drive.');
        }
        console.log('PDF enviado com sucesso para a Kommo Drive e UUIDs finais obtidos.');

        // ETAPA 4 (COMBINADA):
        // Parte 4a: ATUALIZAR O CAMPO PERSONALIZADO DO LEAD
        let customFieldUpdated = false;
        try {
            console.log(`Tentando ATUALIZAR CAMPO PERSONALIZADO do lead ${leadId} (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO})`);
            const updateLeadUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
            const updatePayload = {
                custom_fields_values: [{
                    field_id: FIELD_ID_DO_CAMPO_PDF_NA_KOMMO,
                    values: [{ "value": { 
                        "file_uuid": finalFileUuid,       // <<< USAR O UUID FINAL
                        "version_uuid": finalVersionUuid, // <<< USAR O VERSION_UUID FINAL
                        "file_name": nomeArquivoBoleto,
                        "file_size": tamanhoArquivoBoleto
                    }}]
                }]
            };
            console.log('Payload para PATCH do custom_fields_values:', JSON.stringify(updatePayload, null, 2));
            const patchResponse = await axios.patch(updateLeadUrl, updatePayload, {
                headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
            });
            console.log('Resposta do PATCH (campo personalizado):', patchResponse.status);
            console.log(`Campo personalizado (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO}) do lead ${leadId} atualizado.`);
            customFieldUpdated = true;
        } catch (patchError) {
            console.error('Erro ao tentar ATUALIZAR CAMPO PERSONALIZADO do lead:', patchError.message);
            if (patchError.response) {
                console.error('Detalhes do Erro do PATCH:', JSON.stringify(patchError.response.data, null, 2));
            }
        }
        
        // Parte 4b: CRIAR UMA NOTA NO LEAD COM O ANEXO (para histórico e link funcional)
        let noteCreated = false;
        let notaCriadaId = null;
        try {
            console.log(`Criando nota no lead ${leadId} para anexar o arquivo (File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid})...`);
            const createNoteUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;
            const notePayload = [{
                "note_type": "attachment",
                "params": { 
                    "file_uuid": finalFileUuid,       // <<< USAR O UUID FINAL
                    "file_name": nomeArquivoBoleto, 
                    "version_uuid": finalVersionUuid  // <<< USAR O VERSION_UUID FINAL
                }
            }];
            console.log('Payload para criar nota:', JSON.stringify(notePayload, null, 2));
            const noteResponse = await axios.post(createNoteUrl, notePayload, {
                headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
            });
            console.log('Resposta da criação da nota - Status:', noteResponse.status); 
            console.log('Resposta da criação da nota - Data:', JSON.stringify(noteResponse.data, null, 2));
            
            if (noteResponse.data && noteResponse.data._embedded && noteResponse.data._embedded.notes && noteResponse.data._embedded.notes[0]) {
                notaCriadaId = noteResponse.data._embedded.notes[0].id;
            } else if (Array.isArray(noteResponse.data) && noteResponse.data.length > 0 && noteResponse.data[0].id) {
                 notaCriadaId = noteResponse.data[0].id;
            }

            if (notaCriadaId) {
                console.log(`Nota com anexo (ID da Nota: ${notaCriadaId}) criada com sucesso no lead ${leadId}.`);
                noteCreated = true;
            } else {
                 console.warn('Nota PODE ter sido criada (status OK), mas não foi possível confirmar o ID da nota na resposta.');
                 if (String(noteResponse.status).startsWith('2')) { 
                    noteCreated = true; 
                    console.log('Criação da nota retornou status de sucesso, assumindo que foi criada.');
                 } else {
                    throw new Error('Falha ao confirmar a criação da nota com anexo, resposta inesperada ou status de erro da API.');
                 }
            }
        } catch (noteError) {
            console.error('Erro ao tentar criar nota de anexo:', noteError.message);
            if (noteError.response) {
                console.error('Detalhes do Erro da Nota (axios):', JSON.stringify(noteError.response.data, null, 2));
            }
        }

        // Lógica de resposta final
        let finalMessage = "Processamento do Webhook finalizado. ";
        let responseStatus = 200;
        if (customFieldUpdated) finalMessage += "Campo personalizado preenchido. ";
        else finalMessage += "Falha ao preencher campo personalizado. ";

        if (noteCreated) finalMessage += "Nota de anexo criada. ";
        else finalMessage += "Falha ao criar nota de anexo. ";

        if (!customFieldUpdated && !noteCreated) responseStatus = 500; 
        else if (!customFieldUpdated || !noteCreated) responseStatus = 207; 

        console.log("Mensagem final do webhook:", finalMessage);
        res.status(responseStatus).send({
            message: finalMessage,
            boletoFileName: nomeArquivoBoleto, 
            finalFileUuidForKommo: finalFileUuid, // Retornar os IDs finais usados
            finalVersionUuidForKommo: finalVersionUuid,
            kommoNoteId: notaCriadaId, 
            customFieldUpdated, noteCreated
        });

    } catch (error) { /* ... seu bloco catch geral como antes ... */
        console.error('Erro GERAL no processamento do webhook:', error.message);
        let errorResponseDetails = null;
        let errorStatus = 500;
        if (error.response) {
            errorResponseDetails = error.response.data;
            errorStatus = error.response.status;
            console.error('Detalhes do Erro (axios):', JSON.stringify(errorResponseDetails, null, 2));
            console.error('Status do Erro (axios):', errorStatus);
        } else {
            console.error('Objeto de Erro:', error);
        }
        if (error.stack) console.error('Stack do Erro:', error.stack);
        res.status(errorStatus).send({ 
            message: 'Erro interno no servidor ao processar o webhook.',
            error: error.message, errorDetails: errorResponseDetails
        });
    }
});

app.listen(port, () => {
    console.log(`Servidor do webhook rodando em http://localhost:${port}/webhook-sost2`);
});