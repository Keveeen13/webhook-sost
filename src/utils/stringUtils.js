module.exports = {
    /**
     * Sanitiza o nome do cliente para uso em nomes de arquivos.
     * Converte para maiúsculas e remove caracteres especiais.
     */
    sanitizeFileName(name) {
        if (!name) return 'CLIENTE';
        return name
            .toUpperCase()
            .normalize('NFD') // Decompõe caracteres acentuados
            .replace(/[\u0300-\u036f]/g, "") // Remove os acentos
            .replace(/[^A-Z0-9_.-]/gi, '') // Remove o que não for alfanumérico básico
            || 'CLIENTE';
    }
};