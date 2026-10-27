-- 0006: hand-signed positions and the signing plan. Runs after 40_sheet_fields_test.sql.
\set QUIET on
\pset format unaligned
\pset tuples_only on

set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
update positions set sign_mode = 'wet' where code = 'md';
select t_expect_error('sign_mode is checked', $$ update positions set sign_mode = 'paper' where code = 'md' $$);

select t_as('00000000-0000-0000-0000-000000000007');
select t_check('preview flags the hand-signed md', (select string_agg(pos||':'||sign_mode, ',' order by step_no) from preview_approvers(600000, 'purchasing')) = 'dm:online,fm:online,md:wet');

-- tier 3 (> 500,000): dm + fm online, md hand-signed
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('aaaaaaaa-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":600000}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('aaaaaaaa-0000-0000-0000-000000000001')::text;
select t_check('only dm and fm are steps', (select string_agg(position, ',' order by step_no) from request_steps where request_id='aaaaaaaa-0000-0000-0000-000000000001') = 'dm,fm');
select t_check('plan: dm online, fm online, md wet with a name', (select string_agg(x->>'position'||':'||(x->>'mode'), ',') = 'dm:online,fm:online,md:wet' and (sign_plan->2->>'approver_id') is not null from requests, jsonb_array_elements(sign_plan) x where id='aaaaaaaa-0000-0000-0000-000000000001' group by sign_plan));

-- tier 1 (≤ 50,000): fm and md are skipped (crossed out on the sheet once approved)
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('aaaaaaaa-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":1000}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002/q.pdf','q.pdf');
select submit_request('aaaaaaaa-0000-0000-0000-000000000002')::text;
select t_check('plan: dm online, fm skip, md skip', (select string_agg(x->>'mode', ',') = 'online,skip,skip' from requests, jsonb_array_elements(sign_plan) x where id='aaaaaaaa-0000-0000-0000-000000000002'));
select t_check('still pending for dm', (select status='pending' from requests where id='aaaaaaaa-0000-0000-0000-000000000002'));

-- every approver of the tier hand-signs → complete at once
select t_as('00000000-0000-0000-0000-00000000000a');
update positions set sign_mode = 'wet' where code = 'dm';
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('aaaaaaaa-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":500}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000003/q.pdf','q.pdf');
select submit_request('aaaaaaaa-0000-0000-0000-000000000003')::text;
select t_check('all hand-signed: approved at once, no steps', (select status='approved' and completed_at is not null from requests where id='aaaaaaaa-0000-0000-0000-000000000003') and (select count(*)=0 from request_steps where request_id='aaaaaaaa-0000-0000-0000-000000000003'));

select t_as('00000000-0000-0000-0000-00000000000a');
update positions set sign_mode = 'online';
select 'ALL 0006 TESTS PASSED';
