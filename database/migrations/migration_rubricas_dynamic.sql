-- ==============================================================
-- MIGRATION: RUBRICAS DINÂMICAS (Fase 2 - RPA)
-- Adiciona suporte para rubricas detalhadas obtidas do SALIC
-- ==============================================================

ALTER TABLE public.rubricas 
    ADD COLUMN IF NOT EXISTS codigo TEXT, -- Ex: 01.01.01
    ADD COLUMN IF NOT EXISTS valor_total NUMERIC(12, 2) DEFAULT 0; -- Orçamento aprovado no SALIC

-- Comentário para auditoria
COMMENT ON COLUMN public.rubricas.valor_total IS 'Valor total aprovado para esta rubrica no SALIC, capturado via RPA.';
COMMENT ON COLUMN public.rubricas.codigo IS 'Código numérico do item na planilha orçamentária do SALIC.';
