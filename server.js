const express = require('express');
const axios = require('axios');

// ... (definições de app, port, middlewares, constantes KOMMO_*, X_API_KEY_*, IDs de campos - sem alterações) ...
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const KOMMO_ACCESS_TOKEN = process.env.KOMMO_ACCESS_TOKEN;
const X_API_KEY_BOLETO = process.env.X_API_KEY_BOLETO;

const FIELD_ID_DO_CAMPO_PDF_NA_KOMMO = 795988; 
const ID_CAMPO_NUMNOTA_KOMMO = 1299400;
const ID_CAMPO_DOCUMENTO_KOMMO = 1277678;


// Função para buscar detalhes de um CONTATO específico
async function fetchContactDetails(contactId) {
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    // Não precisamos de ?with= aqui geralmente, pois queremos os campos diretos do contato
    const url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/contacts/${contactId}`; 
    console.log(`Buscando detalhes do contato ID: ${contactId}...`);
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log('Detalhes do Contato obtidos com sucesso.');
        // console.log('Dados completos do contato:', JSON.stringify(response.data, null, 2)); // Descomente para ver o JSON completo do contato
        return response.data; 
    } catch (error) {
        console.error(`Erro ao buscar detalhes do contato ID ${contactId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error; // Propaga o erro para ser tratado pelo catch principal do webhook
    }
}

async function fetchLeadDetailsFromKommo(leadId) {
    if (!KOMMO_ACCESS_TOKEN) throw new Error('Token de Acesso Kommo não configurado.');
    const url = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}?with=custom_fields_values,contacts`;
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log('Detalhes do Lead (e referências de contatos) obtidos da Kommo com sucesso.');
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
    let nomeDoContatoParaArquivo = null; 

    try {
        // Etapa 1: Extrair IDs e buscar detalhes do Lead e depois do Contato Principal
        if (req.body.leads && req.body.leads.status && req.body.leads.status[0]) {
            leadId = req.body.leads.status[0].id;
            console.log(`Lead ID extraído (do status): ${leadId}`);
            if (leadId) {
                const leadDetails = await fetchLeadDetailsFromKommo(leadId);
                
                // Log para inspecionar a estrutura de _embedded (como antes, útil para debug)
                if (leadDetails && leadDetails._embedded) {
                    console.log('Conteúdo de leadDetails._embedded:', JSON.stringify(leadDetails._embedded, null, 2));
                }

                // Extrair ID do contato principal e buscar seus detalhes
                if (leadDetails && leadDetails._embedded && leadDetails._embedded.contacts && leadDetails._embedded.contacts.length > 0) {
                    const contatoPrincipalInfo = leadDetails._embedded.contacts.find(contact => contact.is_main) || leadDetails._embedded.contacts[0];
                    
                    if (contatoPrincipalInfo && contatoPrincipalInfo.id) {
                        const contactIdPrincipal = contatoPrincipalInfo.id;
                        console.log(`ID do Contato Principal encontrado no lead: ${contactIdPrincipal}`);
                        const dadosCompletosContato = await fetchContactDetails(contactIdPrincipal); // <<< NOVA CHAMADA À API

                        if (dadosCompletosContato) {
                            if (dadosCompletosContato.first_name && dadosCompletosContato.first_name.trim() !== '') {
                                nomeDoContatoParaArquivo = dadosCompletosContato.first_name;
                                console.log(`Primeiro nome do Contato Principal obtido (do campo 'first_name' do contato): ${nomeDoContatoParaArquivo}`);
                            } else if (dadosCompletosContato.name && dadosCompletosContato.name.trim() !== '') {
                                nomeDoContatoParaArquivo = dadosCompletosContato.name.split(' ')[0];
                                console.log(`Primeiro nome do Contato Principal obtido (da primeira palavra de 'name' do contato): ${nomeDoContatoParaArquivo}`);
                            } else {
                                console.warn(`Contato (ID: ${contactIdPrincipal}) não possui 'first_name' ou 'name' válidos.`);
                            }
                        }
                    } else {
                        console.warn(`Não foi possível encontrar o ID do contato principal no lead ${leadId}.`);
                    }
                } else {
                    console.warn(`Lead ${leadId} não possui contatos vinculados ou a lista de contatos está vazia.`);
                }

                // Extrair campos personalizados (numnota, documento) do lead
                const customFields = leadDetails.custom_fields_values || [];
                const campoNota = customFields.find(field => field.field_id === ID_CAMPO_NUMNOTA_KOMMO);
                if (campoNota && campoNota.values && campoNota.values[0]) numnota = campoNota.values[0].value;
                const campoDocumento = customFields.find(field => field.field_id === ID_CAMPO_DOCUMENTO_KOMMO);
                if (campoDocumento && campoDocumento.values && campoDocumento.values[0]) documento = campoDocumento.values[0].value;
                console.log(`Valores de numnota (${numnota}) e documento (${documento}) buscados da API Kommo.`);
            }
        }
        // ... (restante do código para validação de IDs, geração do nome do arquivo, Etapas 2, 3, 4a, 4b, e catch final)
        // A lógica de fallback para nomeArquivoBoleto e o restante do fluxo permanecem os mesmos.
        if (!leadId || !numnota || !documento) {
            const missing = ["ID do Lead", "Número da Nota", "Documento"].filter((v, i) => ![leadId, numnota, documento][i]);
            console.error(`${missing.join(', ')} não encontrado(s).`);
            return res.status(400).send({ message: `${missing.join(', ')} não encontrado(s).` });
        }

        let primeiroNomeClienteSanitizado = 'CLIENTE'; 
        if (nomeDoContatoParaArquivo && nomeDoContatoParaArquivo.trim() !== '') { 
            primeiroNomeClienteSanitizado = nomeDoContatoParaArquivo.toUpperCase().replace(/[^A-Z0-9À-ÖØ-ÞĀ-Ž_.-]/gi, '');
            if (!primeiroNomeClienteSanitizado) { 
                primeiroNomeClienteSanitizado = 'CLIENTE';
            }
        } else {
            console.log('Nome do contato para arquivo não encontrado, usando nome fallback "CLIENTE".');
        }
        const nomeArquivoBoleto = `BOLETO_${primeiroNomeClienteSanitizado}.pdf`;
        console.log(`Nome do arquivo do boleto definido como: ${nomeArquivoBoleto}`);

        // Etapa 2: Chamar API de Boletos
        console.log(`Chamando API de boletos para numnota=${numnota}, documento=${documento}`);
        const boletoApiUrl = `http://vpn.sost.com.br:8000/api/boleto/${numnota}/${documento}`;
        const boletoResponse = await axios.get(boletoApiUrl, {
            headers: { 'X-API-KEY': X_API_KEY_BOLETO }, responseType: 'arraybuffer'
        });
        const pdfData = boletoResponse.data;
        const tamanhoArquivoBoleto = pdfData.length;
        console.log(`PDF do boleto recebido (${tamanhoArquivoBoleto} bytes).`);

        // Etapa 3: Upload do PDF para Kommo Drive
        const driveUrl = await getKommoDriveUrl();
        console.log('Criando sessão de upload na Kommo...');
        const sessionUrl = `${driveUrl}/v1.0/sessions`;
        const sessionPayload = {
            file_name: nomeArquivoBoleto, 
            file_size: tamanhoArquivoBoleto,
            content_type: 'application/pdf', conflict_resolution: { policy: "autorename" }
        };
        const sessionResponse = await axios.post(sessionUrl, sessionPayload, {
            headers: { 'Authorization': `Bearer ${KOMMO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const kommoUploadUrl = sessionResponse.data.upload_url;
        let finalFileUuid, finalVersionUuid; 
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
        console.log('Resposta do upload dos BYTES - Data:', JSON.stringify(fileDataUploadResponse.data, null, 2));
        
        if (fileDataUploadResponse.data && fileDataUploadResponse.data.uuid && fileDataUploadResponse.data.version_uuid) {
            finalFileUuid = fileDataUploadResponse.data.uuid;
            finalVersionUuid = fileDataUploadResponse.data.version_uuid;
            console.log(`UUIDs FINAIS obtidos da resposta do upload: File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid}`);
        } else {
            console.error('Não foi possível obter os UUIDs finais da resposta do upload dos bytes. Tentando fallback do JWT da upload_url...');
            if (kommoUploadUrl) {
                const jwtStringFallback = kommoUploadUrl.substring(kommoUploadUrl.lastIndexOf('/') + 1);
                const jwtPayloadFallback = decodeJwtPayload(jwtStringFallback);
                if (jwtPayloadFallback) {
                    if (jwtPayloadFallback.content_id) finalFileUuid = jwtPayloadFallback.content_id;
                    if (jwtPayloadFallback.node_id) finalVersionUuid = jwtPayloadFallback.node_id;
                     console.log(`Usando UUIDs de FALLBACK do JWT da Upload URL: File UUID: ${finalFileUuid}, Version UUID: ${finalVersionUuid}`);
                }
            }
            if (!finalFileUuid || !finalVersionUuid) {
                throw new Error('Falha ao obter UUIDs finais do arquivo após upload para o Drive.');
            }
        }
        console.log('PDF enviado com sucesso para a Kommo Drive e UUIDs finais obtidos.');

        // ETAPA 4 (COMBINADA):
        let customFieldUpdated = false;
        try {
            console.log(`Tentando ATUALIZAR CAMPO PERSONALIZADO do lead ${leadId} (ID: ${FIELD_ID_DO_CAMPO_PDF_NA_KOMMO})`);
            const updateLeadUrl = `https://${KOMMO_SUBDOMAIN}.kommo.com/api/v4/leads/${leadId}`;
            const updatePayload = {
                custom_fields_values: [{
                    field_id: FIELD_ID_DO_CAMPO_PDF_NA_KOMMO,
                    values: [{ "value": { 
                        "file_uuid": finalFileUuid, 
                        "version_uuid": finalVersionUuid,
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
                    throw new Error('Falha ao confirmar a criação da nota com anexo, resposta inesperada ou status de erro da API.');
                 }
            }
        } catch (noteError) {
            console.error('Erro ao tentar criar nota de anexo:', noteError.message);
            if (noteError.response) {
                console.error('Detalhes do Erro da Nota (axios):', JSON.stringify(noteError.response.data, null, 2));
            }
        }

        let finalMessage = "Processamento do Webhook finalizado. ";
        let responseStatus = 200;
        if (customFieldUpdated) finalMessage += `Campo personalizado preenchido com ${nomeArquivoBoleto}. `;
        else finalMessage += "Falha ao preencher campo personalizado. ";
        if (noteCreated) finalMessage += `Nota de anexo (${nomeArquivoBoleto}) criada. `;
        else finalMessage += "Falha ao criar nota de anexo. ";
        if (!customFieldUpdated && !noteCreated && leadId) { 
             finalMessage = `Upload do ${nomeArquivoBoleto} para Kommo Drive bem-sucedido, mas falha ao vincular ao lead e preencher campo.`;
             responseStatus = 207; 
        } else if (!customFieldUpdated || !noteCreated) {
             responseStatus = 207; 
        }
        console.log("Mensagem final do webhook:", finalMessage);
        res.status(responseStatus).send({
            message: finalMessage, boletoFileName: nomeArquivoBoleto, 
            finalFileUuidForKommo: finalFileUuid, finalVersionUuidForKommo: finalVersionUuid,
            kommoNoteId: notaCriadaId, customFieldUpdated, noteCreated
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