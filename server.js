require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const {
    Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
    WidthType, ShadingType, PageBreak, AlignmentType, HeadingLevel, ExternalHyperlink,
} = require('docx');
const { imageSize } = require('image-size');

// ─── Resend ───────────────────────────────────────────────────────────────────
const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

async function sendEmail({ to, subject, html }) {
    if (!resend) {
        console.warn('[Resend] RESEND_API_KEY não configurada — e-mail ignorado.');
        return false;
    }
    try {
        const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
        if (error) { console.error('[Resend] Erro ao enviar:', error); return false; }
        console.log('[Resend] E-mail enviado:', data.id);
        return true;
    } catch (err) {
        console.error('[Resend] Exceção:', err.message);
        return false;
    }
}

// ─── Templates de e-mail ──────────────────────────────────────────────────────
function _emailBase(corHeader, titulo, corpo) {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#F5F5F5;padding:24px">
  <div style="background:#1547FF;padding:24px;border-radius:8px 8px 0 0">
    <h1 style="color:#70FF00;margin:0;font-size:20px">prestaí</h1>
  </div>
  <div style="background:#ffffff;padding:24px;border-radius:0 0 8px 8px">
    <h2 style="color:${corHeader};margin:0 0 16px">${titulo}</h2>
    ${corpo}
    <p style="color:#666;font-size:12px;margin:24px 0 0;border-top:1px solid #eee;padding-top:16px">
      prestaí · Prestação de Contas Inteligente
    </p>
  </div>
</div>`;
}

function _tabelaEvidencia(rows) {
    return `<table style="width:100%;border-collapse:collapse;margin:16px 0">${rows.map(([k, v]) =>
        `<tr><td style="padding:8px;background:#F5F5F5;color:#666;font-size:13px;width:40%">${k}</td>
             <td style="padding:8px;font-size:13px">${v}</td></tr>`
    ).join('')}</table>`;
}

function emailEvidenciaAprovada({ nomeArquivo, nomeProjeto, pronac, aprovadoPor, dataAprovacao }) {
    const corpo = `<p style="color:#333;margin:0 0 8px">Sua evidência foi analisada e aprovada.</p>
        ${_tabelaEvidencia([['Arquivo', `<strong>${nomeArquivo}</strong>`], ['Projeto', nomeProjeto], ['PRONAC', pronac], ['Aprovado por', aprovadoPor], ['Data', dataAprovacao]])}`;
    return {
        subject: `✅ Evidência aprovada — ${nomeProjeto}`,
        html: _emailBase('#1547FF', 'Evidência aprovada ✅', corpo)
    };
}

function emailEvidenciaReprovada({ nomeArquivo, nomeProjeto, pronac, motivoReprovacao, reprovadoPor, dataReprovacao }) {
    const bloco = `<div style="background:#fee2e2;padding:12px;border-radius:6px;border-left:4px solid #dc2626;margin:16px 0">
        <p style="margin:0;color:#991b1b;font-size:13px;font-weight:bold">Motivo da reprovação:</p>
        <p style="margin:4px 0 0;color:#7f1d1d;font-size:13px">${motivoReprovacao}</p></div>`;
    const corpo = `<p style="color:#333;margin:0 0 8px">Sua evidência foi analisada e reprovada. Por favor, faça o reenvio com as correções indicadas.</p>
        ${bloco}${_tabelaEvidencia([['Arquivo', `<strong>${nomeArquivo}</strong>`], ['Projeto', nomeProjeto], ['PRONAC', pronac], ['Reprovado por', reprovadoPor], ['Data', dataReprovacao]])}`;
    return {
        subject: `❌ Evidência reprovada — ${nomeProjeto}`,
        html: _emailBase('#dc2626', 'Evidência reprovada ❌', corpo)
    };
}

function emailComplementoSolicitado({ nomeArquivo, nomeProjeto, pronac, descricaoComplemento }) {
    const bloco = `<div style="background:#fef9c3;padding:12px;border-radius:6px;border-left:4px solid #d97706;margin:16px 0">
        <p style="margin:0;color:#854d0e;font-size:13px;font-weight:bold">O que precisa ser complementado:</p>
        <p style="margin:4px 0 0;color:#713f12;font-size:13px">${descricaoComplemento}</p></div>`;
    const corpo = `<p style="color:#333;margin:0 0 8px">O analista solicitou informações adicionais para sua evidência.</p>
        ${bloco}${_tabelaEvidencia([['Arquivo', `<strong>${nomeArquivo}</strong>`], ['Projeto', nomeProjeto], ['PRONAC', pronac]])}`;
    return {
        subject: `⚠️ Complemento solicitado — ${nomeProjeto}`,
        html: _emailBase('#d97706', 'Complemento solicitado ⚠️', corpo)
    };
}

function emailAlertaGuiaVencendo({ nomeProjeto, pronac, guias }) {
    const linhas = guias.map(g => `<tr>
        <td style="padding:8px;font-size:13px">${g.tipo_imposto}</td>
        <td style="padding:8px;font-size:13px">${g.competencia}</td>
        <td style="padding:8px;font-size:13px;font-weight:bold">R$ ${Number(g.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
        <td style="padding:8px;font-size:13px;color:#dc2626;font-weight:bold">${new Date(g.data_vencimento).toLocaleDateString('pt-BR')}</td>
    </tr>`).join('');
    const tabela = `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
        <thead><tr style="background:#F5F5F5">
            <th style="padding:8px;text-align:left;color:#666">Tipo</th>
            <th style="padding:8px;text-align:left;color:#666">Competência</th>
            <th style="padding:8px;text-align:left;color:#666">Valor</th>
            <th style="padding:8px;text-align:left;color:#dc2626">Vencimento</th>
        </tr></thead><tbody>${linhas}</tbody></table>`;
    const corpo = `<p style="color:#333;margin:0 0 16px">As seguintes guias de imposto vencem nos próximos 7 dias:</p>${tabela}`;
    return {
        subject: `⏰ ${guias.length} guia(s) vencendo em breve — ${nomeProjeto}`,
        html: _emailBase('#d97706', '⏰ Guias vencendo em 7 dias', corpo)
    };
}
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Supabase (Backend usa Service Role para bypassar RLS e descriptografar)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Use a chave service_role para ler credenciais descriptografadas
);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Respostas de erro nunca levam texto técnico (Supabase/Postgres/Node/n8n) ao usuário:
// o original vai para o log e o cliente recebe a tradução. Mensagens já escritas
// em português para o usuário passam sem alteração.
const { traduzirTecnico } = require('./erros-amigaveis.js');
const Catalogo = require('./status-catalogo.js');
const Regras = require('./suporte-regras.js');
app.use((req, res, next) => {
    const jsonOriginal = res.json.bind(res);
    res.json = (body) => {
        try {
            if (body && typeof body === 'object' && !Array.isArray(body) && (res.statusCode >= 400 || body.success === false)) {
                for (const campo of ['error', 'message', 'aviso']) {
                    if (typeof body[campo] !== 'string') continue;
                    const amigavel = traduzirTecnico(body[campo]);
                    if (amigavel !== null) {
                        console.warn('[erro traduzido]', req.method, req.originalUrl, '→', body[campo]);
                        body = { ...body, [campo]: amigavel };
                    }
                }
            }
        } catch (_) { /* nunca impedir a resposta */ }
        return jsonOriginal(body);
    };
    next();
});

// --- Auth middlewares (S1-A) ---
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token não fornecido.' });
    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data?.user) return res.status(401).json({ error: 'Token inválido.' });
        req.user = data.user;
        // Role canônico vem de app_metadata; cai em user_metadata por compatibilidade
        req.userRole = data.user.app_metadata?.role || data.user.user_metadata?.role || null;
        next();
    } catch (err) {
        console.error('[AUTH] requireAuth:', err);
        return res.status(401).json({ error: 'Falha na autenticação.' });
    }
}

function requireRole(...allowed) {
    return (req, res, next) => {
        if (!req.userRole || !allowed.includes(req.userRole)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }
        next();
    };
}

// Perfil interno SSYS: atravessa organizações (claim direto no usuário,
// fora de organization_users). Usar sempre APÓS requireAuth, que popula
// req.user. Bootstrap do claim é manual, via SQL — sem UI para conceder.
function requirePlatformAdmin(req, res, next) {
    const isPlatformAdmin =
        req.user?.app_metadata?.is_platform_admin === true;
    if (!isPlatformAdmin) {
        return res.status(403).json({
            error: 'Acesso restrito à equipe SSYS.'
        });
    }
    next();
}

// Separa "ver qualquer organização pra diagnóstico" de "criar/editar
// organização" — is_platform_admin continua passando aqui (não perde acesso
// de leitura por não ter a flag nova), mas o inverso não vale: is_suporte
// sozinho não dá acesso de escrita (requirePlatformAdmin continua exigindo
// especificamente is_platform_admin).
function requireSuporte(req, res, next) {
    const autorizado =
        req.user?.app_metadata?.is_suporte === true ||
        req.user?.app_metadata?.is_platform_admin === true;
    if (!autorizado) {
        return res.status(403).json({ error: 'Acesso restrito à equipe de suporte/plataforma SSYS.' });
    }
    next();
}

// Rota para servir o config.js dinamicamente ao navegador
app.get('/config.js', (req, res) => {
    const publicConfig = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_KEY: process.env.SUPABASE_ANON_KEY,
        N8N_WEBHOOK_URL: "https://automacoes-n8n.infrassys.com/webhook/cultops-ocr",
        N8N_WEBHOOK_RECONCILIATION_URL: "https://automacoes-n8n.infrassys.com/webhook/prestai-conciliation",
        N8N_WEBHOOK_RECONCILIATION_LOTE_URL: "https://automacoes-n8n.infrassys.com/webhook/prestai-conciliation-lote",
        N8N_WEBHOOK_VALIDATION_URL: "https://automacoes-n8n.infrassys.com/webhook/cultopsvalidation",
        N8N_WEBHOOK_SALIC_PROJECT_URL: "https://automacoes-n8n.infrassys.com/webhook/cultops-projeto",
        N8N_WEBHOOK_SALIC_IMPORT_RUBRICAS_URL: "https://automacoes-n8n.infrassys.com/webhook/uploadrubricas",
        N8N_WEBHOOK_CRIAR_PDF_URL: "https://automacoes-n8n.infrassys.com/webhook/relatorio",
        SALIC_API_URL: process.env.RAILWAY_URL
            ? process.env.RAILWAY_URL + "/api/salic/inserir"
            : "/api/salic/inserir"
    };
    res.type('application/javascript');
    res.send(`const CONFIG = ${JSON.stringify(publicConfig, null, 2)};`);
});

// Rota de Health Check para diagnóstico
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        env: process.env.NODE_ENV,
        hasSupabase: !!process.env.SUPABASE_URL
    });
});

// Servir arquivos estáticos (Front-end) - Desativável via Variável de Ambiente
if (process.env.DISABLE_FRONTEND === 'true') {
    app.get('/', (req, res) => {
        res.send("🤖 Prestaí RPA Microservice - Running!");
    });
} else {
    const staticPath = path.resolve(__dirname);
    app.use(express.static(staticPath));
}

/**
 * Endpoint para disparar o robô do SALIC
 */
app.post('/api/salic/inserir', async (req, res) => {
    // Se rodando na Vercel, delegar ao Railway onde o Puppeteer funciona
    if (process.env.VERCEL) {
        const railwayUrl = process.env.RAILWAY_URL;
        if (!railwayUrl) {
            return res.status(500).json({
                error: 'RAILWAY_URL não configurada na Vercel.'
            });
        }
        try {
            console.log('[PROXY→RAILWAY] Encaminhando para:', railwayUrl);
            const response = await fetch(
                `${railwayUrl}/api/salic/inserir`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(req.body),
                }
            );
            const data = await response.json();
            return res.status(response.status).json(data);
        } catch (err) {
            console.error('[PROXY→RAILWAY] Erro:', err.message);
            return res.status(500).json({
                error: 'Falha ao conectar com o Railway RPA: ' + err.message
            });
        }
    }

    // Abaixo: código original do handler (Puppeteer no Railway)
    const { executarInsercaoSalic } = require('./salic_insertion.cjs');

    const { documentId, userId } = req.body;

    if (!documentId) return res.status(400).json({ error: 'ID do documento não fornecido.' });

    try {
        console.log(`[API] Iniciando processo para documento: ${documentId}`);

        // 1. Preferir a credencial própria. Se não existir, usar a do
        // admin/gestor responsável pelo analista, sempre dentro da mesma org.
        let credentialOwnerId = userId;
        let { data: creds, error: credError } = await supabase
            .from('decrypted_external_credentials')
            .select('*')
            .eq('user_id', userId)
            .eq('service_name', 'salic')
            .maybeSingle();

        if (!creds && !credError) {
            const { data: analystLink, error: linkError } = await supabase
                .from('organization_users')
                .select('organization_id, salic_credential_owner_id')
                .eq('user_id', userId)
                .maybeSingle();
            if (linkError) throw linkError;

            if (analystLink?.salic_credential_owner_id) {
                const { data: ownerLink, error: ownerError } = await supabase
                    .from('organization_users')
                    .select('role')
                    .eq('organization_id', analystLink.organization_id)
                    .eq('user_id', analystLink.salic_credential_owner_id)
                    .in('role', ['admin', 'gestor'])
                    .maybeSingle();
                if (ownerError) throw ownerError;

                if (ownerLink) {
                    credentialOwnerId = analystLink.salic_credential_owner_id;
                    const inherited = await supabase
                        .from('decrypted_external_credentials')
                        .select('*')
                        .eq('user_id', credentialOwnerId)
                        .eq('service_name', 'salic')
                        .maybeSingle();
                    creds = inherited.data;
                    credError = inherited.error;
                }
            }
        }

        if (credError || !creds) {
            console.error('[API] Erro ao buscar credenciais:', credError);
            throw new Error('Credenciais SALIC não encontradas para este usuário no Supabase.');
        }

        console.log(`[API] Credenciais encontradas para o serviço: ${creds.service_name}`);

        if (!creds.identifier || !creds.secret_plain) {
            throw new Error('Usuário ou Senha do SALIC estão vazios no banco de dados (Verifique a criptografia ou o nome da coluna secret_plain).');
        }

        // 2. Buscar Dados do Documento e do Projeto
        const { data: doc, error: docError } = await supabase
            .from('documents')
            .select('*, projects(pronac)')
            .eq('id', documentId)
            .single();

        if (docError || !doc) throw new Error('Documento não encontrado no banco de dados.');

        console.log(`[API] Documento identificado: ${doc.name} | Rubrica: ${doc.rubrica}`);

        // 3. Executar o Robô
        const config = {
            usuario: String(creds.identifier),
            senha: String(creds.secret_plain),
            pronac: String(doc.projects.pronac),
            rubricaNome: doc.rubrica || 'Rubrica não informada',
            documento: {
                // Dados obrigatórios (já existiam)
                cnpj_fornecedor: doc.cnpj_emissor,
                valor: doc.valor,
                numero: doc.json_extraido?.numero_nota || 'S/N',
                data_emissao: doc.data_emissao,
                nf_path: doc.file_path,
                nf_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/documentos/${doc.file_path}`,
                // Dados adicionais para o formulário SALIC (preencher quando tiver mapeamento)
                nome_fornecedor: doc.json_extraido?.razao_social || '',
                serie: doc.json_extraido?.serie || '',
                valor_unitario: doc.json_extraido?.valor_unitario || doc.valor,
                quantidade: doc.json_extraido?.quantidade || '1',
                tipo_documento: doc.json_extraido?.tipo_documento || 'Nota Fiscal',
                tipo_comprovante: doc.json_extraido?.tipo_comprovante || '',
                comprovante_path: doc.comprovante_path || '',
            },
            browserWSEndpoint: process.env.BROWSERLESS_ENDPOINT
        };

        // Responda imediatamente que o processo começou (Async) ou aguarde (Sync)
        // No Render, se demorar > 30s a conexão HTTP cai, mas o script continua
        const resultado = await executarInsercaoSalic(config);

        if (resultado.sucesso) {
            // Atualizar o banco com o protocolo
            await supabase.from('documents').update({
                status: 'enviado_salic',
                protocolo_salic: resultado.protocolo,
                salic_credential_owner_id: credentialOwnerId
            }).eq('id', documentId);

            // CR-2026-001 Fase 0: marca a despesa como confirmada no SALIC.
            // v_saldo_rubricas e a detecção de divergências usam data_salic
            // para diferenciar "já absorvido pelo SALIC" de "em trânsito" —
            // sem isso a despesa nunca conta como confirmada. Mesmo fix já
            // aplicado na rota equivalente do worker (branch api).
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

        // Registrar erro no banco para o usuário ver na UI
        await supabase.from('documents').update({
            status: 'erro_rpa',
            just_erro: error.message
        }).eq('id', documentId);

        res.status(500).json({ error: error.message });
    }
});

// --- Endpoints de gestão de usuários (S1-B) ---

const ROLES_VALIDOS = ['admin', 'analista', 'gestor', 'fornecedor', 'operador'];

// Quem pode ATRIBUIR cada perfil a uma conta que já existe. Propositalmente
// separado de ROLES_CRIAVEIS_POR (perto de /criar-analista): criar uma conta
// implica definir a senha dela, então deixar um gestor criar admin seria
// escalar o próprio privilégio — bastaria logar na conta nova. Atribuir perfil
// a conta existente não entrega senha nenhuma, então o gestor pode mexer nos
// perfis operacionais. Unificar as duas matrizes também sumiria com
// 'fornecedor', que existe aqui e não faz sentido na criação de equipe.
const ROLES_ATRIBUIVEIS_POR = {
    admin:  ['admin', 'gestor', 'analista', 'operador', 'fornecedor'],
    gestor: ['analista', 'operador', 'fornecedor']
};

// Guardas comuns a mexer em OUTRO usuário da equipe (alterar perfil, revogar,
// excluir). Devolve { status, error } quando barra, ou { ok: true, ... }.
async function guardasAlvo(req, targetUserId, { exigirNaoUltimoAdmin } = {}) {
    if (req.user.id === targetUserId) {
        return { status: 400, error: 'Não é possível fazer isso na sua própria conta.' };
    }

    const orgId = req.user.app_metadata?.org_id;
    if (!orgId) {
        return { status: 400, error: 'org_id ausente. Faça logout e login novamente.' };
    }

    // Filtra por org junto com user_id: sem isso, quem pertence a duas orgs
    // faz o maybeSingle() estourar PGRST116 em vez de responder direito.
    const { data: vinculo, error: vincErr } = await supabase
        .from('organization_users')
        .select('organization_id, role')
        .eq('user_id', targetUserId)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (vincErr) throw vincErr;
    if (!vinculo) {
        return { status: 403, error: 'Usuário não pertence à sua organização.' };
    }

    const { data: alvo, error: alvoErr } = await supabase.auth.admin.getUserById(targetUserId);
    if (alvoErr || !alvo?.user) {
        return { status: 404, error: 'Usuário alvo não encontrado.' };
    }
    const roleAlvo = alvo.user.app_metadata?.role || alvo.user.user_metadata?.role || null;

    if (exigirNaoUltimoAdmin && roleAlvo === 'admin') {
        const { data: qtd, error: contErr } = await supabase
            .rpc('contar_admins_org', { p_org_id: orgId });
        if (contErr) throw contErr;
        if ((qtd ?? 0) <= 1) {
            return {
                status: 400,
                error: 'Este é o último administrador da organização. Promova outro admin antes.'
            };
        }
    }

    return { ok: true, orgId, roleAlvo, alvo: alvo.user };
}

app.get('/api/gestor/usuarios',
    requireAuth, requireRole('gestor', 'admin'),
    async (req, res) => {
        try {
            const orgId = req.user.app_metadata?.org_id;
            if (!orgId) {
                return res.status(400).json({ error: 'org_id ausente. Faça logout e login novamente.' });
            }

            const { data: orgUsers, error } = await supabase
                .from('organization_users')
                .select('user_id, role, created_at, salic_credential_owner_id')
                .eq('organization_id', orgId);
            if (error) throw error;

            const users = await Promise.all((orgUsers || []).map(async (ou) => {
                const { data } = await supabase.auth.admin.getUserById(ou.user_id);
                return {
                    id: ou.user_id,
                    email: data?.user?.email || null,
                    role: data?.user?.app_metadata?.role || data?.user?.user_metadata?.role || null,
                    org_role: ou.role,
                    salic_credential_owner_id: ou.salic_credential_owner_id || null,
                    created_at: ou.created_at
                };
            }));

            res.json({ users });
        } catch (err) {
            console.error('[GESTOR] listUsers:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// Define qual admin/gestor fornece a credencial SALIC para um analista.
app.patch('/api/gestor/usuarios/:id/responsavel-salic',
    requireAuth, requireRole('gestor', 'admin'),
    async (req, res) => {
        const analystId = req.params.id;
        const { credentialOwnerId } = req.body || {};
        const orgId = req.user.app_metadata?.org_id;
        if (!orgId || !credentialOwnerId) {
            return res.status(400).json({ error: 'credentialOwnerId e organização são obrigatórios.' });
        }

        try {
            const { data: analyst, error: analystErr } = await supabase
                .from('organization_users')
                .select('role')
                .eq('organization_id', orgId)
                .eq('user_id', analystId)
                .maybeSingle();
            if (analystErr) throw analystErr;
            if (!analyst || analyst.role !== 'analista') {
                return res.status(404).json({ error: 'Analista não encontrado nesta organização.' });
            }

            const { data: owner, error: ownerErr } = await supabase
                .from('organization_users')
                .select('role')
                .eq('organization_id', orgId)
                .eq('user_id', credentialOwnerId)
                .in('role', ['admin', 'gestor'])
                .maybeSingle();
            if (ownerErr) throw ownerErr;
            if (!owner) {
                return res.status(400).json({ error: 'Responsável deve ser admin ou gestor da mesma organização.' });
            }

            const { error: updateErr } = await supabase
                .from('organization_users')
                .update({ salic_credential_owner_id: credentialOwnerId })
                .eq('organization_id', orgId)
                .eq('user_id', analystId);
            if (updateErr) throw updateErr;

            await supabase.from('audit_log').insert({
                tabela: 'organization_users',
                registro_id: analystId,
                campo: 'salic_credential_owner_id',
                valor_anterior: null,
                valor_novo: credentialOwnerId,
                alterado_por: req.user.id,
                origem: 'gestor_ui'
            });
            res.json({ ok: true });
        } catch (err) {
            console.error('[GESTOR] responsável SALIC:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

app.post('/api/gestor/set-role',
    requireAuth, requireRole('gestor', 'admin'),
    async (req, res) => {
        const { targetUserId, role } = req.body || {};
        if (!targetUserId || !role) {
            return res.status(400).json({ error: 'targetUserId e role são obrigatórios.' });
        }
        if (!ROLES_VALIDOS.includes(role)) {
            return res.status(400).json({ error: 'Role inválido.' });
        }

        const permitidos = ROLES_ATRIBUIVEIS_POR[req.userRole] || [];
        if (!permitidos.includes(role)) {
            return res.status(403).json({
                error: `Seu perfil não pode atribuir "${role}". Permitidos: ${permitidos.join(', ')}.`
            });
        }

        try {
            // Promover para admin não tira admin de ninguém; só o rebaixamento
            // pode deixar a organização sem nenhum administrador.
            const guarda = await guardasAlvo(req, targetUserId, {
                exigirNaoUltimoAdmin: role !== 'admin'
            });
            if (!guarda.ok) return res.status(guarda.status).json({ error: guarda.error });

            const { orgId: callerOrgId, roleAlvo: roleAnterior, alvo } = guarda;

            const { error: updErr } = await supabase.auth.admin.updateUserById(targetUserId, {
                app_metadata:  { ...(alvo.app_metadata  || {}), role, org_id: callerOrgId },
                user_metadata: { ...(alvo.user_metadata || {}), role, org_id: callerOrgId }
            });
            if (updErr) throw updErr;

            // Historicamente só o auth era atualizado, o que fez app_metadata.role
            // e organization_users.role divergirem em produção. Mantém os dois em dia.
            const { error: syncErr } = await supabase
                .from('organization_users')
                .update({ role })
                .eq('user_id', targetUserId)
                .eq('organization_id', callerOrgId);
            if (syncErr) throw syncErr;

            await supabase.from('audit_log').insert({
                tabela: 'auth.users',
                registro_id: targetUserId,
                campo: 'role',
                valor_anterior: roleAnterior,
                valor_novo: role,
                alterado_por: req.user.id,
                origem: 'gestor_ui'
            });

            res.json({ ok: true });
        } catch (err) {
            console.error('[GESTOR] set-role:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// DELETE /api/gestor/usuarios/:userId
// Exclusão de verdade, permitida SÓ para conta sem nenhum dado vinculado — o
// caso "conta criada errada". Com dados, apagar seria destrutivo: documents,
// projects e extratos saem por CASCATA, e contracts/physical_evidences e cia
// são RESTRICT e fariam o delete falhar com erro cru de FK. Nesse caso o
// endpoint recusa com 409 e a UI oferece revogar o acesso, que preserva tudo.
app.delete('/api/gestor/usuarios/:userId',
    requireAuth, requireRole('admin'),
    async (req, res) => {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

        try {
            const guarda = await guardasAlvo(req, userId, { exigirNaoUltimoAdmin: true });
            if (!guarda.ok) return res.status(guarda.status).json({ error: guarda.error });

            const { data: vinculos, error: vincErr } = await supabase
                .rpc('usuario_vinculos', { p_user_id: userId });
            if (vincErr) throw vincErr;

            if (vinculos && Object.keys(vinculos).length > 0) {
                return res.status(409).json({
                    error: 'Este usuário tem dados vinculados e não pode ser excluído sem perdê-los.',
                    vinculos
                });
            }

            // Só o deleteUser: organization_users.user_id é ON DELETE CASCADE,
            // então a linha de vínculo sai junto — apagá-la antes seria
            // redundante e criaria necessidade de rollback à toa.
            const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
            if (delErr) {
                // Corrida: algo passou a apontar para o usuário entre a
                // checagem acima e o delete.
                if (/23503|foreign key/i.test(delErr.message || '')) {
                    return res.status(409).json({
                        error: 'O usuário passou a ter dados vinculados. Use "revogar acesso".'
                    });
                }
                throw delErr;
            }

            await supabase.from('audit_log').insert({
                tabela: 'auth.users',
                registro_id: userId,
                campo: 'exclusao',
                valor_anterior: guarda.roleAlvo,
                valor_novo: null,
                alterado_por: req.user.id,
                origem: 'gestor_ui'
            });

            res.json({ sucesso: true });
        } catch (err) {
            console.error('[GESTOR] excluir usuario:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// POST /api/gestor/usuarios/:userId/revogar
// Alternativa não destrutiva à exclusão: a pessoa deixa de acessar, mas tudo
// que ela lançou continua no lugar e atribuído a ela.
app.post('/api/gestor/usuarios/:userId/revogar',
    requireAuth, requireRole('admin'),
    async (req, res) => {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ error: 'userId é obrigatório.' });

        try {
            const guarda = await guardasAlvo(req, userId, { exigirNaoUltimoAdmin: true });
            if (!guarda.ok) return res.status(guarda.status).json({ error: guarda.error });

            const { orgId, alvo } = guarda;

            // Metadata PRIMEIRO, vínculo depois: current_user_org_id() lê o
            // org_id do JWT, então apagar a linha antes e falhar aqui deixaria
            // a pessoa ainda enxergando dados da org via RLS.
            // role/org_id vão como null explícito — updateUserById faz merge,
            // omitir a chave não apagaria nada.
            // ban_duration porque limpar o metadata não invalida o access token
            // já emitido: sem o ban, a sessão aberta continuaria valendo até
            // expirar (~1h). Reverter é ban_duration: 'none'.
            const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
                app_metadata:  { ...(alvo.app_metadata  || {}), role: null, org_id: null },
                user_metadata: { ...(alvo.user_metadata || {}), role: null, org_id: null },
                ban_duration: '876000h'
            });
            if (updErr) throw updErr;

            const { error: delErr } = await supabase
                .from('organization_users')
                .delete()
                .eq('user_id', userId)
                .eq('organization_id', orgId);
            if (delErr) {
                // Devolve o metadata ao estado anterior para não deixar a conta
                // num limbo (sem perfil, mas ainda vinculada à organização).
                await supabase.auth.admin.updateUserById(userId, {
                    app_metadata:  alvo.app_metadata  || {},
                    user_metadata: alvo.user_metadata || {},
                    ban_duration: 'none'
                }).catch(() => {});
                throw delErr;
            }

            await supabase.from('audit_log').insert({
                tabela: 'auth.users',
                registro_id: userId,
                campo: 'acesso_revogado',
                valor_anterior: guarda.roleAlvo,
                valor_novo: null,
                alterado_por: req.user.id,
                origem: 'gestor_ui'
            });

            res.json({ sucesso: true });
        } catch (err) {
            console.error('[GESTOR] revogar acesso:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// POST /api/gestor/criar-analista (S1-C)
// Cria um usuário da equipe, já vinculado à org de quem chama.
// Quem cria define a senha provisória e portanto a conhece: deixar um gestor
// criar admin/gestor seria escalar o próprio privilégio (bastaria logar na
// conta recém-criada). Por isso perfis de nível admin/gestor só podem ser
// criados por admin — gestor segue limitado a analista e operador.
const ROLES_CRIAVEIS_POR = {
    admin:  ['admin', 'gestor', 'analista', 'operador'],
    gestor: ['analista', 'operador']
};
app.post('/api/gestor/criar-analista',
    requireAuth, requireRole('gestor', 'admin'),
    async (req, res) => {
        const { email, password, nome } = req.body || {};
        const role = req.body?.role || 'analista';
        const permitidos = ROLES_CRIAVEIS_POR[req.userRole] || [];
        if (!permitidos.includes(role)) {
            return res.status(403).json({
                error: `Seu perfil não pode criar usuários "${role}". Permitidos: ${permitidos.join(', ')}.`
            });
        }
        if (!email || !password) {
            return res.status(400).json({ error: 'email e password são obrigatórios.' });
        }
        if (typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ error: 'Senha precisa ter pelo menos 6 caracteres.' });
        }

        const orgId = req.user.app_metadata?.org_id;
        if (!orgId) {
            return res.status(400).json({ error: 'org_id ausente. Faça logout e login novamente.' });
        }

        try {
            const { data: created, error: createErr } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { role, nome: nome || null, org_id: orgId },
                app_metadata:  { role, org_id: orgId, must_change_password: true }
            });
            if (createErr) throw createErr;

            const newUserId = created?.user?.id;
            if (!newUserId) throw new Error('Falha ao obter id do usuário criado.');

            const { error: linkErr } = await supabase
                .from('organization_users')
                .insert({
                    organization_id: orgId,
                    user_id: newUserId,
                    role,
                    salic_credential_owner_id: role === 'analista'
                        ? req.user.id
                        : (['admin', 'gestor'].includes(role) ? newUserId : null)
                });
            if (linkErr) {
                // Rollback: remove o user criado para não deixar órfão sem vínculo
                await supabase.auth.admin.deleteUser(newUserId);
                throw linkErr;
            }

            await supabase.from('audit_log').insert({
                tabela: 'auth.users',
                registro_id: newUserId,
                campo: 'criacao',
                valor_anterior: null,
                valor_novo: role,
                alterado_por: req.user.id,
                origem: 'gestor_ui'
            });

            res.json({ ok: true, user: { id: newUserId, email, role } });
        } catch (err) {
            console.error('[GESTOR] criar-analista:', err);
            const msg = err?.message || 'Erro ao criar usuário.';
            const status = /already.*registered|duplicate|exists/i.test(msg) ? 409 : 500;
            res.status(status).json({ error: msg });
        }
    }
);

// POST /api/gestor/criar-acesso-fornecedor
// Cria a conta de login de um fornecedor já cadastrado em `fornecedores`
// (via cadastro manual ou trigger de NF), vinculando pelo auth_user_id em vez
// de organization_users — fornecedor não é membro de equipe, escopo dele é
// fornecedores.organization_id + projeto_fornecedores. Espelha exatamente
// /api/gestor/criar-analista (mesmo rollback em caso de vínculo falho).
app.post('/api/gestor/criar-acesso-fornecedor',
    requireAuth, requireRole('admin', 'gestor', 'analista'),
    async (req, res) => {
        const { fornecedor_id, email, password } = req.body || {};
        if (!fornecedor_id || !email || !password) {
            return res.status(400).json({ error: 'fornecedor_id, email e password são obrigatórios.' });
        }
        if (typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ error: 'Senha precisa ter pelo menos 6 caracteres.' });
        }

        const orgId = req.user.app_metadata?.org_id;
        if (!orgId) return res.status(400).json({ error: 'org_id ausente. Faça logout e login novamente.' });

        try {
            // Confirma que o fornecedor existe, pertence à organização de quem chama,
            // e ainda não tem conta.
            const { data: fornecedor, error: fErr } = await supabase
                .from('fornecedores')
                .select('id, razao_social, cnpj, auth_user_id, organization_id')
                .eq('id', fornecedor_id)
                .single();
            if (fErr || !fornecedor) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
            if (fornecedor.organization_id !== orgId) return res.status(403).json({ error: 'Fornecedor não pertence à sua organização.' });
            if (fornecedor.auth_user_id) return res.status(409).json({ error: 'Este fornecedor já tem uma conta de acesso.' });

            const { data: created, error: createErr } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                // Sem org_id no token: a visibilidade do fornecedor é definida só pelo
                // vínculo em projeto_fornecedores, nunca por organização. Com org_id
                // aqui, o fornecedor herdaria leitura de contracts/tax_guides/
                // physical_evidences da organização inteira — essas tabelas checam só
                // organization_id = current_user_org_id(), sem checar papel.
                user_metadata: { role: 'fornecedor', nome: fornecedor.razao_social },
                app_metadata:  { role: 'fornecedor', must_change_password: true }
            });
            if (createErr) throw createErr;

            const newUserId = created?.user?.id;
            if (!newUserId) throw new Error('Falha ao obter id do usuário criado.');

            const { error: linkErr } = await supabase
                .from('fornecedores')
                .update({ auth_user_id: newUserId, acesso_criado_em: new Date().toISOString(), acesso_criado_por: req.user.id })
                .eq('id', fornecedor_id);
            if (linkErr) {
                // Rollback: remove o user criado para não deixar órfão sem vínculo
                await supabase.auth.admin.deleteUser(newUserId);
                throw linkErr;
            }

            await supabase.from('audit_log').insert({
                tabela: 'fornecedores', registro_id: fornecedor_id, campo: 'acesso_criado',
                valor_anterior: null, valor_novo: email,
                alterado_por: req.user.id, origem: 'gestor_ui'
            });

            res.json({ ok: true, user: { id: newUserId, email } });
        } catch (err) {
            console.error('[GESTOR] criar-acesso-fornecedor:', err);
            const msg = err?.message || 'Erro ao criar acesso.';
            const status = /already.*registered|duplicate|exists/i.test(msg) ? 409 : 500;
            res.status(status).json({ error: msg });
        }
    }
);

// Camada 4 (BL-13): povoamento de fornecedores via API pública do SALIC, no
// onboarding de projeto. A API devolve 1 registro por produto/pagamento, não
// por fornecedor — testado com dado real: 100 registros retornaram 74 CNPJs
// distintos. O Map abaixo dedup antes de chamar resolver_fornecedor().
// Paginação (_links.next) não foi validada com projeto grande o suficiente
// ainda: se data.total sugerir que há mais do que os 100 primeiros, só grava
// um aviso no log — não pagina automaticamente por ora.
async function importarFornecedoresSalic(pronac, organizationId) {
    const resp = await fetch(`https://api.salic.cultura.gov.br/api/v1/fornecedores?PRONAC=${pronac}&limit=100`);
    if (!resp.ok) return { importados: 0, erro: 'API do SALIC indisponível' };
    const data = await resp.json();
    const registros = data._embedded?.fornecedores || [];
    const porCnpj = new Map();
    for (const f of registros) {
        if (!porCnpj.has(f.cgccpf)) porCnpj.set(f.cgccpf, f.nome);
    }
    let importados = 0;
    for (const [cnpj, nome] of porCnpj) {
        if (cnpj.includes('*')) continue; // CPF mascarado, sem dado utilizável
        await supabase.rpc('resolver_fornecedor', { p_cnpj: cnpj, p_nome: nome, p_organization_id: organizationId });
        importados++;
    }
    if (data.total && data.total > registros.length) {
        console.warn(`[SALIC-FORNECEDORES] PRONAC ${pronac}: API reporta total=${data.total} mas só ${registros.length} vieram nesta página — paginação (_links.next) ainda não implementada.`);
    }
    return { importados, total_na_api: data.total };
}

// Chamado pelo front logo após a importação do projeto via PRONAC ter sucesso
// (window.handleFetchSalicProject, em app.js). Roda silencioso: PRONAC novo
// (sem execução anterior) ou API do SALIC fora do ar não bloqueiam a criação
// do projeto, que já aconteceu antes desta chamada.
app.post('/api/gestor/importar-fornecedores-salic',
    requireAuth, requireRole('admin', 'gestor', 'analista'),
    async (req, res) => {
        const { pronac } = req.body || {};
        if (!pronac) return res.status(400).json({ error: 'pronac é obrigatório.' });

        const orgId = req.user.app_metadata?.org_id;
        if (!orgId) return res.status(400).json({ error: 'org_id ausente. Faça logout e login novamente.' });

        try {
            const resultado = await importarFornecedoresSalic(pronac, orgId);
            res.json({ ok: true, ...resultado });
        } catch (err) {
            console.error('[SALIC-FORNECEDORES] importar-fornecedores-salic:', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// Camada 5 (BL-13): checagem de existência do fornecedor no SALIC, disparada
// pelo trigger trg_verificar_fornecedor_salic (SQL, aplicado separado) quando
// um documento chega em 'aguardando_d3'. Mesmo padrão de segredo do
// /api/m2/cron-alerta-guias (x-cron-secret / CRON_SECRET).
app.post('/api/m1/verificar-fornecedor-salic', async (req, res) => {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Não autorizado.' });
    }
    const { document_id, cnpj } = req.body;
    const cnpjLimpo = (cnpj || '').replace(/\D/g, '');

    if (cnpjLimpo.length === 11) {
        // CPF — a API do SALIC mascara CPF, não dá pra verificar
        await supabase.from('documents').select('fornecedor_id').eq('id', document_id).single()
            .then(({ data }) => data?.fornecedor_id && supabase.from('fornecedores')
                .update({ existe_no_salic: null, salic_verificado_em: new Date().toISOString() })
                .eq('id', data.fornecedor_id));
        return res.json({ ok: true, verificavel: false, motivo: 'CPF não verificável na API pública' });
    }

    try {
        const resp = await fetch(`https://api.salic.cultura.gov.br/api/v1/fornecedores?cgccpf=${cnpjLimpo}`);
        const existe = resp.status === 200;

        const { data: doc } = await supabase.from('documents').select('fornecedor_id').eq('id', document_id).single();
        if (doc?.fornecedor_id) {
            await supabase.from('fornecedores')
                .update({ existe_no_salic: existe, salic_verificado_em: new Date().toISOString() })
                .eq('id', doc.fornecedor_id);
        }
        res.json({ ok: true, existe_no_salic: existe });
    } catch (err) {
        console.error('[verificar-fornecedor-salic]', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Sync de organization_id para app_metadata (S0) ---
app.post('/api/auth/sync-org-metadata',
    requireAuth,
    async (req, res) => {
        try {
            const { data: orgUser, error } = await supabase
                .from('organization_users')
                .select('organization_id')
                .eq('user_id', req.user.id)
                .maybeSingle();
            if (error) throw error;
            if (!orgUser) return res.json({ ok: false, reason: 'sem_org' });

            const { error: updErr } = await supabase.auth.admin.updateUserById(req.user.id, {
                app_metadata: {
                    ...(req.user.app_metadata || {}),
                    org_id: orgUser.organization_id
                }
            });
            if (updErr) throw updErr;

            res.json({ ok: true, org_id: orgUser.organization_id });
        } catch (err) {
            console.error('[SYNC-ORG]', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// --- Libera a conta após a troca de senha obrigatória do primeiro acesso ---
// A senha em si é trocada pelo client (auth.updateUser); aqui só se derruba a
// flag, que vive em app_metadata e por isso é gravável apenas com service role.
// Sem endpoint próprio o usuário trocaria a senha e continuaria preso na tela.
app.post('/api/auth/senha-trocada',
    requireAuth,
    async (req, res) => {
        try {
            const { error } = await supabase.auth.admin.updateUserById(req.user.id, {
                app_metadata: {
                    ...(req.user.app_metadata || {}),
                    must_change_password: false
                }
            });
            if (error) throw error;
            res.json({ ok: true });
        } catch (err) {
            console.error('[SENHA-TROCADA]', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// Tratamento de erros global para evitar crash do processo
app.use((err, req, res, next) => {
    console.error('[GLOBAL ERROR]', err);
    res.status(500).json({ error: 'Erro interno no servidor', details: err.message });
});

// ==========================================
// ROTAS MÓDULO II (Prestação de Contas)
// ==========================================

/**
 * Listar contratos de um projeto
 */
app.get('/api/m2/contracts/:project_id', async (req, res) => {
    const { project_id } = req.params;
    try {
        const { data, error } = await supabase
            .from('contracts')
            .select(`
                *,
                fornecedores(cnpj, razao_social),
                rubricas(nome)
            `)
            .eq('project_id', project_id);
            
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Atualizar status de contrato
 * PATCH /api/m2/contracts/:id/status
 */
app.patch('/api/m2/contracts/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status, project_id } = req.body || {};
    const allowed = ['ativo', 'encerrado', 'suspenso', 'cancelado', 'rescindido'];
    if (!status || !allowed.includes(status)) {
        return res.status(400).json({ error: 'Status inválido.' });
    }
    if (!project_id) return res.status(400).json({ error: 'project_id obrigatório.' });
    if (!(await userCanAccessProject(req.user.id, project_id))) {
        return res.status(403).json({ error: 'Acesso negado ao projeto.' });
    }
    const { error } = await supabase.from('contracts').update({ status }).eq('id', id).eq('project_id', project_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
});

/**
 * Salvar novo contrato
 */
app.post('/api/m2/contracts', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('contracts')
            .insert([req.body])
            .select();
            
        if (error) throw error;
        res.json(data[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Endpoint para encerramento SALIC (RPA M2)
 * Nota: Implementação do robô será feita no arquivo salic_encerramento.cjs
 */
app.post('/api/m2/salic/encerrar', async (req, res) => {
    const { project_id, userId } = req.body;
    res.json({ success: true, message: "Fluxo de encerramento iniciado (Simulado). Mapeamento SALIC pendente." });
});

// Mensagem única mostrada ao usuário quando o n8n falha; o erro real vai pro log.
const MSG_N8N_INDISPONIVEL = 'Não foi possível concluir a operação agora. Tente novamente em instantes. Se o problema continuar, fale com o suporte.';

/**
 * Proxy para importação de rubricas via n8n (Evita CORS)
 */
app.post('/api/rubricas/importar', async (req, res) => {
    try {
        const https = require('https');
        const dataStr = JSON.stringify(req.body);
        
        const options = {
            hostname: 'automacoes-n8n.infrassys.com',
            port: 443,
            path: '/webhook/uploadrubricas',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': dataStr.length
            }
        };

        const n8nReq = https.request(options, (n8nRes) => {
            let responseData = '';
            n8nRes.on('data', (chunk) => { responseData += chunk; });
            n8nRes.on('end', () => {
                try {
                    if (!responseData) {
                        return res.status(n8nRes.statusCode).json({ success: n8nRes.statusCode < 400, message: "OK" });
                    }
                    const json = JSON.parse(responseData);
                    res.status(n8nRes.statusCode).json(json);
                } catch (e) {
                    // Se o n8n retornar um texto (ex: "Workflow got started"), empacotamos em um JSON.
                    // Texto cru de erro do n8n não vai para o usuário — só o sucesso/falha.
                    const ok = n8nRes.statusCode < 400;
                    if (!ok) console.error('[PROXY ERROR] n8n respondeu', n8nRes.statusCode, responseData);
                    res.status(n8nRes.statusCode).json({
                        success: ok,
                        message: ok ? (responseData || "OK") : MSG_N8N_INDISPONIVEL
                    });
                }
            });
        });

        n8nReq.on('error', (error) => {
            console.error('[PROXY ERROR] n8n inacessível:', error);
            if (!res.headersSent) res.status(502).json({ success: false, message: MSG_N8N_INDISPONIVEL });
        });

        n8nReq.write(dataStr);
        n8nReq.end();
    } catch (error) {
        console.error('[PROXY ERROR]', error);
        res.status(500).json({ success: false, message: MSG_N8N_INDISPONIVEL });
    }
});

/**
 * ============================================================================
 * IMPORTAÇÃO DE PROJETO VIA PDF DO SALIC (substitui o fluxo n8n)
 * POST /api/m2/processar-pdf-salic
 * Body: { import_id, project_id, file_path }
 * Fluxo: download do PDF -> leitura e estruturação JSON (Gemini lê o PDF direto; com
 *        OCR_PROVIDER=mistral volta o caminho antigo: OCR + estruturação no Mistral) ->
 *        persistência nas tabelas project_*.
 * ============================================================================
 */

// Limpa cercas markdown / texto antes-depois e devolve o objeto JSON.
function parseSalicJson(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Resposta vazia da IA ao estruturar o JSON.');
    }
    let txt = raw.trim();
    // Remove cercas ```json ... ``` ou ``` ... ```
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    // Recorta do primeiro { até o último } para tolerar texto extra
    const first = txt.indexOf('{');
    const last = txt.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        txt = txt.slice(first, last + 1);
    }
    try {
        return JSON.parse(txt);
    } catch (e) {
        throw new Error('Falha ao interpretar o JSON retornado pela IA: ' + e.message);
    }
}

// Normaliza datas vazias para null (evita erro de cast em colunas date).
function dateOrNull(v) {
    if (!v || typeof v !== 'string' || !v.trim()) return null;
    return v.trim();
}

// ---------------------------------------------------------------------------
// Leitura de PDF (OCR + estruturação em JSON): provedor configurável por ambiente.
//   OCR_PROVIDER      'gemini' (padrão) ou 'mistral' (caminho antigo, para voltar sem mexer no código)
//   GEMINI_API_KEY    obrigatória com OCR_PROVIDER=gemini
//   GEMINI_OCR_MODEL  modelo do Gemini (padrão gemini-3.6-flash, o mesmo do "Analyze document" do n8n)
//   MISTRAL_API_KEY   obrigatória só com OCR_PROVIDER=mistral
// Nenhuma chave fica no código. Com o Gemini a leitura e a estruturação são UMA chamada: o PDF vai
// inline junto com a instrução de campos. O conteúdo do PDF e o texto extraído não são registrados em log.
// ---------------------------------------------------------------------------
const GEMINI_MODELO_PADRAO = 'gemini-3.6-flash';
const GEMINI_STATUS_COM_NOVA_TENTATIVA = new Set([429, 500, 502, 503, 504]);
const GEMINI_PREFACIO = 'O documento a analisar está anexo em PDF: leia o próprio PDF onde a instrução abaixo falar em "texto extraído". ' +
    'Você é um extrator de dados que responde exclusivamente com JSON válido.\n\n';

// Escolhe o provedor e valida a chave. Devolve { provider, apiKey } ou { erro } (para responder 500).
function configurarOcr(mensagemSemChaveMistral) {
    const provider = String(process.env.OCR_PROVIDER || 'gemini').trim().toLowerCase();
    if (provider === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return { erro: 'GEMINI_API_KEY não configurada no servidor.' };
        return { provider, apiKey };
    }
    if (provider === 'mistral') {
        const apiKey = process.env.MISTRAL_API_KEY;
        if (!apiKey) return { erro: mensagemSemChaveMistral };
        return { provider, apiKey };
    }
    return { erro: 'OCR_PROVIDER inválido (use "gemini" ou "mistral").' };
}

// Uma chamada ao Gemini com o PDF inline e as instruções; devolve o texto da resposta (JSON se json=true).
// Timeout de 90 s por chamada; até 3 tentativas, só para HTTP 429/500/502/503/504 (espera 2 s e 4 s).
// Os parâmetros opcionais existem para teste (fetch e espera injetáveis).
async function extrairComGemini(pdfBase64, instrucoes, {
    json = true,
    apiKey = process.env.GEMINI_API_KEY,
    modelo = process.env.GEMINI_OCR_MODEL || GEMINI_MODELO_PADRAO,
    timeoutMs = 90000,
    esperasMs = [2000, 4000],
    fetchImpl = fetch,
    dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
    const corpo = JSON.stringify({
        contents: [{
            parts: [
                { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
                { text: GEMINI_PREFACIO + instrucoes }
            ]
        }],
        generationConfig: { ...(json ? { responseMimeType: 'application/json' } : {}), temperature: 0 }
    });

    for (let tentativa = 0; ; tentativa++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
                body: corpo
            });
            if (response.ok) {
                const result = await response.json();
                const partes = result?.candidates?.[0]?.content?.parts;
                const texto = Array.isArray(partes) ? partes.map(p => p?.text || '').join('') : '';
                if (!texto.trim()) throw new Error('OCR não retornou texto.');
                return texto;
            }
            // O corpo da resposta de erro não vai para a mensagem nem para o log.
            await response.text().catch(() => '');
            if (GEMINI_STATUS_COM_NOVA_TENTATIVA.has(response.status) && tentativa < esperasMs.length) {
                clearTimeout(timer);
                await dormir(esperasMs[tentativa]);
                continue;
            }
            throw new Error(`OCR falhou (HTTP ${response.status})`);
        } finally {
            clearTimeout(timer);
        }
    }
}

// Mistral: faz o OCR do PDF em texto (passo separado). Com o Gemini não há esse passo: devolve só o PDF.
async function lerDocumentoPdf(ocr, pdfBase64) {
    if (ocr.provider === 'mistral') {
        return { pdfBase64, texto: await runMistralOcr(pdfBase64, ocr.apiKey) };
    }
    return { pdfBase64, texto: null };
}

// PASSO 4 (provedor mistral) — OCR via endpoint dedicado Mistral /v1/ocr
async function runMistralOcr(pdfBase64, apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const response = await fetch('https://api.mistral.ai/v1/ocr', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'mistral-ocr-latest',
                document: {
                    type: 'document_url',
                    document_url: `data:application/pdf;base64,${pdfBase64}`
                }
            })
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Mistral OCR falhou (HTTP ${response.status}): ${body.slice(0, 500)}`);
        }

        const result = await response.json();
        // Resposta do /v1/ocr: { pages: [{ markdown, index }, ...] }
        if (!Array.isArray(result?.pages) || !result.pages.length) {
            throw new Error('OCR não retornou páginas.');
        }
        const texto = result.pages.map(p => p.markdown || p.text || '').join('\n\n');
        if (!texto.trim()) throw new Error('OCR não retornou texto.');
        return texto;
    } finally {
        clearTimeout(timeout);
    }
}

// PASSO 5 — Estrutura o documento em JSON: Gemini lê o PDF direto; com OCR_PROVIDER=mistral usa o texto do OCR.
async function estruturarSalicJson(entrada, ocr) {
    const instrucoes = `Analise o texto extraído de um PDF do SALIC (Ministério da Cultura) e retorne APENAS um JSON com a seguinte estrutura:

{
  "etapas_trabalho": [
    { "nome": "Pré-produção", "duracao_meses": 2, "objetivo": "texto...", "atividades": ["ativ 1", "ativ 2"] }
  ],
  "locais_realizacao": [
    { "pais": "Brasil", "uf": "ES", "cidade": "Vila Velha" }
  ],
  "deslocamentos": [
    { "origem_uf": "ES", "origem_cidade": "Vitória", "destino_uf": "RJ", "destino_cidade": "Rio de Janeiro", "quantidade": 12 }
  ],
  "plano_divulgacao": [
    { "tipo_midia": "Internet/Redes Sociais", "descricao": "Campanhas de divulgação...", "veiculo": null, "quantidade": null }
  ],
  "sintese": "texto...",
  "objetivo_geral": "texto...",
  "objetivos_especificos": ["obj 1", "obj 2"],
  "justificativa": "texto...",
  "periodo_inicio": "2026-01-01",
  "periodo_fim": "2026-12-31",
  "produtos": [
    { "nome": "Festival", "descricao": "..." }
  ],
  "ficha_tecnica": [
    { "nome": "Fulano", "funcao": "Diretor" }
  ]
}

Retorne APENAS o JSON válido. Sem markdown, sem backticks, sem explicação. Se uma seção não for encontrada, retorne array/string vazio. Datas no formato AAAA-MM-DD.`;

    if (ocr.provider === 'gemini') {
        return parseSalicJson(await extrairComGemini(entrada.pdfBase64, instrucoes, { json: true, apiKey: ocr.apiKey }));
    }
    const textoOcr = entrada.texto;
    const apiKey = ocr.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'mistral-large-latest',
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'Você é um extrator de dados que responde exclusivamente com JSON válido.' },
                    { role: 'user', content: `${instrucoes}\n\n--- TEXTO EXTRAÍDO DO PDF ---\n${textoOcr}` }
                ]
            })
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Estruturação via IA falhou (HTTP ${response.status}): ${body.slice(0, 500)}`);
        }

        const result = await response.json();
        const raw = result?.choices?.[0]?.message?.content || '';
        return parseSalicJson(raw);
    } finally {
        clearTimeout(timeout);
    }
}

// Verifica se o usuário pertence à organização dona do projeto.
async function userCanAccessProject(userId, projectId) {
    const { data: orgUser } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
    if (!orgUser) return false;
    const { data: proj } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('organization_id', orgUser.organization_id)
        .maybeSingle();
    return !!proj;
}

// OCR — Estrutura texto de contrato de prestação de serviços em JSON.
async function estruturarContratoJson(entrada, ocr) {
    // O prompt anterior falava só em "CONTRATADO" (masculino) e não cobria o
    // vocabulário de locação. Casos reais que ele errava: contrato da HOLZ, que usa
    // "CONTRATADA" por ser LTDA, e os 10 contratos de locação que usam
    // LOCADORA/LOCATÁRIA. Como a parte que PAGA aparece antes no documento, a
    // extração rasa pegava o CNPJ do contratante.
    const instrucoes = `Você extrai dados de contratos brasileiros de prestação de serviços, locação e fornecimento. Retorne APENAS um JSON.

{
  "numero": "identificação do contrato ou anexo",
  "objeto": "descrição do que foi contratado (máx 500 chars)",
  "fornecedor_nome": "nome ou razão social de quem RECEBE o pagamento",
  "fornecedor_cnpj": "CNPJ (14 dígitos) ou CPF (11 dígitos) de quem RECEBE o pagamento",
  "data_inicio": "AAAA-MM-DD",
  "data_fim": "AAAA-MM-DD",
  "valor_total": 0.00
}

=== IDENTIFICAÇÃO DO FORNECEDOR — REGRA CENTRAL ===

Todo contrato tem duas partes. Extraia sempre a que ENTREGA algo e RECEBE dinheiro. Nunca a que paga.

Designações de quem RECEBE o pagamento (extrair esta):
  CONTRATADA, CONTRATADO, PRESTADORA, PRESTADOR,
  FORNECEDORA, FORNECEDOR, LOCADORA, LOCADOR,
  VENDEDORA, VENDEDOR, EXECUTORA, EXECUTOR,
  CEDENTE, CONSULTORA, CONSULTOR

Designações de quem PAGA (nunca extrair esta):
  CONTRATANTE, LOCATÁRIA, LOCATÁRIO, TOMADORA,
  TOMADOR, COMPRADORA, COMPRADOR, CLIENTE,
  CESSIONÁRIA, ADQUIRENTE

As terminações variam conforme o gênero da razão social: CONTRATADA e CONTRATADO são o mesmo papel; LOCADORA e LOCADOR também. Trate como equivalentes.

Se o contrato não usar nenhuma dessas palavras, use o critério do fluxo de dinheiro: quem emite nota fiscal, quem informa conta bancária para recebimento, ou quem executa a obrigação descrita no objeto é o fornecedor.

=== COMO LOCALIZAR NO TEXTO ===

A qualificação das partes fica no preâmbulo, antes das cláusulas. Normalmente a contratante vem primeiro e a contratada depois, separadas por expressões como "e, de outro lado", "e, por outro lado", "e", ou apenas por parágrafos distintos.

NÃO extraia o primeiro CNPJ que aparecer no texto.

Procedimento obrigatório:
  1. Localize o trecho que qualifica a parte que RECEBE o pagamento, usando as designações acima.
  2. Extraia o nome e o CNPJ que estão DENTRO desse mesmo trecho, próximos um do outro.
  3. Confirme que esse CNPJ não é o mesmo da parte que paga.

=== MÚLTIPLOS CNPJs ===

O texto conterá dois ou mais CNPJs. Além das duas partes, podem aparecer CNPJs de testemunhas, intervenientes, seguradoras ou do projeto incentivado. Extraia exclusivamente o da parte que recebe o pagamento.

=== FORNECEDOR PESSOA FÍSICA ===

O fornecedor pode ser pessoa física com CNPJ de MEI ou empresário individual. Nesse caso fornecedor_nome será um nome de pessoa, sem LTDA ou ME. Isso é válido: extraia o nome como aparece.

Se a parte que recebe o pagamento for pessoa física (assina com CPF, não CNPJ),
extraia o CPF (11 dígitos) no mesmo campo fornecedor_cnpj — CPF e CNPJ têm o
mesmo papel no sistema.

=== VALOR ===

valor_total é o valor global do contrato, número decimal puro (ex.: 14660.00), sem R$ nem separador de milhar.

Contratos guarda-chuva ou contratos-quadro podem não ter valor definido, remetendo ao valor de anexos futuros. Nesse caso retorne 0. Não some parcelas nem estime.

Se houver valor por item e valor total, extraia o total. Se houver apenas valores unitários e uma quantidade, retorne 0 e deixe o preenchimento manual.

=== DATAS ===

Formato AAAA-MM-DD. Use a vigência dos serviços, não a data de assinatura.

Se o contrato indicar apenas período genérico, como "durante o ano de 2026" ou "por 12 meses a contar da assinatura", sem datas exatas, retorne string vazia nos dois campos.

Contrato de locação por diárias: data_inicio é o primeiro dia e data_fim o último.

=== NÚMERO E OBJETO ===

numero: identificação como aparece no documento (ex.: "Anexo de Serviço nº 01/2026", "Contrato nº 12/2026"). Se o documento não tiver numeração, retorne string vazia.

objeto: descreva o que foi contratado em texto corrido, até 500 caracteres. Resuma se for longo, preservando o que foi contratado, para qual evento ou finalidade, e quantidades relevantes.

=== REGRA DE SEGURANÇA ===

Na dúvida entre dois candidatos a fornecedor, retorne fornecedor_cnpj e fornecedor_nome vazios.

Vincular o contrato ao fornecedor errado corrompe a prestação de contas de forma silenciosa. Deixar em branco apenas gera preenchimento manual. Prefira sempre o branco.

=== SAÍDA ===

Campo não encontrado: string vazia, ou 0 para valor_total.
Responda APENAS o JSON válido. Sem markdown, sem backticks, sem explicação.`;

    if (ocr.provider === 'gemini') {
        const raw = await extrairComGemini(entrada.pdfBase64, instrucoes, { json: true, apiKey: ocr.apiKey });
        try { return JSON.parse(raw); } catch { return {}; }
    }
    const textoOcr = entrada.texto;
    const apiKey = ocr.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'mistral-large-latest',
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'Você é um extrator de dados que responde exclusivamente com JSON válido.' },
                    { role: 'user', content: `${instrucoes}\n\n--- TEXTO EXTRAÍDO DO CONTRATO ---\n${textoOcr}` }
                ]
            })
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Estruturação IA falhou (HTTP ${response.status}): ${body.slice(0, 300)}`);
        }
        const result = await response.json();
        const raw = result?.choices?.[0]?.message?.content || '{}';
        try { return JSON.parse(raw); } catch { return {}; }
    } finally {
        clearTimeout(timeout);
    }
}

// OCR — Estrutura guia de imposto/tributo em JSON (Gemini lê o PDF; Mistral usa o texto do OCR).
async function estruturarImpostoJson(entrada, ocr) {
    const instrucoes = `Analise o texto extraído de uma guia de recolhimento tributário (DARF, ISS, INSS, etc.) e retorne APENAS um JSON:

{
  "tipo_imposto": "DARF",
  "codigo_receita": "somente os dígitos do código de receita",
  "competencia": "período de apuração no formato AAAA-MM",
  "valor": 0.00,
  "data_vencimento": "AAAA-MM-DD"
}

Regras:
- tipo_imposto deve ser exatamente um de: DARF, ISS, INSS, PIS, COFINS, CSLL, outro.
- competencia: formato YYYY-MM (ex: 2026-03 para março/2026).
- valor: número decimal puro sem R$ ou separadores.
- data_vencimento: formato YYYY-MM-DD.
- Retorne APENAS o JSON válido, sem markdown, sem backticks.`;

    if (ocr.provider === 'gemini') {
        const raw = await extrairComGemini(entrada.pdfBase64, instrucoes, { json: true, apiKey: ocr.apiKey });
        try { return JSON.parse(raw); } catch { return {}; }
    }
    const textoOcr = entrada.texto;
    const apiKey = ocr.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'mistral-large-latest',
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'Você é um extrator de dados que responde exclusivamente com JSON válido.' },
                    { role: 'user', content: `${instrucoes}\n\n--- TEXTO EXTRAÍDO DA GUIA ---\n${textoOcr}` }
                ]
            })
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Estruturação IA falhou (HTTP ${response.status}): ${body.slice(0, 300)}`);
        }
        const result = await response.json();
        const raw = result?.choices?.[0]?.message?.content || '{}';
        try { return JSON.parse(raw); } catch { return {}; }
    } finally {
        clearTimeout(timeout);
    }
}

// PASSO 8 — Persiste os dados estruturados nas tabelas de destino.
// Limpa registros anteriores da mesma importação (idempotente em reprocessos).
async function persistirDadosSalic(dados, ctx) {
    const { project_id, organization_id, import_id } = ctx;
    const base = { project_id, organization_id, import_id };

    // Limpa o que já existir desta importação antes de reinserir
    const tabelas = [
        'project_etapas_trabalho',
        'project_locais_realizacao',
        'project_deslocamentos',
        'project_plano_divulgacao',
        'project_dados_complementares'
    ];
    for (const t of tabelas) {
        await supabase.from(t).delete().eq('import_id', import_id);
    }

    const etapas = (dados.etapas_trabalho || []).map((e, i) => ({
        ...base,
        nome: e.nome || null,
        duracao_meses: e.duracao_meses ?? null,
        objetivo: e.objetivo || null,
        atividades: Array.isArray(e.atividades) ? e.atividades : [],
        ordem: i + 1
    }));
    if (etapas.length) {
        const { error } = await supabase.from('project_etapas_trabalho').insert(etapas);
        if (error) throw new Error('Erro ao salvar etapas de trabalho: ' + error.message);
    }

    const locais = (dados.locais_realizacao || []).map(l => ({
        ...base,
        pais: l.pais || null,
        uf: l.uf || null,
        cidade: l.cidade || null
    }));
    if (locais.length) {
        const { error } = await supabase.from('project_locais_realizacao').insert(locais);
        if (error) throw new Error('Erro ao salvar locais de realização: ' + error.message);
    }

    const deslocamentos = (dados.deslocamentos || []).map(d => ({
        ...base,
        origem_uf: d.origem_uf || null,
        origem_cidade: d.origem_cidade || null,
        destino_uf: d.destino_uf || null,
        destino_cidade: d.destino_cidade || null,
        quantidade: d.quantidade ?? null
    }));
    if (deslocamentos.length) {
        const { error } = await supabase.from('project_deslocamentos').insert(deslocamentos);
        if (error) throw new Error('Erro ao salvar deslocamentos: ' + error.message);
    }

    const divulgacao = (dados.plano_divulgacao || []).map(p => ({
        ...base,
        tipo_midia: p.tipo_midia || null,
        descricao: p.descricao || null,
        veiculo: p.veiculo || null,
        quantidade: p.quantidade ?? null
    }));
    if (divulgacao.length) {
        const { error } = await supabase.from('project_plano_divulgacao').insert(divulgacao);
        if (error) throw new Error('Erro ao salvar plano de divulgação: ' + error.message);
    }

    const complementares = {
        ...base,
        sintese: dados.sintese || null,
        objetivo_geral: dados.objetivo_geral || null,
        objetivos_especificos: Array.isArray(dados.objetivos_especificos) ? dados.objetivos_especificos : [],
        justificativa: dados.justificativa || null,
        periodo_inicio: dateOrNull(dados.periodo_inicio),
        periodo_fim: dateOrNull(dados.periodo_fim),
        produtos: Array.isArray(dados.produtos) ? dados.produtos : [],
        ficha_tecnica: Array.isArray(dados.ficha_tecnica) ? dados.ficha_tecnica : []
    };
    const { error: errComplem } = await supabase.from('project_dados_complementares').insert([complementares]);
    if (errComplem) throw new Error('Erro ao salvar dados complementares: ' + errComplem.message);
}

// Importação do PDF do projeto SALIC, reutilizada pela rota abaixo e pelo
// painel de suporte (reimportar). Devolve { http, body } em vez de responder.
async function processarPdfSalic({ project_id, file_path, user_id }) {
    if (!project_id || !file_path) {
        return { http: 400, body: { error: 'Parâmetros obrigatórios: project_id, file_path.' } };
    }

    const ocr = configurarOcr('MISTRAL_API_KEY não configurada no servidor.');
    if (ocr.erro) {
        return { http: 500, body: { error: ocr.erro } };
    }

    let import_id = null;

    try {
        console.log(`[SALIC-PDF] Iniciando importação para projeto ${project_id}`);

        // Descobre a organização do projeto
        const { data: proj, error: projError } = await supabase
            .from('projects')
            .select('organization_id')
            .eq('id', project_id)
            .single();
        if (projError || !proj) throw new Error('Projeto não encontrado no banco de dados.');
        const organization_id = proj.organization_id;

        // Marca importações anteriores como substituido (cleanup automático ao reimportar)
        await supabase.from('project_salic_imports')
            .update({ status: 'substituido' })
            .eq('project_id', project_id)
            .in('status', ['pendente', 'processando', 'processado', 'revisado', 'erro']);

        // Cria o registro de importação via service_role (sem RLS)
        const { data: imp, error: impErr } = await supabase
            .from('project_salic_imports')
            .insert([{
                project_id,
                organization_id,
                file_path,
                status: 'pendente',
                importado_por: user_id || null
            }])
            .select()
            .single();
        if (impErr || !imp) throw new Error('Erro ao criar registro de importação: ' + (impErr?.message || ''));
        import_id = imp.id;

        // 1. status = processando
        await supabase.from('project_salic_imports')
            .update({ status: 'processando', erro_mensagem: null })
            .eq('id', import_id);

        // 2. Download do PDF do bucket (service_role)
        const { data: blob, error: dlError } = await supabase.storage
            .from('salic-imports')
            .download(file_path);
        if (dlError || !blob) {
            throw new Error('Falha ao baixar o PDF do storage: ' + (dlError?.message || 'arquivo não encontrado'));
        }

        // 3. Converter PDF para base64
        const pdfBuffer = Buffer.from(await blob.arrayBuffer());
        const pdfBase64 = pdfBuffer.toString('base64');
        console.log(`[SALIC-PDF] PDF baixado (${(pdfBuffer.length / 1024).toFixed(0)} KB). Executando OCR...`);

        // 4. Leitura do PDF (Mistral: OCR em texto; Gemini: o PDF vai direto para a estruturação)
        const entrada = await lerDocumentoPdf(ocr, pdfBase64);
        console.log(`[SALIC-PDF] Leitura concluída${entrada.texto ? ` (${entrada.texto.length} chars)` : ''}. Estruturando JSON...`);

        // 5. Estruturar em JSON
        const jsonParsed = await estruturarSalicJson(entrada, ocr);

        // 6. status = processado + dados_extraidos
        await supabase.from('project_salic_imports')
            .update({ status: 'processado', dados_extraidos: jsonParsed })
            .eq('id', import_id);

        // 7. INSERT nas tabelas de destino
        await persistirDadosSalic(jsonParsed, { project_id, organization_id, import_id });

        console.log(`[SALIC-PDF] Importação ${import_id} concluída com sucesso.`);
        return { http: 200, body: { success: true, data: jsonParsed, import_id } };

    } catch (error) {
        console.error('[SALIC-PDF] Erro:', error.message);
        if (import_id) {
            await supabase.from('project_salic_imports')
                .update({ status: 'erro', erro_mensagem: error.message })
                .eq('id', import_id);
        }
        return { http: 500, body: { error: error.message } };
    }
}

app.post('/api/m2/processar-pdf-salic', async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);

    const { project_id, file_path, user_id } = req.body || {};
    const r = await processarPdfSalic({ project_id, file_path, user_id });
    return res.status(r.http).json(r.body);
});

/**
 * OCR de contrato de prestação de serviços (Gemini por padrão; OCR_PROVIDER=mistral volta o caminho antigo).
 * POST /api/m2/contratos/ocr
 * Body: { file_path } — path no bucket 'contracts' do Supabase Storage
 */
app.post('/api/m2/contratos/ocr', requireAuth, async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    const { fileBase64, fileName, projectId } = req.body || {};
    if (!fileBase64 || !projectId) return res.status(400).json({ error: 'fileBase64 e projectId obrigatórios.' });
    if (!(await userCanAccessProject(req.user.id, projectId))) return res.status(403).json({ error: 'Acesso negado ao projeto.' });
    const ocr = configurarOcr('MISTRAL_API_KEY não configurada.');
    if (ocr.erro) return res.status(500).json({ error: ocr.erro });
    try {
        // Upload para Storage via service_role (bypassa RLS)
        const pdfBuffer = Buffer.from(fileBase64, 'base64');
        const safeName = (fileName || 'contrato.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
        const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const filePath = `${projectId}/${uuid}/${safeName}`;
        const { error: upErr } = await supabase.storage.from('contracts').upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
        if (upErr) throw new Error('Falha no upload: ' + upErr.message);
        // OCR
        const pdfBase64 = pdfBuffer.toString('base64');
        console.log(`[CONTRATO-OCR] PDF (${(pdfBuffer.length / 1024).toFixed(0)} KB). Executando OCR...`);
        const entrada = await lerDocumentoPdf(ocr, pdfBase64);
        const dados = await estruturarContratoJson(entrada, ocr);
        console.log('[CONTRATO-OCR] Concluído:', JSON.stringify(dados).slice(0, 200));
        return res.json({ success: true, data: dados, file_path: filePath });
    } catch (err) {
        console.error('[CONTRATO-OCR] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * OCR de guia de imposto/tributo (Gemini por padrão; OCR_PROVIDER=mistral volta o caminho antigo).
 * POST /api/m2/impostos/ocr
 * Body: { file_path } — path no bucket 'tax-guides' do Supabase Storage
 */
app.post('/api/m2/impostos/ocr', requireAuth, async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    const { fileBase64, fileName, projectId } = req.body || {};
    if (!fileBase64 || !projectId) return res.status(400).json({ error: 'fileBase64 e projectId obrigatórios.' });
    if (!(await userCanAccessProject(req.user.id, projectId))) return res.status(403).json({ error: 'Acesso negado ao projeto.' });
    const ocr = configurarOcr('MISTRAL_API_KEY não configurada.');
    if (ocr.erro) return res.status(500).json({ error: ocr.erro });
    try {
        // Upload para Storage via service_role (bypassa RLS)
        const pdfBuffer = Buffer.from(fileBase64, 'base64');
        const safeName = (fileName || 'guia.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
        const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const filePath = `${projectId}/${uuid}/${safeName}`;
        const { error: upErr } = await supabase.storage.from('tax-guides').upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });
        if (upErr) throw new Error('Falha no upload: ' + upErr.message);
        // OCR
        const pdfBase64 = pdfBuffer.toString('base64');
        console.log(`[IMPOSTO-OCR] PDF (${(pdfBuffer.length / 1024).toFixed(0)} KB). Executando OCR...`);
        const entrada = await lerDocumentoPdf(ocr, pdfBase64);
        const dados = await estruturarImpostoJson(entrada, ocr);
        console.log('[IMPOSTO-OCR] Concluído:', JSON.stringify(dados).slice(0, 200));
        return res.json({ success: true, data: dados, file_path: filePath });
    } catch (err) {
        console.error('[IMPOSTO-OCR] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * SPEC-GUIA-01, Caso C — marca uma guia do M2 como paga e cria automaticamente
 * o documento correspondente no M1 (documents), copiando o arquivo já presente
 * no bucket tax-guides para o bucket documentos (sem exigir novo upload).
 *
 * O documento nasce sem rubrica (tax_guides não tem esse dado) — cai em
 * 'bloqueado_conformidade' pelo trg_documents_cria_despesa, que é o mesmo
 * estado (e a mesma tela de "Corrigir Vínculo") que qualquer documento sem
 * rubrica reconhecida já usa hoje. Não é um caso de erro novo, é o fluxo
 * normal de conformidade pedindo confirmação humana de qual rubrica esse
 * gasto consome — o mesmo vale para cnpj_emissor/fornecedor_id, que tax_guides
 * também não tem como informar (fica null; documents_vincula_fornecedor só
 * roda quando cnpj_emissor está preenchido).
 *
 * POST /api/m2/impostos/marcar-paga
 * Body: { tax_guide_id }
 */
app.post('/api/m2/impostos/marcar-paga', requireAuth, async (req, res) => {
    const { tax_guide_id } = req.body || {};
    if (!tax_guide_id) return res.status(400).json({ error: 'tax_guide_id é obrigatório.' });

    try {
        const { data: guia, error: guiaErr } = await supabase
            .from('tax_guides')
            .select('*')
            .eq('id', tax_guide_id)
            .single();
        if (guiaErr || !guia) return res.status(404).json({ error: 'Guia não encontrada.' });

        if (!(await userCanAccessProject(req.user.id, guia.project_id))) {
            return res.status(403).json({ error: 'Acesso negado ao projeto desta guia.' });
        }

        const agora = new Date().toISOString();

        // Já tem documento vinculado (ex.: veio do Caso D) — só sincroniza o
        // status, sem duplicar o documento no M1.
        if (guia.document_id) {
            const { error: updErr } = await supabase
                .from('tax_guides')
                .update({ status: 'paga', data_pagamento: agora.slice(0, 10), atualizado_em: agora })
                .eq('id', tax_guide_id);
            if (updErr) throw updErr;
            return res.json({ success: true, document_id: guia.document_id });
        }

        let novoDocumentId = null;

        // Sem arquivo anexado na guia, não há o que copiar pro M1 — só marca
        // paga no M2 mesmo, como o fluxo fazia antes desta spec.
        if (guia.arquivo_guia_path) {
            const { data: fileBlob, error: dlErr } = await supabase.storage
                .from('tax-guides')
                .download(guia.arquivo_guia_path);
            if (dlErr) throw new Error('Falha ao baixar arquivo da guia: ' + dlErr.message);

            const buffer = Buffer.from(await fileBlob.arrayBuffer());
            const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const nomeOriginal = guia.arquivo_guia_path.split('/').pop() || 'guia.pdf';
            const novoPath = `${guia.project_id}/${uuid}/${nomeOriginal}`;

            const { error: upErr } = await supabase.storage
                .from('documentos')
                .upload(novoPath, buffer, { contentType: 'application/pdf', upsert: false });
            if (upErr) throw new Error('Falha ao copiar arquivo para o M1: ' + upErr.message);

            const jsonGuia = {
                guia: {
                    tributo: guia.tipo_imposto,
                    competencia: guia.competencia,
                    vencimento: guia.data_vencimento,
                    valor_tributo: guia.valor,
                    codigo_receita: guia.codigo_receita,
                    numero_guia: guia.numero_guia
                }
            };

            const { data: novoDoc, error: docErr } = await supabase
                .from('documents')
                .insert({
                    user_id: req.user.id,
                    project_id: guia.project_id,
                    organization_id: guia.organization_id,
                    name: `Guia ${guia.tipo_imposto} — ${guia.competencia}`,
                    file_path: novoPath,
                    valor: guia.valor,
                    valor_pago: guia.valor,
                    numero_nf: guia.numero_guia,
                    data_pagamento: agora.slice(0, 10),
                    tipo_documento: 'guia',
                    subtipo_documento: 'guia',
                    json_extraido: jsonGuia,
                    status: 'aguardando_conformidade'
                })
                .select('id')
                .single();
            if (docErr) {
                // Best-effort: não deixa o arquivo órfão no Storage se o INSERT falhar.
                await supabase.storage.from('documentos').remove([novoPath]).catch(() => {});
                throw new Error('Falha ao criar documento no M1: ' + docErr.message);
            }
            novoDocumentId = novoDoc.id;

            await supabase.from('audit_log').insert({
                tabela: 'tax_guides', registro_id: tax_guide_id, campo: 'document_id',
                valor_anterior: null, valor_novo: novoDocumentId,
                alterado_por: req.user.id, origem: 'guia_marcar_paga'
            });
        }

        const { error: updErr } = await supabase
            .from('tax_guides')
            .update({
                status: 'paga',
                data_pagamento: agora.slice(0, 10),
                document_id: novoDocumentId,
                atualizado_em: agora
            })
            .eq('id', tax_guide_id);
        if (updErr) throw updErr;

        res.json({ success: true, document_id: novoDocumentId });
    } catch (err) {
        console.error('[IMPOSTO-MARCAR-PAGA]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * SPEC-GUIA-01, Caso D — reconciliação retroativa. O trigger do Caso A já
 * criou uma guia nova em tax_guides (vinculada a `document_id`) sem checar se
 * já existia uma pendente igual, porque um trigger não pode perguntar nada a
 * ninguém. Este endpoint roda quando o usuário confirma, na tela de detalhe
 * do M1, que as duas são a mesma guia: marca a guia ANTIGA (do M2) como paga
 * e apaga a NOVA (criada automaticamente), pra não sobrar duplicata.
 *
 * POST /api/m2/impostos/consolidar-duplicata
 * Body: { tax_guide_id_antiga, document_id }
 */
app.post('/api/m2/impostos/consolidar-duplicata', requireAuth, async (req, res) => {
    const { tax_guide_id_antiga, document_id } = req.body || {};
    if (!tax_guide_id_antiga || !document_id) {
        return res.status(400).json({ error: 'tax_guide_id_antiga e document_id são obrigatórios.' });
    }

    try {
        const { data: guiaAntiga, error: antigaErr } = await supabase
            .from('tax_guides')
            .select('id, project_id')
            .eq('id', tax_guide_id_antiga)
            .single();
        if (antigaErr || !guiaAntiga) return res.status(404).json({ error: 'Guia (M2) não encontrada.' });

        if (!(await userCanAccessProject(req.user.id, guiaAntiga.project_id))) {
            return res.status(403).json({ error: 'Acesso negado ao projeto desta guia.' });
        }

        const { data: guiaNova, error: novaErr } = await supabase
            .from('tax_guides')
            .select('id')
            .eq('document_id', document_id)
            .neq('id', tax_guide_id_antiga)
            .maybeSingle();
        if (novaErr) throw novaErr;

        const { data: doc, error: docErr } = await supabase
            .from('documents')
            .select('data_pagamento')
            .eq('id', document_id)
            .single();
        if (docErr || !doc) return res.status(404).json({ error: 'Documento (M1) não encontrado.' });

        const agora = new Date().toISOString();
        const { error: updErr } = await supabase
            .from('tax_guides')
            .update({
                status: 'paga',
                document_id,
                data_pagamento: doc.data_pagamento || agora.slice(0, 10),
                atualizado_em: agora
            })
            .eq('id', tax_guide_id_antiga);
        if (updErr) throw updErr;

        if (guiaNova?.id) {
            const { error: delErr } = await supabase.from('tax_guides').delete().eq('id', guiaNova.id);
            if (delErr) throw delErr;
        }

        await supabase.from('audit_log').insert({
            tabela: 'tax_guides', registro_id: tax_guide_id_antiga, campo: 'status',
            valor_anterior: 'pendente/atrasada', valor_novo: 'paga (consolidada com duplicata do M1)',
            alterado_por: req.user.id, origem: 'consolidar_duplicata_guia'
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[IMPOSTO-CONSOLIDAR-DUPLICATA]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * SPEC-GUIA-01, Caso D — registra a decisão "não, são guias diferentes" em
 * audit_log (não há policy de INSERT em audit_log pro client, por isso passa
 * por aqui e não por um supabaseClient.insert direto no browser). Fica
 * rastreável (aparece no PDF de Auditoria) e faz buscarGuiaDuplicadaM2 (app.js)
 * parar de perguntar de novo pra essa combinação específica de documento+guia.
 *
 * POST /api/m2/impostos/ignorar-duplicata
 * Body: { document_id, tax_guide_id }
 */
app.post('/api/m2/impostos/ignorar-duplicata', requireAuth, async (req, res) => {
    const { document_id, tax_guide_id } = req.body || {};
    if (!document_id || !tax_guide_id) {
        return res.status(400).json({ error: 'document_id e tax_guide_id são obrigatórios.' });
    }

    try {
        const { data: doc, error: docErr } = await supabase
            .from('documents')
            .select('organization_id')
            .eq('id', document_id)
            .single();
        if (docErr || !doc) return res.status(404).json({ error: 'Documento não encontrado.' });

        const orgId = req.user.app_metadata?.org_id;
        if (orgId && doc.organization_id && doc.organization_id !== orgId) {
            return res.status(403).json({ error: 'Documento não pertence à sua organização.' });
        }

        await supabase.from('audit_log').insert({
            tabela: 'documents',
            registro_id: document_id,
            campo: 'guia_duplicata_decisao',
            valor_anterior: null,
            valor_novo: `nao_e_duplicata:${tax_guide_id}`,
            alterado_por: req.user.id,
            origem: 'gestor_ui'
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[IMPOSTO-IGNORAR-DUPLICATA]', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Cria (ou recupera) um fornecedor e vincula ao projeto.
 * POST /api/m2/fornecedores/criar-vincular
 * Body: { cnpj, razao_social, project_id }
 * Usa service_role — bypassa RLS da tabela fornecedores.
 */
app.post('/api/m2/fornecedores/criar-vincular', requireAuth, async (req, res) => {
    const { cnpj, razao_social, project_id } = req.body || {};
    if (!cnpj || !razao_social || !project_id) {
        return res.status(400).json({ error: 'cnpj, razao_social e project_id são obrigatórios.' });
    }
    if (!(await userCanAccessProject(req.user.id, project_id))) return res.status(403).json({ error: 'Acesso negado ao projeto.' });

    const { data: orgUser } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', req.user.id)
        .limit(1)
        .maybeSingle();
    const organization_id = orgUser?.organization_id || null;

    try {
        // Verificar se já existe pelo CNPJ
        let { data: existing } = await supabase
            .from('fornecedores')
            .select('id')
            .eq('cnpj', cnpj.replace(/\D/g, ''))
            .maybeSingle();

        let fornecedorId;
        if (existing) {
            fornecedorId = existing.id;
        } else {
            const { data: novo, error: insErr } = await supabase
                .from('fornecedores')
                .insert({ razao_social, cnpj: cnpj.replace(/\D/g, ''), organization_id })
                .select('id')
                .single();
            if (insErr) throw new Error('Erro ao criar fornecedor: ' + insErr.message);
            fornecedorId = novo.id;
        }

        // Vincular ao projeto (idempotente)
        const { data: vinculo } = await supabase
            .from('projeto_fornecedores')
            .select('id')
            .eq('project_id', project_id)
            .eq('fornecedor_id', fornecedorId)
            .maybeSingle();

        if (!vinculo) {
            const { error: linkErr } = await supabase
                .from('projeto_fornecedores')
                .insert({ project_id, fornecedor_id: fornecedorId, gestor_id: req.user.id });
            if (linkErr) throw new Error('Erro ao vincular fornecedor: ' + linkErr.message);
        }

        return res.json({ success: true, fornecedor_id: fornecedorId });
    } catch (err) {
        console.error('[FORNECEDOR-CRIAR]', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * Salva a revisão dos dados extraídos do PDF SALIC.
 * POST /api/m2/salvar-revisao-salic
 * Body: { project_id, import_id, user_id, etapas, locais, deslocamentos, divulgacao, complementar }
 */
app.post('/api/m2/salvar-revisao-salic', async (req, res) => {
    const { project_id, import_id, user_id, etapas, locais, deslocamentos, divulgacao, complementar } = req.body || {};

    if (!project_id || !import_id) {
        return res.status(400).json({ error: 'project_id e import_id são obrigatórios.' });
    }

    try {
        const { data: proj, error: projError } = await supabase
            .from('projects')
            .select('organization_id')
            .eq('id', project_id)
            .single();
        if (projError || !proj) throw new Error('Projeto não encontrado.');
        const organization_id = proj.organization_id;
        const base = { project_id, organization_id, import_id };

        // Limpar registros anteriores deste projeto
        const tabelas = [
            'project_etapas_trabalho', 'project_locais_realizacao',
            'project_deslocamentos', 'project_plano_divulgacao', 'project_dados_complementares'
        ];
        for (const t of tabelas) {
            await supabase.from(t).delete().eq('project_id', project_id);
        }

        if (etapas?.length) {
            const { error } = await supabase.from('project_etapas_trabalho').insert(
                etapas.map(e => ({
                    ...base,
                    nome: e.nome || null,
                    duracao_meses: e.duracao_meses ?? null,
                    objetivo: e.objetivo || null,
                    atividades: Array.isArray(e.atividades) ? e.atividades : [],
                    ordem: e.ordem || 0
                }))
            );
            if (error) throw new Error('Erro ao salvar etapas: ' + error.message);
        }

        if (locais?.length) {
            const { error } = await supabase.from('project_locais_realizacao').insert(
                locais.map(l => ({ ...base, pais: l.pais || null, uf: l.uf || null, cidade: l.cidade || null }))
            );
            if (error) throw new Error('Erro ao salvar locais: ' + error.message);
        }

        if (deslocamentos?.length) {
            const { error } = await supabase.from('project_deslocamentos').insert(
                deslocamentos.map(d => ({
                    ...base,
                    origem_uf: d.origem_uf || null, origem_cidade: d.origem_cidade || null,
                    destino_uf: d.destino_uf || null, destino_cidade: d.destino_cidade || null,
                    quantidade: d.quantidade ?? 1
                }))
            );
            if (error) throw new Error('Erro ao salvar deslocamentos: ' + error.message);
        }

        if (divulgacao?.length) {
            const { error } = await supabase.from('project_plano_divulgacao').insert(
                divulgacao.map(d => ({
                    ...base,
                    tipo_midia: d.tipo_midia || null,
                    descricao: d.descricao || null,
                    veiculo: d.veiculo || null,
                    quantidade: d.quantidade ?? null
                }))
            );
            if (error) throw new Error('Erro ao salvar plano de divulgação: ' + error.message);
        }

        const { error: errComp } = await supabase.from('project_dados_complementares').insert([{
            ...base,
            sintese: complementar?.sintese || null,
            objetivo_geral: complementar?.objetivo_geral || null,
            objetivos_especificos: Array.isArray(complementar?.objetivos_especificos) ? complementar.objetivos_especificos : [],
            justificativa: complementar?.justificativa || null,
            periodo_inicio: dateOrNull(complementar?.periodo_inicio),
            periodo_fim: dateOrNull(complementar?.periodo_fim),
            produtos: Array.isArray(complementar?.produtos) ? complementar.produtos : [],
            ficha_tecnica: Array.isArray(complementar?.ficha_tecnica) ? complementar.ficha_tecnica : []
        }]);
        if (errComp) throw new Error('Erro ao salvar dados complementares: ' + errComp.message);

        const revisado_em = new Date().toISOString();
        await supabase.from('project_salic_imports').update({
            status: 'revisado',
            revisado_por: user_id || null,
            revisado_em
        }).eq('id', import_id);

        console.log(`[SALIC-REVISAO] Projeto ${project_id}, import ${import_id} revisado.`);
        return res.json({ success: true, revisado_em });

    } catch (error) {
        console.error('[SALIC-REVISAO] Erro:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * Proxy para geração de relatório via n8n
 */
app.post('/api/m2/gerar-relatorio', async (req, res) => {
    try {
        const https = require('https');
        const dataStr = JSON.stringify(req.body);
        
        const options = {
            hostname: 'automacoes-n8n.infrassys.com',
            port: 443,
            path: '/webhook-test/relatorio',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': dataStr.length
            }
        };

        const n8nReq = https.request(options, (n8nRes) => {
            let responseData = '';
            n8nRes.on('data', (chunk) => { responseData += chunk; });
            n8nRes.on('end', () => {
                try {
                    if (!responseData) return res.json({ success: true, message: "Workflow iniciado" });
                    const json = JSON.parse(responseData);
                    res.status(n8nRes.statusCode).json(json);
                } catch (e) {
                    const ok = n8nRes.statusCode < 400;
                    if (!ok) console.error('[REPORT PROXY ERROR] n8n respondeu', n8nRes.statusCode, responseData);
                    res.status(n8nRes.statusCode).json({
                        success: ok,
                        message: ok ? responseData : 'Não foi possível gerar o relatório agora. Tente novamente em instantes.'
                    });
                }
            });
        });

        n8nReq.on('error', (error) => {
            console.error('[REPORT PROXY ERROR] n8n inacessível:', error);
            if (!res.headersSent) res.status(502).json({ success: false, message: 'Não foi possível gerar o relatório agora. Tente novamente em instantes.' });
        });
        n8nReq.write(dataStr);
        n8nReq.end();
    } catch (error) {
        console.error('[REPORT PROXY ERROR]', error);
        res.status(500).json({ success: false, message: 'Não foi possível gerar o relatório agora. Tente novamente em instantes.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m2/evidencia/notificar
// Chamado pelo frontend (fire-and-forget) após UPDATE em physical_evidences.
// Busca dados e envia o e-mail adequado ao solicitante.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/m2/evidencia/notificar', async (req, res) => {
    const { evidencia_id, novo_status, analista_id } = req.body || {};
    if (!evidencia_id || !novo_status) {
        return res.status(400).json({ error: 'evidencia_id e novo_status são obrigatórios.' });
    }

    // Responde imediatamente — e-mail é fire-and-forget
    res.json({ ok: true });

    try {
        const { data: ev, error: evErr } = await supabase
            .from('physical_evidences')
            .select('file_name, motivo_reprovacao, enviado_por, projects(nome, pronac)')
            .eq('id', evidencia_id)
            .single();
        if (evErr || !ev) { console.warn('[notificar-evidencia] evidência não encontrada', evErr); return; }

        const { data: { user: destinatario } } = await supabase.auth.admin.getUserById(ev.enviado_por);
        if (!destinatario?.email) { console.warn('[notificar-evidencia] sem e-mail para', ev.enviado_por); return; }

        const nomeAnalista = analista_id
            ? await supabase.auth.admin.getUserById(analista_id)
                .then(r => r.data?.user?.user_metadata?.name || r.data?.user?.email || 'Analista')
            : 'Analista';

        const projeto = ev.projects || {};
        const hoje = new Date().toLocaleDateString('pt-BR');

        let emailData;
        if (novo_status === 'aprovada') {
            emailData = emailEvidenciaAprovada({
                nomeArquivo: ev.file_name, nomeProjeto: projeto.nome, pronac: projeto.pronac,
                aprovadoPor: nomeAnalista, dataAprovacao: hoje
            });
        } else if (novo_status === 'reprovada') {
            emailData = emailEvidenciaReprovada({
                nomeArquivo: ev.file_name, nomeProjeto: projeto.nome, pronac: projeto.pronac,
                motivoReprovacao: ev.motivo_reprovacao || '—',
                reprovadoPor: nomeAnalista, dataReprovacao: hoje
            });
        } else if (novo_status === 'pendente_complemento') {
            emailData = emailComplementoSolicitado({
                nomeArquivo: ev.file_name, nomeProjeto: projeto.nome, pronac: projeto.pronac,
                descricaoComplemento: ev.motivo_reprovacao || '—'
            });
        } else {
            return;
        }

        await sendEmail({ to: destinatario.email, ...emailData });
    } catch (err) {
        console.error('[notificar-evidencia] Erro:', err.message);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m2/cron-alerta-guias
// Chamado diariamente pelo pg_cron às 11h.
// Envia alertas de guias vencendo em 7 dias aos gestores/analistas.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/m2/cron-alerta-guias', async (req, res) => {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const hoje = new Date().toISOString().split('T')[0];
        const em7dias = new Date();
        em7dias.setDate(em7dias.getDate() + 7);
        const em7diasStr = em7dias.toISOString().split('T')[0];

        const { data: guias, error: guiasErr } = await supabase
            .from('tax_guides')
            .select('tipo_imposto, competencia, valor, data_vencimento, projects(id, nome, pronac, organization_id)')
            .eq('status', 'pendente')
            .gte('data_vencimento', hoje)
            .lte('data_vencimento', em7diasStr);

        if (guiasErr) throw guiasErr;
        if (!guias?.length) return res.json({ enviados: 0, mensagem: 'Nenhuma guia vencendo.' });

        // Agrupar por projeto
        const porProjeto = {};
        guias.forEach(g => {
            const pid = g.projects?.id;
            if (!pid) return;
            if (!porProjeto[pid]) porProjeto[pid] = { projeto: g.projects, guias: [] };
            porProjeto[pid].guias.push(g);
        });

        let totalEnviados = 0;
        for (const { projeto, guias: guiasProjeto } of Object.values(porProjeto)) {
            const { data: orgUsers } = await supabase
                .from('organization_users')
                .select('user_id')
                .eq('organization_id', projeto.organization_id)
                .in('role', ['gestor', 'analista', 'admin']);

            for (const ou of orgUsers || []) {
                const { data: { user } } = await supabase.auth.admin.getUserById(ou.user_id);
                if (!user?.email) continue;
                const emailData = emailAlertaGuiaVencendo({
                    nomeProjeto: projeto.nome, pronac: projeto.pronac, guias: guiasProjeto
                });
                await sendEmail({ to: user.email, ...emailData });
                totalEnviados++;
            }
        }

        res.json({ enviados: totalEnviados });
    } catch (err) {
        console.error('[cron-alerta-guias] Erro:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/m3/eventos/:id/encerrar
// Encerra um evento M3. Bloqueia se não houver lista de presença.
// ─────────────────────────────────────────────────────────────────────────────
app.put('/api/m3/eventos/:id/encerrar', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const { data: evento, error } = await supabase
            .from('distribution_events')
            .select('*, distribution_attendance(*)')
            .eq('id', id)
            .is('excluido_em', null)
            .single();

        if (error || !evento)
            return res.status(404).json({ error: 'Evento não encontrado' });

        if (!evento.distribution_attendance.length)
            return res.status(400).json({
                error: 'Evento sem lista de presença — encerramento bloqueado',
            });

        const { count: pendentes } = await supabase
            .from('physical_evidences')
            .select('id', { count: 'exact', head: true })
            .eq('distribution_event_id', id)
            .eq('status_validacao', 'pendente');

        await supabase
            .from('distribution_events')
            .update({ status: 'encerrado', updated_at: new Date() })
            .eq('id', id);

        return res.json({
            sucesso: true,
            evidencias_pendentes_aprovacao: pendentes || 0,
            mensagem: pendentes > 0
                ? `Evento encerrado. ${pendentes} evidência(s) aguardam aprovação no M2.`
                : 'Evento encerrado com sucesso.',
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m3/eventos/:id/excluir
// SOFT delete de evento. Nunca DELETE real: distribution_guests/event_os/
// event_pa/attendance são todos ON DELETE CASCADE — apagaria convidados e
// check-ins junto, silenciosamente. Endpoint server-side porque a RLS de
// distribution_events é só por organização (sem role): um soft delete feito
// pelo client não teria como barrar operador de verdade.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/m3/eventos/:id/excluir',
    requireAuth, requireRole('gestor', 'admin'),
    async (req, res) => {
        try {
            const orgId = req.user.app_metadata?.org_id;
            if (!orgId) return res.status(403).json({ error: 'Usuário sem organização vinculada.' });

            const { data: evento, error: getErr } = await supabase
                .from('distribution_events')
                .select('id, titulo, organization_id, excluido_em')
                .eq('id', req.params.id)
                .maybeSingle();
            if (getErr) throw getErr;

            // 404 também para evento de outra org — não vaza existência.
            if (!evento || evento.organization_id !== orgId) {
                return res.status(404).json({ error: 'Evento não encontrado' });
            }
            if (evento.excluido_em) return res.json({ sucesso: true }); // idempotente

            const agora = new Date().toISOString();
            const { error: updErr } = await supabase
                .from('distribution_events')
                .update({ excluido_em: agora, excluido_por: req.user.id })
                .eq('id', evento.id);
            if (updErr) throw updErr;

            await supabase.from('audit_log').insert({
                tabela: 'distribution_events',
                registro_id: evento.id,
                campo: 'excluido_em',
                valor_anterior: null,
                valor_novo: agora,
                alterado_por: req.user.id,
                origem: 'm3_web'
            });

            return res.json({ sucesso: true });
        } catch (e) {
            console.error('[M3] excluir evento:', e);
            return res.status(500).json({ error: e.message });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/m3/pwa/eventos?q=termo
// Lista eventos da organizacao do usuario para busca por nome no PWA de campo
// (o operador nao tem como saber o UUID do evento, so pesquisar pelo titulo).
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/m3/pwa/eventos', requireAuth, async (req, res) => {
    try {
        const orgId = req.user.app_metadata?.org_id;
        if (!orgId) return res.status(403).json({ error: 'Usuário sem organização vinculada.' });

        const q = (req.query.q || '').trim();
        let query = supabase
            .from('distribution_events')
            // tipo_acesso distingue evento de entrada livre. ingressos_os/pa já eram
            // exibidos pelo PWA mas não vinham no select — a lista mostrava
            // "0 ingressos" para todo evento.
            .select('id, titulo, data_evento, nome_local, cidade, estado, status, tipo_acesso, ingressos_os, ingressos_pa')
            .eq('organization_id', orgId)
            .is('excluido_em', null)
            .order('data_evento', { ascending: false })
            .limit(30);

        if (q) query = query.ilike('titulo', `%${q}%`);

        const { data: eventos, error } = await query;
        if (error) throw error;

        return res.json(eventos || []);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/m3/pwa/evento/:id
// Pré-carrega evento completo para uso offline no PWA de campo.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/m3/pwa/evento/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { data: evento, error } = await supabase
            .from('distribution_events')
            .select(`
                *,
                distribution_event_os(*, distribution_os(*)),
                distribution_event_pa(*, distribution_pa(*)),
                distribution_guests(*),
                distribution_atividades(*)
            `)
            .eq('id', id)
            .is('excluido_em', null)
            .maybeSingle();

        if (error || !evento)
            return res.status(404).json({ error: 'Evento não encontrado' });

        return res.json(evento);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m3/pwa/sync
// Recebe check-ins offline e PERSISTE em distribution_guests (checkin_em/
// checkin_por), com proteção contra duplicidade; público geral (ingresso
// vendido, fora da cota OS/PA) é criado no ato. audit_log continua sendo
// gravado para rastreabilidade de toda tentativa, inclusive duplicadas.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/m3/pwa/sync', requireAuth, async (req, res) => {
    try {
        const { checkins = [] } = req.body;
        if (!checkins.length) return res.json({ processados: 0, erros: [] });

        const resultados = [];
        const erros = [];

        // Valida que a atividade do payload pertence ao evento. Inválida ou
        // ausente -> null, NUNCA rejeita: check-in feito offline não pode ser
        // perdido por causa de um metadado — a presença é o dado que importa.
        async function atividadeValidaOuNull(atividadeId, eventId) {
            if (!atividadeId || !eventId) return null;
            const { data } = await supabase
                .from('distribution_atividades')
                .select('id')
                .eq('id', atividadeId)
                .eq('event_id', eventId)
                .maybeSingle();
            if (!data) {
                console.warn('[PWA-SYNC] atividade_id inválida para o evento, gravando sem atividade:',
                    atividadeId, eventId);
            }
            return data ? atividadeId : null;
        }

        for (const checkin of checkins) {
            try {
                const atividadeId = await atividadeValidaOuNull(checkin.atividade_id, checkin.event_id);

                if (checkin.guest_id) {
                    // Convidado JÁ CADASTRADO (OS/PA pré-registrado) — só marca
                    // o check-in. Se checkin_em já estiver preenchido, NÃO
                    // sobrescreve (duplicidade): mantém o horário original e
                    // registra a tentativa no audit_log abaixo.
                    const { data: guest } = await supabase
                        .from('distribution_guests')
                        .select('checkin_em, atividade_id')
                        .eq('id', checkin.guest_id)
                        .maybeSingle();

                    if (guest && !guest.checkin_em) {
                        await supabase.from('distribution_guests')
                            .update({
                                checkin_em: checkin.timestamp,
                                checkin_por: req.user?.id || null,
                                // Preenche a atividade só se o convidado ainda não
                                // tiver uma — mesma filosofia do checkin_em: o que
                                // foi definido no cadastro não é sobrescrito.
                                ...(atividadeId && !guest.atividade_id
                                    ? { atividade_id: atividadeId } : {})
                            })
                            .eq('id', checkin.guest_id);
                    }

                } else if (checkin.novo_publico_geral) {
                    // Registro NOVO de público geral, criado na hora na portaria.
                    // Contador separado da cota: NÃO consome ingressos_os/pa.
                    let orgId = checkin.organization_id || null;
                    if (!orgId && checkin.event_id) {
                        const { data: ev } = await supabase
                            .from('distribution_events')
                            .select('organization_id')
                            .eq('id', checkin.event_id)
                            .maybeSingle();
                        orgId = ev?.organization_id || null;
                    }

                    const { data: novoGuest, error: insErr } =
                        await supabase.from('distribution_guests')
                            .insert({
                                event_id: checkin.event_id,
                                organization_id: orgId,
                                nome_completo: checkin.nome_completo,
                                cpf: checkin.cpf || null,
                                lgpd_consent: checkin.lgpd_consent || false,
                                lgpd_consent_at: checkin.lgpd_consent
                                    ? checkin.timestamp : null,
                                tipo_entrada: 'publico_geral',
                                os_id: null,
                                pa_id: null,
                                atividade_id: atividadeId,
                                checkin_em: checkin.timestamp,
                                checkin_por: req.user?.id || null
                            })
                            .select('id')
                            .single();

                    if (insErr) throw insErr;
                    checkin.guest_id = novoGuest.id; // para o log abaixo
                }

                await supabase.from('audit_log').insert({
                    tabela:       'distribution_guests',
                    registro_id:  checkin.guest_id || null,
                    campo:        'checkin_pwa',
                    valor_novo:   JSON.stringify({
                        event_id:      checkin.event_id,
                        nome_completo: checkin.nome_completo,
                        org_nome:      checkin.org_nome,
                        tipo:          checkin.tipo,
                        atividade_id:  atividadeId,
                        timestamp:     checkin.timestamp,
                    }),
                    alterado_por: req.user?.id || null,
                    origem:       'pwa_offline',
                });
                resultados.push({ id: checkin.id, sucesso: true });
            } catch (e) {
                erros.push({ id: checkin.id, erro: e.message });
            }
        }

        return res.json({
            processados: resultados.length,
            erros,
            sucesso: erros.length === 0,
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIOS M3 — geração de .docx (relatório de evento + relatório mensal)
// Não há geração de .docx reaproveitável no repo (o relatório do M2 é montado
// por um webhook n8n externo) — construído do zero com a lib `docx`.
// ─────────────────────────────────────────────────────────────────────────────

// Formata uma data pura (YYYY-MM-DD) sem passar por new Date() — evita o bug
// de fuso horário já conhecido em formatDate()/toLocaleDateString().
function fmtDataBRRelatorio(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '—';
    const [ano, mes, dia] = dateStr.split('-');
    if (!ano || !mes || !dia) return dateStr;
    return `${dia}/${mes}/${ano}`;
}

function relHeading(text, level) {
    return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}

function relBodyParagraph(text) {
    return new Paragraph({ children: [new TextRun(String(text))], spacing: { after: 120 } });
}

// Um Paragraph por linha — nunca \n dentro de um único Paragraph.
function relMultilineParagraphs(text) {
    if (!text) return [relBodyParagraph('—')];
    const linhas = String(text).split('\n').filter(l => l.trim());
    return linhas.length ? linhas.map(relBodyParagraph) : [relBodyParagraph('—')];
}

function relLabelValueParagraph(label, value) {
    return new Paragraph({
        children: [
            new TextRun({ text: `${label}: `, bold: true }),
            new TextRun(value != null && value !== '' ? String(value) : '—'),
        ],
        spacing: { after: 80 },
    });
}

// Rótulo em negrito + link clicável de verdade (ExternalHyperlink). Se o link
// estiver vazio, mantém a linha com "—" (não omite — preserva a estrutura do
// template mesmo incompleto).
function relLinkLabelParagraph(label, url) {
    const u = url != null && String(url).trim() ? String(url).trim() : null;
    const valueRun = u
        ? new ExternalHyperlink({ link: u, children: [new TextRun({ text: u, style: 'Hyperlink' })] })
        : new TextRun('—');
    return new Paragraph({
        children: [new TextRun({ text: `${label}: `, bold: true }), valueRun],
        spacing: { after: 80 },
    });
}

// Rótulo em negrito (linha própria) + corpo multilinha (um Paragraph por linha).
function relCampoLongo(label, value) {
    return [
        new Paragraph({ children: [new TextRun({ text: `${label}:`, bold: true })], spacing: { before: 160, after: 60 } }),
        ...relMultilineParagraphs(value),
    ];
}

const REL_DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
// Dia da semana em pt-BR a partir de 'YYYY-MM-DD' sem bug de fuso (UTC).
function relDiaSemana(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const [a, m, d] = dateStr.split('-').map(Number);
    if (!a || !m || !d) return '';
    return REL_DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] || '';
}

// "Quantitativo de público x meta estimada" — um bloco de texto por dia.
function relPublicoPorDiaTexto(rows) {
    if (!Array.isArray(rows) || !rows.length) return [relBodyParagraph('—')];
    return rows.map(r => {
        const dia = relDiaSemana(r.data);
        const dm  = fmtDataBRRelatorio(r.data).slice(0, 5); // DD/MM
        const disp = r.disponibilizado ?? 0;
        const ret  = r.retirado ?? 0;
        const pres = r.presente ?? 0;
        const prefixo = dia ? `${dia} (${dm})` : (dm !== '—/' ? `(${dm})` : 'Dia');
        return relBodyParagraph(`${prefixo}: ingressos disponibilizados ${disp} (${ret} retirados). Público total: ${pres}`);
    });
}

// Galeria de imagens de UM tipo de evidência (rótulo + imagens embutidas).
// Se não houver imagens, mantém o rótulo e escreve "—".
function relGaleriaImagens(label, imagens) {
    const out = [new Paragraph({ children: [new TextRun({ text: `${label}:`, bold: true })], spacing: { before: 160, after: 80 } })];
    if (!imagens.length) {
        out.push(relBodyParagraph('—'));
        return out;
    }
    for (const img of imagens) {
        out.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [new ImageRun({ data: img.buffer, transformation: { width: img.width, height: img.height }, type: img.type })],
        }));
        if (img.descricao) {
            out.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
                children: [new TextRun({ text: img.descricao, italics: true, size: 18 })],
            }));
        }
    }
    return out;
}

// Seção 3 (financeiro): "{nome} - R$ {valor}", como hyperlink para a planilha
// quando link_planilha existir, texto simples quando vazio.
function relCustoLinha(c) {
    const texto = `${c.nome_evento || '—'} - R$ ${(Number(c.valor) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const link = c.link_planilha != null && String(c.link_planilha).trim() ? String(c.link_planilha).trim() : null;
    if (link) {
        return new Paragraph({
            children: [new ExternalHyperlink({ link, children: [new TextRun({ text: texto, style: 'Hyperlink' })] })],
            spacing: { after: 120 },
        });
    }
    return relBodyParagraph(texto);
}

async function getEvidenciasDoEventoM3(eventId) {
    const { data, error } = await supabase
        .from('physical_evidences')
        .select('*')
        .eq('distribution_event_id', eventId)
        .order('criado_em', { ascending: false });
    if (error) throw error;
    return data || [];
}

// Baixa as evidências-imagem do evento (service role bypassa RLS) e devolve
// os buffers já dimensionados preservando a proporção real de cada foto.
async function baixarImagensEvidenciasM3(evidencias) {
    const imagens = [];
    const MAX_LARGURA_PX = 420;
    for (const ev of evidencias) {
        if (!ev.file_path || !(ev.mime_type || '').startsWith('image/')) continue;
        try {
            const { data: blob, error } = await supabase.storage
                .from('physical-evidences')
                .download(ev.file_path.trim());
            if (error || !blob) continue;
            const buffer = Buffer.from(await blob.arrayBuffer());
            const dim = imageSize(buffer);
            const tipo = dim.type === 'jpeg' ? 'jpg' : dim.type;
            if (!['jpg', 'png', 'gif', 'bmp'].includes(tipo)) continue;
            const escala = dim.width > MAX_LARGURA_PX ? MAX_LARGURA_PX / dim.width : 1;
            imagens.push({
                buffer,
                width: Math.round(dim.width * escala),
                height: Math.round(dim.height * escala),
                type: tipo,
                descricao: ev.descricao || ev.file_name || '',
                tipoEvidencia: ev.tipo_evidencia || 'outros',
            });
        } catch (err) {
            console.warn('[RELATORIO-M3] Falha ao baixar evidência', ev.id, err.message);
        }
    }
    return imagens;
}

function relTabelaPublicoPorDia(rows) {
    if (!Array.isArray(rows) || !rows.length) return [relBodyParagraph('Não informado.')];
    const colWidths = [2500, 2200, 2200, 2200]; // DXA
    const headerRow = new TableRow({
        children: ['Data', 'Disponibilizado', 'Retirado', 'Presente'].map((h, i) => new TableCell({
            width: { size: colWidths[i], type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: 'E3E8FF' },
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        })),
    });
    const bodyRows = rows.map(r => new TableRow({
        children: [
            fmtDataBRRelatorio(r.data),
            String(r.disponibilizado ?? '—'),
            String(r.retirado ?? '—'),
            String(r.presente ?? '—'),
        ].map((v, i) => new TableCell({
            width: { size: colWidths[i], type: WidthType.DXA },
            children: [new Paragraph(v)],
        })),
    }));
    return [new Table({
        width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnWidths: colWidths,
        rows: [headerRow, ...bodyRows],
    })];
}

function relTabelaComunicacao(relatorio) {
    const linhas = [
        ['Seguidores (total)', relatorio.comunicacao_seguidores_total],
        ['Novos seguidores no mês', relatorio.comunicacao_novos_seguidores],
        ['Interações', relatorio.comunicacao_interacoes],
        ['Visualizações', relatorio.comunicacao_visualizacoes],
        ['Alcance', relatorio.comunicacao_alcance],
        ['Matérias (quantidade)', relatorio.comunicacao_materias_qtd],
        ['Matérias positivas (%)', relatorio.comunicacao_materias_positivas_pct],
        ['Retorno em mídia (R$)', relatorio.comunicacao_retorno_midia_valor != null
            ? Number(relatorio.comunicacao_retorno_midia_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
            : null],
    ];
    const colWidths = [4500, 3500];
    const rows = linhas.map(([label, valor]) => new TableRow({
        children: [
            new TableCell({
                width: { size: colWidths[0], type: WidthType.DXA },
                shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
            }),
            new TableCell({
                width: { size: colWidths[1], type: WidthType.DXA },
                children: [new Paragraph(valor != null && valor !== '' ? String(valor) : '—')],
            }),
        ],
    }));
    return [new Table({
        width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
        columnWidths: colWidths,
        rows,
    })];
}

// Seção 2 completa de UM evento — reaproveitada no relatório avulso
// e repetida por evento no relatório mensal consolidado. Segue a ORDEM EXATA
// do template real da Animus (19 itens).
//   numeroSecao : "2.1", "2.2"… no mensal; null no avulso.
//   numeroEvento: 1, 2…       usado no título "EVENTO NN" do mensal.
async function buildSecaoEventoM3(evento, numeroSecao, numeroEvento) {
    const evidencias = await getEvidenciasDoEventoM3(evento.id);
    const imagens = await baixarImagensEvidenciasM3(evidencias);

    // 3 galerias distintas, filtradas por tipo_evidencia.
    const galExecucao      = imagens.filter(i => i.tipoEvidencia === 'foto_evento');
    const galAcessibilidade = imagens.filter(i => i.tipoEvidencia === 'acessibilidade');
    const galComunicacao   = imagens.filter(i => i.tipoEvidencia === 'peca_marketing');

    const children = [];

    // 1. Título numerado "2.X EVENTO NN"
    const tituloSecao = numeroSecao
        ? `${numeroSecao} EVENTO ${String(numeroEvento || 1).padStart(2, '0')}`
        : 'EVENTO';
    children.push(relHeading(tituloSecao, HeadingLevel.HEADING_2));

    // 2. Nome do evento
    children.push(relLabelValueParagraph('Nome do evento', evento.titulo));

    // 3. Data | Horário (texto livre) | Local de realização
    children.push(relLabelValueParagraph('Data', fmtDataBRRelatorio(evento.data_evento)));
    children.push(relLabelValueParagraph('Horário',
        evento.horario_descricao || (evento.horario ? String(evento.horario).slice(0, 5) : null)));
    children.push(relLabelValueParagraph('Local de realização',
        [evento.nome_local, evento.cidade, evento.estado].filter(Boolean).join(' — ')));

    // 4. Resumo do evento
    children.push(...relCampoLongo('Resumo do evento', evento.resumo_evento));

    // 5. Quantitativo de atividades incluídas no evento
    children.push(...relCampoLongo('Quantitativo de atividades incluídas no evento', evento.quantitativo_atividades));

    // 6. Quantitativo de público x meta estimada (blocos de texto por dia)
    children.push(new Paragraph({ children: [new TextRun({ text: 'Quantitativo de público x meta estimada:', bold: true })], spacing: { before: 160, after: 60 } }));
    children.push(...relPublicoPorDiaTexto(evento.publico_por_dia));

    // 7. Perfil do público-alvo
    children.push(...relCampoLongo('Perfil do público-alvo', evento.perfil_publico));

    // 8. Link — borderôs e listas de presença
    children.push(relLinkLabelParagraph('Link aberto para borderôs e listas de presença', evento.link_borderos));

    // 9. Link — fotos, vídeos e comprovantes de execução
    children.push(relLinkLabelParagraph('Link aberto para fotos, vídeos e comprovantes de execução', evento.link_fotos_execucao));

    // 10. Galeria — fotos/vídeos/comprovantes de execução (foto_evento)
    children.push(...relGaleriaImagens('Fotos, vídeos e comprovantes de execução', galExecucao));

    // 11. Ações de Acessibilidade
    children.push(...relCampoLongo('Ações de Acessibilidade', evento.acoes_acessibilidade));

    // 12. Link — fotos comprobatórias de acessibilidade
    children.push(relLinkLabelParagraph('Link aberto para fotos comprobatórias de ações de Acessibilidade', evento.link_fotos_acessibilidade));

    // 13. Galeria — fotos comprobatórias de acessibilidade (acessibilidade)
    children.push(...relGaleriaImagens('Fotos comprobatórias de ações de Acessibilidade', galAcessibilidade));

    // 14. Link — materiais de comunicação
    children.push(relLinkLabelParagraph('Link aberto para materiais de comunicação', evento.link_materiais_comunicacao));

    // 15. Galeria — materiais de comunicação (peca_marketing)
    children.push(...relGaleriaImagens('Materiais de comunicação', galComunicacao));

    // 16. Número de fornecedores contratados
    children.push(relLabelValueParagraph('Número de fornecedores contratados', evento.numero_fornecedores));

    // 17. Quantidade de empregos temporários gerados
    children.push(relLabelValueParagraph('Quantidade de empregos temporários gerados', evento.empregos_gerados));

    // 18. Ocorreram ações ambientais no evento? Quais?
    children.push(...relCampoLongo('Ocorreram ações ambientais no evento? Quais?', evento.acoes_ambientais));

    // 19. Desafios encontrados e possíveis soluções
    children.push(...relCampoLongo('Desafios encontrados e possíveis soluções', evento.desafios_evento));

    return children;
}

async function uploadRelatorioDocxM3(buffer, projectId, filename) {
    const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const filePath = `${projectId}/${uuid}/${filename}`;
    const { error } = await supabase.storage.from('reports').upload(filePath, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
    });
    if (error) throw new Error('Falha no upload do relatório: ' + error.message);
    return filePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m3/relatorio/evento/:eventId
// Gera o relatório .docx de UM evento (Seção 2 completa).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/m3/relatorio/evento/:eventId', requireAuth, async (req, res) => {
    try {
        const { eventId } = req.params;

        const { data: evento, error } = await supabase
            .from('distribution_events')
            .select('*')
            .eq('id', eventId)
            .is('excluido_em', null)
            .single();
        if (error || !evento) return res.status(404).json({ error: 'Evento não encontrado.' });

        if (!(await userCanAccessProject(req.user.id, evento.project_id))) {
            return res.status(403).json({ error: 'Acesso negado ao projeto.' });
        }

        const { data: projeto } = await supabase
            .from('projects')
            .select('nome, pronac')
            .eq('id', evento.project_id)
            .maybeSingle();

        const secaoEvento = await buildSecaoEventoM3(evento, null);

        const doc = new Document({
            sections: [{
                children: [
                    new Paragraph({ text: 'RELATÓRIO DE EVENTO', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
                    new Paragraph({ text: evento.titulo, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
                    relLabelValueParagraph('Projeto', projeto ? `${projeto.nome} (PRONAC ${projeto.pronac})` : '—'),
                    relLabelValueParagraph('Data', fmtDataBRRelatorio(evento.data_evento)),
                    new Paragraph({ children: [new PageBreak()] }),
                    ...secaoEvento,
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        const filePath = await uploadRelatorioDocxM3(buffer, evento.project_id, `relatorio-evento-${eventId}.docx`);

        await supabase.from('distribution_events').update({
            relatorio_status: 'gerado',
            relatorio_evento_file_path: filePath,
            relatorio_evento_gerado_em: new Date(),
        }).eq('id', eventId);

        const { data: signed, error: signErr } = await supabase.storage
            .from('reports')
            .createSignedUrl(filePath.trim(), 3600);
        if (signErr) throw new Error('Falha ao gerar link de download: ' + signErr.message);

        return res.json({ success: true, path: filePath, url: signed.signedUrl });
    } catch (err) {
        console.error('[RELATORIO-EVENTO-M3] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/m3/relatorio/periodo
// Gera o relatório mensal consolidado (.docx) com todos os eventos do período.
// Body: { project_id, mes_referencia }  (mes_referencia = 'YYYY-MM-01')
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/m3/relatorio/periodo', requireAuth, async (req, res) => {
    try {
        const { project_id, mes_referencia } = req.body || {};
        if (!project_id || !mes_referencia) {
            return res.status(400).json({ error: 'project_id e mes_referencia são obrigatórios.' });
        }
        if (!(await userCanAccessProject(req.user.id, project_id))) {
            return res.status(403).json({ error: 'Acesso negado ao projeto.' });
        }

        const { data: relatorio, error: relErr } = await supabase
            .from('distribution_monthly_reports')
            .select('*')
            .eq('project_id', project_id)
            .eq('mes_referencia', mes_referencia)
            .maybeSingle();
        if (relErr) throw relErr;
        if (!relatorio) {
            return res.status(404).json({ error: 'Finalize o rascunho antes de gerar o relatório final.' });
        }

        const { data: projeto } = await supabase
            .from('projects')
            .select('nome, pronac, codigo_projeto_contrato')
            .eq('id', project_id)
            .maybeSingle();

        // Recalcula o período no servidor (não confia em lista vinda do cliente).
        const [ano, mes] = mes_referencia.split('-');
        const proximoMes = mes === '12'
            ? `${Number(ano) + 1}-01-01`
            : `${ano}-${String(Number(mes) + 1).padStart(2, '0')}-01`;

        const { data: eventos, error: evErr } = await supabase
            .from('distribution_events')
            .select('*')
            .eq('project_id', project_id)
            .is('excluido_em', null)
            .gte('data_evento', mes_referencia)
            .lt('data_evento', proximoMes)
            .order('data_evento', { ascending: true });
        if (evErr) throw evErr;

        const custos = Array.isArray(relatorio.custos_por_evento) ? relatorio.custos_por_evento : [];
        const totalCustos = custos.reduce((s, c) => s + (Number(c.valor) || 0), 0);

        const secoesEventos = [];
        for (let i = 0; i < (eventos || []).length; i++) {
            secoesEventos.push(...(await buildSecaoEventoM3(eventos[i], `2.${i + 1}`, i + 1)));
            secoesEventos.push(new Paragraph({ children: [new PageBreak()] }));
        }

        const children = [
            new Paragraph({ text: 'RELATÓRIO DE ATIVIDADES', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
            new Paragraph({ text: projeto ? `${projeto.nome} (PRONAC ${projeto.pronac})` : '', alignment: AlignmentType.CENTER, spacing: { after: 40 } }),
            new Paragraph({ text: `Período: ${fmtDataBRRelatorio(mes_referencia)}`, alignment: AlignmentType.CENTER, spacing: { after: 240 } }),

            relHeading('1. Identificação do Especialista', HeadingLevel.HEADING_1),
            relLabelValueParagraph('Nome', relatorio.especialista_nome),
            relLabelValueParagraph('Função', relatorio.especialista_funcao),
            relLabelValueParagraph('Projeto', projeto && projeto.codigo_projeto_contrato),
            relLabelValueParagraph('Projeto de atuação', projeto && projeto.nome),

            new Paragraph({ children: [new PageBreak()] }),
            relHeading('2. Realizações', HeadingLevel.HEADING_1),
            ...secoesEventos,

            relHeading('3. Resultado Financeiro', HeadingLevel.HEADING_1),
            ...(custos.length
                ? custos.map(relCustoLinha)
                : [relBodyParagraph('Nenhum custo informado.')]),
            new Paragraph({
                children: [new TextRun({ text: `Custo total: R$ ${totalCustos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, bold: true })],
                spacing: { before: 120, after: 240 },
            }),

            relHeading('4. Principais Desafios do Período', HeadingLevel.HEADING_1),
            ...relMultilineParagraphs(relatorio.desafios_periodo),

            relHeading('5. Gerenciamento de Equipe', HeadingLevel.HEADING_1),
            ...relMultilineParagraphs(relatorio.gerenciamento_equipe),

            relHeading('6. Dados Gerais de Comunicação', HeadingLevel.HEADING_1),
            ...relTabelaComunicacao(relatorio),

            new Paragraph({ children: [new PageBreak()] }),
            relHeading('Assinatura', HeadingLevel.HEADING_1),
            relBodyParagraph(relatorio.assinatura_cidade_data || '—'),
            relBodyParagraph(relatorio.assinatura_nome || '—'),
            relBodyParagraph(relatorio.assinatura_cargo || '—'),
            relBodyParagraph(relatorio.assinatura_local_projeto || '—'),
        ];

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);
        const filePath = await uploadRelatorioDocxM3(buffer, project_id, `relatorio-mensal-${mes_referencia}.docx`);

        await supabase.from('distribution_monthly_reports').update({
            relatorio_file_path: filePath,
            relatorio_gerado_em: new Date(),
            atualizado_em: new Date(),
        }).eq('id', relatorio.id);

        const { data: signed, error: signErr } = await supabase.storage
            .from('reports')
            .createSignedUrl(filePath.trim(), 3600);
        if (signErr) throw new Error('Falha ao gerar link de download: ' + signErr.message);

        return res.json({ success: true, path: filePath, url: signed.signedUrl });
    } catch (err) {
        console.error('[RELATORIO-PERIODO-M3] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/usuarios/operador', requireAuth, async (req, res) => {
    try {
        const callerRole = req.user?.app_metadata?.role
                        || req.user?.user_metadata?.role;
        if (callerRole !== 'admin')
            return res.status(403).json({ error: 'Apenas administradores podem criar operadores' });

        const { email, nome, organization_id } = req.body;
        if (!email || !nome)
            return res.status(400).json({ error: 'email e nome são obrigatórios' });

        const orgId = organization_id || req.user?.app_metadata?.org_id;

        const { data: newUser, error } = await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
            app_metadata:  { role: 'operador', org_id: orgId, must_change_password: true },
            user_metadata: { full_name: nome, role: 'operador', org_id: orgId },
        });
        if (error) throw error;

        await supabase.from('organization_users').insert({
            organization_id: orgId,
            user_id:         newUser.user.id,
            role:            'operador',
        });

        return res.json({
            sucesso:  true,
            usuario:  { id: newUser.user.id, email: newUser.user.email, role: 'operador' },
            mensagem: `Operador ${nome} criado. E-mail de convite enviado para ${email}.`,
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GESTÃO DE PLATAFORMA (interno SSYS) — organizações e seus módulos.
// Autorização no middleware (requirePlatformAdmin), não no banco: os
// endpoints usam a service role e enxergam TODAS as organizações.
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/plataforma/organizacoes', requireAuth, requireSuporte, async (req, res) => {
    try {
        const { data: orgs, error } = await supabase
            .from('organizations')
            .select('id, nome, slug, modulos, ativo, criado_em')
            .order('criado_em', { ascending: false });
        if (error) throw error;

        const enriquecido = await Promise.all(
            (orgs || []).map(async (org) => {
                const [{ count: numProjetos }, { count: numUsuarios }] =
                    await Promise.all([
                        supabase.from('projects')
                            .select('id', { count: 'exact', head: true })
                            .eq('organization_id', org.id),
                        supabase.from('organization_users')
                            .select('user_id', { count: 'exact', head: true })
                            .eq('organization_id', org.id),
                    ]);
                return { ...org, num_projetos: numProjetos || 0, num_usuarios: numUsuarios || 0 };
            })
        );
        res.json({ organizacoes: enriquecido });
    } catch (e) {
        console.error('[PLATAFORMA] listar organizacoes:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/plataforma/organizacoes', requireAuth, requirePlatformAdmin, async (req, res) => {
    const { nome, slug, modulos, admin_email, admin_senha, admin_nome } = req.body || {};

    if (!nome || !slug) {
        return res.status(400).json({ error: 'nome e slug são obrigatórios.' });
    }
    const MODULOS_VALIDOS = ['modulo_1', 'modulo_2', 'modulo_3'];
    const mods = Array.isArray(modulos) ? modulos.filter(m => MODULOS_VALIDOS.includes(m)) : [];
    if (!mods.length) {
        return res.status(400).json({ error: 'Selecione ao menos um módulo.' });
    }
    if (!admin_email || !admin_senha) {
        return res.status(400).json({ error: 'admin_email e admin_senha são obrigatórios.' });
    }
    if (typeof admin_senha !== 'string' || admin_senha.length < 6) {
        return res.status(400).json({ error: 'Senha do admin precisa ter pelo menos 6 caracteres.' });
    }

    let orgId = null;
    try {
        // 1. Cria a organização
        const { data: org, error: orgErr } = await supabase
            .from('organizations')
            .insert({ nome, slug, modulos: mods, ativo: true })
            .select('id')
            .single();
        if (orgErr) throw orgErr;
        orgId = org.id;

        // 2. Cria o primeiro admin já apontando para a org
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email: admin_email,
            password: admin_senha,
            email_confirm: true,
            user_metadata: { role: 'admin', nome: admin_nome || null, org_id: orgId },
            app_metadata:  { role: 'admin', org_id: orgId, must_change_password: true }
        });
        if (createErr) throw createErr;

        const newUserId = created?.user?.id;
        if (!newUserId) throw new Error('Falha ao obter id do usuário criado.');

        // 3. Vincula o admin à organização
        const { error: linkErr } = await supabase
            .from('organization_users')
            .insert({ organization_id: orgId, user_id: newUserId, role: 'admin' });
        if (linkErr) {
            // Rollback do usuário para não deixar conta órfã sem vínculo
            await supabase.auth.admin.deleteUser(newUserId).catch(() => {});
            throw linkErr;
        }

        await supabase.from('audit_log').insert({
            tabela: 'organizations',
            registro_id: orgId,
            campo: 'criacao',
            valor_anterior: null,
            valor_novo: JSON.stringify({ nome, slug, modulos: mods, admin_email }),
            alterado_por: req.user.id,
            origem: 'plataforma_ui'
        });

        res.json({ ok: true, organizacao: { id: orgId, nome, slug, modulos: mods }, admin: { id: newUserId, email: admin_email } });
    } catch (e) {
        // Rollback: não deixar organização órfã sem nenhum usuário vinculado
        if (orgId) {
            await supabase.from('organizations').delete().eq('id', orgId).catch(() => {});
        }
        console.error('[PLATAFORMA] criar organizacao:', e);
        const msg = e?.message || 'Erro ao criar organização.';
        const status = /already.*registered|duplicate|exists|unique/i.test(msg) ? 409 : 500;
        res.status(status).json({ error: msg });
    }
});

app.patch('/api/plataforma/organizacoes/:id/modulos', requireAuth, requirePlatformAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { modulos } = req.body || {};
        const MODULOS_VALIDOS = ['modulo_1', 'modulo_2', 'modulo_3'];
        const mods = Array.isArray(modulos) ? modulos.filter(m => MODULOS_VALIDOS.includes(m)) : null;
        if (!mods) {
            return res.status(400).json({ error: 'modulos deve ser um array.' });
        }

        const { data: before } = await supabase
            .from('organizations')
            .select('modulos')
            .eq('id', id)
            .maybeSingle();
        if (!before) return res.status(404).json({ error: 'Organização não encontrada.' });

        const { error } = await supabase
            .from('organizations')
            .update({ modulos: mods })
            .eq('id', id);
        if (error) throw error;

        await supabase.from('audit_log').insert({
            tabela: 'organizations',
            registro_id: id,
            campo: 'modulos',
            valor_anterior: JSON.stringify(before.modulos),
            valor_novo: JSON.stringify(mods),
            alterado_por: req.user.id,
            origem: 'plataforma_ui'
        });

        res.json({ ok: true, modulos: mods });
    } catch (e) {
        console.error('[PLATAFORMA] atualizar modulos:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPORTE (interno SSYS) — visão cross-tenant só de leitura, pra diagnóstico.
// requireSuporte (não requirePlatformAdmin): quem só tem is_suporte enxerga
// isto, mas não tem acesso a nenhum endpoint de escrita de /api/plataforma/*.
// Mesma service role de /api/plataforma/* — ignora RLS de propósito.
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/suporte/organizacoes/:id/projetos', requireAuth, requireSuporte, async (req, res) => {
    const { data, error } = await supabase
        .from('projects')
        .select('id, pronac, nome, created_at')
        .eq('organization_id', req.params.id)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ projetos: data || [] });
});

// ── Reprocessamento pelo suporte: regras por tipo de documento ──────────────
// Cada tipo de documento tem a sua esteira no n8n. Antes desta regra, todo
// reprocessamento ia para o OCR de NF (cultops-ocr), inclusive planilha
// orçamentária, que tem esteira própria (uploadrubricas) e precisa de project_id.
const WEBHOOK_OCR_NF = 'https://automacoes-n8n.infrassys.com/webhook/cultops-ocr';
const WEBHOOK_IMPORTAR_RUBRICAS = 'https://automacoes-n8n.infrassys.com/webhook/uploadrubricas';

// Mesmo intervalo dos crons revisar_ocr_travado/retry_ocr_stuck_documents:
// antes disso o documento ainda pode estar sendo lido pelo n8n.
const MINUTOS_PROCESSAMENTO_EM_ANDAMENTO = 5;

// Documento com despesa já é lançamento financeiro. O trigger
// trg_documents_cria_despesa não duplica (ON CONFLICT document_id), mas
// também não regrava valor/rubrica/fornecedor de uma despesa existente: um OCR
// novo deixaria documento e despesa divergentes. E a partir de
// liberado_rpa_airtop o robô pode enviar a despesa ao SALIC.
const STATUS_BLOQUEADOS_REPROCESSO = {
    liberado_rpa_airtop: 'Já liberado para o robô enviar ao SALIC.',
    enviado_salic: 'Já enviado ao SALIC.',
    concluido: 'Processamento já concluído.'
};

// Devolve { permitido, motivo, esteira } para um documento.
// planilhaMaisRecentePorProjeto: { project_id: document_id } da última planilha
// enviada em cada projeto — só a última pode ser reimportada.
function avaliarReprocesso(doc, { temDespesa, planilhaMaisRecentePorProjeto }) {
    const tipo = doc.tipo_documento || 'nf';

    if (doc.status === 'processing_ocr' && doc.updated_at) {
        const minutos = (Date.now() - new Date(doc.updated_at).getTime()) / 60000;
        if (minutos < MINUTOS_PROCESSAMENTO_EM_ANDAMENTO) {
            return { permitido: false, motivo: 'Em processamento agora. Aguarde alguns minutos.', esteira: null };
        }
    }

    if (tipo === 'planilha_orcamentaria') {
        if (!doc.project_id) {
            return { permitido: false, motivo: 'Planilha sem projeto vinculado.', esteira: null };
        }
        if (planilhaMaisRecentePorProjeto[doc.project_id] !== doc.id) {
            return {
                permitido: false,
                motivo: 'Existe planilha mais recente neste projeto. Reimportar esta voltaria as rubricas para uma versão antiga.',
                esteira: null
            };
        }
        return { permitido: true, motivo: null, esteira: 'importacao_rubricas' };
    }

    if (tipo === 'nf' || tipo === 'comprovante') {
        if (STATUS_BLOQUEADOS_REPROCESSO[doc.status]) {
            return { permitido: false, motivo: STATUS_BLOQUEADOS_REPROCESSO[doc.status], esteira: null };
        }
        if (temDespesa) {
            return { permitido: false, motivo: 'Já gerou despesa: um OCR novo não atualiza a despesa existente e documento e despesa ficariam divergentes.', esteira: null };
        }
        return { permitido: true, motivo: null, esteira: 'ocr_nf' };
    }

    return { permitido: false, motivo: `Tipo "${tipo}" não tem reprocessamento pelo suporte.`, esteira: null };
}

// Dados auxiliares de avaliarReprocesso para um conjunto de documentos.
async function contextoReprocesso(documentos) {
    const ids = documentos.map(d => d.id);
    const projetos = [...new Set(documentos.filter(d => d.tipo_documento === 'planilha_orcamentaria').map(d => d.project_id).filter(Boolean))];

    const docsComDespesa = new Set();
    // Lotes de 150 ids: mesmo limite de URL do Postgrest tratado no audit-log.
    for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase
            .from('despesas')
            .select('document_id')
            .in('document_id', ids.slice(i, i + 150));
        if (error) throw error;
        (data || []).forEach(r => docsComDespesa.add(r.document_id));
    }

    const planilhaMaisRecentePorProjeto = {};
    if (projetos.length) {
        const { data, error } = await supabase
            .from('documents')
            .select('id, project_id, created_at')
            .eq('tipo_documento', 'planilha_orcamentaria')
            .in('project_id', projetos)
            .order('created_at', { ascending: false });
        if (error) throw error;
        (data || []).forEach(p => {
            if (!planilhaMaisRecentePorProjeto[p.project_id]) planilhaMaisRecentePorProjeto[p.project_id] = p.id;
        });
    }

    return { docsComDespesa, planilhaMaisRecentePorProjeto };
}

// Documentos de um projeto — todos, com status, motivo de erro e se o suporte
// pode reprocessar (e por quê não, quando não pode). Sem o teto de 200: o
// maior projeto em produção já tem 136 documentos e a paginação é na tela.
app.get('/api/suporte/projetos/:id/documentos', requireAuth, requireSuporte, async (req, res) => {
    try {
        const documentos = [];
        const PAGINA = 1000;
        for (let de = 0; ; de += PAGINA) {
            const { data, error } = await supabase
                .from('documents')
                .select('id, project_id, name, status, valor, tipo_documento, cnpj_emissor, nome_emissor, created_at, updated_at, just_erro')
                .eq('project_id', req.params.id)
                .order('created_at', { ascending: false })
                .range(de, de + PAGINA - 1);
            if (error) throw error;
            documentos.push(...(data || []));
            if (!data || data.length < PAGINA) break;
        }

        const ctx = await contextoReprocesso(documentos);
        res.json({
            documentos: documentos.map(d => {
                const r = avaliarReprocesso(d, { temDespesa: ctx.docsComDespesa.has(d.id), planilhaMaisRecentePorProjeto: ctx.planilhaMaisRecentePorProjeto });
                return { ...d, tem_despesa: ctx.docsComDespesa.has(d.id), reprocesso: r };
            })
        });
    } catch (err) {
        console.error('[SUPORTE] documentos:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Usuários de uma organização (mesma lógica de /api/gestor/usuarios, mas
// parametrizada por :id em vez de usar o org_id de quem chama).
app.get('/api/suporte/organizacoes/:id/usuarios', requireAuth, requireSuporte, async (req, res) => {
    const { data: orgUsers, error } = await supabase
        .from('organization_users')
        .select('user_id, role, created_at')
        .eq('organization_id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    const users = await Promise.all((orgUsers || []).map(async (ou) => {
        const { data } = await supabase.auth.admin.getUserById(ou.user_id);
        return {
            id: ou.user_id,
            email: data?.user?.email || null,
            role: data?.user?.app_metadata?.role || null,
            created_at: ou.created_at
        };
    }));
    res.json({ users });
});

// SPEC-SUPORTE-02 (1) — mesma lógica de rótulo/usuário que exportarAuditoria
// (modulo2/exportacoes.html) já usa pro PDF, rodando no servidor via
// service_role: suporte não tem org_id e não pode depender de RLS.
app.get('/api/suporte/projetos/:id/audit-log', requireAuth, requireSuporte, async (req, res) => {
    const projectId = req.params.id;
    try {
        const { data: projeto, error: projErr } = await supabase
            .from('projects')
            .select('id, organization_id')
            .eq('id', projectId)
            .single();
        if (projErr || !projeto) return res.status(404).json({ error: 'Projeto não encontrado.' });

        // Projetos legados podem ter organization_id nulo (confirmado em
        // produção) — .eq('organization_id', null) o Postgrest rejeita com
        // 400, então busca usuários só quando há organização de fato.
        const [documentosRes, contratosRes, evidenciasRes, guiasRes, despesasRes, extratosRes, orgUsersRes] = await Promise.all([
            supabase.from('documents').select('id, name, tipo_documento').eq('project_id', projectId),
            supabase.from('contracts').select('id, numero, objeto').eq('project_id', projectId),
            supabase.from('physical_evidences').select('id, tipo_evidencia, file_name').eq('project_id', projectId),
            supabase.from('tax_guides').select('id, tipo_imposto, competencia, motivo_cancelamento').eq('project_id', projectId),
            supabase.from('despesas').select('id, document_id, fornecedor_nome').eq('project_id', projectId),
            supabase.from('extratos').select('id, periodo_inicio, periodo_fim').eq('project_id', projectId),
            projeto.organization_id
                ? supabase.from('organization_users').select('user_id').eq('organization_id', projeto.organization_id)
                : Promise.resolve({ data: [] })
        ]);

        const documentos = documentosRes.data || [];
        const contratos = contratosRes.data || [];
        const evidencias = evidenciasRes.data || [];
        const guias = guiasRes.data || [];
        const despesas = despesasRes.data || [];
        const extratos = extratosRes.data || [];
        const orgUsers = orgUsersRes.data || [];

        const mapUsuarios = {};
        await Promise.all(orgUsers.map(async (ou) => {
            const { data } = await supabase.auth.admin.getUserById(ou.user_id);
            if (data?.user?.email) mapUsuarios[ou.user_id] = data.user.email;
        }));

        const truncar = (s, n) => {
            const str = String(s == null ? '—' : s);
            return str.length > n ? str.slice(0, n - 1) + '…' : str;
        };

        const mapRotulos = {};
        const mapMotivos = {};
        documentos.forEach(d => { mapRotulos[d.id] = `${d.tipo_documento || 'Documento'} — ${d.name}`; });
        contratos.forEach(c => { mapRotulos[c.id] = `Contrato ${c.numero} — ${truncar(c.objeto, 60)}`; });
        evidencias.forEach(e => { mapRotulos[e.id] = `${e.tipo_evidencia} — ${e.file_name}`; });
        guias.forEach(g => {
            mapRotulos[g.id] = `Guia ${g.tipo_imposto} — competência ${g.competencia}`;
            if (g.motivo_cancelamento) mapMotivos[g.id] = g.motivo_cancelamento;
        });
        extratos.forEach(x => {
            const periodo = (x.periodo_inicio || x.periodo_fim)
                ? `${x.periodo_inicio || '?'} a ${x.periodo_fim || '?'}`
                : 'período não informado';
            mapRotulos[x.id] = `Extrato bancário — ${periodo}`;
        });
        despesas.forEach(d => {
            let label = 'Despesa (lançamento financeiro)';
            if (d.document_id && mapRotulos[d.document_id]) label = `Despesa — ${mapRotulos[d.document_id]}`;
            else if (d.fornecedor_nome) label = `Despesa — ${d.fornecedor_nome}`;
            mapRotulos[d.id] = label;
        });

        const todosIds = [
            ...documentos.map(d => d.id), ...contratos.map(c => c.id),
            ...evidencias.map(e => e.id), ...guias.map(g => g.id),
            ...despesas.map(d => d.id), ...extratos.map(x => x.id)
        ];

        // .in() com centenas de UUIDs estoura o limite de tamanho de URL que o
        // Postgrest aceita (confirmado: projeto da Animus soma 662 ids entre as
        // 6 tabelas e o Postgrest rejeita com 400 "Bad Request"). Em lotes de
        // 150 (~5,5 KB de ids por request) fica bem abaixo de qualquer limite.
        let auditLog = [];
        if (todosIds.length > 0) {
            const TAMANHO_LOTE = 150;
            const lotes = [];
            for (let i = 0; i < todosIds.length; i += TAMANHO_LOTE) {
                lotes.push(todosIds.slice(i, i + TAMANHO_LOTE));
            }

            const resultadosLotes = await Promise.all(lotes.map(lote =>
                supabase
                    .from('audit_log')
                    .select('tabela, registro_id, campo, valor_anterior, valor_novo, alterado_por, origem, created_at')
                    .in('registro_id', lote)
                    .order('created_at', { ascending: false })
                    .limit(500)
            ));
            const erroLote = resultadosLotes.find(r => r.error);
            if (erroLote) throw erroLote.error;

            auditLog = resultadosLotes
                .flatMap(r => r.data || [])
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 500);
        }

        res.json({ auditLog, mapRotulos, mapUsuarios, mapMotivos });
    } catch (err) {
        console.error('[SUPORTE] audit-log:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// SPEC-SUPORTE-02 (2) — mesmo padrão dos endpoints de suporte já existentes.
app.get('/api/suporte/projetos/:id/contratos', requireAuth, requireSuporte, async (req, res) => {
    const { data, error } = await supabase
        .from('contracts')
        .select('id, numero, objeto, valor_total, status, data_inicio, data_fim')
        .eq('project_id', req.params.id)
        // contracts usa criado_em, não created_at (confirmado contra o schema
        // real — o nome dado na spec original não existe nesta tabela).
        .order('criado_em', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ contratos: data || [] });
});

app.get('/api/suporte/projetos/:id/guias', requireAuth, requireSuporte, async (req, res) => {
    const { data, error } = await supabase
        .from('tax_guides')
        .select('id, tipo_imposto, competencia, valor, status, data_vencimento, data_pagamento')
        .eq('project_id', req.params.id)
        .order('data_vencimento', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ guias: data || [] });
});

// SPEC-SUPORTE-02 (3) + SPEC-SUPORTE-03 (3.13) — busca global. organization_id
// costuma ser não-nulo, mas o .filter(Boolean) evita passar null pro .in() se
// algum registro legado não tiver. Acrescenta documentos (nome do arquivo,
// número da NF, id) e usuários (e-mail).
app.get('/api/suporte/buscar', requireAuth, requireSuporte, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 3) return res.json({ resultados: [] });

    const soDigitos = q.replace(/\D/g, '');
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const colsDoc = 'id, name, numero_nf, status, tipo_documento, project_id, organization_id';

    try {
        // .not('organization_id', 'is', null): existem projetos legados órfãos
        // em produção (organization_id nulo) — sem esse filtro, um resultado
        // clicável levaria pra uma organização inexistente e quebraria a
        // navegação (mesmo problema resolvido no endpoint de audit-log).
        const [projetosPorNome, projetosPorPronac, fornecedoresPorCnpj, fornecedoresPorNome, docsPorNome, docsPorNf, docsPorId, usuarios] = await Promise.all([
            supabase.from('projects').select('id, pronac, nome, organization_id').not('organization_id', 'is', null).ilike('nome', `%${q}%`).limit(10),
            soDigitos ? supabase.from('projects').select('id, pronac, nome, organization_id').not('organization_id', 'is', null).ilike('pronac', `%${soDigitos}%`).limit(10) : Promise.resolve({ data: [] }),
            soDigitos.length >= 11 ? supabase.from('fornecedores').select('id, cnpj, razao_social, organization_id').not('organization_id', 'is', null).eq('cnpj', soDigitos).limit(10) : Promise.resolve({ data: [] }),
            supabase.from('fornecedores').select('id, cnpj, razao_social, organization_id').not('organization_id', 'is', null).ilike('razao_social', `%${q}%`).limit(10),
            supabase.from('documents').select(colsDoc).ilike('name', `%${q}%`).limit(15),
            supabase.from('documents').select(colsDoc).ilike('numero_nf', `%${q}%`).limit(15),
            ehUuid ? supabase.from('documents').select(colsDoc).eq('id', q).limit(1) : Promise.resolve({ data: [] }),
            buscarUsuariosPorEmail(q)
        ]);

        const documentos = [];
        const vistosDoc = new Set();
        for (const d of [...(docsPorId.data || []), ...(docsPorNome.data || []), ...(docsPorNf.data || [])]) {
            if (vistosDoc.has(d.id)) continue;
            vistosDoc.add(d.id);
            documentos.push(d);
        }

        // Resolver organization_id -> nome da organização pra cada resultado,
        // buscando as organizações envolvidas de uma vez (evitar N+1).
        const projDocs = await mapaProjetos(documentos.map(d => d.project_id));
        const orgIds = [...new Set([
            ...(projetosPorNome.data || []), ...(projetosPorPronac.data || []),
            ...(fornecedoresPorCnpj.data || []), ...(fornecedoresPorNome.data || []),
            ...documentos.map(d => d.organization_id || projDocs[d.project_id]?.organization_id),
            ...usuarios.map(u => u.organization_id)
        ].map(r => (r && typeof r === 'object') ? r.organization_id : r).filter(Boolean))];
        const nomeOrg = await mapaOrganizacoes(orgIds);

        res.json({
            projetos: [...(projetosPorNome.data || []), ...(projetosPorPronac.data || [])].map(p => ({ ...p, organizacao: nomeOrg[p.organization_id] })),
            fornecedores: [...(fornecedoresPorCnpj.data || []), ...(fornecedoresPorNome.data || [])].map(f => ({ ...f, organizacao: nomeOrg[f.organization_id] })),
            documentos: documentos.map(d => {
                const orgId = d.organization_id || projDocs[d.project_id]?.organization_id || null;
                const p = projDocs[d.project_id];
                return { ...d, organization_id: orgId, organizacao: nomeOrg[orgId] || null, projeto: p ? { id: p.id, pronac: p.pronac, nome: p.nome } : null };
            }),
            usuarios: usuarios.map(u => ({ ...u, organizacao: nomeOrg[u.organization_id] || null }))
        });
    } catch (err) {
        console.error('[SUPORTE] buscar:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Usuários cujo e-mail contém o texto. O Auth não tem filtro por e-mail:
// varre até 5 páginas de 1000 contas.
async function buscarUsuariosPorEmail(q) {
    if (!q.includes('@') && q.length < 4) return [];
    const alvo = q.toLowerCase();
    const achados = [];
    for (let pagina = 1; pagina <= 5 && achados.length < 10; pagina++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 1000 });
        if (error || !data?.users?.length) break;
        for (const u of data.users) {
            if ((u.email || '').toLowerCase().includes(alvo)) achados.push({ id: u.id, email: u.email, role: u.app_metadata?.role || null });
            if (achados.length >= 10) break;
        }
        if (data.users.length < 1000) break;
    }
    if (!achados.length) return [];
    const { data: vinculos } = await supabase.from('organization_users').select('user_id, organization_id').in('user_id', achados.map(a => a.id));
    const orgDe = Object.fromEntries((vinculos || []).map(v => [v.user_id, v.organization_id]));
    return achados.map(a => ({ ...a, organization_id: orgDe[a.id] || null }));
}

// SPEC-SUPORTE-02 (4) — status dos crons/RPA. cron.job_run_details vive fora
// do schema public; suporte_status_crons() é a ponte (SQL aplicado à parte,
// não por este servidor — ver migration_suporte_status_crons.sql).
app.get('/api/suporte/sistema/crons', requireAuth, requireSuporte, async (req, res) => {
    const { data, error } = await supabase.rpc('suporte_status_crons');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ crons: data || [] });
});

// SPEC-SUPORTE-02 (5) — ESCRITA, exceção à regra de "suporte é só leitura".
// Só é aceitável porque grava em audit_log quem fez, quando, em qual conta —
// isso é o que torna a exceção aceitável. Mesmo padrão de
// criar-analista/criar-acesso-fornecedor: senha temporária + must_change_password.
app.post('/api/suporte/usuarios/:id/resetar-senha', requireAuth, requireSuporte, exigirMotivo, async (req, res) => {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Senha precisa ter pelo menos 6 caracteres.' });
    }

    const userId = req.params.id;

    try {
        const { data: userData, error: getErr } = await supabase.auth.admin.getUserById(userId);
        if (getErr || !userData?.user) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
            password,
            app_metadata: { ...userData.user.app_metadata, must_change_password: true }
        });
        if (updateErr) throw updateErr;

        // Obrigatório — é isso que torna essa exceção de escrita aceitável.
        await auditar(req, {
            tabela: 'auth.users',
            registro_id: userId,
            campo: 'senha_resetada_por_suporte',
            valor_anterior: null,
            valor_novo: userData.user.email
        });

        res.json({ ok: true, email: userData.user.email });
    } catch (err) {
        console.error('[SUPORTE] resetar-senha:', err);
        res.status(500).json({ error: err.message });
    }
});

// Payload do OCR de NF igual ao que o front envia em cada caminho de upload:
// fornecedor (app.js, upload do fornecedor) manda fornecedor: true; comprovante
// (handleVincularDocumento) manda tipo_vinculo e o lastro da NF mãe.
async function payloadOcrNf(doc) {
    const payload = {
        document_id: doc.id,
        file_path: doc.file_path,
        user_id: doc.user_id,
        bucket: 'documentos'
    };
    if (doc.fornecedor_id) payload.fornecedor = true;
    if (doc.tipo_documento === 'comprovante' && doc.nf_vinculada_id) {
        const { data: nf } = await supabase
            .from('documents')
            .select('id, name, valor, cnpj_emissor')
            .eq('id', doc.nf_vinculada_id)
            .maybeSingle();
        payload.tipo_vinculo = 'comprovante';
        payload.lastro = {
            id: doc.nf_vinculada_id,
            nome: nf?.name || '',
            valor: nf?.valor || 0,
            cnpj: nf?.cnpj_emissor || ''
        };
    }
    return payload;
}

// SPEC-SUPORTE-02 (6) — ESCRITA, mesma exceção auditada do item 5, sem o
// limite de 3 tentativas do cron: disparo manual é decisão de uma pessoa.
// Cada tipo vai para a sua esteira (avaliarReprocesso):
//   nf / comprovante       -> cultops-ocr (assíncrono; o n8n grava o resultado)
//   planilha_orcamentaria  -> uploadrubricas (síncrono; responde {success,...})
// Reimportar planilha gera nova versão de rubricas e pode desativar rubricas
// que saíram dela — por isso só a planilha mais recente do projeto é aceita.
app.post('/api/suporte/documentos/:id/reprocessar-ocr', requireAuth, requireSuporte, motivoOpcional, async (req, res) => {
    const documentId = req.params.id;

    try {
        const { data: doc, error: getErr } = await supabase
            .from('documents')
            .select('id, project_id, file_path, user_id, status, updated_at, tipo_documento, fornecedor_id, nf_vinculada_id')
            .eq('id', documentId)
            .single();
        if (getErr || !doc) return res.status(404).json({ error: 'Documento não encontrado.' });

        const ctx = await contextoReprocesso([doc]);
        const avaliacao = avaliarReprocesso(doc, {
            temDespesa: ctx.docsComDespesa.has(doc.id),
            planilhaMaisRecentePorProjeto: ctx.planilhaMaisRecentePorProjeto
        });
        if (!avaliacao.permitido) return res.status(409).json({ error: avaliacao.motivo });

        const registrarAuditoria = (valorNovo) => auditar(req, {
            tabela: 'documents',
            registro_id: documentId,
            campo: 'ocr_reprocessado_por_suporte',
            valor_anterior: doc.status,
            valor_novo: valorNovo
        });
        const ctxEv = { entidade: 'documents', registro_id: documentId, usuario_id: req.user.id, motivo: req.motivo };

        await supabase.from('documents').update({
            status: 'processing_ocr',
            ocr_retry_count: 0,
            just_erro: null
        }).eq('id', documentId);

        if (avaliacao.esteira === 'importacao_rubricas') {
            const r = await chamarExterno({ ...ctxEv, acao: 'reimportar_planilha' }, {
                url: WEBHOOK_IMPORTAR_RUBRICAS,
                destino: 'n8n:uploadrubricas',
                timeoutMs: 5 * 60 * 1000,
                body: {
                    document_id: doc.id,
                    project_id: doc.project_id,
                    user_id: doc.user_id,
                    file_path: doc.file_path,
                    bucket: 'documentos'
                }
            });

            let resultado = null;
            try {
                const raw = JSON.parse(r.corpo);
                resultado = Array.isArray(raw) ? raw[0] : raw;
            } catch (_) { /* corpo vazio ou não JSON */ }
            if (!resultado || typeof resultado !== 'object' || !('success' in resultado)) {
                console.error('[SUPORTE] reimportar planilha: resposta sem corpo utilizável. HTTP', r.status, (r.corpo || '').slice(0, 300), r.erro || '');
                resultado = {
                    success: false,
                    message: r.status == null
                        ? 'Sem resposta da importação de rubricas (n8n).'
                        : 'A importação não devolveu resultado. Verifique a execução no n8n.'
                };
            }

            const ok = resultado.success === true;
            const mensagem = resultado.message || resultado.mensagem
                || (ok ? `${resultado.rubricas_importadas ?? ''} rubricas importadas.`.trim() : 'Falha na importação.');
            await supabase.from('documents').update({
                status: ok ? 'concluido' : 'erro',
                just_erro: ok ? null : mensagem
            }).eq('id', documentId);
            await registrarAuditoria(ok ? 'concluido' : 'erro');

            if (!ok) return res.status(502).json({ error: mensagem });
            return res.json({ ok: true, esteira: avaliacao.esteira, mensagem, desativadas: Number(resultado.desativadas) || 0 });
        }

        // esteira ocr_nf
        const r = await chamarExterno({ ...ctxEv, acao: 'reprocessar_ocr' }, {
            url: WEBHOOK_OCR_NF,
            destino: 'n8n:cultops-ocr',
            body: await payloadOcrNf(doc)
        });
        if (!r.ok) {
            console.error('[SUPORTE] reprocessar-ocr: n8n respondeu', r.status, r.erro || '');
            // Devolve o status anterior: o documento não entrou na esteira.
            await supabase.from('documents').update({ status: doc.status }).eq('id', documentId);
            return res.status(502).json({ error: 'Não foi possível reenviar o documento para o OCR agora. Tente novamente em instantes.' });
        }

        // Obrigatório — mesma regra do item 5.
        await registrarAuditoria('processing_ocr');

        res.json({ ok: true, esteira: avaliacao.esteira, mensagem: 'Documento reenviado para o OCR.' });
    } catch (err) {
        console.error('[SUPORTE] reprocessar-ocr:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC-SUPORTE-03 — Painel de suporte: fila, ficha do documento e ações.
// Decisões: a única ação que muda o estado de negócio de um documento do
// cliente é AVANÇAR DOCUMENTO; o suporte nunca dispara envio ao SALIC; toda
// ação exige motivo (>= 10 caracteres) e fica em audit_log com o motivo.
// Rotas só de leitura ficam sem motivo. Tudo usa a service role.
// ─────────────────────────────────────────────────────────────────────────────

const WEBHOOK_VALIDACAO = 'https://automacoes-n8n.infrassys.com/webhook/cultopsvalidation';
const WEBHOOK_CONCILIACAO = 'https://automacoes-n8n.infrassys.com/webhook/prestai-conciliation';
const WEBHOOK_CONCILIACAO_LOTE = 'https://automacoes-n8n.infrassys.com/webhook/prestai-conciliation-lote';

// Aplicado a TODO POST de /api/suporte/*. 400 se o motivo tiver menos de 10
// caracteres; o texto limpo fica em req.motivo.
function exigirMotivo(req, res, next) {
    const v = Regras.validarMotivo(req.body && req.body.motivo);
    if (!v.ok) {
        return res.status(400).json({
            error: `Informe o motivo da ação (mínimo de ${Regras.MOTIVO_MINIMO} caracteres; pode ser o número da ocorrência).`
        });
    }
    req.motivo = v.motivo;
    next();
}

// Reprocessamentos (OCR, planilha, extrato) não exigem explicação: o motivo
// é aceito se vier, e fica na auditoria; sem ele a ação segue e a auditoria
// registra quem fez e quando.
function motivoOpcional(req, res, next) {
    const m = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    req.motivo = m || null;
    next();
}

// Uma linha por chamada externa feita pelas ações do suporte. Nunca derruba a
// ação: se a tabela ainda não existe (migration pendente), só registra no log.
async function registrarEvento(ev) {
    try {
        const { error } = await supabase.from('processamento_eventos').insert({
            origem: 'suporte_ui',
            ...ev,
            detalhe: ev.detalhe ? String(ev.detalhe).slice(0, 1000) : null
        });
        if (error) console.warn('[SUPORTE] registrarEvento:', error.message);
    } catch (e) {
        console.warn('[SUPORTE] registrarEvento:', e.message);
    }
}

// POST JSON para o n8n com medição de tempo e registro do evento.
// ctx: { entidade, registro_id, acao, usuario_id, motivo }.
async function chamarExterno(ctx, { url, destino, body, timeoutMs = 30000 }) {
    const t0 = Date.now();
    let status = null, ok = false, detalhe = null, corpo = '';
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs)
        });
        status = resp.status;
        ok = resp.ok;
        corpo = await resp.text().catch(() => '');
        if (!ok) detalhe = corpo.slice(0, 300);
    } catch (e) {
        detalhe = e.message;
    }
    await registrarEvento({
        entidade: ctx.entidade, registro_id: ctx.registro_id, acao: ctx.acao, destino,
        usuario_id: ctx.usuario_id, motivo: ctx.motivo,
        ok, http_status: status, duracao_ms: Date.now() - t0, detalhe
    });
    return { ok, status, corpo, erro: detalhe };
}

// audit_log com origem suporte_ui, quem fez e o motivo. Se a coluna motivo
// ainda não existe (migration não aplicada), o motivo vai junto de valor_novo
// para nunca se perder.
async function auditar(req, a) {
    const linha = {
        tabela: a.tabela,
        registro_id: a.registro_id,
        campo: a.campo,
        valor_anterior: a.valor_anterior ?? null,
        valor_novo: a.valor_novo ?? null,
        alterado_por: req.user.id,
        origem: 'suporte_ui'
    };
    // Sem motivo a chave nem é enviada (a coluna pode ainda não existir).
    if (req.motivo) linha.motivo = req.motivo;
    let { error } = await supabase.from('audit_log').insert(linha);
    if (error && req.motivo && /motivo/i.test(error.message || '')) {
        const { motivo, ...resto } = linha;
        resto.valor_novo = `${resto.valor_novo ?? ''} [motivo: ${motivo}]`;
        ({ error } = await supabase.from('audit_log').insert(resto));
    }
    if (error) console.error('[SUPORTE] auditar:', error.message);
    return !error;
}

function dataBr() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Lê todas as páginas de uma consulta (Postgrest corta em 1000 linhas).
async function lerTudo(fabrica, pagina = 1000) {
    const out = [];
    for (let de = 0; ; de += pagina) {
        const { data, error } = await fabrica(de, de + pagina - 1);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < pagina) break;
    }
    return out;
}

function emLotes(lista, tamanho = 150) {
    const lotes = [];
    for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
    return lotes;
}

async function mapaProjetos(ids) {
    const unicos = [...new Set(ids.filter(Boolean))];
    const mapa = {};
    for (const lote of emLotes(unicos)) {
        const { data } = await supabase.from('projects').select('id, pronac, nome, organization_id').in('id', lote);
        (data || []).forEach(p => { mapa[p.id] = p; });
    }
    return mapa;
}

async function mapaOrganizacoes(ids) {
    const unicos = [...new Set(ids.filter(Boolean))];
    const mapa = {};
    for (const lote of emLotes(unicos)) {
        const { data } = await supabase.from('organizations').select('id, nome').in('id', lote);
        (data || []).forEach(o => { mapa[o.id] = o.nome; });
    }
    return mapa;
}

async function mapaEmails(ids) {
    const unicos = [...new Set(ids.filter(Boolean))];
    const mapa = {};
    await Promise.all(unicos.map(async (id) => {
        try {
            const { data } = await supabase.auth.admin.getUserById(id);
            if (data?.user?.email) mapa[id] = data.user.email;
        } catch (_) { /* usuário apagado */ }
    }));
    return mapa;
}

// Extrato processado mais recente do projeto (usado em "Refazer conciliação").
async function extratoProcessadoDoProjeto(projectId) {
    const { data } = await supabase
        .from('extratos')
        .select('id, file_path, periodo_inicio, periodo_fim')
        .eq('project_id', projectId)
        .eq('status', 'processado')
        .order('periodo_fim', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    return data || null;
}

// Nota e comprovante para o payload do webhook de conciliação, igual ao que o
// app manda: NF em nf_id e o comprovante filho em comprovante_id.
async function parNfComprovante(doc) {
    if (doc.tipo_documento === 'comprovante') {
        return { nf_id: doc.nf_vinculada_id || doc.id, comprovante_id: doc.id };
    }
    const { data: filho } = await supabase
        .from('documents')
        .select('id')
        .eq('nf_vinculada_id', doc.id)
        .eq('tipo_documento', 'comprovante')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    return { nf_id: doc.id, comprovante_id: filho?.id || null };
}

function itemFila(entidade, reg, grupo, extra) {
    const cat = Catalogo.obter(entidade, extra.status) || {};
    return {
        entidade,
        id: reg.id,
        status: extra.status,
        rotulo: cat.rotulo || extra.status,
        grupo,
        desde: extra.desde || null,
        tempo_desconhecido: !!extra.tempo_desconhecido,
        causa: extra.causa || null,
        detalhe_tecnico: extra.detalhe_tecnico || null,
        acao_sugerida: cat.proximo_passo || null,
        nome: extra.nome || null,
        project_id: extra.project_id || null,
        organization_id: extra.organization_id || null
    };
}

// 3.2 — Fila de atenção. A tela usa por projeto (?project_id=); sem o
// parâmetro devolve todas as organizações.
// Limitação: documents não guarda "desde quando está no status"; usa-se
// updated_at, que também muda em qualquer outro UPDATE (ex.: just_erro) e
// portanto pode REINICIAR o relógio de um documento parado.
app.get('/api/suporte/fila', requireAuth, requireSuporte, async (req, res) => {
    try {
        const agora = Date.now();
        const itens = [];
        const filtroProjeto = req.query.project_id || null;
        const doProjeto = (q) => (filtroProjeto ? q.eq('project_id', filtroProjeto) : q);

        const docs = await lerTudo((de, ate) => doProjeto(supabase
            .from('documents')
            .select('id, name, status, tipo_documento, project_id, organization_id, updated_at, just_erro')
            .not('status', 'in', '(enviado_salic,rejeitado_fornecedor,concluido)'))
            .order('updated_at', { ascending: true })
            .range(de, ate));
        for (const d of docs) {
            const grupo = Regras.classificarParaFila('documents', d.status, d.updated_at, agora);
            if (!grupo) continue;
            itens.push(itemFila('documents', d, grupo, {
                status: d.status, desde: d.updated_at, causa: d.just_erro, nome: d.name,
                project_id: d.project_id, organization_id: d.organization_id
            }));
        }

        // select('*'): created_at/updated_at só existem depois da migration.
        const { data: extratos, error: extErr } = await doProjeto(supabase.from('extratos').select('*').in('status', ['pendente', 'erro']));
        if (extErr) throw extErr;
        for (const x of extratos || []) {
            const desde = x.updated_at || x.created_at || null;
            let grupo, desconhecido = false;
            if (x.status === 'erro') grupo = 'erro';
            else if (!desde) { grupo = 'travado'; desconhecido = true; }
            else grupo = Regras.classificarParaFila('extratos', x.status, desde, agora);
            if (!grupo) continue;
            itens.push(itemFila('extratos', x, grupo, {
                status: x.status, desde, tempo_desconhecido: desconhecido,
                nome: (x.file_path || '').split('/').pop(), project_id: x.project_id, organization_id: x.organization_id
            }));
        }

        const { data: exps, error: expErr } = await doProjeto(supabase.from('exportacoes_log').select('id, tipo, status, project_id, organization_id, criado_em').eq('status', 'gerando'));
        if (expErr) throw expErr;
        for (const e of exps || []) {
            const grupo = Regras.classificarParaFila('exportacoes_log', e.status, e.criado_em, agora);
            if (!grupo) continue;
            itens.push(itemFila('exportacoes_log', e, grupo, {
                status: e.status, desde: e.criado_em, nome: `Exportação ${e.tipo}`,
                project_id: e.project_id, organization_id: e.organization_id
            }));
        }

        // Última captura de saldo de cada projeto; só entra se for erro.
        const capturas = await lerTudo((de, ate) => doProjeto(supabase
            .from('saldo_salic_capturas')
            .select('id, project_id, organization_id, status, erro_mensagem, created_at, concluida_em'))
            .order('created_at', { ascending: false })
            .range(de, ate));
        const vistos = new Set();
        for (const c of capturas) {
            if (vistos.has(c.project_id)) continue;
            vistos.add(c.project_id);
            if (c.status !== 'erro') continue;
            const t = Regras.traduzirCausaSalic(c.erro_mensagem);
            itens.push(itemFila('saldo_salic_capturas', c, 'erro', {
                status: c.status, desde: c.concluida_em || c.created_at, causa: t.causa, detalhe_tecnico: t.detalhe_tecnico,
                nome: 'Captura de saldo SALIC', project_id: c.project_id, organization_id: c.organization_id
            }));
        }

        const { data: evs, error: evErr } = await doProjeto(supabase
            .from('physical_evidences')
            .select('id, project_id, organization_id, status_validacao, motivo_reprovacao, tipo_evidencia, file_name, validado_em, criado_em')
            .eq('status_validacao', 'erro_rpa'));
        if (evErr) throw evErr;
        for (const v of evs || []) {
            itens.push(itemFila('physical_evidences', v, 'erro', {
                status: v.status_validacao, desde: v.validado_em || v.criado_em, causa: v.motivo_reprovacao,
                nome: `${v.tipo_evidencia || 'Evidência'} — ${v.file_name || ''}`,
                project_id: v.project_id, organization_id: v.organization_id
            }));
        }

        const { data: imps, error: impErr } = await doProjeto(supabase
            .from('project_salic_imports')
            .select('id, project_id, organization_id, status, erro_mensagem, created_at, updated_at')
            .eq('status', 'erro'));
        if (impErr) throw impErr;
        for (const i of imps || []) {
            const t = Regras.traduzirCausaSalic(i.erro_mensagem);
            itens.push(itemFila('project_salic_imports', i, 'erro', {
                status: i.status, desde: i.updated_at || i.created_at, causa: t.causa, detalhe_tecnico: t.detalhe_tecnico,
                nome: 'Importação do PDF do projeto SALIC', project_id: i.project_id, organization_id: i.organization_id
            }));
        }

        const projetos = await mapaProjetos(itens.map(i => i.project_id));
        const orgIds = itens.map(i => i.organization_id || projetos[i.project_id]?.organization_id);
        const orgs = await mapaOrganizacoes(orgIds);
        for (const it of itens) {
            const p = projetos[it.project_id];
            it.organization_id = it.organization_id || p?.organization_id || null;
            it.organizacao = orgs[it.organization_id] || null;
            it.projeto = p ? { id: p.id, pronac: p.pronac, nome: p.nome } : null;
        }

        const ordem = { erro: 0, travado: 1, esperando_cliente: 2 };
        itens.sort((a, b) => {
            if (ordem[a.grupo] !== ordem[b.grupo]) return ordem[a.grupo] - ordem[b.grupo];
            const ta = a.desde ? new Date(a.desde).getTime() : 0;
            const tb = b.desde ? new Date(b.desde).getTime() : 0;
            return ta - tb;
        });

        const contadores = {
            erro: itens.filter(i => i.grupo === 'erro').length,
            travado: itens.filter(i => i.grupo === 'travado').length,
            esperando_cliente_7d: itens.filter(i => i.grupo === 'esperando_cliente').length,
            integracoes_falha: itens.filter(i => i.entidade !== 'documents' && (i.grupo === 'erro' || i.grupo === 'travado')).length,
            total: itens.length
        };

        res.json({
            itens,
            contadores,
            gerado_em: new Date(agora).toISOString(),
            observacoes: [
                'Documentos: "desde" é updated_at, que também muda em outras atualizações e pode reiniciar o relógio.',
                'Extratos antigos não têm data (tempo desconhecido) e aparecem como travados.',
                'Integrações com falha: extratos, exportações, captura de saldo, evidências e importação de projeto SALIC em erro ou travados.'
            ]
        });
    } catch (err) {
        console.error('[SUPORTE] fila:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.3 — Ficha do documento.
app.get('/api/suporte/documentos/:id', requireAuth, requireSuporte, async (req, res) => {
    const id = req.params.id;
    try {
        const { data: doc, error: docErr } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
        if (docErr) throw docErr;
        if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

        const [despesaR, maeR, filhosR, origemR, lancR, fornR, projR, extratoProc] = await Promise.all([
            supabase.from('despesas').select('*').eq('document_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
            doc.nf_vinculada_id
                ? supabase.from('documents').select('id, name, status, tipo_documento, valor, numero_nf').eq('id', doc.nf_vinculada_id).maybeSingle()
                : Promise.resolve({ data: null }),
            supabase.from('documents').select('id, name, status, tipo_documento, valor, created_at').eq('nf_vinculada_id', id).order('created_at', { ascending: true }),
            doc.extrato_origem_id
                ? supabase.from('extratos').select('*').eq('id', doc.extrato_origem_id).maybeSingle()
                : Promise.resolve({ data: null }),
            supabase.from('extratos_lancamentos').select('*').eq('document_id', id).limit(5),
            doc.fornecedor_id
                ? supabase.from('fornecedores').select('id, cnpj, razao_social, nome_fantasia, situacao_cadastral, cnae_codigo, cnae_descricao, existe_no_salic, dados_completos').eq('id', doc.fornecedor_id).maybeSingle()
                : Promise.resolve({ data: null }),
            doc.project_id
                ? supabase.from('projects').select('id, pronac, nome, organization_id').eq('id', doc.project_id).maybeSingle()
                : Promise.resolve({ data: null }),
            doc.project_id ? extratoProcessadoDoProjeto(doc.project_id) : Promise.resolve(null)
        ]);
        const despesa = despesaR.data || null;
        const projeto = projR.data || null;
        const orgNome = projeto?.organization_id ? (await mapaOrganizacoes([projeto.organization_id]))[projeto.organization_id] : null;

        // Linha do tempo: auditoria do documento e da despesa.
        const idsTempo = [id, despesa?.id].filter(Boolean);
        const { data: audits } = await supabase.from('audit_log').select('*').in('registro_id', idsTempo).order('created_at', { ascending: true }).limit(500);
        const emails = await mapaEmails((audits || []).map(a => a.alterado_por));
        const linhaDoTempo = (audits || []).map(a => ({
            quando: a.created_at,
            tabela: a.tabela,
            campo: a.campo,
            de: a.valor_anterior,
            para: a.valor_novo,
            quem: a.alterado_por ? (emails[a.alterado_por] || a.alterado_por) : null,
            origem: a.origem,
            motivo: a.motivo || null
        }));

        // processamento_eventos pode ainda não existir (migration pendente).
        let eventos = [];
        try {
            const { data: ev, error: evErr } = await supabase.from('processamento_eventos').select('*').eq('registro_id', id).order('criado_em', { ascending: true }).limit(200);
            if (!evErr) eventos = ev || [];
        } catch (_) { /* tabela ausente */ }

        let arquivoUrl = null;
        if (doc.file_path) {
            if (/^https?:\/\//i.test(doc.file_path)) arquivoUrl = doc.file_path;
            else {
                const { data: assinada } = await supabase.storage.from('documentos').createSignedUrl(doc.file_path, 600);
                arquivoUrl = assinada?.signedUrl || null;
            }
        }

        // Ações: sempre listadas, com habilitada e motivo do bloqueio.
        const agora = Date.now();
        const ctxRep = await contextoReprocesso([doc]);
        const rep = avaliarReprocesso(doc, { temDespesa: ctxRep.docsComDespesa.has(doc.id), planilhaMaisRecentePorProjeto: ctxRep.planilhaMaisRecentePorProjeto });
        const ehPlanilha = doc.tipo_documento === 'planilha_orcamentaria';
        const acaoOcr = ehPlanilha
            ? { habilitada: false, motivo_bloqueio: 'Planilha orçamentária usa "Reimportar planilha".' }
            : { habilitada: rep.permitido, motivo_bloqueio: rep.permitido ? null : rep.motivo };
        const acaoPlanilha = !ehPlanilha
            ? { habilitada: false, motivo_bloqueio: 'Só vale para planilha orçamentária.' }
            : { habilitada: rep.permitido, motivo_bloqueio: rep.permitido ? null : rep.motivo };
        const avancar = Regras.regraAvancar(doc);
        const conc = Regras.avaliarRefazerConciliacao(doc, { existeExtratoProcessado: !!extratoProc });

        const cat = Catalogo.obter('documents', doc.status);
        const minutos = Catalogo.minutosDesde(doc.updated_at, agora);

        res.json({
            documento: doc,
            situacao: {
                status: doc.status,
                rotulo: cat?.rotulo || doc.status,
                grupo: Catalogo.grupoEfetivo('documents', doc.status, doc.updated_at, agora),
                explicacao: cat?.explicacao || null,
                proximo_passo: cat?.proximo_passo || null,
                minutos_no_status: minutos == null ? null : Math.floor(minutos)
            },
            projeto: projeto ? { ...projeto, organizacao: orgNome } : null,
            despesa,
            nf_mae: maeR.data || null,
            comprovantes_filhos: filhosR.data || [],
            extrato_origem: origemR.data || null,
            lancamentos_conciliados: lancR.data || [],
            fornecedor: fornR.data || null,
            linha_do_tempo: linhaDoTempo,
            eventos_processamento: eventos,
            arquivo_url: arquivoUrl,
            acoes: {
                reprocessar_ocr: acaoOcr,
                reimportar_planilha: acaoPlanilha,
                revalidar_conformidade: Regras.avaliarRevalidar(doc, agora),
                avancar: { habilitada: avancar.habilitada, motivo_bloqueio: avancar.motivo_bloqueio, destino: avancar.destino, efeito: avancar.efeito },
                refazer_conciliacao: {
                    ...conc,
                    extrato_usado: doc.extrato_origem_id ? 'extrato de origem do lote' : (extratoProc ? `extrato ${extratoProc.id} (${extratoProc.periodo_inicio || '?'} a ${extratoProc.periodo_fim || '?'})` : null)
                }
            }
        });
    } catch (err) {
        console.error('[SUPORTE] ficha documento:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.4 — Avançar documento. Mapa permitido em Regras.MAPA_AVANCAR; nada fora dele.
app.post('/api/suporte/documentos/:id/avancar', requireAuth, requireSuporte, exigirMotivo, async (req, res) => {
    const id = req.params.id;
    try {
        const { data: doc, error: getErr } = await supabase
            .from('documents')
            .select('id, status, tipo_documento, cnpj_emissor, extrato_origem_id, project_id')
            .eq('id', id)
            .maybeSingle();
        if (getErr) throw getErr;
        if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

        const regra = Regras.regraAvancar(doc);
        if (!regra.habilitada) return res.status(409).json({ error: regra.motivo_bloqueio });

        const texto = `[OVERRIDE SUPORTE] Suporte avançou manualmente de "${doc.status}" para "${regra.destino}" em ${dataBr()}.`;
        // .eq('status'): só avança se ninguém mexeu no documento entretanto.
        const { data: atualizado, error: updErr } = await supabase
            .from('documents')
            .update({ status: regra.destino, just_erro: texto })
            .eq('id', id)
            .eq('status', doc.status)
            .select('id, status');
        if (updErr) throw updErr;
        if (!atualizado || !atualizado.length) {
            return res.status(409).json({ error: 'O status do documento mudou enquanto você confirmava. Recarregue a ficha.' });
        }
        // Um trigger pode converter o destino (aguardando_comprovante vira
        // aguardando_conciliacao_bancaria): o status real é o devolvido.
        const statusFinal = atualizado[0].status;

        await auditar(req, {
            tabela: 'documents', registro_id: id, campo: 'avanco_forcado_por_suporte',
            valor_anterior: doc.status, valor_novo: statusFinal
        });

        const ctxEv = { entidade: 'documents', registro_id: id, acao: 'avancar', usuario_id: req.user.id, motivo: req.motivo };
        const resposta = { ok: true, status_anterior: doc.status, status_novo: statusFinal };

        if (doc.status === 'revisao_manual') {
            // Mesmo payload de handleForcarAvanco (app.js): sem isto o documento
            // fica "em auditoria" sem ser auditado.
            const r = await chamarExterno(ctxEv, {
                url: WEBHOOK_VALIDACAO, destino: 'n8n:cultopsvalidation',
                body: { document_id: id, cnpj_fornecedor: doc.cnpj_emissor }
            });
            resposta.validacao_disparada = r.ok;
            if (!r.ok) resposta.aviso = 'O documento avançou, mas o n8n não aceitou o disparo da validação. Use "Revalidar conformidade" após 5 min.';
        }

        if (doc.status === 'bloqueado_conformidade' && doc.extrato_origem_id) {
            const t0 = Date.now();
            let r;
            try {
                r = await conciliarNotaAutoLote(id, { actorId: req.user.id });
            } catch (e) {
                r = { http: 500, body: { error: e.message } };
            }
            await registrarEvento({
                ...ctxEv, destino: 'interno:conciliacao-auto-lote', ok: r.http === 200,
                http_status: r.http, duracao_ms: Date.now() - t0, detalhe: JSON.stringify(r.body)
            });
            resposta.conciliacao_auto_lote = r.body;
            if (r.body?.conciliado) resposta.status_novo = 'aguardando_d3';
        }

        res.json(resposta);
    } catch (err) {
        console.error('[SUPORTE] avancar:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.5 — Revalidar conformidade. NÃO muda o status (o app muda para
// processing_ocr, o que colide com os crons de OCR); só refaz o disparo.
app.post('/api/suporte/documentos/:id/revalidar-conformidade', requireAuth, requireSuporte, exigirMotivo, async (req, res) => {
    const id = req.params.id;
    try {
        const { data: doc, error: getErr } = await supabase
            .from('documents')
            .select('id, status, updated_at, cnpj_emissor, rubrica_id_fk, rubrica')
            .eq('id', id)
            .maybeSingle();
        if (getErr) throw getErr;
        if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

        const av = Regras.avaliarRevalidar(doc, Date.now());
        if (!av.habilitada) return res.status(409).json({ error: av.motivo_bloqueio });

        // Payload de handleReprocessarDocumentoTravado (app.js), caso aguardando_conformidade.
        const r = await chamarExterno(
            { entidade: 'documents', registro_id: id, acao: 'revalidar_conformidade', usuario_id: req.user.id, motivo: req.motivo },
            {
                url: WEBHOOK_VALIDACAO, destino: 'n8n:cultopsvalidation',
                body: { document_id: id, cnpj_fornecedor: doc.cnpj_emissor, rubrica_id: doc.rubrica_id_fk, rubrica_nome: doc.rubrica }
            }
        );
        if (!r.ok) {
            return res.status(502).json({ error: 'Não foi possível reenviar o documento para a validação agora. Tente novamente em instantes.' });
        }

        await auditar(req, {
            tabela: 'documents', registro_id: id, campo: 'conformidade_revalidada_por_suporte',
            valor_anterior: doc.status, valor_novo: doc.status
        });
        res.json({ ok: true, status: doc.status });
    } catch (err) {
        console.error('[SUPORTE] revalidar-conformidade:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.6 — Refazer conciliação.
//  - com extrato_origem_id: lógica de /api/conciliacao/auto-lote;
//  - sem: webhook de conciliação com o payload que o app manda ao subir
//    extrato, reaproveitando o extrato processado mais recente do projeto.
app.post('/api/suporte/documentos/:id/refazer-conciliacao', requireAuth, requireSuporte, exigirMotivo, async (req, res) => {
    const id = req.params.id;
    try {
        const { data: doc, error: getErr } = await supabase
            .from('documents')
            .select('id, status, project_id, tipo_documento, nf_vinculada_id, extrato_origem_id')
            .eq('id', id)
            .maybeSingle();
        if (getErr) throw getErr;
        if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

        const extrato = doc.project_id ? await extratoProcessadoDoProjeto(doc.project_id) : null;
        const av = Regras.avaliarRefazerConciliacao(doc, { existeExtratoProcessado: !!extrato });
        if (!av.habilitada) return res.status(409).json({ error: av.motivo_bloqueio });

        const ctxEv = { entidade: 'documents', registro_id: id, acao: 'refazer_conciliacao', usuario_id: req.user.id, motivo: req.motivo };

        if (doc.extrato_origem_id) {
            const t0 = Date.now();
            let r;
            try {
                r = await conciliarNotaAutoLote(id, { actorId: req.user.id });
            } catch (e) {
                r = { http: 500, body: { error: e.message } };
            }
            await registrarEvento({
                ...ctxEv, destino: 'interno:conciliacao-auto-lote', ok: r.http === 200,
                http_status: r.http, duracao_ms: Date.now() - t0, detalhe: JSON.stringify(r.body)
            });
            if (r.http !== 200) return res.status(r.http >= 500 ? 502 : r.http).json({ error: r.body?.error || 'Falha na conciliação.' });
            await auditar(req, {
                tabela: 'documents', registro_id: id, campo: 'conciliacao_refeita_por_suporte',
                valor_anterior: doc.status, valor_novo: r.body.conciliado ? 'conciliado' : `sem conciliação: ${r.body.motivo}`
            });
            return res.json({ ok: true, via: 'auto-lote', ...r.body });
        }

        // Mesmo que o "Substituir Extrato" do app: a nota em divergência volta
        // para aguardando_conciliacao_bancaria antes do disparo.
        const divergente = doc.status !== 'aguardando_conciliacao_bancaria';
        if (divergente) {
            const { data: reset, error: resetErr } = await supabase
                .from('documents')
                .update({ status: 'aguardando_conciliacao_bancaria', just_erro: null })
                .eq('id', id).eq('status', doc.status).select('id');
            if (resetErr) throw resetErr;
            if (!reset || !reset.length) return res.status(409).json({ error: 'O status do documento mudou. Recarregue a ficha.' });
        }

        const par = await parNfComprovante(doc);
        const r = await chamarExterno(ctxEv, {
            url: WEBHOOK_CONCILIACAO, destino: 'n8n:prestai-conciliation',
            body: {
                extrato_id: extrato.id,
                document_id: extrato.id,
                nf_id: par.nf_id,
                comprovante_id: par.comprovante_id,
                file_path: extrato.file_path,
                bucket: 'documentos',
                project_id: doc.project_id
            }
        });
        if (!r.ok) {
            if (divergente) await supabase.from('documents').update({ status: doc.status }).eq('id', id);
            return res.status(502).json({ error: 'Não foi possível reenviar a conciliação ao n8n agora. Tente novamente em instantes.' });
        }

        await auditar(req, {
            tabela: 'documents', registro_id: id, campo: 'conciliacao_refeita_por_suporte',
            valor_anterior: doc.status, valor_novo: divergente ? 'aguardando_conciliacao_bancaria' : doc.status
        });
        res.json({ ok: true, via: 'webhook', extrato_id: extrato.id });
    } catch (err) {
        console.error('[SUPORTE] refazer-conciliacao:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.7 — Extratos do projeto.
app.get('/api/suporte/projetos/:id/extratos', requireAuth, requireSuporte, async (req, res) => {
    try {
        const agora = Date.now();
        const { data: extratos, error } = await supabase
            .from('extratos')
            .select('*')
            .eq('project_id', req.params.id)
            .order('periodo_fim', { ascending: false, nullsFirst: false });
        if (error) throw error;

        const lancs = await lerTudo((de, ate) => supabase
            .from('extratos_lancamentos')
            .select('extrato_id, status_conciliacao')
            .eq('project_id', req.params.id)
            .range(de, ate));
        const total = {}, conciliados = {};
        for (const l of lancs) {
            total[l.extrato_id] = (total[l.extrato_id] || 0) + 1;
            if (l.status_conciliacao === 'conciliado') conciliados[l.extrato_id] = (conciliados[l.extrato_id] || 0) + 1;
        }

        res.json({
            extratos: (extratos || []).map(x => {
                const desde = x.updated_at || x.created_at || null;
                const av = Regras.avaliarReprocessarExtrato(x, agora);
                return {
                    id: x.id,
                    arquivo: (x.file_path || '').split('/').pop(),
                    formato: x.formato,
                    periodo_inicio: x.periodo_inicio,
                    periodo_fim: x.periodo_fim,
                    status: x.status,
                    grupo: x.status === 'pendente' && !desde ? 'travado' : Catalogo.grupoEfetivo('extratos', x.status, desde, agora),
                    desde,
                    tempo_desconhecido: !desde,
                    lancamentos: total[x.id] || 0,
                    conciliados: conciliados[x.id] || 0,
                    reprocessar: { habilitada: av.habilitada, motivo_bloqueio: av.motivo_bloqueio, tempo_desconhecido: av.tempo_desconhecido }
                };
            })
        });
    } catch (err) {
        console.error('[SUPORTE] extratos:', err);
        res.status(500).json({ error: err.message });
    }
});

// Reprocessar extrato: payload do upload em lote (extrato_id, project_id,
// file_path, bucket). O app tem dois webhooks conforme o fluxo de origem, e o
// banco não registra qual foi usado; o de lote é o único que não exige nota.
app.post('/api/suporte/extratos/:id/reprocessar', requireAuth, requireSuporte, motivoOpcional, async (req, res) => {
    const id = req.params.id;
    try {
        const { data: x, error: getErr } = await supabase.from('extratos').select('*').eq('id', id).maybeSingle();
        if (getErr) throw getErr;
        if (!x) return res.status(404).json({ error: 'Extrato não encontrado.' });

        const av = Regras.avaliarReprocessarExtrato(x, Date.now());
        if (!av.habilitada) return res.status(409).json({ error: av.motivo_bloqueio });

        const r = await chamarExterno(
            { entidade: 'extratos', registro_id: id, acao: 'reprocessar_extrato', usuario_id: req.user.id, motivo: req.motivo },
            {
                url: WEBHOOK_CONCILIACAO_LOTE, destino: 'n8n:prestai-conciliation-lote',
                body: { extrato_id: id, project_id: x.project_id, file_path: x.file_path, bucket: 'documentos' }
            }
        );
        if (!r.ok) return res.status(502).json({ error: 'Não foi possível reenviar o extrato ao n8n agora. Tente novamente em instantes.' });

        // Volta a "pendente" (reinicia o relógio de 30 min); o n8n fecha em processado/erro.
        await supabase.from('extratos').update({ status: 'pendente' }).eq('id', id);
        await auditar(req, {
            tabela: 'extratos', registro_id: id, campo: 'extrato_reprocessado_por_suporte',
            valor_anterior: x.status, valor_novo: 'pendente'
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('[SUPORTE] extrato reprocessar:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.8 — Encerrar exportação travada.
app.post('/api/suporte/exportacoes/:id/encerrar', requireAuth, requireSuporte, exigirMotivo, async (req, res) => {
    const id = req.params.id;
    try {
        const { data: exp, error: getErr } = await supabase.from('exportacoes_log').select('id, status, criado_em, tipo').eq('id', id).maybeSingle();
        if (getErr) throw getErr;
        if (!exp) return res.status(404).json({ error: 'Exportação não encontrada.' });

        const av = Regras.avaliarEncerrarExportacao(exp, Date.now());
        if (!av.habilitada) return res.status(409).json({ error: av.motivo_bloqueio });

        const { data: upd, error: updErr } = await supabase
            .from('exportacoes_log').update({ status: 'erro' }).eq('id', id).eq('status', 'gerando').select('id');
        if (updErr) throw updErr;
        if (!upd || !upd.length) return res.status(409).json({ error: 'A exportação mudou de status. Recarregue.' });

        await auditar(req, {
            tabela: 'exportacoes_log', registro_id: id, campo: 'exportacao_encerrada_por_suporte',
            valor_anterior: 'gerando', valor_novo: 'erro'
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('[SUPORTE] exportacao encerrar:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.9 — Saldo SALIC (leitura). A recaptura NÃO é uma rota: o worker usa a
// credencial SALIC do usuário que aciona (decrypted_external_credentials
// pelo user_id do token) e o suporte não tem uma. A ação aparece bloqueada,
// com o motivo, em "recaptura".
app.get('/api/suporte/projetos/:id/saldo-salic', requireAuth, requireSuporte, async (req, res) => {
    try {
        const agora = Date.now();
        const { data: capturas, error } = await supabase
            .from('saldo_salic_capturas')
            .select('*')
            .eq('project_id', req.params.id)
            .order('created_at', { ascending: false })
            .limit(10);
        if (error) throw error;

        const { count: abertas } = await supabase
            .from('saldo_salic_divergencias')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', req.params.id)
            .eq('status', 'aberta');

        // Última importação do PDF do projeto SALIC (causa traduzida + reimportar).
        const { data: ultimaImp } = await supabase
            .from('project_salic_imports')
            .select('id, status, file_path, erro_mensagem, created_at, updated_at')
            .eq('project_id', req.params.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        let importacao = null;
        if (ultimaImp) {
            const t = Regras.traduzirCausaSalic(ultimaImp.erro_mensagem);
            const av = Regras.avaliarReimportarProjetoSalic(ultimaImp);
            importacao = {
                id: ultimaImp.id,
                status: ultimaImp.status,
                created_at: ultimaImp.created_at,
                updated_at: ultimaImp.updated_at,
                causa: t.causa,
                detalhe_tecnico: t.detalhe_tecnico,
                reimportar: av
            };
        }

        const lista = (capturas || []).map(c => {
            const t = Regras.traduzirCausaSalic(c.erro_mensagem);
            return {
                id: c.id,
                status: c.status,
                grupo: Catalogo.grupoEfetivo('saldo_salic_capturas', c.status, c.iniciada_em || c.created_at, agora),
                iniciada_em: c.iniciada_em || c.created_at,
                concluida_em: c.concluida_em,
                total_linhas: c.total_linhas,
                causa: t.causa,
                detalhe_tecnico: t.detalhe_tecnico
            };
        });
        res.json({
            capturas: lista,
            divergencias_abertas: abertas || 0,
            importacao_projeto: importacao,
            recaptura: Regras.avaliarRecapturaSaldo((capturas || [])[0])
        });
    } catch (err) {
        console.error('[SUPORTE] saldo-salic:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.10 — Reimportar o PDF do projeto SALIC a partir da última importação.
app.post('/api/suporte/projetos/:id/reimportar-projeto-salic', requireAuth, requireSuporte, exigirMotivo, async (req, res) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    const projectId = req.params.id;
    try {
        const { data: ultima, error } = await supabase
            .from('project_salic_imports')
            .select('id, status, file_path, importado_por')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;

        const av = Regras.avaliarReimportarProjetoSalic(ultima);
        if (!av.habilitada) return res.status(409).json({ error: av.motivo_bloqueio });

        const t0 = Date.now();
        const r = await processarPdfSalic({ project_id: projectId, file_path: ultima.file_path, user_id: ultima.importado_por });
        await registrarEvento({
            entidade: 'project_salic_imports', registro_id: ultima.id, acao: 'reimportar_projeto_salic',
            destino: 'interno:processar-pdf-salic', usuario_id: req.user.id, motivo: req.motivo,
            ok: r.http === 200, http_status: r.http, duracao_ms: Date.now() - t0,
            detalhe: r.http === 200 ? null : r.body?.error
        });
        await auditar(req, {
            tabela: 'projects', registro_id: projectId, campo: 'projeto_salic_reimportado_por_suporte',
            valor_anterior: ultima.status, valor_novo: r.http === 200 ? 'processado' : 'erro'
        });
        if (r.http !== 200) {
            const t = Regras.traduzirCausaSalic(r.body?.error);
            return res.status(502).json({ error: t.causa || 'A reimportação falhou.', detalhe_tecnico: t.detalhe_tecnico });
        }
        res.json({ ok: true, import_id: r.body.import_id });
    } catch (err) {
        console.error('[SUPORTE] reimportar-projeto-salic:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.11 — Evidências do projeto (somente leitura).
app.get('/api/suporte/projetos/:id/evidencias', requireAuth, requireSuporte, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('physical_evidences')
            .select('id, tipo_evidencia, file_name, status_validacao, motivo_reprovacao, ia_categoria, ia_score, criado_em, enviada_salic_em')
            .eq('project_id', req.params.id)
            .order('criado_em', { ascending: false });
        if (error) throw error;
        res.json({
            evidencias: (data || []).map(e => ({
                id: e.id,
                tipo: e.tipo_evidencia,
                arquivo: e.file_name,
                status: e.status_validacao,
                motivo: e.motivo_reprovacao,
                ia_categoria: e.ia_categoria,
                ia_score: e.ia_score,
                criado_em: e.criado_em,
                enviada_salic_em: e.enviada_salic_em
            }))
        });
    } catch (err) {
        console.error('[SUPORTE] evidencias:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3.12 — Saúde: crons, worker do SALIC e falhas por destino (24 h).
app.get('/api/suporte/sistema/saude', requireAuth, requireSuporte, async (req, res) => {
    try {
        const [cronsR, worker, eventos] = await Promise.all([
            supabase.rpc('suporte_status_crons'),
            (async () => {
                const url = process.env.RAILWAY_URL;
                if (!url) return { configurado: false, ok: false, detalhe: 'RAILWAY_URL não configurada.' };
                const t0 = Date.now();
                try {
                    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
                    return { configurado: true, ok: resp.ok, http_status: resp.status, duracao_ms: Date.now() - t0 };
                } catch (e) {
                    return { configurado: true, ok: false, duracao_ms: Date.now() - t0, detalhe: e.name === 'TimeoutError' ? 'Sem resposta em 5 s.' : e.message };
                }
            })(),
            (async () => {
                const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
                const { data, error } = await supabase.from('processamento_eventos').select('destino, ok').gte('criado_em', desde).limit(10000);
                if (error) return { disponivel: false, detalhe: error.message, destinos: [] };
                const por = {};
                (data || []).forEach(e => {
                    const d = por[e.destino || '—'] || (por[e.destino || '—'] = { destino: e.destino || '—', total: 0, falhas: 0 });
                    d.total++;
                    if (e.ok === false) d.falhas++;
                });
                return {
                    disponivel: true,
                    destinos: Object.values(por).map(d => ({ ...d, taxa_falha: d.total ? d.falhas / d.total : 0 }))
                };
            })()
        ]);
        res.json({
            crons: cronsR.error ? [] : (cronsR.data || []),
            crons_erro: cronsR.error ? cronsR.error.message : null,
            worker,
            falhas_24h: eventos
        });
    } catch (err) {
        console.error('[SUPORTE] saude:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/conciliacao/auto-lote
// Concilia automaticamente uma nota que veio de um lote COM extrato vinculado
// (documents.extrato_origem_id), dentro do universo fechado daquele extrato:
// uma nota, um extrato conhecido — a única dúvida é QUAL lançamento.
// Casando, a nota pula aguardando_comprovante e aguardando_conciliacao_bancaria
// (o extrato faz as vezes do comprovante) e vai direto para aguardando_d3.
// Falha segura: sem match ou com ambiguidade, a nota segue o fluxo manual.
// ─────────────────────────────────────────────────────────────────────────────
// Lógica da conciliação automática de nota de lote, reutilizada pela rota
// abaixo e pelo painel de suporte. Devolve { http, body } em vez de responder.
// actorId vai para o audit_log; callerOrg nulo (suporte) pula a checagem de org.
async function conciliarNotaAutoLote(document_id, { callerOrg = null, actorId = null } = {}) {
    const { data: nota, error: notaErr } = await supabase
        .from('documents')
        .select('id, status, valor, data_pagamento, autenticacao_bancaria, extrato_origem_id, organization_id')
        .eq('id', document_id)
        .maybeSingle();
    if (notaErr) throw notaErr;
    if (!nota) return { http: 404, body: { error: 'Documento não encontrado.' } };

    // Este endpoint usa service role (ignora RLS) — sem esta checagem, uma
    // conta válida poderia disparar conciliação em documento de outra org.
    // Só bloqueia quando ambos os lados têm org definida (linhas legadas
    // podem ter organization_id nulo e continuam funcionando).
    if (nota.organization_id && callerOrg && nota.organization_id !== callerOrg) {
        return { http: 403, body: { error: 'Documento não pertence à sua organização.' } };
    }

    if (!nota.extrato_origem_id) {
        // Caso normal: nota que não veio de lote com extrato.
        return { http: 200, body: { conciliado: false, motivo: 'nota sem extrato de lote' } };
    }

    // Idempotência real: o filtro document_id IS NULL abaixo impede reusar o
    // MESMO lançamento, mas não impede casar a nota com um SEGUNDO lançamento
    // numa chamada repetida. Esta checagem fecha isso.
    const { data: jaConciliado, error: jaErr } = await supabase
        .from('extratos_lancamentos')
        .select('id')
        .eq('document_id', nota.id)
        .limit(1)
        .maybeSingle();
    if (jaErr) throw jaErr;
    if (jaConciliado) {
        return { http: 200, body: { conciliado: false, motivo: 'nota já conciliada anteriormente' } };
    }

    const { data: lancamentos, error: lancErr } = await supabase
        .from('extratos_lancamentos')
        .select('id, fitid, valor, data_lancamento')
        .eq('extrato_id', nota.extrato_origem_id)
        .eq('status_conciliacao', 'pendente')
        .is('document_id', null);
    if (lancErr) throw lancErr;

    if (!lancamentos || !lancamentos.length) {
        return { http: 200, body: { conciliado: false, motivo: 'extrato sem lançamentos pendentes' } };
    }

    // 1º critério: fitid === autenticacao_bancaria
    let metodo = 'fitid';
    let matches = [];
    if (nota.autenticacao_bancaria) {
        const auth = String(nota.autenticacao_bancaria).trim().toLowerCase();
        matches = lancamentos.filter(l =>
            l.fitid && String(l.fitid).trim().toLowerCase() === auth);
    }

    // 2º critério: valor ±0,01 e data ±3 dias (sem data_pagamento, só valor)
    if (matches.length === 0) {
        metodo = 'valor+data';
        const valorNota = parseFloat(nota.valor || 0);
        matches = lancamentos.filter(l => {
            const v = parseFloat(l.valor || 0);
            // Extrato traz saída de caixa como negativa; a nota é positiva.
            if (Math.abs(Math.abs(v) - Math.abs(valorNota)) > 0.01) return false;
            if (!nota.data_pagamento || !l.data_lancamento) return true;
            // 'T12:00:00' nos dois lados: data pura não passa por new Date()
            // cru (regra do projeto contra o deslocamento de fuso).
            const diff = Math.abs(
                (new Date(l.data_lancamento + 'T12:00:00')
                    - new Date(nota.data_pagamento + 'T12:00:00')) / 86400000);
            return diff <= 3;
        });
    }

    if (matches.length === 0) {
        return { http: 200, body: { conciliado: false, motivo: 'nenhum lançamento compatível' } };
    }
    if (matches.length > 1) {
        // Regra inegociável: ambíguo nunca casa sozinho.
        return { http: 200, body: {
            conciliado: false,
            motivo: 'múltiplos lançamentos compatíveis, revisar manualmente'
        } };
    }

    const lancamento = matches[0];

    // Casa o lançamento só se ele AINDA estiver livre (protege contra duas
    // chamadas simultâneas para notas diferentes disputando o mesmo lançamento).
    const { data: updLanc, error: updLancErr } = await supabase
        .from('extratos_lancamentos')
        .update({ status_conciliacao: 'conciliado', document_id: nota.id })
        .eq('id', lancamento.id)
        .is('document_id', null)
        .select('id');
    if (updLancErr) throw updLancErr;
    if (!updLanc || !updLanc.length) {
        return { http: 200, body: { conciliado: false, motivo: 'lançamento já foi conciliado por outra nota' } };
    }

    const { error: updDocErr } = await supabase
        .from('documents')
        .update({
            status: 'aguardando_d3',
            justification: `Conciliação automática via lote (${metodo})`
        })
        .eq('id', nota.id);
    if (updDocErr) throw updDocErr;

    await supabase.from('audit_log').insert({
        tabela: 'documents',
        registro_id: nota.id,
        campo: 'status',
        valor_anterior: nota.status,
        valor_novo: 'aguardando_d3',
        alterado_por: actorId,
        origem: 'conciliacao_auto_lote'
    });

    return { http: 200, body: { conciliado: true, metodo, lancamento_id: lancamento.id } };
}

app.post('/api/conciliacao/auto-lote', requireAuth, async (req, res) => {
    try {
        const { document_id } = req.body || {};
        if (!document_id) {
            return res.status(400).json({ error: 'document_id é obrigatório.' });
        }
        const r = await conciliarNotaAutoLote(document_id, {
            callerOrg: req.user?.app_metadata?.org_id || null,
            actorId: req.user?.id || null
        });
        return res.status(r.http).json(r.body);
    } catch (e) {
        console.error('[CONCILIACAO-AUTO-LOTE]', e);
        return res.status(500).json({ error: e.message });
    }
});

// ==============================================================
// SALDO SALIC — Fase 0/1 (CR-2026-001)
// Controle preventivo de saldo de rubricas: captura read-only do
// relatório de Execução Física do SALIC + pareamento + conferência.
// ==============================================================

/**
 * Dispara a captura do relatório de Execução Física no worker RPA.
 * O worker é o único lugar que sabe falar com o SALIC (Puppeteer);
 * aqui só repassamos, no mesmo padrão de proxy de /api/salic/inserir.
 * POST /api/saldo-salic/capturar
 * Body: { projectId }
 */
app.post('/api/saldo-salic/capturar', requireAuth, async (req, res) => {
    const { projectId } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId é obrigatório.' });
    if (!(await userCanAccessProject(req.user.id, projectId))) {
        return res.status(403).json({ error: 'Acesso negado ao projeto.' });
    }

    const railwayUrl = process.env.RAILWAY_URL;
    if (!railwayUrl) {
        return res.status(500).json({ error: 'RAILWAY_URL não configurada.' });
    }

    try {
        const response = await fetch(`${railwayUrl}/capturar-execucao`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization || ''
            },
            body: JSON.stringify({ projectId })
        });
        const data = await response.json();
        return res.status(response.status).json(data);
    } catch (err) {
        console.error('[SALDO-SALIC][capturar] Erro ao acionar worker:', err.message);
        return res.status(500).json({ error: 'Falha ao conectar com o worker RPA: ' + err.message });
    }
});

/**
 * Confirma o pareamento manual de uma linha da fila de conferência:
 * grava rubrica_id na linha e memoriza o vínculo em saldo_salic_vinculos
 * (aprende uma vez, não pergunta de novo na próxima captura).
 * POST /api/saldo-salic/confirmar
 * Body: { linhaId, rubricaId }
 */
app.post('/api/saldo-salic/confirmar', requireAuth, async (req, res) => {
    const { linhaId, rubricaId } = req.body || {};
    if (!linhaId || !rubricaId) {
        return res.status(400).json({ error: 'linhaId e rubricaId são obrigatórios.' });
    }

    try {
        const { data: linha, error: linhaErr } = await supabase
            .from('saldo_salic_linhas')
            .select('id, project_id, organization_id, etapa, item, vl_programado')
            .eq('id', linhaId)
            .single();
        if (linhaErr || !linha) return res.status(404).json({ error: 'Linha não encontrada.' });

        if (!(await userCanAccessProject(req.user.id, linha.project_id))) {
            return res.status(403).json({ error: 'Acesso negado ao projeto.' });
        }

        const { error: updErr } = await supabase
            .from('saldo_salic_linhas')
            .update({ rubrica_id: rubricaId, pareamento_status: 'pareada' })
            .eq('id', linhaId);
        if (updErr) throw updErr;

        const { error: vincErr } = await supabase
            .from('saldo_salic_vinculos')
            .upsert({
                project_id: linha.project_id,
                organization_id: linha.organization_id,
                chave_etapa: linha.etapa,
                chave_item: linha.item,
                chave_vl_programado: linha.vl_programado,
                rubrica_id: rubricaId,
                confirmado_por: req.user.id,
                confirmado_em: new Date().toISOString()
            }, { onConflict: 'project_id,chave_etapa,chave_item,chave_vl_programado' });
        if (vincErr) throw vincErr;

        return res.json({ success: true });
    } catch (err) {
        console.error('[SALDO-SALIC][confirmar] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
module.exports.__teste = { avaliarReprocesso, exigirMotivo, motivoOpcional, MINUTOS_PROCESSAMENTO_EM_ANDAMENTO };
