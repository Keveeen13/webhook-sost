require('dotenv').config();
const express = require('express');
const webhookRoutes = require('./src/routes/webhookRoutes');

const app = express();
const port = process.env.PORT || 4000;

// Middlewares para interpretar o corpo das requisições
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Carrega as rotas da aplicação
app.use('/api', webhookRoutes); // Todas as rotas começarão com /api

app.listen(port, () => {
    console.log(`Servidor do webhook rodando em http://localhost:${port}`);
});