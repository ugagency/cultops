-- ═══════════════════════════════════════════════════════════════════
-- diagnose_m2.sql — Diagnóstico READ-ONLY do banco do Cultopps
--
-- Objetivo: descobrir o estado REAL antes de aplicar
--           migration_m2_rls_align_m1.sql (que está em DRAFT).
--
-- Rode no SQL Editor do Supabase e cole o resultado de cada bloco
-- de volta na conversa para decidirmos os próximos passos.
--
-- NADA aqui altera dados — só SELECT.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 1 — Helpers SQL do padrão M1
-- Esperado pela spec: 6 linhas (uma por função).
-- Se vier 0 linhas → helpers NÃO existem → precisamos criá-los.
-- ───────────────────────────────────────────────────────────────────
SELECT routine_name, routine_type, data_type AS returns
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'current_user_org_id',
    'current_user_role',
    'has_role',
    'has_any_role',
    'same_org',
    'user_organization_ids'
  )
ORDER BY routine_name;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 2 — Constraint atual de organization_users.role
-- Spec diz: gestor | analista | fornecedor
-- Repo (setup.sql) diz: owner | admin | member
-- O banco real pode estar em qualquer um dos dois (ou outro).
-- ───────────────────────────────────────────────────────────────────
SELECT
  c.column_name,
  c.data_type,
  c.column_default,
  pg_get_expr(con.conbin, con.conrelid) AS check_definition
FROM information_schema.columns c
LEFT JOIN pg_constraint con
  ON con.conrelid = ('public.' || c.table_name)::regclass
 AND con.contype = 'c'
 AND pg_get_expr(con.conbin, con.conrelid) LIKE '%' || c.column_name || '%'
WHERE c.table_schema = 'public'
  AND c.table_name = 'organization_users'
  AND c.column_name = 'role';

-- Distribuição real de valores em uso:
SELECT role, COUNT(*) AS qtd
FROM public.organization_users
GROUP BY role
ORDER BY qtd DESC;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 3 — Colunas organization_id nas 10 tabelas alvo do M2
-- Queremos saber: existe? nullable? tem FK para organizations?
-- ───────────────────────────────────────────────────────────────────
SELECT
  c.table_name,
  c.column_name,
  c.is_nullable,
  c.data_type,
  tc.constraint_type,
  ccu.table_name AS references_table
FROM information_schema.columns c
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.table_schema = c.table_schema
 AND kcu.table_name = c.table_name
 AND kcu.column_name = c.column_name
LEFT JOIN information_schema.table_constraints tc
  ON tc.constraint_name = kcu.constraint_name
 AND tc.constraint_type = 'FOREIGN KEY'
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = kcu.constraint_name
 AND tc.constraint_type = 'FOREIGN KEY'
WHERE c.table_schema = 'public'
  AND c.column_name = 'organization_id'
  AND c.table_name IN (
    'contracts','contract_parcelas','contract_aditivos',
    'physical_evidences','tax_guides','rubricas_readequacoes',
    'project_checklist','checklist_items',
    'relatorio_prestacao_contas','exportacoes_log',
    'despesas','documents','projects','rubricas'
  )
ORDER BY c.table_name;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 4 — Quais das 10 tabelas alvo NÃO têm organization_id
-- (devem aparecer aqui: relatorio_prestacao_contas e possivelmente
-- outras se algo mudou fora do repo)
-- ───────────────────────────────────────────────────────────────────
WITH alvo(name) AS (
  VALUES
    ('contracts'),
    ('contract_parcelas'),
    ('contract_aditivos'),
    ('physical_evidences'),
    ('tax_guides'),
    ('rubricas_readequacoes'),
    ('project_checklist'),
    ('checklist_items'),
    ('relatorio_prestacao_contas'),
    ('exportacoes_log')
)
SELECT a.name AS tabela_sem_org_id
FROM alvo a
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = a.name
 AND c.column_name = 'organization_id'
WHERE c.column_name IS NULL;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 5 — Quantos registros com organization_id NULL em cada
-- tabela onde a coluna existe (INV-01: deve ser 0 em todas)
-- ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  q TEXT;
  c BIGINT;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'organization_id'
      AND table_name IN (
        'contracts','contract_parcelas','contract_aditivos',
        'physical_evidences','tax_guides','rubricas_readequacoes',
        'project_checklist','checklist_items',
        'relatorio_prestacao_contas','exportacoes_log',
        'despesas','documents','projects','rubricas'
      )
  LOOP
    q := format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', r.table_name);
    EXECUTE q INTO c;
    RAISE NOTICE '  % → % registros com organization_id NULL', r.table_name, c;
  END LOOP;
END $$;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 6 — Policies ATUAIS nas 10 tabelas alvo
-- (qual = predicado USING; with_check = predicado WITH CHECK)
-- ───────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  qual AS using_predicate,
  with_check AS with_check_predicate
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts','contract_parcelas','contract_aditivos',
    'physical_evidences','tax_guides','rubricas_readequacoes',
    'project_checklist','checklist_items',
    'relatorio_prestacao_contas','exportacoes_log'
  )
ORDER BY tablename, cmd, policyname;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 7 — Policies do M1 (para entender o padrão "verdade" atual)
-- Olhar se usam current_user_org_id() ou subquery organization_users
-- ───────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  cmd,
  qual AS using_predicate
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('despesas','documents','projects','rubricas','organization_users')
ORDER BY tablename, cmd, policyname;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 8 — RLS habilitado em cada tabela alvo?
-- ───────────────────────────────────────────────────────────────────
SELECT
  n.nspname AS schema,
  c.relname AS tabela,
  c.relrowsecurity AS rls_habilitado,
  c.relforcerowsecurity AS rls_forçado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'contracts','contract_parcelas','contract_aditivos',
    'physical_evidences','tax_guides','rubricas_readequacoes',
    'project_checklist','checklist_items',
    'relatorio_prestacao_contas','exportacoes_log'
  )
ORDER BY c.relname;


-- ───────────────────────────────────────────────────────────────────
-- BLOCO 9 — Há algum usuário com app_metadata.org_id no JWT?
-- (não consigo ler JWT direto — leio raw_app_meta_data na auth.users)
-- ───────────────────────────────────────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE raw_app_meta_data ? 'org_id') AS com_org_id,
  COUNT(*) FILTER (WHERE NOT (raw_app_meta_data ? 'org_id')) AS sem_org_id,
  COUNT(*) AS total
FROM auth.users;
