-- ═══════════════════════════════════════════════════════════════════
-- migration_m2_aditivo_tipos.sql
--
-- Estende dois CHECK constraints do M2 para suportar os tipos de
-- aditivo completos exigidos pela UI de contratos:
--   1) contract_aditivos.tipo passa a aceitar 'objeto' e 'rescisao'
--      além dos valores já existentes ('prazo','valor','supressao','outros').
--   2) contracts.status passa a aceitar 'rescindido' além dos valores
--      já existentes ('ativo','encerrado','suspenso','cancelado').
--
-- Sem esta migration, INSERTs em contract_aditivos com tipo='objeto'
-- ou tipo='rescisao' falham com:
--   ERROR: new row for relation "contract_aditivos" violates check constraint
--
-- E o UPDATE contracts SET status='rescindido' (disparado ao salvar
-- um aditivo de rescisão) falha com erro análogo.
--
-- Idempotente — pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════


-- ─── DIAGNÓSTICO (opcional — descomente para ver o CHECK atual) ────
-- SELECT con.conname, pg_get_constraintdef(con.oid)
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- WHERE rel.relname IN ('contract_aditivos','contracts')
--   AND con.contype = 'c'
-- ORDER BY rel.relname, con.conname;


-- ─── 1) contract_aditivos.tipo ─────────────────────────────────────
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'contract_aditivos'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%tipo%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contract_aditivos DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.contract_aditivos
  ADD CONSTRAINT contract_aditivos_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'prazo'::text,
    'valor'::text,
    'objeto'::text,
    'supressao'::text,
    'rescisao'::text,
    'outros'::text
  ]));


-- ─── 2) contracts.status ───────────────────────────────────────────
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'contracts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contracts DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status = ANY (ARRAY[
    'ativo'::text,
    'encerrado'::text,
    'suspenso'::text,
    'cancelado'::text,
    'rescindido'::text
  ]));


-- ─── VERIFICAÇÃO FINAL ─────────────────────────────────────────────
SELECT rel.relname AS tabela, con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definicao
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname IN ('contract_aditivos','contracts')
  AND con.contype = 'c'
ORDER BY rel.relname, con.conname;
