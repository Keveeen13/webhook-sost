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
        erroBoleto: parseInt(process.env.ID_CAMPO_ERRO_BOLETO), // ID do campo Interruptor/Checkbox
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
        if (sostResponse.data[0] === 123) { throw new Error("ERRO_SOST_BINARIO"); }

        const pdfBuffer = sostResponse.data;
        
        // 2. CRIAR SESSÃO NO DRIVE
        const sessionRes = await axios.post(`${driveUrl}/v1.0/sessions`, {
            file_name: `boleto_nota_${boleto.numnota}.pdf`,
            file_size: pdfBuffer.length,
            content_type: 'application/pdf'
        }, { headers: { 'Authorization': `Bearer ${config.token}` } });

        // 3. UPLOAD DO BINÁRIO - AQUI ESTAVA O ERRO (faltava o "const uploadRes")
        const uploadRes = await axios.post(sessionRes.data.upload_url, pdfBuffer, {
            headers: { 'Content-Type': 'application/pdf' }
        });

        const fileUuid = uploadRes.data.uuid;
        const versionUuid = uploadRes.data.version_uuid;

        // 4. VINCULAR AO LEAD (PATCH no custom field)
        // Enviando o objeto completo para não virar texto no WhatsApp
        await axios.patch(`https://${config.subdomain}.kommo.com/api/v4/leads/${leadId}`, {
            custom_fields_values: [{
                field_id: fieldId,
                values: [{ 
                    value: { 
                        file_uuid: fileUuid,
                        version_uuid: versionUuid,
                        file_name: `boleto_nota_${boleto.numnota}.pdf`
                    } 
                }]
            }]
        }, { headers: { 'Authorization': `Bearer ${config.token}` } });

        console.log(`✅ Sucesso: Nota ${boleto.numnota} anexada.`);

    } catch (error) {
        console.error("### ERRO NO FLUXO DE UPLOAD ###");
        
        // Captura o erro da SOST mesmo se vier como Buffer no catch
        let errorBody = "";
        if (error.response?.data) {
            errorBody = Buffer.from(error.response.data).toString();
        } else {
            errorBody = error.message;
        }

        // Se for erro de Barcode, ativa o interruptor
        if (errorBody.includes("Barcode") || errorBody.includes("getBarcode") || errorBody.includes("ERRO_SOST_BINARIO")) {
            console.log(`⚠️ Falha de código de barras para Nota ${boleto.numnota}. Ativando interruptor...`);
            await updateLead(leadId, [{ field_id: config.fields.erroBoleto, values: [{ value: true }] }]);
            console.log("✅ Interruptor de erro ativado.");
        } else {
            console.error("Erro técnico detalhado:", errorBody);
        }
    }
}

async function gerarListaDetalhada(leadId, cnpj, resposta) {
    console.log(`-> CNPJ Detectado! Buscando boletos para tipo ${resposta}...`);
    const tipos = { "1": "a_vencer", "2": "vencidos", "3": "todos" };
    const parcelasRes = await axios.get(`http://vpn.sost.com.br:8000/api/parcelas/${cnpj}/${tipos[resposta]}`, {
        headers: { 'X-API-KEY': config.sostKey }
    });

    const lista = parcelasRes.data.dados || [];
    if (lista.length === 0) {
        await updateLead(leadId, [{ field_id: config.fields.listaDetalhada, values: [{ value: "Nenhum boleto encontrado. ❌" }] }]);
        return "Sem boletos";
    }

    let msgLista = `*Selecione o boleto desejado:*\n`;
    const top10 = lista.slice(0, 10);
    top10.forEach((b, i) => {
        msgLista += `[${i + 1}] Boleto ${i + 1} - [Nota ${b.numnota}] - ${formatDate(b.datavencimento)} - ${formatCurrency(b.valor)} - ${b.prest} parcela\n`;
    });
    msgLista += `[${top10.length + 1}] Todos (Apenas os primeiros)`;

    await updateLead(leadId, [
        { field_id: config.fields.listaDetalhada, values: [{ value: msgLista }] },
        { field_id: config.fields.dadosTemporarios, values: [{ value: JSON.stringify(lista) }] },
        { field_id: config.fields.escolhaBoleto, values: [{ value: "" }] },
        { field_id: config.fields.erroBoleto, values: [{ value: false }] } // Reseta o interruptor ao iniciar nova busca
    ]);
    console.log("-> Lista Detalhada enviada.");
}

// --- LÓGICA DO WEBHOOK ---
app.post('/webhook-boletos', async (req, res) => {
    try {
        console.log('\n--- 🛰️ Webhook Acionado ---');
        await sleep(1500);

        const leads = req.body.leads;
        const leadData = leads.add || leads.update || leads.status;
        const leadId = leadData ? leadData[0].id : null;

        if (!leadId) return res.status(400).send("ID ausente");

        let tentativas = 0;
        const maxTentativas = 15;

        while (tentativas < maxTentativas) {
            const leadRes = await axios.get(`https://${config.subdomain}.kommo.com/api/v4/leads/${leadId}`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
            });
            
            const cf = leadRes.data.custom_fields_values || [];
            const cnpj = cf.find(f => f.field_id == config.fields.cnpj)?.values[0].value;
            const resposta = cf.find(f => f.field_id == config.fields.respostaCliente)?.values[0].value;
            const escolha = cf.find(f => f.field_id == config.fields.escolhaBoleto)?.values[0].value;
            const dadosTemp = cf.find(f => f.field_id == config.fields.dadosTemporarios)?.values[0].value;

            // FASE 1: Gerar Lista
            if (cnpj && resposta && (!dadosTemp || dadosTemp === "") && ["1","2","3"].includes(resposta.toString())) {
                await gerarListaDetalhada(leadId, cnpj, resposta);
            }

            // FASE 2: Processar Escolha e Upload
            if (dadosTemp && dadosTemp !== "" && escolha) {
                const lista = JSON.parse(dadosTemp);
                const top10 = lista.slice(0, 10);
                let boletosSelecionados = [];
                
                const escolhaNum = parseInt(escolha);
                if (escolhaNum === top10.length + 1) {
                    boletosSelecionados = top10.slice(0, 5);
                } else if (escolhaNum >= 1 && escolhaNum <= top10.length) {
                    boletosSelecionados = [top10[escolhaNum - 1]];
                }

                for (let i = 0; i < boletosSelecionados.length && i < 5; i++) {
                    await uploadBoletoToKommo(leadId, boletosSelecionados[i], config.fields.boletos[i], cnpj);
                }
                
                return res.status(200).send("PDFs Processados");
            }

            tentativas++;
            await sleep(10000);
        }
        res.status(200).send("Finalizado");
    } catch (err) {
        console.error("Erro no Webhook:", err.message);
        res.status(500).send("Erro");
    }
});

app.listen(port, () => console.log(`🚀 API rodando na portaa ${port}`));