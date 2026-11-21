-- 0027: production lock after go-live; SKU list and tiers only for active accounts. Runs last; applies 0027 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0027_production_lock.sql
\i supabase/migrations/0027_production_lock.sql

-- an account still waiting for approval
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'waiting@example.com', '{"full_name":"รออนุมัติ"}') on conflict do nothing;
update profiles set status = 'pending' where id = '00000000-0000-0000-0000-0000000000f1';

set role authenticated;
select t_as('00000000-0000-0000-0000-0000000000f1');
select t_check('account not active sees no SKUs and no approval limits',
  (select count(*) from products) = 0 and (select count(*) from tiers) = 0);
select t_check('…but still sees departments and companies (application form)',
  (select count(*) from departments) > 0 and (select count(*) from companies) > 0);
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('active preparer sees SKUs and limits', (select count(*) from products) > 0 and (select count(*) from tiers) > 0);
select t_expect_error('preparer cannot lock', $$ select admin_lock_production('GO-LIVE') $$);

select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('lock needs the word GO-LIVE', $$ select admin_lock_production('yes') $$);
select t_check('not locked yet', (select not prod_locked from app_settings where id = 1));
select admin_lock_production('go-live')::text;
select t_check('locked, with who and when', (select prod_locked and prod_locked_at is not null
  and prod_locked_by = '00000000-0000-0000-0000-00000000000a' from app_settings where id = 1));
select t_expect_error('clear-all refused once locked', $$ select admin_reset_requests('ลบทั้งหมด') $$);
select t_expect_error('admin cannot unlock from the app', $$ update app_settings set prod_locked = false where id = 1 $$);
update app_settings set vat_rate = vat_rate where id = 1;
select admin_lock_production('GO-LIVE')::text;  -- locking again is harmless

reset role;
select t_check('requests are still there', (select count(*) from requests) > 0);
select t_as(null);
update app_settings set prod_locked = false where id = 1;  -- SQL Editor (no signed-in user) can unlock
select t_check('SQL Editor unlocked it', (select not prod_locked from app_settings where id = 1));
select 'ALL 0027 TESTS PASSED';
