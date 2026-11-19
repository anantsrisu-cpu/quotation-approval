-- 0021: VAT per item (Excl. VAT / Incl. VAT / VAT 0). Runs after 99b; applies 0021 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0021_vat_mode.sql
\i supabase/migrations/0021_vat_mode.sql
insert into products (company_id, sku, name, unit) values
  ('main', 'VAT-1', 'สินค้าราคารวม VAT', 'ชิ้น'), ('main', 'VAT-2', 'สินค้ายกเว้น VAT', 'ชิ้น'), ('main', 'VAT-3', 'สินค้าปกติ', 'ชิ้น')
  on conflict do nothing;

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
-- item 1 quoted 107 incl. VAT × 50 · item 2 VAT 0, 500 × 2 · item 3 before VAT 1,000 × 1
-- vendor B: 110 incl. · 450 · 1,100
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, comparisons)
values ('c1c1c1c1-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย A','R11-HO.26110301',
  '[{"sku":"VAT-1","qty":50,"unit_price":107,"vat_mode":"inc"},
    {"sku":"VAT-2","qty":2,"unit_price":500,"vat_mode":"zero"},
    {"sku":"VAT-3","qty":1,"unit_price":1000}]',
  '[{"vendor":"ผู้ขาย B","prices":[110,450,1100],"discounts":["","",""]}]');
insert into request_files (request_id, path, name) values ('c1c1c1c1-0000-0000-0000-000000000001','c1c1c1c1-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('c1c1c1c1-0000-0000-0000-000000000001')::text;

reset role;
select t_check('incl. VAT item: shown before VAT, line = 5,350 ÷ 1.07, quoted price kept',
  (select (items->0->>'unit_price')::numeric = 100 and (items->0->>'net_price')::numeric = 100 and (items->0->>'line_total')::numeric = 5000
      and (items->0->>'price_in')::numeric = 107 and items->0->>'vat_mode' = 'inc' from requests where id = 'c1c1c1c1-0000-0000-0000-000000000001'));
select t_check('VAT 0 / Excl. VAT items unchanged',
  (select (items->1->>'line_total')::numeric = 1000 and items->1->>'vat_mode' = 'zero' and items->1->'price_in' = 'null'::jsonb
      and (items->2->>'line_total')::numeric = 1000 and items->2->>'vat_mode' = 'ex' from requests where id = 'c1c1c1c1-0000-0000-0000-000000000001'));
select t_check('vendor B: incl. VAT price converted, total = lines + 7% of the VAT lines only',
  (select (comparisons->0->'prices'->>0)::numeric = 102.80 and (comparisons->0->'prices_in'->>0)::numeric = 110
      and (comparisons->0->'lines'->>0)::numeric = 5140.19 and (comparisons->0->>'subtotal')::numeric = 7140.19
      and (comparisons->0->>'total')::numeric = 7577.00 from requests where id = 'c1c1c1c1-0000-0000-0000-000000000001'));
select t_check('cheapest ✓ per item compares before-VAT lines (item 2 from B)',
  (select (items->0->>'award')::int = 0 and (items->1->>'award')::int = 1 and (items->2->>'award')::int = 0
   from requests where id = 'c1c1c1c1-0000-0000-0000-000000000001'));
select t_check('approved amount: 6,900 + VAT 7% of 6,000 (VAT 0 line left out) = 7,320',
  (select subtotal = 6900 and vat = 420 and total = 7320 from requests where id = 'c1c1c1c1-0000-0000-0000-000000000001'));

-- sending again after it comes back (the stored prices are before VAT, the quoted ones are used)
update requests set status = 'draft', no = null where id = 'c1c1c1c1-0000-0000-0000-000000000001';
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select submit_request('c1c1c1c1-0000-0000-0000-000000000001')::text;
reset role;
select t_check('resending gives the same amounts (no double conversion)',
  (select subtotal = 6900 and vat = 420 and total = 7320 and (items->0->>'unit_price')::numeric = 100 and (items->0->>'price_in')::numeric = 107
      and (comparisons->0->>'total')::numeric = 7577.00 from requests where id = 'c1c1c1c1-0000-0000-0000-000000000001'));

-- incl. VAT + discount + split buying
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, comparisons)
values ('c1c1c1c1-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย A','R11-HO.26110302',
  '[{"sku":"VAT-1","qty":100,"unit_price":214,"discount":"10%","vat_mode":"inc","split":[{"v":0,"qty":60},{"v":1,"qty":40}],"award_reason":"แบ่งความเสี่ยง"}]',
  '[{"vendor":"ผู้ขาย B","prices":[200],"discounts":[""]}]');
insert into request_files (request_id, path, name) values ('c1c1c1c1-0000-0000-0000-000000000002','c1c1c1c1-0000-0000-0000-000000000002/q.pdf','q.pdf');
select submit_request('c1c1c1c1-0000-0000-0000-000000000002')::text;
reset role;
-- A: 214 −10% = 192.60 incl → 180 before VAT; 60 × 192.60 ÷ 1.07 = 10,800 · B: 40 × 200 ÷ 1.07 = 7,476.64
select t_check('incl. VAT with discount and split', (select (items->0->>'net_price')::numeric = 180 and (items->0->>'net_in')::numeric = 192.60
      and (items->0->'split'->0->>'line')::numeric = 10800 and (items->0->'split'->1->>'line')::numeric = 7476.64
      and subtotal = 18276.64 and vat = 1279.36 and total = 19556.00 from requests where id = 'c1c1c1c1-0000-0000-0000-000000000002'));

-- a wrong option is refused
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, no_comp, no_comp_reason)
values ('c1c1c1c1-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย A','R11-HO.26110303',
  '[{"sku":"VAT-3","qty":1,"unit_price":100,"vat_mode":"half"}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('c1c1c1c1-0000-0000-0000-000000000003','c1c1c1c1-0000-0000-0000-000000000003/q.pdf','q.pdf');
select t_expect_error('unknown VAT option refused', $$ select submit_request('c1c1c1c1-0000-0000-0000-000000000003') $$);
-- older items without vat_mode: as before
update requests set items = '[{"sku":"VAT-3","qty":3,"unit_price":100}]' where id = 'c1c1c1c1-0000-0000-0000-000000000003';
select submit_request('c1c1c1c1-0000-0000-0000-000000000003')::text;
reset role;
select t_check('no vat_mode = before VAT, as before', (select subtotal = 300 and vat = 21 and total = 321 from requests where id = 'c1c1c1c1-0000-0000-0000-000000000003'));

select 'ALL 0021 TESTS PASSED';
