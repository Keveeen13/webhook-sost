const axios = require('axios');
const config = require('../config/env');

const kommoApiClient = axios.create({
    baseURL: `https://${config.kommo.subdomain}.kommo.com/api/v4`,
    headers: {
        'Authorization': `Bearer ${config.kommo.accessToken}`,
        'Content-Type': 'application/json'
    }
});

const updateLeadTextField = async (leadId, fieldId, textValue) => {
    console.log(`Atualizando campo de texto (ID: ${fieldId}) do lead ${leadId}...`);
    const updatePayload = {
        custom_fields_values: [{
            field_id: fieldId,
            values: [{ "value": textValue }]
        }]
    };
    const response = await kommoApiClient.patch(`/leads/${leadId}`, updatePayload);
    console.log(`Campo de texto (ID: ${fieldId}) atualizado com sucesso. Status: ${response.status}`);
    return response;
};

const fetchLeadDetails = async (leadId, includeContacts = false) => {
    let queryParams = 'custom_fields_values';
    if (includeContacts) {
        queryParams += ',contacts';
    }
    const response = await kommoApiClient.get(`/leads/${leadId}?with=${queryParams}`);
    console.log(`Detalhes do Lead (ID: ${leadId}, includeContacts: ${includeContacts}) obtidos da Kommo.`);
    return response.data;
};

const fetchContactDetails = async (contactId) => {
    console.log(`Buscando detalhes do contato ID: ${contactId}...`);
    const response = await kommoApiClient.get(`/contacts/${contactId}`);
    console.log(`Detalhes do Contato (ID: ${contactId}) obtidos com sucesso.`);
    return response.data;
};

const getKommoDriveUrl = async () => {
    console.log('Buscando Drive URL da conta Kommo...');
    const response = await kommoApiClient.get('/account?with=drive_url');
    if (response.data && response.data.drive_url) {
        console.log('Drive URL obtido:', response.data.drive_url);
        return response.data.drive_url;
    }
    throw new Error('Drive URL não encontrado na resposta da API da conta Kommo.');
};

const createUploadSession = async (driveUrl, fileDetails) => {
    console.log('Criando sessão de upload na Kommo...');
    const sessionUrl = `${driveUrl}/v1.0/sessions`;
    const sessionPayload = {
        file_name: fileDetails.fileName,
        file_size: fileDetails.fileSize,
        content_type: 'application/pdf',
        conflict_resolution: { policy: "autorename" }
    };
    const response = await axios.post(sessionUrl, sessionPayload, {
        headers: { 'Authorization': `Bearer ${config.kommo.accessToken}`, 'Content-Type': 'application/json' }
    });
    return response.data.upload_url;
};

const uploadFileToSession = async (uploadUrl, pdfData) => {
    console.log(`Fazendo upload do PDF para Kommo Drive...`);
    const fileSize = pdfData.length;
    const response = await axios.post(uploadUrl, pdfData, {
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize,
            'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`
        }
    });
    console.log('Upload dos BYTES para Kommo Drive - Status:', response.status);
    return response.data; // Retorna o corpo da resposta com os UUIDs finais
};

const updateLeadCustomField = async (leadId, fileDetails) => {
    console.log(`Atualizando CAMPO PERSONALIZADO do lead ${leadId} (ID Campo: ${config.kommo.fieldIds.pdfBoleto})`);
    const updatePayload = {
        custom_fields_values: [{
            field_id: config.kommo.fieldIds.pdfBoleto,
            values: [{ "value": { 
                "file_uuid": fileDetails.fileUuid, 
                "version_uuid": fileDetails.versionUuid,
                "file_name": fileDetails.fileName, 
                "file_size": fileDetails.fileSize
            }}]
        }]
    };
    const response = await kommoApiClient.patch(`/leads/${leadId}`, updatePayload);
    console.log(`Campo personalizado atualizado. Status: ${response.status}`);
    return response;
};

const createAttachmentNote = async (leadId, fileDetails) => {
    console.log(`Criando NOTA de anexo no lead ${leadId}...`);
    const notePayload = [{
        "note_type": "attachment",
        "params": { 
            "file_uuid": fileDetails.fileUuid, 
            "file_name": fileDetails.fileName, 
            "version_uuid": fileDetails.versionUuid 
        }
    }];
    const response = await kommoApiClient.post(`/leads/${leadId}/notes`, notePayload);
    console.log('Criação da nota - Status:', response.status); 
    
    let noteId = null;
    if (response.data?._embedded?.notes?.[0]) {
        noteId = response.data._embedded.notes[0].id;
    } else if (Array.isArray(response.data) && response.data.length > 0 && response.data[0].id) {
        noteId = response.data[0].id;
    }
    if (noteId) console.log(`Nota de anexo criada (ID Nota: ${noteId}).`);
    return { response, noteId };
};

const clearKommoFileField = async (leadId) => {
    console.log(`Limpando o campo personalizado (ID: ${config.kommo.fieldIds.pdfBoleto}) do lead ${leadId}...`);
    const clearPayload = {
        custom_fields_values: [{
            field_id: config.kommo.fieldIds.pdfBoleto,
            values: [{ "value": null }]
        }]
    };
    const response = await kommoApiClient.patch(`/leads/${leadId}`, clearPayload);
    console.log(`Campo personalizado do lead ${leadId} limpo. Status: ${response.status}`);
    return response;
};

module.exports = {
    updateLeadTextField,
    fetchLeadDetails,
    fetchContactDetails,
    getKommoDriveUrl,
    createUploadSession,
    uploadFileToSession,
    updateLeadCustomField,
    createAttachmentNote,
    clearKommoFileField
};