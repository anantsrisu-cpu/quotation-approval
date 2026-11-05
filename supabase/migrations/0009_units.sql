-- =====================================================================
-- 0009 · หน่วยสินค้าที่ตั้งค่าได้ · Configurable units of measure
--   units : the list offered in every "หน่วย" dropdown (request items, products).
--           Admins add / rename the order / deactivate in ตั้งค่าระบบ → หน่วยสินค้า.
--   Seeded with the units the app had built in, plus every unit already used
--   in the product list, so nothing disappears.
--
-- Run once in Supabase → SQL Editor after 0008. Safe to run again, and safe
-- before the new app version is deployed.
-- =====================================================================

create table if not exists public.units (
  name   text primary key check (btrim(name) <> '' and length(name) <= 20 and name = btrim(name)),
  sort   int  not null default 0,
  active boolean not null default true
);
alter table public.units enable row level security;
drop policy if exists "units read" on public.units;
drop policy if exists "units admin write" on public.units;
create policy "units read" on public.units for select to authenticated using (true);
create policy "units admin write" on public.units for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.units to authenticated;

insert into public.units (name, sort) values
  ('เครื่อง', 10), ('ชิ้น', 20), ('ชุด', 30), ('กล่อง', 40), ('รีม', 50), ('ตัว', 60),
  ('งาน', 70), ('อัน', 80), ('แพ็ค', 90), ('ม้วน', 100), ('เมตร', 110), ('ลิตร', 120)
on conflict (name) do nothing;

-- units already used by products (e.g. กก., ถัง) join the end of the list
insert into public.units (name, sort)
select u, 1000 + row_number() over (order by u)
  from (select distinct btrim(unit) u from public.products
         where btrim(unit) <> '' and length(btrim(unit)) <= 20) x
on conflict (name) do nothing;

-- tell the Supabase API about the new table right away
notify pgrst, 'reload schema';
