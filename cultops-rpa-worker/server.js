// teste de deploy automatico - 21/08
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const {
    criarControleDeNavegador, criarLimitadorPorUsuario, lerLimiteDoAmbiente, criarHandlerValidarCredencial
} = require('./salic_validar_login.cjs');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuração Supabase
// Injeta 'ws' como transport para suportar Node < 22 (sem WebSocket nativo)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
);

app.use(cors());
app.use(express.json());

// Rota de Health Check
app.get('/', (req, res) => {
    res.json({ status: 'Cultopps RPA Worker is online' });
});

// SPEC-SEC-01 Fix 2 (Achado A): mesmo problema do server.js da raiz — este é
// o worker real (Dockerfile próprio, Chromium de verdade), então é aqui que
// a vulnerabilidade importava de fato. Exige token de sessão válido, deriva
// o userId dele em vez de confiar no body.
async function exigirUsuarioAutenticado(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Token de autenticação ausente.' });
    }
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
    req.userId = data.user.id;
    next();
}

// Controle de uso do navegador (ocorrência #64): a validação de credencial é exclusiva e só
// roda com nenhum envio, captura ou outra validação em andamento; envio e captura se
// registram aqui (sem fila entre si, como antes) e esperam uma validação em curso terminar.
const controleNavegador = criarControleDeNavegador();
// Limite por usuário da validação (em memória). Configurável por ambiente:
// SALIC_VALIDAR_MAX (padrão 3) e SALIC_VALIDAR_JANELA_MIN (padrão 15).
const limiteValidacao = lerLimiteDoAmbiente();
const limitadorValidacao = criarLimitadorPorUsuario(limiteValidacao);

// Bug #2: a Data do Pagamento no SALIC deve vir do lançamento bancário
// conciliado (extratos_lancamentos.data_lancamento = data do débito),
// NUNCA de documents.data_emissao (data de emissão da NF).
function resolverDataPagamento(lancamento, doc) {
    // Fonte 1: data real do lançamento bancário (sempre preferida)
    if (lancamento?.data_lancamento) {
        console.log(`[SERVER] data_pagamento: ${lancamento.data_lancamento} (fonte: extratos_lancamentos)`);
        return lancamento.data_lancamento;
    }
    // Fonte 2: documents.data_pagamento, se preenchido
    if (doc.data_pagamento) {
        console.warn(`[SERVER] data_pagamento: ${doc.data_pagamento} (fonte: documents.data_pagamento — fallback)`);
        return doc.data_pagamento;
    }
    // Fonte 3: último recurso — data_emissao com aviso
    console.warn(`[SERVER] AVISO: usando data_emissao como último fallback. Verificar conciliação do documento ${doc.id}`);
    return doc.data_emissao;
}

// Bug #1: formata o "Nº Documento de Pagamento" enviado ao SALIC.
// TED interbancária do BB vem como AAA.BBB.CCC.DDD.EEE (15 dígitos); a conta
// destino são os ÚLTIMOS 6 dígitos (DDD.EEE). Truncar em 10 (slice(-10))
// pegava dígitos do meio e gerava número errado. Docs curtos (PIX/boleto)
// seguem com zero-pad direto.
// Casos validados:
//   TED BB:  "551.614.000.114.014" -> "0000114014"
//   PIX:     "42.001"              -> "0000042001"
//   Boleto:  "42.205"              -> "0000042205"
function formatarNrDocPagamento(docExtrato) {
    if (!docExtrato) return '';

    // Remove tudo que não é dígito
    const limpo = String(docExtrato).replace(/\D/g, '');

    if (limpo.length >= 13) {
        // TED interbancária BB — conta destino = últimos 6 dígitos
        const contaDestino = limpo.slice(-6);
        const resultado = contaDestino.padStart(10, '0');
        console.log(`[SERVER] Nr.DocPagamento: "${docExtrato}" → TED → conta "${contaDestino}" → "${resultado}"`);
        return resultado;
    }

    // PIX direto, boleto, doc curto — zero-pad direto
    const resultado = limpo.padStart(10, '0');
    console.log(`[SERVER] Nr.DocPagamento: "${docExtrato}" → curto → "${resultado}"`);
    return resultado;
}

// Endpoint SALIC. O corpo está em executarEnvioSalic para poder ser testado fora do Express.
// O dry-run só é ligado por quem chama a função (opcoes.dryRun); a rota NUNCA o lê do body.
app.post('/api/salic/inserir', exigirUsuarioAutenticado, (req, res) => executarEnvioSalic(req, res));

// Dry-run (ocorrência #119): o worker preenche e audita o formulário sem clicar em Salvar, e
// aqui nada é gravado em documents nem em despesas (status, data_salic, protocolo_salic,
// just_erro), nem em sucesso nem em erro.
async function executarEnvioSalic(req, res, { dryRun = false } = {}) {
    const { executarInsercaoSalic } = require('./salic_insertion.cjs');
    const { documentId } = req.body;
    const userId = req.userId; // do token verificado, não do body

    if (!documentId) return res.status(400).json({ error: 'ID do documento não fornecido.' });

    try {
        console.log(`[API] Iniciando processo para documento: ${documentId}${dryRun ? ' (DRY-RUN: nada será salvo no SALIC nem em documents/despesas)' : ''}`);

        const { data: creds, error: credError } = await supabase
            .from('decrypted_external_credentials')
            .select('*')
            .eq('user_id', userId)
            .eq('service_name', 'salic')
            .single();

        if (credError || !creds) {
            throw new Error('Credenciais SALIC não encontradas para este usuário no Supabase.');
        }

        const { data: doc, error: docError } = await supabase
            .from('documents')
            .select('*, projects(pronac)')
            .eq('id', documentId)
            .single();

        if (docError || !doc) throw new Error('Documento não encontrado no banco de dados.');

        console.log(`[API] Documento: ${doc.name} | Rubrica: ${doc.rubrica}`);

        // Segunda camada de proteção (a primeira é o botão desabilitado no
        // front, app.js@main) — bloqueia também chamada direta à API com
        // dado obrigatório faltando, pra não deixar o SALIC com dado incompleto.
        const camposFaltando = [
            !doc.cnpj_emissor && 'CNPJ/CPF',
            !doc.nome_emissor && 'Fornecedor',
            (!doc.valor || Number(doc.valor) === 0) && 'Valor',
            !doc.data_emissao && 'Data de Emissão',
            !doc.numero_nf && 'Nr. Comprovante',
        ].filter(Boolean);
        if (camposFaltando.length > 0) {
            throw new Error(`Faltam dados obrigatórios para enviar ao SALIC: ${camposFaltando.join(', ')}.`);
        }

        // Rubrica SOMENTE por UUID (documents.rubrica_id_fk -> rubricas.id). As antigas estrategias
        // por prefixo numerico e por nome (ILIKE) eram ambiguas (ocorrencia #119): sem
        // rubrica_id_fk, erro.
        if (!doc.rubrica_id_fk) {
            throw new Error(`Documento ${doc.id} sem rubrica vinculada (rubrica_id_fk vazio) | rubrica (texto): "${doc.rubrica}". Vincule a rubrica antes de enviar ao SALIC.`);
        }
        const { data: rubrica } = await supabase
            .from('rubricas')
            .select('nome, etapa, valor_aprovado, rubrica_id, produto')
            .eq('id', doc.rubrica_id_fk)
            .single();
        if (!rubrica) {
            throw new Error(`Rubrica não encontrada para documento ${doc.id} | rubrica_id_fk: ${doc.rubrica_id_fk}`);
        }
        console.log(`[API] Rubrica por UUID: "${rubrica.nome}"` +
            ` | ID: ${rubrica.rubrica_id}` +
            ` | Etapa: ${rubrica.etapa}` +
            ` | Valor: R$ ${rubrica.valor_aprovado}` +
            ` | Produto: ${rubrica.produto || '(sem produto)'}`);

        const rubricaValorAprovado = rubrica.valor_aprovado;
        const rubricaEtapa = rubrica.etapa;
        const rubricaProduto = rubrica.produto || null;

        // CHG-13 (rev): numero_extrato vem de documents.fitid (RPA usa os ultimos 10 digitos / zero-pad).
        // Fallback: extratos_bancarios.documento_referencia via despesas.extrato_vinculado_id.
        let numeroExtrato = (doc.fitid && String(doc.fitid).trim().length > 0) ? String(doc.fitid).trim() : null;
        if (numeroExtrato) {
            console.log(`[API] numero_extrato (fitid): ${numeroExtrato}`);
        } else {
            const { data: despesaLink } = await supabase
                .from('despesas')
                .select('extratos_bancarios:extrato_vinculado_id(documento_referencia)')
                .eq('document_id', documentId)
                .maybeSingle();
            if (despesaLink?.extratos_bancarios?.documento_referencia) {
                numeroExtrato = despesaLink.extratos_bancarios.documento_referencia;
                console.log(`[API] numero_extrato (fallback extrato): ${numeroExtrato}`);
            } else {
                console.warn('[API] AVISO: documents.fitid vazio e sem extrato vinculado. RPA usara numero como fallback.');
            }
        }

        // Bug #2: busca a data real de pagamento (débito) do lançamento conciliado.
        // NÃO filtrar por `tipo` (essa coluna guarda texto longo da justificativa, não 'debito').
        const { data: lancamento } = await supabase
            .from('extratos_lancamentos')
            .select('data_lancamento, fitid, memo')
            .eq('document_id', documentId)
            .eq('status_conciliacao', 'conciliado')
            .order('data_lancamento', { ascending: false })
            .limit(1)
            .maybeSingle();

        const dataPagamento = resolverDataPagamento(lancamento, doc);

        // Bucket "documentos" privado (ocorrência #85): o robô baixa a NF por URL assinada,
        // válida por 1 hora. O file_path pode vir com espaço no fim, por isso o trim. A
        // mensagem de erro não leva o caminho nem a URL.
        const nfPath = String(doc.file_path || '').trim();
        const { data: nfAssinada, error: nfAssinadaErro } = await supabase.storage
            .from('documentos')
            .createSignedUrl(nfPath, 3600);
        if (nfAssinadaErro || !nfAssinada || !nfAssinada.signedUrl) {
            throw new Error('Não foi possível gerar URL do arquivo da NF.');
        }

        const config = {
            usuario: String(creds.identifier),
            senha: String(creds.secret_plain),
            pronac: String(doc.projects.pronac),
            rubricaNome: rubrica.nome,   // nome da tabela rubricas, não o texto livre doc.rubrica
            dryRun,
            rubricaValorAprovado: rubricaValorAprovado,
            rubricaEtapa: rubricaEtapa,
            rubricaProduto: rubricaProduto,
            documento: {
                cnpj_fornecedor: doc.cnpj_emissor,
                valor: doc.valor,
                numero: doc.numero_nf || 'S/N',   // json_extraido.numero_nota nunca é escrito pela extração — fallback removido
                data_emissao: doc.data_emissao,   // Data de Emissão real da NF/recibo (#dataEmissao)
                data_pagamento: dataPagamento,    // Bug #2: Data do Pagamento = data do débito (#dtPagamento)
                nf_path: nfPath,
                nf_url: nfAssinada.signedUrl,
                recibo: doc.recibo,   // flag de tipo: 'yes' = Recibo, 'no' = NF (NÃO é caminho de arquivo)
                numero_extrato: formatarNrDocPagamento(numeroExtrato),
                numero_guia: doc.json_extraido?.guia?.numero_guia || null,   // sinal de Guia de Recolhimento p/ o worker
                justificativa_salic: (doc.justificativa_salic || '').toString().trim() || null,   // rubrica excedida: preenche #dsJustificativa
            }
        };

        const resultado = await controleNavegador.executar(() => executarInsercaoSalic(config));

        if (resultado.sucesso && dryRun) {
            return res.json({
                success: true, dryRun: true,
                rubricaNome: rubrica.nome, rubricaProduto, matchType: resultado.matchType, rubricaCasada: resultado.rubricaCasada,
                valor: config.documento.valor, dataPagamento: config.documento.data_pagamento,
                screenshot: resultado.screenshot, auditoria: resultado.auditoria
            });
        }

        if (resultado.sucesso) {
            await supabase.from('documents').update({
                status: 'enviado_salic',
                protocolo_salic: resultado.protocolo
            }).eq('id', documentId);

            // CR-2026-001 Fase 0: marca a despesa como confirmada no SALIC.
            // v_saldo_rubricas usa data_salic para diferenciar "já absorvido
            // pelo SALIC" de "em trânsito" — sem isso a despesa fica presa
            // em em_transito mesmo depois de enviada.
            await supabase.from('despesas').update({
                data_salic: new Date().toISOString(),
                protocolo_salic: resultado.protocolo
            }).eq('document_id', documentId);

            return res.json({ success: true, protocol: resultado.protocolo });
        } else {
            throw new Error(resultado.erro);
        }
    } catch (error) {
        console.error('[API] Erro ao processar:', error.message);
        if (!dryRun) {
            await supabase.from('documents').update({
                status: 'erro_rpa',
                just_erro: error.message
            }).eq('id', documentId);
        }
        res.status(500).json({ error: error.message });
    }
}

// Valida o login do SALIC antes de a credencial ser salva (ocorrência #64). Body:
// { usuario, senha } (texto, até 64 caracteres cada). Responde 200 com
// { status: 'ok' | 'invalida' | 'indeterminada', motivo }, 400 para corpo inválido e 429
// com { status: 'ocupado' } ou { status: 'limite', tentarEm } (segundos). Não loga o corpo
// e nunca repete o login sozinho.
app.post('/api/salic/validar-credencial', exigirUsuarioAutenticado,
    criarHandlerValidarCredencial({ controle: controleNavegador, limitador: limitadorValidacao }));

// ==============================================================
// SALDO SALIC — Fase 1/4 (CR-2026-001)
// Captura read-only do relatório de Execução Física + pareamento +
// detecção de divergências (autodiagnóstico, Fase 4.2).
// ==============================================================
app.post('/capturar-execucao', exigirUsuarioAutenticado, async (req, res) => {
    const { executarCapturaProjeto } = require('./salic_saldo_orquestrador.cjs');
    const { projectId } = req.body;
    const userId = req.userId;

    if (!projectId) return res.status(400).json({ error: 'projectId não fornecido.' });

    try {
        const { data: project, error: projectErr } = await supabase
            .from('projects')
            .select('pronac, organization_id')
            .eq('id', projectId)
            .single();
        if (projectErr || !project) throw new Error('Projeto não encontrado.');

        const { data: creds, error: credError } = await supabase
            .from('decrypted_external_credentials')
            .select('*')
            .eq('user_id', userId)
            .eq('service_name', 'salic')
            .single();
        if (credError || !creds) throw new Error('Credenciais SALIC não encontradas para este usuário.');

        console.log(`[SALDO-SALIC] Iniciando captura manual | projeto: ${projectId} | PRONAC: ${project.pronac}`);

        const resultado = await controleNavegador.executar(() => executarCapturaProjeto(supabase, {
            projectId,
            pronac: String(project.pronac),
            organizationId: project.organization_id,
            usuario: String(creds.identifier),
            senha: String(creds.secret_plain),
            disparadaPor: userId
        }));

        console.log(`[SALDO-SALIC] Captura concluída | total: ${resultado.total} | pareadas: ${resultado.pareadas} | fila: ${resultado.fila} | divergências: ${resultado.divergencias}`);
        return res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('[SALDO-SALIC] Erro na captura:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// ==============================================================
// SALDO SALIC — Fase 4.1 (CR-2026-001)
// Rede de segurança: captura condicional para projetos ativos sem
// captura sucesso nas últimas 4h. Mesmo padrão de cron HTTP-protegido
// do server.js principal (/api/m2/cron-alerta-guias): um scheduler
// EXTERNO chama este endpoint periodicamente (não setInterval/node-cron
// dentro do processo) — configurar fora deste repo, com o mesmo
// x-cron-secret/CRON_SECRET. Intervalo sugerido do scheduler: 30-60min
// (a condição de 4h é aplicada aqui dentro, não pelo scheduler).
// ==============================================================
app.post('/cron/captura-condicional', async (req, res) => {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Não autorizado.' });
    }

    const { executarCapturaProjeto } = require('./salic_saldo_orquestrador.cjs');
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // BUG 4: sem teto, a primeira execução podia disparar uma sequência
    // longa de acessos ao portal do governo numa chamada só. A função SQL
    // já devolve os mais atrasados primeiro (nunca capturados, depois
    // captura sucesso mais antiga) — só pegamos os N primeiros.
    const MAX_PROJETOS_POR_CHAMADA = 5;

    const { data: elegiveisTodos, error: elegErr } = await supabase.rpc('saldo_salic_projetos_elegiveis_captura');
    if (elegErr) return res.status(500).json({ error: elegErr.message });

    const elegiveis = (elegiveisTodos || []).slice(0, MAX_PROJETOS_POR_CHAMADA);
    const foraDoLote = (elegiveisTodos || []).slice(MAX_PROJETOS_POR_CHAMADA).map(p => p.project_id);
    if (foraDoLote.length > 0) {
        console.log(`[SALDO-SALIC][cron] ${foraDoLote.length} projeto(s) elegível(is) ficaram de fora deste lote (limite ${MAX_PROJETOS_POR_CHAMADA}): ${foraDoLote.join(', ')}`);
    }

    const resultados = [];
    for (const projeto of elegiveis) {
        try {
            if (!projeto.sugestao_user_id) {
                console.warn(`[SALDO-SALIC][cron] Projeto ${projeto.project_id} elegível mas sem usuário disparador conhecido — pulando.`);
                resultados.push({ projectId: projeto.project_id, pulado: 'sem_usuario' });
                continue;
            }

            const { data: creds, error: credError } = await supabase
                .from('decrypted_external_credentials')
                .select('*')
                .eq('user_id', projeto.sugestao_user_id)
                .eq('service_name', 'salic')
                .maybeSingle();
            if (credError || !creds) {
                console.warn(`[SALDO-SALIC][cron] Sem credencial SALIC para o usuário sugerido do projeto ${projeto.project_id} — pulando.`);
                resultados.push({ projectId: projeto.project_id, pulado: 'sem_credencial' });
                continue;
            }

            console.log(`[SALDO-SALIC][cron] Captura condicional | projeto: ${projeto.project_id} | PRONAC: ${projeto.pronac}`);
            const resultado = await controleNavegador.executar(() => executarCapturaProjeto(supabase, {
                projectId: projeto.project_id,
                pronac: String(projeto.pronac),
                organizationId: projeto.organization_id,
                usuario: String(creds.identifier),
                senha: String(creds.secret_plain),
                disparadaPor: projeto.sugestao_user_id
            }));
            resultados.push({ projectId: projeto.project_id, ...resultado });
        } catch (error) {
            console.error(`[SALDO-SALIC][cron] Erro no projeto ${projeto.project_id}:`, error.message);
            resultados.push({ projectId: projeto.project_id, erro: error.message });
        }

        // Cortesia entre projetos — não bate no portal do governo em rajada.
        await wait(3000);
    }

    return res.json({
        success: true,
        processados: resultados.length,
        resultados,
        fora_do_lote: foraDoLote.length,
        projetos_fora_do_lote: foraDoLote
    });
});

// Tratamento de erros global para evitar crash do processo
app.use((err, req, res, next) => {
    console.error('[GLOBAL ERROR]', err);
    res.status(500).json({ error: 'Erro interno no servidor', details: err.message });
});

// Só abre a porta quando é o processo principal (node server.js); os testes importam o módulo.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`[RPA WORKER] Rodando na porta ${PORT}`);
    });
}

module.exports = { executarEnvioSalic };
