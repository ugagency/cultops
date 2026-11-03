-- #132: saldo da rubrica em duas partes. em_transito passa a ser so liberado_rpa_airtop e aguardando_d3, pelo status
-- real de documents, sem excluidos e duplicatas, com o valor que o robo lanca (valor_pago; senao o lancamento
-- conciliado; senao o valor da nota). Colunas novas: em_transito_qtd, em_conferencia, em_conferencia_qtd.
-- Aplicada em 27/10/2026.
create or replace view public.v_saldo_rubricas with (security_invoker = true) as
with ultima_captura as (
    select distinct on (project_id) project_id, id as captura_id, concluida_em
    from saldo_salic_capturas
    where status = 'sucesso' and concluida_em is not null
    order by project_id, concluida_em desc
), executado as (
    select uc.project_id, l.rubrica_id, sum(l.vl_executado) as executado_salic
    from ultima_captura uc
    join saldo_salic_linhas l on l.captura_id = uc.captura_id and l.rubrica_id is not null
    group by uc.project_id, l.rubrica_id
), nfs_pos_captura as (
    select d.rubrica_id, sum(d.valor) as total
    from despesas d
    join ultima_captura uc on uc.project_id = d.project_id
    where d.data_salic is not null and d.data_salic > uc.concluida_em
    group by d.rubrica_id
), despesa_viva as (
    -- Status real do documento (despesas.status fica desatualizado) e o valor que o robô
    -- lança no SALIC (#120): valor_pago; senão o lançamento conciliado; senão o valor da nota.
    select d.rubrica_id,
           doc.status as status_doc,
           coalesce(doc.valor_pago,
                    (select abs(l.valor) from extratos_lancamentos l
                      where l.document_id = doc.id and l.status_conciliacao = 'conciliado'
                      order by l.data_lancamento desc limit 1),
                    d.valor) as valor
    from despesas d
    join documents doc on doc.id = d.document_id
    where d.data_salic is null
      and doc.excluido_em is null
      and doc.duplicata_de_id is null
), em_transito as (
    -- Liberadas para o robô, ainda não lançadas no SALIC: entram na projeção.
    select rubrica_id, sum(valor) as total, count(*) as qtd
    from despesa_viva
    where status_doc in ('liberado_rpa_airtop', 'aguardando_d3')
    group by rubrica_id
), em_conferencia as (
    -- Ainda em conferência no PrestAí: só informativo, não entra na projeção.
    select rubrica_id, sum(valor) as total, count(*) as qtd
    from despesa_viva
    where status_doc not in ('liberado_rpa_airtop', 'aguardando_d3', 'enviado_salic', 'concluido',
                             'erro_rpa', 'bloqueado_conformidade', 'aguardando_rubrica')
    group by rubrica_id
), contrato_consumido as (
    select doc.contract_id, sum(d.valor) as total
    from despesas d
    join documents doc on doc.id = d.document_id
    where doc.contract_id is not null and d.status <> all (array['erro_rpa', 'bloqueado_conformidade'])
    group by doc.contract_id
), comprometido_por_rubrica as (
    select c.rubrica_id, sum(greatest(0::numeric, c.valor_total - coalesce(cc.total, 0))) as total
    from contracts c
    left join contrato_consumido cc on cc.contract_id = c.id
    where c.status = 'ativo' and c.excluido_em is null and c.rubrica_id is not null
      and (c.data_fim is null or c.data_fim >= current_date)
    group by c.rubrica_id
)
select r.id as rubrica_id,
       r.project_id,
       r.organization_id,
       r.nome,
       r.etapa,
       r.valor_aprovado,
       r.valor_utilizado,
       r.percentual_alerta,
       r.alerta_limite_ativo,
       uc.concluida_em as ultima_captura_em,
       case when uc.project_id is null then null else coalesce(ex.executado_salic, 0) end as executado_salic,
       coalesce(nfs.total, 0) as nfs_confirmadas_nao_absorvidas,
       case when uc.project_id is null then null else coalesce(ex.executado_salic, 0) + coalesce(nfs.total, 0) end as executado_efetivo,
       coalesce(et.total, 0) as em_transito,
       coalesce(cpr.total, 0) as comprometido,
       case when uc.project_id is null then null else r.valor_aprovado - coalesce(ex.executado_salic, 0) end as disponivel_oficial,
       case when uc.project_id is null then null
            else r.valor_aprovado - (coalesce(ex.executado_salic, 0) + coalesce(nfs.total, 0))
                 - coalesce(et.total, 0) - coalesce(cpr.total, 0) end as disponivel_projetado,
       r.rubrica_id as codigo_rubrica,
       coalesce(et.qtd, 0) as em_transito_qtd,
       coalesce(ec.total, 0) as em_conferencia,
       coalesce(ec.qtd, 0) as em_conferencia_qtd
from rubricas r
left join ultima_captura uc on uc.project_id = r.project_id
left join executado ex on ex.project_id = r.project_id and ex.rubrica_id = r.id
left join nfs_pos_captura nfs on nfs.rubrica_id = r.id
left join em_transito et on et.rubrica_id = r.id
left join em_conferencia ec on ec.rubrica_id = r.id
left join comprometido_por_rubrica cpr on cpr.rubrica_id = r.id
;
