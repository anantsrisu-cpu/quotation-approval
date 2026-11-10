-- 0013: the same รายงานเลขที่ may be used on several requests. Runs after 92; applies 0013 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0013_report_no_duplicates.sql
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('abababab-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11HO.2611-0005');
insert into request_files (request_id, path, name) values ('abababab-0000-0000-0000-000000000003','abababab-0000-0000-0000-000000000003/q.pdf','q.pdf');
select t_check('form sees 1 other request with this number', report_no_count('R11HO.2611-0005', 'abababab-0000-0000-0000-000000000003') = 1);
select submit_request('abababab-0000-0000-0000-000000000003')::text;
select t_check('sent with the same number as another request', (select no = 'R11HO.2611-0005' and status = 'pending' from requests where id='abababab-0000-0000-0000-000000000003'));
select t_check('two requests now share R11HO.2611-0005', report_no_count('R11HO.2611-0005') = 2);
select t_check('blank number counts 0', report_no_count('  ') = 0);

select 'ALL 0013 TESTS PASSED';
