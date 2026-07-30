-- ═══════════════════════════════════════════════════════════════════════════
-- migration_m3_relatorio_campos_faltantes.sql
-- Completa o Relatório de Evento/Mensal do M3 para bater com o template real
-- da Animus. Adiciona os 5 campos/peças confirmados por comparação direta.
-- Projeto Supabase: ucmahpyxjxqbrvnistrh
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Código interno do contrato (ex: "IAC_24") — 1 por projeto, aparece em
--    todo relatório desse projeto (Seção 1, campo "Projeto").
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS codigo_projeto_contrato text;

-- 2) Horário como texto livre — o campo "horario" (time) não comporta
--    "Sábado 13h às 17h e Domingo 08h às 15h".
ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS horario_descricao text;

-- 3) Os 4 links do evento (Seção 2 do template).
ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS link_borderos text,
  ADD COLUMN IF NOT EXISTS link_fotos_execucao text,
  ADD COLUMN IF NOT EXISTS link_fotos_acessibilidade text,
  ADD COLUMN IF NOT EXISTS link_materiais_comunicacao text;

-- 4) Novo tipo de evidência: 'acessibilidade' — separa a galeria de
--    acessibilidade do template das demais.
ALTER TABLE public.physical_evidences
  DROP CONSTRAINT IF EXISTS physical_evidences_tipo_evidencia_check;

ALTER TABLE public.physical_evidences
  ADD CONSTRAINT physical_evidences_tipo_evidencia_check
  CHECK (tipo_evidencia = ANY (ARRAY[
    'foto_evento'::text,
    'relatorio_objeto'::text,
    'peca_marketing'::text,
    'acessibilidade'::text,
    'outros'::text
  ]));
