require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

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
        const parcelasRes = await axios.get(`http://vpn.sost.com.br:8000/api/parcelas/${cnpj}/${tipos[resposta]}`, {
            headers: { 'X-API-KEY': config.sostKey }
        });

        const lista = parcelasRes.data.dados || [];
        
        // Se a API retornar sucesso mas lista vazia, tratamos como não encontrado
        if (lista.length === 0) throw { response: { status: 404 } };

        let msgLista = `*Selecione o boleto desejado:*\n`;
        lista.slice(0, 10).forEach((b, i) => {
            msgLista += `[${i + 1}] Boleto ${i + 1} - [Nota ${b.numnota}] - ${formatDate(b.datavencimento)} - ${formatCurrency(b.valor)} - ${b.prest} parcela\n`;
        });
        msgLista += `[${lista.length + 1}] Todos`;

        await updateLead(leadId, [
            { field_id: config.fields.listaDetalhada, values: [{ value: msgLista }] },
            { field_id: config.fields.dadosTemporarios, values: [{ value: JSON.stringify(lista) }] },
            { field_id: config.fields.escolhaBoleto, values: [{ value: "" }] },
            { field_id: config.fields.boletoNaoEncontrado, values: [{ value: false }] } // Desliga o erro se achar
        ]);
        console.log("-> Lista Detalhada enviada.");
        return true;

    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(`⚠️ 404: Boletos não encontrados para o CNPJ ${cnpj}. Ativando interruptor...`);
            await updateLead(leadId, [
                { field_id: config.fields.boletoNaoEncontrado, values: [{ value: true }] }
            ]);
            return false;
        }
        console.error("Erro na busca da lista:", error.message);
        throw error;
    }
}

// --- LÓGICA DO WEBHOOK ---
app.post('/webhook-boletos', async (req, res) => {
    res.status(200).send("Monitoramento iniciado");
    try {
        console.log('\n--- 🛰️ Webhook Acionado ---');
        await sleep(1500);

        const leads = req.body.leads;
        const leadData = leads.add || leads.update || leads.status;
        const leadId = leadData ? leadData[0].id : null;

        if (!leadId) return res.status(400).send("ID ausente");

        let tentativas = 0;
        const maxTentativas = 30;

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

            console.log(`Tentativa ${tentativas + 1}: Lead: ${leadId} | CNPJ: ${cnpj ? 'OK' : 'Vazio'} | Resposta: ${resposta || 'Vazio'} | Escolha: ${escolha || 'Vazio'}`);

            // FASE 1: Gerar Lista
            if (cnpj && resposta && (!dadosTemp || dadosTemp === "") && ["1","2","3"].includes(resposta.toString())) {
                await gerarListaDetalhada(leadId, cnpj, resposta);
            }

            // FASE 2: Processar Escolha e Upload
            if (cnpj && dadosTemp && escolha && escolha !== "") {
                    const lista = JSON.parse(dadosTemp);
                    const escolhaNum = parseInt(escolha);
                    const selecionados = (escolhaNum === lista.length + 1) ? lista.slice(0, 5) : [lista[escolhaNum - 1]];

                    if (selecionados[0]) {
                        for (let i = 0; i < selecionados.length; i++) {
                            await uploadBoletoToKommo(leadId, selecionados[i], config.fields.boletos[i], cnpj);
                        }
                        // Se chegou aqui, terminou com sucesso. Limpa e sai do loop.
                        await updateLead(leadId, [
                            { field_id: config.fields.escolhaBoleto, values: [{ value: "" }] },
                            { field_id: config.fields.dadosTemporarios, values: [{ value: "" }] }
                        ]);
                        console.log("✅ Ciclo finalizado com sucesso.");
                        return; 
                    }
                }
            } catch (innerError) {
                // Se der erro em uma tentativa (ex: instabilidade na API), ele cai aqui e continua o loop
                console.error(`⚠️ Erro na tentativa ${tentativas + 1}:`, innerError.message);
            }

            tentativas++;
            await sleep(10000);
        }
        console.log("-> Monitoramento encerrado por tempo limite (Timeout).");
    } catch (err) {
        console.error("Erro no Webhook:", err.message);
    }
});

app.listen(port, () => console.log(`🚀 API rodando na portaa ${port}`));