require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

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

// Endpoint SALIC
app.post('/api/salic/inserir', async (req, res) => {
    const { executarInsercaoSalic } = require('./salic_insertion.cjs');
    const { documentId, userId } = req.body;

    if (!documentId) return res.status(400).json({ error: 'ID do documento não fornecido.' });

    try {
        console.log(`[API] Iniciando processo para documento: ${documentId}`);

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

        // Resolucao da rubrica em CASCATA (3 estrategias, da mais confiavel a mais ambigua).
        // Motivacao: doc.rubrica e texto livre e nem sempre tem prefixo numerico; nomes
        // repetidos em etapas diferentes (ex.: "Produtor executivo" em Pre-Producao E em
        // Execucao) geravam match errado. A coluna documents.rubrica_id_fk (FK -> rubricas.id),
        // quando preenchida, resolve por UUID direto — sem parsing, sem ambiguidade.
        let rubrica = null;

        // ESTRATEGIA 1 — UUID direto (mais confiavel)
        // Requer que documents.rubrica_id_fk esteja preenchido
        if (doc.rubrica_id_fk) {
            const { data } = await supabase
                .from('rubricas')
                .select('nome, etapa, valor_aprovado, rubrica_id, produto')
                .eq('id', doc.rubrica_id_fk)
                .single();
            rubrica = data;
            if (rubrica) {
                console.log(`[API] Rubrica por UUID: "${rubrica.nome}"` +
                    ` | ID: ${rubrica.rubrica_id}` +
                    ` | Etapa: ${rubrica.etapa}` +
                    ` | Valor: R$ ${rubrica.valor_aprovado}` +
                    ` | Produto: ${rubrica.produto || '(sem produto)'}`);
            }
        }

        // ESTRATEGIA 2 — rubrica_id numerico extraido do prefixo
        // Ex: "37 - Produtor executivo" → rubrica_id="37"
        if (!rubrica) {
            console.warn('[API] rubrica_id_fk ausente — tentando prefixo numérico');
            const rubricaIdNum = doc.rubrica?.match(/^(\d+)\s*-/)?.[1];
            if (rubricaIdNum) {
                const { data } = await supabase
                    .from('rubricas')
                    .select('nome, etapa, valor_aprovado, rubrica_id, produto')
                    .eq('project_id', doc.project_id)
                    .eq('rubrica_id', rubricaIdNum)
                    .maybeSingle();
                rubrica = data;
                if (rubrica) {
                    console.log(`[API] Rubrica por prefixo "${rubricaIdNum}":` +
                        ` "${rubrica.nome}" | Etapa: ${rubrica.etapa}`);
                }
            }
        }

        // ESTRATEGIA 3 — nome (ultimo recurso, ambiguo)
        if (!rubrica) {
            console.warn('[API] Fallback por nome — pode ser ambíguo. rubricaProduto será null, RPA usará busca flat.');
            const nomeRubrica = doc.rubrica
                ?.replace(/^\d+\s*-\s*/, '')
                ?.trim();
            if (nomeRubrica) {
                const { data } = await supabase
                    .from('rubricas')
                    .select('nome, etapa, valor_aprovado, rubrica_id')
                    .eq('project_id', doc.project_id)
                    .ilike('nome', `%${nomeRubrica}%`)
                    .order('valor_aprovado', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                rubrica = data;
                if (rubrica) {
                    console.warn(`[API] Rubrica por nome: "${rubrica.nome}"` +
                        ` | Etapa: ${rubrica.etapa} — VALIDAR SE CORRETO`);
                }
            }
        }

        if (!rubrica) {
            throw new Error(`Rubrica não encontrada para documento ${doc.id}` +
                ` | rubrica: "${doc.rubrica}" | rubrica_id_fk: ${doc.rubrica_id_fk}`);
        }

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

        const config = {
            usuario: String(creds.identifier),
            senha: String(creds.secret_plain),
            pronac: String(doc.projects.pronac),
            rubricaNome: doc.rubrica || 'Rubrica não informada',
            rubricaValorAprovado: rubricaValorAprovado,
            rubricaEtapa: rubricaEtapa,
            rubricaProduto: rubricaProduto,
            documento: {
                cnpj_fornecedor: doc.cnpj_emissor,
                valor: doc.valor,
                numero: doc.numero_nf || doc.json_extraido?.numero_nota || 'S/N',
                data_emissao: doc.data_emissao,   // Data de Emissão real da NF/recibo (#dataEmissao)
                data_pagamento: dataPagamento,    // Bug #2: Data do Pagamento = data do débito (#dtPagamento)
                nf_path: doc.file_path,
                nf_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/documentos/${doc.file_path}`,
                recibo: doc.recibo,   // flag de tipo: 'yes' = Recibo, 'no' = NF (NÃO é caminho de arquivo)
                numero_extrato: formatarNrDocPagamento(numeroExtrato)
            }
        };

        const resultado = await executarInsercaoSalic(config);

        if (resultado.sucesso) {
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
        await supabase.from('documents').update({
            status: 'erro_rpa',
            just_erro: error.message
        }).eq('id', documentId);
        res.status(500).json({ error: error.message });
    }
});

// Tratamento de erros global para evitar crash do processo
app.use((err, req, res, next) => {
    console.error('[GLOBAL ERROR]', err);
    res.status(500).json({ error: 'Erro interno no servidor', details: err.message });
});

app.listen(PORT, () => {
    console.log(`[RPA WORKER] Rodando na porta ${PORT}`);
});
