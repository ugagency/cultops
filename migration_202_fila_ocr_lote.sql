-- #202: fila de OCR dos Documentos em Lote no servidor.
--
-- 1. documents.ocr_fila_em: o documento (ainda em aguardando_rubrica) foi colocado na fila de OCR
--    pelo POST /api/lote/processar. O cron /api/m1/cron-ocr-lote limpa o campo ao enviar o
--    documento ao n8n (status passa para processing_ocr no mesmo update).
-- 2. Job pg_cron "ocr-lote-fila", a cada minuto, chamando /api/m1/cron-ocr-lote.
--    O comando é copiado do job "conciliacao-lote-auto" trocando só a rota, para o x-cron-secret
--    não ficar escrito neste arquivo (nem no git). Se aquele job não existir, a migration para
--    com erro e nada é alterado.
--
-- Aplicar ANTES de publicar o código do #202? Não é obrigatório: sem a coluna, o servidor responde
-- FILA_INDISPONIVEL e o navegador volta ao envio antigo (um por vez, com a aba aberta). Depois de
-- aplicar, o lote passa a usar a fila sozinho.
--
-- Reverter:
--   select cron.unschedule('ocr-lote-fila');
--   alter table public.documents drop column if exists ocr_fila_em;
-- (antes de remover a coluna, documentos com ocr_fila_em preenchido voltam a ser só fila do lote:
--  o usuário clica em Processar de novo.)

begin;

alter table public.documents add column if not exists ocr_fila_em timestamptz;

comment on column public.documents.ocr_fila_em is
    '#202: quando o documento entrou na fila de OCR do lote (servidor). Limpo ao ser enviado ao n8n.';

create index if not exists idx_documents_ocr_fila_em
    on public.documents (ocr_fila_em)
    where ocr_fila_em is not null;

do $$
declare
    v_cmd text;
begin
    select replace(command, '/api/m1/cron-conciliacao-lote', '/api/m1/cron-ocr-lote')
      into v_cmd
      from cron.job
     where jobname = 'conciliacao-lote-auto';

    if v_cmd is null or position('/api/m1/cron-ocr-lote' in v_cmd) = 0 then
        raise exception 'Job conciliacao-lote-auto não encontrado ou sem a rota esperada. Crie o job ocr-lote-fila à mão.';
    end if;

    if exists (select 1 from cron.job where jobname = 'ocr-lote-fila') then
        perform cron.unschedule('ocr-lote-fila');
    end if;

    perform cron.schedule('ocr-lote-fila', '* * * * *', v_cmd);
end $$;

commit;

-- Conferência:
--   select jobname, schedule, active from cron.job where jobname = 'ocr-lote-fila';
--   select acao, ok, http_status, duracao_ms, criado_em from processamento_eventos
--    where acao = 'ocr_lote' order by criado_em desc limit 20;
