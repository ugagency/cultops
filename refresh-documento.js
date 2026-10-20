// Atualização silenciosa da tela de detalhes da nota (#101): lógica pura, sem DOM, sem banco e
// sem rede, para testar em isolamento (ver teste-refresh-documento.js). O app.js usa daqui.
// Carregado como script comum no index.html e por require() nos testes.
//
// Tempos (constantes nomeadas, ajustáveis em um lugar só):
//   ESPERA_REFRESH_MS: quanto esperar, depois do ÚLTIMO evento do mesmo documento, para
//   atualizar. Eventos em sequência (o banco grava pagamento e depois o status) viram uma só
//   atualização.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.RefreshDocumento = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const ESPERA_REFRESH_MS = 400;

    // Agrupa pedidos de atualização por documento:
    //  - debounce: cada pedido reinicia a espera; só o último dispara;
    //  - single-flight: nunca duas execuções do mesmo documento em paralelo;
    //  - pedido durante uma execução marca "pendente" e roda UMA vez ao terminar, sem esperar;
    //  - forcar (uma vez) ignora a checagem de assinatura na próxima execução.
    // agendar() devolve uma Promise que resolve quando termina a execução que cobre o pedido.
    function criarAgrupador({ executar, esperaMs = ESPERA_REFRESH_MS, agendarTimer = setTimeout, cancelarTimer = clearTimeout, aoErro = null }) {
        const porId = new Map();

        function estadoDe(id) {
            let st = porId.get(id);
            if (!st) {
                st = { timer: null, emAndamento: false, pendente: false, forcar: false, esperando: [] };
                porId.set(id, st);
            }
            return st;
        }

        async function rodar(id) {
            const st = estadoDe(id);
            st.emAndamento = true;
            st.pendente = false;
            const forcar = st.forcar;
            st.forcar = false;
            const lote = st.esperando.splice(0);
            try {
                await executar(id, { forcar });
            } catch (e) {
                if (aoErro) aoErro(e);
            } finally {
                st.emAndamento = false;
                lote.forEach(resolver => resolver());
                if (st.pendente) rodar(id);
                else if (!st.timer && st.esperando.length === 0) porId.delete(id);
            }
        }

        function agendar(id, opcoes = {}) {
            const st = estadoDe(id);
            if (opcoes.forcar) st.forcar = true;
            const concluido = new Promise(resolver => st.esperando.push(resolver));
            if (st.emAndamento) {
                st.pendente = true;
            } else {
                if (st.timer) cancelarTimer(st.timer);
                st.timer = agendarTimer(() => { st.timer = null; rodar(id); }, esperaMs);
            }
            return concluido;
        }

        return { agendar };
    }

    // Assinatura do que a tela de detalhes mostra. Se não mudou desde o último desenho, a
    // atualização silenciosa não precisa redesenhar. Recebe um retrato simples (sem acoplar ao
    // state do app): { doc, comprovante, candidatos, ampliarCandidatos, extratoId, qtdLancamentos,
    // lancamentoDaNotaId, origemPagamento, dataLancamentoDaNota, duplicataId, guiaDuplicataId,
    // qtdRubricasDisponiveis, flags }.
    function assinaturaDetalhes(s) {
        const d = (s && s.doc) || {};
        const candidatos = (s && s.candidatos) || [];
        const despesas = Array.isArray(d.despesas) ? d.despesas.map(x => [x && x.id, x && x.status]) : null;
        return JSON.stringify([
            d.id, d.status, d.updated_at, d.fitid, d.data_pagamento, d.valor_pago, d.extrato_conferido_id,
            d.just_erro, d.justification, d.rubrica_id_fk, d.rubrica, d.valor, d.numero_nf, d.nome_emissor,
            d.cnpj_emissor, d.data_emissao, despesas,
            candidatos.length, candidatos.map(c => c && c.id), !!(s && s.ampliarCandidatos),
            s && s.extratoId, s && s.qtdLancamentos, s && s.lancamentoDaNotaId,
            s && s.origemPagamento, s && s.dataLancamentoDaNota,
            s && s.comprovante ? [s.comprovante.id, s.comprovante.status] : null,
            s && s.duplicataId, s && s.guiaDuplicataId, s && s.qtdRubricasDisponiveis,
            (s && s.flags) || []
        ]);
    }

    return { ESPERA_REFRESH_MS, criarAgrupador, assinaturaDetalhes };
});
