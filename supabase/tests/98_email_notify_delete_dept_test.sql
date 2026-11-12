-- 0018: e-mail notification settings + queue; delete an unused department. Runs after 97; applies 0018 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0018_email_notify_delete_dept.sql
\i supabase/migrations/0018_email_notify_delete_dept.sql
delete from notifications;

-- ---- each account's own setting ----
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_expect_error('other domain refused', $$ select set_my_email_prefs(true, 'kanya@gmail.com') $$);
select t_expect_error('not an e-mail refused', $$ select set_my_email_prefs(true, 'kanya') $$);
select set_my_email_prefs(true, '  Purchasing.Team@CO.TH ');
select t_check('same domain accepted, stored lower case', (select notify_email = 'purchasing.team@co.th' and email_notify from profiles where id = '00000000-0000-0000-0000-000000000007'));
select t_expect_error('a user cannot edit profiles directly', $$ do $x$ begin update profiles set notify_email = 'x@co.th' where id = '00000000-0000-0000-0000-000000000001'; if not found then raise exception 'no row'; end if; end $x$ $$);

-- admin sets it for another account (same rule)
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('admin: other domain refused too', $$ update profiles set notify_email = 'napa@other.com' where id = '00000000-0000-0000-0000-000000000001' $$);
update profiles set notify_email = 'napa2@co.th' where id = '00000000-0000-0000-0000-000000000001';
update profiles set notify_email = 'thana@co.th' where id = '00000000-0000-0000-0000-000000000003';
select t_check('same as sign-in e-mail is not kept twice', (select notify_email = '' from profiles where id = '00000000-0000-0000-0000-000000000003'));

-- ---- queue ----
reset role;
select notify('00000000-0000-0000-0000-000000000007', null, 'ok', 'ปิดอยู่', '');
select t_check('system switch off → nothing queued', (select count(*) = 0 from email_outbox));
update app_settings set email_enabled = true;
select notify('00000000-0000-0000-0000-000000000007', null, 'wait', 'มีคำขอรอคุณอนุมัติ', 'R11-HO.26110001');
select t_check('queued to sign-in + extra address', (select to_emails = array['kanya@co.th','purchasing.team@co.th'] and status = 'pending' and subject = 'มีคำขอรอคุณอนุมัติ' from email_outbox));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select set_my_email_prefs(false, 'purchasing.team@co.th');
reset role;
select notify('00000000-0000-0000-0000-000000000007', null, 'ok', 'ไม่ส่ง', '');
select t_check('account switched off → not queued, in-app still there', (select count(*) = 1 from email_outbox) and (select count(*) = 3 from notifications));

-- users cannot read or write the queue; admin reads
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('user sees no queue rows', (select count(*) = 0 from email_outbox));
select t_expect_error('user cannot insert', $$ insert into email_outbox (to_emails, subject) values (array['x@co.th'], 'x') $$);
select t_expect_error('user cannot claim', $$ select claim_emails(5) $$);
select t_expect_error('user cannot test', $$ select admin_test_email() $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('admin sees the queue', (select count(*) = 1 from email_outbox));
select t_check('test e-mail goes to the admin', admin_test_email() = array['admin@co.th']);

-- the sender claims each row once
reset role;
select t_check('claim hands out both', (select count(*) = 2 from claim_emails(10)));
select t_check('second claim gets nothing', (select count(*) = 0 from claim_emails(10)));
update email_outbox set claimed_at = now() - interval '11 minutes' where subject like 'ทดสอบ%';
select t_check('a stuck row is handed out again', (select count(*) = 1 from claim_emails(10)));
update email_outbox set status = 'failed', error = 'x';
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
select t_check('retry puts failed back', admin_retry_emails() = 2);
reset role;
select t_check('pending again', (select count(*) = 2 from email_outbox where status = 'pending' and attempts = 0));

-- ---- delete a department ----
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_expect_error('non-admin cannot delete', $$ select admin_delete_department('it') $$);
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_error('in use by requests/users', $$ select admin_delete_department('purchasing') $$);
select t_expect_error('in use by users', $$ select admin_delete_department('hr') $$);
select admin_delete_department('it');
select t_check('unused department deleted', (select count(*) = 0 from departments where id = 'it'));
select t_expect_error('already gone', $$ select admin_delete_department('it') $$);
reset role;
update app_settings set email_enabled = false;

select 'ALL 0018 TESTS PASSED';
