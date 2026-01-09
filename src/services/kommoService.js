const axios = require('axios');
const config = require('../config/kommo');

const api = axios.create({
    baseURL: `https://${config.subdomain}.kommo.com/api/v4`,
    headers: { Authorization: `Bearer ${config.token}` }
});

module.exports = {
    async getLead(leadId) {
        const res = await api.get(`/leads/${leadId}?with=custom_fields_values`);
        return res.data;
    },

    async updateFields(leadId, fields) {
        await api.patch(`/leads/${leadId}`, { custom_fields_values: fields });
    },

    async uploadFile(pdfBuffer, fileName, leadId, fieldId) {
        // Busca Drive URL
        const acc = await api.get('/account?with=drive_url');
        const driveUrl = acc.data.drive_url;

        // Sessão
        const session = await axios.post(`${driveUrl}/v1.0/sessions`, {
            file_name: fileName, file_size: pdfBuffer.length, content_type: 'application/pdf'
        }, { headers: { Authorization: `Bearer ${config.token}` } });

        // Upload
        const uploadRes = await axios.post(session.data.upload_url, pdfBuffer, {
            headers: { 
                'Content-Type': 'application/octet-stream', 
                'Content-Range': `bytes 0-${pdfBuffer.length - 1}/${pdfBuffer.length}` 
            }
        });

        const { uuid, version_uuid } = uploadRes.data;

        // Vincula ao campo
        await this.updateFields(leadId, [{
            field_id: parseInt(fieldId),
            values: [{ value: { file_uuid: uuid, version_uuid: version_uuid, file_name: fileName, file_size: pdfBuffer.length } }]
        }]);
    }
};