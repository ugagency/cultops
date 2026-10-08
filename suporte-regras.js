// Regras puras do painel de suporte (SPEC-SUPORTE-03): sem banco, sem rede,
// testáveis em isolamento (ver teste-suporte.js). O server.js importa daqui.
const { grupoEfetivo, minutosDesde } = require('./status-catalogo.js');

const MOTIVO_MINIMO = 10;

const TIPOS_AVANCAR = [null, undefined, 'nf', 'comprovante'];

// Único mapa permitido para AVANÇAR DOCUMENTO. Qualquer outro status é 409.
// erro_rpa e liberado_rpa_airtop ficam de fora de propósito: o suporte não
// dispara envio ao SALIC.
const MAPA_AVANCAR = {
    revisao_manual: 'aguardando_conformidade',
    bloqueado_conformidade: 'aguardando_comprovante',
    divergencia_valor: 'aguardando_d3',
    divergencia_beneficiario: 'aguardando_d3'
};

const EFEITO_AVANCAR = {
    revisao_manual: 'O documento vai para a Auditoria IA e a validação de conformidade é disparada de novo.',
    bloqueado_conformidade: 'O documento passa a aguardar conciliação ignorando o bloqueio de conformidade; se veio de lote com extrato, a conciliação automática é acionada.',
    divergencia_valor: 'Avançar de divergência pula a conferência com o extrato: o documento entra em carência (D-3) mesmo com o valor diferente do lançamento.',
    divergencia_beneficiario: 'Avançar de divergência pula a conferência com o extrato: o documento entra em carência (D-3) sem lançamento correspondente ao fornecedor.'
};

const BLOQUEIO_SALIC = 'O suporte não dispara envio ao SALIC.';

const MIN_REVALIDAR = 5;
const MIN_EXTRATO_PENDENTE = 30;
const MIN_EXPORTACAO_GERANDO = 60;
const DIAS_ALERTA_ESPERANDO_CLIENTE = 7;

function validarMotivo(valor) {
    const motivo = typeof valor === 'string' ? valor.trim() : '';
    return motivo.length >= MOTIVO_MINIMO ? { ok: true, motivo } : { ok: false, motivo: null };
}

function regraAvancar(doc) {
    const tipo = doc.tipo_documento;
    if (!TIPOS_AVANCAR.includes(tipo)) {
        return { habilitada: false, destino: null, efeito: null, motivo_bloqueio: `Só notas fiscais e comprovantes podem ser avançados (tipo "${tipo}").` };
    }
    if (doc.status === 'erro_rpa' || doc.status === 'liberado_rpa_airtop') {
        return { habilitada: false, destino: null, efeito: null, motivo_bloqueio: BLOQUEIO_SALIC };
    }
    const destino = MAPA_AVANCAR[doc.status];
    if (!destino) {
        return { habilitada: false, destino: null, efeito: null, motivo_bloqueio: `O status "${doc.status}" não pode ser avançado pelo suporte.` };
    }
    return { habilitada: true, destino, efeito: EFEITO_AVANCAR[doc.status], motivo_bloqueio: null };
}

function avaliarRevalidar(doc, agora) {
    if (doc.status !== 'aguardando_conformidade') {
        return { habilitada: false, motivo_bloqueio: 'Só vale para documento em Auditoria IA (aguardando_conformidade).' };
    }
    const min = minutosDesde(doc.updated_at, agora);
    if (min == null) {
        return { habilitada: false, motivo_bloqueio: 'Sem data de início do status; não dá para saber se passou de 5 min.' };
    }
    if (min <= MIN_REVALIDAR) {
        return { habilitada: false, motivo_bloqueio: `Em auditoria há ${Math.floor(min)} min; o fluxo normal leva menos de 1 min. Aguarde passar de ${MIN_REVALIDAR} min.` };
    }
    return { habilitada: true, motivo_bloqueio: null };
}

const STATUS_CONCILIACAO = ['aguardando_conciliacao_bancaria', 'divergencia_valor', 'divergencia_beneficiario'];

// existeExtratoProcessado: há extrato processado no projeto do documento.
function avaliarRefazerConciliacao(doc, { existeExtratoProcessado }) {
    if (!STATUS_CONCILIACAO.includes(doc.status)) {
        return { habilitada: false, motivo_bloqueio: 'Só vale em Falta Conciliação ou Divergência (valor ou beneficiário).' };
    }
    if (!existeExtratoProcessado) {
        return { habilitada: false, motivo_bloqueio: 'O projeto não tem extrato processado. O cliente precisa subir o extrato.' };
    }
    return { habilitada: true, motivo_bloqueio: null };
}

function avaliarReprocessarExtrato(extrato, agora) {
    if (extrato.status === 'erro') return { habilitada: true, motivo_bloqueio: null, tempo_desconhecido: false };
    if (extrato.status !== 'pendente') {
        return { habilitada: false, motivo_bloqueio: 'Só extrato pendente há mais de 30 min ou com erro pode ser reprocessado.', tempo_desconhecido: false };
    }
    const desde = extrato.updated_at || extrato.created_at || null;
    const min = minutosDesde(desde, agora);
    if (min == null) {
        // Linhas antigas (anteriores à migration) não têm data: não há como
        // provar que está recente, e extrato pendente sem data é o caso típico
        // de extrato esquecido. Habilita e sinaliza.
        return { habilitada: true, motivo_bloqueio: null, tempo_desconhecido: true };
    }
    if (min <= MIN_EXTRATO_PENDENTE) {
        return { habilitada: false, motivo_bloqueio: `Pendente há ${Math.floor(min)} min; aguarde passar de ${MIN_EXTRATO_PENDENTE} min.`, tempo_desconhecido: false };
    }
    return { habilitada: true, motivo_bloqueio: null, tempo_desconhecido: false };
}

function avaliarEncerrarExportacao(exp, agora) {
    if (exp.status !== 'gerando') return { habilitada: false, motivo_bloqueio: 'Só exportação em "gerando" pode ser encerrada.' };
    const min = minutosDesde(exp.criado_em, agora);
    if (min == null || min <= MIN_EXPORTACAO_GERANDO) {
        return { habilitada: false, motivo_bloqueio: `Gerando há ${min == null ? '?' : Math.floor(min)} min; só após ${MIN_EXPORTACAO_GERANDO} min.` };
    }
    return { habilitada: true, motivo_bloqueio: null };
}

// Última captura de saldo: recaptura exige a credencial SALIC de quem clica
// (o worker busca decrypted_external_credentials pelo usuário do token), que o
// suporte não tem. Fica sempre bloqueada; a UI mostra o motivo.
function avaliarRecapturaSaldo(ultimaCaptura) {
    if (!ultimaCaptura || ultimaCaptura.status !== 'erro') {
        return { habilitada: false, motivo_bloqueio: 'Só quando a última captura terminou em erro.' };
    }
    return {
        habilitada: false,
        motivo_bloqueio: 'A captura usa a credencial SALIC de quem aciona e o suporte não tem uma. O cliente deve clicar em "Atualizar do SALIC".'
    };
}

function avaliarReimportarProjetoSalic(ultimaImportacao) {
    if (!ultimaImportacao) return { habilitada: false, motivo_bloqueio: 'O projeto nunca teve importação de PDF do SALIC.' };
    if (ultimaImportacao.status !== 'erro') {
        return { habilitada: false, motivo_bloqueio: 'Só quando a última importação terminou em erro.' };
    }
    if (!ultimaImportacao.file_path) return { habilitada: false, motivo_bloqueio: 'A importação não guardou o arquivo.' };
    return { habilitada: true, motivo_bloqueio: null };
}

// Apagar planilha antiga: só planilha orçamentária que não é a mais recente do
// projeto (o caso em que reimportar é bloqueado), sem vínculos e fora de
// processamento recente. A mais recente nunca é apagada pelo suporte.
function avaliarApagarPlanilha(doc, { maisRecenteId, temReferencia }, agora) {
    if (doc.tipo_documento !== 'planilha_orcamentaria') {
        return { habilitada: false, motivo_bloqueio: 'Só planilha orçamentária antiga pode ser apagada pelo suporte.' };
    }
    if (!doc.project_id || !maisRecenteId) {
        return { habilitada: false, motivo_bloqueio: 'Planilha sem projeto vinculado.' };
    }
    if (maisRecenteId === doc.id) {
        return { habilitada: false, motivo_bloqueio: 'É a planilha mais recente do projeto; não pode ser apagada.' };
    }
    if (doc.status === 'processing_ocr') {
        const min = minutosDesde(doc.updated_at, agora);
        if (min == null || min <= 15) return { habilitada: false, motivo_bloqueio: 'A planilha está sendo importada agora.' };
    }
    if (temReferencia) {
        return { habilitada: false, motivo_bloqueio: 'A planilha tem despesa, guia ou parcela de contrato vinculada.' };
    }
    return { habilitada: true, motivo_bloqueio: null };
}

// Decide se um item entra na fila e com qual grupo. Devolve null se não entra.
// esperando_cliente só entra quando parado há mais de 7 dias.
function classificarParaFila(entidade, status, desdeISO, agora) {
    const grupo = grupoEfetivo(entidade, status, desdeISO, agora);
    if (grupo === 'erro' || grupo === 'travado') return grupo;
    if (grupo === 'esperando_cliente') {
        const min = minutosDesde(desdeISO, agora);
        if (min != null && min > DIAS_ALERTA_ESPERANDO_CLIENTE * 1440) return grupo;
    }
    return null;
}

// Tradução das mensagens técnicas mais comuns de erro_mensagem (captura de
// saldo e importação de projeto SALIC). O texto original sempre é preservado
// pelo chamador em "detalhe tecnico".
const TRADUCOES_CAUSA = [
    [/Link do PRONAC nao encontrado/i, 'O robô não achou o PRONAC na lista do SALIC. Confira o número do projeto e se a conta SALIC tem acesso a ele.'],
    [/link .*Avalia[cç][aã]o de Resultados|Avaliacao de Resultados/i, 'O robô não encontrou o menu "Avaliação de Resultados" do SALIC. O SALIC pode ter mudado de layout.'],
    [/Waiting for selector .*Proponentes/i, 'A tela de proponentes do SALIC não carregou a tempo. O SALIC pode estar lento ou fora do ar.'],
    [/Target closed|Protocol error|Session closed|browser has disconnected/i, 'O navegador do robô fechou no meio da captura. Tentar de novo costuma resolver.'],
    [/Credenciais SALIC n[aã]o encontradas/i, 'A pessoa que acionou não tem credencial SALIC cadastrada.'],
    [/senha|login|autentica|credencia/i, 'O SALIC recusou o acesso. Verifique a credencial cadastrada.'],
    [/timeout|timed out|Navigation timeout|exceeded/i, 'O SALIC demorou demais para responder.'],
    [/aborted|AbortError/i, 'A operação foi interrompida por tempo limite antes de terminar.'],
    [/baixar o PDF|storage|arquivo n[aã]o encontrado/i, 'O arquivo PDF não foi encontrado no armazenamento.'],
    [/MISTRAL_API_KEY|GEMINI_API_KEY|OCR falhou|Estrutura[cç][aã]o IA falhou/i, 'A leitura do PDF por IA falhou no servidor.'],
    [/fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET/i, 'Falha de conexão com o serviço externo.'],
    [/Projeto n[aã]o encontrado/i, 'O projeto não foi encontrado no banco.']
];

function traduzirCausaSalic(mensagem) {
    if (!mensagem) return { causa: null, detalhe_tecnico: null };
    const texto = String(mensagem);
    for (const [re, pt] of TRADUCOES_CAUSA) {
        if (re.test(texto)) return { causa: pt, detalhe_tecnico: texto };
    }
    return { causa: 'Erro sem tradução conhecida; veja o detalhe técnico.', detalhe_tecnico: texto };
}

module.exports = {
    MOTIVO_MINIMO, MAPA_AVANCAR, MIN_REVALIDAR, MIN_EXTRATO_PENDENTE, MIN_EXPORTACAO_GERANDO,
    DIAS_ALERTA_ESPERANDO_CLIENTE, STATUS_CONCILIACAO,
    validarMotivo, regraAvancar, avaliarRevalidar, avaliarRefazerConciliacao,
    avaliarReprocessarExtrato, avaliarEncerrarExportacao, avaliarRecapturaSaldo,
    avaliarReimportarProjetoSalic, avaliarApagarPlanilha, classificarParaFila, traduzirCausaSalic
};
