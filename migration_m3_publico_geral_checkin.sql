-- 1. Novo campo para distinguir a origem do convidado
ALTER TABLE public.distribution_guests
  ADD COLUMN IF NOT EXISTS tipo_entrada text;

-- Backfill dos registros existentes (todos eram OS ou PA)
UPDATE public.distribution_guests
SET tipo_entrada = CASE
    WHEN os_id IS NOT NULL THEN 'os'
    WHEN pa_id IS NOT NULL THEN 'pa'
    ELSE 'publico_geral'
END
WHERE tipo_entrada IS NULL;

ALTER TABLE public.distribution_guests
  ALTER COLUMN tipo_entrada SET NOT NULL,
  ALTER COLUMN tipo_entrada SET DEFAULT 'publico_geral';

-- 2. Persistência real de check-in (hoje não existe)
ALTER TABLE public.distribution_guests
  ADD COLUMN IF NOT EXISTS checkin_em timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_por uuid
    REFERENCES auth.users(id);

-- 3. Substituir a constraint antiga (exigia OS ou PA) por uma que
--    valida consistência com tipo_entrada, permitindo público geral
ALTER TABLE public.distribution_guests
  DROP CONSTRAINT IF EXISTS distribution_guests_check;

ALTER TABLE public.distribution_guests
  ADD CONSTRAINT distribution_guests_tipo_consistente CHECK (
    (tipo_entrada = 'os' AND os_id IS NOT NULL AND pa_id IS NULL)
    OR (tipo_entrada = 'pa' AND pa_id IS NOT NULL AND os_id IS NULL)
    OR (tipo_entrada = 'publico_geral' AND os_id IS NULL AND pa_id IS NULL)
  );

COMMENT ON COLUMN public.distribution_guests.tipo_entrada IS
  'os | pa | publico_geral — publico_geral representa ingresso vendido/pago, contador SEPARADO da cota de contrapartida (não consome ingressos_os/ingressos_pa de distribution_events).';
