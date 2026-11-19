-- =====================================================================
-- 0020 · ผู้ซื้อที่ได้รับร่างส่งต่อ ลบร่างนั้นได้
--   * delete_request: the buyer a draft was handed to (0019) may delete it;
--     the person who drafted it is told.
--   * attachments of a handed draft can be removed by that buyer too
--     (removing a file in the form, or deleting the draft).
--
-- Run once in Supabase → SQL Editor after 0019. Safe to run again.
-- =====================================================================

create or replace function public.delete_request(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r public.requests; by_buyer boolean;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคำขอ · Request not found'; end if;
  by_buyer := r.status = 'draft' and r.handoff and r.buyer_id = auth.uid() and r.preparer_id <> auth.uid()
              and public.has_role('preparer');
  if not (public.is_active() and (r.preparer_id = auth.uid() or (r.created_by = auth.uid() and public.is_admin()) or by_buyer)) then
    raise exception 'ลบได้เฉพาะคำขอของคุณ · Not your request';
  end if;
  if r.status not in ('draft', 'rejected', 'cancelled') then
    raise exception 'ลบได้เฉพาะคำขอที่เป็นฉบับร่าง ไม่อนุมัติ หรือยกเลิก · Only drafts, rejected or cancelled requests can be deleted';
  end if;
  if by_buyer then
    -- the request is gone afterwards, so the message is not linked to it
    perform public.notify(r.preparer_id, null, 'bad', 'ผู้ซื้อลบร่างที่คุณส่งต่อ · Handed draft deleted',
      public.user_name(auth.uid()) || ' ลบร่างคำขอ' || coalesce(' ' || nullif(r.product_name, ''), '') ||
      coalesce(' (' || nullif(btrim(r.report_no), '') || ')', ''));
  end if;
  -- steps, log, file records and notifications go with it (on delete cascade)
  delete from public.requests where id = p_id;
  return coalesce(r.no, 'ฉบับร่าง');
end $$;

drop policy if exists "attachments delete from own draft" on storage.objects;
create policy "attachments delete from own draft" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (public.is_admin() or exists (
    select 1 from public.requests r
    where r.id = public.try_uuid((storage.foldername(name))[1])
      and ((r.preparer_id = auth.uid() or r.created_by = auth.uid()) and r.status in ('draft', 'rejected', 'cancelled')
           or (r.status = 'draft' and r.handoff and r.buyer_id = auth.uid() and public.has_role('preparer'))))));

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.claim_emails(int) from authenticated;
revoke execute on function public.queue_notification_email() from authenticated;
revoke execute on function public.guard_maintenance() from authenticated;
revoke execute on function public.requests_handoff_guard() from authenticated;
grant  execute on function public.claim_emails(int) to service_role;

notify pgrst, 'reload schema';
