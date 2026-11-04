-- 0007: report number on the request and on each item. Runs after 50_wet_signature_test.sql.
\set QUIET on
\pset format unaligned
\pset tuples_only on

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, report_no, report_date, items, no_comp, no_comp_reason)
values ('bbbbbbbb-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย', 'RPT-69/0412', '2026-11-04',
  '[{"sku":"P-001","qty":1,"unit_price":1000,"report_no":" PR-1001 "},{"sku":"P-002","qty":1,"unit_price":500}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('bbbbbbbb-0000-0000-0000-000000000001')::text;
select t_check('header report no / date kept', (select report_no='RPT-69/0412' and report_date='2026-11-04' from requests where id='bbbbbbbb-0000-0000-0000-000000000001'));
select t_check('item report no kept (trimmed), blank stays blank', (select items->0->>'report_no'='PR-1001' and items->1->>'report_no'='' from requests where id='bbbbbbbb-0000-0000-0000-000000000001'));
select t_expect_error('report no length checked', $$ insert into requests (vendor, report_no) values ('x', repeat('9', 61)) $$);
select 'ALL 0007 TESTS PASSED';
