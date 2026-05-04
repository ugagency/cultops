-- Adiciona o status 'aguardando_rubrica' ao CHECK constraint da tabela documents.
-- Usado pela tela de Upload em lote: documentos sobem para o Storage e ficam
-- aguardando o usuario escolher manualmente a rubrica antes de seguir o fluxo
-- normal (processing_ocr -> ...).
--
-- Trigger trg_documents_cria_despesa nao cria despesa para este status pois
-- 'aguardando_rubrica' nao esta em v_status_alvo. map_document_status_to_despesa
-- tem ELSE default, entao nao quebra.

ALTER TABLE public.documents DROP CONSTRAINT documents_status_check;

ALTER TABLE public.documents ADD CONSTRAINT documents_status_check
  CHECK (status = ANY (ARRAY[
    'uploaded'::text,
    'processing_ocr'::text,
    'validating'::text,
    'validated'::text,
    'aguardando_conformidade'::text,
    'aguardando_comprovante'::text,
    'aguardando_conciliacao_bancaria'::text,
    'aguardando_d3'::text,
    'liberado_rpa_airtop'::text,
    'enviado_salic'::text,
    'concluido'::text,
    'erro_rpa'::text,
    'bloqueado_conformidade'::text,
    'revisao_manual'::text,
    'divergencia_valor'::text,
    'divergencia_beneficiario'::text,
    'aguardando_rubrica'::text
  ]));
