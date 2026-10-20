// Fila de conferência do saldo SALIC (#104): lógica pura, sem DOM, sem banco e sem rede, para
// testar em isolamento (ver teste-saldo-fila.js). A tela modulo2/financeiro.html usa daqui.
// Carregado como script comum e por require() nos testes.
//
// Cada captura bem-sucedida regrava as linhas ainda sem rubrica; a fila só vale para a ÚLTIMA
// captura com status 'sucesso' do projeto (a mesma que a view v_saldo_rubricas usa, exposta
// em ultima_captura_em).
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.SaldoFila = api;
})(typeof self !== 'undefined' ? self : this, function () {
    function emMs(valor) {
        const t = Date.parse(valor);
        return Number.isNaN(t) ? null : t;
    }

    // Instante da última captura bem-sucedida do projeto, a partir das linhas de
    // v_saldo_rubricas (todas trazem o mesmo ultima_captura_em). null se não houver captura.
    function ultimaCapturaEmDoProjeto(linhasSaldo) {
        let maior = null;
        for (const l of linhasSaldo || []) {
            const t = emMs(l && l.ultima_captura_em);
            if (t !== null && (maior === null || t > maior)) maior = t;
        }
        return maior === null ? null : new Date(maior).toISOString();
    }

    // Mantém só as linhas da fila que pertencem à última captura bem-sucedida. Cada linha
    // traz a captura de origem em saldo_salic_capturas ({ status, concluida_em }, objeto ou
    // lista de um item, conforme o PostgREST devolver). Sem última captura, a fila é vazia.
    function filtrarFilaUltimaCaptura(linhas, ultimaCapturaEm) {
        const alvo = emMs(ultimaCapturaEm);
        if (alvo === null) return [];
        return (linhas || []).filter(l => {
            const captura = Array.isArray(l && l.saldo_salic_capturas) ? l.saldo_salic_capturas[0] : (l && l.saldo_salic_capturas);
            return !!captura && captura.status === 'sucesso' && emMs(captura.concluida_em) === alvo;
        });
    }

    return { ultimaCapturaEmDoProjeto, filtrarFilaUltimaCaptura };
});
