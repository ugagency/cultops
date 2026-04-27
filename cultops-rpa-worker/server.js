require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuração Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors());
app.use(express.json());

// Rota de Health Check
app.get('/', (req, res) => {
    res.json({ status: 'Cultopps RPA Worker is online' });
});

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

        // Busca o valor aprovado da rubrica para desempate de rubricas com mesmo nome
        let rubricaValorAprovado = null;
        if (doc.rubrica) {
            const { data: rubricaData } = await supabase
                .from('rubricas')
                .select('valor_aprovado')
                .eq('project_id', doc.project_id)
                .ilike('nome', `%${doc.rubrica.replace(/^\d+\s*-\s*/, '').trim()}%`)
                .maybeSingle();

            if (rubricaData && rubricaData.valor_aprovado) {
                rubricaValorAprovado = rubricaData.valor_aprovado;
                console.log(`[API] Valor Aprovado da Rubrica: ${rubricaValorAprovado}`);
            } else {
                console.log(`[API] Aviso: Valor aprovado não encontrado. Fallback por saldo.`);
            }
        }

        const config = {
            usuario: String(creds.identifier),
            senha: String(creds.secret_plain),
            pronac: String(doc.projects.pronac),
            rubricaNome: doc.rubrica || 'Rubrica não informada',
            rubricaValorAprovado: rubricaValorAprovado,
            documento: {
                cnpj_fornecedor: doc.cnpj_emissor,
                valor: doc.valor,
                numero: doc.numero_nf || doc.json_extraido?.numero_nota || 'S/N',
                data_emissao: doc.data_emissao,
                nf_path: doc.file_path,
                nf_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/documentos/${doc.file_path}`
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
