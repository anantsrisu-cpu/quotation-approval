-- 0020: the buyer a draft was handed to may delete it (and its attachments). Runs after 99; applies 0020 itself.
\set QUIET on
\pset format unaligned
\pset tuples_only on
reset role;
\i supabase/migrations/0020_buyer_delete_draft.sql
\i supabase/migrations/0020_buyer_delete_draft.sql
delete from notifications;

-- กัญญา (07) drafts for buyer Eve (06)
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, product_name, report_no)
values ('b1b1b1b1-0000-0000-0000-000000000001','purchasing','00000000-0000-0000-0000-000000000006','main','ผู้ขาย','จารบี','R11-HO.26110201');
insert into request_files (request_id, path, name) values ('b1b1b1b1-0000-0000-0000-000000000001','b1b1b1b1-0000-0000-0000-000000000001/q.pdf','q.pdf');
insert into storage.objects (bucket_id, name) values ('attachments','b1b1b1b1-0000-0000-0000-000000000001/q.pdf'), ('attachments','b1b1b1b1-0000-0000-0000-000000000001/r.pdf');

-- not handed yet: the buyer cannot delete
select t_as('00000000-0000-0000-0000-000000000006');
select t_expect_error('not handed: buyer cannot delete', $$ select delete_request('b1b1b1b1-0000-0000-0000-000000000001') $$);
delete from storage.objects where name = 'b1b1b1b1-0000-0000-0000-000000000001/r.pdf';
reset role;
select t_check('not handed: buyer cannot remove a file', (select count(*) = 2 from storage.objects where name like 'b1b1b1b1%'));
set role authenticated;

select t_as('00000000-0000-0000-0000-000000000007');
select set_draft_handoff('b1b1b1b1-0000-0000-0000-000000000001', true);

-- an approver who is not the buyer still cannot
select t_as('00000000-0000-0000-0000-000000000003');
select t_expect_error('someone else cannot delete', $$ select delete_request('b1b1b1b1-0000-0000-0000-000000000001') $$);

-- the buyer removes a file, then deletes the draft
select t_as('00000000-0000-0000-0000-000000000006');
delete from storage.objects where name = 'b1b1b1b1-0000-0000-0000-000000000001/r.pdf';
reset role;
select t_check('handed: buyer removes an attachment', (select count(*) = 1 from storage.objects where name like 'b1b1b1b1%'));
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000006');
delete from storage.objects where name = 'b1b1b1b1-0000-0000-0000-000000000001/q.pdf';
select t_check('buyer deletes the handed draft', delete_request('b1b1b1b1-0000-0000-0000-000000000001') = 'ฉบับร่าง');
reset role;
select t_check('draft, files and storage gone', (select count(*) = 0 from requests where id = 'b1b1b1b1-0000-0000-0000-000000000001')
  and (select count(*) = 0 from request_files where request_id = 'b1b1b1b1-0000-0000-0000-000000000001')
  and (select count(*) = 0 from storage.objects where name like 'b1b1b1b1%'));
select t_check('drafter told who deleted it', (select count(*) = 1 from notifications
  where user_id = '00000000-0000-0000-0000-000000000007' and request_id is null and title like 'ผู้ซื้อลบร่าง%' and body like '%จารบี (R11-HO.26110201)%'));

-- ---- PDF only ----
reset role;
insert into products (company_id, sku, name, unit) values ('main', 'PDF-1', 'กระดาษ', 'รีม') on conflict do nothing;
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason, report_no)
values ('b1b1b1b1-0000-0000-0000-000000000003','purchasing','00000000-0000-0000-0000-000000000006','main','ผู้ขาย',
  '[{"sku":"PDF-1","qty":1,"unit_price":100}]', true, 'รายเดียว', 'R11-HO.26110202');
select t_expect_error('Excel attachment refused', $$ insert into request_files (request_id, path, name) values ('b1b1b1b1-0000-0000-0000-000000000003','b1b1b1b1-0000-0000-0000-000000000003/q.xlsx','ใบเสนอราคา.xlsx') $$);
select t_expect_error('image attachment refused in storage', $$ insert into storage.objects (bucket_id, name) values ('attachments','b1b1b1b1-0000-0000-0000-000000000003/q.jpg') $$);
insert into storage.objects (bucket_id, name) values ('attachments','b1b1b1b1-0000-0000-0000-000000000003/q.PDF');
insert into request_files (request_id, path, name) values ('b1b1b1b1-0000-0000-0000-000000000003','b1b1b1b1-0000-0000-0000-000000000003/q.PDF','ใบเสนอราคา.PDF');
select t_check('PDF accepted (any letter case)', (select count(*) = 1 from request_files where request_id = 'b1b1b1b1-0000-0000-0000-000000000003'));
-- an older non-PDF file (attached before 0020) blocks sending
reset role;
alter table request_files disable trigger request_files_pdf_only;
insert into request_files (request_id, path, name) values ('b1b1b1b1-0000-0000-0000-000000000003','b1b1b1b1-0000-0000-0000-000000000003/old.docx','เก่า.docx');
alter table request_files enable trigger request_files_pdf_only;
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
select t_expect_error('draft with a non-PDF file is not sent', $$ select submit_request('b1b1b1b1-0000-0000-0000-000000000003') $$);
delete from request_files where name = 'เก่า.docx';
select submit_request('b1b1b1b1-0000-0000-0000-000000000003')::text;
select t_check('sent once only PDFs are attached', (select status = 'pending' from requests where id = 'b1b1b1b1-0000-0000-0000-000000000003'));

-- the preparer still deletes their own drafts as before
set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, vendor) values ('b1b1b1b1-0000-0000-0000-000000000002','purchasing','x');
select t_check('preparer deletes own draft', delete_request('b1b1b1b1-0000-0000-0000-000000000002') = 'ฉบับร่าง');
reset role;

select 'ALL 0020 TESTS PASSED';
