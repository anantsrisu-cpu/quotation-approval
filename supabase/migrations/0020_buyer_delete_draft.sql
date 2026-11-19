-- =====================================================================
-- 0020 · ผู้ซื้อที่ได้รับร่างส่งต่อ ลบร่างนั้นได้
--   * delete_request: the buyer a draft was handed to (0019) may delete it;
--     the person who drafted it is told.
--   * attachments of a handed draft can be removed by that buyer too
--     (removing a file in the form, or deleting the draft).
--   * quotation attachments must be PDF (new uploads; a draft with an older
--     non-PDF file cannot be sent until it is replaced), so the approved
--     comparison sheet and the attachments download as one PDF.
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

-- ---------------------------------------------------------------------
-- quotation attachments: PDF only
-- ---------------------------------------------------------------------
create or replace function public.request_files_pdf_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if lower(coalesce(new.name, '')) !~ '\.pdf$' or lower(coalesce(new.path, '')) !~ '\.pdf$' then
    raise exception 'แนบได้เฉพาะไฟล์ PDF (%) · PDF files only', new.name;
  end if;
  return new;
end $$;
drop trigger if exists request_files_pdf_only on public.request_files;
create trigger request_files_pdf_only before insert on public.request_files
  for each row execute function public.request_files_pdf_only();

drop policy if exists "attachments upload to own draft" on storage.objects;
create policy "attachments upload to own draft" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and lower(name) like '%.pdf'
              and public.can_edit_draft(public.try_uuid((storage.foldername(name))[1])));

-- a draft that still has an older non-PDF attachment is not sent
create or replace function public.requests_pdf_on_send()
returns trigger language plpgsql set search_path = public as $$
declare bad text;
begin
  if old.status = 'draft' and new.status in ('pending', 'approved') then
    select string_agg(name, ', ' order by id) into bad from public.request_files
    where request_id = new.id and lower(name) !~ '\.pdf$';
    if bad is not null then
      raise exception 'ไฟล์แนบต้องเป็น PDF: % — ลบแล้วแนบใหม่เป็น PDF · Attachments must be PDF', bad;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists requests_pdf_on_send on public.requests;
create trigger requests_pdf_on_send before update on public.requests
  for each row execute function public.requests_pdf_on_send();

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
grant  execute on function public.claim_emails(int) to service_role;

notify pgrst, 'reload schema';
