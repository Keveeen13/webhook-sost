const kommoService = require('../services/kommoApiService');
const sostService = require('../services/sostApiService');
const config = require('../config/env');

const handleAnnounceInstallments = async (req, res) => {
    console.log('--- Webhook MOSTRAR PARCELAS Recebido ---');
    let leadId;

    try {
        leadId = req.body?.leads?.status?.[0]?.id;
        if (!leadId) {
            return res.status(400).send({ message: "ID do lead não encontrado." });
        }
        console.log(`Lead ID extraído: ${leadId}`);

        const leadDetails = await kommoService.fetchLeadDetails(leadId);
        const numnota = leadDetails.custom_fields_values?.find(f => f.field_id === config.kommo.fieldIds.numNota)?.values?.[0]?.value;
        const documento = leadDetails.custom_fields_values?.find(f => f.field_id === config.kommo.fieldIds.documento)?.values?.[0]?.value;


        if (!numnota || !documento) {
            console.error(`Número da Nota ou do Documento não encontrados para o lead ${leadId}.`);
            await kommoService.sendMessageToLead(leadId, 'Não foi possível encontrar o Número da Nota Fiscal ou o Documento nos campos do lead para consultar as parcelas. Por favor, verifique os dados.');
            return res.status(400).send({ message: "Numnota ou Documento não encontrados." });
        }
 
        const parcelas = await sostService.getParcelas(numnota, documento);

        if (!parcelas || parcelas.length === 0) {
            console.log('Nenhuma parcela encontrada para a nota.');
            await kommoService.sendMessageToLead(leadId, 'Não encontramos parcelas disponíveis para este boleto. Por favor, entre em contato com o suporte.');
            return res.status(200).send({ message: 'Nenhuma parcela encontrada.' });
        }

        const maxParcelas = Math.max(...parcelas);
        const message = `Olá! Seu boleto pode ser dividido em até ${maxParcelas} vezes. Por favor, informe em quantas parcelas você deseja.`;

        await kommoService.sendMessageToLead(leadId, message);

        res.status(200).send({ message: 'Mensagem com número de parcelas enviada ao lead.' });
    } catch (error) {
        console.error('Erro no webhook de anunciar parcelas:', error.message);
        if (leadId) {
            try { await kommoService.sendMessageToLead(leadId, 'Ocorreu um erro interno ao tentar consultar suas parcelas. Nossa equipe já foi notificada.'); }
            catch (e) { console.error('Falha ao enviar mensagem de erro para o lead.'); }
        }
        const errorStatus = error.response?.status || 500;
        const errorDetails = error.response?.data || null;
        res.status(errorStatus).send({ message: 'Erro ao processar webhook de anunciar parcelas.', error: error.message, errorDetails });
    }
};

const handleGenerateBoleto = async (req, res) => {
    console.log('--- Webhook GERAR BOLETO Recebido ---');
    let leadId;

    try {
        leadId = req.body?.leads?.status?.[0]?.id;
        if (!leadId) {
            return res.status(400).send({ message: "ID do Lead não encontrado." });
        }
        console.log(`Lead ID extraído: ${leadId}`);

        const leadDetails = await kommoService.fetchLeadDetails(leadId, true);
        const customFields = leadDetails.custom_fields_values || [];
        const numnota = customFields.find(f => f.field_id === config.kommo.fieldIds.numNota)?.values?.[0]?.value;
        const documento = customFields.find(f => f.field_id === config.kommo.fieldIds.documento)?.values?.[0]?.value;
        const parcela = customFields.find(f => f.field_id === config.kommo.fieldIds.parcela)?.values?.[0]?.value;

        if (!numnota || !documento || !parcela) {
             const missing = ["Numnota", "Documento", "Parcela"].filter((v, i) => ![numnota, documento, parcela][i]);
             await kommoService.sendMessageToLead(leadId, `Não foi possível gerar o boleto. O(s) campo(s) "${missing.join(', ')}" não está(ão) preenchido(s).`);
             return res.status(400).send({ message: `Campos necessários (${missing.join(', ')}) não encontrados.` });
        }

        const pdfData = await sostService.getBoleto(numnota, documento, parcela);

        let nomeDoContatoParaArquivo = null;
        if (leadDetails._embedded?.contacts?.[0]?.id) {
            const contactDetails = await kommoService.fetchContactDetails(leadDetails._embedded.contacts[0].id);
            nomeDoContatoParaArquivo = contactDetails.first_name || contactDetails.name?.split(' ')[0];
        }
        let primeiroNomeClienteSanitizado = (nomeDoContatoParaArquivo || 'CLIENTE').toUpperCase().replace(/[^A-Z0-9À-ÖØ-ÞĀ-Ž_.-]/gi, '') || 'CLIENTE';
        const nomeArquivoBoleto = `BOLETO_${primeiroNomeClienteSanitizado}_PARCELA_${parcela}.pdf`;
        console.log(`PDF do boleto recebido. Nome definido como: ${nomeArquivoBoleto}`);
        
        const driveUrl = await kommoService.getKommoDriveUrl();
        const uploadUrl = await kommoService.createUploadSession(driveUrl, { fileName: nomeArquivoBoleto, fileSize: pdfData.length });
        const uploadResponseData = await kommoService.uploadFileToSession(uploadUrl, pdfData);

        const finalFileUuid = uploadResponseData?.uuid;
        const finalVersionUuid = uploadResponseData?.version_uuid;
        if (!finalFileUuid || !finalVersionUuid) {
            throw new Error('Falha crítica: UUIDs finais do arquivo não puderam ser determinados após upload.');
        }
        console.log(`PDF upado para Kommo Drive. UUIDs finais obtidos.`);
        
        const fileDetails = {
            fileUuid: finalFileUuid,
            versionUuid: finalVersionUuid,
            fileName: nomeArquivoBoleto,
            fileSize: pdfData.length
        };

        const [customFieldResult, noteResult] = await Promise.allSettled([
            kommoService.updateLeadCustomField(leadId, fileDetails),
            kommoService.createAttachmentNote(leadId, fileDetails)
        ]);

        const customFieldUpdated = customFieldResult.status === 'fulfilled';
        const noteCreated = noteResult.status === 'fulfilled';
        if (!customFieldUpdated) console.error("Falha ao atualizar campo personalizado:", customFieldResult.reason?.message);
        if (!noteCreated) console.error("Falha ao criar nota de anexo:", noteResult.reason?.message);
        
        const finalMessage = `Webhook processado. Campo: ${customFieldUpdated ? 'OK' : 'FALHOU'}. Nota: ${noteCreated ? 'OK' : 'FALHOU'}.`;
        res.status(200).send({ message: finalMessage, boletoFileName: nomeArquivoBoleto });

    } catch (error) {
        console.error('Erro no webhook de gerar boleto:', error.message);
        if (leadId) {
            try { await kommoService.sendMessageToLead(leadId, 'Ocorreu um erro interno ao tentar gerar seu boleto. Nossa equipe já foi notificada.'); }
            catch (e) { console.error('Falha ao enviar mensagem de erro para o lead.'); }
        }
        const errorStatus = error.response?.status || 500;
        const errorDetails = error.response?.data || null;
        res.status(errorStatus).send({ message: 'Erro ao processar webhook de gerar boleto.', error: error.message, errorDetails });
    }
};

module.exports = {
    handleAnnounceInstallments,
    handleGenerateBoleto
};