-- Reprocessamento de OCR por tipo de documento (crons).
--
-- Problema confirmado em produção (08/10/2026): os dois crons de OCR travado
-- tratavam qualquer documento em processing_ocr como nota fiscal.
--   * A importação de planilha orçamentária no M1 nunca fechava o status do
--     documento (ficava em processing_ocr). Resultado: as 27 planilhas do banco
--     estão em revisao_manual com "[AUTO] OCR excedeu 5 minutos", e 8 delas
--     foram reenviadas por retry_ocr_stuck_documents() ao webhook de OCR de NF
--     (cultops-ocr), que não é a esteira delas (uploadrubricas).
--   * O reenvio do cron mandava o payload mínimo, sem fornecedor: true
--     (upload do fornecedor) e sem tipo_vinculo/lastro (comprovante), que o
--     front envia no disparo original.
--
-- Correção:
--   1. Os dois crons só atuam em NF/comprovante/legado (tipo nulo).
--   2. retry_ocr_stuck_documents() monta o mesmo payload que o front envia.
--   3. Planilha que ficar em processing_ocr por mais de 15 minutos vai para
--      'erro' com motivo próprio (a importação é síncrona e não é reenviada
--      automaticamente: reimportar cria nova versão de rubricas).
--
-- Não altera os 27 registros existentes: não há vínculo confiável entre
-- documento e versão de rubricas (rubricas_versions.file_path não bate com
-- documents.file_path) para saber quais importações deram certo.

CREATE OR REPLACE FUNCTION public.retry_ocr_stuck_documents()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  doc RECORD;
  nf RECORD;
  payload jsonb;
BEGIN
  FOR doc IN
    SELECT id, file_path, user_id, tipo_documento, fornecedor_id, nf_vinculada_id
    FROM documents
    WHERE status = 'processing_ocr'
      AND coalesce(tipo_documento, 'nf') IN ('nf', 'comprovante')
      AND updated_at < NOW() - INTERVAL '5 minutes'
      AND ocr_retry_count < 3
    ORDER BY updated_at ASC
    LIMIT 5
  LOOP
    UPDATE documents
    SET ocr_retry_count = ocr_retry_count + 1,
        updated_at = NOW()
    WHERE id = doc.id;

    payload := jsonb_build_object(
      'document_id', doc.id,
      'file_path', doc.file_path,
      'user_id', doc.user_id,
      'bucket', 'documentos'
    );

    IF doc.fornecedor_id IS NOT NULL THEN
      payload := payload || jsonb_build_object('fornecedor', true);
    END IF;

    IF doc.tipo_documento = 'comprovante' AND doc.nf_vinculada_id IS NOT NULL THEN
      SELECT id, name, valor, cnpj_emissor INTO nf FROM documents WHERE id = doc.nf_vinculada_id;
      payload := payload || jsonb_build_object(
        'tipo_vinculo', 'comprovante',
        'lastro', jsonb_build_object(
          'id', doc.nf_vinculada_id,
          'nome', coalesce(nf.name, ''),
          'valor', coalesce(nf.valor, 0),
          'cnpj', coalesce(nf.cnpj_emissor, '')
        )
      );
    END IF;

    PERFORM net.http_post(
      url := 'https://automacoes-n8n.infrassys.com/webhook/cultops-ocr',
      body := payload,
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END LOOP;

  UPDATE documents
  SET status = 'revisao_manual',
      justification = 'Documento falhou 3 vezes no OCR. Revisão manual necessária.',
      just_erro = 'ocr_max_retries_exceeded'
  WHERE status = 'processing_ocr'
    AND coalesce(tipo_documento, 'nf') IN ('nf', 'comprovante')
    AND updated_at < NOW() - INTERVAL '5 minutes'
    AND ocr_retry_count >= 3;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revisar_ocr_travado()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE public.documents
    SET status = 'revisao_manual',
        just_erro = '[AUTO] OCR excedeu 5 minutos em processamento sem concluir — movido para revisão manual em '
                    || to_char(now(), 'DD/MM/YYYY HH24:MI') || '.'
    WHERE status = 'processing_ocr'
      AND coalesce(tipo_documento, 'nf') IN ('nf', 'comprovante')
      AND updated_at < now() - interval '5 minutes';

    -- Planilha orçamentária tem esteira própria (uploadrubricas), síncrona.
    -- Se ficou presa, a tela de quem importou já mostrou o erro; aqui só fecha
    -- o status para o suporte enxergar e poder reimportar.
    UPDATE public.documents
    SET status = 'erro',
        just_erro = '[AUTO] Importação da planilha não concluiu em 15 minutos — verificar execução do uploadrubricas no n8n ('
                    || to_char(now(), 'DD/MM/YYYY HH24:MI') || ').'
    WHERE status = 'processing_ocr'
      AND tipo_documento = 'planilha_orcamentaria'
      AND updated_at < now() - interval '15 minutes';
END;
$function$;
