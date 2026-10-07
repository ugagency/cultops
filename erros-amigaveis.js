// erros-amigaveis.js — traduz erros técnicos (n8n, Supabase/Postgres, Storage,
// Auth, rede, JavaScript) em mensagens que o usuário entende. O texto original
// vai só para o console/log, para o suporte investigar.
//
// Roda no navegador (window.*) e no servidor (module.exports).
//
// Navegador:
//   showToast(...)          → cada showToast chama prestaiSuavizar(msg, type) antes de exibir
//   prestaiErroAmigavel(e, contexto)  → uso explícito, com frase genérica por contexto
//   prestaiN8nErro(status)  → Error com .status para respostas !ok do n8n
// Servidor:
//   const { traduzirTecnico } = require('./erros-amigaveis.js')
(function (root) {
    const GENERICO = {
        importar_projeto: 'Não foi possível importar o projeto do SALIC agora. Tente novamente em alguns instantes.',
        importar_rubricas: 'Não foi possível importar as rubricas agora. Confira se o arquivo é a Planilha Orçamentária oficial do SALIC e tente novamente.',
        upload_documento: 'O arquivo foi enviado, mas o processamento automático não foi iniciado. Tente novamente em instantes.',
        vincular_comprovante: 'Não foi possível processar o comprovante agora. Tente novamente em instantes.',
        conciliacao: 'Não foi possível iniciar a conciliação agora. Tente novamente em instantes.',
        relatorio: 'Não foi possível gerar o relatório agora. Tente novamente em instantes.',
        padrao: 'Não foi possível concluir a operação agora. Tente novamente em instantes. Se o problema continuar, fale com o suporte.'
    };

    const POR_STATUS = {
        401: 'Sua sessão expirou ou você não tem permissão para esta ação. Entre novamente.',
        403: 'Você não tem permissão para executar esta ação.',
        404: 'O serviço de automação está indisponível no momento. Tente novamente mais tarde.',
        408: 'A operação demorou mais que o esperado. Tente novamente.',
        413: 'O arquivo é grande demais. Envie um arquivo menor.',
        429: 'Muitas solicitações em sequência. Aguarde um instante e tente de novo.',
        502: 'O serviço está fora do ar no momento. Tente novamente em alguns minutos.',
        503: 'O serviço está fora do ar no momento. Tente novamente em alguns minutos.',
        504: 'A operação demorou mais que o esperado. Tente novamente.',
        524: 'A operação demorou mais que o esperado. Tente novamente.'
    };

    // Textos de negócio que o n8n/SALIC devolve e que já merecem frase própria.
    const CONHECIDOS = [
        [/j[aá] est[aá] importado/i, 'Projeto PRONAC já está importado para esta organização'],
        [/cr[a-z]*nciais (do )?salic n[aã]o encontradas/i, 'Suas credenciais do SALIC não foram encontradas. Cadastre-as em Configurações e tente novamente.'],
        [/projeto n[aã]o encontrado|n[aã]o encontrado no salic/i, 'Projeto não encontrado no SALIC. Verifique o número do PRONAC.']
    ];

    // Tradução específica de erros conhecidos de Supabase/Postgres/Storage/Auth, em ordem de prioridade.
    const TRADUCOES = [
        // Mensagens específicas e úteis: antes caíam na frase genérica (ex.: "...no Supabase" ou "JSON").
        [/cr[a-z]*nciais (do )?salic n[aã]o encontradas/i, 'Suas credenciais do SALIC não foram encontradas. Cadastre-as em Configurações e tente novamente.'],
        [/resposta vazia da ia|json retornado pela ia|interpretar o json/i, 'Não foi possível interpretar a leitura automática do documento. Tente novamente em instantes.'],
        [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
        [/email not confirmed/i, 'Confirme seu e-mail antes de entrar.'],
        [/user already registered|already been registered/i, 'Este e-mail já está cadastrado.'],
        [/password should be at least|weak.?password|password.*(too short|at least)/i, 'A senha é muito curta ou fraca. Use pelo menos 6 caracteres.'],
        [/same password|new password should be different/i, 'A nova senha precisa ser diferente da atual.'],
        [/rate limit|for security purposes|too many requests/i, 'Muitas tentativas em sequência. Aguarde um pouco e tente novamente.'],
        [/jwt expired|invalid jwt|auth session missing|refresh token|session (expired|not found)|not authenticated/i, 'Sua sessão expirou. Entre novamente.'],
        [/invalid key/i, 'O nome do arquivo contém caracteres não aceitos. Renomeie o arquivo e tente novamente.'],
        [/payload too large|exceeded the maximum allowed size|file size|entity too large/i, 'O arquivo é grande demais. Envie um arquivo menor.'],
        [/mime type|not supported|unsupported media/i, 'Este tipo de arquivo não é aceito.'],
        [/bucket not found|object not found|resource was not found/i, 'Arquivo não encontrado.'],
        [/row-level security|permission denied|42501|not allowed|insufficient[_ ]privilege/i, 'Você não tem permissão para realizar esta ação.'],
        [/duplicate key|23505|already exists|resource already exists/i, 'Este registro já existe.'],
        [/foreign key|23503/i, 'Esta operação não é possível porque o item está ligado a outros registros.'],
        [/null value in column|23502|not-null/i, 'Preencha todos os campos obrigatórios.'],
        [/check constraint|23514/i, 'Algum valor informado não é válido.'],
        [/invalid input (syntax|value)|22p02|out of range|22003/i, 'Algum valor informado não é válido.'],
        [/value too long|22001/i, 'Algum texto informado é longo demais.'],
        [/pgrst116|json object requested|cannot coerce|no rows/i, 'Registro não encontrado.'],
        [/statement timeout|canceling statement|57014/i, 'A operação demorou mais que o esperado. Tente novamente.'],
        [/abort|timed out|timeout/i, 'A operação demorou mais que o esperado. Tente novamente.'],
        [/failed to fetch|networkerror|load failed|econnrefused|enotfound|econnreset|socket hang up|network request failed/i, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.']
    ];

    // Sinais de texto técnico/nativo (inglês, n8n, rede, SQL, JS).
    const TECNICO = /workflow|webhook|n8n|\bnode\b|econn|etimedout|enotfound|socket|fetch|failed to|network|\bhttp|status code|timeout|timed out|abort|unexpected token|\bjson\b|undefined|\bnull\b|typeerror|syntaxerror|referenceerror|rangeerror|cannot read|is not a function|is not defined|stack|exception|violates|constraint|relation "|column "|\brls\b|row-level|\bjwt\b|supabase|postgres|pgrst|\berror\b|\bexecution\b|\binvalid\b|\bnot found\b|\bunauthorized\b|\bforbidden\b|\bpermission\b|\bduplicate\b|\bexpired\b|\bpayload\b|\bbucket\b|n[aã]o configurad|erro no processamento|erro de comunica|erro t[eé]cnico|servidor n8n|42501|22p02/i;

    function texto(origem) {
        if (origem == null) return '';
        if (typeof origem === 'string') return origem;
        if (origem instanceof Error) return origem.message || '';
        if (typeof origem === 'object') return String(origem.aviso || origem.message || origem.error || origem.msg || '');
        return String(origem);
    }

    // Devolve a frase amigável se o texto for técnico; null se já estiver escrito para o usuário.
    function traduzirTecnico(bruto, generico) {
        const original = String(bruto || '');
        if (!original) return null;
        const t = original.replace(/https?:\/\/\S+/gi, ''); // link é dado, não sinal de erro técnico
        for (const [regex, frase] of TRADUCOES) {
            if (regex.test(t)) return frase;
        }
        if (TECNICO.test(t)) return generico || GENERICO.padrao;
        return null;
    }

    // Para toasts/mensagens montadas como "Prefixo: <erro cru>". Mantém o prefixo
    // e troca só a parte técnica; mensagens já amigáveis passam sem alteração.
    function suavizar(msg, type, generico) {
        if (typeof msg !== 'string' || !msg) return msg;
        if (type && type !== 'error' && type !== 'warning') return msg;
        const direto = traduzirTecnico(msg, generico);
        if (direto === null) return msg;
        const i = msg.indexOf(': ');
        if (i > 0 && i < 60) {
            const prefixo = msg.slice(0, i).trim();
            const cauda = msg.slice(i + 2);
            const caudaTrad = traduzirTecnico(cauda, generico);
            const prefixoTecnico = traduzirTecnico(prefixo, generico) !== null;
            if (caudaTrad !== null && !prefixoTecnico && !/^erro$/i.test(prefixo) && !/erro t[eé]cnico|falha t[eé]cnica/i.test(prefixo)) {
                return prefixo + ': ' + caudaTrad;
            }
        }
        return direto;
    }

    function erroAmigavel(origem, contexto) {
        const generico = GENERICO[contexto] || GENERICO.padrao;
        const bruto = texto(origem);
        if (bruto || origem) console.error('[erro/' + (contexto || 'padrao') + ']', origem);

        if (origem && origem.name === 'AbortError') return POR_STATUS[504];
        for (const [regex, frase] of CONHECIDOS) {
            if (regex.test(bruto)) return frase;
        }
        const status = origem && origem.status;
        if (status && POR_STATUS[status]) return POR_STATUS[status];
        if (status) return generico;
        if (!bruto) return generico;
        const trad = traduzirTecnico(bruto, generico);
        return trad === null ? bruto : trad;
    }

    function n8nErro(status) {
        const e = new Error('HTTP ' + status);
        e.status = status;
        e.n8n = true;
        return e;
    }

    const api = { traduzirTecnico, suavizar, erroAmigavel, n8nErro };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.prestaiN8nErro = n8nErro;
        root.prestaiErroAmigavel = erroAmigavel;
        root.prestaiErroTexto = function (e) { return erroAmigavel(e); };
        root.prestaiSuavizar = function (msg, type) {
            try { return suavizar(msg, type); } catch (_) { return msg; }
        };
    }
})(typeof window !== 'undefined' ? window : null);
