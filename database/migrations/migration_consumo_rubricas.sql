-- ==============================================================
-- MIGRATION: CONSUMO DE RUBRICAS
-- Atualiza rubricas.valor_utilizado a partir de despesas com status >= aguardando_d3
-- Critério: SUM(despesas.valor) WHERE status IN
--          ('aguardando_d3','liberado_rpa_airtop','enviado_salic','concluido')
-- Despesas em status anteriores (aguardando_conformidade, aguardando_comprovante,
-- aguardando_conciliacao_bancaria) NÃO consomem saldo — só existem como pendência.
-- ==============================================================

-- Função que recalcula valor_utilizado de uma rubrica específica
CREATE OR REPLACE FUNCTION public.recalc_rubrica_valor_utilizado(p_rubrica_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.rubricas r
    SET valor_utilizado = COALESCE((
        SELECT SUM(d.valor)
        FROM public.despesas d
        WHERE d.rubrica_id = p_rubrica_id
          AND d.status IN ('aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido')
    ), 0)
    WHERE r.id = p_rubrica_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger function: dispara recálculo nas rubricas afetadas
CREATE OR REPLACE FUNCTION public.trg_despesas_atualiza_consumo()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalc_rubrica_valor_utilizado(OLD.rubrica_id);
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.rubrica_id IS DISTINCT FROM NEW.rubrica_id THEN
        PERFORM public.recalc_rubrica_valor_utilizado(OLD.rubrica_id);
    END IF;

    PERFORM public.recalc_rubrica_valor_utilizado(NEW.rubrica_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS despesas_atualiza_consumo ON public.despesas;
CREATE TRIGGER despesas_atualiza_consumo
AFTER INSERT OR UPDATE OF valor, status, rubrica_id OR DELETE
ON public.despesas
FOR EACH ROW EXECUTE FUNCTION public.trg_despesas_atualiza_consumo();

-- Backfill: recalcula todas as rubricas existentes uma única vez
UPDATE public.rubricas r
SET valor_utilizado = COALESCE(sub.total, 0)
FROM (
    SELECT rubrica_id, SUM(valor) AS total
    FROM public.despesas
    WHERE status IN ('aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido')
    GROUP BY rubrica_id
) sub
WHERE r.id = sub.rubrica_id;

-- Zera rubricas que não têm nenhuma despesa em status que consome saldo
UPDATE public.rubricas
SET valor_utilizado = 0
WHERE id NOT IN (
    SELECT DISTINCT rubrica_id FROM public.despesas
    WHERE status IN ('aguardando_d3', 'liberado_rpa_airtop', 'enviado_salic', 'concluido')
);
