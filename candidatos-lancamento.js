// Filtro dos lançamentos candidatos de uma nota (#103): lógica pura, sem DOM, sem banco e sem
// rede, para testar em isolamento (ver teste-candidatos-lancamento.js). O app.js usa daqui.
// Carregado como script comum no index.html e por require() nos testes.
//
// Janelas de data (em dias) usadas quando a nota NÃO tem extrato conferido:
//   com data_pagamento: de -JANELA_PAGAMENTO_DIAS a +JANELA_PAGAMENTO_DIAS em torno dela;
//   senão, com data_emissao: de -JANELA_EMISSAO_ANTES_DIAS a +JANELA_EMISSAO_DEPOIS_DIAS;
//   sem nenhuma das duas: sem janela.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.CandidatosLancamento = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const JANELA_PAGAMENTO_DIAS = 7;
    const JANELA_EMISSAO_ANTES_DIAS = 3;
    const JANELA_EMISSAO_DEPOIS_DIAS = 60;

    // 'YYYY-MM-DD' (coluna date do banco) ou null.
    function dataValida(valor) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ''));
        return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }

    // Soma dias a uma data 'YYYY-MM-DD'. Usa meio-dia ('T12:00:00') para a virada de horário
    // de verão e o fuso nunca empurrarem o resultado para o dia vizinho.
    function somarDias(dataISO, dias) {
        const d = new Date(dataISO + 'T12:00:00');
        d.setDate(d.getDate() + dias);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    // Parâmetros do filtro dos candidatos.
    //   doc: { extrato_conferido_id, data_pagamento, data_emissao }
    //   ampliar: true tira os filtros de extrato e de janela (todo o projeto).
    // Devolve { extrato_id, data_de, data_ate, escopo }, com escopo 'extrato', 'janela' ou
    // 'projeto' (sem filtro além do projeto e do valor).
    function montarFiltroCandidatos(doc, ampliar) {
        const vazio = { extrato_id: null, data_de: null, data_ate: null, escopo: 'projeto' };
        if (ampliar || !doc) return vazio;
        if (doc.extrato_conferido_id) {
            return { ...vazio, extrato_id: doc.extrato_conferido_id, escopo: 'extrato' };
        }
        const pagamento = dataValida(doc.data_pagamento);
        if (pagamento) {
            return {
                extrato_id: null,
                data_de: somarDias(pagamento, -JANELA_PAGAMENTO_DIAS),
                data_ate: somarDias(pagamento, JANELA_PAGAMENTO_DIAS),
                escopo: 'janela'
            };
        }
        const emissao = dataValida(doc.data_emissao);
        if (emissao) {
            return {
                extrato_id: null,
                data_de: somarDias(emissao, -JANELA_EMISSAO_ANTES_DIAS),
                data_ate: somarDias(emissao, JANELA_EMISSAO_DEPOIS_DIAS),
                escopo: 'janela'
            };
        }
        return vazio;
    }

    return {
        JANELA_PAGAMENTO_DIAS, JANELA_EMISSAO_ANTES_DIAS, JANELA_EMISSAO_DEPOIS_DIAS,
        dataValida, somarDias, montarFiltroCandidatos
    };
});
