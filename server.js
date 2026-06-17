require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

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
        SALIC_API_URL: "/api/salic/inserir"
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

const ROLES_VALIDOS = ['analista', 'gestor', 'fornecedor'];

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
// Cria um usuário com role 'analista', já vinculado à org do gestor que está chamando.
app.post('/api/gestor/criar-analista',
    requireAuth, requireRole('gestor', 'admin'),
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
                user_metadata: { role: 'analista', nome: nome || null, org_id: orgId },
                app_metadata:  { role: 'analista', org_id: orgId }
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
                .insert({ razao_social, cnpj: cnpj.replace(/\D/g, '') })
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
                .insert({ project_id, fornecedor_id: fornecedorId });
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

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
