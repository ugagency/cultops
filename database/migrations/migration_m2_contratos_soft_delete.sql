ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid
    REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_contracts_excluido_em
  ON public.contracts(excluido_em);

COMMENT ON COLUMN public.contracts.excluido_em IS
  'Soft delete — quando preenchido, o contrato não deve aparecer em nenhuma listagem/relatório/export. NULL = contrato ativo (não excluído). Distinto de status=cancelado, que é estado de negócio, não exclusão.';
