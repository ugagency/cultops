-- ═══════════════════════════════════════════════════════════════════
-- migration_sync_org_metadata.sql
--
-- Sincroniza automaticamente auth.users.raw_app_meta_data.org_id
-- com public.organization_users.organization_id.
--
-- POR QUE: sem este trigger, novos gestores entram em organization_users
-- mas o JWT continua sem app_metadata.org_id. Como o helper SQL
-- current_user_org_id() lê do JWT, ele retorna NULL para esses usuários,
-- e a policy RLS do M1 (organization_id = current_user_org_id()) os
-- bloqueia de absolutamente tudo — incluindo a leitura de projects
-- que o getCurrentOrgId() do frontend usaria como fallback (catch-22).
--
-- CÓPIA DUPLA (raw_app_meta_data ↔ JWT): a Supabase emite o JWT lendo
-- raw_app_meta_data no momento do auth.signIn() / refreshSession().
-- Logo, este trigger só afeta sessões NOVAS — sessões abertas com JWT
-- velho continuam stale até logout/refresh. Para forçar refresh imediato
-- no frontend após mudança de organização, chame:
--   await sb.auth.refreshSession()
--
-- INVARIANTES respeitados:
--   INV-02 org_id vive em app_metadata.org_id do JWT
--   INV-04 usuário pertence a UMA única organização (último INSERT/UPDATE
--          em organization_users vence)
--   INV-08 service_role_key não é usada — trigger usa SECURITY DEFINER
--          executando com o role do owner da função (postgres no
--          Supabase SQL Editor)
--
-- Idempotente — pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════


-- ─── 1) Função SECURITY DEFINER que escreve em auth.users ──────────
-- Owner típico no Supabase: postgres (superuser). Tem grant de UPDATE
-- em auth.users por padrão. A função NÃO precisa do service_role_key.
CREATE OR REPLACE FUNCTION public.sync_user_org_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Grava org_id como string (UUID serializado), formato esperado pelo
  -- frontend ao ler session.user.app_metadata.org_id.
  UPDATE auth.users
     SET raw_app_meta_data = jsonb_set(
           COALESCE(raw_app_meta_data, '{}'::jsonb),
           '{org_id}',
           to_jsonb(NEW.organization_id::text),
           true  -- create_if_missing
         )
   WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

-- Bloqueia chamada direta da função pelo frontend (anon/authenticated).
-- Triggers internos do PG executam independentemente desse REVOKE.
REVOKE ALL ON FUNCTION public.sync_user_org_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_user_org_metadata() FROM anon, authenticated;


-- ─── 2) Trigger AFTER INSERT em organization_users ─────────────────
-- Fired quando um usuário é vinculado pela primeira vez a uma org.
DROP TRIGGER IF EXISTS trg_sync_org_metadata_insert ON public.organization_users;

CREATE TRIGGER trg_sync_org_metadata_insert
  AFTER INSERT ON public.organization_users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_org_metadata();


-- ─── 3) Trigger AFTER UPDATE (caso usuário troque de org) ──────────
-- Restrito a UPDATEs que toquem organization_id E que de fato mudem
-- o valor (IS DISTINCT FROM trata NULL corretamente).
DROP TRIGGER IF EXISTS trg_sync_org_metadata_update ON public.organization_users;

CREATE TRIGGER trg_sync_org_metadata_update
  AFTER UPDATE OF organization_id ON public.organization_users
  FOR EACH ROW
  WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION public.sync_user_org_metadata();


-- ═══════════════════════════════════════════════════════════════════
-- BACKFILL — opcional, descomente após confirmar que está tudo OK
-- ═══════════════════════════════════════════════════════════════════
-- Aplica o sync nos usuários que JÁ estão em organization_users mas
-- cujo JWT ainda não tem org_id. O diagnose anterior mostrou 6 usuários
-- sem org_id, todos role='fornecedor' — esses NÃO estão em
-- organization_users (são externos), então o backfill é seguro: só
-- afeta quem já tem vínculo.
/*
UPDATE auth.users u
   SET raw_app_meta_data = jsonb_set(
         COALESCE(u.raw_app_meta_data, '{}'::jsonb),
         '{org_id}',
         to_jsonb(ou.organization_id::text),
         true
       )
  FROM public.organization_users ou
 WHERE ou.user_id = u.id
   AND (
        NOT (u.raw_app_meta_data ? 'org_id')
        OR (u.raw_app_meta_data ->> 'org_id') IS DISTINCT FROM ou.organization_id::text
   );
*/


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ═══════════════════════════════════════════════════════════════════

-- (a) Triggers criados?
SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  CASE WHEN tgtype::int & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
  CASE
    WHEN tgtype::int & 4  = 4  THEN 'INSERT'
    WHEN tgtype::int & 16 = 16 THEN 'UPDATE'
    WHEN tgtype::int & 8  = 8  THEN 'DELETE'
    ELSE 'OTHER'
  END AS event,
  tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.organization_users'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

-- (b) Estado atual: quantos têm/não têm org_id no JWT
SELECT
  COUNT(*) FILTER (WHERE raw_app_meta_data ? 'org_id') AS com_org_id,
  COUNT(*) FILTER (WHERE NOT (raw_app_meta_data ? 'org_id')) AS sem_org_id,
  COUNT(*) AS total_users
FROM auth.users;

-- (c) Coerência entre organization_users e raw_app_meta_data
-- Se aparecer alguma linha, é desalinhamento — provavelmente backfill
-- não foi rodado, ou houve UPDATE antes do trigger entrar em vigor.
SELECT
  u.id,
  u.email,
  u.raw_app_meta_data ->> 'org_id' AS jwt_org_id,
  ou.organization_id::text AS link_org_id
FROM auth.users u
JOIN public.organization_users ou ON ou.user_id = u.id
WHERE (u.raw_app_meta_data ->> 'org_id') IS DISTINCT FROM ou.organization_id::text
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════
-- COMO TESTAR (manualmente, em ambiente de homologação)
-- ═══════════════════════════════════════════════════════════════════
--
-- 1) Inserir um usuário fictício de teste em auth.users (use Auth UI
--    do Supabase Studio para criar via "Add user", senão você esbarra
--    em campos NOT NULL como encrypted_password). Anote o UUID gerado.
--
-- 2) Vincular esse usuário a uma org existente:
--      INSERT INTO public.organization_users (organization_id, user_id, role)
--      VALUES ('<uuid-da-org>', '<uuid-do-novo-user>', 'admin');
--
-- 3) Conferir que o trigger populou:
--      SELECT raw_app_meta_data
--      FROM auth.users
--      WHERE id = '<uuid-do-novo-user>';
--    → deve mostrar {"org_id": "<uuid-da-org>", ...}
--
-- 4) Fazer login com esse usuário (frontend) e rodar no console:
--      const { data } = await supabase.auth.getSession();
--      console.log(data.session.user.app_metadata.org_id);
--    → deve ser igual ao UUID da org. (Se o token foi emitido ANTES do
--      INSERT, precisa de await supabase.auth.refreshSession() ou logout.)
--
-- 5) No SQL Editor, simular a sessão do usuário e confirmar o helper:
--      SET LOCAL request.jwt.claim.app_metadata = '{"org_id":"<uuid>"}';
--      SELECT public.current_user_org_id();
--    → deve retornar o mesmo UUID.
--
-- 6) Limpar o teste:
--      DELETE FROM public.organization_users WHERE user_id = '<uuid>';
--    (o trigger NÃO limpa o app_metadata em DELETE — comportamento
--    intencional, ver nota abaixo).


-- ═══════════════════════════════════════════════════════════════════
-- NOTAS / DECISÕES
-- ═══════════════════════════════════════════════════════════════════
--
-- (a) Não há trigger AFTER DELETE: se uma linha de organization_users
--     é removida, o app_metadata.org_id do usuário fica apontando para
--     a org antiga. Optei por NÃO limpar porque:
--       - INV-04 diz que o usuário pertence a UMA org → se está sendo
--         removido de uma, o normal é estar sendo movido para outra,
--         o que dispara o INSERT da nova vinculação e o trigger
--         sobrescreve o org_id.
--       - Setar org_id=NULL bloquearia o usuário de tudo via RLS, o
--         que é um estado "limbo" raro de querer.
--     Se a regra mudar, basta adicionar um trigger AFTER DELETE que
--     faça jsonb_set com org_id=null OU '#-' para remover a chave.
--
-- (b) Não há AFTER UPDATE OF user_id: alterar o user_id de uma linha
--     em organization_users é, na prática, desfazer um vínculo e criar
--     outro. Se o caso aparecer, melhor fazer DELETE + INSERT.
--
-- (c) Por que to_jsonb(uuid::text) e não to_jsonb(uuid)? Porque
--     to_jsonb(uuid) gera uma string JSON também (JSONB não tem tipo
--     UUID nativo), mas explicitar ::text torna o resultado óbvio para
--     quem lê o código.
--
-- (d) Sobre Custom Access Token Hooks (alternativa moderna): no Pro
--     plan e self-hosted, dá pra usar um auth hook em vez de trigger
--     de tabela. É mais limpo (re-emite o JWT em todo refresh sem
--     depender de raw_app_meta_data persistido), mas requer
--     configuração extra. Mantemos o trigger por compatibilidade.
