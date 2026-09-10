-- ==============================================================
-- migration_gate_aprovacao_fornecedor.sql
--
-- Gate de aprovação para NFs subidas pelo próprio fornecedor (portal
-- Solicitante). Nota que não passou pelo crivo do gestor pode vir com CNAE
-- incompatível com a rubrica, então precisa de decisão humana antes de seguir
-- para OCR → auditoria → SALIC.
--
-- O sinal do caminho do fornecedor é documents.fornecedor_id, gravado por
-- handleFornecedorUpload. Verificado em produção: 0 dos 193 documentos têm esse
-- campo preenchido, ou seja, nenhum legado a migrar e nenhum falso positivo.
--
-- POR QUE O GATE ESTÁ AQUI E NÃO SÓ NO n8n
-- --------------------------------------------------------------
-- O plano previa que o workflow de OCR do n8n passasse a gravar
-- 'aguardando_aprovacao_fornecedor' no lugar do status normal. Esse workflow
-- vive na instância externa (automacoes-n8n.infrassys.com) e não está
-- versionado neste repositório — não foi alterado.
--
-- Deixar o gate depender só do n8n significaria que qualquer outra escrita
-- (webhook reprocessando, correção manual, script) fura o gate em silêncio. O
-- trigger abaixo o torna incondicional: enquanto não houver aprovação humana
-- registrada, documento de fornecedor não sai do gate, venha a escrita de onde
-- vier. Ajustar o n8n continua sendo desejável para clareza, mas deixa de ser
-- o que sustenta a regra.
-- ==============================================================

-- ==============================================================
-- 1) STATUS NOVOS NA CONSTRAINT
-- ==============================================================
-- O nome da constraint é descoberto em vez de assumido: derrubar por nome
-- chutado falharia, e um CHECK de status remanescente rejeitaria os valores
-- novos sem explicação clara.
DO $$
DECLARE
    v_nome text;
BEGIN
    SELECT con.conname INTO v_nome
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'documents'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
    LIMIT 1;

    IF v_nome IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I', v_nome);
        RAISE NOTICE 'Constraint de status removida: %', v_nome;
    ELSE
        RAISE NOTICE 'Nenhuma CHECK de status encontrada — seguindo para criar a nova.';
    END IF;
END $$;

-- Os 17 valores já existentes (todos confirmados em uso ou válidos) + os 2 novos.
ALTER TABLE public.documents
  ADD CONSTRAINT documents_status_check
  CHECK (status = ANY (ARRAY[
    'uploaded','processing_ocr','validating','validated',
    'aguardando_conformidade','aguardando_comprovante',
    'aguardando_conciliacao_bancaria','aguardando_d3',
    'liberado_rpa_airtop','enviado_salic','concluido',
    'erro_rpa','bloqueado_conformidade','revisao_manual',
    'divergencia_valor','divergencia_beneficiario',
    'aguardando_rubrica',
    'aguardando_aprovacao_fornecedor',
    'rejeitado_fornecedor'
  ]));

-- ==============================================================
-- 2) COLUNAS DA DECISÃO
-- ==============================================================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS motivo_rejeicao_fornecedor text,
  ADD COLUMN IF NOT EXISTS aprovado_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz;

COMMENT ON COLUMN public.documents.motivo_rejeicao_fornecedor IS
  'Motivo da rejeição de uma NF subida pelo fornecedor. Exibido ao fornecedor no portal Solicitante para que ele reenvie um documento novo (não corrige o existente).';

COMMENT ON COLUMN public.documents.aprovado_por IS
  'Gestor/admin que liberou a NF do fornecedor para o fluxo normal.';

COMMENT ON COLUMN public.documents.aprovado_em IS
  'Quando a NF do fornecedor foi aprovada. Preenchido = gate já vencido; o trigger documents_gate_fornecedor deixa de interceptar as transições seguintes.';

CREATE INDEX IF NOT EXISTS idx_documents_aprovacao_fornecedor
  ON public.documents (project_id)
  WHERE status = 'aguardando_aprovacao_fornecedor';

-- ==============================================================
-- 3) O GATE
-- ==============================================================
-- BEFORE UPDATE: reescreve NEW.status antes da gravação, então nenhuma origem
-- de escrita consegue empurrar o documento adiante sem aprovação.
CREATE OR REPLACE FUNCTION public.trg_documents_gate_fornecedor()
RETURNS TRIGGER AS $$
DECLARE
    -- Etapas em que o documento ainda está sendo processado: sair de uma delas
    -- é justamente o momento de segurar.
    v_em_processamento CONSTANT TEXT[] := ARRAY['uploaded', 'processing_ocr', 'validating'];
BEGIN
    -- Só o caminho do fornecedor. Upload pelo M1 (gestor/analista/operador) não
    -- preenche fornecedor_id e passa reto.
    IF NEW.fornecedor_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Decisão humana já registrada: o documento segue o fluxo normal daqui em
    -- diante, sem nenhuma diferença.
    IF NEW.aprovado_em IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Sem aprovação registrada, um documento de fornecedor só pode estar em três
    -- lugares: em processamento, parado no gate, ou rejeitado. A regra é escrita
    -- como uma LISTA DE PERMITIDOS, não como interceptação de transições
    -- específicas: checar só a saída do processamento deixava o documento
    -- avançar depois de já estar no gate (bastava um UPDATE para 'aguardando_d3'),
    -- que é justamente onde o gate precisa segurar.

    -- Entrar no gate ou ser rejeitado: destinos legítimos.
    IF NEW.status IN ('aguardando_aprovacao_fornecedor', 'rejeitado_fornecedor') THEN
        RETURN NEW;
    END IF;

    -- Reprocessar (inclusive reenfileirar um rejeitado) continua permitido: o OCR
    -- roda normalmente, é dele que saem os dados que o gestor avalia.
    IF NEW.status = ANY (v_em_processamento) THEN
        RETURN NEW;
    END IF;

    -- Qualquer outro destino, venha de onde vier, volta para o gate.
    NEW.status := 'aguardando_aprovacao_fornecedor';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_gate_fornecedor ON public.documents;
CREATE TRIGGER documents_gate_fornecedor
BEFORE UPDATE OF status
ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.trg_documents_gate_fornecedor();

-- ==============================================================
-- 4) VERIFICAÇÃO
-- ==============================================================
-- Nenhum documento existente deve ser afetado: todos têm fornecedor_id NULL.
SELECT
    COUNT(*) FILTER (WHERE fornecedor_id IS NOT NULL) AS docs_de_fornecedor,
    COUNT(*) FILTER (WHERE status = 'aguardando_aprovacao_fornecedor') AS no_gate,
    COUNT(*) FILTER (WHERE status = 'rejeitado_fornecedor') AS rejeitados,
    COUNT(*) AS total
FROM public.documents;

-- Confere que a constraint aceita os dois status novos.
SELECT pg_get_constraintdef(con.oid) AS constraint_status
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public' AND rel.relname = 'documents'
  AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE '%status%';
