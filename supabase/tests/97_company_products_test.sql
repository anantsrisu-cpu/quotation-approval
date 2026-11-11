-- 0017: SKU list per company; clear per company; clear own notifications. Runs after 96; applies 0017 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
insert into products (sku, name, unit) values ('SHARE-1', 'สินค้าใช้ร่วม', 'ชิ้น');
\i supabase/migrations/0017_company_products_clear_notifs.sql
select t_check('existing SKUs copied to every company', (select count(*) = 2 from products where sku = 'SHARE-1')
  and (select count(*) = 0 from products where company_id is null));
\i supabase/migrations/0017_company_products_clear_notifs.sql
select t_check('running again changes nothing', (select count(*) = 4 from products));

set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
-- same code, a different product in the sister company
insert into products (company_id, sku, name, unit) values ('main', 'DUP-1', 'น้ำมันหล่อลื่น 1 ลิตร', 'ขวด'), ('trr-bio', 'DUP-1', 'เอทานอล 200 ลิตร', 'ถัง');
select t_expect_error('one SKU once per company', $$ insert into products (company_id, sku, name) values ('main', 'DUP-1', 'x') $$);
select t_expect_error('company must exist', $$ insert into products (company_id, sku, name) values ('nope', 'Z-1', 'x') $$);

select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('afafafaf-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','trr-bio','ผู้ขาย',
  '[{"sku":"dup-1","qty":2,"unit_price":100}]', true, 'รายเดียว', 'R11-HO.26110007');
insert into request_files (request_id, path, name) values ('afafafaf-0000-0000-0000-000000000001','afafafaf-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('afafafaf-0000-0000-0000-000000000001')::text;
select t_check('the buyer company''s product is used', (select items->0->>'product_name' = 'เอทานอล 200 ลิตร' and items->0->>'unit' = 'ถัง' from requests where id = 'afafafaf-0000-0000-0000-000000000001'));

select t_as('00000000-0000-0000-0000-00000000000a');
insert into products (company_id, sku, name) values ('main', 'MAIN-ONLY', 'เฉพาะบริษัทหลัก');
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('afafafaf-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000003','trr-bio','ผู้ขาย',
  '[{"sku":"MAIN-ONLY","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11-HO.26110008');
insert into request_files (request_id, path, name) values ('afafafaf-0000-0000-0000-000000000002','afafafaf-0000-0000-0000-000000000002/q.pdf','q.pdf');
select t_expect_error('a SKU of another company cannot be used', $$ select submit_request('afafafaf-0000-0000-0000-000000000002') $$);

-- ---- clear per company ----
select t_expect_error('non-admin cannot clear products', $$ select admin_clear_products('ลบทั้งหมด', array['main']) $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('clear one company', admin_clear_products('ลบทั้งหมด', array['trr-bio']) = 3);
select t_check('the other company keeps its SKUs', (select count(*) = 0 from products where company_id = 'trr-bio') and (select count(*) = 4 from products where company_id = 'main'));
select t_check('clear every company', admin_clear_products('ลบทั้งหมด') = 4);
select t_check('no SKUs left', (select count(*) = 0 from products));

-- ---- notifications ----
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('clear my notifications', clear_my_notifications() > 0);
reset role;
select t_check('only mine are gone', (select count(*) = 0 from notifications where user_id = '00000000-0000-0000-0000-000000000007')
  and (select count(*) > 0 from notifications where user_id <> '00000000-0000-0000-0000-000000000007'));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('nothing left to clear', clear_my_notifications() = 0);
reset role;

select 'ALL 0017 TESTS PASSED';
