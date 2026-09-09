-- ═══════════════════════════════════════════════════════════════════════════
-- migration_m3_relatorio_links_nomeados_publico_texto.sql
-- Ajusta o modelo para bater 1:1 com o template real da Animus:
--   • links passam a ser LISTAS de {nome, url} (o modelo mostra vários links
--     por campo, exibindo o nome do arquivo, não a URL crua);
--   • "quantitativo de público x meta" vira TEXTO LIVRE (varia por evento:
--     "Inscrição via forms", "Patrocinadores: 20…", etc.).
-- Projeto Supabase: ucmahpyxjxqbrvnistrh
-- ═══════════════════════════════════════════════════════════════════════════

-- Público x meta como texto livre (mantém publico_por_dia para compatibilidade).
ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS publico_meta_texto text;

-- Converte os 4 campos de link de text -> jsonb (array de {nome,url}).
-- Campos recém-criados e vazios em produção no momento da conversão.
ALTER TABLE public.distribution_events DROP COLUMN IF EXISTS link_borderos;
ALTER TABLE public.distribution_events DROP COLUMN IF EXISTS link_fotos_execucao;
ALTER TABLE public.distribution_events DROP COLUMN IF EXISTS link_fotos_acessibilidade;
ALTER TABLE public.distribution_events DROP COLUMN IF EXISTS link_materiais_comunicacao;

ALTER TABLE public.distribution_events
  ADD COLUMN link_borderos              jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN link_fotos_execucao        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN link_fotos_acessibilidade  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN link_materiais_comunicacao jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Obs.: custos_por_evento (jsonb em distribution_monthly_reports) ganha o campo
-- opcional "link_nome" por item — não requer DDL (é jsonb livre).
