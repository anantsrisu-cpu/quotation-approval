-- 0026: unit prices keep up to 4 decimals; lines, VAT and totals stay at 2. Runs after 99g; applies 0026 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0026_price_4_decimals.sql
\i supabase/migrations/0026_price_4_decimals.sql
insert into products (company_id, sku, name, unit) values
  ('main', 'P4-1', 'สินค้าราคา 4 ตำแหน่ง', 'ชิ้น'), ('main', 'P4-2', 'สินค้ารวม VAT 4 ตำแหน่ง', 'ชิ้น')
  on conflict do nothing;

select t_check('apply_discount keeps 4 decimals', public.apply_discount(26.7625, '') = 26.7625
  and public.apply_discount(26.7625, '5%') = 25.4244 and public.apply_discount(26.76254, '') = 26.7625);
select t_check('price_ex keeps 4 decimals', public.price_ex(107.1234, 'inc', 0.07) = 100.1153 and public.price_ex(26.7625, 'ex', 0.07) = 26.7625);

-- 26.7625 × 40,000 = 1,070,500.00 · vendor B 26.7699 × 40,000 = 1,070,796.00
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, comparisons)
values ('d4d4d4d4-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย A','R11-HO.26110401',
  '[{"sku":"P4-1","qty":40000,"unit_price":26.7625}]',
  '[{"vendor":"ผู้ขาย B","prices":[26.7699],"discounts":[""]}]');
insert into request_files (request_id, path, name) values ('d4d4d4d4-0000-0000-0000-000000000001','d4d4d4d4-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('d4d4d4d4-0000-0000-0000-000000000001')::text;
reset role;
select t_check('26.7625 × 40,000 = 1,070,500.00 (price kept at 4 decimals)',
  (select (items->0->>'unit_price')::numeric = 26.7625 and (items->0->>'net_price')::numeric = 26.7625
      and (items->0->>'line_total')::numeric = 1070500.00 and unit_price = 26.7625
   from requests where id = 'd4d4d4d4-0000-0000-0000-000000000001'));
select t_check('VAT and total at 2 decimals: 74,935.00 · 1,145,435.00',
  (select subtotal = 1070500 and vat = 74935 and total = 1145435 from requests where id = 'd4d4d4d4-0000-0000-0000-000000000001'));
select t_check('comparison price kept at 4 decimals, line 1,070,796.00, ✓ stays on the cheaper A',
  (select (comparisons->0->'nets'->>0)::numeric = 26.7699 and (comparisons->0->'lines'->>0)::numeric = 1070796.00
      and (items->0->>'award')::int = 0 from requests where id = 'd4d4d4d4-0000-0000-0000-000000000001'));

-- discount and incl. VAT with 4 decimals
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, no_comp, no_comp_reason)
values ('d4d4d4d4-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย A','R11-HO.26110402',
  '[{"sku":"P4-1","qty":1000,"unit_price":26.7625,"discount":"5%"},
    {"sku":"P4-2","qty":10,"unit_price":107.1234,"vat_mode":"inc"}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('d4d4d4d4-0000-0000-0000-000000000002','d4d4d4d4-0000-0000-0000-000000000002/q.pdf','q.pdf');
select submit_request('d4d4d4d4-0000-0000-0000-000000000002')::text;
reset role;
-- 26.7625 −5% = 25.424375 → 25.4244 × 1,000 = 25,424.40 · 107.1234 incl. → 100.1153 before VAT; 10 × 107.1234 ÷ 1.07 = 1,001.15
select t_check('discount: net 25.4244, line 25,424.40',
  (select (items->0->>'net_price')::numeric = 25.4244 and (items->0->>'line_total')::numeric = 25424.40 from requests where id = 'd4d4d4d4-0000-0000-0000-000000000002'));
select t_check('incl. VAT: 100.1153 before VAT, quoted 107.1234 kept, line 1,001.15',
  (select (items->1->>'unit_price')::numeric = 100.1153 and (items->1->>'price_in')::numeric = 107.1234
      and (items->1->>'line_total')::numeric = 1001.15 from requests where id = 'd4d4d4d4-0000-0000-0000-000000000002'));
select t_check('total = 26,425.55 + VAT 1,849.79 = 28,275.34',
  (select subtotal = 26425.55 and vat = 1849.79 and total = 28275.34 from requests where id = 'd4d4d4d4-0000-0000-0000-000000000002'));
select 'ALL 0026 TESTS PASSED';
