require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const config = {
    subdomain: process.env.KOMMO_SUBDOMAIN,
    token: process.env.KOMMO_ACCESS_TOKEN,
    sostKey: process.env.X_API_KEY_BOLETO,
    fields: {
        cnpj: parseInt(process.env.ID_CAMPO_CNPJ),
        menuBot: parseInt(process.env.ID_CAMPO_MENU_BOT),
        listaDetalhada: parseInt(process.env.ID_CAMPO_LISTA_DETALHADA),
        respostaCliente: parseInt(process.env.ID_CAMPO_RESPOSTA_CLIENTE),
        escolhaBoleto: parseInt(process.env.ID_CAMPO_ESCOLHA_BOLETO),
        dadosTemporarios: parseInt(process.env.ID_CAMPO_DADOS_TEMPORARIOS),
        erroBoleto: parseInt(process.env.ID_CAMPO_ERRO_BOLETO),
        boletoNaoEncontrado: parseInt(process.env.ID_CAMPO_BOLETO_NAO_ENCONTRADO),
        outroBoleto: parseInt(process.env.ID_CAMPO_OUTRO_BOLETO),
        numeroNotaFiscal: parseInt(process.env.ID_CAMPO_NUMERO_NOTA_FISCAL),
        boletos: [
            parseInt(process.env.ID_CAMPO_BOLETO_1),
            parseInt(process.env.ID_CAMPO_BOLETO_2),
            parseInt(process.env.ID_CAMPO_BOLETO_3),
            parseInt(process.env.ID_CAMPO_BOLETO_4),
            parseInt(process.env.ID_CAMPO_BOLETO_5)
        ]
    }
};

// --- UTILITÁRIOS ---
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(val) || 0);
const formatDate = (dateStr) => dateStr ? new Date(dateStr.split(' ')[0]).toLocaleDateString('pt-BR') : 'N/A';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function updateLead(leadId, fields) {
    const url = `https://${config.subdomain}.kommo.com/api/v4/leads/${leadId}`;
    await axios.patch(url, { custom_fields_values: fields }, {
        headers: { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' }
    });
}

async function uploadBoletoToKommo(leadId, boleto, fieldId, cnpj) {
    try {
        console.log(`--- Iniciando Processo (Drive-C) para Nota: ${boleto.numnota} ---`);
        const driveUrl = "https://drive-c.kommo.com";

        // 1. BUSCAR O PDF NA SOST
        const sostResponse = await axios.get(`http://vpn.sost.com.br:8000/api/boleto/${boleto.numnota}/${cnpj}/${boleto.prest}`, {
            headers: { 'X-API-KEY': config.sostKey },
            responseType: 'arraybuffer' 
        });

        // Detecção de erro binário (JSON dentro do Buffer)
        if (sostResponse.data[0] === 123) throw new Error("ERRO_SOST_BARCODE");

        const pdfBuffer = sostResponse.data;
        
        // 2. Drive e Sessão
        const fileName = `boleto_nota_${boleto.numnota}.pdf`;
        const sessionRes = await axios.post(`${driveUrl}/v1.0/sessions`, {
            file_name: fileName, file_size: pdfBuffer.length, content_type: 'application/pdf'
        }, { headers: { 'Authorization': `Bearer ${config.token}` } });

        const uploadRes = await axios.post(sessionRes.data.upload_url, pdfBuffer, {
            headers: { 'Content-Type': 'application/pdf' }
        });

        // 3. Vincular ao campo do Lead (Estrutura Completa)
        await updateLead(leadId, [{
            field_id: fieldId,
            values: [{ value: { file_uuid: uploadRes.data.uuid, version_uuid: uploadRes.data.version_uuid, file_name: fileName } }]
        }]);

        // Se deu certo, desativa o interruptor de "Boleto não encontrado"
        await updateLead(leadId, [{ field_id: config.fields.boletoNaoEncontrado, values: [{ value: false }] }]);

        console.log(`✅ Sucesso: Nota ${boleto.numnota} anexada.`);
        return true;

    } catch (error) {
        console.error("### ERRO NO FLUXO DE UPLOAD ###");
        
        // TRATAMENTO ESPECÍFICO PARA 404 (Boleto não encontrado)
        if (error.response && error.response.status === 404) {
            console.log(`⚠️ 404 Detectado para Nota ${boleto.numnota}. Ativando interruptor...`);
            await updateLead(leadId, [{ field_id: config.fields.boletoNaoEncontrado, values: [{ value: true }] }]);
            return false;
        }

        // Tratamento para erro de Barcode (JSON binário)
        let errorBody = error.response?.data ? Buffer.from(error.response.data).toString() : error.message;
        if (errorBody.includes("Barcode") || error.message === "ERRO_SOST_BARCODE") {
            console.log(`⚠️ Falha de código de barras. Ativando interruptor de erro...`);
            await updateLead(leadId, [{ field_id: config.fields.erroBoleto, values: [{ value: true }] }]);
        }
        
        return false;
    }
}

async function gerarListaDetalhada(leadId, cnpj, resposta) {
    try {
        console.log(`-> Buscando boletos para tipo ${resposta}...`);
        const tipos = { "1": "a_vencer", "2": "vencidos", "3": "todos" };
        
        // Valida se a resposta é um tipo válido
        if (!tipos[resposta?.toString()]) {
            console.log(`⚠️ Resposta inválida: ${resposta}. Encerrando...`);
            throw { response: { status: 400 } };
        }
        
        const parcelasRes = await axios.get(`http://vpn.sost.com.br:8000/api/parcelas/${cnpj}/${tipos[resposta]}`, {
            headers: { 'X-API-KEY': config.sostKey }
        });

        const lista = parcelasRes.data.dados || [];
        
        if (lista.length === 0) throw { response: { status: 404 } };

        // Ordena a lista por data de vencimento (mais próximo primeiro)
        lista.sort((a, b) => {
            const da = a?.datavencimento ? new Date(a.datavencimento.split(' ')[0]) : new Date(0);
            const db = b?.datavencimento ? new Date(b.datavencimento.split(' ')[0]) : new Date(0);
            return da - db;
        });

        let msgLista = `*Selecione o boleto desejado:*\n`;
        const top10 = lista.slice(0, 10);
        top10.forEach((b, i) => {
            msgLista += `[${i + 1}] Boleto ${i + 1} - [NF ${b.numnota}] - ${formatDate(b.datavencimento)} - ${formatCurrency(b.valor)} - ${b.prest} PC\n`;
        });

        // ATUALIZAÇÃO: Limpa a resposta do cliente para parar o loop de busca
        await updateLead(leadId, [
            { field_id: config.fields.listaDetalhada, values: [{ value: msgLista }] },
            { field_id: config.fields.dadosTemporarios, values: [{ value: JSON.stringify(lista) }] },
            { field_id: config.fields.respostaCliente, values: [{ value: "" }] }, 
            { field_id: config.fields.escolhaBoleto, values: [{ value: "" }] },
            { field_id: config.fields.boletoNaoEncontrado, values: [{ value: false }] }
        ]);
        console.log("-> Lista enviada e gatilho de busca limpo.");

    } catch (error) {
        if (error.response?.status === 404) {
            console.log("⚠️ 404: Nenhum boleto. Limpando gatilho e ativando aviso...");
            await updateLead(leadId, [
                { field_id: config.fields.boletoNaoEncontrado, values: [{ value: true }] },
                { field_id: config.fields.respostaCliente, values: [{ value: "" }] } // Limpa para não repetir o erro
            ]);
        }
    }
}

// --- LÓGICA DO WEBHOOK ---
app.post('/sost', async (req, res) => {
    res.status(200).send("Monitoramento iniciado");
    try {
        const leads = req.body.leads;
        const leadData = leads?.update || leads?.status || leads?.add;
        const leadId = leadData ? leadData[0].id : null;
        if (!leadId) return;

        console.log(`\n--- 🛰️ Webhook Acionado (Lead: ${leadId}) ---`);

        let tentativas = 0;
        const maxTentativas = 60; // Monitora por até 10 minutos

        while (tentativas < maxTentativas) {
            try {
                const leadRes = await axios.get(`https://${config.subdomain}.kommo.com/api/v4/leads/${leadId}`, {
                    headers: { 'Authorization': `Bearer ${config.token}` }
                });
                
                const cf = leadRes.data.custom_fields_values || [];
                const cnpj = cf.find(f => f.field_id == config.fields.cnpj)?.values[0].value;
                const resposta = cf.find(f => f.field_id == config.fields.respostaCliente)?.values[0].value;
                const escolha = cf.find(f => f.field_id == config.fields.escolhaBoleto)?.values[0].value;
                const dadosTemp = cf.find(f => f.field_id == config.fields.dadosTemporarios)?.values[0].value;
                const outro = cf.find(f => f.field_id == config.fields.outroBoleto)?.values[0].value;

                console.log(`Tentativa ${tentativas + 1}: CNPJ: ${cnpj || '...'} | Resposta: ${resposta || '...'} | Escolha: ${escolha || '...'} | Outro: ${outro || '...'}`);

                // 🛑 SAÍDA 1: Opção 0 no Menu Principal
                if (resposta?.toString() === "0") {
                    console.log("-> Encerrando por opção 0.");
                    await updateLead(leadId, [{ field_id: config.fields.respostaCliente, values: [{ value: "" }] }]);
                    return;
                }

                // 🛑 SAÍDA 2: Opção "Não" (2) ou "Cancelar" (3) no campo Outro Boleto
                if (outro?.toString() === "2" || outro?.toString() === "3") {
                    console.log("-> Encerrando: Cliente não quer mais boletos.");
                    await updateLead(leadId, [
                        { field_id: config.fields.outroBoleto, values: [{ value: "" }] },
                        { field_id: config.fields.dadosTemporarios, values: [{ value: "" }] }
                    ]);
                    return;
                }

                // 🔄 RESET: Se o cliente quer "Sim" (1), limpa para permitir nova escolha
                if (outro?.toString() === "1") {
                    console.log("-> Cliente quer outro boleto. Resetando campos de escolha...");
                    await updateLead(leadId, [
                        { field_id: config.fields.outroBoleto, values: [{ value: "" }] },
                        { field_id: config.fields.escolhaBoleto, values: [{ value: "" }] }
                    ]);
                    // O loop continua e o bot (lado Kommo) deve mostrar a lista novamente
                }

                // FASE 1: Gerar lista inicial
                if (cnpj && ["1","2","3"].includes(resposta?.toString()) && (!dadosTemp || dadosTemp === "")) {
                    console.log(`-> Gatilho detectado para tipo ${resposta}. Iniciando busca única...`);
                    
                    // Opcional: Limpa o campo resposta NO CRM antes mesmo de terminar a busca 
                    // para evitar que outra tentativa do loop entre aqui.
                    await updateLead(leadId, [{ field_id: config.fields.respostaCliente, values: [{ value: "PROCESSANDO..." }] }]);
                    
                    await gerarListaDetalhada(leadId, cnpj, resposta);
                    continue; // Pula para a próxima iteração do loop para ler os novos dados
                }

                // FASE 2: Processar escolha e enviar (Sempre no mesmo campo)
                if (cnpj && dadosTemp && escolha && escolha !== "") {
                    // SEGURANÇA CONTRA ERRO DE JSON (image_742455.png)
                    if (typeof dadosTemp === 'string' && !dadosTemp.startsWith('[')) {
                        console.log("⚠️ JSON corrompido detectado no campo Dados Temporários. Limpando...");
                        await updateLead(leadId, [{ field_id: config.fields.dadosTemporarios, values: [{ value: "" }] }]);
                        tentativas++;
                        continue;
                    }

                    const lista = JSON.parse(dadosTemp);
                    const index = parseInt(escolha) - 1;
                    const boleto = lista[index];

                    if (boleto) {
                        console.log(`-> Enviando boleto da Nota ${boleto.numnota}...`);
                        await uploadBoletoToKommo(leadId, boleto, config.fields.boletos[0], cnpj);
                        
                        // Salva o número da nota fiscal e limpa a escolha
                        await updateLead(leadId, [
                            { field_id: config.fields.numeroNotaFiscal, values: [{ value: boleto.numnota }] },
                            { field_id: config.fields.escolhaBoleto, values: [{ value: "" }] }
                        ]);
                        console.log("✅ Boleto enviado. Número da nota fiscal salvo. Aguardando decisão 'Outro Boleto'...");
                    }
                }

            } catch (innerError) { // <--- CATCH INTERNO: Mantém o loop vivo
                console.error(`Erro na verificação: ${innerError.message}`);
            }

            tentativas++;
            await sleep(10000); 
        }
    } catch (err) { // <--- CATCH EXTERNO: Falha crítica total
        console.error("Erro crítico:", err.message);
    }
});

app.listen(port, () => console.log(`🚀 API rodando na portaa ${port}`));