-- ============================================================================
-- Migration: Cron "OCR travado" — após 5 min em processing_ocr, move para
-- revisao_manual automaticamente.
--
-- Contexto: varios pontos do app.js setam documents.status = 'processing_ocr'
-- sem tocar em updated_at, e a tabela nao tem trigger nenhum mantendo essa
-- coluna atualizada. Sem isso o cron nao teria como saber ha quanto tempo
-- o documento esta parado em processamento. Por isso o passo 1 abaixo cria
-- um trigger generico que mantem updated_at sempre fiel a ultima alteracao.
-- ============================================================================

-- 1) Mantém updated_at sempre atualizado em qualquer UPDATE na tabela
CREATE OR REPLACE FUNCTION public.set_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON public.documents;
CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.set_documents_updated_at();

-- 2) Índice parcial para o cron encontrar rápido os docs travados
CREATE INDEX IF NOT EXISTS idx_documents_status_updated_at
    ON public.documents (updated_at)
    WHERE status = 'processing_ocr';

-- 3) Função que flipa para revisao_manual os documentos travados há +5min
CREATE OR REPLACE FUNCTION public.revisar_ocr_travado()
RETURNS void AS $$
BEGIN
    UPDATE public.documents
    SET status = 'revisao_manual',
        just_erro = '[AUTO] OCR excedeu 5 minutos em processamento sem concluir — movido para revisão manual em '
                    || to_char(now(), 'DD/MM/YYYY HH24:MI') || '.'
    WHERE status = 'processing_ocr'
      AND updated_at < now() - interval '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- 4) Agenda a execução a cada minuto via pg_cron
--    (se a linha abaixo falhar por permissão, habilite a extensão "pg_cron"
--    pelo Dashboard do Supabase em Database > Extensions e rode de novo)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'revisao-ocr-travado') THEN
        PERFORM cron.unschedule('revisao-ocr-travado');
    END IF;
END $$;

SELECT cron.schedule(
    'revisao-ocr-travado',
    '* * * * *',                              -- a cada minuto
    $$ SELECT public.revisar_ocr_travado(); $$
);

-- Verificação manual (rodar depois para conferir se o job foi criado):
-- SELECT * FROM cron.job WHERE jobname = 'revisao-ocr-travado';
