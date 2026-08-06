-- Suporte à exclusão segura de usuário pela tela Equipe.
--
-- 'fornecedor' é opção do modal "Alterar Perfil" desde sempre, mas nunca esteve
-- no CHECK — porque set-role só gravava app_metadata e nunca tocava nesta
-- tabela. Agora que set-role sincroniza organization_users.role, escolher
-- Fornecedor quebraria com 23514. DEFAULT segue 'member', coerente com o CHECK.
ALTER TABLE public.organization_users
  DROP CONSTRAINT organization_users_role_check;
ALTER TABLE public.organization_users
  ADD CONSTRAINT organization_users_role_check
  CHECK (role IN ('admin', 'gestor', 'analista', 'member', 'operador', 'fornecedor'));

-- Quantos admins a organização ainda tem, contando pelo app_metadata — que é o
-- que de fato autoriza (JWT e RLS via has_role()). organization_users.role
-- diverge na prática, porque set-role histórico só atualizava o auth.
-- Usada para não deixar a org ficar sem nenhum admin (exclusão e rebaixamento).
CREATE OR REPLACE FUNCTION public.contar_admins_org(p_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT count(*)::int
  FROM public.organization_users ou
  JOIN auth.users u ON u.id = ou.user_id
  WHERE ou.organization_id = p_org_id
    AND coalesce(u.raw_app_meta_data ->> 'role',
                 u.raw_user_meta_data ->> 'role') = 'admin';
$$;

-- O que seria perdido ou bloquearia se este usuário fosse apagado de verdade.
-- Descobre as FKs varrendo pg_constraint em vez de listar tabelas na mão, para
-- não ficar desatualizada quando surgir tabela nova apontando para auth.users.
-- Devolve {} quando a conta está limpa (o caso "criada errada", que pode ser
-- apagada), ou {"documents.user_id": 117, ...} quando não está.
--
-- Ignora dois casos de propósito:
--   confdeltype = 'n' (ON DELETE SET NULL, ex. audit_log.alterado_por) — não
--     perde dado nem bloqueia o delete; contá-lo travaria a exclusão de
--     qualquer conta que já tivesse feito uma ação auditada.
--   organization_users — é a própria linha de vínculo com a org, que some por
--     cascata junto com o usuário.
CREATE OR REPLACE FUNCTION public.usuario_vinculos(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r       record;
  v_count integer;
  v_out   jsonb := '{}'::jsonb;
BEGIN
  FOR r IN
    SELECT ns.nspname AS nsp, cl.relname AS tbl, att.attname AS col
    FROM pg_constraint con
    JOIN pg_class     cl  ON cl.oid = con.conrelid
    JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
    JOIN pg_class     fcl ON fcl.oid = con.confrelid
    JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f'
      AND fns.nspname = 'auth' AND fcl.relname = 'users'
      AND ns.nspname = 'public'
      AND con.confdeltype <> 'n'
      AND cl.relname <> 'organization_users'
  LOOP
    -- LIMIT 501 em vez de count(*) puro: só precisamos saber "tem ou não tem",
    -- e o número exato só para a mensagem. Evita varrer tabela grande inteira.
    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM %I.%I WHERE %I = $1 LIMIT 501) t',
      r.nsp, r.tbl, r.col)
      INTO v_count USING p_user_id;

    IF v_count > 0 THEN
      v_out := v_out || jsonb_build_object(r.tbl || '.' || r.col, v_count);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- SECURITY DEFINER + sem REVOKE deixaria qualquer usuário logado enumerar o
-- volume de dados de contas alheias. Só o backend (service role) chama.
REVOKE ALL ON FUNCTION public.contar_admins_org(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usuario_vinculos(uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contar_admins_org(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.usuario_vinculos(uuid)  TO service_role;
