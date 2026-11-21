-- 0027 · ล็อกระบบจริงหลัง Go-Live · Production lock after go-live
-- 1) "ล็อกระบบจริง": once an admin locks the system (Settings → ล้างข้อมูลทดสอบก่อน Go-Live),
--    the "delete every request" clean-up (admin_reset_requests) is refused for good.
--    Only the Supabase SQL Editor can unlock it:  update app_settings set prod_locked = false where id = 1;
-- 2) The SKU list and the approval limits (tiers) are readable only by active accounts
--    (accounts still waiting for approval, or disabled, no longer see them).
-- Safe to run more than once.

alter table public.app_settings add column if not exists prod_locked boolean not null default false;
alter table public.app_settings add column if not exists prod_locked_at timestamptz;
alter table public.app_settings add column if not exists prod_locked_by uuid references public.profiles(id) on delete set null;

-- the lock can be switched off only from the SQL Editor (no signed-in user there)
create or replace function public.app_settings_lock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.prod_locked and not new.prod_locked and auth.uid() is not null then
    raise exception 'ระบบถูกล็อกหลัง Go-Live แล้ว ปลดล็อกได้เฉพาะใน Supabase SQL Editor · The production lock can only be removed in the SQL Editor';
  end if;
  if new.prod_locked and not old.prod_locked then
    new.prod_locked_at := now();
    new.prod_locked_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists app_settings_lock_guard on public.app_settings;
create trigger app_settings_lock_guard before update on public.app_settings
  for each row execute function public.app_settings_lock_guard();

create or replace function public.admin_lock_production(p_confirm text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  if upper(btrim(coalesce(p_confirm, ''))) <> 'GO-LIVE' then
    raise exception 'พิมพ์คำว่า GO-LIVE เพื่อยืนยัน · Type GO-LIVE to confirm';
  end if;
  update public.app_settings set prod_locked = true where id = 1 and not prod_locked;
end $$;

-- ---------- admin: clear every request before go-live (refused once locked) ----------
create or replace function public.admin_reset_requests(p_confirm text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  if coalesce((select prod_locked from public.app_settings where id = 1), false) then
    raise exception 'ระบบใช้งานจริงแล้ว (ล็อกหลัง Go-Live) ลบคำขอทั้งหมดไม่ได้ · The system is live; clearing all requests is locked';
  end if;
  if btrim(coalesce(p_confirm, '')) <> 'ลบทั้งหมด' then
    raise exception 'พิมพ์คำว่า ลบทั้งหมด เพื่อยืนยัน · Type ลบทั้งหมด to confirm';
  end if;
  select count(*) into n from public.requests;
  delete from public.notifications where request_id is not null;
  delete from public.requests where true;   -- steps, log and file records cascade
  delete from public.request_counters where true;
  return n;
end $$;

-- ---------- reference data only for active accounts ----------
drop policy if exists "products read" on public.products;
create policy "products read" on public.products for select to authenticated using (public.is_active());
drop policy if exists "tiers read" on public.tiers;
create policy "tiers read" on public.tiers for select to authenticated using (public.is_active());

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
