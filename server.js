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

// Rota para servir o config.js dinamicamente ao navegador
app.get('/config.js', (req, res) => {
    const publicConfig = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_KEY: process.env.SUPABASE_ANON_KEY,
        N8N_WEBHOOK_URL: "https://automacoes-n8n.infrassys.com/webhook/cultops-ocr",
        N8N_WEBHOOK_RECONCILIATION_URL: "https://automacoes-n8n.infrassys.com/webhook/prestai-conciliation",
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
        res.send("🤖 Cultopps RPA Microservice - Running!");
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

        // 1. Buscar Credenciais do Usuário (SALIC)
        // Usamos a view descriptografada definida no setup.sql
        const { data: creds, error: credError } = await supabase
            .from('decrypted_external_credentials')
            .select('*')
            .eq('user_id', userId)
            .eq('service_name', 'salic')
            .single();

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
                protocolo_salic: resultado.protocolo
            }).eq('id', documentId);

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

const ROLES_VALIDOS = ['analista', 'gestor', 'fornecedor', 'operador'];

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
                .select('user_id, role, created_at')
                .eq('organization_id', orgId);
            if (error) throw error;

            const users = await Promise.all((orgUsers || []).map(async (ou) => {
                const { data } = await supabase.auth.admin.getUserById(ou.user_id);
                return {
                    id: ou.user_id,
                    email: data?.user?.email || null,
                    role: data?.user?.app_metadata?.role || data?.user?.user_metadata?.role || null,
                    org_role: ou.role,
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

        const callerOrgId = req.user.app_metadata?.org_id;
        if (!callerOrgId) {
            return res.status(400).json({ error: 'org_id ausente. Faça logout e login novamente.' });
        }

        try {
            const { data: targetOrgUser, error: orgErr } = await supabase
                .from('organization_users')
                .select('organization_id')
                .eq('user_id', targetUserId)
                .maybeSingle();
            if (orgErr) throw orgErr;

            if (!targetOrgUser || targetOrgUser.organization_id !== callerOrgId) {
                return res.status(403).json({ error: 'Usuário não pertence à sua organização.' });
            }

            const { data: before, error: getErr } = await supabase.auth.admin.getUserById(targetUserId);
            if (getErr || !before?.user) return res.status(404).json({ error: 'Usuário alvo não encontrado.' });

            const roleAnterior = before.user.app_metadata?.role || before.user.user_metadata?.role || null;

            const { error: updErr } = await supabase.auth.admin.updateUserById(targetUserId, {
                app_metadata:  { ...(before.user.app_metadata  || {}), role, org_id: callerOrgId },
                user_metadata: { ...(before.user.user_metadata || {}), role, org_id: callerOrgId }
            });
            if (updErr) throw updErr;

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

// POST /api/gestor/criar-analista (S1-C)
// Cria um usuário operacional (analista ou operador), já vinculado à org de quem chama.
app.post('/api/gestor/criar-analista',
    requireAuth, requireRole('gestor', 'admin'),
    async (req, res) => {
        const { email, password, nome } = req.body || {};
        const role = req.body?.role || 'analista';
        if (!['analista', 'operador'].includes(role)) {
            return res.status(400).json({ error: 'Role inválido. Use analista ou operador.' });
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
                app_metadata:  { role, org_id: orgId }
            });
            if (createErr) throw createErr;

            const newUserId = created?.user?.id;
            if (!newUserId) throw new Error('Falha ao obter id do usuário criado.');

            const { error: linkErr } = await supabase
                .from('organization_users')
                .insert({ organization_id: orgId, user_id: newUserId, role });
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
                    // Se o n8n retornar um texto (ex: "Workflow got started"), empacotamos em um JSON
                    res.status(n8nRes.statusCode).json({ 
                        success: n8nRes.statusCode < 400, 
                        message: responseData || "Resposta não pôde ser lida." 
                    });
                }
            });
        });

        n8nReq.on('error', (error) => {
            throw error;
        });

        n8nReq.write(dataStr);
        n8nReq.end();
    } catch (error) {
        console.error('[PROXY ERROR]', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * ============================================================================
 * IMPORTAÇÃO DE PROJETO VIA PDF DO SALIC (substitui o fluxo n8n)
 * POST /api/m2/processar-pdf-salic
 * Body: { import_id, project_id, file_path }
 * Fluxo: download do PDF -> OCR (Mistral) -> estruturação JSON (Mistral) ->
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

// PASSO 4 — OCR via endpoint dedicado Mistral /v1/ocr
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

// PASSO 5 — Estrutura o texto do OCR em JSON usando Mistral.
async function estruturarSalicJson(textoOcr, apiKey) {
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
async function estruturarContratoJson(textoOcr, apiKey) {
    const instrucoes = `Analise o texto extraído de um contrato ou anexo de serviço e retorne APENAS um JSON com a seguinte estrutura:

{
  "numero": "identificação do contrato ou anexo (ex: Anexo de Serviço nº 01/2026)",
  "objeto": "descrição do objeto/serviço contratado (máx 500 chars)",
  "fornecedor_nome": "razão social ou nome do CONTRATADO (não do contratante)",
  "fornecedor_cnpj": "CNPJ do CONTRATADO somente dígitos sem pontos barras ou traços",
  "data_inicio": "data de início dos serviços no formato AAAA-MM-DD",
  "data_fim": "data de término dos serviços no formato AAAA-MM-DD",
  "valor_total": 0.00
}

Regras:
- CONTRATADO é quem presta o serviço (fornecedor), NÃO o contratante/cliente.
- fornecedor_cnpj: somente os 14 dígitos numéricos, sem formatação.
- valor_total: número decimal puro (ex: 14660.00), sem R$ ou separadores.
- Datas: formato YYYY-MM-DD.
- Se algum campo não for encontrado, retorne string vazia ou 0.
- Retorne APENAS o JSON válido. Sem markdown, sem backticks, sem explicação.`;

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

// OCR — Estrutura texto de guia de imposto/tributo em JSON.
async function estruturarImpostoJson(textoOcr, apiKey) {
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

app.post('/api/m2/processar-pdf-salic', async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);

    const { project_id, file_path, user_id } = req.body || {};

    if (!project_id || !file_path) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: project_id, file_path.' });
    }

    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (!MISTRAL_API_KEY) {
        return res.status(500).json({ error: 'MISTRAL_API_KEY não configurada no servidor.' });
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

        // 4. OCR via Mistral
        const textoOcr = await runMistralOcr(pdfBase64, MISTRAL_API_KEY);
        console.log(`[SALIC-PDF] OCR concluído (${textoOcr.length} chars). Estruturando JSON...`);

        // 5. Estruturar em JSON
        const jsonParsed = await estruturarSalicJson(textoOcr, MISTRAL_API_KEY);

        // 6. status = processado + dados_extraidos
        await supabase.from('project_salic_imports')
            .update({ status: 'processado', dados_extraidos: jsonParsed })
            .eq('id', import_id);

        // 7. INSERT nas tabelas de destino
        await persistirDadosSalic(jsonParsed, { project_id, organization_id, import_id });

        console.log(`[SALIC-PDF] Importação ${import_id} concluída com sucesso.`);
        return res.json({ success: true, data: jsonParsed, import_id });

    } catch (error) {
        console.error('[SALIC-PDF] Erro:', error.message);
        if (import_id) {
            await supabase.from('project_salic_imports')
                .update({ status: 'erro', erro_mensagem: error.message })
                .eq('id', import_id);
        }
        return res.status(500).json({ error: error.message });
    }
});

/**
 * OCR de contrato de prestação de serviços via Mistral.
 * POST /api/m2/contratos/ocr
 * Body: { file_path } — path no bucket 'contracts' do Supabase Storage
 */
app.post('/api/m2/contratos/ocr', requireAuth, async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    const { fileBase64, fileName, projectId } = req.body || {};
    if (!fileBase64 || !projectId) return res.status(400).json({ error: 'fileBase64 e projectId obrigatórios.' });
    if (!(await userCanAccessProject(req.user.id, projectId))) return res.status(403).json({ error: 'Acesso negado ao projeto.' });
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (!MISTRAL_API_KEY) return res.status(500).json({ error: 'MISTRAL_API_KEY não configurada.' });
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
        const texto = await runMistralOcr(pdfBase64, MISTRAL_API_KEY);
        const dados = await estruturarContratoJson(texto, MISTRAL_API_KEY);
        console.log('[CONTRATO-OCR] Concluído:', JSON.stringify(dados).slice(0, 200));
        return res.json({ success: true, data: dados, file_path: filePath });
    } catch (err) {
        console.error('[CONTRATO-OCR] Erro:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * OCR de guia de imposto/tributo via Mistral.
 * POST /api/m2/impostos/ocr
 * Body: { file_path } — path no bucket 'tax-guides' do Supabase Storage
 */
app.post('/api/m2/impostos/ocr', requireAuth, async (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);
    const { fileBase64, fileName, projectId } = req.body || {};
    if (!fileBase64 || !projectId) return res.status(400).json({ error: 'fileBase64 e projectId obrigatórios.' });
    if (!(await userCanAccessProject(req.user.id, projectId))) return res.status(403).json({ error: 'Acesso negado ao projeto.' });
    const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
    if (!MISTRAL_API_KEY) return res.status(500).json({ error: 'MISTRAL_API_KEY não configurada.' });
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
        const texto = await runMistralOcr(pdfBase64, MISTRAL_API_KEY);
        const dados = await estruturarImpostoJson(texto, MISTRAL_API_KEY);
        console.log('[IMPOSTO-OCR] Concluído:', JSON.stringify(dados).slice(0, 200));
        return res.json({ success: true, data: dados, file_path: filePath });
    } catch (err) {
        console.error('[IMPOSTO-OCR] Erro:', err.message);
        return res.status(500).json({ error: err.message });
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
                    res.status(n8nRes.statusCode).json({ success: n8nRes.statusCode < 400, message: responseData });
                }
            });
        });

        n8nReq.on('error', (error) => { throw error; });
        n8nReq.write(dataStr);
        n8nReq.end();
    } catch (error) {
        console.error('[REPORT PROXY ERROR]', error);
        res.status(500).json({ success: false, message: error.message });
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
    if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
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
            .select('id, titulo, data_evento, nome_local, cidade, estado, status')
            .eq('organization_id', orgId)
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
                distribution_guests(*)
            `)
            .eq('id', id)
            .single();

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

        for (const checkin of checkins) {
            try {
                if (checkin.guest_id) {
                    // Convidado JÁ CADASTRADO (OS/PA pré-registrado) — só marca
                    // o check-in. Se checkin_em já estiver preenchido, NÃO
                    // sobrescreve (duplicidade): mantém o horário original e
                    // registra a tentativa no audit_log abaixo.
                    const { data: guest } = await supabase
                        .from('distribution_guests')
                        .select('checkin_em')
                        .eq('id', checkin.guest_id)
                        .maybeSingle();

                    if (guest && !guest.checkin_em) {
                        await supabase.from('distribution_guests')
                            .update({
                                checkin_em: checkin.timestamp,
                                checkin_por: req.user?.id || null
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
            app_metadata:  { role: 'operador', org_id: orgId },
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

app.get('/api/plataforma/organizacoes', requireAuth, requirePlatformAdmin, async (req, res) => {
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
            app_metadata:  { role: 'admin', org_id: orgId }
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

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
