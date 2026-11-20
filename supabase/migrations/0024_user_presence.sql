-- =====================================================================
-- 0024 · สถานะออนไลน์ของผู้ใช้ · Who is online
--   Every open app page reports to touch_presence() about once a minute
--   ('online'), and once more when the page is closed ('closed').
--   admin_presence() (admins only) returns how long ago each person was last
--   heard from, timed by the database clock:
--     online   = heard within the last 2 minutes
--     lost     = still 'online' but silent for 2–30 minutes (connection dropped,
--                computer asleep or switched off without closing the page)
--     offline  = page closed, or silent for more than 30 minutes
--   One small row per person (no history is kept).
--
-- Run once in Supabase → SQL Editor after 0023. Safe to run again.
-- =====================================================================

create table if not exists public.user_presence (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  last_seen timestamptz not null default now(),
  state     text not null default 'online' check (state in ('online', 'closed')),
  page      text not null default '' check (char_length(page) <= 200),
  since     timestamptz not null default now()   -- start of the current online spell
);
alter table public.user_presence enable row level security;
-- no direct access: written through touch_presence, read through admin_presence
revoke all on public.user_presence from anon, authenticated;

create or replace function public.touch_presence(p_state text default 'online', p_page text default '')
returns void language plpgsql security definer set search_path = public as $$
declare st text := case when p_state = 'closed' then 'closed' else 'online' end;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then return; end if;
  insert into public.user_presence as u (user_id, last_seen, state, page, since)
  values (auth.uid(), now(), st, left(coalesce(p_page, ''), 200), now())
  on conflict (user_id) do update set
    last_seen = now(),
    state = st,
    page = case when st = 'online' then left(coalesce(p_page, ''), 200) else u.page end,
    since = case when u.state = 'closed' or u.last_seen < now() - interval '2 minutes' then now() else u.since end;
end $$;

create or replace function public.admin_presence()
returns table (user_id uuid, status text, last_seen timestamptz, seconds_ago int, since timestamptz, page text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  return query
    select p.user_id,
           case when p.state = 'online' and p.last_seen > now() - interval '2 minutes' then 'online'
                when p.state = 'online' and p.last_seen > now() - interval '30 minutes' then 'lost'
                else 'offline' end,
           p.last_seen, extract(epoch from now() - p.last_seen)::int, p.since, p.page
    from public.user_presence p;
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
grant  execute on function public.claim_emails(int) to service_role;

notify pgrst, 'reload schema';
