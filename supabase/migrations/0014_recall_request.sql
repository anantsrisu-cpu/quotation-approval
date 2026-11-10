-- =====================================================================
-- 0014 · ดึงคำขอกลับมาแก้ไข · Recall a request that is still being approved
--   recall_request(id, reason) : the preparer (or the admin who drafted it) takes a
--   pending request back to draft to edit it. The number and history are kept; the
--   approvers who already approved and the one it is waiting for are told; when the
--   request is sent again, approval starts again from the first approver.
--   (Rejected requests already go back to draft with reopen_request.)
--
-- Run once in Supabase → SQL Editor after 0013. Safe to run again.
-- =====================================================================

create or replace function public.recall_request(p_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  a record;
  why text := btrim(coalesce(p_reason, ''));
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคำขอ · Request not found'; end if;
  if not (public.is_active() and (r.preparer_id = auth.uid() or (r.created_by = auth.uid() and public.is_admin()))) then
    raise exception 'ไม่ใช่คำขอของคุณ · Not your request';
  end if;
  if r.status <> 'pending' then
    raise exception 'ดึงกลับได้เฉพาะคำขอที่กำลังรออนุมัติ · Only requests waiting for approval can be recalled';
  end if;
  if length(why) > 500 then raise exception 'เหตุผลยาวเกิน 500 ตัวอักษร · Reason too long'; end if;
  -- tell everyone who has seen it in their inbox or already approved it
  for a in
    select distinct coalesce(s.signer_id, s.approver_id) uid from public.request_steps s
     where s.request_id = p_id and s.status in ('pending', 'approved') and coalesce(s.signer_id, s.approver_id) is not null
  loop
    if a.uid <> auth.uid() then
      perform public.notify(a.uid, p_id, 'info', 'ผู้จัดทำดึงคำขอกลับไปแก้ไข · Request recalled for editing',
        coalesce(r.no, '') || case when why <> '' then ' · ' || why else '' end || ' · จะส่งมาให้อนุมัติใหม่อีกครั้ง');
    end if;
  end loop;
  update public.request_steps set status = 'cancelled' where request_id = p_id and status in ('pending', 'waiting');
  update public.requests set status = 'draft', completed_at = null, updated_at = now() where id = p_id;
  perform public.add_log(p_id, 'reopened', 'ดึงกลับมาแก้ไข · Recalled for editing', why);
end $$;

-- the admin who drafted a request on someone's behalf may also reopen it after a rejection
create or replace function public.reopen_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null or not (r.preparer_id = auth.uid() or (r.created_by = auth.uid() and public.is_admin())) then
    raise exception 'ไม่ใช่คำขอของคุณ · Not your request';
  end if;
  if r.status <> 'rejected' then raise exception 'แก้ไขได้เฉพาะคำขอที่ไม่อนุมัติ · Only rejected requests'; end if;
  update public.requests set status='draft', completed_at=null, updated_at=now() where id = p_id;
  perform public.add_log(p_id, 'reopened', 'นำกลับมาแก้ไข · Reopened for editing');
end $$;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

notify pgrst, 'reload schema';
