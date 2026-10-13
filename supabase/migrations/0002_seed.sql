-- =====================================================================
-- Starting settings (edit them later in Admin → ตั้งค่าระบบ · Settings)
-- Safe to run more than once.
-- =====================================================================

insert into public.positions (code, th, en, sort) values
  ('dm', 'ผู้จัดการแผนก',        'Department Manager', 10),
  ('fm', 'ผู้จัดการฝ่ายการเงิน',   'Finance Manager',    20),
  ('md', 'กรรมการผู้จัดการ',       'Managing Director',  30)
on conflict (code) do nothing;

insert into public.tiers (label, max_amount, steps, sort)
select * from (values
  ('Tier 1 · ไม่เกิน 50,000',   50000::numeric,  array['dm'],            10),
  ('Tier 2 · ไม่เกิน 500,000',  500000::numeric, array['dm','fm'],       20),
  ('Tier 3 · เกิน 500,000',     null::numeric,   array['dm','fm','md'],  30)
) v(label, max_amount, steps, sort)
where not exists (select 1 from public.tiers);

insert into public.departments (id, th, en, sort) values
  ('facilities', 'ฝ่ายอาคารและสถานที่',         'Facilities',      10),
  ('purchasing', 'ฝ่ายจัดซื้อ',                 'Purchasing',      20),
  ('finance',    'ฝ่ายการเงิน',                 'Finance',         30),
  ('it',         'ฝ่ายเทคโนโลยีสารสนเทศ',        'IT',              40),
  ('accounting', 'ฝ่ายบัญชี',                   'Accounting',      50),
  ('hr',         'ฝ่ายทรัพยากรบุคคล',            'Human Resources', 60)
on conflict (id) do nothing;

-- Replace with your real company name, address and logo in Admin → Settings
insert into public.companies (id, th, en, initials, address, sort) values
  ('main', 'บริษัท ของคุณ จำกัด', 'YOUR COMPANY CO., LTD.', 'YC', 'ที่อยู่บริษัท', 10)
on conflict (id) do nothing;
