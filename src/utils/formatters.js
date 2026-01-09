module.exports = {
    /**
     * Formata uma string de data (YYYY-MM-DD) para o padrão brasileiro (DD/MM/YYYY).
     */
    formatDateBR(dateString) {
        if (!dateString) return 'Data Indisponível';
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR');
    },

    /**
     * Formata um valor numérico para o padrão de moeda brasileiro (R$ 0,00).
     */
    formatCurrencyBR(value) {
        const number = parseFloat(value);
        if (isNaN(number)) return 'R$ 0,00';
        return number.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        });
    }
};