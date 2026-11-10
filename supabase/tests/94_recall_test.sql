-- 0014: the preparer recalls a request that is part-way through approval. Runs after 93; applies 0014 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0014_recall_request.sql
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');

-- 60,000 + VAT → two approval steps
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('acacacac-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":60000}]', true, 'รายเดียว', 'R11HO.2611-0100');
insert into request_files (request_id, path, name) values ('acacacac-0000-0000-0000-000000000001','acacacac-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('acacacac-0000-0000-0000-000000000001')::text;
select t_check('two steps to approve', (select count(*) = 2 from request_steps where request_id = 'acacacac-0000-0000-0000-000000000001'));

-- first approver approves
reset role;
select set_config('t.a1', (select approver_id::text from request_steps where request_id = 'acacacac-0000-0000-0000-000000000001' and step_no = 0), false);
select set_config('t.a2', (select approver_id::text from request_steps where request_id = 'acacacac-0000-0000-0000-000000000001' and step_no = 1), false);
insert into signatures (user_id, data) select current_setting('t.a1')::uuid, 'data:image/png;base64,A1' on conflict (user_id) do nothing;
set role authenticated;
select t_as(current_setting('t.a1')::uuid);
select approve_request('acacacac-0000-0000-0000-000000000001', '')::text;
select t_check('half-way: step 1 approved, step 2 pending', (select string_agg(status, ',' order by step_no) = 'approved,pending' from request_steps where request_id = 'acacacac-0000-0000-0000-000000000001'));
select t_expect_error('an approver cannot recall it', $$ select recall_request('acacacac-0000-0000-0000-000000000001', '') $$);

select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('another preparer cannot recall it', $$ select recall_request('acacacac-0000-0000-0000-000000000001', '') $$);

select t_as('00000000-0000-0000-0000-000000000007');
select recall_request('acacacac-0000-0000-0000-000000000001', 'แก้จำนวนสินค้า')::text;
select t_check('back to draft, number kept', (select status = 'draft' and no = 'R11HO.2611-0100' from requests where id = 'acacacac-0000-0000-0000-000000000001'));
select t_check('waiting step cancelled, the earlier approval kept in history', (select string_agg(status, ',' order by step_no) = 'approved,cancelled' from request_steps where request_id = 'acacacac-0000-0000-0000-000000000001'));
select t_check('log says recalled with the reason', (select count(*) = 1 from request_log where request_id = 'acacacac-0000-0000-0000-000000000001' and kind = 'reopened' and comment = 'แก้จำนวนสินค้า'));
reset role;
select t_check('both approvers told', (select count(distinct user_id) = 2 from notifications where request_id = 'acacacac-0000-0000-0000-000000000001'
   and title like 'ผู้จัดทำดึงคำขอกลับไปแก้ไข%' and user_id in (current_setting('t.a1')::uuid, current_setting('t.a2')::uuid)));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_expect_error('a draft cannot be recalled', $$ select recall_request('acacacac-0000-0000-0000-000000000001', '') $$);

-- edit and send again: approval starts from the first approver
update requests set items = '[{"sku":"P-001","qty":2,"unit_price":30000}]' where id = 'acacacac-0000-0000-0000-000000000001';
select submit_request('acacacac-0000-0000-0000-000000000001')::text;
select t_check('sent again from step 1', (select r.status = 'pending' and r.current_step = 0 and r.no = 'R11HO.2611-0100'
     and (select string_agg(s.status, ',' order by s.step_no) from request_steps s where s.request_id = r.id) = 'pending,waiting'
   from requests r where r.id = 'acacacac-0000-0000-0000-000000000001'));

select 'ALL 0014 TESTS PASSED';
