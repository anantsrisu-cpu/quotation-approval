-- =====================================================================
-- 0003 · Multiple line items, previous price, admin pre-created accounts,
--        admin drafting on behalf of a preparer
--
-- Run once in Supabase → SQL Editor after 0001 and 0002.
-- Safe for existing data: old single-item requests are converted to the
-- new "items" format and keep displaying the same amounts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Request line items & who drafted the request
-- ---------------------------------------------------------------------
-- items: [{sku, product_name, description, qty, unit, unit_price, prev_price}]
--   after submit each line also has line_total and prev_diff_pct (computed by the server)
-- comparisons: [{vendor, prices:[unit price per item, same order as items]}]
--   after submit also lines:[line totals], subtotal, total, diff
alter table public.requests
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists created_by uuid references public.profiles(id);

alter table public.requests
  drop constraint if exists requests_items_check;
alter table public.requests
  add constraint requests_items_check
  check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200);

alter table public.requests alter column created_by set default auth.uid();
update public.requests set created_by = preparer_id where created_by is null;

-- convert existing single-item requests
update public.requests set items = jsonb_build_array(jsonb_build_object(
    'sku', sku, 'product_name', product_name, 'description', '',
    'qty', qty, 'unit', unit, 'unit_price', unit_price, 'prev_price', null,
    'line_total', case when status = 'draft' then null else subtotal end))
 where items = '[]'::jsonb and btrim(sku) <> '';

update public.requests r set comparisons = coalesce((
    select jsonb_agg(c || jsonb_build_object(
             'prices', jsonb_build_array(coalesce(nullif(c->>'unit_price','')::numeric, 0)),
             'lines', case when c ? 'subtotal' then jsonb_build_array(c->'subtotal') else '[]'::jsonb end)
           order by o)
      from jsonb_array_elements(r.comparisons) with ordinality as x(c, o)), '[]'::jsonb)
 where jsonb_array_length(r.comparisons) > 0
   and not (r.comparisons->0 ? 'prices');

-- ---------------------------------------------------------------------
-- 2. Accounts pre-created by an admin (applied at first Microsoft sign-in)
-- ---------------------------------------------------------------------
create table if not exists public.user_invites (
  email      text primary key check (email = lower(btrim(email)) and email like '%@%'),
  name       text not null default '',
  title      text not null default '',
  dept       text references public.departments(id),
  roles      text[] not null check (cardinality(roles) > 0
                                   and roles <@ array['preparer','approver','admin']::text[]),
  position   text references public.positions(code),
  signature  text check (signature is null or (signature like 'data:image/%' and length(signature) < 400000)),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    uuid references public.profiles(id) on delete set null
);
alter table public.user_invites enable row level security;
drop policy if exists "invites admin" on public.user_invites;
create policy "invites admin" on public.user_invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- New sign-in: first user = admin; a pre-created account = active straight away;
-- everyone else applies for an account as before.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  inv public.user_invites;
begin
  select not exists (select 1 from public.profiles) into first_user;
  select * into inv from public.user_invites
   where email = lower(btrim(coalesce(new.email,''))) and used_at is null;

  if inv.email is not null and not first_user then
    insert into public.profiles (id, email, name, title, dept, roles, position, status,
                                 review_note, reviewed_by, reviewed_at)
    values (new.id, coalesce(new.email,''),
            coalesce(nullif(inv.name,''), new.raw_user_meta_data->>'full_name',
                     new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''), '@', 1)),
            inv.title, inv.dept, inv.roles, inv.position, 'active',
            'สร้างบัญชีล่วงหน้าโดยผู้ดูแล · Pre-created by admin', inv.created_by, now());
    if inv.signature is not null then
      insert into public.signatures (user_id, data, updated_by) values (new.id, inv.signature, inv.created_by);
    end if;
    update public.user_invites set used_at = now(), used_by = new.id, signature = null
     where email = inv.email;
    perform public.notify(new.id, null, 'ok', 'บัญชีของคุณพร้อมใช้งาน · Your account is ready',
      'ผู้ดูแลระบบสร้างบัญชีไว้ให้แล้ว · An admin set up your account');
    return new;
  end if;

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

-- Admin creates (or updates) an account by e-mail. If the person has already
-- signed in once, their profile is updated and activated right away.
create or replace function public.admin_create_account(p_email text, p_name text, p_title text,
    p_dept text, p_roles text[], p_position text, p_signature text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  e text := lower(btrim(coalesce(p_email,'')));
  pid uuid;
begin
  if not public.is_admin() then raise exception 'เฉพาะผู้ดูแลระบบ · Admins only'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'อีเมลไม่ถูกต้อง · Invalid e-mail'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'กรุณากรอกชื่อ · Name is required'; end if;
  if p_roles is null or cardinality(p_roles) = 0 or not (p_roles <@ array['preparer','approver','admin']) then
    raise exception 'เลือกบทบาทอย่างน้อย 1 บทบาท · Choose at least one role';
  end if;
  if 'approver' = any(p_roles) and coalesce(p_position,'') = '' then
    raise exception 'ผู้อนุมัติต้องมีตำแหน่งอนุมัติ · Approvers need a position';
  end if;
  if p_signature is not null and p_signature <> '' and p_signature not like 'data:image/%' then
    raise exception 'ลายเซ็นต้องเป็นรูปภาพ · Signature must be an image';
  end if;

  select id into pid from public.profiles where lower(email) = e limit 1;
  if pid is not null then
    update public.profiles
       set name = btrim(p_name), title = coalesce(btrim(p_title),''), dept = nullif(p_dept,''),
           roles = p_roles, position = nullif(p_position,''), status = 'active',
           review_note = 'ตั้งค่าโดยผู้ดูแล · Set up by admin', reviewed_by = auth.uid(), reviewed_at = now()
     where id = pid;
    if coalesce(p_signature,'') <> '' then
      insert into public.signatures (user_id, data, updated_at, updated_by)
      values (pid, p_signature, now(), auth.uid())
      on conflict (user_id) do update set data = excluded.data, updated_at = now(), updated_by = auth.uid();
    end if;
    perform public.notify(pid, null, 'ok', 'บัญชีของคุณพร้อมใช้งาน · Your account is ready',
      'ผู้ดูแลระบบตั้งค่าบัญชีให้แล้ว · An admin set up your account');
    return 'updated';
  end if;

  insert into public.user_invites (email, name, title, dept, roles, position, signature, created_by)
  values (e, btrim(p_name), coalesce(btrim(p_title),''), nullif(p_dept,''), p_roles,
          nullif(p_position,''), nullif(p_signature,''), auth.uid())
  on conflict (email) do update set
    name = excluded.name, title = excluded.title, dept = excluded.dept, roles = excluded.roles,
    position = excluded.position, signature = coalesce(excluded.signature, public.user_invites.signature),
    created_by = auth.uid(), created_at = now(), used_at = null, used_by = null;
  return 'invited';
end $$;

-- ---------------------------------------------------------------------
-- 3. Who may edit a draft: its preparer, or the admin who drafted it
-- ---------------------------------------------------------------------
create or replace function public.can_edit_draft(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and exists (
    select 1 from public.requests r
    where r.id = rid and r.status = 'draft'
      and (r.preparer_id = auth.uid() or (r.created_by = auth.uid() and public.is_admin())))
$$;

create or replace function public.is_active_preparer(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = p and status = 'active' and 'preparer' = any(roles))
$$;

create or replace function public.can_read_request(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and (
    public.is_admin()
    or exists (select 1 from public.requests r
               where r.id = rid and auth.uid() in (r.preparer_id, r.buyer_id, r.created_by))
    or exists (select 1 from public.request_steps s
               where s.request_id = rid
                 and auth.uid() in (s.approver_id, s.signer_id, s.on_behalf_of))
  )
$$;

drop policy if exists "requests insert draft" on public.requests;
drop policy if exists "requests update draft" on public.requests;
drop policy if exists "requests delete draft" on public.requests;

create policy "requests insert draft" on public.requests for insert to authenticated
  with check (status = 'draft' and no is null and created_by = auth.uid() and (
    (preparer_id = auth.uid() and public.has_role('preparer'))
    or (public.is_admin() and public.is_active_preparer(preparer_id))));
create policy "requests update draft" on public.requests for update to authenticated
  using (status = 'draft' and (preparer_id = auth.uid() or (created_by = auth.uid() and public.is_admin())))
  with check (status = 'draft' and (
    preparer_id = auth.uid()
    or (created_by = auth.uid() and public.is_admin() and public.is_active_preparer(preparer_id))));
create policy "requests delete draft" on public.requests for delete to authenticated
  using (status = 'draft' and no is null
         and (preparer_id = auth.uid() or (created_by = auth.uid() and public.is_admin())));

drop policy if exists "files add to own draft" on public.request_files;
drop policy if exists "files remove from own draft" on public.request_files;
create policy "files add to own draft" on public.request_files for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_edit_draft(request_id));
create policy "files remove from own draft" on public.request_files for delete to authenticated
  using (public.can_edit_draft(request_id));

drop policy if exists "attachments upload to own draft" on storage.objects;
drop policy if exists "attachments delete from own draft" on storage.objects;
create policy "attachments upload to own draft" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments'
              and public.can_edit_draft(public.try_uuid((storage.foldername(name))[1])));
create policy "attachments delete from own draft" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments'
         and public.can_edit_draft(public.try_uuid((storage.foldername(name))[1])));

revoke update on public.requests from authenticated;
grant  update (preparer_id, subject_type, sku, product_name, qty, unit, unit_price, dept, purpose, buyer_id,
               company_id, vendor, quote_no, quote_date, details, items, comparisons, no_comp,
               no_comp_reason, low_reason, message, updated_at) on public.requests to authenticated;
revoke insert on public.requests from authenticated;
grant  insert (id, preparer_id, subject_type, sku, product_name, qty, unit, unit_price, dept, purpose,
               buyer_id, company_id, vendor, quote_no, quote_date, details, items, comparisons, no_comp,
               no_comp_reason, low_reason, message) on public.requests to authenticated;

-- ---------------------------------------------------------------------
-- 4. Submit: every amount is recomputed here from the line items
-- ---------------------------------------------------------------------
create or replace function public.submit_request(p_id uuid, p_message text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
  s public.app_settings;
  p public.products;
  t public.tiers;
  v_items jsonb;
  out_items jsonb := '[]'::jsonb;
  it jsonb; k int; n int;
  v_qty numeric; v_up numeric; v_prev numeric; v_line numeric;
  v_sub numeric := 0; v_vat numeric; v_total numeric;
  comps jsonb := '[]'::jsonb;
  c jsonb; prices jsonb; lines jsonb;
  c_up numeric; c_sub numeric; c_total numeric; min_total numeric;
  pos text; a uuid; i int := 0; missing text := '';
  y int; cnt int; v_no text;
  sig text;
  first_approver uuid;
  proxy boolean;
  skus text; first_name text;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception 'ไม่พบคำขอ · Request not found'; end if;
  proxy := r.preparer_id <> auth.uid();
  if proxy then
    if not (public.is_admin() and r.created_by = auth.uid()) then
      raise exception 'ส่งได้เฉพาะคำขอของคุณ · Not your request';
    end if;
    if not public.is_active_preparer(r.preparer_id) then
      raise exception 'ผู้จัดทำที่เลือกไม่มีสิทธิ์สร้างคำขอ · The chosen preparer is not an active preparer';
    end if;
  elsif not public.has_role('preparer') then
    raise exception 'บัญชีนี้ไม่มีสิทธิ์สร้างคำขอ · Preparer role required';
  end if;
  if r.status <> 'draft' then raise exception 'คำขอนี้ส่งไปแล้ว · Already sent'; end if;

  select * into s from public.app_settings where id = 1;
  if btrim(r.vendor) = '' then raise exception 'กรอกชื่อผู้ขาย · Vendor required'; end if;
  if r.buyer_id is null then raise exception 'เลือกผู้ซื้อ · Buyer required'; end if;
  if r.company_id is null then raise exception 'เลือกบริษัทผู้ซื้อ · Buyer company required'; end if;
  if r.dept is null then raise exception 'เลือกฝ่ายที่ขอซื้อ · Department required'; end if;
  if not exists (select 1 from public.request_files f where f.request_id = r.id) then
    raise exception 'แนบใบเสนอราคาอย่างน้อย 1 ไฟล์ · Attach at least one quotation file';
  end if;

  -- line items (older drafts kept the single item in the request columns)
  v_items := r.items;
  if jsonb_array_length(v_items) = 0 and btrim(r.sku) <> '' then
    v_items := jsonb_build_array(jsonb_build_object('sku', r.sku, 'description', '', 'qty', r.qty,
                 'unit', r.unit, 'unit_price', r.unit_price, 'prev_price', null));
  end if;
  n := jsonb_array_length(v_items);
  if n = 0 then raise exception 'เพิ่มรายการสินค้าอย่างน้อย 1 รายการ · Add at least one item'; end if;

  for k in 0 .. n - 1 loop
    it := v_items->k;
    select * into p from public.products where sku = upper(btrim(coalesce(it->>'sku',''))) and active;
    if p.sku is null then
      raise exception 'รายการที่ %: ไม่พบ SKU "%" ในรายการสินค้า · SKU not found', k + 1, coalesce(it->>'sku','');
    end if;
    v_qty := coalesce(nullif(it->>'qty','')::numeric, 0);
    v_up  := coalesce(nullif(it->>'unit_price','')::numeric, 0);
    v_prev := nullif(it->>'prev_price','')::numeric;
    if v_qty <= 0 then raise exception 'รายการที่ %: กรอกจำนวน · Quantity required', k + 1; end if;
    if v_up <= 0 then raise exception 'รายการที่ %: กรอกราคาต่อหน่วย · Unit price required', k + 1; end if;
    if v_prev is not null and v_prev < 0 then raise exception 'รายการที่ %: ราคาก่อนหน้าติดลบไม่ได้ · Previous price cannot be negative', k + 1; end if;
    if length(coalesce(it->>'description','')) > 4000 then
      raise exception 'รายการที่ %: คำต่อท้ายยาวเกิน 4,000 ตัวอักษร · Description too long', k + 1;
    end if;
    v_line := round(v_up * v_qty, 2);
    v_sub := v_sub + v_line;
    out_items := out_items || jsonb_build_object(
      'sku', p.sku, 'product_name', p.name, 'description', btrim(coalesce(it->>'description','')),
      'qty', v_qty, 'unit', coalesce(nullif(btrim(it->>'unit'),''), p.unit),
      'unit_price', v_up, 'prev_price', v_prev, 'line_total', v_line,
      'prev_diff_pct', case when v_prev > 0 then round((v_up - v_prev) / v_prev * 100, 2) end);
    if k = 0 then first_name := p.name; end if;
  end loop;

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
      if btrim(coalesce(c->>'vendor','')) = '' then
        raise exception 'กรอกชื่อผู้ขายของคู่เทียบให้ครบ · Complete every comparison vendor';
      end if;
      prices := case when jsonb_typeof(c->'prices') = 'array' then c->'prices'
                     when n = 1 and c ? 'unit_price' then jsonb_build_array(c->'unit_price')
                     else '[]'::jsonb end;
      if jsonb_array_length(prices) <> n then
        raise exception 'กรอกราคาต่อหน่วยของ % ให้ครบทุกรายการ · Enter a price for every item', btrim(c->>'vendor');
      end if;
      c_sub := 0; lines := '[]'::jsonb;
      for k in 0 .. n - 1 loop
        c_up := coalesce(nullif(prices->>k,'')::numeric, 0);
        if c_up <= 0 then
          raise exception 'กรอกราคาต่อหน่วยของ % ให้ครบทุกรายการ (รายการที่ %) · Enter a price for every item',
            btrim(c->>'vendor'), k + 1;
        end if;
        v_line := round(c_up * (out_items->k->>'qty')::numeric, 2);
        c_sub := c_sub + v_line;
        lines := lines || to_jsonb(v_line);
      end loop;
      -- normalise prices to numbers
      select coalesce(jsonb_agg(to_jsonb(coalesce(nullif(x,'')::numeric,0)) order by o), '[]'::jsonb)
        into prices from jsonb_array_elements_text(prices) with ordinality as e(x, o);
      c_total := c_sub + round(c_sub * s.vat_rate, 2);
      min_total := least(coalesce(min_total, c_total), c_total);
      comps := comps || jsonb_build_array(
                 jsonb_build_object('vendor', btrim(c->>'vendor'), 'prices', prices, 'lines', lines,
                   'subtotal', c_sub, 'total', c_total, 'diff', c_total - v_total)
                 || case when n = 1 then jsonb_build_object('unit_price', prices->0) else '{}'::jsonb end);
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

  v_no := r.no;
  if v_no is null then
    y := extract(year from now() at time zone 'Asia/Bangkok');
    insert into public.request_counters (year, last) values (y, 1)
      on conflict (year) do update set last = public.request_counters.last + 1
      returning last into cnt;
    v_no := s.request_prefix || '-' || y || '-' || lpad(cnt::text, 4, '0');
  end if;

  -- the letter carries the real preparer's signature
  select data into sig from public.signatures where user_id = r.preparer_id;
  select string_agg(distinct x->>'sku', ', ') into skus from jsonb_array_elements(out_items) x;

  update public.requests set
    no = v_no, status = 'pending', items = out_items,
    sku = left(skus, 500),
    product_name = first_name || case when n > 1 then ' และอีก ' || (n - 1) || ' รายการ' else '' end,
    qty = case when n = 1 then (out_items->0->>'qty')::numeric else n end,
    unit = case when n = 1 then out_items->0->>'unit' else 'รายการ' end,
    unit_price = case when n = 1 then (out_items->0->>'unit_price')::numeric else 0 end,
    subtotal = v_sub, vat = v_vat, total = v_total, vat_rate = s.vat_rate,
    comparisons = case when r.no_comp then '[]'::jsonb else comps end,
    low_reason = case when r.no_comp or min_total >= v_total then '' else r.low_reason end,
    no_comp_reason = case when r.no_comp then r.no_comp_reason else '' end,
    tier_label = t.label, current_step = 0, message = coalesce(p_message, ''),
    preparer_signature = sig, submitted_at = now(), step_since = now(), updated_at = now(),
    completed_at = null, letter_path = null, letter_at = null
  where id = r.id;

  perform public.add_log(r.id, 'sent', 'ส่งขออนุมัติ · Sent for approval' ||
    case when proxy then ' (จัดทำแทน ' || public.user_name(r.preparer_id) || ' โดย ' || public.user_name(auth.uid()) || ')' else '' end,
    coalesce(p_message,''), first_approver);
  perform public.notify(first_approver, r.id, 'wait', 'มีคำขอรอคุณอนุมัติ · Waiting for your approval',
    v_no || ' · ' || first_name || case when n > 1 then ' +' || (n - 1) else '' end || ' · ' ||
    to_char(v_total, 'FM999,999,999,990.00') || ' บาท');
  perform public.notify(auth.uid(), r.id, 'ok', 'ส่งขออนุมัติสำเร็จ · Request sent',
    v_no || ' ส่งถึง ' || public.user_name(first_approver) || ' (ขั้นที่ 1 จาก ' || i || ')');
  if proxy then
    perform public.notify(r.preparer_id, r.id, 'info', 'ผู้ดูแลส่งคำขอแทนคุณ · Sent on your behalf',
      v_no || ' · จัดทำแทนโดย ' || public.user_name(auth.uid()));
  end if;

  return jsonb_build_object('no', v_no, 'steps', i, 'items', n, 'first_approver', public.user_name(first_approver));
end $$;

-- Reopen a rejected request: its preparer, or the admin who drafted it
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

-- function permissions (same rule as 0001: signed-in users only)
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

-- tell the Supabase API about the new columns right away
notify pgrst, 'reload schema';
