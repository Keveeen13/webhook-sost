const express = require('express');
const { handleAnnounceInstallments, handleGenerateBoleto } = require('../controllers/webhookController');

const router = express.Router();

router.post('/announce-installments', handleAnnounceInstallments);

router.post('/generate-boleto', handleGenerateBoleto);


module.exports = router;