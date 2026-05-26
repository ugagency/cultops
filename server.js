require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Supabase (Backend usa Service Role para bypassar RLS e descriptografar)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Use a chave service_role para ler credenciais descriptografadas
);

app.use(cors());
app.use(express.json());

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
        SALIC_API_URL: "https://cultops-production-5a3d.up.railway.app/api/salic/inserir"
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
    // Carregamento "Lazy" do robô para economizar memória na Vercel
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
                cnpj_fornecedor: doc.cnpj_emissor,
                valor: doc.valor,
                numero: doc.json_extraido?.numero_nota || 'S/N',
                data_emissao: doc.data_emissao,
                nf_path: doc.file_path,
                nf_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/documentos/${doc.file_path}`
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

const ROLES_VALIDOS = ['analista', 'gestor', 'fornecedor'];

app.get('/api/gestor/usuarios',
    requireAuth, requireRole('gestor'),
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
    requireAuth, requireRole('gestor'),
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
                app_metadata: { ...(before.user.app_metadata || {}), role }
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
// Cria um usuário com role 'analista', já vinculado à org do gestor que está chamando.
app.post('/api/gestor/criar-analista',
    requireAuth, requireRole('gestor'),
    async (req, res) => {
        const { email, password, nome } = req.body || {};
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
                user_metadata: { role: 'analista', nome: nome || null },
                app_metadata: { role: 'analista', org_id: orgId }
            });
            if (createErr) throw createErr;

            const newUserId = created?.user?.id;
            if (!newUserId) throw new Error('Falha ao obter id do usuário criado.');

            const { error: linkErr } = await supabase
                .from('organization_users')
                .insert({ organization_id: orgId, user_id: newUserId, role: 'membro' });
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
                valor_novo: 'analista',
                alterado_por: req.user.id,
                origem: 'gestor_ui'
            });

            res.json({ ok: true, user: { id: newUserId, email, role: 'analista' } });
        } catch (err) {
            console.error('[GESTOR] criar-analista:', err);
            const msg = err?.message || 'Erro ao criar analista.';
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

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
