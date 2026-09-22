-- ==============================================================
-- MIGRATION: SALDO SALIC — restringe RPC do cron ao worker
-- CR-2026-001 — Controle Preventivo de Saldo de Rubricas
-- ==============================================================
-- Achado de auditoria: toda função nova ganha EXECUTE para PUBLIC por
-- padrão no Postgres, e no Supabase o schema public normalmente tem
-- default privileges que também concedem EXECUTE explícito a anon e
-- authenticated. saldo_salic_projetos_elegiveis_captura() foi criada
-- em migration_saldo_salic_fase3.sql só para o worker (via service_role)
-- consultar no /cron/captura-condicional, mas ficou chamável por
-- qualquer usuário autenticado — e por anon, sem login nenhum.
--
-- A RLS de projects já limita o retorno à organização de quem chama
-- (confirmado com uma sessão real: não vaza dado de outra organização),
-- mas a função nunca deveria estar exposta ao front — chamada por anon
-- gasta recursos do banco à toa, e authenticated vê sugestao_user_id
-- (um UUID de usuário) sem necessidade.
-- ==============================================================

REVOKE EXECUTE ON FUNCTION public.saldo_salic_projetos_elegiveis_captura()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.saldo_salic_projetos_elegiveis_captura()
  TO service_role;

-- Verificação manual:
-- SELECT grantee, privilege_type FROM information_schema.role_routine_grants
-- WHERE routine_name = 'saldo_salic_projetos_elegiveis_captura';
-- (deve mostrar só service_role, ou nada — a ausência de linha para uma role
-- indica que ela não tem grant)
