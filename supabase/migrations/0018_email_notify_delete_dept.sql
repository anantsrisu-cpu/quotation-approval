-- =====================================================================
-- 0018 · แจ้งเตือนทางอีเมล + ลบฝ่าย
--   * profiles.email_notify / notify_email : each account can switch e-mail
--     notifications off and add one more address. The extra address must be on
--     the same domain as the sign-in e-mail (company mail only).
--   * app_settings.email_enabled : admin switch for the whole system (off until
--     IT has set up the sender — see README "อีเมลแจ้งเตือน").
--   * email_outbox : every in-app notification is queued here; the Edge Function
--     supabase/functions/send-emails sends the queue through Microsoft 365.
--   * admin_delete_department(id) : remove a department nobody uses.
--
-- Run once in Supabase → SQL Editor after 0017. Safe to run again.
-- =====================================================================

alter table public.profiles     add column if not exists email_notify boolean not null default true;
alter table public.profiles     add column if not exists notify_email text not null default '';
alter table public.app_settings add column if not exists email_enabled boolean not null default false;

create or replace function public.profiles_notify_email_check()
returns trigger language plpgsql set search_path = public as $$
begin
  new.notify_email := lower(btrim(coalesce(new.notify_email, '')));
  if new.notify_email = lower(btrim(coalesce(new.email, ''))) then
    new.notify_email := '';   -- same as the sign-in e-mail: nothing extra to keep
  end if;
  if new.notify_email <> '' then
    if char_length(new.notify_email) > 200 or new.notify_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' then
      raise exception 'รูปแบบอีเมลไม่ถูกต้อง · Not a valid e-mail address';
    end if;
    if split_part(new.notify_email, '@', 2) <> lower(split_part(new.email, '@', 2)) then
      raise exception 'อีเมลแจ้งเตือนต้องเป็นโดเมนเดียวกับอีเมลเข้าสู่ระบบ (@%) · Must be on the same domain as the sign-in e-mail',
        lower(split_part(new.email, '@', 2));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_notify_email_check on public.profiles;
create trigger profiles_notify_email_check before insert or update of notify_email, email on public.profiles
  for each row execute function public.profiles_notify_email_check();

-- a user changes only their own e-mail notification settings
create or replace function public.set_my_email_prefs(p_on boolean, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'เข้าสู่ระบบก่อน · Sign in first'; end if;
  update public.profiles set email_notify = coalesce(p_on, true), notify_email = coalesce(p_email, '')
  where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- queue of e-mails to send
-- ---------------------------------------------------------------------
create table if not exists public.email_outbox (
  id              bigint generated always as identity primary key,
  notification_id bigint references public.notifications(id) on delete set null,
  user_id         uuid references public.profiles(id) on delete cascade,
  to_emails       text[] not null check (cardinality(to_emails) > 0),
  kind            text not null default 'info',
  subject         text not null,
  body            text not null default '',
  link            text not null default '',
  status          text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts        int  not null default 0,
  error           text not null default '',
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz
);
create index if not exists email_outbox_status_idx on public.email_outbox(status, id);
alter table public.email_outbox enable row level security;
drop policy if exists "email_outbox admin read" on public.email_outbox;
create policy "email_outbox admin read" on public.email_outbox for select to authenticated using (public.is_admin());
-- no insert/update/delete policy: only database functions and the Edge Function (service role) write

create or replace function public.queue_notification_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if not coalesce((select email_enabled from public.app_settings where id = 1), false) then return new; end if;
  select * into p from public.profiles where id = new.user_id;
  if p.id is null or not p.email_notify or coalesce(p.email, '') = '' then return new; end if;
  insert into public.email_outbox (notification_id, user_id, to_emails, kind, subject, body, link)
  values (new.id, new.user_id,
          case when p.notify_email <> '' then array[lower(p.email), p.notify_email] else array[lower(p.email)] end,
          new.kind, new.title, new.body, new.link);
  return new;
end $$;
drop trigger if exists notifications_queue_email on public.notifications;
create trigger notifications_queue_email after insert on public.notifications
  for each row execute function public.queue_notification_email();

-- the Edge Function takes a batch (each row is handed out once; a batch stuck for 10 minutes is handed out again)
create or replace function public.claim_emails(p_limit int default 20)
returns setof public.email_outbox language sql security definer set search_path = public as $$
  update public.email_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
  where o.id in (
    select id from public.email_outbox
    where status = 'pending' or (status = 'sending' and claimed_at < now() - interval '10 minutes')
    order by id limit greatest(1, least(coalesce(p_limit, 20), 50))
    for update skip locked)
  returning o.*;
$$;

-- admin: a test e-mail to themselves (works even while the system switch is off)
create or replace function public.admin_test_email()
returns text[] language plpgsql security definer set search_path = public as $$
declare p public.profiles; t text[];
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  select * into p from public.profiles where id = auth.uid();
  t := case when p.notify_email <> '' then array[lower(p.email), p.notify_email] else array[lower(p.email)] end;
  insert into public.email_outbox (user_id, to_emails, kind, subject, body, link)
  values (p.id, t, 'ok', 'ทดสอบอีเมลแจ้งเตือน · Test e-mail',
          'ถ้าคุณได้รับอีเมลนี้ แปลว่าระบบส่งอีเมลแจ้งเตือนทำงานแล้ว · E-mail notifications are working.', '/admin/settings');
  return t;
end $$;

-- admin: put failed e-mails back in the queue
create or replace function public.admin_retry_emails()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  update public.email_outbox set status = 'pending', attempts = 0, error = '' where status = 'failed';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- delete a department that nothing refers to
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_department(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare nr int; np int;
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  select count(*) into nr from public.requests where dept = p_id;
  select count(*) into np from public.profiles where dept = p_id;
  if nr > 0 or np > 0 then
    raise exception 'ลบไม่ได้: ฝ่ายนี้มีคำขอ % รายการ และผู้ใช้ % บัญชี — ปิด “ใช้งาน” แทน · In use: deactivate instead', nr, np;
  end if;
  delete from public.departments where id = p_id;
  if not found then raise exception 'ไม่พบฝ่ายนี้ · Department not found'; end if;
end $$;

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.claim_emails(int) from authenticated;
revoke execute on function public.queue_notification_email() from authenticated;
grant  execute on function public.claim_emails(int) to service_role;

notify pgrst, 'reload schema';
