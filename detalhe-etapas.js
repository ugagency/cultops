// Etapas da tela de detalhes da nota (#130): lógica pura, sem DOM, sem banco e sem rede, para
// testar em isolamento (ver teste-detalhe-etapas.js). O app.js usa daqui.
// Carregado como script comum no index.html e por require() nos testes.
//
// A tela mostra 6 etapas. Cada status da nota cai em uma delas (índice 0 a 5). Algumas
// posições são de erro (a nota parou ali e alguém precisa agir) e outras de espera.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.DetalheEtapas = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const ETAPAS = [
        { label: 'Enviado', icon: 'upload-cloud' },
        { label: 'OCR', icon: 'cpu' },
        { label: 'Auditoria', icon: 'shield' },
        { label: 'Preparação de Envio', icon: 'file-text' },
        { label: 'Conciliação', icon: 'banknote' },
        { label: 'SALIC', icon: 'check-circle' }
    ];

    // Fluxo normal, na ordem. Os quatro últimos ficam todos na etapa SALIC.
    const ORDEM = [
        'uploaded',
        'processing_ocr',
        'aguardando_conformidade',
        'aguardando_comprovante',
        'aguardando_conciliacao_bancaria',
        'aguardando_d3',
        'liberado_rpa_airtop',
        'enviado_salic',
        'concluido'
    ];

    // Status fora do fluxo normal: etapa e se é erro.
    // aguardando_rubrica vem antes da leitura (a nota volta dele para processing_ocr).
    // O gate do fornecedor acontece depois da leitura e antes da auditoria.
    const DESVIOS = {
        aguardando_rubrica: { etapa: 0, erro: false },
        revisao_manual: { etapa: 1, erro: true },
        validating: { etapa: 1, erro: false },
        validated: { etapa: 2, erro: false },
        bloqueado_conformidade: { etapa: 2, erro: true },
        aguardando_aprovacao_fornecedor: { etapa: 2, erro: false },
        rejeitado_fornecedor: { etapa: 2, erro: true },
        divergencia_valor: { etapa: 4, erro: true },
        divergencia_beneficiario: { etapa: 4, erro: true },
        erro_rpa: { etapa: 5, erro: true }
    };

    const STATUS_CONCLUIDOS = ['enviado_salic', 'concluido'];

    // { atual, erro, concluida } para um status. Status desconhecido cai na etapa 0, como antes.
    function etapaDoStatus(status) {
        const pos = ORDEM.indexOf(status);
        if (pos !== -1) {
            return { atual: Math.min(pos, ETAPAS.length - 1), erro: false, concluida: STATUS_CONCLUIDOS.includes(status) };
        }
        const d = DESVIOS[status];
        if (d) return { atual: d.etapa, erro: d.erro, concluida: false };
        return { atual: 0, erro: false, concluida: false };
    }

    // Qual etapa a tela mostra. `anterior` é o que ficou guardado da última vez
    // ({ docId, status, vista }). A escolha do usuário vale enquanto for a mesma nota e o
    // mesmo status; se o status mudou, volta para a etapa atual. vista null = etapa atual.
    function resolverVista(anterior, doc) {
        if (!doc) return { docId: null, status: null, vista: null };
        const mesmo = anterior && anterior.docId === doc.id && anterior.status === doc.status;
        const vista = mesmo && Number.isInteger(anterior.vista) ? anterior.vista : null;
        return { docId: doc.id, status: doc.status, vista };
    }

    // Índice efetivo da etapa vista.
    function indiceVisto(estado, doc) {
        const { atual } = etapaDoStatus(doc.status);
        const v = estado && Number.isInteger(estado.vista) ? estado.vista : null;
        if (v === null || v < 0 || v >= ETAPAS.length) return atual;
        return v;
    }

    const ORIGENS = {
        ui: 'pela tela',
        trigger: 'automático',
        'sistema:nao_declarado': 'automático',
        avancar_nota_apos_pagamento: 'avanço após o pagamento',
        conciliacao_auto_lote: 'conciliação automática do lote'
    };

    function rotuloOrigem(origem) {
        if (!origem) return '';
        if (ORIGENS[origem]) return ORIGENS[origem];
        return String(origem).replace(/^sistema:/, '').replace(/_/g, ' ');
    }

    // Agrupa as mudanças de status do audit_log por etapa (a etapa do status de destino).
    // `linhas`: [{ valor_anterior, valor_novo, origem, motivo, created_at }], em qualquer ordem.
    // `rotuloStatus`: função que traduz o código do status para o texto da tela.
    // Devolve um array de 6 listas, cada uma em ordem cronológica.
    function historicoPorEtapa(linhas, rotuloStatus) {
        const porEtapa = ETAPAS.map(() => []);
        const rot = typeof rotuloStatus === 'function' ? rotuloStatus : (s) => s;
        const ordenadas = (linhas || []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        for (const l of ordenadas) {
            if (!l || !l.valor_novo) continue;
            const { atual } = etapaDoStatus(l.valor_novo);
            const de = l.valor_anterior ? rot(l.valor_anterior) : null;
            const texto = (de ? de + ' → ' : 'Entrou em ') + rot(l.valor_novo);
            porEtapa[atual].push({
                quando: l.created_at,
                texto,
                origem: rotuloOrigem(l.origem),
                motivo: l.motivo || ''
            });
        }
        return porEtapa;
    }

    return { ETAPAS, ORDEM, DESVIOS, etapaDoStatus, resolverVista, indiceVisto, rotuloOrigem, historicoPorEtapa };
});
