-- 0019: hand a draft to the buyer; maintenance switch. Runs after 98; applies 0019 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0019_buyer_handoff_maintenance.sql
\i supabase/migrations/0019_buyer_handoff_maintenance.sql
delete from notifications;
insert into products (company_id, sku, name, unit) values ('main', 'PEN-99', 'ปากกา', 'ด้าม') on conflict do nothing;

-- กัญญา (07, preparer) drafts; the buyer is Eve (06, preparer); ธนา (03) is an approver only
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('b0b0b0b0-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000006','main','ผู้ขาย',
  '[{"sku":"PEN-99","qty":2,"unit_price":100}]', true, 'รายเดียว', 'R11-HO.26110101');
select t_expect_error('client cannot set handoff itself', $$ update requests set handoff = true where id = 'b0b0b0b0-0000-0000-0000-000000000001' $$);

-- before the hand-over the buyer can read but not edit
select t_as('00000000-0000-0000-0000-000000000006');
select t_check('buyer reads the draft', (select count(*) = 1 from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001'));
update requests set vendor = 'แก้ก่อนส่งต่อ' where id = 'b0b0b0b0-0000-0000-0000-000000000001';
select t_check('not handed yet: buyer edit has no effect', (select vendor = 'ผู้ขาย' from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001'));
select t_expect_error('only the preparer hands it over', $$ select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000001', true) $$);

select t_as('00000000-0000-0000-0000-000000000007');
select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000001', true);
reset role;
select t_check('handed over + buyer notified with a link to the form',
  (select handoff from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001')
  and (select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-000000000006' and link = '/requests/new?id=b0b0b0b0-0000-0000-0000-000000000001'));
set role authenticated;
select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000001', true);
reset role;
select t_check('handing over twice does not notify twice', (select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-000000000006'));
set role authenticated;

-- the buyer edits the draft and its attachments
select t_as('00000000-0000-0000-0000-000000000006');
update requests set vendor = 'ผู้ขายใหม่' where id = 'b0b0b0b0-0000-0000-0000-000000000001';
select t_check('buyer edits the handed draft', (select vendor = 'ผู้ขายใหม่' from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001'));
insert into request_files (request_id, path, name) values ('b0b0b0b0-0000-0000-0000-000000000001','b0b0b0b0-0000-0000-0000-000000000001/q.pdf','q.pdf');
select t_check('buyer adds an attachment', (select count(*) = 1 from request_files where request_id = 'b0b0b0b0-0000-0000-0000-000000000001'));
select t_expect_error('buyer cannot change the preparer', $$ update requests set preparer_id = '00000000-0000-0000-0000-000000000006' where id = 'b0b0b0b0-0000-0000-0000-000000000001' $$);
select t_expect_error('buyer cannot pass it to someone else', $$ update requests set buyer_id = '00000000-0000-0000-0000-000000000002' where id = 'b0b0b0b0-0000-0000-0000-000000000001' $$);
delete from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001';
select t_check('buyer cannot delete the draft', (select count(*) = 1 from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001'));

-- the buyer sends: becomes the preparer, the drafter is kept
select submit_request('b0b0b0b0-0000-0000-0000-000000000001')::text;
select t_check('buyer is now the preparer, drafter kept',
  (select status = 'pending' and preparer_id = '00000000-0000-0000-0000-000000000006' and handed_from = '00000000-0000-0000-0000-000000000007' and not handoff
     and preparer_signature is not distinct from (select data from signatures where user_id = '00000000-0000-0000-0000-000000000006')
   from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001'));
select t_check('log says who drafted it', (select count(*) = 1 from request_log where request_id = 'b0b0b0b0-0000-0000-0000-000000000001' and kind = 'sent' and text like '%ร่างโดย กัญญา%'));
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('drafter still sees it and was told', (select count(*) = 1 from requests where id = 'b0b0b0b0-0000-0000-0000-000000000001')
  and (select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-000000000007' and title like 'ผู้ซื้อส่งคำขอ%'));

-- changing the buyer cancels the hand-over; a buyer without the preparer role cannot receive it
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('b0b0b0b0-0000-0000-0000-000000000002','purchasing','00000000-0000-0000-0000-000000000006','main','ผู้ขาย',
  '[{"sku":"PEN-99","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11-HO.26110102');
select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000002', true);
update requests set buyer_id = '00000000-0000-0000-0000-000000000003' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
select t_check('new buyer → hand-over cancelled', (select not handoff from requests where id = 'b0b0b0b0-0000-0000-0000-000000000002'));
select t_expect_error('approver-only buyer cannot receive a draft', $$ select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000002', true) $$);
select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('old buyer cannot send it any more', $$ select submit_request('b0b0b0b0-0000-0000-0000-000000000002') $$);
select t_as('00000000-0000-0000-0000-000000000007');
update requests set buyer_id = '00000000-0000-0000-0000-000000000006' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000002', true);
select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000002', false);
reset role;
select t_check('taken back: buyer told', (select not handoff from requests where id = 'b0b0b0b0-0000-0000-0000-000000000002')
  and (select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-000000000006' and title like 'ยกเลิกการส่งต่อ%'));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000006');
update requests set vendor = 'x' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
select t_check('taken back: buyer cannot edit', (select vendor = 'ผู้ขาย' from requests where id = 'b0b0b0b0-0000-0000-0000-000000000002'));

-- the drafter may still send a handed draft themselves; the hand-over ends there
select t_as('00000000-0000-0000-0000-000000000007');
select set_draft_handoff('b0b0b0b0-0000-0000-0000-000000000002', true);
insert into request_files (request_id, path, name) values ('b0b0b0b0-0000-0000-0000-000000000002','b0b0b0b0-0000-0000-0000-000000000002/q.pdf','q.pdf');
select submit_request('b0b0b0b0-0000-0000-0000-000000000002')::text;
select t_check('drafter sends: stays preparer, hand-over ended', (select status = 'pending' and preparer_id = '00000000-0000-0000-0000-000000000007' and handed_from is null and not handoff from requests where id = 'b0b0b0b0-0000-0000-0000-000000000002'));
reset role;
update requests set status = 'draft', no = null where id = 'b0b0b0b0-0000-0000-0000-000000000002';
set role authenticated;

-- ---- maintenance ----
select t_as('00000000-0000-0000-0000-000000000007');
select t_expect_error('non-admin cannot switch maintenance', $$ do $x$ begin update app_settings set maintenance = true where id = 1; if not found then raise exception 'no row'; end if; end $x$ $$);
select t_as('00000000-0000-0000-0000-00000000000a');
update app_settings set maintenance = true, maintenance_msg = 'ปิด 12:00–12:30' where id = 1;
select t_as('00000000-0000-0000-0000-000000000007');
select t_check('everyone reads the switch', (select maintenance and maintenance_msg = 'ปิด 12:00–12:30' from app_settings));
select t_expect_error('maintenance: saving a draft refused', $$ update requests set vendor = 'y' where id = 'b0b0b0b0-0000-0000-0000-000000000002' $$);
select t_expect_error('maintenance: new draft refused', $$ insert into requests (dept, vendor) values ('purchasing', 'z') $$);
select t_expect_error('maintenance: attachment refused', $$ insert into request_files (request_id, path, name) values ('b0b0b0b0-0000-0000-0000-000000000002','b0b0b0b0-0000-0000-0000-000000000002/a.pdf','a.pdf') $$);
select t_expect_error('maintenance: sending refused', $$ select submit_request('b0b0b0b0-0000-0000-0000-000000000002') $$);
select t_check('maintenance: reading still works', (select count(*) >= 2 from requests));
select t_as('00000000-0000-0000-0000-00000000000a');
insert into requests (id, preparer_id, dept, vendor) values ('b0b0b0b0-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000007', 'purchasing', 'ผู้ดูแลทดสอบ');
select t_check('maintenance: admin still works', (select count(*) = 1 from requests where id = 'b0b0b0b0-0000-0000-0000-000000000003'));
reset role;
update requests set vendor = 'SQL Editor' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
select t_check('maintenance: SQL Editor still works', (select vendor = 'SQL Editor' from requests where id = 'b0b0b0b0-0000-0000-0000-000000000002'));
update app_settings set maintenance = false, maintenance_msg = '' where id = 1;
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
update requests set vendor = 'เปิดแล้ว' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
select t_check('maintenance off: saving works again', (select vendor = 'เปิดแล้ว' from requests where id = 'b0b0b0b0-0000-0000-0000-000000000002'));
reset role;

select 'ALL 0019 TESTS PASSED';
