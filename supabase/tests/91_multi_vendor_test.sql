-- 0011: ซื้อหลายเจ้า แยกราย SKU — vendors that quote only some items. Runs after 90.
\set QUIET on
\pset format unaligned
\pset tuples_only on
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');

-- A quotes item 1 only, B quotes item 2 only, C quotes both (dearer)
insert into requests (id, dept, buyer_id, company_id, vendor, items, comparisons)
values ('ffffffff-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','เจ้า A',
  '[{"sku":"P-001","qty":10,"unit_price":100},{"sku":"P-002","qty":5,"unit_price":""}]',
  '[{"vendor":"เจ้า B","prices":["",200]},{"vendor":"เจ้า C","prices":[120,230]}]');
insert into request_files (request_id, path, name) values ('ffffffff-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_expect_error('without ซื้อหลายเจ้า every price is required', $$ select submit_request('ffffffff-0000-0000-0000-000000000001') $$);
update requests set multi_vendor = true where id='ffffffff-0000-0000-0000-000000000001';
update requests set items = jsonb_set(items, '{1,award}', '0') where id='ffffffff-0000-0000-0000-000000000001';
select t_expect_error('cannot tick a vendor that did not quote', $$ select submit_request('ffffffff-0000-0000-0000-000000000001') $$);
update requests set items = items #- '{1,award}' where id='ffffffff-0000-0000-0000-000000000001';
update requests set no_comp = true, no_comp_reason = 'x' where id='ffffffff-0000-0000-0000-000000000001';
select t_expect_error('ซื้อหลายเจ้า needs a second vendor', $$ select submit_request('ffffffff-0000-0000-0000-000000000001') $$);
update requests set no_comp = false, no_comp_reason = '' where id='ffffffff-0000-0000-0000-000000000001';
select submit_request('ffffffff-0000-0000-0000-000000000001')::text;
select t_check('item 1 → A (100), item 2 → B (200): approved 1,000 + 1,000 = 2,000',
  (select subtotal = 2000 and total = 2140 from requests where id='ffffffff-0000-0000-0000-000000000001'));
select t_check('awards: A for item 1, B for item 2',
  (select (items->0->>'award')::int = 0 and (items->1->>'award')::int = 1 and (items->1->>'award_auto')::int = 1 from requests where id='ffffffff-0000-0000-0000-000000000001'));
select t_check('unquoted lines stored as 0, vendor subtotals of what they quoted',
  (select (items->1->>'unit_price')::numeric = 0 and (comparisons->0->'prices'->>0)::numeric = 0
      and (comparisons->0->>'subtotal')::numeric = 1000 and (comparisons->1->>'subtotal')::numeric = 2350
      and comparisons->0->'diff' = 'null'::jsonb
     from requests where id='ffffffff-0000-0000-0000-000000000001'));

select t_check('bought_vendors lists who is bought from', (select bought_vendors = 'เจ้า A + เจ้า B' from requests where id='ffffffff-0000-0000-0000-000000000001'));

-- เจ้าที่ 1 quotes everything but loses every item: bought from B and C only
insert into requests (id, dept, buyer_id, company_id, vendor, multi_vendor, items, comparisons)
values ('ffffffff-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000003','main','เจ้า A', true,
  '[{"sku":"P-001","qty":1,"unit_price":100},{"sku":"P-002","qty":1,"unit_price":100}]',
  '[{"vendor":"เจ้า B","prices":[80,""]},{"vendor":"เจ้า C","prices":["",90]}]');
insert into request_files (request_id, path, name) values ('ffffffff-0000-0000-0000-000000000003','ffffffff-0000-0000-0000-000000000003/q.pdf','q.pdf');
select submit_request('ffffffff-0000-0000-0000-000000000003')::text;
select t_check('main vendor not bought from: B + C, 170', (select bought_vendors = 'เจ้า B + เจ้า C' and subtotal = 170 from requests where id='ffffffff-0000-0000-0000-000000000003'));

-- an item nobody quoted
insert into requests (id, dept, buyer_id, company_id, vendor, multi_vendor, items, comparisons)
values ('ffffffff-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000003','main','เจ้า A', true,
  '[{"sku":"P-001","qty":1,"unit_price":100},{"sku":"P-002","qty":1,"unit_price":0}]',
  '[{"vendor":"เจ้า B","prices":[90,0]}]');
insert into request_files (request_id, path, name) values ('ffffffff-0000-0000-0000-000000000002','ffffffff-0000-0000-0000-000000000002/q.pdf','q.pdf');
select t_expect_error('every item needs at least one quote', $$ select submit_request('ffffffff-0000-0000-0000-000000000002') $$);
-- split may only use vendors that quoted
update requests set items = '[{"sku":"P-001","qty":2,"unit_price":100,"split":[{"v":0,"qty":1},{"v":1,"qty":1}],"award_reason":"แบ่ง"},{"sku":"P-002","qty":1,"unit_price":0,"split":[{"v":0,"qty":0.5},{"v":1,"qty":0.5}],"award_reason":"แบ่ง"}]',
  comparisons = '[{"vendor":"เจ้า B","prices":[90,50]}]' where id='ffffffff-0000-0000-0000-000000000002';
select t_expect_error('split part from a vendor that did not quote', $$ select submit_request('ffffffff-0000-0000-0000-000000000002') $$);

select 'ALL 0011 TESTS PASSED';
