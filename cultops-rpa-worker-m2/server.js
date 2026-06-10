require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const app = express();
const PORT = process.env.PORT || 10001;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'Cultops RPA Worker M2 is online'
  });
});

app.post('/api/salic/comprovar-fisico',
  async (req, res) => {
  const { executarComprovacaoFisica } =
    require('./salic_comprovacao_fisica.cjs');
  const { evidenciaId, userId } = req.body;

  if (!evidenciaId)
    return res.status(400).json({
      error: 'ID da evidência não fornecido.'
    });

  try {
    // 1. Credenciais SALIC
    const { data: creds } = await supabase
      .from('decrypted_external_credentials')
      .select('*')
      .eq('user_id', userId)
      .eq('service_name', 'salic')
      .single();

    if (!creds)
      throw new Error(
        'Credenciais SALIC não encontradas.'
      );

    // 2. Evidência com rubrica e projeto
    const { data: evidencia, error: evErr } =
      await supabase
        .from('physical_evidences')
        .select(`
          id,
          file_path,
          file_name,
          mime_type,
          tipo_evidencia,
          descricao,
          status_validacao,
          rubrica_id_fk,
          projects ( pronac, nome ),
          rubricas (
            nome,
            codigo,
            valor_aprovado,
            rubrica_id
          )
        `)
        .eq('id', evidenciaId)
        .single();

    if (evErr || !evidencia)
      throw new Error('Evidência não encontrada.');

    if (evidencia.status_validacao !== 'aprovada')
      throw new Error(
        'Evidência ainda não aprovada.'
      );

    if (!evidencia.rubrica_id_fk)
      throw new Error(
        'Rubrica não vinculada à evidência. ' +
        'Vincule antes de enviar ao SALIC.'
      );

    // 3. Signed URL do arquivo
    const { data: urlData } = await supabase
      .storage
      .from('physical-evidences')
      .createSignedUrl(
        evidencia.file_path.trim(),
        3600
      );

    if (!urlData?.signedUrl)
      throw new Error(
        'Não foi possível gerar URL do arquivo.'
      );

    // 4. Config para o RPA
    const config = {
      usuario: String(creds.identifier),
      senha: String(creds.secret_plain),
      pronac: String(evidencia.projects.pronac),
      rubricaNome: evidencia.rubricas?.nome || '',
      rubricaValorAprovado:
        evidencia.rubricas?.valor_aprovado,
      evidencia: {
        id: evidencia.id,
        file_url: urlData.signedUrl,
        file_name: evidencia.file_name,
        mime_type: evidencia.mime_type,
        tipo: evidencia.tipo_evidencia,
        descricao: evidencia.descricao || ''
      }
    };

    // 5. Executar RPA
    const resultado =
      await executarComprovacaoFisica(config);

    if (resultado.sucesso) {
      await supabase
        .from('physical_evidences')
        .update({
          status_validacao: 'enviada_salic',
          enviada_salic_em: new Date().toISOString()
        })
        .eq('id', evidenciaId);

      return res.json({ success: true });
    } else {
      throw new Error(resultado.erro);
    }

  } catch (error) {
    console.error('[API M2]', error.message);
    await supabase
      .from('physical_evidences')
      .update({ status_validacao: 'erro_rpa' })
      .eq('id', evidenciaId);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[RPA M2] Porta ${PORT}`);
});
