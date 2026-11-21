-- 0025: acting approver while someone is away. Applies 0025 itself.
-- dm = สมชาย (02), fm = วิภา (04) for purchasing / main; tier 2 (≤ 500,000) = dm → fm
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0025_acting_approver.sql
\i supabase/migrations/0025_acting_approver.sql
insert into products (company_id, sku, name, unit) values ('main', 'ACT-1', 'กระสอบ', 'ใบ') on conflict do nothing;
delete from notifications;

create or replace function pg_temp.new_req(rid uuid, rno text) returns void language plpgsql as $$
begin
  perform t_as('00000000-0000-0000-0000-000000000007');
  insert into requests (id, dept, buyer_id, company_id, vendor, report_no, items, no_comp, no_comp_reason)
  values (rid, 'purchasing', '00000000-0000-0000-0000-000000000007', 'main', 'ผู้ขาย', rno,
          '[{"sku":"ACT-1","qty":1000,"unit_price":100}]', true, 'รายเดียว');
  insert into request_files (request_id, path, name) values (rid, rid || '/q.pdf', 'q.pdf');
  perform submit_request(rid);
end $$;

-- 1. nothing set: dm approves, fm still has to
set role authenticated;
select pg_temp.new_req('f1f1f1f1-0000-0000-0000-000000000001', 'R11-HO.26110501');
select t_as('00000000-0000-0000-0000-000000000002');
select approve_request('f1f1f1f1-0000-0000-0000-000000000001')::text;
select t_check('not set: fm still waiting', (select status = 'pending' and current_step = 1 from requests where id = 'f1f1f1f1-0000-0000-0000-000000000001'));

-- 2. only the position set, switch off: no change
reset role;
update positions set acting_for = '{fm}' where code = 'dm';
set role authenticated;
select pg_temp.new_req('f1f1f1f1-0000-0000-0000-000000000002', 'R11-HO.26110502');
select t_as('00000000-0000-0000-0000-000000000002');
select approve_request('f1f1f1f1-0000-0000-0000-000000000002')::text;
select t_check('switch off: fm still waiting', (select status = 'pending' and current_step = 1 from requests where id = 'f1f1f1f1-0000-0000-0000-000000000002'));

-- only admins switch it on
select t_as('00000000-0000-0000-0000-000000000002');
update profiles set acting_on = true where id = '00000000-0000-0000-0000-000000000002';
reset role;
select t_check('approver cannot switch acting on for themselves', (select not acting_on from profiles where id = '00000000-0000-0000-0000-000000000002'));
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
update profiles set acting_on = true where id = '00000000-0000-0000-0000-000000000002';
reset role;
select t_check('admin switches it on (time kept)', (select acting_on and acting_since > now() - interval '5 seconds' from profiles where id = '00000000-0000-0000-0000-000000000002'));

-- 3. both set, fm signs in the app: dm's approval also approves fm's step "แทน"
set role authenticated;
select pg_temp.new_req('f1f1f1f1-0000-0000-0000-000000000003', 'R11-HO.26110503');
select t_as('00000000-0000-0000-0000-000000000002');
select approve_request('f1f1f1f1-0000-0000-0000-000000000003')::text;
reset role;
select t_check('online fm approved by dm on her behalf; request complete',
  (select r.status = 'approved' from requests r where id = 'f1f1f1f1-0000-0000-0000-000000000003')
  and (select acting and status = 'approved' and signer_id = '00000000-0000-0000-0000-000000000002' and on_behalf_of = '00000000-0000-0000-0000-000000000004'
         and signature = (select data from signatures where user_id = '00000000-0000-0000-0000-000000000002')
       from request_steps where request_id = 'f1f1f1f1-0000-0000-0000-000000000003' and step_no = 1));
select t_check('the absent fm is told; history records it',
  (select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-000000000004' and request_id = 'f1f1f1f1-0000-0000-0000-000000000003' and title like 'มีการอนุมัติแทนคุณ%')
  and (select count(*) = 1 from request_log where request_id = 'f1f1f1f1-0000-0000-0000-000000000003' and text like '%อนุมัติแทน%'));

-- 4. fm signs by hand (ลายเซ็นสด): dm's signature goes in fm's box, marked
update positions set sign_mode = 'wet', wet_name = 'คุณปิยดา เจนวาณิชย์' where code = 'fm';
set role authenticated;
select pg_temp.new_req('f1f1f1f1-0000-0000-0000-000000000004', 'R11-HO.26110504');
select t_as('00000000-0000-0000-0000-000000000002');
select approve_request('f1f1f1f1-0000-0000-0000-000000000004')::text;
reset role;
select t_check('wet fm box gets dm''s signature (แทน); name kept',
  (select status = 'approved'
      and (select e->>'acting_by' = '00000000-0000-0000-0000-000000000002' and e->>'acting_sig' = (select data from signatures where user_id = '00000000-0000-0000-0000-000000000002')
              and e->>'name' = 'คุณปิยดา เจนวาณิชย์' and e->>'acting_at' is not null
           from jsonb_array_elements(sign_plan) e where e->>'position' = 'fm')
   from requests where id = 'f1f1f1f1-0000-0000-0000-000000000004'));

-- 5. switched off again: back to normal
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
update profiles set acting_on = false where id = '00000000-0000-0000-0000-000000000002';
select pg_temp.new_req('f1f1f1f1-0000-0000-0000-000000000005', 'R11-HO.26110505');
select t_as('00000000-0000-0000-0000-000000000002');
select approve_request('f1f1f1f1-0000-0000-0000-000000000005')::text;
reset role;
select t_check('switched off: wet box left for the hand signature',
  (select (select e->'acting_by' is null from jsonb_array_elements(sign_plan) e where e->>'position' = 'fm') from requests where id = 'f1f1f1f1-0000-0000-0000-000000000005')
  and (select acting_since is null from profiles where id = '00000000-0000-0000-0000-000000000002'));

update positions set sign_mode = 'online', wet_name = '', acting_for = '{}' where code in ('dm', 'fm');
select 'ALL 0025 TESTS PASSED';
