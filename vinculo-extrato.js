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

const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

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

// Notas presas a um extrato pausado (#127): a fila de conciliação pausa o extrato quando a primeira
// nota volta do n8n com "Extrato de outro projeto" (ver ACAO_PAUSA em fila-conciliacao.js). As notas
// que apontam para ele ficam na fila ou em divergência e nunca andam; o vínculo delas pode ser trocado.
const STATUS_PRESAS_AO_EXTRATO = ['aguardando_comprovante', 'aguardando_conciliacao_bancaria', 'divergencia_beneficiario', 'divergencia_valor'];

// Status em que a nota já passou da conciliação: nunca é considerada presa por texto de erro antigo.
const STATUS_ENCERRADOS = ['aguardando_d3', 'liberado_rpa_airtop', 'erro_rpa', 'enviado_salic', 'concluido'];

// Mesma regra de extratoDeOutroProjeto() em fila-conciliacao.js (este arquivo também roda no navegador,
// que não carrega a fila): o texto gravado pelo n8n em documents.just_erro começa assim.
function justErroDeExtratoDeOutroProjeto(justErro) {
    return String(justErro == null ? '' : justErro).normalize('NFD').replace(ACENTOS, '').trim().toLowerCase().startsWith('extrato de outro projeto');
}

const contem = (conjunto, id) => !!conjunto && (typeof conjunto.has === 'function' ? conjunto.has(id) : (Array.isArray(conjunto) && conjunto.includes(id)));

// A nota aponta para um extrato pausado e está parada por causa dele? Vale para as que esperam na
// fila ou em divergência e, por garantia, para a que voltou com a mensagem de PRONAC divergente em
// qualquer outro status que ainda não passou da conciliação.
function presaAExtratoPausado(nota, extratosPausados) {
    if (!nota || !nota.extrato_origem_id || !contem(extratosPausados, nota.extrato_origem_id)) return false;
    if (STATUS_PRESAS_AO_EXTRATO.includes(nota.status)) return true;
    return justErroDeExtratoDeOutroProjeto(nota.just_erro) && !STATUS_ENCERRADOS.includes(nota.status);
}

// Valida a consulta dos extratos pausados de um projeto (GET /api/conciliacao/extratos-pausados).
function validarConsultaPausados({ role, orgId, projectId }) {
    if (!PERFIS_VINCULO.includes(role)) return { ok: false, http: 403, erro: 'Seu perfil não pode consultar extratos.' };
    if (!orgId) return { ok: false, http: 403, erro: 'Organização do usuário não identificada.' };
    if (!projectId || typeof projectId !== 'string' || !UUID.test(projectId.trim())) return { ok: false, http: 400, erro: 'Informe o projeto.' };
    return { ok: true, projectId: projectId.trim() };
}

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
// `atualizar` são os campos a gravar quando vinculada. extratosPausados (opcional, Set de ids): a nota
// presa a um desses extratos pode ser revinculada a outro, em vez de pulada.
function avaliarNota({ nota, orgDaNota, usuario, extrato, incluirDivergencias, extratosPausados = null }) {
    if (!nota || !orgDaNota || orgDaNota !== usuario.orgId) return recusada('Nota não encontrada.');
    // Mesma regra da policy documents_analista_org: analista só mexe nas notas que enviou.
    if (usuario.role === 'analista' && nota.user_id !== usuario.id) {
        return recusada('Analista só vincula notas que ele mesmo enviou.');
    }
    if (nota.project_id !== extrato.project_id) return recusada('Nota de outro projeto: o extrato pertence a outro projeto.');
    if (!TIPOS_VINCULAVEIS.includes(nota.tipo_documento)) {
        return recusada('Este tipo de documento não entra na conciliação com extrato.');
    }
    const trocaDePausado = !!nota.extrato_origem_id && nota.extrato_origem_id !== extrato.id && presaAExtratoPausado(nota, extratosPausados);
    if (nota.extrato_origem_id && nota.extrato_origem_id !== extrato.id && !trocaDePausado) {
        return pulada('Já vinculada a outro extrato.');
    }

    // Já conferida (divergência) ou presa por texto de erro em um status fora da lista de vinculáveis:
    // volta para a conciliação, só com a confirmação explícita.
    const emDivergencia = STATUS_DIVERGENCIA.includes(nota.status)
        || (trocaDePausado && !STATUS_VINCULAVEIS.includes(nota.status));
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
    const motivo = trocaDePausado
        ? 'Vinculada; substitui o extrato de outro projeto.'
        : (emDivergencia ? 'Vinculada; a nota será reconferida com este extrato.' : 'Vinculada; entra na fila de conciliação.');
    return { resultado: 'vinculada', motivo, atualizar };
}

// ---- Busca nos extratos já enviados (janela "Vincular extrato") ----

const ROTULO_STATUS_EXTRATO = { pendente: 'Aguardando leitura', processado: 'Lido', erro: 'Erro de leitura' };

const semAcento = (t) => String(t == null ? '' : t).normalize('NFD').replace(ACENTOS, '').toLowerCase();

// O banco não guarda o nome original do arquivo; o final do caminho do Storage é o que existe.
function nomeDoArquivo(filePath) {
    return String(filePath || '').split('/').pop() || 'extrato';
}

// Texto em que a busca procura: nome do arquivo, data de envio (dd/mm/aaaa), status (como aparece
// na tela e como é gravado) e formato.
function textoBuscavel(extrato) {
    const e = extrato || {};
    const data = e.created_at ? new Date(e.created_at).toLocaleDateString('pt-BR') : '';
    return semAcento([nomeDoArquivo(e.file_path), data, ROTULO_STATUS_EXTRATO[e.status] || '', e.status, e.formato].join(' '));
}

// Filtra os extratos pelo texto digitado. Todas as palavras precisam aparecer (sem diferenciar
// caixa nem acento), em qualquer ordem e em qualquer um dos campos. Texto vazio devolve tudo, na
// ordem recebida.
function filtrarExtratos(extratos, busca) {
    const lista = extratos || [];
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return lista;
    return lista.filter(e => {
        const alvo = textoBuscavel(e);
        return termos.every(t => alvo.includes(t));
    });
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
//   'pausado'   extrato vinculado é de outro projeto e a fila o pausou: a nota está parada (#127);
//   null        sem extrato vinculado, ou a nota já passou da conciliação.
// extratosPausados (opcional, Set de ids): vem da consulta ao servidor; sem ele o selo é o de sempre.
function situacaoExtrato(doc, extratosPausados = null) {
    if (!doc || !doc.extrato_origem_id) return null;
    if (presaAExtratoPausado(doc, extratosPausados)) return 'pausado';
    if (STATUS_NA_FILA.includes(doc.status)) return 'fila';
    if (STATUS_ANTES_DA_CONCILIACAO.includes(doc.status)) return 'vinculado';
    return null;
}

return {
    PERFIS_VINCULO, TIPOS_VINCULAVEIS, STATUS_VINCULAVEIS, STATUS_DIVERGENCIA, STATUS_EXTRATO_RECUSADOS, MAX_NOTAS,
    STATUS_NA_FILA, STATUS_ANTES_DA_CONCILIACAO, ROTULO_STATUS_EXTRATO, STATUS_PRESAS_AO_EXTRATO, STATUS_ENCERRADOS,
    validarPedido, validarExtrato, avaliarNota, situacaoExtrato, nomeDoArquivo, filtrarExtratos,
    presaAExtratoPausado, justErroDeExtratoDeOutroProjeto, validarConsultaPausados
};
});
