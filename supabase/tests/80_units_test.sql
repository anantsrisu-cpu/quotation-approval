-- 0009: configurable units. Runs after 70_award_delivery_test.sql in the same database.
\set QUIET on
\pset format unaligned
\pset tuples_only on

reset role;
insert into products (sku, name, unit) values ('U-1', 'สารเคลือบ', 'กก.') on conflict do nothing;
\i supabase/migrations/0009_units.sql
set role authenticated;

select t_as('00000000-0000-0000-0000-000000000006');
select t_check('built-in units seeded and readable', (select count(*) >= 12 from units where active));
select t_check('product units carried over (กก.)', (select count(*) = 1 from units where name = 'กก.'));
select t_expect_error('preparer cannot add a unit', $$ insert into units (name) values ('ถัง') $$);

select t_as('00000000-0000-0000-0000-00000000000a');
insert into units (name, sort) values ('ถัง', 130);
select t_check('admin adds ถัง', (select count(*) = 1 from units where name = 'ถัง'));
update units set active = false where name = 'รีม';
select t_check('admin deactivates รีม', (select not active from units where name = 'รีม'));
select t_expect_error('blank unit rejected', $$ insert into units (name) values ('  ') $$);
select t_expect_error('duplicate unit rejected', $$ insert into units (name) values ('ถัง') $$);
select t_expect_error('unit over 20 characters rejected', $$ insert into units (name) values (repeat('ก', 21)) $$);

-- running the migration again keeps admin changes
reset role;
\i supabase/migrations/0009_units.sql
select t_check('re-run keeps ถัง and the deactivated รีม', (select count(*) = 1 from units where name = 'ถัง') and (select not active from units where name = 'รีม'));

select 'ALL 0009 TESTS PASSED';
