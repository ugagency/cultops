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

app.listen(PORT, () => {
    console.log(`[SERVER] Rodando em http://localhost:${PORT}`);
});
