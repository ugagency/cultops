-- =====================================================================================
-- #160: horario das mensagens automaticas de OCR parado sai em UTC
--
-- NAO APLICADA. Antes de aplicar, compare esta funcao com a de producao:
--     select pg_get_functiondef('public.revisar_ocr_travado'::regproc);
-- O corpo abaixo vem de migration_ocr_por_tipo_documento.sql (versao mais recente no repositorio);
-- se producao tiver sido alterada fora do repositorio, leve a diferenca para ca antes de aplicar.
--
-- Unica mudanca: to_char(now(), ...) passa a to_char(now() AT TIME ZONE 'America/Sao_Paulo', ...).
-- O servidor do Supabase roda em UTC; o texto gravado em just_erro e lido pelo usuario no Brasil.
-- Mensagens antigas ja gravadas no banco nao sao reescritas.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.revisar_ocr_travado()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE public.documents
    SET status = 'revisao_manual',
        just_erro = '[AUTO] OCR excedeu 5 minutos em processamento sem concluir — movido para revisão manual em '
                    || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.'
    WHERE status = 'processing_ocr'
      AND coalesce(tipo_documento, 'nf') IN ('nf', 'comprovante')
      AND updated_at < now() - interval '5 minutes';

    -- Planilha orçamentária tem esteira própria (uploadrubricas), síncrona.
    -- Se ficou presa, a tela de quem importou já mostrou o erro; aqui só fecha
    -- o status para o suporte enxergar e poder reimportar.
    UPDATE public.documents
    SET status = 'erro',
        just_erro = '[AUTO] Importação da planilha não concluiu em 15 minutos — verificar execução do uploadrubricas no n8n ('
                    || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ').'
    WHERE status = 'processing_ocr'
      AND tipo_documento = 'planilha_orcamentaria'
      AND updated_at < now() - interval '15 minutes';
END;
$function$;
