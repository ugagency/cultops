-- ═══════════════════════════════════════════════════════════════════
-- migration_m2_evidencia_produto.sql
--
-- Muda o vínculo de physical_evidences de "rubrica" (1 linha específica
-- de rubricas) para "produto" (rótulo de texto livre repetido em
-- várias linhas de rubricas.produto para o mesmo project_id).
--
-- 1) Nova coluna produto_evidencia (text, nullable) em physical_evidences.
-- 2) Índice em produto_evidencia (filtros/agrupamentos futuros).
-- 3) Comentários documentando produto_evidencia como o vínculo atual
--    e rubrica_id_fk como legado (mantido, nullable, não populado
--    em novos inserts a partir desta mudança).
--
-- Nota: rubricas.produto já existe em produção — nenhuma migração
-- necessária para essa coluna.
--
-- Idempotente — pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1) Coluna ──────────────────────────────────────────────────────
ALTER TABLE public.physical_evidences
  ADD COLUMN IF NOT EXISTS produto_evidencia text;

-- ─── 2) Índice ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_physical_evidences_produto_evidencia
  ON public.physical_evidences(produto_evidencia);

-- ─── 3) Comentários (documentação de esquema) ──────────────────────
COMMENT ON COLUMN public.physical_evidences.produto_evidencia IS
  'Rótulo de produto (texto livre, espelha rubricas.produto) ao qual esta evidência está vinculada. Substitui rubrica_id_fk como vínculo primário a partir desta migração.';

COMMENT ON COLUMN public.physical_evidences.rubrica_id_fk IS
  'LEGADO: vínculo antigo a uma rubrica específica. Mantido para compatibilidade histórica; não é mais preenchido em novos inserts (ver produto_evidencia).';

-- ─── VERIFICAÇÃO FINAL ─────────────────────────────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='physical_evidences'
  AND column_name IN ('produto_evidencia', 'rubrica_id_fk');
