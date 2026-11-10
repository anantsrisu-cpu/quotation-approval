-- 0015: เลขที่ใบขอซื้อ format R1x-yy.xxxxxxxx; no recalling. Runs after 94; applies 0015 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0015_pr_number.sql
select t_check('format checker', is_pr_no('R11-HO.26110005') and is_pr_no(' r19-ab.00000001 ') and not is_pr_no('R11HO.2611-0005')
  and not is_pr_no('R21-HO.26110005') and not is_pr_no('R11-H0.26110005') and not is_pr_no('R11-HO.2611000') and not is_pr_no('R11-HOO.26110005'));
select t_check('recall_request removed', not exists (select 1 from pg_proc where proname = 'recall_request'));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('adadadad-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11HO.2611-0005');
insert into request_files (request_id, path, name) values ('adadadad-0000-0000-0000-000000000001','adadadad-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_expect_error('old-style number rejected', $$ select submit_request('adadadad-0000-0000-0000-000000000001') $$);
update requests set report_no = 'r11-ho.26110005', items = '[{"sku":"P-001","qty":1,"unit_price":100,"report_no":"R11-HO.2611"}]' where id='adadadad-0000-0000-0000-000000000001';
select t_expect_error('item number must also follow the format', $$ select submit_request('adadadad-0000-0000-0000-000000000001') $$);
update requests set items = '[{"sku":"P-001","qty":1,"unit_price":100,"report_no":"r12-ab.00000007"}]' where id='adadadad-0000-0000-0000-000000000001';
select submit_request('adadadad-0000-0000-0000-000000000001')::text;
select t_check('stored in capitals as the request number', (select no = 'R11-HO.26110005' and report_no = 'R11-HO.26110005' and items->0->>'report_no' = 'R12-AB.00000007' from requests where id='adadadad-0000-0000-0000-000000000001'));

select 'ALL 0015 TESTS PASSED';
