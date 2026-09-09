-- ==============================================================
-- migration_m1_vinculo_lote_extrato.sql
--
-- Corrige a causa raiz 1 do bug de Upload em Lote: o vínculo entre o extrato
-- subido e o lote em andamento vivia só em state.loteExtratoVinculado, uma
-- variável JS pura, nunca persistida. Qualquer F5, troca de aba prolongada ou
-- expiração de sessão entre "subir extrato" e "Processar Todos" apagava o
-- vínculo em silêncio — o campo simplesmente gravava null, sem erro nem aviso.
--
-- Confirmado em produção: extrato_origem_id NUNCA foi preenchido em nenhum
-- documento real (0 de 135 na Animus, 0 de 25 na Rubim). Só funcionou no
-- projeto de teste, numa sessão contínua sem interrupção — exatamente o cenário
-- que expõe a fragilidade.
--
-- Esta coluna marca qual extrato é "o vínculo ativo do lote" para um dado
-- project_id + user_id. app.js volta a consultá-la ao entrar na tela ou trocar
-- de projeto, então o vínculo sobrevive a reload.
-- ==============================================================

ALTER TABLE public.extratos
  ADD COLUMN IF NOT EXISTS vinculo_lote_ativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.extratos.vinculo_lote_ativo IS
  'true = este é o extrato vinculado ao lote em andamento (project_id + user_id). Documentos entrando na fila de Upload em Lote deste projeto herdam este extrato em extrato_origem_id ao serem processados. Só um extrato por project_id+user_id fica true por vez — handleUploadExtratoParaLote desmarca o anterior antes de marcar o novo.';

-- Uma consulta por (project_id, user_id) ao restaurar a tela: índice parcial,
-- só sobre as linhas que interessam.
CREATE INDEX IF NOT EXISTS idx_extratos_vinculo_lote_ativo
  ON public.extratos (project_id, user_id)
  WHERE vinculo_lote_ativo = true;

-- ==============================================================
-- VERIFICAÇÃO
-- ==============================================================
-- Esperado: 0 — coluna nova, nada preenchido ainda.
SELECT COUNT(*) AS extratos_marcados_como_ativos
FROM public.extratos
WHERE vinculo_lote_ativo = true;

-- Nunca deve haver mais de 1 ativo por project_id+user_id.
SELECT project_id, user_id, COUNT(*) AS ativos
FROM public.extratos
WHERE vinculo_lote_ativo = true
GROUP BY project_id, user_id
HAVING COUNT(*) > 1;
