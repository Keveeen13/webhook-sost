require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_ACCESS_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const X_API_KEY_BOLETO = process.env.X_API_KEY_BOLETO;

const FIELD_ID_DO_CAMPO_PDF_NA_KOMMO = 795988;
const ID_CAMPO_NUMNOTA_KOMMO = 1299400;
const ID_CAMPO_DOCUMENTO_KOMMO = 1277678;

async function fetchLeadDetails(leadId, includeContacts = false) {
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    
    let queryParams = 'custom_fields_values';
    if (includeContacts) {
        queryParams += ',contacts';
    }
    const url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=${queryParams}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        // console.log(`Detalhes do Lead (ID: ${leadId}, includeContacts: ${includeContacts}) obtidos da Kommo.`); // Ativar caso queira mais detalhes
        return response.data;
    } catch (error) {
        console.error(`Erro ao buscar detalhes do lead ${leadId} na Kommo:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

async function fetchContactDetails(contactId) {
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    const url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Detalhes do Contato (ID: ${contactId}) obtidos com sucesso.`);
        return response.data;
    } catch (error) {
        console.error(`Erro ao buscar detalhes do contato ID ${contactId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

async function getKommoDriveUrl() {
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado para buscar Drive URL.');
    
    const accountUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/account?with=drive_url`;
    try {
        const response = await axios.get(accountUrl, {
            headers: {
                'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
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

app.post('/webhook-sost', async (req, res) => {
    console.log('--- Novo Webhook Recebido ---');
    let leadId, numnota, documento, nomeDoContatoParaArquivo = null;

    try {
        // Parte 1: Extrair ID do Lead
        if (req.body.leads && req.body.leads.status && req.body.leads.status[0]) {
            leadId = req.body.leads.status[0].id;
            console.log(`Lead ID extraído: ${leadId}`);
        }
        if (!leadId) {
            console.error("ID do Lead não encontrado no payload do webhook.");
            return res.status(400).send({ message: "ID do Lead não encontrado." });
        }

        // Buscar detalhes do lead (incluindo contatos para o nome do arquivo, e campos para numnota/documento)
        const leadDetails = await fetchLeadDetails(leadId, true);

        const customFields = leadDetails.custom_fields_values || [];
        const campoNota = customFields.find(field => field.field_id === ID_CAMPO_NUMNOTA_KOMMO);
        if (campoNota && campoNota.values && campoNota.values[0]) numnota = campoNota.values[0].value;
        const campoDocumento = customFields.find(field => field.field_id === ID_CAMPO_DOCUMENTO_KOMMO);
        if (campoDocumento && campoDocumento.values && campoDocumento.values[0]) documento = campoDocumento.values[0].value;
        
        console.log(`Valores de numnota (${numnota}) e documento (${documento}) obtidos.`);

        if (!numnota || !documento) {
            console.error(`Numnota ou Documento não encontrados para o lead ${leadId}.`);
            return res.status(400).send({ message: "Numnota ou Documento não encontrados no lead." });
        }
        
        // Extrair nome do contato principal
        if (leadDetails._embedded && leadDetails._embedded.contacts && leadDetails._embedded.contacts.length > 0) {
            const contatoPrincipalInfo = leadDetails._embedded.contacts.find(contact => contact.is_main) || leadDetails._embedded.contacts[0];
            if (contatoPrincipalInfo && contatoPrincipalInfo.id) {
                const contactDetails = await fetchContactDetails(contatoPrincipalInfo.id);
                if (contactDetails) {
                    if (contactDetails.first_name && contactDetails.first_name.trim() !== '') nomeDoContatoParaArquivo = contactDetails.first_name;
                    else if (contactDetails.name && contactDetails.name.trim() !== '') nomeDoContatoParaArquivo = contactDetails.name.split(' ')[0];
                    if (nomeDoContatoParaArquivo) console.log(`Nome do contato para arquivo: ${nomeDoContatoParaArquivo}`);
                }
            }
        }
        if (!nomeDoContatoParaArquivo) console.warn(`Nome do contato principal não encontrado para o lead ${leadId}, usando fallback para nome do arquivo.`);


        // Parte 2: Chamar API da SOST
        let pdfData, tamanhoArquivoBoleto;
        let nomeArquivoBoleto = `BOLETO_${(nomeDoContatoParaArquivo || 'CLIENTE').toUpperCase().replace(/[^A-Z0-9À-ÖØ-ÞĀ-Ž_.-]/gi, '') || 'CLIENTE'}.pdf`;
        
        console.log(`Chamando API de boletos para numnota=${numnota}, documento=${documento}`);
        const boletoApiUrl = `http://vpn.sost.com.br:8000/api/boleto/${numnota}/${documento}`;
        try {
            const boletoResponse = await axios.get(boletoApiUrl, {
                headers: {
                    'X-API-KEY': X_API_KEY_BOLETO
                },
                responseType: 'arraybuffer'
            });
            pdfData = boletoResponse.data;
            tamanhoArquivoBoleto = pdfData.length;
            console.log(`PDF do boleto recebido (${tamanhoArquivoBoleto} bytes). Nome definido como: ${nomeArquivoBoleto}`);
        } catch (boletoError) {
            if (boletoError.response && boletoError.response.status === 404) {
                console.warn('API de Boletos: Boleto não encontrado (404).');
                try {
                    console.log(`Limpando o campo personalizado (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO}) do lead ${leadId}...`);
                    const updateLeadUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
                    const clearCustomFieldPayload = {
                        custom_fields_values: [{
                            field_id: FIELD_ID_DO_CAMPO_PDF_NA_KOMMO,
                            values: [{ "value": null }] 
                        }]
                    };
                    await axios.patch(updateLeadUrl, clearCustomFieldPayload, {
                        headers: {
                            'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    });
                    console.log(`--- Campo personalizado do lead ${leadId} limpo devido a boleto não encontrado. ---`);
                    return res.status(200).send({ message: `Boleto não encontrado. Campo personalizado (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO}) no Kommo foi limpo.` });
                } catch (clearError) {
                    console.error('Erro ao tentar limpar o campo personalizado no Kommo:', clearError.message);
                    return res.status(500).send({ message: 'Boleto não encontrado, e falha subsequente ao tentar limpar o campo no Kommo.', originalError: boletoError.message, clearError: clearError.message });
                }
            }
            console.error('Erro ao chamar API de boletos (não 404):', boletoError.message);
            throw boletoError;
        }

        // Parte 3: Upload do PDF para o Kommo
        const driveUrl = await getKommoDriveUrl();
        const sessionUrl = `${driveUrl}/v1.0/sessions`;
        const sessionPayload = {
            file_name: nomeArquivoBoleto, file_size: tamanhoArquivoBoleto,
            content_type: 'application/pdf', conflict_resolution: { policy: "autorename" }
        };
        const sessionResponse = await axios.post(sessionUrl, sessionPayload, {
            headers: {
                'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        const kommoUploadUrl = sessionResponse.data.upload_url;
        if (!kommoUploadUrl) throw new Error('Falha ao obter Upload URL da sessão da Kommo.');
        console.log(`Sessão de upload criada. Upload URL pronta.`);
        
        
        const fileDataUploadResponse = await axios.post(kommoUploadUrl, pdfData, {
            headers: {
                'Content-Type': 'application/octet-stream', 'Content-Length': tamanhoArquivoBoleto,
                'Content-Range': `bytes 0-${tamanhoArquivoBoleto - 1}/${tamanhoArquivoBoleto}`
            }
        });
        console.log('Upload dos BYTES para Kommo Drive - Status:', fileDataUploadResponse.status);
        
        let finalFileUuid, finalVersionUuid;
        if (fileDataUploadResponse.data && fileDataUploadResponse.data.uuid && fileDataUploadResponse.data.version_uuid) {
            finalFileUuid = fileDataUploadResponse.data.uuid;
            finalVersionUuid = fileDataUploadResponse.data.version_uuid;
            console.log(`UUIDs FINAIS obtidos do upload: File: ${finalFileUuid}, Version: ${finalVersionUuid}`);
        } else {
             console.warn('UUIDs finais não encontrados na resposta direta do upload. Usando fallback do JWT da upload_url (menos ideal).');
            if (kommoUploadUrl) {
                const jwtStringFallback = kommoUploadUrl.substring(kommoUploadUrl.lastIndexOf('/') + 1);
                const jwtPayloadFallback = decodeJwtPayload(jwtStringFallback);
                if (jwtPayloadFallback) {
                    if (jwtPayloadFallback.content_id) finalFileUuid = jwtPayloadFallback.content_id;
                    if (jwtPayloadFallback.node_id) finalVersionUuid = jwtPayloadFallback.node_id;
                }
            }
            if (!finalFileUuid || !finalVersionUuid) {
                throw new Error('Falha crítica: UUIDs finais do arquivo não puderam ser determinados após upload.');
            }
            console.log(`UUIDs de FALLBACK usados: File: ${finalFileUuid}, Version: ${finalVersionUuid}`);
        }
        console.log('PDF upado para Kommo Drive.');

        // Parte 4 (COMBINADA):
        let customFieldUpdated = false;
        try {
            
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
            // console.log('Payload para PATCH:', JSON.stringify(updatePayload, null, 2)); // Caso precise depurar o payload exato

            const patchResponse = await axios.patch(updateLeadUrl, updatePayload, {
                headers: {
                    'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            console.log('Campo personalizado atualizado - Status:', patchResponse.status);
            customFieldUpdated = true;
        } catch (patchError) {
            console.error('Erro ao ATUALIZAR CAMPO PERSONALIZADO:', patchError.message);
            if (patchError.response) console.error('Detalhes do Erro PATCH:', JSON.stringify(patchError.response.data, null, 2));
        }
        
        let noteCreated = false;
        let notaCriadaId = null;
        try {
            
            const createNoteUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}/notes`;
            const notePayload = [{
                "note_type": "attachment",
                "params": {
                    "file_uuid": finalFileUuid,
                    "file_name": nomeArquivoBoleto,
                    "version_uuid": finalVersionUuid
                }
            }];
            // console.log('Payload para criar nota:', JSON.stringify(notePayload, null, 2)); // Caso precise depurar o payload exato

            const noteResponse = await axios.post(createNoteUrl, notePayload, {
                headers: {
                    'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            console.log('Criação da nota - Status:', noteResponse.status); 
            if (noteResponse.data && noteResponse.data._embedded && noteResponse.data._embedded.notes && noteResponse.data._embedded.notes[0]) {
                notaCriadaId = noteResponse.data._embedded.notes[0].id;
            } else if (Array.isArray(noteResponse.data) && noteResponse.data.length > 0 && noteResponse.data[0].id) {
                 notaCriadaId = noteResponse.data[0].id;
            }
            if (notaCriadaId) {
                console.log(`Nota de anexo criada (ID Nota: ${notaCriadaId}).`);
                noteCreated = true;
            } else if (String(noteResponse.status).startsWith('2')) { 
                noteCreated = true; 
                console.log('Nota de anexo criada (status OK, sem ID extraído da resposta padrão).');
            } else {
                console.warn('Criação da nota não confirmada pela estrutura da resposta.');
            }
        } catch (noteError) {
            console.error('Erro ao criar NOTA de anexo:', noteError.message);
            if (noteError.response) console.error('Detalhes do Erro Nota:', JSON.stringify(noteError.response.data, null, 2));
        }

        let finalMessage = `Webhook para ${nomeArquivoBoleto} processado. `;
        responseStatus = 200;
        if (customFieldUpdated) finalMessage += "Campo personalizado OK. "; else finalMessage += "Campo personalizado FALHOU. ";
        if (noteCreated) finalMessage += "Nota de anexo OK. ---"; else finalMessage += "Nota de anexo FALHOU. ";
        if (!customFieldUpdated && !noteCreated) responseStatus = 500; 
        else if (!customFieldUpdated || !noteCreated) responseStatus = 207; 

        console.log("--- Mensagem final:", finalMessage);
        res.status(responseStatus).send({
            message: finalMessage, boletoFileName: nomeArquivoBoleto, 
            finalFileUuidForKommo: finalFileUuid, finalVersionUuidForKommo: finalVersionUuid,
            kommoNoteId: notaCriadaId, customFieldUpdated, noteCreated
        });

    } catch (error) {
        console.error('Erro GERAL CRÍTICO no webhook:', error.message);
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
            message: 'Erro interno crítico no servidor ao processar webhook.',
            error: error.message, errorDetails: errorResponseDetails
        });
    }
});

app.listen(port, () => {
    console.log(`Servidor do webhook rodando em http://localhost:${port}/webhook-sost2`);
});