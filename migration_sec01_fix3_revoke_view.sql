-- ==============================================================
-- migration_sec01_fix3_revoke_view.sql
--
-- SPEC-SEC-01 — Fix 3. NÃO RODAR ainda.
--
-- Só aplicar depois de confirmar em produção que:
--   1. migration_sec01_fix1_has_external_credential.sql já está aplicada
--   2. O deploy do app.js (Fix 1 frontend) e dos três workers RPA
--      (server.js raiz, cultops-rpa-worker/server.js,
--      cultops-rpa-worker-m2/server.js — Fix 2, middleware de autenticação)
--      já está em produção, funcionando
--   3. Um envio real ao SALIC funcionou de ponta a ponta (usuário com
--      credencial cadastrada, botão de envio, sem erro)
--
-- Aplicar isto ANTES de confirmar os passos acima quebra o envio ao SALIC
-- imediatamente — os workers hoje ainda leem a view direto para pegar
-- usuário/senha antes de logar no robô.
-- ==============================================================

REVOKE ALL ON public.decrypted_external_credentials FROM anon, authenticated;

-- ==============================================================
-- VERIFICAÇÃO (rodar em produção após aplicar)
-- ==============================================================

-- Esperado: ERRO de permissão ("permission denied for view..."), não uma
-- lista vazia — lista vazia significaria que ainda existe SELECT concedido
-- e a query só não bateu com nada, o que não é a mesma garantia.
SET ROLE anon;
SELECT count(*) FROM public.decrypted_external_credentials;
RESET ROLE;

-- A tabela base segue igual (RLS habilitada, zero policies) — confirma que
-- este REVOKE não afetou nada além da view.
SET ROLE anon;
SELECT count(*) FROM public.external_credentials; -- esperado: 0
RESET ROLE;
