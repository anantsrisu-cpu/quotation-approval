-- 0026 · ราคาต่อหน่วยทศนิยม 4 ตำแหน่ง · Unit prices with up to 4 decimals
-- Unit prices (as quoted, after discount, and converted from Incl. VAT) keep 4 decimals,
-- e.g. 26.7625 × 40,000 = 1,070,500.00. Line totals, VAT and the grand total stay at 2 decimals.
-- submit_request is unchanged: it already calls apply_discount() and price_ex(); only their rounding changes.
-- Safe to run more than once.

-- the single-item summary column on the request (lists) keeps 4 decimals too
alter table public.requests alter column unit_price type numeric(16,4);

-- Net unit price after a discount — rounded to 4 decimals (was 2)
create or replace function public.apply_discount(p_price numeric, p_disc text, p_label text default '')
returns numeric language plpgsql immutable as $$
declare
  d text := public.norm_discount(p_disc);
  lbl text := case when coalesce(p_label, '') = '' then '' else p_label || ': ' end;
  part text;
  v numeric;
  net numeric := p_price;
begin
  if d = '' then return round(p_price, 4); end if;
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
  net := round(net, 4);
  if net <= 0 then
    raise exception '%ราคาหลังหักส่วนลดต้องมากกว่า 0 · Net price must be above zero', lbl;
  end if;
  return net;
end $$;

-- Incl. VAT price → before VAT, rounded to 4 decimals (was 2)
create or replace function public.price_ex(p numeric, p_mode text, p_rate numeric) returns numeric
language sql immutable as $$ select case when p_mode = 'inc' then round(p / (1 + p_rate), 4) else p end $$;

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
