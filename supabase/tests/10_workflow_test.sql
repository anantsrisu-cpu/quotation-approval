-- End-to-end workflow test against the stub (run after 00_supabase_stub.sql + migrations).
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/10_workflow_test.sql
\set QUIET on
\pset format unaligned
\pset tuples_only on

create or replace function public.t_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false);
end $$;
create or replace function public.t_expect_error(label text, stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL (no error)%' then raise; end if;
  return 'ok  ' || label || '  → ' || left(sqlerrm, 90);
end $$;
create or replace function public.t_check(label text, cond boolean) returns text language plpgsql as $$
begin
  if not coalesce(cond,false) then raise exception 'FAIL: %', label; end if;
  return 'ok  ' || label;
end $$;
grant execute on function public.t_as(uuid), public.t_expect_error(text,text), public.t_check(text,boolean) to authenticated;

-- users sign in (trigger creates profiles; first one becomes admin)
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@co.th','{"full_name":"Admin One"}'),
 ('00000000-0000-0000-0000-000000000001','napa@co.th','{"full_name":"นภา ใจดี"}'),
 ('00000000-0000-0000-0000-000000000002','somchai@co.th','{"name":"สมชาย รักงาน"}'),
 ('00000000-0000-0000-0000-000000000003','thana@co.th','{}'),
 ('00000000-0000-0000-0000-000000000004','wipa@co.th','{}'),
 ('00000000-0000-0000-0000-000000000005','prasert@co.th','{}'),
 ('00000000-0000-0000-0000-000000000006','eve@co.th','{}');

select t_check('first user is active admin', (select status='active' and 'admin'=any(roles) from profiles where email='admin@co.th'));
select t_check('others start as new', (select bool_and(status='new') from profiles where email<>'admin@co.th'));

set role authenticated;

-- ---- applications ----
select t_as('00000000-0000-0000-0000-000000000001');
select t_check('new user reads no requests', (select count(*)=0 from requests));
select t_check('new user reads departments for the form', (select count(*)=6 from departments));
select t_check('new user sees only self in profiles', (select count(*)=1 from profiles));
update profiles set roles='{admin}', status='active' where id=auth.uid();
select t_check('self-promote changed nothing', (select status='new' from profiles where id=auth.uid()));
select submit_application('นภา ใจดี','เจ้าหน้าที่จัดซื้อ','purchasing','{preparer}','ขอใช้งาน');
select t_check('status pending after apply', (select status='pending' from profiles where id=auth.uid()));
select t_expect_error('cannot apply for admin', $$ select submit_application('x','','it','{admin}','') $$);

do $$
declare u record;
begin
  for u in select * from (values
    ('00000000-0000-0000-0000-000000000002'::uuid,'สมชาย รักงาน','facilities','{approver,preparer}'::text[]),
    ('00000000-0000-0000-0000-000000000003'::uuid,'ธนา มั่นคง','purchasing','{approver}'::text[]),
    ('00000000-0000-0000-0000-000000000004'::uuid,'วิภา ศรีสุข','finance','{approver}'::text[]),
    ('00000000-0000-0000-0000-000000000005'::uuid,'ประเสริฐ วงศ์ดี','finance','{approver}'::text[]),
    ('00000000-0000-0000-0000-000000000006'::uuid,'Eve Other','hr','{preparer}'::text[])) v(id,name,dept,roles)
  loop
    perform t_as(u.id);
    perform submit_application(u.name, '', u.dept, u.roles, '');
  end loop;
end $$;

select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('admin got application notifications', (select count(*)=6 from notifications where user_id=auth.uid()));
select admin_review_application('00000000-0000-0000-0000-000000000001', true, '{preparer}', null, 'purchasing', 'ok');
select admin_review_application('00000000-0000-0000-0000-000000000002', true, '{approver,preparer}', 'dm', 'facilities', '');
select admin_review_application('00000000-0000-0000-0000-000000000003', true, '{approver}', 'dm', 'purchasing', '');
select admin_review_application('00000000-0000-0000-0000-000000000004', true, '{approver}', 'fm', 'finance', '');
select admin_review_application('00000000-0000-0000-0000-000000000005', true, '{approver}', 'md', 'finance', '');
select admin_review_application('00000000-0000-0000-0000-000000000006', true, '{preparer}', null, 'hr', '');
select t_expect_error('approver needs position', $$ select admin_review_application('00000000-0000-0000-0000-000000000006', true, '{approver}', null, null, '') $$);
insert into products (sku, name, category, unit) values ('AC-INV-18000','เครื่องปรับอากาศ Inverter 18,000 BTU','เครื่องใช้ไฟฟ้า','เครื่อง');

-- ---- preparer creates a request ----
select t_as('00000000-0000-0000-0000-000000000001');
select t_expect_error('preparer cannot edit products', $$ insert into products (sku,name) values ('X','y') $$);
select t_expect_error('preparer cannot set status on insert', $$ insert into requests (status) values ('approved') $$);
insert into requests (id, subject_type, sku, qty, unit, unit_price, dept, purpose, buyer_id, company_id, vendor, quote_no, quote_date, comparisons)
values ('11111111-1111-1111-1111-111111111111','general','ac-inv-18000 ',6,'เครื่อง',29050,'facilities','replace',
        '00000000-0000-0000-0000-000000000003','main','บริษัท สยามแอร์ จำกัด','SA-1','2026-10-01',
        '[{"vendor":"คูลเทค","unit_price":30980},{"vendor":"เย็นสบาย","unit_price":31980}]');
select t_expect_error('submit blocked without attachment', $$ select submit_request('11111111-1111-1111-1111-111111111111') $$);
insert into storage.objects (bucket_id, name) values ('attachments','11111111-1111-1111-1111-111111111111/quote.pdf');
insert into request_files (request_id, path, name, size, mime) values ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111/quote.pdf','quote.pdf',1000,'application/pdf');
select t_check('preview: tier 2 → dm facilities (สมชาย) then fm (วิภา)',
  (select string_agg(pos||':'||approver_name, ',' order by step_no) from preview_approvers(186501,'facilities')) = 'dm:สมชาย รักงาน,fm:วิภา ศรีสุข');
select t_check('preview: tier 3 has md', (select count(*)=3 from preview_approvers(600000,'it')));
select t_check('preview: dm falls back when dept has no dm', (select approver_name from preview_approvers(1000,'hr') where pos='dm') is not null);
select 'submitted ' || submit_request('11111111-1111-1111-1111-111111111111', 'ด่วน')::text;
select t_check('amounts recomputed server-side', (select subtotal=174300 and vat=12201 and total=186501 and sku='AC-INV-18000' and product_name like 'เครื่องปรับอากาศ%' from requests where id='11111111-1111-1111-1111-111111111111'));
select t_check('number assigned', (select no ~ '^QT-\d{4}-0001$' from requests where id='11111111-1111-1111-1111-111111111111'));
select t_check('comparison totals stored', (select (comparisons->0->>'total')::numeric = 198891.60 from requests where id='11111111-1111-1111-1111-111111111111'));
update requests set unit_price=1 where id='11111111-1111-1111-1111-111111111111';
select t_check('cannot edit after submit (row locked by status)', (select unit_price=29050 from requests where id='11111111-1111-1111-1111-111111111111'));
select t_expect_error('cannot change status column', $$ update requests set status='approved' where id='11111111-1111-1111-1111-111111111111' $$);
select t_expect_error('preparer cannot approve', $$ select approve_request('11111111-1111-1111-1111-111111111111','') $$);

-- outsider
select t_as('00000000-0000-0000-0000-000000000006');
select t_check('uninvolved user cannot see the request', (select count(*)=0 from requests));
select t_check('uninvolved user cannot see the attachment', (select count(*)=0 from storage.objects where bucket_id='attachments'));

-- buyer can see it
select t_as('00000000-0000-0000-0000-000000000003');
select t_check('buyer can see the request', (select count(*)=1 from requests));

-- ---- approval chain ----
select t_as('00000000-0000-0000-0000-000000000002');
select t_check('step-1 approver sees it + attachment', (select count(*)=1 from requests) and (select count(*)=1 from storage.objects));
select t_check('approver got a waiting notification', (select count(*)=1 from notifications where kind='wait'));
select t_expect_error('approve blocked without signature', $$ select approve_request('11111111-1111-1111-1111-111111111111','') $$);
insert into signatures (user_id, data) values (auth.uid(), 'data:image/png;base64,AAAA');
select t_expect_error('cannot write someone else''s signature', $$ insert into signatures (user_id, data) values ('00000000-0000-0000-0000-000000000004','data:image/png;base64,BBBB') $$);
select t_expect_error('final-step forward not allowed at step 1', $$ select forward_request('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000005','busy') $$);
select 'approve 1 ' || approve_request('11111111-1111-1111-1111-111111111111','ok')::text;
select t_expect_error('cannot approve twice', $$ select approve_request('11111111-1111-1111-1111-111111111111','') $$);

select t_as('00000000-0000-0000-0000-000000000004');
select t_check('step 2 now pending for วิภา', (select approver_id=auth.uid() and status='pending' from request_steps where request_id='11111111-1111-1111-1111-111111111111' and step_no=1));
select t_check('no candidates yet (nobody else has a signature)', (select count(*)=0 from forward_candidates('11111111-1111-1111-1111-111111111111')));
reset role;
insert into signatures (user_id, data) values ('00000000-0000-0000-0000-000000000005','data:image/png;base64,CCCC');
set role authenticated;
select t_check('ประเสริฐ is a candidate', (select string_agg(name, ',') from forward_candidates('11111111-1111-1111-1111-111111111111')) = 'ประเสริฐ วงศ์ดี');
select t_expect_error('cannot forward to someone without signature', $$ select forward_request('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000003','busy') $$);
select forward_request('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000005','ติดประชุม');
select t_expect_error('original approver can no longer approve', $$ select approve_request('11111111-1111-1111-1111-111111111111','') $$);

select t_as('00000000-0000-0000-0000-000000000005');
select 'approve 2 ' || approve_request('11111111-1111-1111-1111-111111111111','อนุมัติแทน')::text;
select t_check('request approved', (select status='approved' and completed_at is not null from requests where id='11111111-1111-1111-1111-111111111111'));
select t_check('step 2 signed by ประเสริฐ on behalf of วิภา', (select signer_id='00000000-0000-0000-0000-000000000005' and on_behalf_of='00000000-0000-0000-0000-000000000004' and signature like 'data:image%' from request_steps where request_id='11111111-1111-1111-1111-111111111111' and step_no=1));

-- ---- letter ----
select t_as('00000000-0000-0000-0000-000000000001');
insert into storage.objects (bucket_id, name) values ('letters','11111111-1111-1111-1111-111111111111/QT.pdf');
select set_letter('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111/QT.pdf');
select t_check('letter path stored', (select letter_path is not null from requests where id='11111111-1111-1111-1111-111111111111'));
select t_expect_error('letter path must be inside request folder', $$ select set_letter('11111111-1111-1111-1111-111111111111','other/x.pdf') $$);
select t_check('preparer notifications: sent, step ok, forwarded, done', (select count(*)>=4 from notifications));
select t_check('history has sent/approved/forwarded/completed/pdf', (select array_agg(kind order by id) @> '{sent,approved,forwarded,completed,pdf}' from request_log));

-- ---- reject → reopen → resend keeps number ----
insert into requests (id, sku, qty, unit, unit_price, dept, buyer_id, company_id, vendor, no_comp, no_comp_reason)
values ('22222222-2222-2222-2222-222222222222','AC-INV-18000',1,'เครื่อง',20000,'purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย A',true,'');
insert into request_files (request_id, path, name) values ('22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222/q.pdf','q.pdf');
select t_expect_error('no-comparison needs a reason', $$ select submit_request('22222222-2222-2222-2222-222222222222') $$);
update requests set no_comp_reason='ตัวแทนจำหน่ายรายเดียว' where id='22222222-2222-2222-2222-222222222222';
select submit_request('22222222-2222-2222-2222-222222222222');
select t_check('tier 1, single step to dm purchasing (ธนา)', (select count(*)=1 and max(approver_id::text)='00000000-0000-0000-0000-000000000003' from request_steps where request_id='22222222-2222-2222-2222-222222222222'));
select t_as('00000000-0000-0000-0000-000000000003');
select t_expect_error('reject needs a comment', $$ select reject_request('22222222-2222-2222-2222-222222222222','  ') $$);
select reject_request('22222222-2222-2222-2222-222222222222','ราคาสูงไป');
select t_as('00000000-0000-0000-0000-000000000001');
select reopen_request('22222222-2222-2222-2222-222222222222');
update requests set unit_price=18000 where id='22222222-2222-2222-2222-222222222222';
select submit_request('22222222-2222-2222-2222-222222222222');
select t_check('resent keeps number 0002', (select no like '%-0002' and status='pending' and total=19260 from requests where id='22222222-2222-2222-2222-222222222222'));

-- ---- admin controls ----
select t_as('00000000-0000-0000-0000-00000000000a');
select admin_remind('22222222-2222-2222-2222-222222222222');
select admin_reassign('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000002','ธนาลาพักร้อน');
select t_check('reassigned to สมชาย', (select approver_id='00000000-0000-0000-0000-000000000002' from request_steps where request_id='22222222-2222-2222-2222-222222222222' and step_no=0));
select cancel_request('22222222-2222-2222-2222-222222222222','ทดสอบยกเลิก');
select t_check('cancelled', (select status='cancelled' from requests where id='22222222-2222-2222-2222-222222222222'));
select t_check('admin overview works', (select jsonb_array_length(admin_user_overview('00000000-0000-0000-0000-000000000001')->'my_requests')=2));
insert into app_errors (page, message) values ('/x', 'boom');
select t_check('admin sees errors', (select count(*)=1 from app_errors));

select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('non-admin cannot use admin overview', $$ select admin_user_overview('00000000-0000-0000-0000-000000000001') $$);
insert into app_errors (page, message) values ('/y', 'my error');
select t_check('non-admin cannot read errors', (select count(*)=0 from app_errors));
select t_expect_error('notification column lock', $$ update notifications set title='x' $$);

-- disabled user loses access
select t_as('00000000-0000-0000-0000-00000000000a');
update profiles set status='disabled' where id='00000000-0000-0000-0000-000000000001';
select t_as('00000000-0000-0000-0000-000000000001');
select t_check('disabled user sees no requests', (select count(*)=0 from requests));

select 'ALL TESTS PASSED';
