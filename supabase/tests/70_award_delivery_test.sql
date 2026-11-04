-- 0008: per-item vendor ticks and delivery places. Runs after 60_report_no_test.sql.
\set QUIET on
\pset format unaligned
\pset tuples_only on

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('delivery places seeded and readable', (select string_agg(name, ',' order by slot, sort) from delivery_places) = 'โรงงานTRRC,โรงงานTRRE,คลังพระประแดง');
select t_expect_error('only admins add places', $$ insert into delivery_places (name, slot) values ('คลังใหม่', 2) $$);

-- item 1: A cheaper (auto) · item 2: เจ้าที่ 1 cheaper (auto) · item 3: ticked A although dearer → needs a reason
insert into requests (id, dept, buyer_id, company_id, vendor, delivery, items, comparisons)
values ('cccccccc-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขายหลัก',
  '[{"place":"โรงงานTRRC","on":true},{"place":"คลังพระประแดง","on":false}]',
  '[{"sku":"P-001","qty":2,"unit_price":100},{"sku":"P-002","qty":1,"unit_price":50},{"sku":"P-003","qty":1,"unit_price":10,"award":1}]',
  '[{"vendor":"คู่เทียบ A","prices":[90,60,12],"delivery":[{"place":"โรงงานTRRE","on":true},{"place":"คลังพระประแดง","on":true},{"place":"x","on":true}]}]');
insert into request_files (request_id, path, name) values ('cccccccc-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_expect_error('dearer tick without a reason', $$ select submit_request('cccccccc-0000-0000-0000-000000000001') $$);
update requests set items = jsonb_set(items, '{2,award_reason}', '"รับประกันนานกว่า"') where id='cccccccc-0000-0000-0000-000000000001';
select submit_request('cccccccc-0000-0000-0000-000000000001')::text;
-- approved = A 180 + เจ้าที่1 50 + A 12 = 242 ; VAT 16.94
select t_check('approved amount = ticked lines', (select subtotal=242 and vat=16.94 and total=258.94 from requests where id='cccccccc-0000-0000-0000-000000000001'));
select t_check('awards stored (auto, auto, override with reason)', (select string_agg((x->>'award')||'/'||(x->>'award_auto'), ',' order by o) = '1/1,0/0,1/0' and items->2->>'award_reason'='รับประกันนานกว่า' and items->0->>'award_reason'='' from requests, jsonb_array_elements(items) with ordinality e(x,o) where id='cccccccc-0000-0000-0000-000000000001' group by items));
select t_check('comparison diff vs เจ้าที่ 1 quote (A 252 vs 260 → −8.56)', (select (comparisons->0->>'diff')::numeric = -8.56 from requests where id='cccccccc-0000-0000-0000-000000000001'));
select t_check('delivery cleaned to 2 slots', (select delivery->0->>'place'='โรงงานTRRC' and (delivery->0->>'on')::boolean and jsonb_array_length(comparisons->0->'delivery')=2 from requests where id='cccccccc-0000-0000-0000-000000000001'));

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('cccccccc-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000003','main','x','[{"sku":"P-001","qty":1,"unit_price":100,"award":3}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('cccccccc-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002/q.pdf','q.pdf');
select t_expect_error('tick outside the vendor list', $$ select submit_request('cccccccc-0000-0000-0000-000000000002') $$);
select 'ALL 0008 TESTS PASSED';
