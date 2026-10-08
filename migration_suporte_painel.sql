-- SPEC-SUPORTE-03 — Painel de suporte: motivo na auditoria, tempo de status
-- dos extratos e registro de chamadas externas.
--
-- NÃO APLICADA. Depende de aplicação manual no projeto ucmahpyxjxqbrvnistrh.
-- Todos os comandos são aditivos e idempotentes (IF NOT EXISTS / OR REPLACE).
-- Schema conferido em 08/10/2026: audit_log.registro_id é uuid NOT NULL;
-- extratos não tem created_at nem updated_at.

-- a) audit_log: motivo informado pelo suporte (mínimo de 10 caracteres é
--    validado no servidor, não no banco: linhas antigas ficam nulas).
ALTER TABLE public.audit_log
    ADD COLUMN IF NOT EXISTS motivo text;

-- b) extratos: created_at / updated_at.
--    Linhas antigas ficam NULAS de propósito (não há como saber a data real):
--    o painel mostra "tempo desconhecido" para elas. Adicionar a coluna com
--    DEFAULT now() preencheria as 231 linhas existentes com a data de hoje e
--    esconderia extratos pendentes antigos; por isso o default entra DEPOIS.
ALTER TABLE public.extratos
    ADD COLUMN IF NOT EXISTS created_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE public.extratos
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.extratos_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_extratos_updated_at ON public.extratos;
CREATE TRIGGER trg_extratos_updated_at
    BEFORE UPDATE ON public.extratos
    FOR EACH ROW EXECUTE FUNCTION public.extratos_set_updated_at();

-- c) processamento_eventos: cada chamada externa feita pelas ações do suporte.
--    registro_id uuid, o mesmo tipo de audit_log.registro_id.
--    RLS ligado e NENHUMA policy: só a service role (servidor) acessa.
CREATE TABLE IF NOT EXISTS public.processamento_eventos (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    criado_em   timestamptz NOT NULL DEFAULT now(),
    entidade    text,
    registro_id uuid,
    acao        text,
    destino     text,
    origem      text,
    usuario_id  uuid,
    motivo      text,
    ok          boolean,
    http_status int,
    duracao_ms  int,
    detalhe     text
);

ALTER TABLE public.processamento_eventos ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_processamento_eventos_registro
    ON public.processamento_eventos (registro_id);
CREATE INDEX IF NOT EXISTS idx_processamento_eventos_criado_em
    ON public.processamento_eventos (criado_em DESC);
