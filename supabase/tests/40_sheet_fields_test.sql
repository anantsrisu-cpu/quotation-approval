-- 0005: brand, previous price source, warranty, position note. Runs after 30_discount_test.sql.
\set QUIET on
\pset format unaligned
\pset tuples_only on

select t_check('date_or_null', date_or_null('2026-03-15') = '2026-03-15'::date and date_or_null('') is null and date_or_null(null) is null);
select t_expect_error('bad date text', $$ select date_or_null('15/03/2026', 'x') $$);
select t_expect_error('impossible date', $$ select date_or_null('2026-02-31', 'x') $$);

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, warranty, items, comparisons, low_reason)
values ('88888888-8888-8888-8888-888888888888','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขายหลัก', '1 ปี',
  '[{"sku":"P-001","qty":2,"unit_price":100,"brand":"Elephant","prev_price":90,"prev_vendor":"บจก. เก่า","prev_date":"2026-03-15"},
    {"sku":"P-002","qty":1,"unit_price":50}]',
  '[{"vendor":"คู่เทียบ A","prices":[120,60],"warranty":"6 เดือน"}]', '');
insert into request_files (request_id, path, name) values ('88888888-8888-8888-8888-888888888888','88888888-8888-8888-8888-888888888888/q.pdf','q.pdf');
select submit_request('88888888-8888-8888-8888-888888888888')::text;
select t_check('brand & previous source kept', (select items->0->>'brand'='Elephant' and items->0->>'prev_vendor'='บจก. เก่า' and items->0->>'prev_date'='2026-03-15' and items->1->'prev_date'='null'::jsonb and items->1->>'brand'='' from requests where id='88888888-8888-8888-8888-888888888888'));
select t_check('warranty stored', (select warranty='1 ปี' and comparisons->0->>'warranty'='6 เดือน' from requests where id='88888888-8888-8888-8888-888888888888'));

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('99999999-9999-9999-9999-999999999999','purchasing','00000000-0000-0000-0000-000000000003','main','x',
  '[{"sku":"P-001","qty":1,"unit_price":100,"prev_date":"31/12/2026"}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('99999999-9999-9999-9999-999999999999','99999999-9999-9999-9999-999999999999/q.pdf','q.pdf');
select t_expect_error('bad previous-price date names the line', $$ select submit_request('99999999-9999-9999-9999-999999999999') $$);

select t_as('00000000-0000-0000-0000-00000000000a');
update positions set note='(มูลค่า 1 - 1,000,000 บาท)' where code='dm';
select t_check('admin sets position note', (select note<>'' from positions where code='dm'));

select 'ALL 0005 TESTS PASSED';
