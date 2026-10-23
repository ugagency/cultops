// Códigos estáveis dos erros gravados em documents.just_erro, para o front tratar por código e
// não pelo texto. Formato: "[CODIGO] mensagem" (o texto original continua depois do prefixo).
// Só prefixo e mensagem: nenhuma regra de negócio mora aqui.

const CODIGOS = Object.freeze([
    'RUBRICA_NAO_VINCULADA',
    'RUBRICA_INEXISTENTE',
    'RUBRICA_NAO_ENCONTRADA_SALIC',
    'RUBRICA_TELA_DIVERGENTE',
    'VALOR_PAGO_INDETERMINADO',
    'LANCAMENTO_DIVIDIDO',
    'VALOR_MAIOR_QUE_NOTA',
    'DATA_PAGAMENTO_SEM_LANCAMENTO',
    'DADOS_OBRIGATORIOS_FALTANDO',
    'CREDENCIAL_SALIC_AUSENTE',
    'ARQUIVO_NF_INDISPONIVEL',
    'FORNECEDOR_NAO_ENCONTRADO_SALIC',
    'LOGIN_SALIC_RECUSADO',
    'TEMPO_ESGOTADO_SALVAMENTO',
    'ERRO_RPA_GENERICO',
]);

const GENERICO = 'ERRO_RPA_GENERICO';
// Mensagem que já começa com "[CODIGO] " (código da lista): não ganha um segundo prefixo.
const PREFIXO = /^\[([A-Z][A-Z0-9_]*)\]\s/;
const jaTemCodigo = (texto) => { const m = PREFIXO.exec(texto); return !!m && CODIGOS.includes(m[1]); };

// "[CODIGO] mensagem". Se a mensagem já tem prefixo, devolve como está (prefixo único; vale o
// primeiro código, que é o de quem entende o erro mais de perto). Código fora da lista é bug.
function comCodigo(codigo, mensagem) {
    if (!CODIGOS.includes(codigo)) throw new Error(`Codigo de erro desconhecido: ${codigo}`);
    const texto = String(mensagem == null ? '' : mensagem);
    return jaTemCodigo(texto) ? texto : `[${codigo}] ${texto}`;
}

// Garante prefixo: mensagem sem código vira [ERRO_RPA_GENERICO].
function garantirCodigo(mensagem) {
    return comCodigo(GENERICO, mensagem);
}

// Código de uma mensagem prefixada, ou ERRO_RPA_GENERICO.
function extrairCodigo(mensagem) {
    const m = PREFIXO.exec(String(mensagem == null ? '' : mensagem));
    return m && CODIGOS.includes(m[1]) ? m[1] : GENERICO;
}

// new Error('[CODIGO] mensagem') com o código também em error.codigo.
function erroComCodigo(codigo, mensagem) {
    const erro = new Error(comCodigo(codigo, mensagem));
    erro.codigo = codigo;
    return erro;
}

module.exports = { CODIGOS, GENERICO, comCodigo, garantirCodigo, extrairCodigo, erroComCodigo };
