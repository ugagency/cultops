-- ==============================================================
-- MIGRATION: AUTO-CRIAÇÃO DE DESPESAS A PARTIR DE DOCUMENTS
-- ==============================================================
-- Quando documents.status entra em ('aguardando_conformidade',
-- 'aguardando_comprovante', 'aguardando_conciliacao_bancaria'), cria
-- automaticamente o registro em despesas (se ainda não existir).
--
-- Regras:
--  - Aceita documentos de topo: nf_vinculada_id IS NULL OU nf_vinculada_id = id
--    (cobre NFs e comprovantes "misto" auto-referenciados que carregam
--    NF + comprovante no mesmo arquivo).
--  - Match de documents.rubrica (TEXT) com rubricas em 3 estratégias:
--      a) nome igual (case-insensitive + trim)
--      b) nome igual depois de remover prefixo "NUMERO - " do texto do doc
--      c) match pelo código SALIC (rubricas.rubrica_id) extraído do prefixo
--  - Se rubrica não bate em nenhuma estratégia → documento vai para
--    'bloqueado_conformidade' e o gestor corrige via "Corrigir Vínculo".
--  - Valor obrigatório (vem do OCR).
--  - Status do doc é mapeado para status válido em despesas.
--  - Idempotente: ON CONFLICT (document_id) DO NOTHING.
--  - Delete já é tratado pelo FK ON DELETE CASCADE.
-- ==============================================================

-- Garante que a coluna rubrica_id (código SALIC, TEXT) existe em rubricas
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS rubrica_id TEXT;

-- ==============================================================
-- Helper: mapeia status do documento para status válido em despesas
-- ==============================================================
CREATE OR REPLACE FUNCTION public.map_document_status_to_despesa(p_status TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN CASE p_status
        WHEN 'aguardando_conformidade'         THEN 'aguardando_conformidade'
        WHEN 'aguardando_comprovante'          THEN 'aguardando_conformidade'
        WHEN 'aguardando_conciliacao_bancaria' THEN 'aguardando_conciliacao_bancaria'
        WHEN 'aguardando_d3'                   THEN 'aguardando_d3'
        WHEN 'liberado_rpa_airtop'             THEN 'liberado_rpa_airtop'
        WHEN 'enviado_salic'                   THEN 'enviado_salic'
        WHEN 'concluido'                       THEN 'concluido'
        WHEN 'erro_rpa'                        THEN 'erro_rpa'
        WHEN 'bloqueado_conformidade'          THEN 'bloqueado_conformidade'
        ELSE 'aguardando_conformidade'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ==============================================================
-- Helper: encontra rubrica_id (UUID) para um documento, tentando
-- múltiplas estratégias de match. Retorna NULL se nada bater.
-- ==============================================================
CREATE OR REPLACE FUNCTION public.find_rubrica_for_document(
    p_project_id UUID,
    p_rubrica_text TEXT
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_stripped TEXT;
    v_code TEXT;
BEGIN
    IF p_rubrica_text IS NULL OR btrim(p_rubrica_text) = '' THEN
        RETURN NULL;
    END IF;

    -- Estratégia (a): match exato (case-insensitive + trim)
    SELECT id INTO v_id
    FROM public.rubricas
    WHERE project_id = p_project_id
      AND lower(btrim(nome)) = lower(btrim(p_rubrica_text))
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    -- Estratégia (b): remove prefixo "NUMERO - " do texto e tenta de novo
    --   "147 - Passagens Aéreas..." → "Passagens Aéreas..."
    v_stripped := btrim(regexp_replace(p_rubrica_text, '^\s*\d+\s*[-–—]\s*', ''));
    IF v_stripped <> btrim(p_rubrica_text) THEN
        SELECT id INTO v_id
        FROM public.rubricas
        WHERE project_id = p_project_id
          AND lower(btrim(nome)) = lower(v_stripped)
        LIMIT 1;
        IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;

    -- Estratégia (c): match pelo código SALIC extraído do prefixo
    --   "147 - Passagens Aéreas..." → código '147' → casa com rubricas.rubrica_id
    v_code := substring(p_rubrica_text from '^\s*(\d+)\s*[-–—]');
    IF v_code IS NOT NULL THEN
        SELECT id INTO v_id
        FROM public.rubricas
        WHERE project_id = p_project_id
          AND rubrica_id IS NOT NULL
          AND btrim(rubrica_id) = v_code
        LIMIT 1;
        IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ==============================================================
-- Trigger function
-- ==============================================================
CREATE OR REPLACE FUNCTION public.trg_documents_cria_despesa()
RETURNS TRIGGER AS $$
DECLARE
    v_rubrica_id UUID;
    v_status_alvo CONSTANT TEXT[] := ARRAY[
        'aguardando_conformidade',
        'aguardando_comprovante',
        'aguardando_conciliacao_bancaria'
    ];
    v_novo_status_despesa TEXT;
BEGIN
    -- Em UPDATE, só faz algo se o status realmente mudou
    IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    v_novo_status_despesa := public.map_document_status_to_despesa(NEW.status);

    -- ============================================================
    -- CASO 1: já existe despesa para este documento
    -- → sincroniza o status da despesa com o do documento
    -- ============================================================
    IF EXISTS (SELECT 1 FROM public.despesas WHERE document_id = NEW.id) THEN
        UPDATE public.despesas
        SET status = v_novo_status_despesa
        WHERE document_id = NEW.id
          AND status IS DISTINCT FROM v_novo_status_despesa;
        RETURN NEW;
    END IF;

    -- ============================================================
    -- CASO 2: despesa ainda não existe — só cria se o status novo
    -- estiver nos status-alvo de criação
    -- ============================================================
    IF NOT (NEW.status = ANY (v_status_alvo)) THEN
        RETURN NEW;
    END IF;

    -- Documento de topo: NF normal OU comprovante "misto" auto-referenciado.
    -- Comprovantes filhos (apontando pra OUTRA NF) NÃO geram despesa.
    IF NEW.nf_vinculada_id IS NOT NULL AND NEW.nf_vinculada_id <> NEW.id THEN
        RETURN NEW;
    END IF;

    IF NEW.valor IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.rubrica IS NULL OR btrim(NEW.rubrica) = '' THEN
        IF NEW.status <> 'bloqueado_conformidade' THEN
            UPDATE public.documents
            SET status = 'bloqueado_conformidade',
                just_erro = COALESCE(just_erro, 'Rubrica não informada — selecione manualmente.')
            WHERE id = NEW.id;
        END IF;
        RETURN NEW;
    END IF;

    v_rubrica_id := public.find_rubrica_for_document(NEW.project_id, NEW.rubrica);

    IF v_rubrica_id IS NULL THEN
        IF NEW.status <> 'bloqueado_conformidade' THEN
            UPDATE public.documents
            SET status = 'bloqueado_conformidade',
                just_erro = COALESCE(just_erro,
                    'Rubrica "' || NEW.rubrica || '" não está cadastrada no projeto. Selecione a rubrica correta.')
            WHERE id = NEW.id;
        END IF;
        RETURN NEW;
    END IF;

    INSERT INTO public.despesas (
        document_id,
        rubrica_id,
        project_id,
        valor,
        cnpj_fornecedor,
        data_emissao,
        data_pagamento,
        status,
        organization_id
    ) VALUES (
        NEW.id,
        v_rubrica_id,
        NEW.project_id,
        NEW.valor,
        NEW.cnpj_emissor,
        NEW.data_emissao,
        NEW.data_pagamento,
        v_novo_status_despesa,
        NEW.organization_id
    )
    ON CONFLICT (document_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS documents_cria_despesa ON public.documents;
CREATE TRIGGER documents_cria_despesa
AFTER INSERT OR UPDATE OF status
ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.trg_documents_cria_despesa();

-- ==============================================================
-- BACKFILL
-- ==============================================================
-- (1) Sincroniza status de despesas EXISTENTES com o status do documento
UPDATE public.despesas dx
SET status = public.map_document_status_to_despesa(d.status)
FROM public.documents d
WHERE dx.document_id = d.id
  AND dx.status IS DISTINCT FROM public.map_document_status_to_despesa(d.status);

-- (2) Cria despesas para documentos-alvo que ainda não têm
INSERT INTO public.despesas (
    document_id,
    rubrica_id,
    project_id,
    valor,
    cnpj_fornecedor,
    data_emissao,
    data_pagamento,
    status,
    organization_id
)
SELECT
    d.id,
    public.find_rubrica_for_document(d.project_id, d.rubrica) AS rubrica_id,
    d.project_id,
    d.valor,
    d.cnpj_emissor,
    d.data_emissao,
    d.data_pagamento,
    public.map_document_status_to_despesa(d.status),
    d.organization_id
FROM public.documents d
WHERE d.status IN (
    'aguardando_conformidade',
    'aguardando_comprovante',
    'aguardando_conciliacao_bancaria',
    'aguardando_d3',
    'liberado_rpa_airtop',
    'enviado_salic',
    'concluido'
)
  AND (d.nf_vinculada_id IS NULL OR d.nf_vinculada_id = d.id)
  AND d.valor IS NOT NULL
  AND d.rubrica IS NOT NULL
  AND btrim(d.rubrica) <> ''
  AND public.find_rubrica_for_document(d.project_id, d.rubrica) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.despesas dx WHERE dx.document_id = d.id)
ON CONFLICT (document_id) DO NOTHING;

-- ==============================================================
-- DIAGNÓSTICO: descomente para ver o que ficou de fora e por quê.
-- ==============================================================
 SELECT
    d.id,
    d.name,
    d.status,
    d.tipo_documento,
    d.nf_vinculada_id,
    d.valor,
    d.rubrica,
    CASE
        WHEN d.nf_vinculada_id IS NOT NULL AND d.nf_vinculada_id <> d.id
        THEN 'comprovante filho de outra NF (nf_vinculada_id aponta pra outro doc)'
        WHEN d.valor IS NULL
            THEN 'valor NULL (OCR não completou)'
        WHEN d.rubrica IS NULL OR btrim(d.rubrica) = ''
            THEN 'rubrica vazia'
        WHEN public.find_rubrica_for_document(d.project_id, d.rubrica) IS NULL
            THEN 'rubrica "' || d.rubrica || '" não casou com nenhuma rubrica do projeto'
        ELSE 'OK (deveria ter sido inserida)'
    END AS motivo_pulado
FROM public.documents d
WHERE d.status IN (
    'aguardando_conformidade','aguardando_comprovante','aguardando_conciliacao_bancaria',
    'aguardando_d3','liberado_rpa_airtop','enviado_salic','concluido'
)
AND NOT EXISTS (SELECT 1 FROM public.despesas dx WHERE dx.document_id = d.id);
