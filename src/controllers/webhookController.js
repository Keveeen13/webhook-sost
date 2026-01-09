const kommo = require('../services/kommoService');
const sost = require('../services/sostService');
const config = require('../config/kommo');
const { sanitizeFileName } = require('../utils/stringUtils');
const { formatDateBR, formatCurrencyBR } = require('../utils/formatters');

module.exports = {
    /**
     * Gerencia o fluxo conversacional de boletos (Chatbot)
     */
    async handleBoletoFlow(req, res) {
        try {
            // 1. Extração do ID do Lead (suporta criação ou atualização)
            const leadId = req.body.leads.add ? req.body.leads.add[0].id : req.body.leads.update[0].id;
            const lead = await kommo.getLead(leadId);
            
            const cf = lead.custom_fields_values || [];
            const cnpj = cf.find(f => f.field_id == config.fields.cnpj)?.values[0].value;
            const resposta = cf.find(f => f.field_id == config.fields.respostaCliente)?.values[0].value;
            const dadosTempRaw = cf.find(f => f.field_id == config.fields.dadosTemporarios)?.values[0].value;

            // --- ESTADO 1: Menu Inicial (Escolha do Tipo) ---
            // Se o cliente acabou de entrar na etapa ou não respondeu nada ainda
            if (!resposta && !dadosTempRaw) {
                const msg = "Menu Boletos:\n" +
                            "*[1]* - Boletos a vencer\n" +
                            "*[2]* - Boletos vencidos\n" +
                            "*[3]* - Todos os boletos";
                
                await kommo.updateFields(leadId, [
                    { field_id: parseInt(config.fields.menuBot), values: [{ value: msg }] }
                ]);
                return res.status(200).send("Menu Inicial Enviado");
            }

            // --- ESTADO 2: Lista de Parcelas (Escolha do Boleto Específico) ---
            // Se o cliente respondeu o tipo (1, 2 ou 3) mas ainda não temos a lista salva
            if (resposta && !dadosTempRaw) {
                const tipos = { "1": "a_vencer", "2": "vencidos", "3": "todos" };
                const tipoSelecionado = tipos[resposta];

                if (!tipoSelecionado) return res.status(200).send("Opção de menu inválida");

                const lista = await sost.getParcelas(cnpj, tipoSelecionado);

                if (lista.length === 0) {
                    await kommo.updateFields(leadId, [
                        { field_id: parseInt(config.fields.menuBot), values: [{ value: "Não encontramos boletos para o critério selecionado. ❌" }] },
                        { field_id: parseInt(config.fields.respostaCliente), values: [{ value: "" }] }
                    ]);
                    return res.status(200).send("Lista Vazia");
                }

                // Montagem da lista usando os Formatters
                let msgLista = "*Selecione o boleto para download:*\n\n";
                const limiteBoletos = lista.slice(0, 5);
                
                limiteBoletos.forEach((b, i) => {
                    const valorFormatado = formatCurrencyBR(b.valor);
                    const dataFormatada = formatDateBR(b.datavencimento);
                    msgLista += `*[${i + 1}]* Boleto ${i + 1} - ${valorFormatado} - Venc: ${dataFormatada}\n`;
                });

                // Adiciona opção de "Todos" se houver mais de um boleto
                if (limiteBoletos.length > 1) {
                    msgLista += `*[${limiteBoletos.length + 1}]* Enviar todos os ${limiteBoletos.length} acima`;
                }

                await kommo.updateFields(leadId, [
                    { field_id: parseInt(config.fields.menuBot), values: [{ value: msgLista }] },
                    { field_id: parseInt(config.fields.dadosTemporarios), values: [{ value: JSON.stringify(lista) }] },
                    { field_id: parseInt(config.fields.respostaCliente), values: [{ value: "" }] } // Limpa para próxima interação
                ]);
                return res.status(200).send("Lista de Boletos Enviada");
            }

            // --- ESTADO 3: Geração e Envio dos Arquivos (Finalização) ---
            // Se temos a lista salva e o cliente escolheu um número da lista
            if (resposta && dadosTempRaw) {
                const boletos = JSON.parse(dadosTempRaw);
                const escolha = parseInt(resposta);
                const limite = boletos.slice(0, 5);
                
                // Verifica se escolheu a opção "Todos" (último número da lista)
                const escolheuTodos = escolha === (limite.length + 1);
                const boletosParaGerar = escolheuTodos ? limite : [boletos[escolha - 1]];

                if (boletosParaGerar.length === 0 || !boletosParaGerar[0]) {
                    return res.status(200).send("Escolha de boleto inválida");
                }

                // Loop de geração e upload
                for (let i = 0; i < boletosParaGerar.length; i++) {
                    const b = boletosParaGerar[i];
                    const pdfBuffer = await sost.getBoleto(b.numnota, cnpj, b.prest);
                    
                    // Sanitiza o nome do arquivo para evitar erros de sistema
                    const nomeFinal = sanitizeFileName(`BOLETO_${b.numnota}_P${b.prest}.pdf`);
                    
                    // Faz o upload e vincula ao campo de arquivo (1 a 5) correspondente
                    await kommo.uploadFile(pdfBuffer, nomeFinal, leadId, config.fields.boletos[i]);
                }

                // Limpa o estado para que o fluxo possa ser reiniciado no futuro
                await kommo.updateFields(leadId, [
                    { field_id: parseInt(config.fields.menuBot), values: [{ value: "Perfeito! Seus boletos foram gerados com sucesso e estão disponíveis abaixo. 👇" }] },
                    { field_id: parseInt(config.fields.dadosTemporarios), values: [{ value: "" }] },
                    { field_id: parseInt(config.fields.respostaCliente), values: [{ value: "" }] }
                ]);
            }

            res.status(200).send("Fluxo Processado");
        } catch (error) {
            console.error('Erro Crítico no handleBoletoFlow:', error.message);
            res.status(500).send("Erro Interno no Servidor");
        }
    }
};