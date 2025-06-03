const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- CONFIGURAÇÕES ---
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_ACCESS_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const X_API_KEY_BOLETO = process.env.X_API_KEY_BOLETO;

const FIELD_ID_DO_CAMPO_PDF_NA_KOMMO = 795988; 
const ID_CAMPO_NUMNOTA_KOMMO = 1299400;
const ID_CAMPO_DOCUMENTO_KOMMO = 1277678;

async function fetchLeadDetailsFromKommo(leadId, includeContacts = false) { // Adicionado parâmetro para incluir contatos
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    let url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=custom_fields_values`;
    if (includeContacts) {
        url += ',contacts';
    }
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log(`Detalhes do Lead (includeContacts: ${includeContacts}) obtidos da Kommo com sucesso.`);
        return response.data; 
    } catch (error) {
        console.error(`Erro ao buscar detalhes do lead (includeContacts: ${includeContacts}) na Kommo:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

async function fetchContactDetails(contactId) {
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    const url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}`; 
    console.log(`Buscando detalhes do contato ID: ${contactId}...`);
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log('Detalhes do Contato obtidos com sucesso.');
        return response.data; 
    } catch (error) {
        console.error(`Erro ao buscar detalhes do contato ID ${contactId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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

function decodeJwtPayload(jwtToken) { /* ...código como antes... */
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
        // Etapa 1 (Parcial): Extrair IDs do webhook
        if (req.body.leads && req.body.leads.status && req.body.leads.status[0]) {
            leadId = req.body.leads.status[0].id;
            console.log(`Lead ID extraído (do status): ${leadId}`);
        }
        if (!leadId) {
            console.error("ID do Lead não encontrado no payload do webhook.");
            return res.status(400).send({ message: "ID do Lead não encontrado." });
        }

        // Buscar detalhes do lead para numnota e documento (sem contatos por enquanto)
        const leadDetailsInicial = await fetchLeadDetailsFromKommo(leadId, false);
        const customFieldsInicial = leadDetailsInicial.custom_fields_values || [];
        const campoNotaInicial = customFieldsInicial.find(field => field.field_id === ID_CAMPO_NUMNOTA_KOMMO);
        if (campoNotaInicial && campoNotaInicial.values && campoNotaInicial.values[0]) numnota = campoNotaInicial.values[0].value;
        const campoDocumentoInicial = customFieldsInicial.find(field => field.field_id === ID_CAMPO_DOCUMENTO_KOMMO);
        if (campoDocumentoInicial && campoDocumentoInicial.values && campoDocumentoInicial.values[0]) documento = campoDocumentoInicial.values[0].value;
        
        console.log(`Valores de numnota (${numnota}) e documento (${documento}) obtidos para consulta do boleto.`);

        if (!numnota || !documento) {
            console.error(`Número da Nota ou Documento não encontrados nos campos personalizados do lead ${leadId}.`);
            return res.status(400).send({ message: "Número da Nota ou Documento não encontrados no lead." });
        }

        // Etapa 2: Chamar API de Boletos e tratar erro 404 (Boleto Não Encontrado)
        let pdfData, nomeArquivoBoleto, tamanhoArquivoBoleto;
        let finalFileUuid, finalVersionUuid; // Serão definidos apenas se o boleto for encontrado

        console.log(`Chamando API de boletos para numnota=${numnota}, documento=${documento}`);
        const boletoApiUrl = `http://vpn.sost.com.br:8000/api/boleto/${numnota}/${documento}`;
        
        try {
            const boletoResponse = await axios.get(boletoApiUrl, {
                headers: { 'X-API-KEY': X_API_KEY_BOLETO }, responseType: 'arraybuffer'
            });
            pdfData = boletoResponse.data;
            tamanhoArquivoBoleto = pdfData.length;

            // Somente se o boleto for encontrado, buscar nome do contato para o nome do arquivo
            let nomeDoContatoParaArquivo = null;
            const leadDetailsComContato = await fetchLeadDetailsFromKommo(leadId, true); // Agora busca contatos
            if (leadDetailsComContato && leadDetailsComContato._embedded && leadDetailsComContato._embedded.contacts && leadDetailsComContato._embedded.contacts.length > 0) {
                const contatoPrincipalInfo = leadDetailsComContato._embedded.contacts.find(contact => contact.is_main) || leadDetailsComContato._embedded.contacts[0];
                if (contatoPrincipalInfo && contatoPrincipalInfo.id) {
                    const contactDetails = await fetchContactDetails(contatoPrincipalInfo.id);
                    if (contactDetails) {
                        if (contactDetails.first_name && contactDetails.first_name.trim() !== '') nomeDoContatoParaArquivo = contactDetails.first_name;
                        else if (contactDetails.name && contactDetails.name.trim() !== '') nomeDoContatoParaArquivo = contactDetails.name.split(' ')[0];
                    }
                }
            }
            let primeiroNomeClienteSanitizado = 'CLIENTE';
            if (nomeDoContatoParaArquivo && nomeDoContatoParaArquivo.trim() !== '') {
                primeiroNomeClienteSanitizado = nomeDoContatoParaArquivo.toUpperCase().replace(/[^A-Z0-9À-ÖØ-ÞĀ-Ž_.-]/gi, '');
                if (!primeiroNomeClienteSanitizado) primeiroNomeClienteSanitizado = 'CLIENTE';
            }
            nomeArquivoBoleto = `BOLETO_${primeiroNomeClienteSanitizado}.pdf`;
            console.log(`PDF do boleto recebido (${tamanhoArquivoBoleto} bytes). Nome definido como: ${nomeArquivoBoleto}`);

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
            const kommoUploadUrl = sessionResponse.data.upload_url;
            console.log(`Sessão de upload criada. Upload URL: ${kommoUploadUrl}`);
            if (!kommoUploadUrl) throw new Error('Falha ao obter Upload URL da sessão da Kommo.');
            
            console.log(`Fazendo upload do PDF para: ${kommoUploadUrl}`);
            const fileDataUploadResponse = await axios.post(kommoUploadUrl, pdfData, {
                headers: {
                    'Content-Type': 'application/octet-stream', 'Content-Length': tamanhoArquivoBoleto,
                    'Content-Range': `bytes 0-${tamanhoArquivoBoleto - 1}/${tamanhoArquivoBoleto}`
                }
            });
            console.log('Resposta do upload dos BYTES - Status:', fileDataUploadResponse.status);
            console.log('Resposta do upload dos BYTES - Data:', JSON.stringify(fileDataUploadResponse.data, null, 2));
            
            if (fileDataUploadResponse.data && fileDataUploadResponse.data.uuid && fileDataUploadResponse.data.version_uuid) {
                finalFileUuid = fileDataUploadResponse.data.uuid;
                finalVersionUuid = fileDataUploadResponse.data.version_uuid;
                console.log(`UUIDs FINAIS obtidos: File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid}`);
            } else {
                // Fallback (embora a resposta direta do upload seja preferível)
                if (kommoUploadUrl) {
                    const jwtStringFallback = kommoUploadUrl.substring(kommoUploadUrl.lastIndexOf('/') + 1);
                    const jwtPayloadFallback = decodeJwtPayload(jwtStringFallback);
                    if (jwtPayloadFallback) {
                        if (jwtPayloadFallback.content_id) finalFileUuid = jwtPayloadFallback.content_id;
                        if (jwtPayloadFallback.node_id) finalVersionUuid = jwtPayloadFallback.node_id;
                        console.log(`Usando UUIDs de FALLBACK do JWT: File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid}`);
                    }
                }
                if (!finalFileUuid || !finalVersionUuid) {
                    throw new Error('Falha ao obter UUIDs finais do arquivo após upload.');
                }
            }
            console.log('PDF enviado com sucesso para a Kommo Drive.');

            // ETAPA 4 (COMBINADA):
            let customFieldUpdated = false;
            try {
                console.log(`Tentando ATUALIZAR CAMPO PERSONALIZADO do lead ${leadId} (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO})`);
                const updateLeadUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
                const updatePayload = {
                    custom_fields_values: [{
                        field_id: FIELD_ID_DO_CAMPO_PDF_NA_KOMMO,
                        values: [{ "value": { 
                            "file_uuid": finalFileUuid, "version_uuid": finalVersionUuid,
                            "file_name": nomeArquivoBoleto, "file_size": tamanhoArquivoBoleto
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
            } catch (patchError) { /* ... log de erro como antes ... */ 
                console.error('Erro ao tentar ATUALIZAR CAMPO PERSONALIZADO do lead:', patchError.message);
                if (patchError.response) {
                    console.error('Detalhes do Erro do PATCH:', JSON.stringify(patchError.response.data, null, 2));
                }
            }
            
            let noteCreated = false;
            let notaCriadaId = null;
            try {
                console.log(`Criando nota no lead ${leadId} para anexar o arquivo (File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid})...`);
                const createNoteUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;
                const notePayload = [{
                    "note_type": "attachment",
                    "params": { "file_uuid": finalFileUuid, "file_name": nomeArquivoBoleto, "version_uuid": finalVersionUuid }
                }];
                console.log('Payload para criar nota:', JSON.stringify(notePayload, null, 2));
                const noteResponse = await axios.post(createNoteUrl, notePayload, {
                    headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
                });
                console.log('Resposta da criação da nota - Status:', noteResponse.status); 
                if (noteResponse.data && noteResponse.data._embedded && noteResponse.data._embedded.notes && noteResponse.data._embedded.notes[0]) {
                    notaCriadaId = noteResponse.data._embedded.notes[0].id;
                } else if (Array.isArray(noteResponse.data) && noteResponse.data.length > 0 && noteResponse.data[0].id) {
                     notaCriadaId = noteResponse.data[0].id;
                }
                if (notaCriadaId) {
                    console.log(`Nota com anexo (ID da Nota: ${notaCriadaId}) criada com sucesso no lead ${leadId}.`);
                    noteCreated = true;
                } else {
                     console.warn('Nota PODE ter sido criada (status OK), mas não foi possível confirmar o ID da nota na resposta. Resposta:', JSON.stringify(noteResponse.data, null, 2));
                     if (String(noteResponse.status).startsWith('2')) { 
                        noteCreated = true; 
                        console.log('Criação da nota retornou status de sucesso, assumindo que foi criada.');
                     } else {
                        throw new Error('Falha ao confirmar a criação da nota com anexo.');
                     }
                }
            } catch (noteError) { /* ... log de erro como antes ... */ 
                console.error('Erro ao tentar criar nota de anexo:', noteError.message);
                if (noteError.response) {
                    console.error('Detalhes do Erro da Nota (axios):', JSON.stringify(noteError.response.data, null, 2));
                }
            }

            let finalMessage = "Processamento do Webhook finalizado. ";
            if (customFieldUpdated) finalMessage += `Campo personalizado preenchido com ${nomeArquivoBoleto}. `;
            else finalMessage += "Falha ao preencher campo personalizado. ";
            if (noteCreated) finalMessage += `Nota de anexo (${nomeArquivoBoleto}) criada. `;
            else finalMessage += "Falha ao criar nota de anexo. ";
            res.status(customFieldUpdated || noteCreated ? 200 : 207).send({ // 200 se algo deu certo, 207 se parcial
                message: finalMessage, boletoFileName: nomeArquivoBoleto, 
                finalFileUuidForKommo: finalFileUuid, finalVersionUuidForKommo: finalVersionUuid,
                kommoNoteId: notaCriadaId, customFieldUpdated, noteCreated
            });

        } catch (boletoError) {
            // SE A API DE BOLETOS DER ERRO (EX: 404 - NÃO ENCONTRADO)
            if (boletoError.response && boletoError.response.status === 404) {
                console.warn('API de Boletos: Boleto não encontrado (404).');
                try {
                    console.log(`Tentando LIMPAR o campo personalizado (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO}) do lead ${leadId}...`);
                    const updateLeadUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
                    const clearCustomFieldPayload = {
                        custom_fields_values: [{
                            field_id: FIELD_ID_DO_CAMPO_PDF_NA_KOMMO,
                            values: [{ "value": null }] // Payload para limpar o campo
                        }]
                    };
                    console.log('Payload para limpar campo personalizado:', JSON.stringify(clearCustomFieldPayload, null, 2));
                    const clearResponse = await axios.patch(updateLeadUrl, clearCustomFieldPayload, {
                        headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
                    });
                    console.log(`Campo personalizado (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO}) do lead ${leadId} limpo. Status: ${clearResponse.status}`);
                    res.status(200).send({ message: `Boleto não encontrado na API externa. Campo personalizado (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO}) no Kommo foi limpo.` });
                } catch (clearError) {
                    console.error('Erro ao tentar LIMPAR o campo personalizado no Kommo após boleto não encontrado:', clearError.message);
                    if (clearError.response) {
                        console.error('Detalhes do erro ao limpar campo:', JSON.stringify(clearError.response.data, null, 2));
                    }
                    res.status(500).send({ message: 'Boleto não encontrado, e falha subsequente ao tentar limpar o campo no Kommo.', originalError: boletoError.message, clearError: clearError.message });
                }
            } else {
                // Outro tipo de erro da API de boletos ou erro de rede para ela
                console.error('Erro ao chamar API de boletos (não 404):', boletoError.message);
                if (boletoError.response) {
                    console.error('Detalhes do erro da API de boletos:', JSON.stringify(boletoError.response.data, null, 2), 'Status:', boletoError.response.status);
                }
                throw boletoError; // Re-lança para o catch principal
            }
        }

    } catch (error) { // Catch Principal
        console.error('Erro GERAL GRAVE no processamento do webhook:', error.message);
        let errorResponseDetails = null;
        let errorStatus = 500;
        if (error.response) {
            errorResponseDetails = error.response.data;
            errorStatus = error.response.status;
            console.error('Detalhes do Erro GERAL (axios):', JSON.stringify(errorResponseDetails, null, 2));
            console.error('Status do Erro GERAL (axios):', errorStatus);
        } else {
            console.error('Objeto de Erro GERAL:', error);
        }
        if (error.stack) console.error('Stack do Erro GERAL:', error.stack);
        res.status(errorStatus).send({ 
            message: 'Erro interno crítico no servidor ao processar o webhook.',
            error: error.message, errorDetails: errorResponseDetails
        });
    }
});

app.listen(port, () => {
    console.log(`Servidor do webhook rodando em http://localhost:${port}/webhook-sost2`);
});