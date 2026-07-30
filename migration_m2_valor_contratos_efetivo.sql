-- ═══════════════════════════════════════════════════════════════════
-- migration_m2_valor_contratos_efetivo.sql
--
-- KPI de valor de contratos em financeiro.html precisa considerar
-- que um contrato pai "guarda-chuva" pode ter valor_total = 0 com o
-- valor real distribuído entre seus anexos (contrato_pai_id).
--
-- Regra: contrato sem filhos soma o próprio valor_total; contrato
-- com filhos soma o valor_total dos filhos (nunca os dois).
-- Agrupado por status para alimentar o dashboard financeiro.
--
-- Idempotente — pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_valor_contratos_efetivo(p_project_id uuid)
RETURNS TABLE (status text, valor_efetivo numeric) AS $$
  SELECT
    c.status,
    COALESCE(
      SUM(
        CASE
          WHEN filhos.total_filhos > 0 THEN filhos.soma_filhos
          ELSE c.valor_total
        END
      ), 0
    ) as valor_efetivo
  FROM public.contracts c
  LEFT JOIN LATERAL (
    SELECT COUNT(*) as total_filhos,
           COALESCE(SUM(f.valor_total), 0) as soma_filhos
    FROM public.contracts f
    WHERE f.contrato_pai_id = c.id
  ) filhos ON true
  WHERE c.project_id = p_project_id
    AND c.contrato_pai_id IS NULL
  GROUP BY c.status;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── VERIFICAÇÃO FINAL ─────────────────────────────────────────────
SELECT proname FROM pg_proc WHERE proname = 'get_valor_contratos_efetivo';
