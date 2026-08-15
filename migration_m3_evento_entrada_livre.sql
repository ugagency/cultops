-- ==============================================================
-- migration_m3_evento_entrada_livre.sql
--
-- Eventos sem sistema de ingresso (pedido do ZR): museus e ações sociais não
-- vendem nem distribuem ingresso — contam quem efetivamente entrou.
--
--   tipo_acesso = 'ingresso' (DEFAULT) → comportamento ATUAL, sem nenhuma
--       mudança: total/OS/PA obrigatórios, validação de soma, alocação prévia.
--   tipo_acesso = 'livre' → sem total_ingressos, sem ingressos_os, sem
--       ingressos_pa. A contagem vem do check-in real, por
--       distribution_guests.checkin_em + tipo_entrada, que já existem.
--
-- Todo evento já cadastrado recebe 'ingresso' pelo DEFAULT: zero regressão.
--
-- NOT NULL — CONFERIDO, NÃO ASSUMIDO
-- --------------------------------------------------------------
-- A spec OpenAPI do PostgREST lista as colunas obrigatórias de
-- distribution_events, e total_ingressos, ingressos_os e ingressos_pa estão
-- entre elas. São NOT NULL no banco mesmo, não só validação de frontend — sem
-- os DROP NOT NULL abaixo, salvar um evento livre falharia na gravação.
-- ==============================================================

-- ==============================================================
-- 1) TIPO DE ACESSO
-- ==============================================================
ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS tipo_acesso text DEFAULT 'ingresso';

-- Constraint separada do ADD COLUMN para a migration poder ser reaplicada sem
-- erro de constraint duplicada.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'distribution_events_tipo_acesso_check'
          AND conrelid = 'public.distribution_events'::regclass
    ) THEN
        ALTER TABLE public.distribution_events
          ADD CONSTRAINT distribution_events_tipo_acesso_check
          CHECK (tipo_acesso IN ('ingresso', 'livre'));
    END IF;
END $$;

-- Linhas anteriores ao DEFAULT (se houver) não podem ficar com NULL, senão
-- caem fora dos dois caminhos do frontend.
UPDATE public.distribution_events
SET tipo_acesso = 'ingresso'
WHERE tipo_acesso IS NULL;

ALTER TABLE public.distribution_events
  ALTER COLUMN tipo_acesso SET NOT NULL;

COMMENT ON COLUMN public.distribution_events.tipo_acesso IS
  'ingresso = evento com alocação prévia de ingressos (padrão, comportamento histórico). livre = sem ingresso; o público é contado pelo check-in real em distribution_guests (checkin_em + tipo_entrada).';

-- ==============================================================
-- 2) OS CAMPOS DE INGRESSO PASSAM A ACEITAR NULL
-- ==============================================================
-- Evento livre grava NULL nos três. As colunas continuam na tabela e seguem
-- obrigatórias na aplicação quando tipo_acesso = 'ingresso'.
ALTER TABLE public.distribution_events
  ALTER COLUMN total_ingressos DROP NOT NULL,
  ALTER COLUMN ingressos_os    DROP NOT NULL,
  ALTER COLUMN ingressos_pa    DROP NOT NULL;

-- ==============================================================
-- 3) ÍNDICE PARA A CONTAGEM DE CHECK-IN
-- ==============================================================
-- Em evento livre, toda tela que antes lia um número pré-alocado passa a contar
-- distribution_guests por evento + tipo_entrada, filtrando quem de fato entrou.
CREATE INDEX IF NOT EXISTS idx_guests_checkin_por_evento
  ON public.distribution_guests (event_id, tipo_entrada)
  WHERE checkin_em IS NOT NULL;

-- ==============================================================
-- VERIFICAÇÃO
-- ==============================================================
-- Esperado: todos os eventos existentes com tipo_acesso = 'ingresso'.
SELECT tipo_acesso, COUNT(*) AS eventos
FROM public.distribution_events
GROUP BY tipo_acesso
ORDER BY tipo_acesso;

-- Esperado: is_nullable = YES nas três colunas de ingresso.
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'distribution_events'
  AND column_name IN ('tipo_acesso', 'total_ingressos', 'ingressos_os', 'ingressos_pa')
ORDER BY column_name;
