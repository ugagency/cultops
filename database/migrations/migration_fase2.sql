-- ==============================================================
-- PRESTAÍ — MIGRATION FASE 2
-- Rode este arquivo no SQL Editor do Supabase (uma vez).
-- Todas as operações são idempotentes (IF NOT EXISTS / DO NOTHING).
-- ==============================================================


-- ──────────────────────────────────────────────────────────────
-- 1. TABELA: despesas
--    Adições de colunas que o Matchmaker e o Cron D-3 precisam
-- ──────────────────────────────────────────────────────────────

-- 1a. Nome do fornecedor (usado no fallback do Matchmaker)
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS fornecedor_nome TEXT;

-- 1b. Código de autenticação bancária extraído pelo OCR do comprovante
--     Ex: código de autenticação do PIX, TED, etc.
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS autenticacao_bancaria TEXT;

-- 1c. Status completo do ciclo de vida da despesa
--     Substitui/complementa o status_conformidade (que fica para conformidade fiscal)
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'aguardando_ocr'
    CHECK (status IN (
        'aguardando_ocr',                  -- doc enviado, OCR ainda não rodou
        'aguardando_conformidade',         -- OCR ok, Agente IA ainda não validou
        'bloqueado_conformidade',          -- Agente IA bloqueou (CNAE inválido, etc.)
        'aguardando_conciliacao_bancaria', -- Agente IA aprovou, aguarda extrato
        'aguardando_d3',                   -- Conciliado, aguardando carência de 72h
        'liberado_rpa_airtop',             -- Cron D-3 liberou para o RPA
        'enviado_salic',                   -- Airtop confirmou envio ao SALIC
        'erro_rpa',                        -- Airtop encontrou erro, requer revisão manual
        'concluido'                        -- Processo encerrado
    ));

-- 1d. Timestamps do ciclo de vida
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS data_conciliacao   TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS data_liberacao     TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS data_salic         TIMESTAMP WITH TIME ZONE;

-- 1e. Método de conciliação (para auditoria)
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS metodo_conciliacao TEXT
    CHECK (metodo_conciliacao IN ('autenticacao', 'valor_data_nome', NULL));

-- 1f. Protocolo SALIC (retornado pelo Airtop)
ALTER TABLE public.despesas
    ADD COLUMN IF NOT EXISTS protocolo_salic TEXT;


-- ──────────────────────────────────────────────────────────────
-- 2. TABELA: extratos_bancarios
--    Adições críticas para o Matchmaker funcionar
-- ──────────────────────────────────────────────────────────────

-- 2a. Código de autenticação bancária da linha do extrato
--     É a Regra de Ouro: match exato com autenticacao_bancaria de despesas
ALTER TABLE public.extratos_bancarios
    ADD COLUMN IF NOT EXISTS autenticacao TEXT;

-- 2b. Renomear data_transacao → convenção usada no matchmaker_n8n.js
--     O JS usa e.data — vamos adicionar coluna 'data' como alias calculado
--     (ou simplesmente atualizar o JS para usar data_transacao — recomendado)
--     OPÇÃO: adicionar coluna 'data' gerada para não quebrar o SQL existente:
ALTER TABLE public.extratos_bancarios
    ADD COLUMN IF NOT EXISTS data DATE
    GENERATED ALWAYS AS (data_transacao) STORED;

-- 2c. Tipo da transação (convenção de sinal do valor)
ALTER TABLE public.extratos_bancarios
    ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'debito'
    CHECK (tipo IN ('debito', 'credito', 'tarifa'));

-- 2d. Status de conciliação explícito (facilita queries no dashboard)
ALTER TABLE public.extratos_bancarios
    ADD COLUMN IF NOT EXISTS status_conciliacao TEXT DEFAULT 'pendente'
    CHECK (status_conciliacao IN ('pendente', 'conciliado', 'ignorado'));


-- ──────────────────────────────────────────────────────────────
-- 3. TABELA: catalogo_rubricas
--    Adicionar CNAEs permitidos para o Agente IA consultar via SQL
--    em vez de depender só do texto livre de 'especificacoes'
-- ──────────────────────────────────────────────────────────────

ALTER TABLE public.catalogo_rubricas
    ADD COLUMN IF NOT EXISTS cnaes_permitidos TEXT[] DEFAULT '{}';

ALTER TABLE public.catalogo_rubricas
    ADD COLUMN IF NOT EXISTS valor_maximo_percentual NUMERIC(5,2);

ALTER TABLE public.catalogo_rubricas
    ADD COLUMN IF NOT EXISTS exige_pessoa_juridica BOOLEAN DEFAULT true;

ALTER TABLE public.catalogo_rubricas
    ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Atualizar os exemplos já inseridos com CNAEs reais
UPDATE public.catalogo_rubricas
SET cnaes_permitidos = ARRAY['9001-9/01','9001-9/02','9001-9/03','9001-9/04','9001-9/05','9001-9/06']
WHERE nome = 'Cachê Artístico';

UPDATE public.catalogo_rubricas
SET cnaes_permitidos = ARRAY['6911-7/01','6911-7/02']
WHERE nome = 'Assessoria Jurídica';

UPDATE public.catalogo_rubricas
SET cnaes_permitidos = ARRAY['7490-1/04','7020-4/00']
WHERE nome = 'Coordenação Geral';

UPDATE public.catalogo_rubricas
SET cnaes_permitidos = ARRAY['7739-0/99','7731-4/00','7732-2/01','7732-2/02']
WHERE nome = 'Aluguel de Equipamentos';

UPDATE public.catalogo_rubricas
SET cnaes_permitidos = ARRAY['7319-0/02','7311-4/00','7312-2/00','7319-0/99']
WHERE nome = 'Divulgação e Marketing';


-- ──────────────────────────────────────────────────────────────
-- 4. TABELA: documents
--    Sincronizar o CHECK de status com os novos estados de despesas
-- ──────────────────────────────────────────────────────────────

-- O Postgres não suporta ALTER COLUMN ... DROP CONSTRAINT diretamente por nome
-- no Supabase sem saber o constraint name gerado. A abordagem segura é:
-- DROP + re-ADD do CHECK via uma coluna de staging. Mas para não quebrar dados
-- existentes, usamos um trigger de validação em vez de alterar o CHECK inline.

-- Alternativa mais segura: adicionar os valores faltantes via novo CHECK nomeado
-- Primeiro, descobrir o nome do constraint existente:
-- SELECT conname FROM pg_constraint WHERE conrelid = 'documents'::regclass AND contype = 'c';
-- Depois substituir. Por segurança, aqui fazemos via ALTER TABLE ADD CONSTRAINT IF NOT EXISTS:

DO $$
BEGIN
    -- Remove o CHECK antigo de status se existir (gerado sem nome explícito pelo Supabase)
    -- e recria com valores completos
    ALTER TABLE public.documents
        DROP CONSTRAINT IF EXISTS documents_status_check;

    ALTER TABLE public.documents
        ADD CONSTRAINT documents_status_check
        CHECK (status IN (
            'uploaded',
            'processing_ocr',
            'validating',
            'validated',
            'bloqueado_conformidade',
            'aguardando_conciliacao_bancaria',   -- NOVO
            'aguardando_d3',
            'liberado_rpa_airtop',               -- NOVO
            'enviado_salic',
            'erro_rpa',
            'concluido'
        ));
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Constraint de status em documents não pôde ser alterada: %', SQLERRM;
END $$;


-- ──────────────────────────────────────────────────────────────
-- 5. NOVA TABELA: audit_log
--    Log imutável de todas as mudanças de status — obrigatório
--    para prestação de contas ao MinC / auditorias da Rouanet
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabela          TEXT NOT NULL,         -- 'despesas' | 'documents' | etc.
    registro_id     UUID NOT NULL,         -- id do registro alterado
    campo           TEXT NOT NULL,         -- nome do campo alterado
    valor_anterior  TEXT,
    valor_novo      TEXT,
    alterado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    origem          TEXT,                  -- 'n8n_matchmaker' | 'n8n_cron_d3' | 'airtop' | 'usuario'
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- audit_log é INSERT-only: ninguém pode UPDATE ou DELETE
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Apenas leitura para donos do projeto"
ON audit_log FOR SELECT
USING (
    registro_id IN (
        SELECT d.id FROM despesas d
        JOIN projects p ON p.id = d.project_id
        WHERE p.user_id = auth.uid()
    )
);

-- INSERT é feito via função SECURITY DEFINER (abaixo) — não exposto diretamente
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;


-- Função helper para o n8n gravar no audit_log com service_role
CREATE OR REPLACE FUNCTION public.log_status_change(
    p_tabela        TEXT,
    p_registro_id   UUID,
    p_campo         TEXT,
    p_valor_anterior TEXT,
    p_valor_novo    TEXT,
    p_origem        TEXT DEFAULT 'n8n'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER  -- roda como postgres, burla RLS
AS $$
BEGIN
    INSERT INTO public.audit_log
        (tabela, registro_id, campo, valor_anterior, valor_novo, alterado_por, origem)
    VALUES
        (p_tabela, p_registro_id, p_campo, p_valor_anterior, p_valor_novo, auth.uid(), p_origem);
END;
$$;


-- Trigger automático para mudanças de status em despesas
CREATE OR REPLACE FUNCTION public.trg_despesas_status_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.audit_log
            (tabela, registro_id, campo, valor_anterior, valor_novo, alterado_por, origem)
        VALUES
            ('despesas', NEW.id, 'status', OLD.status, NEW.status, auth.uid(), 'trigger');
    END IF;
    -- Também loga mudança de status_conformidade
    IF OLD.status_conformidade IS DISTINCT FROM NEW.status_conformidade THEN
        INSERT INTO public.audit_log
            (tabela, registro_id, campo, valor_anterior, valor_novo, alterado_por, origem)
        VALUES
            ('despesas', NEW.id, 'status_conformidade', OLD.status_conformidade, NEW.status_conformidade, auth.uid(), 'trigger');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS despesas_status_audit ON public.despesas;
CREATE TRIGGER despesas_status_audit
    AFTER UPDATE ON public.despesas
    FOR EACH ROW EXECUTE FUNCTION public.trg_despesas_status_audit();


-- ──────────────────────────────────────────────────────────────
-- 6. ÍNDICES DE PERFORMANCE
--    Sem eles, as queries do Cron D-3 e do Matchmaker fazem
--    full-scan em tabelas que crescem com cada projeto
-- ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_despesas_status
    ON public.despesas (status);

CREATE INDEX IF NOT EXISTS idx_despesas_project_status
    ON public.despesas (project_id, status);

CREATE INDEX IF NOT EXISTS idx_despesas_extrato_vinculado
    ON public.despesas (extrato_vinculado_id)
    WHERE extrato_vinculado_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_despesas_autenticacao
    ON public.despesas (autenticacao_bancaria)
    WHERE autenticacao_bancaria IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_extratos_conciliado
    ON public.extratos_bancarios (conciliado_com_despesa_id)
    WHERE conciliado_com_despesa_id IS NULL;  -- partial index só para os pendentes

CREATE INDEX IF NOT EXISTS idx_extratos_autenticacao
    ON public.extratos_bancarios (autenticacao)
    WHERE autenticacao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_extratos_project_data
    ON public.extratos_bancarios (project_id, data_transacao);

CREATE INDEX IF NOT EXISTS idx_audit_log_registro
    ON public.audit_log (registro_id, created_at DESC);


-- ──────────────────────────────────────────────────────────────
-- 7. VIEW: vw_fila_d3
--    Usada diretamente pelo Cron D-3 no n8n —
--    substitui a query longa do arquivo cron_d3_queries.sql
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.vw_fila_d3 AS
SELECT
    d.id                        AS despesa_id,
    d.fornecedor_nome,
    d.cnpj_fornecedor,
    d.autenticacao_bancaria,
    d.valor,
    d.rubrica_id,
    d.project_id,
    doc.file_path               AS comprovante_url,
    doc.name                    AS nome_documento,
    e.id                        AS extrato_id,
    e.data_transacao            AS data_extrato,
    e.autenticacao              AS autenticacao_extrato,
    e.descricao                 AS descricao_extrato,
    ec.identifier               AS govbr_cpf,     -- credencial do gestor para o Airtop
    p.pronac
FROM public.despesas d
JOIN public.extratos_bancarios e   ON e.id = d.extrato_vinculado_id
JOIN public.documents doc          ON doc.id = d.document_id
JOIN public.projects p             ON p.id = d.project_id
LEFT JOIN public.external_credentials ec
    ON ec.user_id = p.user_id AND ec.service_name = 'salic'
WHERE
    d.status = 'aguardando_d3'
    AND e.data_transacao <= NOW() - INTERVAL '72 hours';

-- RLS na view: cada gestor só vê seus projetos
-- (a view herda as políticas das tabelas base no Supabase por padrão)


-- ──────────────────────────────────────────────────────────────
-- FIM DA MIGRATION
-- Verificação rápida: rode o SELECT abaixo para confirmar
-- ──────────────────────────────────────────────────────────────
/*
SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('despesas','extratos_bancarios','catalogo_rubricas','audit_log')
  AND column_name IN (
      'status','fornecedor_nome','autenticacao_bancaria',
      'data_conciliacao','metodo_conciliacao','data_liberacao',
      'data_salic','protocolo_salic',
      'autenticacao','data','tipo','status_conciliacao',
      'cnaes_permitidos','ativo'
  )
ORDER BY table_name, column_name;
*/
