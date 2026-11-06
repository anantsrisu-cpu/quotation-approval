-- 0010: แบ่งซื้อ, delete own requests, approvers per company, UAT reset.
-- Runs last (it clears every request at the end).
\set QUIET on
\pset format unaligned
\pset tuples_only on
set role authenticated;

-- ---- approvers per company ----
select t_as('00000000-0000-0000-0000-00000000000a');
update profiles set companies = '{trr-bio}' where id = '00000000-0000-0000-0000-000000000003';  -- ธนา (dm, purchasing)
select t_check('ธนา signs for trr-bio only',
  (select approver_name from preview_approvers(1000, 'purchasing', 'trr-bio') where pos = 'dm') = 'ธนา มั่นคง');
select t_check('main: ธนา is skipped even in his own department',
  (select approver_name from preview_approvers(1000, 'purchasing', 'main') where pos = 'dm') <> 'ธนา มั่นคง');
update profiles set companies = '{main}' where id = '00000000-0000-0000-0000-000000000002';  -- สมชาย (dm, facilities)
select t_check('main: the approver ticked for main comes first',
  (select approver_name from preview_approvers(1000, 'purchasing', 'main') where pos = 'dm') = 'สมชาย รักงาน');
select t_check('no company given: department rule as before',
  (select approver_name from preview_approvers(1000, 'purchasing') where pos = 'dm') = 'ธนา มั่นคง');

-- ---- แบ่งซื้อ: 10 units, 4 from เจ้าที่ 1 (100) and 6 from A (95) ----
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, comparisons)
values ('dddddddd-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขายหลัก',
  '[{"sku":"P-001","qty":10,"unit_price":100,"split":[{"v":0,"qty":4},{"v":1,"qty":6}]}]',
  '[{"vendor":"คู่เทียบ A","prices":[95]}]');
insert into request_files (request_id, path, name) values ('dddddddd-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_expect_error('split without a reason', $$ select submit_request('dddddddd-0000-0000-0000-000000000001') $$);
update requests set items = jsonb_set(items, '{0,award_reason}', '"ราคาใกล้เคียง กระจายความเสี่ยงการส่งของ"') where id='dddddddd-0000-0000-0000-000000000001';
update requests set items = jsonb_set(items, '{0,split,1,qty}', '5') where id='dddddddd-0000-0000-0000-000000000001';
select t_expect_error('split quantities must add up (4 + 5 ≠ 10)', $$ select submit_request('dddddddd-0000-0000-0000-000000000001') $$);
update requests set items = jsonb_set(items, '{0,split}', '[{"v":0,"qty":10}]') where id='dddddddd-0000-0000-0000-000000000001';
select t_expect_error('split needs two vendors', $$ select submit_request('dddddddd-0000-0000-0000-000000000001') $$);
update requests set items = jsonb_set(items, '{0,split}', '[{"v":1,"qty":4},{"v":1,"qty":6}]') where id='dddddddd-0000-0000-0000-000000000001';
select t_expect_error('same vendor twice', $$ select submit_request('dddddddd-0000-0000-0000-000000000001') $$);
update requests set items = jsonb_set(items, '{0,split}', '[{"v":1,"qty":6},{"v":0,"qty":4}]') where id='dddddddd-0000-0000-0000-000000000001';
select submit_request('dddddddd-0000-0000-0000-000000000001')::text;
select t_check('approved = 4 × 100 + 6 × 95 = 970', (select subtotal=970 and vat=67.90 and total=1037.90 from requests where id='dddddddd-0000-0000-0000-000000000001'));
select t_check('split stored in vendor order with % and lines',
  (select items->0->'split'->0->>'v'='0' and (items->0->'split'->0->>'pct')::numeric=40 and (items->0->'split'->1->>'line')::numeric=570
      and (items->0->>'award')::int=1 and (items->0->>'award_line')::numeric=970 and items->0->>'award_reason' like 'ราคาใกล้เคียง%'
     from requests where id='dddddddd-0000-0000-0000-000000000001'));
select t_check('company main → dm approver ticked for main', (select approver_id='00000000-0000-0000-0000-000000000002' from request_steps where request_id='dddddddd-0000-0000-0000-000000000001' and step_no=0));
select t_check('not split → split is null', (select bool_and(x->'split' = 'null'::jsonb) from requests r, jsonb_array_elements(r.items) x where r.id='cccccccc-0000-0000-0000-000000000001'));

-- ---- delete own requests ----
insert into requests (id, vendor) values ('dddddddd-0000-0000-0000-000000000002','ร่างทิ้ง');
select t_expect_error('pending request cannot be deleted', $$ select delete_request('dddddddd-0000-0000-0000-000000000001') $$);
select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('another preparer cannot delete my draft', $$ select delete_request('dddddddd-0000-0000-0000-000000000002') $$);
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('draft delete returns ฉบับร่าง', delete_request('dddddddd-0000-0000-0000-000000000002') = 'ฉบับร่าง');
select t_check('draft is gone', not exists (select 1 from requests where id='dddddddd-0000-0000-0000-000000000002'));
select t_as('00000000-0000-0000-0000-000000000002');
select reject_request('dddddddd-0000-0000-0000-000000000001', 'ราคาสูงไป')::text;
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('rejected request delete returns its number', delete_request('dddddddd-0000-0000-0000-000000000001') like 'QT-%');
select t_check('rejected request is gone', not exists (select 1 from requests where id='dddddddd-0000-0000-0000-000000000001'));
reset role;
select t_check('cascade: nothing left behind',
  not exists (select 1 from request_steps where request_id='dddddddd-0000-0000-0000-000000000001')
  and not exists (select 1 from request_log where request_id='dddddddd-0000-0000-0000-000000000001')
  and not exists (select 1 from request_files where request_id='dddddddd-0000-0000-0000-000000000001')
  and not exists (select 1 from notifications where request_id='dddddddd-0000-0000-0000-000000000001'));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_expect_error('approved request cannot be deleted', $$ select delete_request((select id from requests where status='approved' limit 1)) $$);

-- ---- UAT reset (admin only, typed confirmation) ----
select t_expect_error('non-admin cannot reset', $$ select admin_reset_requests('ลบทั้งหมด') $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('wrong confirmation word', $$ select admin_reset_requests('delete') $$);
select t_check('reset reports how many requests it removed', admin_reset_requests('ลบทั้งหมด') > 0);
select t_check('no requests left', (select count(*) = 0 from requests));
reset role;
select t_check('steps, log, request notifications and counters cleared',
  (select count(*) from request_steps) = 0 and (select count(*) from request_log) = 0
  and (select count(*) from notifications where request_id is not null) = 0 and (select count(*) from request_counters) = 0);
select t_check('users, products and settings kept', (select count(*) > 0 from profiles) and (select count(*) > 0 from products) and (select count(*) > 0 from tiers));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('dddddddd-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":100}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('dddddddd-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000003/q.pdf','q.pdf');
select submit_request('dddddddd-0000-0000-0000-000000000003')::text;
select t_check('numbering starts again at 0001', (select no like '%-0001' from requests where id='dddddddd-0000-0000-0000-000000000003'));

select 'ALL 0010 TESTS PASSED';
