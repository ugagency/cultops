-- SPEC-SUPORTE-02, item 4 — status dos crons/RPA. cron.job_run_details vive
-- fora do schema public; o client do Supabase não alcança direto, daí essa
-- função-ponte (SECURITY DEFINER, grant só pra service_role).

CREATE OR REPLACE FUNCTION public.suporte_status_crons()
RETURNS TABLE(jobname text, ultima_execucao timestamptz, status text, proxima_estimada text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog, cron
AS $$
    SELECT j.jobname, jrd.start_time, jrd.status, j.schedule
    FROM cron.job j
    LEFT JOIN LATERAL (
        SELECT start_time, status FROM cron.job_run_details
        WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1
    ) jrd ON true
    ORDER BY j.jobname;
$$;

GRANT EXECUTE ON FUNCTION public.suporte_status_crons() TO service_role;
