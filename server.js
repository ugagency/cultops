require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { executarInsercaoSalic } = require('./salic_insertion.cjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração Supabase (Backend usa Service Role para bypassar RLS e descriptografar)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Use a chave service_role para ler credenciais descriptografadas
);

app.use(cors());
app.use(express.json());

// Rota para servir o config.js dinamicamente ao navegador
app.get('/config.js', (req, res) => {
    const publicConfig = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_KEY: process.env.SUPABASE_ANON_KEY,
        N8N_WEBHOOK_URL: "https://automacoes-n8n.infrassys.com/webhook/cultops-ocr",
        N8N_WEBHOOK_RECONCILIATION_URL: "https://automacoes-n8n.infrassys.com/webhook/prestai-conciliation",
        N8N_WEBHOOK_VALIDATION_URL: "https://automacoes-n8n.infrassys.com/webhook/cultopsvalidation",
        N8N_WEBHOOK_SALIC_PROJECT_URL: "https://automacoes-n8n.infrassys.com/webhook/cultops-projeto",
        N8N_WEBHOOK_SALIC_IMPORT_RUBRICAS_URL: "/api/rubricas/importar",
        N8N_WEBHOOK_CRIAR_PDF_URL: "https://automacoes-n8n.infrassys.com/webhook/relatorio",
        SALIC_API_URL: "/api/salic/inserir"
    };
    res.type('application/javascript');
    res.send(`const CONFIG = ${JSON.stringify(publicConfig, null, 2)};`);
});

// Servir arquivos estáticos (Front-end)
app.use(express.static(path.join(__dirname, './')));

/**
 * Endpoint para disparar o robô do SALIC
 */
app.post('/api/salic/inserir', async (req, res) => {
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

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
    });
}

module.exports = app;
