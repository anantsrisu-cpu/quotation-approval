-- 0012: รายงานเลขที่ is required and becomes the request number. Runs last; applies 0012 itself
-- (the earlier tests send requests without a report no.).
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0012_report_no_required.sql
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('abababab-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":100}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('abababab-0000-0000-0000-000000000001','abababab-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_expect_error('report no. required', $$ select submit_request('abababab-0000-0000-0000-000000000001') $$);
update requests set report_no = '  R11HO.2611-0005 ' where id='abababab-0000-0000-0000-000000000001';
select submit_request('abababab-0000-0000-0000-000000000001')::text;
select t_check('request number = the typed report no.', (select no = 'R11HO.2611-0005' and status = 'pending' from requests where id='abababab-0000-0000-0000-000000000001'));

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('abababab-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11HO.2611-0005');
insert into request_files (request_id, path, name) values ('abababab-0000-0000-0000-000000000002','abababab-0000-0000-0000-000000000002/q.pdf','q.pdf');
select t_expect_error('the same report no. cannot be used twice', $$ select submit_request('abababab-0000-0000-0000-000000000002') $$);
update requests set report_no = 'R11HO.2611-0006' where id='abababab-0000-0000-0000-000000000002';
select submit_request('abababab-0000-0000-0000-000000000002')::text;
select t_check('second request gets its own number', (select no = 'R11HO.2611-0006' from requests where id='abababab-0000-0000-0000-000000000002'));

select 'ALL 0012 TESTS PASSED';
