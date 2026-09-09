-- ==============================================================
-- migration_sec01_fix1_has_external_credential.sql
--
-- SPEC-SEC-01 — Fix 1. Achados B e C: a view
-- public.decrypted_external_credentials é SECURITY DEFINER com SELECT
-- concedido a anon e authenticated. Testado em produção com SET ROLE anon:
-- 7 credenciais do serviço 'salic' retornadas com senha em texto claro, sem
-- login nenhum. app.js consultava essa view direto só para checar "o usuário
-- tem credencial cadastrada?" — a senha nunca era usada no front, só existia.
--
-- Esta função resolve a mesma pergunta (existe/não existe) sem nunca tocar
-- na view descriptografada — lê a TABELA BASE (public.external_credentials),
-- que já tem RLS habilitada e zero policies (deny-all por padrão, confirmado
-- com SET ROLE anon retornando 0 linhas). SECURITY DEFINER aqui é seguro
-- porque o filtro é user_id = auth.uid() — nunca vaza linha de outro usuário.
--
-- SEGURO DE APLICAR AGORA (Fix 1 e Fix 2 no mesmo deploy). NÃO revoga acesso
-- à view — isso é o Fix 3, separado, só depois de validar em produção.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.has_external_credential(p_service_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.external_credentials
    WHERE user_id = auth.uid()
    AND service_name = p_service_name
  );
$$;

REVOKE ALL ON FUNCTION public.has_external_credential(text) FROM public;
GRANT EXECUTE ON FUNCTION public.has_external_credential(text) TO anon, authenticated;

-- ==============================================================
-- VERIFICAÇÃO (rodar em produção após aplicar)
-- ==============================================================

-- 1. Sem sessão (anon) deve retornar false, nunca erro nem dado de outro
--    usuário. auth.uid() é NULL fora de sessão autenticada, então a condição
--    user_id = NULL nunca bate com nada.
SET ROLE anon;
SELECT public.has_external_credential('salic'); -- esperado: false
RESET ROLE;

-- 2. Confirma que a tabela base segue protegida (não deveria ter mudado nada
--    aqui — só criamos uma função nova, não tocamos em RLS/policies).
SET ROLE anon;
SELECT count(*) FROM public.external_credentials; -- esperado: 0
RESET ROLE;

-- 3. Com uma sessão autenticada de um usuário que TEM credencial SALIC
--    cadastrada, has_external_credential('salic') deve retornar true — testar
--    via app.js (botão de envio) ou via SQL editor do Supabase autenticado
--    como esse usuário (auth.uid() só resolve dentro de uma sessão real).
