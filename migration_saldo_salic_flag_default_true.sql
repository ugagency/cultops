-- ==============================================================
-- MIGRATION: SALDO SALIC — flag habilitada por padrão para orgs novas
-- CR-2026-001 — Controle Preventivo de Saldo de Rubricas
-- ==============================================================
-- migration_saldo_salic_fase3.sql criou organizations.saldo_rubricas_
-- habilitado com DEFAULT false, para controlar rollout organização a
-- organização (deploy e exposição como eventos separados). Decisão
-- revista: organização CRIADA A PARTIR DE AGORA já nasce com a feature
-- visível, sem passo manual.
--
-- Só muda o DEFAULT da coluna — não altera nenhuma linha existente.
-- Organizações já cadastradas continuam exatamente como estão hoje
-- (ex.: Rubim e Animus seguem com o valor que tiverem, false ou true,
-- até alguém mudar explicitamente).
-- ==============================================================

ALTER TABLE public.organizations
  ALTER COLUMN saldo_rubricas_habilitado SET DEFAULT true;

-- Verificação manual:
-- SELECT column_name, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'organizations'
--   AND column_name = 'saldo_rubricas_habilitado';
