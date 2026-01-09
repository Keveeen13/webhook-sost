require('dotenv').config();
const express = require('express');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use('/sost', webhookRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 API rodando na porta ${PORT}`));