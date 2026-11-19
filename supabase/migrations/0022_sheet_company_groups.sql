-- =====================================================================
-- 0022 · กลุ่มบริษัทบนหัวตารางเปรียบเทียบ · Company groups on the sheet header
--   companies.sheet_group: companies with the same group name share one sheet
--   header (a tick box for each, the buyer company ticked). A company with no
--   group has a header of its own.
--   On the first run every existing company is put in one group, so the sheets
--   look the same as before until an admin changes the groups
--   (ตั้งค่าระบบ → บริษัทผู้ซื้อและหัวจดหมาย).
--
-- Run once in Supabase → SQL Editor after 0021. Safe to run again.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'companies' and column_name = 'sheet_group') then
    alter table public.companies add column sheet_group text not null default '';
    update public.companies set sheet_group = 'กลุ่มหลัก';
  end if;
end $$;

alter table public.companies drop constraint if exists companies_sheet_group_len;
alter table public.companies add constraint companies_sheet_group_len check (char_length(sheet_group) <= 60);

notify pgrst, 'reload schema';
