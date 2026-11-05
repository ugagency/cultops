-- #157: confirmar_lancamento_nota não trata mais como "vinculado a outra nota" o lançamento cuja
-- nota foi excluída (documents.excluido_em).
--
-- Problema: a exclusão de nota é lógica e não solta o lançamento que ela consumia (document_id e
-- status 'conciliado' ficam). A tela passou a oferecer esse lançamento de novo (candidatos-
-- lancamento.js, liberarVinculosDeNotasExcluidas), mas a função recusava com "Lançamento já
-- vinculado a outra nota" quando a única cópia disponível era a que ficou presa.
--
-- Única mudança em relação à versão em produção: a recusa só vale se a outra nota NÃO estiver
-- excluída. Ao confirmar, a linha passa para a nota nova (document_id e status já eram gravados).
-- Não altera dados; só substitui a função. NÃO aplicada em produção por este commit.

create or replace function public.confirmar_lancamento_nota(p_document_id uuid, p_lancamento_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d documents%rowtype; l extratos_lancamentos%rowtype; v_org uuid; v_av jsonb;
begin
  if not public.has_any_role('admin','gestor','analista') then
    raise exception 'Sem permissão para confirmar lançamento';
  end if;
  select * into d from documents where id = p_document_id for update;
  select * into l from extratos_lancamentos where id = p_lancamento_id for update;
  if d.id is null or l.id is null then raise exception 'Nota ou lançamento não encontrado'; end if;
  select organization_id into v_org from projects where id = d.project_id;
  if v_org is distinct from public.current_user_org_id() then raise exception 'Fora da sua organização'; end if;
  if l.project_id <> d.project_id then raise exception 'Lançamento de outro projeto'; end if;
  if l.document_id is not null and l.document_id <> d.id
     and exists (select 1 from documents o where o.id = l.document_id and o.excluido_em is null) then
    raise exception 'Lançamento já vinculado a outra nota';
  end if;
  if l.fitid is null or btrim(l.fitid) = '' then raise exception 'Lançamento sem número de transação'; end if;

  update documents set fitid = l.fitid, data_pagamento = l.data_lancamento,
         valor_pago = l.valor, extrato_conferido_id = l.extrato_id
   where id = d.id;
  update extratos_lancamentos set document_id = d.id, status_conciliacao = 'conciliado' where id = l.id;

  insert into audit_log(tabela, registro_id, campo, valor_anterior, valor_novo, alterado_por, origem, motivo)
  values ('documents', d.id, 'fitid', d.fitid, l.fitid, auth.uid(), 'confirmar_lancamento_nota', 'Lançamento escolhido manualmente');

  v_av := public.avancar_nota_apos_pagamento(d.id, 'Lançamento escolhido manualmente');
  return jsonb_build_object('ok', true, 'fitid', l.fitid, 'data_pagamento', l.data_lancamento) || v_av;
end $function$;
