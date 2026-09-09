-- Migration: Adicionar status 'aguardando_conformidade' (CORRIGIDA)
-- Descrição: Insere o novo status mantendo compatibilidade com registros legados.

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE public.documents ADD CONSTRAINT documents_status_check 
CHECK (status = ANY (ARRAY[
    'uploaded', 
    'processing_ocr', 
    'validating', 
    'validated', 
    'aguardando_conformidade', 
    'aguardando_comprovante', 
    'aguardando_conciliacao_bancaria', 
    'aguardando_d3', 
    'liberado_rpa_airtop', 
    'enviado_salic', 
    'concluido', 
    'erro_rpa', 
    'bloqueado_conformidade', 
    'revisao_manual', 
    'divergencia_valor', 
    'divergencia_beneficiario'
]));

COMMENT ON COLUMN public.documents.status IS 'Status do ciclo de vida do documento com suporte a conformidade IA e compatibilidade legada.';
