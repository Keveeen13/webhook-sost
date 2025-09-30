# Webhook de Integração: Kommo e API de Boletos SOST

![Node.js](https://img.shields.io/badge/Node.js-18.x+-brightgreen?style=for-the-badge&logo=node.js)
![Express.js](https://img.shields.io/badge/Express.js-4.x-blue?style=for-the-badge&logo=express)

## 📖 Visão Geral

Este projeto é um webhook desenvolvido em **Node.js** com **Express.js**, que serve como uma ponte de automação inteligente entre a CRM **Kommo** e uma **API externa de boletos (SOST)**.

A aplicação gerencia um fluxo de trabalho interativo de duas etapas, projetado para interagir com o Salesbot da Kommo, permitindo que os clientes escolham o número de parcelas de um boleto e o recebam diretamente no seu lead.

## 🎯 O Problema Resolvido

O objetivo é automatizar o processo de cobrança que envolve parcelamento. Em vez de um vendedor consultar manualmente as parcelas, enviar as opções para o cliente e depois gerar o boleto, este webhook faz tudo isso de forma automática, acionado por movimentações no funil de vendas da Kommo.

### Fluxo de Automação

O processo é dividido em duas etapas principais:

1.  **Consulta e Apresentação das Parcelas:**
    * Um lead é movido para uma etapa do funil (ex: "Aguardando Escolha de Parcela").
    * O webhook `/api/announce-installments` é acionado.
    * O sistema lê a Nota Fiscal e o Documento do lead.
    * Ele consulta a API da SOST para ver as parcelas disponíveis.
    * **Se houver apenas uma parcela**, o sistema preenche automaticamente o campo de parcela no lead e o notifica, avançando o processo.
    * **Se houver múltiplas parcelas**, o sistema salva uma mensagem em um campo de texto do lead (ex: "Olá! As parcelas disponíveis são: 1, 2, 3...").
    * O Salesbot da Kommo detecta a mensagem, a envia para o cliente no chat e aguarda a resposta.

2.  **Geração e Entrega do Boleto:**
    * O cliente responde, o Salesbot preenche o campo "Número da Parcela" e move o lead para a próxima etapa (ex: "Gerar Boleto").
    * O webhook `/api/generate-boleto` é acionado.
    * O sistema lê a Nota Fiscal, Documento e a Parcela escolhida.
    * Ele solicita o boleto em PDF à API da SOST.
    * O arquivo é renomeado para `BOLETO_{PRIMEIRONOME_DO_CLIENTE}_PARCELA_{X}.pdf`.
    * O PDF é enviado para o Kommo Drive.
    * O sistema, então, **preenche o campo "Arquivos/Boleto"** no lead com o arquivo funcional e **cria uma nota de anexo** no histórico do lead para garantir visibilidade e acesso.

## 📁 Estrutura do Projeto

```
/
├── src/
│   ├── config/
│   │   └── env.js              # Carrega e valida as variáveis de ambiente
│   ├── controllers/
│   │   └── webhookController.js  # Orquestra o fluxo de cada webhook
│   ├── services/
│   │   ├── kommoApiService.js    # Funções para interagir com a API da Kommo
│   │   └── sostApiService.js     # Funções para interagir com a API de Boletos
│   ├── routes/
│   │   └── webhookRoutes.js      # Define as rotas dos webhooks
│   └── utils/
│       └── jwtDecoder.js         # Função auxiliar para decodificar JWT
├── .env                        # Suas chaves e IDs secretos (NÃO ENVIAR PARA O GIT)
├── .env.example                # Arquivo de exemplo para configuração
├── .gitignore                  # Arquivos a serem ignorados pelo Git
├── package.json
└── server.js                   # Ponto de entrada da aplicação
```

## 🛠️ Tecnologias Utilizadas

- **Backend:** Node.js
- **Framework:** Express.js
- **Cliente HTTP:** Axios
- **Gerenciamento de Ambiente:** Dotenv

## 🚀 Configuração do Ambiente

Siga estes passos para configurar e executar o projeto localmente.

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 18.x ou superior)
- [npm](https://www.npmjs.com/) (geralmente instalado com o Node.js)

### 2. Instalação
Clone o repositório, entre na pasta do projeto e instale as dependências.
```bash
git clone [https://seu-repositorio-github.com/seu-usuario/seu-projeto.git](https://seu-repositorio-github.com/seu-usuario/seu-projeto.git)
cd seu-projeto
npm install
```

### 3. Variáveis de Ambiente (`.env`)
Este projeto usa um arquivo `.env` para armazenar configurações sensíveis.

1.  Crie o arquivo a partir do exemplo:
    ```bash
    cp .env.example .env
    ```
2.  Abra o arquivo `.env` e preencha **todas** as variáveis com seus valores corretos.

| Variável                           | Descrição                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `KOMMO_SUBDOMAIN`                  | O subdomínio da sua conta Kommo (ex: `suaempresa`).                               |
| `KOMMO_ACCESS_TOKEN`               | Seu token de acesso de longa duração gerado na integração privada na Kommo.         |
| `X_API_KEY_BOLETO`                 | Sua chave de API para autenticar na API de boletos da SOST.                         |
| `FIELD_ID_DO_CAMPO_PDF_NA_KOMMO`   | ID numérico do campo personalizado (tipo "Arquivo") onde o PDF será inserido.       |
| `ID_CAMPO_NUMNOTA_KOMMO`           | ID do campo personalizado para o "Número da Nota Fiscal".                         |
| `ID_CAMPO_DOCUMENTO_KOMMO`         | ID do campo personalizado para o "CNPJ" ou "Documento" do cliente.                |
| `ID_CAMPO_PARCELA_KOMMO`           | ID do campo personalizado (tipo "Numérico") para o "Número da Parcela".           |
| `ID_CAMPO_MENSAGEM_BOT`            | ID do campo (tipo "Área de Texto") onde a mensagem para o bot será salva.         |
| `PORT`                             | (Opcional) A porta em que o servidor irá rodar. O padrão é `3000`.                |


## 🏃 Executando e Expondo a Aplicação

### 1. Rodando Localmente
Para iniciar o servidor, execute o comando:
```bash
npm start
```
O servidor estará rodando em `http://localhost:3000`.

### 2. Expondo com `ngrok`
Para que a Kommo possa enviar webhooks para o seu servidor local, você precisa de uma URL pública. O `ngrok` é perfeito para isso durante o desenvolvimento.

1.  [Baixe e instale o ngrok](https://ngrok.com/download).
2.  Em um **novo terminal** (deixe o servidor rodando no primeiro), execute o seguinte comando para expor a porta 3000:
    ```bash
    ngrok http 3000
    ```
3.  O `ngrok` irá gerar uma URL pública temporária na linha `Forwarding`. Será algo como `https://abcd-1234.ngrok.io`.
    **Esta é a URL base que você usará para configurar os webhooks na Kommo.**

## 🧪 Testando com Postman

Você pode testar cada webhook independentemente usando o Postman.

### Teste 1: Anunciar Parcelas
Simula um lead chegando na primeira etapa do funil.

- **Método:** `POST`
- **URL:** `http://localhost:3000/api/announce-installments`
- **Headers:** `Content-Type` : `application/json`
- **Body (Corpo):** Selecione **raw** e **JSON**. Use um ID de lead real que tenha "Número da Nota Fiscal" e "CNPJ" preenchidos.
    ```json
    {
        "leads": {
            "status": [
                {
                    "id": "ID_DO_SEU_LEAD_DE_TESTE"
                }
            ]
        }
    }
    ```
- **Resultado Esperado:**
    - **No Postman:** Status `200 OK`.
    - **Na Kommo:** O campo "Mensagem para o Bot" no lead de teste será preenchido com as opções de parcela.

### Teste 2: Gerar Boleto
Simula um lead chegando na segunda etapa, após escolher a parcela.

- **Método:** `POST`
- **URL:** `http://localhost:3000/api/generate-boleto`
- **Headers:** `Content-Type` : `application/json`
- **Body (Corpo):** Selecione **raw** e **JSON**. Use um ID de lead real que tenha "Número da Nota Fiscal", "CNPJ" e "Número da Parcela" preenchidos.
    ```json
    {
        "leads": {
            "status": [
                {
                    "id": "ID_DO_SEU_LEAD_DE_TESTE"
                }
            ]
        }
    }
    ```
- **Resultado Esperado:**
    - **No Postman:** Status `200 OK`.
    - **Na Kommo:** O campo "Arquivos/Boleto" será preenchido com o PDF, e uma nota com o anexo aparecerá no histórico do lead.

## 🔗 Endpoints da API (Webhook URLs)

| Método | Endpoint                    | Gatilho na Kommo (Exemplo)              | Função Principal                                    |
| ------ | --------------------------- | --------------------------------------- | --------------------------------------------------- |
| `POST` | `/api/announce-installments`| Lead entra na etapa "Aguardando Escolha". | Busca parcelas e prepara a mensagem para o bot.     |
| `POST` | `/api/generate-boleto`      | Lead entra na etapa "Gerar Boleto".       | Gera e anexa o boleto da parcela escolhida.         |

## ⚠️ Lógica de Erros

- **Boleto Não Encontrado:** Se a API da SOST retornar um erro 404 ou nenhuma parcela, o webhook `/api/announce-installments` irá limpar o campo "Arquivos/Boleto" no lead para remover informações antigas.
- **Campos Faltando:** Se um lead chegar a uma etapa sem os campos necessários preenchidos (ex: sem o "Número da Parcela" na etapa de gerar boleto), o sistema salvará uma mensagem de erro no campo "Mensagem para o Bot" para notificação.

## 📄 Licença

Distribuído sob a licença MIT.