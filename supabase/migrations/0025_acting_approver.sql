-- =====================================================================
-- 0025 · อนุมัติแทน ช่วงไม่อยู่ · Acting approver while someone is away
--   positions.acting_for   the positions this position may approve in place of
--                          (ตั้งค่าระบบ → ตำแหน่งผู้อนุมัติ → "อนุมัติแทนตำแหน่ง")
--   profiles.acting_on     switched on by an admin while the people of those
--                          positions are away (ตั้งค่าระบบ → ผู้อนุมัติตามบริษัท)
--   Both must be set, otherwise nothing changes.
--   When an approver with acting on approves their own step:
--     * the hand-signing (ลายเซ็นสด) boxes of the positions they stand in for get
--       their signature, printed with "(แทน)";
--     * the following in-app steps of those positions are approved by them on
--       the absent person's behalf (request_steps.acting), also printed "(แทน)".
--   The request history records every such signature.
--
-- Run once in Supabase → SQL Editor after 0024. Safe to run again.
-- =====================================================================

alter table public.positions add column if not exists acting_for text[] not null default '{}';
alter table public.profiles add column if not exists acting_on boolean not null default false;
alter table public.profiles add column if not exists acting_since timestamptz;
alter table public.request_steps add column if not exists acting boolean not null default false;

-- acting_since follows the switch
create or replace function public.profiles_acting_since()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.acting_on is distinct from coalesce(old.acting_on, false) then
    new.acting_since := case when new.acting_on then now() end;
  end if;
  return new;
end $$;
drop trigger if exists profiles_acting_since on public.profiles;
create trigger profiles_acting_since before update of acting_on on public.profiles
  for each row execute function public.profiles_acting_since();

create or replace function public.approve_request(p_id uuid, p_comment text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  st public.request_steps;
  nxt public.request_steps;
  sig text;
  total_steps int;
  -- 0025
  covers text[];
  plan jsonb;
  e jsonb;
  k int;
  who uuid;
  who_sig text;
  cur int;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'คำขอนี้ไม่อยู่ระหว่างรออนุมัติ · Not pending'; end if;
  select * into st from public.request_steps where request_id = p_id and step_no = r.current_step;
  if st.approver_id is distinct from auth.uid() then
    raise exception 'ขั้นนี้ไม่ได้รอคุณอนุมัติ · This step is not waiting for you';
  end if;
  if not public.has_role('approver') then raise exception 'บัญชีนี้ไม่มีสิทธิ์อนุมัติ · Approver role required'; end if;
  select data into sig from public.signatures where user_id = auth.uid();
  if sig is null then raise exception 'ยังไม่มีลายเซ็นในบัญชี · Add your signature first'; end if;

  update public.request_steps
     set status='approved', acted_at=now(), comment=coalesce(p_comment,''), signature=sig, signer_id=auth.uid()
   where id = st.id;
  perform public.add_log(p_id, 'approved',
    'ขั้นที่ ' || (st.step_no+1) || ' อนุมัติและลงนาม โดย ' || public.user_name(auth.uid()) ||
    case when st.on_behalf_of is not null then ' (แทน ' || public.user_name(st.on_behalf_of) || ')' else '' end ||
    ' · Step ' || (st.step_no+1) || ' approved', coalesce(p_comment,''));

  -- 0025: acting on → the hand-signing boxes of the positions this one stands in for get this signature
  if coalesce((select acting_on from public.profiles where id = auth.uid()), false) then
    select array_remove(coalesce(acting_for, '{}'), st.position) into covers from public.positions where code = st.position;
    if coalesce(cardinality(covers), 0) > 0 and jsonb_typeof(r.sign_plan) = 'array' then
      plan := r.sign_plan;
      for k in 0 .. jsonb_array_length(plan) - 1 loop
        e := plan->k;
        if e->>'mode' = 'wet' and e->>'position' = any(covers) and e->>'acting_by' is null then
          plan := jsonb_set(plan, array[k::text], e || jsonb_build_object('acting_by', auth.uid(), 'acting_sig', sig, 'acting_at', now()));
          perform public.add_log(p_id, 'acting',
            'ลงนามแทน ' || public.position_th(e->>'position') || ' โดย ' || public.user_name(auth.uid()) || ' (อนุมัติแทน ช่วงไม่อยู่) · Signed as acting approver');
        end if;
      end loop;
      update public.requests set sign_plan = plan where id = p_id;
    end if;
  end if;

  -- the next step; a step of a position that an earlier signer (with acting on) stands in for
  -- is approved by that signer on the absent person's behalf, and so on
  cur := st.step_no;
  loop
    select * into nxt from public.request_steps where request_id = p_id and step_no = cur + 1;
    exit when nxt.id is null;
    who := null;
    select s.signer_id into who
      from public.request_steps s
      join public.profiles pr on pr.id = s.signer_id and pr.acting_on and pr.status = 'active'
      join public.positions po on po.code = s.position
     where s.request_id = p_id and s.status = 'approved' and s.step_no < nxt.step_no
       and nxt.position = any(po.acting_for) and nxt.position <> s.position
       and s.signer_id is distinct from nxt.approver_id
     order by s.step_no limit 1;
    exit when who is null;
    select data into who_sig from public.signatures where user_id = who;
    exit when who_sig is null;
    update public.request_steps
       set status = 'approved', acted_at = now(), comment = '', signature = who_sig, signer_id = who,
           on_behalf_of = nxt.approver_id, acting = true
     where id = nxt.id;
    perform public.add_log(p_id, 'approved',
      'ขั้นที่ ' || (nxt.step_no+1) || ' อนุมัติแทน ' || public.position_th(nxt.position) || ' โดย ' || public.user_name(who) ||
      ' (ช่วง ' || public.user_name(nxt.approver_id) || ' ไม่อยู่) · Step ' || (nxt.step_no+1) || ' approved by the acting approver', '');
    if nxt.approver_id is not null then
      perform public.notify(nxt.approver_id, p_id, 'info', 'มีการอนุมัติแทนคุณ · Approved on your behalf',
        r.no || ' · ' || public.user_name(who) || ' อนุมัติแทนในช่วงที่คุณไม่อยู่');
    end if;
    cur := nxt.step_no;
  end loop;

  select count(*) into total_steps from public.request_steps where request_id = p_id;

  if nxt.id is null then
    update public.requests set status='approved', completed_at=now(), letter_at=now(), updated_at=now()
     where id = p_id;
    perform public.add_log(p_id, 'completed', 'อนุมัติครบทุกขั้น · Fully approved');
    perform public.notify(r.preparer_id, p_id, 'ok', 'อนุมัติครบแล้ว · Fully approved',
      r.no || ' · หนังสืออนุมัติพร้อมดาวน์โหลดเป็น PDF · Letter ready as PDF');
    return jsonb_build_object('done', true);
  end if;

  update public.request_steps set status='pending' where id = nxt.id;
  update public.requests set current_step = nxt.step_no, step_since = now(), updated_at = now() where id = p_id;
  perform public.notify(nxt.approver_id, p_id, 'wait', 'มีคำขอรอคุณอนุมัติ · Waiting for your approval',
    r.no || ' · ' || r.product_name || ' · ขั้นที่ ' || (nxt.step_no+1) || ' จาก ' || total_steps);
  perform public.notify(r.preparer_id, p_id, 'ok',
    'ขั้นที่ ' || (st.step_no+1) || ' อนุมัติแล้ว · Step approved',
    r.no || ' · ต่อไป ' || public.user_name(nxt.approver_id));
  return jsonb_build_object('done', false, 'next', public.user_name(nxt.approver_id), 'step', nxt.step_no + 1);
end $$;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.claim_emails(int) from authenticated;
revoke execute on function public.queue_notification_email() from authenticated;
revoke execute on function public.guard_maintenance() from authenticated;
revoke execute on function public.requests_handoff_guard() from authenticated;
revoke execute on function public.request_files_pdf_only() from authenticated;
revoke execute on function public.requests_pdf_on_send() from authenticated;
revoke execute on function public.profiles_acting_since() from authenticated;
grant  execute on function public.claim_emails(int) to service_role;

notify pgrst, 'reload schema';
