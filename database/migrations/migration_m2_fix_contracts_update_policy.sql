-- contracts_update excluía 'admin' do has_any_role, deixando só 'gestor'/'analista'.
-- O soft-delete de contrato (UPDATE excluido_em) é bloqueado silenciosamente pelo
-- RLS para qualquer usuário 'admin' — a maioria das contas reais da organização —
-- sem erro nenhum retornado pelo Supabase client (0 linhas afetadas, sem exceção),
-- então o front mostra "Contrato excluído com sucesso" mesmo sem ter excluído nada.
-- physical_evidences_update já inclui 'admin' nesse mesmo tipo de policy — este
-- fix só alinha contracts_update ao mesmo padrão.
ALTER POLICY contracts_update ON public.contracts
  USING (organization_id = current_user_org_id() AND has_any_role('admin', 'gestor', 'analista'));
