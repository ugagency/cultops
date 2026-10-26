// Vínculo de um extrato a várias notas que já estão no Prestaí (#124, parte 2): regras puras, sem
// banco e sem rede, para testar em isolamento (ver teste-vinculo-extrato.js). O server.js usa
// daqui na rota POST /api/conciliacao/vincular-extrato.
//
// Vincular = gravar documents.extrato_origem_id. Quem concilia é a fila do servidor
// (fila-conciliacao.js), uma nota por vez, quando a nota chega a aguardando_conciliacao_bancaria.
// A rota não chama o n8n. Carregado como script comum no index.html (situacaoExtrato, para o selo
// da lista e da nota) e por require() no servidor e nos testes.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.VinculoExtrato = api;
})(typeof self !== 'undefined' ? self : this, function () {
const PERFIS_VINCULO = ['admin', 'gestor', 'analista'];

// Notas que entram na conciliação: tipo 'nf' (inclui os subtipos nf, guia, recibo e rpa) ou sem
// tipo (legado, tratado como nf como no resto do sistema). Ficam de fora 'comprovante' (é o
// comprovante de pagamento anexado a uma nota) e 'planilha_orcamentaria'.
const TIPOS_VINCULAVEIS = ['nf', null, undefined];

// Status anteriores à conciliação, ou nela. A nota segue o fluxo normal até a conciliação, e a
// fila pega o extrato quando ela chega a aguardando_conciliacao_bancaria.
const STATUS_VINCULAVEIS = [
    'aguardando_rubrica', 'processing_ocr', 'revisao_manual', 'aguardando_conformidade',
    'validating', 'aguardando_comprovante', 'aguardando_conciliacao_bancaria'
];

// Notas já conferidas: só entram com confirmação explícita, e voltam para a conciliação.
const STATUS_DIVERGENCIA = ['divergencia_beneficiario', 'divergencia_valor'];

// Extrato com leitura falha não concilia nada.
const STATUS_EXTRATO_RECUSADOS = ['erro'];

const MAX_NOTAS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROTULO_STATUS = {
    uploaded: 'enviada, ainda não lida',
    bloqueado_conformidade: 'bloqueada por conformidade',
    aguardando_aprovacao_fornecedor: 'aguardando aprovação do fornecedor',
    rejeitado_fornecedor: 'rejeitada',
    aguardando_d3: 'já conciliada (em carência D-3)',
    liberado_rpa_airtop: 'já conciliada (pronta para envio)',
    erro_rpa: 'com erro no envio ao SALIC',
    enviado_salic: 'já enviada ao SALIC',
    concluido: 'concluída'
};

// Valida o pedido antes de qualquer consulta ao banco.
// usuario: { role, orgId } vindos do JWT; nunca do corpo da requisição.
function validarPedido({ role, orgId, extratoId, documentIds }) {
    if (!PERFIS_VINCULO.includes(role)) return { ok: false, http: 403, erro: 'Seu perfil não pode vincular extrato a notas.' };
    if (!orgId) return { ok: false, http: 403, erro: 'Organização do usuário não identificada.' };
    if (!extratoId || typeof extratoId !== 'string') return { ok: false, http: 400, erro: 'Informe o extrato.' };
    if (!UUID.test(extratoId.trim())) return { ok: false, http: 400, erro: 'Extrato inválido.' };
    if (!Array.isArray(documentIds) || documentIds.length === 0) return { ok: false, http: 400, erro: 'Selecione ao menos uma nota.' };
    const ids = [...new Set(documentIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
    if (ids.length === 0) return { ok: false, http: 400, erro: 'Selecione ao menos uma nota.' };
    if (ids.some(id => !UUID.test(id))) return { ok: false, http: 400, erro: 'Nota inválida na seleção.' };
    if (ids.length > MAX_NOTAS) return { ok: false, http: 400, erro: `No máximo ${MAX_NOTAS} notas por vez.` };
    return { ok: true, ids, extratoId: extratoId.trim() };
}

// O extrato precisa ser da organização do usuário: pelo projeto dele (autoritativo) e, quando
// preenchida, pela organization_id do próprio extrato.
function validarExtrato({ extrato, orgDoProjeto, orgId }) {
    if (!extrato) return { ok: false, http: 404, erro: 'Extrato não encontrado.' };
    if (!orgDoProjeto || orgDoProjeto !== orgId) return { ok: false, http: 404, erro: 'Extrato não encontrado.' };
    if (extrato.organization_id && extrato.organization_id !== orgId) return { ok: false, http: 404, erro: 'Extrato não encontrado.' };
    if (STATUS_EXTRATO_RECUSADOS.includes(extrato.status)) {
        return { ok: false, http: 409, erro: 'Este extrato teve erro de leitura. Envie o extrato novamente.' };
    }
    return { ok: true };
}

const recusada = (motivo) => ({ resultado: 'recusada', motivo });
const pulada = (motivo) => ({ resultado: 'pulada', motivo });

// Avalia uma nota. nota: linha de documents (ou null se não veio do banco); orgDaNota: organização
// do projeto da nota. Devolve { resultado: 'vinculada' | 'pulada' | 'recusada', motivo, atualizar }.
// `atualizar` são os campos a gravar quando vinculada.
function avaliarNota({ nota, orgDaNota, usuario, extrato, incluirDivergencias }) {
    if (!nota || !orgDaNota || orgDaNota !== usuario.orgId) return recusada('Nota não encontrada.');
    // Mesma regra da policy documents_analista_org: analista só mexe nas notas que enviou.
    if (usuario.role === 'analista' && nota.user_id !== usuario.id) {
        return recusada('Analista só vincula notas que ele mesmo enviou.');
    }
    if (nota.project_id !== extrato.project_id) return recusada('Nota de outro projeto: o extrato pertence a outro projeto.');
    if (!TIPOS_VINCULAVEIS.includes(nota.tipo_documento)) {
        return recusada('Este tipo de documento não entra na conciliação com extrato.');
    }
    if (nota.extrato_origem_id && nota.extrato_origem_id !== extrato.id) {
        return pulada('Já vinculada a outro extrato.');
    }

    const emDivergencia = STATUS_DIVERGENCIA.includes(nota.status);
    if (emDivergencia && !incluirDivergencias) {
        return pulada('Nota em divergência: confirme a reconferência para incluí-la.');
    }
    if (!emDivergencia && !STATUS_VINCULAVEIS.includes(nota.status)) {
        return recusada(`Nota ${ROTULO_STATUS[nota.status] || 'em um status que não aceita vínculo de extrato'}.`);
    }
    if (!emDivergencia && nota.extrato_origem_id === extrato.id) return pulada('Já vinculada a este extrato.');

    const atualizar = { extrato_origem_id: extrato.id };
    if (emDivergencia) {
        // Como o "Substituir Extrato" da nota: volta para a conciliação e limpa o alerta antigo.
        atualizar.status = 'aguardando_conciliacao_bancaria';
        atualizar.just_erro = null;
    }
    return { resultado: 'vinculada', motivo: emDivergencia ? 'Vinculada; a nota será reconferida com este extrato.' : 'Vinculada; entra na fila de conciliação.', atualizar };
}

// Status da nota em que a conciliação já foi ou está sendo feita (a nota está na fila ou já passou
// dela): só nestes a fila de conciliação a pega.
const STATUS_NA_FILA = ['aguardando_comprovante', 'aguardando_conciliacao_bancaria'];

// Status em que a nota ainda não chegou à conciliação.
const STATUS_ANTES_DA_CONCILIACAO = [
    'uploaded', 'processing_ocr', 'validating', 'validated', 'aguardando_rubrica', 'revisao_manual',
    'aguardando_conformidade', 'bloqueado_conformidade', 'aguardando_aprovacao_fornecedor'
];

// Selo de situação do extrato na lista e na tela da nota:
//   'fila'      extrato vinculado e a nota está na conciliação (a fila do servidor vai pegá-la);
//   'vinculado' extrato vinculado e a nota ainda não chegou à conciliação;
//   null        sem extrato vinculado, ou a nota já passou da conciliação.
function situacaoExtrato(doc) {
    if (!doc || !doc.extrato_origem_id) return null;
    if (STATUS_NA_FILA.includes(doc.status)) return 'fila';
    if (STATUS_ANTES_DA_CONCILIACAO.includes(doc.status)) return 'vinculado';
    return null;
}

return {
    PERFIS_VINCULO, TIPOS_VINCULAVEIS, STATUS_VINCULAVEIS, STATUS_DIVERGENCIA, STATUS_EXTRATO_RECUSADOS, MAX_NOTAS,
    STATUS_NA_FILA, STATUS_ANTES_DA_CONCILIACAO,
    validarPedido, validarExtrato, avaliarNota, situacaoExtrato
};
});
