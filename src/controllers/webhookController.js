const kommoService = require('../services/kommoApiService');
const sostService = require('../services/sostApiService');
const config = require('../config/env');

const formatParcelasList = (parcelas) => {
    // Ordena em ordem crescente
    const sorted = parcelas.sort((a, b) => a - b);
    
    if (sorted.length === 1) {
        return `${sorted[0]} vez`;
    }
    
    if (sorted.length === 2) {
        return `${sorted[0]} ou ${sorted[1]} vezes`;
    }
    
    // 3 ou mais: "X, Y ou Z vezes"
    const allButLast = sorted.slice(0, -1).join(', ');
    const last = sorted[sorted.length - 1];
    return `${allButLast} ou ${last} vezes`;
};

const handleAnnounceInstallments = async (req, res) => {
    console.log('--- Webhook ANUNCIAR PARCELAS Recebido ---');
    let leadId;
    
    try {
        leadId = req.body?.leads?.status?.[0]?.id;
        if (!leadId) {
            return res.status(400).send({ message: "ID do Lead não encontrado." });
        }
        console.log(`Lead ID extraído: ${leadId}`);

        const leadDetails = await kommoService.fetchLeadDetails(leadId);
        const numnota = leadDetails.custom_fields_values?.find(f => f.field_id === config.kommo.fieldIds.numNota)?.values?.[0]?.value;
        const documento = leadDetails.custom_fields_values?.find(f => f.field_id === config.kommo.fieldIds.documento)?.values?.[0]?.value;
        
        if (!numnota || !documento) {
            const errorMessage = 'Não foi possível encontrar o Número da Nota Fiscal ou o Documento nos campos do lead para consultar as parcelas. Por favor, verifique os dados.';
            console.error(`Para o lead ${leadId}: ${errorMessage}`);
            await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, errorMessage);
            return res.status(400).send({ message: "Numnota ou Documento não encontrados." });
        }

        let parcelas;
        try {
            parcelas = await sostService.getParcelas(numnota, documento);
        } catch (apiError) {
             if (apiError.response && apiError.response.status === 404) {
                console.warn('API da SOST: Nota/Documento não encontrado (404) ao buscar parcelas.');
                await kommoService.clearKommoFileField(leadId);
                const errorMessage = 'Não foi possível encontrar a nota fiscal ou documento para consultar as parcelas. O campo de anexo foi limpo.';
                await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, errorMessage);
                return res.status(200).send({ message: `Nota/Documento não encontrado. Campo de arquivo limpo.` });
            }
            throw apiError; // Relança outros erros
        }
        
        if (!parcelas || parcelas.length === 0) {
            console.log('Nenhuma parcela encontrada para a nota/documento.');
            await kommoService.clearKommoFileField(leadId);
            const messageToSend = 'Não encontramos parcelas disponíveis para este boleto. O campo de anexo foi limpo.';
            await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, messageToSend);
            return res.status(200).send({ message: 'Nenhuma parcela encontrada. Campo limpo e lead notificado.' });
        }
        
        if (parcelas.length === 1) {
            const unicaParcela = parcelas[0];
            console.log(`Apenas uma parcela (${unicaParcela}) encontrada. Preenchendo campo automaticamente.`);
            await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.parcela, unicaParcela);
            const message = `Verificamos que há apenas uma parcela (${unicaParcela}) disponível para seu boleto. Já estamos processando e o enviaremos em breve.`;
            await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, message);
            return res.status(200).send({ message: 'Apenas uma parcela encontrada. Campo preenchido e lead notificado.' });
        }

        const parcelasDisponiveis = formatParcelasList(parcelas);
        const messageToSend = `Olá! As parcelas disponíveis para este boleto são: ${parcelasDisponiveis}. Por favor, informe em quantas parcelas você deseja dividir.`;
        
        await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, messageToSend);
        res.status(200).send({ message: 'Mensagem com opções de parcelas salva no campo do lead para o bot.' });

    } catch (error) {
        console.error('Erro no webhook de anunciar parcelas:', error.message);
        if (leadId) {
            try { 
                const errorMessage = 'Ocorreu um erro interno ao tentar consultar suas parcelas. Nossa equipe já foi notificada.';
                await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, errorMessage);
            }
            catch (e) { console.error('Falha ao salvar mensagem de erro no campo do lead.'); }
        }
        res.status(500).send({ message: 'Erro ao processar webhook de anunciar parcelas.', error: error.message });
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
             const errorMessage = `Não foi possível gerar o boleto. O(s) campo(s) "${missing.join(', ')}" não está(ão) preenchido(s).`;
             console.error(`Erro para o lead ${leadId}: ${errorMessage}`);
             await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, errorMessage);
             return res.status(400).send({ message: `Campos necessários (${missing.join(', ')}) não encontrados.` });
        }
        
        const pdfData = await sostService.getBoleto(numnota, documento, parcela);
        const tamanhoArquivoBoleto = pdfData.length;

        let nomeDoContatoParaArquivo = null;
        if (leadDetails._embedded?.contacts?.[0]?.id) {
            const contactDetails = await kommoService.fetchContactDetails(leadDetails._embedded.contacts[0].id);
            nomeDoContatoParaArquivo = contactDetails.first_name || contactDetails.name?.split(' ')[0];
        }
        let primeiroNomeClienteSanitizado = (nomeDoContatoParaArquivo || 'CLIENTE').toUpperCase().replace(/[^A-Z0-9À-ÖØ-ÞĀ-Ž_.-]/gi, '') || 'CLIENTE';
        const nomeArquivoBoleto = `BOLETO_${primeiroNomeClienteSanitizado}_PARCELA_${parcela}.pdf`;
        console.log(`PDF do boleto recebido. Nome definido como: ${nomeArquivoBoleto}`);
        
        const driveUrl = await kommoService.getKommoDriveUrl();
        const uploadUrl = await kommoService.createUploadSession(driveUrl, { fileName: nomeArquivoBoleto, fileSize: tamanhoArquivoBoleto });
        const uploadResponseData = await kommoService.uploadFileToSession(uploadUrl, pdfData);

        const finalFileUuid = uploadResponseData?.uuid;
        const finalVersionUuid = uploadResponseData?.version_uuid;
        if (!finalFileUuid || !finalVersionUuid) {
            throw new Error('Falha crítica: UUIDs finais do arquivo não puderam ser determinados após upload.');
        }
        console.log(`PDF upado para Kommo Drive. UUIDs finais obtidos.`);
        
        const fileDetails = {
            fileUuid: finalFileUuid, versionUuid: finalVersionUuid,
            fileName: nomeArquivoBoleto, fileSize: tamanhoArquivoBoleto
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
            try { 
                const errorMessage = 'Ocorreu um erro interno ao tentar gerar seu boleto. Nossa equipe já foi notificada.';
                await kommoService.updateLeadSimpleField(leadId, config.kommo.fieldIds.mensagemBot, errorMessage);
            }
            catch (e) { console.error('Falha ao enviar mensagem de erro para o lead.'); }
        }
        const errorStatus = error.response?.status || 500;
        res.status(errorStatus).send({ message: 'Erro ao processar webhook de gerar boleto.', error: error.message });
    }
};

module.exports = {
    handleAnnounceInstallments,
    handleGenerateBoleto
};