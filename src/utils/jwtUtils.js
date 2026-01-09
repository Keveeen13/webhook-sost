module.exports = {
    /**
     * Decodifica o payload de um JWT (sem verificar assinatura).
     */
    decodeJwtPayload(jwtToken) {
        try {
            const tokenParts = jwtToken.split('.');
            if (tokenParts.length === 3) {
                const payloadBase64Url = tokenParts[1];
                const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');
                const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
                return JSON.parse(payloadJson);
            }
        } catch (e) {
            console.error('Erro ao decodificar JWT payload:', e);
        }
        return null;
    }
};