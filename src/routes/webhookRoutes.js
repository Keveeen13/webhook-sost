const express = require('express');
const { handleAnnounceInstallments, handleGenerateBoleto } = require('../controllers/webhookController');

const router = express.Router();

router.post('/gerar-parcelas', handleAnnounceInstallments);

router.post('/gerar-boleto', handleGenerateBoleto);

module.exports = router;