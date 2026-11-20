-- 0023: reason for buying above the previous price. Applies 0023 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0023_price_up_reason.sql
\i supabase/migrations/0023_price_up_reason.sql
insert into products (company_id, sku, name, unit) values ('main', 'UP-1', 'CMC', 'กก.'), ('main', 'UP-2', 'Xanthan gum', 'กก.') on conflict do nothing;

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
-- item 1: previous 180, now 185 → reason needed · item 2: no previous price → no check
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, no_comp, no_comp_reason)
values ('e1e1e1e1-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย','R11-HO.26110401',
  '[{"sku":"UP-1","qty":100,"unit_price":185,"prev_price":180},{"sku":"UP-2","qty":10,"unit_price":380}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('e1e1e1e1-0000-0000-0000-000000000001','e1e1e1e1-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_expect_error('above the previous price without a reason is refused', $$ select submit_request('e1e1e1e1-0000-0000-0000-000000000001') $$);
update requests set items = jsonb_set(items, '{0,price_up_reason}', '"ราคาวัตถุดิบขึ้นทั้งตลาด"') where id = 'e1e1e1e1-0000-0000-0000-000000000001';
select submit_request('e1e1e1e1-0000-0000-0000-000000000001')::text;
reset role;
select t_check('sent with the reason kept; item without a previous price not checked',
  (select status = 'pending' and items->0->>'price_up_reason' = 'ราคาวัตถุดิบขึ้นทั้งตลาด' and items->1->>'price_up_reason' = ''
   from requests where id = 'e1e1e1e1-0000-0000-0000-000000000001'));

-- cheaper or equal: no reason needed and a stray reason is dropped
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, no_comp, no_comp_reason)
values ('e1e1e1e1-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย','R11-HO.26110402',
  '[{"sku":"UP-1","qty":1,"unit_price":180,"prev_price":180,"price_up_reason":"ไม่ต้องใช้"},{"sku":"UP-2","qty":1,"unit_price":370,"prev_price":380}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('e1e1e1e1-0000-0000-0000-000000000002','e1e1e1e1-0000-0000-0000-000000000002/q.pdf','q.pdf');
select submit_request('e1e1e1e1-0000-0000-0000-000000000002')::text;
reset role;
select t_check('equal / cheaper: sent, no reason kept', (select status = 'pending' and items->0->>'price_up_reason' = '' from requests where id = 'e1e1e1e1-0000-0000-0000-000000000002'));

-- the ✓ vendor's price counts (vendor 1 cheaper than before, but vendor 2 ticked at a higher price)
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, comparisons)
values ('e1e1e1e1-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000007','main','ผู้ขาย A','R11-HO.26110403',
  '[{"sku":"UP-1","qty":10,"unit_price":170,"prev_price":175,"award":1,"award_reason":"ส่งเร็วกว่า"}]',
  '[{"vendor":"ผู้ขาย B","prices":[190],"discounts":[""]}]');
insert into request_files (request_id, path, name) values ('e1e1e1e1-0000-0000-0000-000000000003','e1e1e1e1-0000-0000-0000-000000000003/q.pdf','q.pdf');
select t_expect_error('✓ vendor above the previous price needs a reason', $$ select submit_request('e1e1e1e1-0000-0000-0000-000000000003') $$);
-- Incl. VAT: 192.60 incl. = 180 before VAT, equal to the previous 180 → no reason
update requests set items = '[{"sku":"UP-1","qty":10,"unit_price":192.60,"vat_mode":"inc","prev_price":180}]', comparisons = '[{"vendor":"ผู้ขาย B","prices":[200],"discounts":[""]}]'
 where id = 'e1e1e1e1-0000-0000-0000-000000000003';
select submit_request('e1e1e1e1-0000-0000-0000-000000000003')::text;
reset role;
select t_check('compared before VAT (192.60 incl. = 180)', (select status = 'pending' from requests where id = 'e1e1e1e1-0000-0000-0000-000000000003'));

select 'ALL 0023 TESTS PASSED';
