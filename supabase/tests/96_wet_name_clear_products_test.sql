-- 0016: name for hand-signing positions; admin clears every SKU. Runs after 95; applies 0016 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0016_wet_name_clear_products.sql
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
update positions set sign_mode = 'online', wet_name = '';
update positions set sign_mode = 'wet', wet_name = '  นายสมชาย ใจดี ' where code = 'dm';
select t_expect_error('name is at most 100 characters', $$ update positions set wet_name = repeat('ก', 101) where code = 'dm' $$);

select t_as('00000000-0000-0000-0000-000000000007');
select t_check('preview shows the set name for the hand-signer',
  (select approver_name = 'นายสมชาย ใจดี' and sign_mode = 'wet' from preview_approvers(1000, 'purchasing') where pos = 'dm'));

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('aeaeaeae-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขาย',
  '[{"sku":"P-001","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11-HO.26110006');
insert into request_files (request_id, path, name) values ('aeaeaeae-0000-0000-0000-000000000001','aeaeaeae-0000-0000-0000-000000000001/q.pdf','q.pdf');
select submit_request('aeaeaeae-0000-0000-0000-000000000001')::text;
select t_check('the name is saved in the signing plan',
  (select x->>'name' = 'นายสมชาย ใจดี' from requests, jsonb_array_elements(sign_plan) x
   where id = 'aeaeaeae-0000-0000-0000-000000000001' and x->>'position' = 'dm'));

-- empty name: the approver set up for the position, as before
select t_as('00000000-0000-0000-0000-00000000000a');
update positions set wet_name = '' where code = 'dm';
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('no name set → the position''s approver',
  (select approver_name is not null and approver_name <> 'นายสมชาย ใจดี' from preview_approvers(1000, 'purchasing') where pos = 'dm'));

-- ---- clear every SKU (admin only, typed confirmation) ----
select t_expect_error('non-admin cannot clear products', $$ select admin_clear_products('ลบทั้งหมด') $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('wrong confirmation word', $$ select admin_clear_products('clear') $$);
select t_check('clear reports how many SKUs it removed', admin_clear_products('ลบทั้งหมด') > 0);
select t_check('no SKUs left', (select count(*) = 0 from products));
select t_check('requests keep their items', (select items->0->>'sku' = 'P-001' from requests where id = 'aeaeaeae-0000-0000-0000-000000000001'));
insert into products (sku, name, unit) values ('NEW-001', 'สินค้าใหม่', 'ชิ้น');
select t_check('a fresh list can be uploaded', (select count(*) = 1 from products));
reset role;
update positions set sign_mode = 'online', wet_name = '';

select 'ALL 0016 TESTS PASSED';
