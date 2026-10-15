-- =====================================================================
-- 0004 · Discounts per item (selected vendor and comparison vendors),
--        credit term (days) and lead time (days) per vendor
--
-- Run once in Supabase → SQL Editor after 0003. Safe to run again.
--
-- Discount text, per unit price:  "5%"  ·  "100" (baht per unit)  ·  "10%+5%" (stacked)
-- net unit price = price, minus each step in order, rounded to 2 decimals
-- line amount    = net unit price × quantity (rounded to 2 decimals)
-- =====================================================================

alter table public.requests
  add column if not exists credit_days int check (credit_days between 0 and 3650),
  add column if not exists lead_days   int check (lead_days between 0 and 3650);

-- Clean up a discount as typed: no spaces or commas, "" when there is none
create or replace function public.norm_discount(p text) returns text
language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '[\s,]', '', 'g')
$$;

-- Net unit price after a discount like "5%", "100" or "10%+5%"
create or replace function public.apply_discount(p_price numeric, p_disc text, p_label text default '')
returns numeric language plpgsql immutable as $$
declare
  d text := public.norm_discount(p_disc);
  lbl text := case when coalesce(p_label, '') = '' then '' else p_label || ': ' end;
  part text;
  v numeric;
  net numeric := p_price;
begin
  if d = '' then return round(p_price, 2); end if;
  if d !~ '^[0-9]+(\.[0-9]+)?%?(\+[0-9]+(\.[0-9]+)?%?)*$' then
    raise exception '%รูปแบบส่วนลด "%" ไม่ถูกต้อง ใช้ 5%% หรือ 100 หรือ 10%%+5%% · Invalid discount', lbl, p_disc;
  end if;
  foreach part in array string_to_array(d, '+') loop
    if right(part, 1) = '%' then
      v := left(part, -1)::numeric;
      if v > 100 then raise exception '%ส่วนลดเกิน 100%% · Discount over 100%%', lbl; end if;
      net := net * (1 - v / 100);
    else
      net := net - part::numeric;
    end if;
  end loop;
  net := round(net, 2);
  if net <= 0 then
    raise exception '%ราคาหลังหักส่วนลดต้องมากกว่า 0 · Net price must be above zero', lbl;
  end if;
  return net;
end $$;

-- Whole days from text ("" → null)
create or replace function public.days_or_null(p text, p_label text default '')
returns int language plpgsql immutable as $$
declare t text := btrim(coalesce(p, ''));
begin
  if t = '' or t = 'null' then return null; end if;
  if t !~ '^[0-9]{1,4}$' or t::int > 3650 then
    raise exception '%: ใส่จำนวนวันเป็นตัวเลข 0–3650 · Enter whole days 0–3650', p_label;
  end if;
  return t::int;
end $$;

grant update (credit_days, lead_days) on public.requests to authenticated;
grant insert (credit_days, lead_days) on public.requests to authenticated;

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
  v_qty numeric; v_up numeric; v_prev numeric; v_line numeric; v_net numeric; v_disc text;
  v_sub numeric := 0; v_vat numeric; v_total numeric;
  comps jsonb := '[]'::jsonb;
  c jsonb; prices jsonb; lines jsonb; discs jsonb; nets jsonb; c_disc text; c_net numeric;
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
  if r.credit_days is not null and (r.credit_days < 0 or r.credit_days > 3650) then
    raise exception 'เครดิตต้องเป็น 0–3650 วัน · Credit must be 0–3650 days';
  end if;
  if r.lead_days is not null and (r.lead_days < 0 or r.lead_days > 3650) then
    raise exception 'Lead time ต้องเป็น 0–3650 วัน · Lead time must be 0–3650 days';
  end if;
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
    v_disc := public.norm_discount(it->>'discount');
    v_net := public.apply_discount(v_up, v_disc, 'รายการที่ ' || (k + 1));
    v_line := round(v_net * v_qty, 2);
    v_sub := v_sub + v_line;
    out_items := out_items || jsonb_build_object(
      'sku', p.sku, 'product_name', p.name, 'description', btrim(coalesce(it->>'description','')),
      'qty', v_qty, 'unit', coalesce(nullif(btrim(it->>'unit'),''), p.unit),
      'unit_price', v_up, 'discount', v_disc, 'net_price', v_net,
      'prev_price', v_prev, 'line_total', v_line,
      'prev_diff_pct', case when v_prev > 0 then round((v_net - v_prev) / v_prev * 100, 2) end);
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
      c_sub := 0; lines := '[]'::jsonb; discs := '[]'::jsonb; nets := '[]'::jsonb;
      for k in 0 .. n - 1 loop
        c_up := coalesce(nullif(prices->>k,'')::numeric, 0);
        if c_up <= 0 then
          raise exception 'กรอกราคาต่อหน่วยของ % ให้ครบทุกรายการ (รายการที่ %) · Enter a price for every item',
            btrim(c->>'vendor'), k + 1;
        end if;
        c_disc := public.norm_discount(case when jsonb_typeof(c->'discounts') = 'array' then c->'discounts'->>k end);
        c_net := public.apply_discount(c_up, c_disc, btrim(c->>'vendor') || ' รายการที่ ' || (k + 1));
        v_line := round(c_net * (out_items->k->>'qty')::numeric, 2);
        c_sub := c_sub + v_line;
        lines := lines || to_jsonb(v_line);
        discs := discs || to_jsonb(c_disc);
        nets := nets || to_jsonb(c_net);
      end loop;
      -- normalise prices to numbers
      select coalesce(jsonb_agg(to_jsonb(coalesce(nullif(x,'')::numeric,0)) order by o), '[]'::jsonb)
        into prices from jsonb_array_elements_text(prices) with ordinality as e(x, o);
      c_total := c_sub + round(c_sub * s.vat_rate, 2);
      min_total := least(coalesce(min_total, c_total), c_total);
      comps := comps || jsonb_build_array(
                 jsonb_build_object('vendor', btrim(c->>'vendor'), 'prices', prices, 'discounts', discs,
                   'nets', nets, 'lines', lines, 'subtotal', c_sub, 'total', c_total, 'diff', c_total - v_total,
                   'credit_days', public.days_or_null(c->>'credit_days', 'เครดิตของ ' || btrim(c->>'vendor')),
                   'lead_days', public.days_or_null(c->>'lead_days', 'Lead time ของ ' || btrim(c->>'vendor')))
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
    unit_price = case when n = 1 then (out_items->0->>'net_price')::numeric else 0 end,
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

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
revoke execute on function public.notify(uuid, uuid, text, text, text) from authenticated;
revoke execute on function public.add_log(uuid, text, text, text, uuid) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;
