-- 0022: company groups on the sheet header. Applies 0022 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0022_sheet_company_groups.sql
select t_check('first run: every company in one group (sheets unchanged)', (select count(distinct sheet_group) = 1 and min(sheet_group) = 'กลุ่มหลัก' from companies));
update companies set sheet_group = '' where id = (select id from companies order by sort desc limit 1);
\i supabase/migrations/0022_sheet_company_groups.sql
select t_check('running again keeps the groups the admin set', (select count(*) = 1 from companies where sheet_group = ''));
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
update companies set sheet_group = 'เอจี' where sheet_group = '';
select t_check('admin sets a group', (select count(*) = 1 from companies where sheet_group = 'เอจี'));
select t_as('00000000-0000-0000-0000-000000000007');
update companies set sheet_group = 'x';
select t_check('others cannot change groups', (select count(*) = 1 from companies where sheet_group = 'เอจี'));
select t_check('everyone reads the groups', (select count(*) >= 2 from companies));
reset role;
select t_expect_error('group name limited to 60 characters', $$ update companies set sheet_group = repeat('ก', 61) where sheet_group = 'เอจี' $$);
select 'ALL 0022 TESTS PASSED';
