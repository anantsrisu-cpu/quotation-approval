-- 0003 features: pre-created accounts, multi-item requests, previous price, admin drafting on behalf.
-- Runs after 10_workflow_test.sql in the same database.
\set QUIET on
\pset format unaligned
\pset tuples_only on

reset role;
insert into products (sku, name, unit)
  select 'P-' || lpad(g::text, 3, '0'), 'สินค้าทดสอบ ' || g, 'ชิ้น' from generate_series(1, 15) g;
set role authenticated;

-- ---- admin pre-creates accounts ----
select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('non-admin cannot create accounts', $$ select admin_create_account('x@co.th','X','','it','{preparer}',null) $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('bad e-mail rejected', $$ select admin_create_account('not-an-email','X','','it','{preparer}',null) $$);
select t_expect_error('approver needs a position', $$ select admin_create_account('y@co.th','Y','','it','{approver}',null) $$);
select t_check('invite created', admin_create_account(' Kanya@CO.th ','กัญญา ตั้งใจ','เจ้าหน้าที่จัดซื้อ','purchasing','{preparer}',null,'data:image/png;base64,KKKK') = 'invited');
select t_check('invite stored lower-case', (select count(*)=1 from user_invites where email='kanya@co.th' and used_at is null));
select t_check('existing user is updated directly', admin_create_account('eve@co.th','Eve Other','HR','hr','{preparer,approver}','dm',null) = 'updated');
select t_check('eve now approver dm', (select 'approver'=any(roles) and position='dm' from profiles where email='eve@co.th'));

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000007','KANYA@co.th','{"full_name":"Kanya T."}');
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('pre-created user is active at first sign-in', (select status='active' and roles='{preparer}' and name='กัญญา ตั้งใจ' and dept='purchasing' from profiles where id=auth.uid()));
select t_check('signature copied from invite', (select data='data:image/png;base64,KKKK' from signatures where user_id=auth.uid()));
select t_check('welcome notification', (select count(*)=1 from notifications where user_id=auth.uid()));
select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('invite marked used and signature cleared', (select used_by='00000000-0000-0000-0000-000000000007' and signature is null from user_invites where email='kanya@co.th'));

-- ---- multi-item request with previous prices & per-item comparison ----
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, sku, product_name, dept, buyer_id, company_id, vendor, quote_no, items, comparisons, low_reason)
select '33333333-3333-3333-3333-333333333333', 'P-001', 'สินค้าทดสอบ 1', 'purchasing',
       '00000000-0000-0000-0000-000000000003', 'main', 'ผู้ขายหลัก', 'Q-12',
       (select jsonb_agg(jsonb_build_object('sku', lower('P-' || lpad(g::text,3,'0')), 'description', 'รายละเอียดยาว ' || repeat('ก', g * 10),
               'qty', g, 'unit', '', 'unit_price', 100 * g, 'prev_price', case when g % 2 = 0 then 90 * g end) order by g)
          from generate_series(1, 12) g),
       jsonb_build_array(
         jsonb_build_object('vendor', 'คู่เทียบ A', 'prices', (select jsonb_agg(110 * g order by g) from generate_series(1, 12) g)),
         jsonb_build_object('vendor', 'คู่เทียบ B', 'prices', (select jsonb_agg(95 * g order by g) from generate_series(1, 12) g))),
       'ส่งของเร็วกว่า';
insert into request_files (request_id, path, name) values ('33333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333/q.pdf','q.pdf');

update requests set items = jsonb_set(items, '{2,sku}', '"NOPE"') where id='33333333-3333-3333-3333-333333333333';
select t_expect_error('unknown SKU names the line', $$ select submit_request('33333333-3333-3333-3333-333333333333') $$);
update requests set items = jsonb_set(items, '{2,sku}', '"P-003"'),
                    comparisons = jsonb_set(comparisons, '{0,prices,5}', 'null') where id='33333333-3333-3333-3333-333333333333';
select t_expect_error('comparison missing one item price', $$ select submit_request('33333333-3333-3333-3333-333333333333') $$);
update requests set comparisons = jsonb_set(comparisons, '{0,prices}', (comparisons->0->'prices') - 5) where id='33333333-3333-3333-3333-333333333333';
select t_expect_error('comparison with too few prices', $$ select submit_request('33333333-3333-3333-3333-333333333333') $$);
update requests set comparisons = jsonb_set(comparisons, '{0,prices}', (select jsonb_agg(110 * g order by g) from generate_series(1, 12) g)) where id='33333333-3333-3333-3333-333333333333';
select submit_request('33333333-3333-3333-3333-333333333333', '12 รายการ')::text;

-- sum(100*g*g, g=1..12) = 65,000 ; VAT 4,550 ; total 69,550 → tier 2
select t_check('subtotal from 12 lines', (select subtotal=65000 and vat=4550 and total=69550 from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('12 items stored with names/units/line totals', (select jsonb_array_length(items)=12 and items->11->>'product_name'='สินค้าทดสอบ 12' and items->0->>'unit'='ชิ้น' and (items->11->>'line_total')::numeric=14400 and items->0->>'sku'='P-001' from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('long description kept', (select length(items->11->>'description') > 100 from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('previous price % (100 vs 90 → +11.11%)', (select (items->1->>'prev_diff_pct')::numeric = 11.11 and items->0->'prev_diff_pct' = 'null'::jsonb from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('summary name for lists', (select product_name='สินค้าทดสอบ 1 และอีก 11 รายการ' and sku like 'P-001, P-002%' from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('comparison per-vendor totals (A 71,500 / B 61,750 subtotal)', (select jsonb_array_length(comparisons)=2 and (comparisons->0->>'subtotal')::numeric=71500 and (comparisons->1->>'subtotal')::numeric=61750 and jsonb_array_length(comparisons->1->'lines')=12 from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('low reason kept because B is cheaper', (select low_reason='ส่งของเร็วกว่า' from requests where id='33333333-3333-3333-3333-333333333333'));
select t_check('tier 2 → two steps', (select count(*)=2 from request_steps where request_id='33333333-3333-3333-3333-333333333333'));

-- ---- admin drafts on behalf of a preparer ----
select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('preparer cannot draft for someone else', $$ insert into requests (preparer_id, vendor) values ('00000000-0000-0000-0000-000000000007','x') $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('admin cannot draft for a non-preparer', $$ insert into requests (preparer_id, vendor) values ('00000000-0000-0000-0000-000000000003','x') $$);
insert into requests (id, preparer_id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000007','purchasing',
        '00000000-0000-0000-0000-000000000003','main','ผู้ขายเดียว',
        '[{"sku":"P-001","qty":2,"unit_price":500,"prev_price":450},{"sku":"P-002","description":"สีดำ","qty":1,"unit_price":1000}]',
        true, 'ตัวแทนรายเดียว');
select t_check('created_by recorded as admin', (select created_by='00000000-0000-0000-0000-00000000000a' from requests where id='44444444-4444-4444-4444-444444444444'));
insert into storage.objects (bucket_id, name) values ('attachments','44444444-4444-4444-4444-444444444444/q.pdf');
insert into request_files (request_id, path, name) values ('44444444-4444-4444-4444-444444444444','44444444-4444-4444-4444-444444444444/q.pdf','q.pdf');
update requests set vendor='ผู้ขายเดียว จำกัด' where id='44444444-4444-4444-4444-444444444444';
select t_check('admin can edit the draft they made', (select vendor='ผู้ขายเดียว จำกัด' from requests where id='44444444-4444-4444-4444-444444444444'));
select submit_request('44444444-4444-4444-4444-444444444444')::text;
select t_check('proxy request: preparer kept, preparer signature used', (select preparer_id='00000000-0000-0000-0000-000000000007' and preparer_signature='data:image/png;base64,KKKK' and total=2140 and status='pending' from requests where id='44444444-4444-4444-4444-444444444444'));
select t_check('log says drafted on behalf', (select text like '%จัดทำแทน%' from request_log where request_id='44444444-4444-4444-4444-444444444444' and kind='sent'));

select t_as('00000000-0000-0000-0000-000000000007');
select t_check('real preparer sees it and was notified', (select count(*)=1 from requests where id='44444444-4444-4444-4444-444444444444') and (select count(*)=1 from notifications where request_id='44444444-4444-4444-4444-444444444444' and title like 'ผู้ดูแลส่งคำขอแทนคุณ%'));

-- preparer's own draft cannot be touched by another preparer
insert into requests (id, vendor) values ('55555555-5555-5555-5555-555555555555','mine');
select t_as('00000000-0000-0000-0000-000000000006');
update requests set vendor='hijack' where id='55555555-5555-5555-5555-555555555555';
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('other preparer could not edit my draft', (select vendor='mine' from requests where id='55555555-5555-5555-5555-555555555555'));
select t_expect_error('preparer cannot hand the draft to someone else', $$ update requests set preparer_id='00000000-0000-0000-0000-000000000006' where id='55555555-5555-5555-5555-555555555555' $$);

select 'ALL 0003 TESTS PASSED';
