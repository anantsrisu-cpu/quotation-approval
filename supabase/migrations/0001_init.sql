-- =====================================================================
-- Quotation Approval · ระบบอนุมัติใบเสนอราคา
-- Database schema for Supabase (PostgreSQL 15+)
--
-- Run once in Supabase → SQL Editor (or `supabase db push`).
-- Every state change of a request goes through the SECURITY DEFINER
-- functions below, so amounts, approvers and signatures cannot be
-- altered from the browser.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Reference data & settings (editable by admins)
-- ---------------------------------------------------------------------

create table public.app_settings (
  id          int primary key default 1 check (id = 1),
  vat_rate    numeric(5,4) not null default 0.07 check (vat_rate >= 0 and vat_rate < 1),
  recipient   text not null default 'กรรมการผู้จัดการ',
  request_prefix text not null default 'QT',
  updated_at  timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- Approver positions. `sort` is the order in which approvals happen.
create table public.positions (
  code  text primary key check (code ~ '^[a-z0-9_]{1,20}$'),
  th    text not null,
  en    text not null default '',
  sort  int  not null default 0
);

-- Price tiers (amount INCLUDING VAT). max_amount null = no limit.
create table public.tiers (
  id          bigint generated always as identity primary key,
  label       text not null,
  max_amount  numeric(14,2),
  steps       text[] not null check (cardinality(steps) > 0),
  sort        int not null default 0
);

create table public.departments (
  id      text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  th      text not null,
  en      text not null default '',
  sort    int  not null default 0,
  active  boolean not null default true
);

create table public.companies (
  id        text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  th        text not null,
  en        text not null default '',
  initials  text not null default '',
  address   text not null default '',
  logo_path text,                       -- path in the public "logos" bucket
  sort      int  not null default 0,
  active    boolean not null default true
);

create table public.products (
  sku        text primary key check (sku = upper(btrim(sku)) and sku <> ''),
  name       text not null,
  category   text not null default '',
  unit       text not null default '',
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null default '',
  name            text not null default '',
  title           text not null default '',
  dept            text references public.departments(id),
  roles           text[] not null default '{}'
                  check (roles <@ array['preparer','approver','admin']::text[]),
  position        text references public.positions(code),
  status          text not null default 'new'
                  check (status in ('new','pending','active','rejected','disabled')),
  requested_roles text[] not null default '{}'
                  check (requested_roles <@ array['preparer','approver']::text[]),
  apply_note      text not null default '',
  review_note     text not null default '',
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  applied_at      timestamptz,
  created_at      timestamptz not null default now()
);

-- Signature images (PNG data URLs). Private: owner + admins only.
-- Approval functions copy the image into the request step at signing time.
create table public.signatures (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  data       text not null check (data like 'data:image/%' and length(data) < 400000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

-- ---------------------------------------------------------------------
-- 3. Requests
-- ---------------------------------------------------------------------

create table public.request_counters (
  year int primary key,
  last int not null default 0
);

create table public.requests (
  id              uuid primary key default gen_random_uuid(),
  no              text unique,
  status          text not null default 'draft'
                  check (status in ('draft','pending','approved','rejected','cancelled')),
  preparer_id     uuid not null default auth.uid() references public.profiles(id),
  subject_type    text not null default 'general' check (subject_type in ('stock','general','hire')),
  sku             text not null default '',
  product_name    text not null default '',
  qty             numeric(14,3) not null default 0,
  unit            text not null default '',
  unit_price      numeric(14,2) not null default 0,
  subtotal        numeric(14,2) not null default 0,
  vat             numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  vat_rate        numeric(5,4)  not null default 0.07,
  dept            text references public.departments(id),
  purpose         text not null default 'replace' check (purpose in ('repair','replace','stock')),
  buyer_id        uuid references public.profiles(id),
  company_id      text references public.companies(id),
  vendor          text not null default '',
  quote_no        text not null default '',
  quote_date      date,
  details         text not null default '',
  -- draft input: [{vendor, unit_price}]; after submit also subtotal/total/diff
  comparisons     jsonb not null default '[]'::jsonb check (jsonb_typeof(comparisons) = 'array'),
  no_comp         boolean not null default false,
  no_comp_reason  text not null default '',
  low_reason      text not null default '',
  message         text not null default '',
  tier_label      text not null default '',
  current_step    int  not null default 0,
  preparer_signature text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  step_since      timestamptz,
  completed_at    timestamptz,
  letter_path     text,
  letter_at       timestamptz
);
create index requests_preparer_idx on public.requests(preparer_id, created_at desc);
create index requests_status_idx   on public.requests(status, created_at desc);

create table public.request_steps (
  id           bigint generated always as identity primary key,
  request_id   uuid not null references public.requests(id) on delete cascade,
  step_no      int  not null,
  position     text not null references public.positions(code),
  approver_id  uuid references public.profiles(id),
  status       text not null default 'waiting'
               check (status in ('waiting','pending','approved','rejected','cancelled')),
  acted_at     timestamptz,
  comment      text not null default '',
  signature    text,
  signer_id    uuid references public.profiles(id),
  on_behalf_of uuid references public.profiles(id),
  unique (request_id, step_no)
);
create index request_steps_approver_idx on public.request_steps(approver_id, status);

create table public.request_files (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests(id) on delete cascade,
  path        text not null unique,
  name        text not null,
  size        bigint not null default 0,
  mime        text not null default '',
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.request_log (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid references public.profiles(id),
  kind        text not null,
  text        text not null,
  comment     text not null default '',
  target_id   uuid references public.profiles(id)
);
create index request_log_req_idx on public.request_log(request_id, at);

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  request_id  uuid references public.requests(id) on delete cascade,
  kind        text not null,          -- wait | ok | bad | info
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Client-side errors reported by the app (admin "bug status" page)
create table public.app_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null default auth.uid(),
  at          timestamptz not null default now(),
  page        text not null default '',
  action      text not null default '',
  message     text not null check (length(message) <= 4000),
  detail      text not null default '' check (length(detail) <= 20000),
  user_agent  text not null default '',
  status      text not null default 'open' check (status in ('open','investigating','fixed','ignored')),
  admin_note  text not null default '',
  updated_at  timestamptz not null default now()
);
create index app_errors_status_idx on public.app_errors(status, at desc);

-- ---------------------------------------------------------------------
-- 4. Helper functions
-- ---------------------------------------------------------------------

create or replace function public.my_status() returns text
language sql stable security definer set search_path = public as $$
  select status from public.profiles where id = auth.uid()
$$;

create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and status = 'active' and r = any(roles))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin')
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_status() = 'active', false)
$$;

create or replace function public.can_read_request(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and (
    public.is_admin()
    or exists (select 1 from public.requests r
               where r.id = rid and (r.preparer_id = auth.uid() or r.buyer_id = auth.uid()))
    or exists (select 1 from public.request_steps s
               where s.request_id = rid
                 and auth.uid() in (s.approver_id, s.signer_id, s.on_behalf_of))
  )
$$;

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function public.notify(p_user uuid, p_request uuid, p_kind text,
                                         p_title text, p_body text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, request_id, kind, title, body, link)
  values (p_user, p_request, p_kind, p_title, coalesce(p_body,''),
          case when p_request is null then '' else '/requests/' || p_request end)
$$;

create or replace function public.add_log(p_request uuid, p_kind text, p_text text,
                                          p_comment text default '', p_target uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.request_log (request_id, actor_id, kind, text, comment, target_id)
  values (p_request, auth.uid(), p_kind, p_text, coalesce(p_comment,''), p_target)
$$;

create or replace function public.user_name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(name,''), email, '—') from public.profiles where id = p
$$;

create or replace function public.position_th(p text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select th from public.positions where code = p), p)
$$;

-- Which approver handles a position for a department:
-- an approver in the same department first, otherwise the first by name.
create or replace function public.resolve_approver(p_position text, p_dept text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles
  where status = 'active' and 'approver' = any(roles) and position = p_position
  order by (dept is not distinct from p_dept) desc, name, id
  limit 1
$$;

create or replace function public.tier_for(p_total numeric) returns public.tiers
language sql stable security definer set search_path = public as $$
  select t.* from public.tiers t
  where t.max_amount is null or p_total <= t.max_amount
  order by t.sort, t.max_amount nulls last
  limit 1
$$;

-- Live preview for the request form: who must approve this amount?
create or replace function public.preview_approvers(p_total numeric, p_dept text)
returns table (step_no int, pos text, pos_th text, approver_id uuid,
               approver_name text, has_signature boolean, tier_label text)
language plpgsql stable security definer set search_path = public as $$
declare
  t public.tiers;
  v_pos text;
  i int := 0;
  a uuid;
begin
  if not public.is_active() then return; end if;
  t := public.tier_for(coalesce(p_total,0));
  if t.id is null then return; end if;
  for v_pos in
    select p.code from public.positions p where p.code = any(t.steps) order by p.sort, p.code
  loop
    a := public.resolve_approver(v_pos, p_dept);
    step_no := i; pos := v_pos; pos_th := public.position_th(v_pos);
    approver_id := a; approver_name := case when a is null then null else public.user_name(a) end;
    has_signature := a is not null and exists (select 1 from public.signatures s where s.user_id = a);
    tier_label := t.label;
    return next;
    i := i + 1;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. New users & account applications
-- ---------------------------------------------------------------------

-- Every new sign-in gets a profile. The very first user becomes the admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, name, roles, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name',
             split_part(coalesce(new.email,''), '@', 1)),
    case when first_user then array['admin','preparer'] else '{}'::text[] end,
    case when first_user then 'active' else 'new' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.submit_application(p_name text, p_title text, p_dept text,
                                                     p_roles text[], p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  st text;
  admin_id uuid;
begin
  select status into st from public.profiles where id = auth.uid();
  if st is null then raise exception 'ไม่พบบัญชีผู้ใช้ · Profile not found'; end if;
  if st not in ('new','rejected','pending') then
    raise exception 'บัญชีนี้ไม่อยู่ในสถานะสมัครได้ · This account cannot apply now';
  end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'กรุณากรอกชื่อ · Name is required'; end if;
  if p_roles is null or cardinality(p_roles) = 0 or not (p_roles <@ array['preparer','approver']) then
    raise exception 'เลือกบทบาทที่ต้องการ · Choose a role';
  end if;
  update public.profiles
     set name = btrim(p_name), title = coalesce(btrim(p_title),''), dept = nullif(p_dept,''),
         requested_roles = p_roles, apply_note = coalesce(p_note,''),
         status = 'pending', applied_at = now()
   where id = auth.uid();
  for admin_id in select id from public.profiles where status='active' and 'admin' = any(roles) loop
    perform public.notify(admin_id, null, 'wait',
      'คำขอเปิดบัญชีใหม่ · New account application',
      btrim(p_name) || ' ขอเป็น ' || array_to_string(p_roles, ', '));
  end loop;
end $$;

create or replace function public.admin_review_application(p_user uuid, p_approve boolean,
    p_roles text[], p_position text, p_dept text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  if p_approve then
    if p_roles is null or cardinality(p_roles) = 0 then
      raise exception 'เลือกบทบาทอย่างน้อย 1 บทบาท · Choose at least one role';
    end if;
    if 'approver' = any(p_roles) and coalesce(p_position,'') = '' then
      raise exception 'ผู้อนุมัติต้องมีตำแหน่งอนุมัติ · Approvers need a position';
    end if;
    update public.profiles
       set status='active', roles=p_roles, position=nullif(p_position,''),
           dept=coalesce(nullif(p_dept,''), dept),
           review_note=coalesce(p_note,''), reviewed_by=auth.uid(), reviewed_at=now()
     where id = p_user;
    perform public.notify(p_user, null, 'ok', 'บัญชีของคุณเปิดใช้งานแล้ว · Your account is active',
      'เข้าสู่ระบบเพื่อเริ่มใช้งาน · You can start using the app');
  else
    update public.profiles
       set status='rejected', review_note=coalesce(p_note,''), reviewed_by=auth.uid(), reviewed_at=now()
     where id = p_user;
    perform public.notify(p_user, null, 'bad', 'คำขอเปิดบัญชีไม่ผ่าน · Application not approved',
      coalesce(p_note,''));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Request workflow
-- ---------------------------------------------------------------------

create or replace function public.submit_request(p_id uuid, p_message text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  s public.app_settings;
  p public.products;
  t public.tiers;
  v_sub numeric; v_vat numeric; v_total numeric;
  comps jsonb := '[]'::jsonb;
  c jsonb;
  c_up numeric; c_sub numeric; c_total numeric; min_total numeric;
  pos text; a uuid; i int := 0; missing text := '';
  y int; n int; v_no text;
  sig text;
  first_approver uuid;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคำขอ · Request not found'; end if;
  if r.preparer_id <> auth.uid() then raise exception 'ส่งได้เฉพาะคำขอของคุณ · Not your request'; end if;
  if not public.has_role('preparer') then raise exception 'บัญชีนี้ไม่มีสิทธิ์สร้างคำขอ · Preparer role required'; end if;
  if r.status <> 'draft' then raise exception 'คำขอนี้ส่งไปแล้ว · Already sent'; end if;

  select * into s from public.app_settings where id = 1;
  select * into p from public.products where sku = upper(btrim(r.sku)) and active;
  if p.sku is null then raise exception 'ไม่พบ SKU ในรายการสินค้า · SKU not found'; end if;
  if r.qty <= 0 then raise exception 'กรอกจำนวน · Quantity required'; end if;
  if r.unit_price <= 0 then raise exception 'กรอกราคาต่อหน่วย · Unit price required'; end if;
  if btrim(r.vendor) = '' then raise exception 'กรอกชื่อผู้ขาย · Vendor required'; end if;
  if r.buyer_id is null then raise exception 'เลือกผู้ซื้อ · Buyer required'; end if;
  if r.company_id is null then raise exception 'เลือกบริษัทผู้ซื้อ · Buyer company required'; end if;
  if r.dept is null then raise exception 'เลือกฝ่ายที่ขอซื้อ · Department required'; end if;
  if not exists (select 1 from public.request_files f where f.request_id = r.id) then
    raise exception 'แนบใบเสนอราคาอย่างน้อย 1 ไฟล์ · Attach at least one quotation file';
  end if;

  v_sub   := round(r.unit_price * r.qty, 2);
  v_vat   := round(v_sub * s.vat_rate, 2);
  v_total := v_sub + v_vat;

  if r.no_comp then
    if btrim(r.no_comp_reason) = '' then
      raise exception 'ระบุเหตุผลที่ไม่มีคู่เทียบ · Reason for no comparison required';
    end if;
  else
    if jsonb_array_length(r.comparisons) = 0 then
      raise exception 'เพิ่มคู่เทียบอย่างน้อย 1 ราย หรือเลือกไม่มีคู่เทียบ · Add a comparison or tick no comparison';
    end if;
    for c in select * from jsonb_array_elements(r.comparisons) loop
      c_up := coalesce(nullif(c->>'unit_price','')::numeric, 0);
      if btrim(coalesce(c->>'vendor','')) = '' or c_up <= 0 then
        raise exception 'กรอกชื่อและราคาต่อหน่วยของคู่เทียบให้ครบ · Complete every comparison';
      end if;
      c_sub := round(c_up * r.qty, 2);
      c_total := c_sub + round(c_sub * s.vat_rate, 2);
      min_total := least(coalesce(min_total, c_total), c_total);
      comps := comps || jsonb_build_object('vendor', btrim(c->>'vendor'), 'unit_price', c_up,
                 'subtotal', c_sub, 'total', c_total, 'diff', c_total - v_total);
    end loop;
    if min_total < v_total and btrim(r.low_reason) = '' then
      raise exception 'ผู้ขายที่เลือกไม่ใช่ราคาต่ำสุด ระบุเหตุผล · Explain why not the lowest price';
    end if;
  end if;

  t := public.tier_for(v_total);
  if t.id is null then raise exception 'ยังไม่ได้ตั้งค่าวงเงิน · No price tier configured'; end if;

  delete from public.request_steps where request_id = r.id;
  for pos in select code from public.positions where code = any(t.steps) order by sort, code loop
    a := public.resolve_approver(pos, r.dept);
    if a is null then missing := missing || public.position_th(pos) || ' '; end if;
    insert into public.request_steps (request_id, step_no, position, approver_id, status)
    values (r.id, i, pos, a, case when i = 0 then 'pending' else 'waiting' end);
    if i = 0 then first_approver := a; end if;
    i := i + 1;
  end loop;
  if missing <> '' then
    raise exception 'ยังไม่มีผู้อนุมัติตำแหน่ง % ในระบบ แจ้งผู้ดูแล · No approver for this position', btrim(missing);
  end if;
  if i = 0 then raise exception 'วงเงินนี้ไม่มีตำแหน่งผู้อนุมัติ · Tier has no positions'; end if;

  -- request number (kept if the request was reopened after rejection)
  v_no := r.no;
  if v_no is null then
    y := extract(year from now() at time zone 'Asia/Bangkok');
    insert into public.request_counters (year, last) values (y, 1)
      on conflict (year) do update set last = public.request_counters.last + 1
      returning last into n;
    v_no := s.request_prefix || '-' || y || '-' || lpad(n::text, 4, '0');
  end if;

  select data into sig from public.signatures where user_id = auth.uid();

  update public.requests set
    no = v_no, status = 'pending', sku = p.sku, product_name = p.name,
    subtotal = v_sub, vat = v_vat, total = v_total, vat_rate = s.vat_rate,
    comparisons = case when r.no_comp then '[]'::jsonb else comps end,
    low_reason = case when r.no_comp or min_total >= v_total then '' else r.low_reason end,
    no_comp_reason = case when r.no_comp then r.no_comp_reason else '' end,
    tier_label = t.label, current_step = 0, message = coalesce(p_message, ''),
    preparer_signature = sig, submitted_at = now(), step_since = now(), updated_at = now(),
    completed_at = null, letter_path = null, letter_at = null
  where id = r.id;

  perform public.add_log(r.id, 'sent', 'ส่งขออนุมัติ · Sent for approval', coalesce(p_message,''), first_approver);
  perform public.notify(first_approver, r.id, 'wait', 'มีคำขอรอคุณอนุมัติ · Waiting for your approval',
    v_no || ' · ' || p.name || ' · ' || to_char(v_total, 'FM999,999,999,990.00') || ' บาท');
  perform public.notify(auth.uid(), r.id, 'ok', 'ส่งขออนุมัติสำเร็จ · Request sent',
    v_no || ' ส่งถึง ' || public.user_name(first_approver) || ' (ขั้นที่ 1 จาก ' || i || ')');

  return jsonb_build_object('no', v_no, 'steps', i, 'first_approver', public.user_name(first_approver));
end $$;

create or replace function public.approve_request(p_id uuid, p_comment text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  st public.request_steps;
  nxt public.request_steps;
  sig text;
  total_steps int;
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

  select count(*) into total_steps from public.request_steps where request_id = p_id;
  select * into nxt from public.request_steps where request_id = p_id and step_no = st.step_no + 1;

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

create or replace function public.reject_request(p_id uuid, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  st public.request_steps;
begin
  if coalesce(btrim(p_comment),'') = '' then raise exception 'ระบุเหตุผลที่ไม่อนุมัติ · A reason is required'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'คำขอนี้ไม่อยู่ระหว่างรออนุมัติ · Not pending'; end if;
  select * into st from public.request_steps where request_id = p_id and step_no = r.current_step;
  if st.approver_id is distinct from auth.uid() then
    raise exception 'ขั้นนี้ไม่ได้รอคุณอนุมัติ · This step is not waiting for you';
  end if;
  update public.request_steps set status='rejected', acted_at=now(), comment=btrim(p_comment), signer_id=auth.uid()
   where id = st.id;
  update public.request_steps set status='cancelled' where request_id = p_id and status = 'waiting';
  update public.requests set status='rejected', completed_at=now(), updated_at=now() where id = p_id;
  perform public.add_log(p_id, 'rejected', 'ไม่อนุมัติ โดย ' || public.user_name(auth.uid()) || ' · Rejected', btrim(p_comment));
  perform public.notify(r.preparer_id, p_id, 'bad', 'คำขอไม่ได้รับอนุมัติ · Request rejected',
    r.no || ' · ' || btrim(p_comment));
end $$;

-- Final approver hands the step to another approver (who must have a signature)
create or replace function public.forward_candidates(p_id uuid)
returns table (id uuid, name text, pos text, pos_th text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.position, public.position_th(p.position)
  from public.profiles p
  where public.can_read_request(p_id)
    and p.status='active' and 'approver' = any(p.roles) and p.position is not null
    and exists (select 1 from public.signatures s where s.user_id = p.id)
    and not exists (select 1 from public.request_steps st
                    where st.request_id = p_id and p.id in (st.approver_id, st.signer_id))
  order by p.name
$$;

create or replace function public.forward_request(p_id uuid, p_to uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  st public.request_steps;
  last_no int;
begin
  if coalesce(btrim(p_reason),'') = '' then raise exception 'ระบุเหตุผล · A reason is required'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception 'คำขอนี้ไม่อยู่ระหว่างรออนุมัติ · Not pending'; end if;
  select * into st from public.request_steps where request_id = p_id and step_no = r.current_step;
  select max(step_no) into last_no from public.request_steps where request_id = p_id;
  if st.approver_id is distinct from auth.uid() then raise exception 'ขั้นนี้ไม่ได้รอคุณอนุมัติ · Not your step'; end if;
  if st.step_no <> last_no then raise exception 'ส่งต่อได้เฉพาะผู้อนุมัติลำดับสุดท้าย · Final approver only'; end if;
  if not exists (select 1 from public.forward_candidates(p_id) c where c.id = p_to) then
    raise exception 'บัญชีนี้รับอนุมัติแทนไม่ได้ (ต้องเป็นผู้อนุมัติที่มีลายเซ็น) · Not an eligible approver';
  end if;
  update public.request_steps set approver_id = p_to,
         on_behalf_of = coalesce(on_behalf_of, auth.uid()) where id = st.id;
  update public.requests set step_since = now(), updated_at = now() where id = p_id;
  perform public.add_log(p_id, 'forwarded',
    'ส่งให้ ' || public.user_name(p_to) || ' อนุมัติแทน ' || public.user_name(auth.uid()) || ' · Forwarded',
    btrim(p_reason), p_to);
  perform public.notify(p_to, p_id, 'wait', 'มีคำขอให้คุณอนุมัติแทน · Approve on behalf',
    r.no || ' · แทน ' || public.user_name(auth.uid()) || ' · ' || btrim(p_reason));
  perform public.notify(r.preparer_id, p_id, 'info', 'ผู้อนุมัติส่งต่อให้ผู้อื่นอนุมัติแทน · Forwarded',
    r.no || ' · ' || public.user_name(p_to));
end $$;

create or replace function public.cancel_request(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  a uuid;
begin
  if coalesce(btrim(p_reason),'') = '' then raise exception 'ระบุเหตุผล · A reason is required'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคำขอ · Not found'; end if;
  if not (public.is_admin() or (r.preparer_id = auth.uid() and public.is_active())) then
    raise exception 'ไม่มีสิทธิ์ยกเลิก · Not allowed';
  end if;
  if r.status not in ('draft','pending') then raise exception 'ยกเลิกได้เฉพาะคำขอที่ยังไม่เสร็จ · Only open requests'; end if;
  select approver_id into a from public.request_steps where request_id = p_id and status = 'pending';
  update public.request_steps set status='cancelled' where request_id = p_id and status in ('pending','waiting');
  update public.requests set status='cancelled', completed_at=now(), updated_at=now() where id = p_id;
  perform public.add_log(p_id, 'cancelled',
    case when r.preparer_id = auth.uid() then 'ผู้จัดทำยกเลิกคำขอ · Cancelled by preparer'
         else 'ผู้ดูแลยกเลิกคำขอ · Cancelled by admin' end, btrim(p_reason));
  if r.preparer_id <> auth.uid() then
    perform public.notify(r.preparer_id, p_id, 'bad', 'คำขอถูกยกเลิก · Request cancelled', coalesce(r.no,'') || ' · ' || btrim(p_reason));
  end if;
  if a is not null and a <> auth.uid() then
    perform public.notify(a, p_id, 'info', 'คำขอที่รอคุณถูกยกเลิก · Request cancelled', coalesce(r.no,''));
  end if;
end $$;

-- Preparer reopens a rejected request to edit and resend (keeps number & history)
create or replace function public.reopen_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null or r.preparer_id <> auth.uid() then raise exception 'ไม่ใช่คำขอของคุณ · Not your request'; end if;
  if r.status <> 'rejected' then raise exception 'แก้ไขได้เฉพาะคำขอที่ไม่อนุมัติ · Only rejected requests'; end if;
  update public.requests set status='draft', completed_at=null, updated_at=now() where id = p_id;
  perform public.add_log(p_id, 'reopened', 'ผู้จัดทำนำกลับมาแก้ไข · Reopened for editing');
end $$;

create or replace function public.admin_remind(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; a uuid;
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  select * into r from public.requests where id = p_id;
  if r.status <> 'pending' then raise exception 'คำขอนี้ไม่ได้รออนุมัติ · Not pending'; end if;
  select approver_id into a from public.request_steps where request_id = p_id and step_no = r.current_step;
  perform public.notify(a, p_id, 'wait', 'เตือน: มีคำขอรอคุณอนุมัติ · Reminder', r.no || ' · ' || r.product_name);
  perform public.add_log(p_id, 'reminded', 'ผู้ดูแลส่งเตือนผู้อนุมัติ · Reminder sent', '', a);
end $$;

create or replace function public.admin_reassign(p_id uuid, p_to uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; st public.request_steps;
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'ระบุเหตุผล · A reason is required'; end if;
  select * into r from public.requests where id = p_id for update;
  if r.status <> 'pending' then raise exception 'คำขอนี้ไม่ได้รออนุมัติ · Not pending'; end if;
  if not exists (select 1 from public.profiles where id = p_to and status='active' and 'approver' = any(roles)) then
    raise exception 'ต้องเลือกผู้อนุมัติที่ใช้งานอยู่ · Choose an active approver';
  end if;
  select * into st from public.request_steps where request_id = p_id and step_no = r.current_step;
  update public.request_steps set approver_id = p_to where id = st.id;
  update public.requests set step_since = now(), updated_at = now() where id = p_id;
  perform public.add_log(p_id, 'reassigned', 'ผู้ดูแลเปลี่ยนผู้อนุมัติเป็น ' || public.user_name(p_to) || ' · Reassigned', btrim(p_reason), p_to);
  perform public.notify(p_to, p_id, 'wait', 'มีคำขอรอคุณอนุมัติ · Waiting for your approval', r.no || ' · ' || r.product_name);
  if st.approver_id is not null and st.approver_id <> p_to then
    perform public.notify(st.approver_id, p_id, 'info', 'คำขอถูกโอนให้ผู้อื่น · Reassigned', r.no);
  end if;
end $$;

-- Store the generated PDF path (once). Admins may replace it.
create or replace function public.set_letter(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_id for update;
  if r.status <> 'approved' then raise exception 'ยังไม่อนุมัติครบ · Not fully approved'; end if;
  if not public.can_read_request(p_id) then raise exception 'ไม่มีสิทธิ์ · Not allowed'; end if;
  if p_path not like p_id::text || '/%' then raise exception 'ตำแหน่งไฟล์ไม่ถูกต้อง · Bad path'; end if;
  if r.letter_path is not null and not public.is_admin() then return; end if;
  update public.requests set letter_path = p_path, updated_at = now() where id = p_id;
  perform public.add_log(p_id, 'pdf', 'บันทึกหนังสืออนุมัติเป็น PDF · Letter saved as PDF');
end $$;

-- Admin "view as user": what this person sees
create or replace function public.admin_user_overview(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user),
    'has_signature', exists (select 1 from public.signatures s where s.user_id = p_user),
    'my_requests', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, no, status, product_name, total, created_at, current_step from public.requests
        where preparer_id = p_user order by created_at desc limit 50) x), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(x) from (
        select r.id, r.no, r.product_name, r.total, r.step_since from public.requests r
        join public.request_steps s on s.request_id = r.id and s.step_no = r.current_step
        where r.status='pending' and s.approver_id = p_user) x), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, kind, title, body, link, read_at, created_at from public.notifications
        where user_id = p_user order by created_at desc limit 30) x), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(x order by x.at desc) from (
        select id, at, page, action, message, status from public.app_errors
        where user_id = p_user order by at desc limit 30) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 7. Row level security
-- ---------------------------------------------------------------------

alter table public.app_settings     enable row level security;
alter table public.positions        enable row level security;
alter table public.tiers            enable row level security;
alter table public.departments      enable row level security;
alter table public.companies        enable row level security;
alter table public.products         enable row level security;
alter table public.profiles         enable row level security;
alter table public.signatures       enable row level security;
alter table public.request_counters enable row level security;
alter table public.requests         enable row level security;
alter table public.request_steps    enable row level security;
alter table public.request_files    enable row level security;
alter table public.request_log      enable row level security;
alter table public.notifications    enable row level security;
alter table public.app_errors       enable row level security;

-- reference data: any signed-in user reads (the apply form needs departments); admins write
do $$
declare tbl text;
begin
  foreach tbl in array array['app_settings','positions','tiers','departments','companies','products'] loop
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (true)', tbl);
    execute format('create policy "%1$s admin write" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', tbl);
  end loop;
end $$;

-- profiles: you always see yourself; active users see everyone (names for dropdowns)
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active());
create policy "profiles admin write" on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- signatures: owner + admins
create policy "signatures read" on public.signatures for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "signatures write own" on public.signatures for all to authenticated
  using ((user_id = auth.uid() and public.is_active()) or public.is_admin())
  with check ((user_id = auth.uid() and public.is_active()) or public.is_admin());

-- requests: read if involved; preparers create & edit their own drafts only
create policy "requests read" on public.requests for select to authenticated
  using (public.can_read_request(id));
create policy "requests insert draft" on public.requests for insert to authenticated
  with check (preparer_id = auth.uid() and status = 'draft' and no is null and public.has_role('preparer'));
create policy "requests update draft" on public.requests for update to authenticated
  using (preparer_id = auth.uid() and status = 'draft')
  with check (preparer_id = auth.uid() and status = 'draft');
create policy "requests delete draft" on public.requests for delete to authenticated
  using (preparer_id = auth.uid() and status = 'draft' and no is null);

create policy "steps read" on public.request_steps for select to authenticated
  using (public.can_read_request(request_id));
create policy "log read" on public.request_log for select to authenticated
  using (public.can_read_request(request_id));

create policy "files read" on public.request_files for select to authenticated
  using (public.can_read_request(request_id));
create policy "files add to own draft" on public.request_files for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (
    select 1 from public.requests r where r.id = request_id and r.preparer_id = auth.uid() and r.status = 'draft'));
create policy "files remove from own draft" on public.request_files for delete to authenticated
  using (exists (
    select 1 from public.requests r where r.id = request_id and r.preparer_id = auth.uid() and r.status = 'draft'));

create policy "notifications own" on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "errors report" on public.app_errors for insert to authenticated
  with check (user_id = auth.uid() and status = 'open' and admin_note = '');
create policy "errors admin read" on public.app_errors for select to authenticated
  using (public.is_admin());
create policy "errors admin update" on public.app_errors for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- column-level limits on top of RLS
revoke update on public.notifications from authenticated;
grant  update (read_at) on public.notifications to authenticated;
revoke update on public.requests from authenticated;
grant  update (subject_type, sku, product_name, qty, unit, unit_price, dept, purpose, buyer_id,
               company_id, vendor, quote_no, quote_date, details, comparisons, no_comp,
               no_comp_reason, low_reason, message, updated_at) on public.requests to authenticated;
revoke insert on public.requests from authenticated;
grant  insert (id, preparer_id, subject_type, sku, product_name, qty, unit, unit_price, dept, purpose,
               buyer_id, company_id, vendor, quote_no, quote_date, details, comparisons, no_comp,
               no_comp_reason, low_reason, message) on public.requests to authenticated;

-- functions are callable by signed-in users only
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

-- ---------------------------------------------------------------------
-- 8. Realtime (live bell & status)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.requests;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. File storage
--   attachments/<request_id>/<file>  quotations (private)
--   letters/<request_id>/<no>.pdf    approval letters (private)
--   logos/<company_id>/<file>        letterhead logos (public)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400),
       ('letters', 'letters', false, 26214400),
       ('logos', 'logos', true, 2097152)
on conflict (id) do nothing;

create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and public.can_read_request(public.try_uuid((storage.foldername(name))[1])));
create policy "attachments upload to own draft" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and exists (
    select 1 from public.requests r
    where r.id = public.try_uuid((storage.foldername(name))[1])
      and r.preparer_id = auth.uid() and r.status = 'draft'));
create policy "attachments delete from own draft" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and exists (
    select 1 from public.requests r
    where r.id = public.try_uuid((storage.foldername(name))[1])
      and r.preparer_id = auth.uid() and r.status = 'draft'));

create policy "letters read" on storage.objects for select to authenticated
  using (bucket_id = 'letters'
         and public.can_read_request(public.try_uuid((storage.foldername(name))[1])));
create policy "letters create when approved" on storage.objects for insert to authenticated
  with check (bucket_id = 'letters' and exists (
    select 1 from public.requests r
    where r.id = public.try_uuid((storage.foldername(name))[1]) and r.status = 'approved')
    and public.can_read_request(public.try_uuid((storage.foldername(name))[1])));
create policy "letters admin manage" on storage.objects for all to authenticated
  using (bucket_id = 'letters' and public.is_admin())
  with check (bucket_id = 'letters' and public.is_admin());

create policy "logos read" on storage.objects for select
  using (bucket_id = 'logos');
create policy "logos admin manage" on storage.objects for all to authenticated
  using (bucket_id = 'logos' and public.is_admin())
  with check (bucket_id = 'logos' and public.is_admin());
