-- ═══════════════════════════════════════════════════════════════════
-- migration_m2_evidencia_data_captura.sql
--
-- Adiciona data_captura em physical_evidences: a data real em que a
-- evidência (foto/vídeo/relatório) foi registrada/capturada — não o
-- timestamp de upload no sistema (criado_em). Relevante para o
-- relatório trimestral do SALIC e auditoria do MinC.
--
-- Coluna date pura (sem hora) — raramente se sabe o horário exato.
-- Nullable — registros antigos (pré-migration) ficam sem essa data.
--
-- Idempotente — pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.physical_evidences
  ADD COLUMN IF NOT EXISTS data_captura date;

COMMENT ON COLUMN public.physical_evidences.data_captura IS
  'Data em que a evidência (foto/vídeo/documento) foi de fato registrada/capturada — diferente de criado_em, que é o timestamp do upload no sistema.';

-- ─── VERIFICAÇÃO FINAL ─────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='physical_evidences' AND column_name='data_captura';
