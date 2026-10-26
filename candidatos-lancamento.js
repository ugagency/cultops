// Filtro dos lançamentos candidatos de uma nota (#103): lógica pura, sem DOM, sem banco e sem
// rede, para testar em isolamento (ver teste-candidatos-lancamento.js). O app.js usa daqui.
// Carregado como script comum no index.html e por require() nos testes.
//
// Janelas de data (em dias) usadas quando a nota NÃO tem extrato conferido:
//   com data_pagamento: de -JANELA_PAGAMENTO_DIAS a +JANELA_PAGAMENTO_DIAS em torno dela;
//   senão, com data_emissao: de -JANELA_EMISSAO_ANTES_DIAS a +JANELA_EMISSAO_DEPOIS_DIAS;
//   sem nenhuma das duas: sem janela.
//
// Identidade do lançamento (#124): o extrato pode ter o mesmo lançamento gravado várias vezes
// (extrato enviado mais de uma vez). Chave = projeto + fitid + data + valor absoluto com 2 casas.
// O número do documento sozinho NÃO é chave: no BB ele pode repetir no mesmo extrato em datas e
// valores diferentes. Sem fitid, a chave usa data + valor + histórico (memo), que é mais fraca.
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

    // Valor absoluto com 2 casas, em texto. Aceita número, '190.95' e '190,95' (e '1.234,56').
    function valorAbsoluto(valor) {
        if (valor == null || valor === '') return '';
        let n;
        if (typeof valor === 'number') {
            n = valor;
        } else {
            const t = String(valor).trim();
            n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
        }
        return Number.isFinite(n) ? Math.abs(n).toFixed(2) : '';
    }

    const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

    function memoNormalizado(memo) {
        return String(memo || '').normalize('NFD').replace(ACENTOS, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // Chave que identifica o lançamento dentro do projeto. Com fitid: fitid + data + valor.
    // Sem fitid: data + valor + memo (chave mais fraca; o marcador 'm' nunca colide com o 'f').
    function chaveLancamento(l) {
        const projeto = (l && l.project_id) || '';
        const data = dataValida(l && l.data_lancamento) || '';
        const valor = valorAbsoluto(l && l.valor);
        const fitid = String((l && l.fitid) || '').trim();
        return fitid
            ? `${projeto}|f|${fitid}|${data}|${valor}`
            : `${projeto}|m|${data}|${valor}|${memoNormalizado(l && l.memo)}`;
    }

    const ligadaANota = (l) => !!(l && l.document_id);
    const ligadaAQualquerNota = (l) => ligadaANota(l) || (l && l.status_conciliacao === 'conciliado');

    // Uma entrada por lançamento (chave), na ordem em que cada chave aparece. A linha
    // representante é a ligada a esta nota; senão a ligada a qualquer nota (document_id
    // preenchido ou status 'conciliado'); senão a primeira.
    function deduplicar(lista, docId) {
        const grupos = new Map();
        for (const l of lista || []) {
            const k = chaveLancamento(l);
            if (!grupos.has(k)) grupos.set(k, []);
            grupos.get(k).push(l);
        }
        return [...grupos.values()].map(copias =>
            copias.find(l => docId != null && l.document_id === docId)
            || copias.find(ligadaAQualquerNota)
            || copias[0]);
    }

    // Chaves usadas por OUTRA nota: qualquer linha com a chave ligada (document_id) a uma nota
    // diferente de docId, de qualquer extrato do projeto presente em `linhas`.
    function chavesUsadas(linhas, docId) {
        const usadas = new Set();
        for (const l of linhas || []) {
            if (ligadaANota(l) && l.document_id !== docId) usadas.add(chaveLancamento(l));
        }
        return usadas;
    }

    // Candidatos de uma nota. `candidatas` são as linhas que passaram pelos filtros (extrato,
    // janela, valor); `ligadas` são as linhas do projeto ligadas a notas, de qualquer extrato
    // (só servem para marcar a chave como usada). Sai um candidato por lançamento, sem os já
    // usados por outra nota.
    function selecionarCandidatos(candidatas, ligadas, docId) {
        const usadas = chavesUsadas([...(candidatas || []), ...(ligadas || [])], docId);
        return deduplicar((candidatas || []).filter(l => !usadas.has(chaveLancamento(l))), docId);
    }

    return {
        JANELA_PAGAMENTO_DIAS, JANELA_EMISSAO_ANTES_DIAS, JANELA_EMISSAO_DEPOIS_DIAS,
        dataValida, somarDias, montarFiltroCandidatos,
        valorAbsoluto, chaveLancamento, deduplicar, chavesUsadas, selecionarCandidatos
    };
});
