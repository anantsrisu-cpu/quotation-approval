-- 0004: discounts, credit term and lead time. Runs after 20_items_proxy_test.sql.
\set QUIET on
\pset format unaligned
\pset tuples_only on

select t_check('5% of 29,050 = 27,597.50', apply_discount(29050, '5%') = 27597.50);
select t_check('100 baht per unit', apply_discount(1000, '100') = 900);
select t_check('stacked 10%+5% = 855', apply_discount(1000, '10%+5%') = 855);
select t_check('mixed 10%+50 and spaces/commas', apply_discount(1000, ' 10 % + 50 ') = 850 and apply_discount(10000, '1,000') = 9000);
select t_check('blank = no discount', apply_discount(123.456, '') = 123.46 and apply_discount(5, null) = 5);
select t_expect_error('bad format', $$ select apply_discount(100, '5%x', 'รายการที่ 1') $$);
select t_expect_error('over 100%', $$ select apply_discount(100, '120%') $$);
select t_expect_error('net must stay above zero', $$ select apply_discount(100, '100') $$);

set role authenticated;
select t_as('00000000-0000-0000-0000-000000000007');
insert into requests (id, dept, buyer_id, company_id, vendor, credit_days, lead_days, items, comparisons, low_reason)
values ('66666666-6666-6666-6666-666666666666','purchasing','00000000-0000-0000-0000-000000000003','main','ผู้ขายหลัก', 30, 7,
  '[{"sku":"P-001","qty":10,"unit_price":1000,"discount":"5%","prev_price":900},
    {"sku":"P-002","qty":2,"unit_price":500,"discount":"50"},
    {"sku":"P-003","qty":1,"unit_price":2000}]',
  '[{"vendor":"คู่เทียบ A","prices":[980,520,2100],"discounts":["2%","","10%+5%"],"credit_days":"45","lead_days":"14"},
    {"vendor":"คู่เทียบ B","prices":[1000,500,2000],"credit_days":"","lead_days":"3"}]', '');
insert into request_files (request_id, path, name) values ('66666666-6666-6666-6666-666666666666','66666666-6666-6666-6666-666666666666/q.pdf','q.pdf');

-- selected: 950*10 + 450*2 + 2000 = 12,400 ; A: 960.40*10 + 520*2 + 1795.50*1 = 12,439.50 ; B: 13,000
select submit_request('66666666-6666-6666-6666-666666666666')::text;
select t_check('net prices & subtotal after discount', (select subtotal=12400 and (items->0->>'net_price')::numeric=950 and (items->1->>'net_price')::numeric=450 and items->0->>'discount'='5%' and (items->2->>'line_total')::numeric=2000 from requests where id='66666666-6666-6666-6666-666666666666'));
select t_check('previous price % uses the net price (950 vs 900 = +5.56%)', (select (items->0->>'prev_diff_pct')::numeric=5.56 from requests where id='66666666-6666-6666-6666-666666666666'));
select t_check('comparison A with discounts = 12,439.50', (select (comparisons->0->>'subtotal')::numeric=12439.50 and (comparisons->0->'nets'->>2)::numeric=1795.50 and comparisons->0->'discounts'->>0='2%' from requests where id='66666666-6666-6666-6666-666666666666'));
select t_check('credit & lead time stored', (select credit_days=30 and lead_days=7 and (comparisons->0->>'credit_days')::int=45 and comparisons->1->'credit_days'='null'::jsonb and (comparisons->1->>'lead_days')::int=3 from requests where id='66666666-6666-6666-6666-666666666666'));

insert into requests (id, dept, buyer_id, company_id, vendor, items, no_comp, no_comp_reason)
values ('77777777-7777-7777-7777-777777777777','purchasing','00000000-0000-0000-0000-000000000003','main','x',
  '[{"sku":"P-001","qty":1,"unit_price":100,"discount":"abc"}]', true, 'รายเดียว');
insert into request_files (request_id, path, name) values ('77777777-7777-7777-7777-777777777777','77777777-7777-7777-7777-777777777777/q.pdf','q.pdf');
select t_expect_error('invalid discount names the line', $$ select submit_request('77777777-7777-7777-7777-777777777777') $$);
update requests set items='[{"sku":"P-001","qty":1,"unit_price":100}]', comparisons='[]' where id='77777777-7777-7777-7777-777777777777';
select t_expect_error('credit out of range blocked by column check', $$ update requests set credit_days=-1 where id='77777777-7777-7777-7777-777777777777' $$);

select 'ALL 0004 TESTS PASSED';
