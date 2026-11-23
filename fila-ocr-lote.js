// Fila de OCR dos Documentos em Lote no servidor (ocorrência #202). Lógica pura, sem banco e sem
// rede, para testar em isolamento (ver teste-fila-ocr-lote.js); o server.js usa daqui.
//
// Antes, o navegador mandava cada documento ao webhook de OCR do n8n e esperava a resposta
// (mediana de 29 s por documento) antes do próximo, e o usuário não podia fechar a aba. Agora:
//   1. POST /api/lote/processar grava a rubrica de cada documento e marca documents.ocr_fila_em;
//      o documento continua em aguardando_rubrica e o usuário já pode sair.
//   2. POST /api/m1/cron-ocr-lote (pg_cron, a cada minuto) pega os da fila na ordem de chegada,
//      passa cada um para processing_ocr no momento do envio (o relógio de "OCR travado", de 5 min,
//      começa aí) e chama o webhook de OCR, com no máximo PARALELO documentos em OCR ao mesmo tempo.
// A conciliação das notas de lote já é serializada por extrato em /api/m1/cron-conciliacao-lote,
// então o OCR não precisa mais ir um por vez para evitar disputa pelo mesmo lançamento.
(function (raiz, fabrica) {
    const api = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.FilaOcrLote = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const STATUS_FILA = 'aguardando_rubrica';
    // Documentos em OCR ao mesmo tempo (conta também os enviados fora da fila, como o upload avulso).
    const PARALELO = 3;
    // Um processing_ocr mais antigo que isto já é tratado como travado pelo banco (revisar_ocr_travado).
    const JANELA_EM_ANDAMENTO_MS = 5 * 60 * 1000;
    // Novo envio só começa se ainda couber uma espera inteira do n8n dentro dos 300 s da função.
    const ORCAMENTO_MS = 100000;
    const TIMEOUT_N8N_MS = 180000;
    const MAX_ITENS = 200;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Corpo do pedido -> [{ document_id, rubrica_id }] sem repetição, ou null se inválido.
    function itensDoPedido(itens) {
        if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS) return null;
        const vistos = new Set();
        const saida = [];
        for (const it of itens) {
            const documentId = it && typeof it.document_id === 'string' ? it.document_id.trim() : '';
            const rubricaId = it && typeof it.rubrica_id === 'string' ? it.rubrica_id.trim() : '';
            if (!UUID.test(documentId) || !UUID.test(rubricaId)) return null;
            if (vistos.has(documentId)) continue;
            vistos.add(documentId);
            saida.push({ document_id: documentId, rubrica_id: rubricaId });
        }
        return saida;
    }

    // Pode entrar na fila? Devolve null (pode) ou o motivo da recusa, em texto de tela.
    function motivoRecusa({ doc, rubrica, orgDoc, orgUsuario, usuarioId, papel }) {
        if (!doc || !orgDoc || orgDoc !== orgUsuario) return 'Documento não encontrado.';
        if (doc.user_id !== usuarioId && papel !== 'admin') return 'Só quem enviou o arquivo ou um administrador pode processá-lo.';
        if (doc.excluido_em) return 'O documento foi excluído.';
        if (doc.ocr_fila_em) return 'O documento já está na fila de processamento.';
        if (doc.status !== STATUS_FILA) return 'O documento já foi enviado para processamento.';
        if (!rubrica || rubrica.project_id !== doc.project_id) return 'Rubrica não encontrada no projeto do documento.';
        if (rubrica.ativa === false) return 'A rubrica escolhida está inativa no projeto.';
        return null;
    }

    // Extrato do lote só vale para documento do mesmo projeto (igual ao extratoOrigemPara do app.js).
    function extratoOrigemPara(doc, extrato) {
        if (!extrato || !doc) return null;
        return extrato.project_id === doc.project_id ? extrato.id : null;
    }

    function vagas(emAndamento, paralelo = PARALELO) {
        return Math.max(0, paralelo - Math.max(0, Number(emAndamento) || 0));
    }

    // Erro do PostgREST/Postgres de coluna inexistente: a migration do #202 ainda não foi aplicada.
    function colunaFilaAusente(erro) {
        if (!erro) return false;
        const msg = String(erro.message || '');
        return erro.code === '42703' || erro.code === 'PGRST204' || (/ocr_fila_em/.test(msg) && /(does not exist|could not find|não existe)/i.test(msg));
    }

    function payloadOcr(doc, fileUrl) {
        const corpo = { document_id: doc.id, file_path: doc.file_path, user_id: doc.user_id, bucket: 'documentos' };
        if (fileUrl) corpo.file_url = fileUrl;
        return corpo;
    }

    return { STATUS_FILA, PARALELO, JANELA_EM_ANDAMENTO_MS, ORCAMENTO_MS, TIMEOUT_N8N_MS, MAX_ITENS,
        itensDoPedido, motivoRecusa, extratoOrigemPara, vagas, colunaFilaAusente, payloadOcr };
});
