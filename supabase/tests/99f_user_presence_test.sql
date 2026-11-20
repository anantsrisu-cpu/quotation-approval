-- 0024: who is online. Applies 0024 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0024_user_presence.sql
\i supabase/migrations/0024_user_presence.sql

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select touch_presence('online', '/requests/new');
select t_expect_error('users cannot read presence', $$ do $x$ begin perform 1 from user_presence; end $x$ $$);
select t_expect_error('users cannot write presence directly', $$ insert into user_presence (user_id) values ('00000000-0000-0000-0000-000000000006') $$);
select t_expect_error('only admins see who is online', $$ select * from admin_presence() $$);
select t_as('00000000-0000-0000-0000-000000000006');
select touch_presence('online', '/inbox');
select touch_presence('closed');

select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('online now', (select status = 'online' and page = '/requests/new' from admin_presence() where user_id = '00000000-0000-0000-0000-000000000007'));
select t_check('page closed = offline', (select status = 'offline' and page = '/inbox' from admin_presence() where user_id = '00000000-0000-0000-0000-000000000006'));
reset role;
update user_presence set last_seen = now() - interval '5 minutes' where user_id = '00000000-0000-0000-0000-000000000007';
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('silent 5 min while open = lost (red)', (select status = 'lost' and seconds_ago between 295 and 310 from admin_presence() where user_id = '00000000-0000-0000-0000-000000000007'));
reset role;
update user_presence set last_seen = now() - interval '40 minutes' where user_id = '00000000-0000-0000-0000-000000000007';
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('silent 40 min = offline', (select status = 'offline' from admin_presence() where user_id = '00000000-0000-0000-0000-000000000007'));
select t_as('00000000-0000-0000-0000-000000000007');
select touch_presence('online', '/requests');
reset role;
select t_check('back online: a new online spell starts', (select state = 'online' and since > now() - interval '5 seconds' from user_presence where user_id = '00000000-0000-0000-0000-000000000007'));
select t_check('one row per person', (select count(*) = 2 from user_presence));
select 'ALL 0024 TESTS PASSED';
