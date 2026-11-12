# ระบบอนุมัติใบเสนอราคา · Quotation Approval

ระบบขออนุมัติใบเสนอราคาตามวงเงิน ผู้จัดทำกรอกข้อมูลและแนบใบเสนอราคา ระบบเลือกผู้อนุมัติตามระดับวงเงินให้อัตโนมัติ เมื่ออนุมัติครบ ระบบสร้าง **หนังสืออนุมัติใบเสนอราคา** พร้อมลายเซ็นผู้อนุมัติทุกคนเป็นไฟล์ PDF แล้วปิดงาน

A quotation approval workflow. A preparer enters the request and attaches the quotation. Approvers are picked automatically by price tier, and each one signs in turn. After the final approval, a signed cover letter is saved as a PDF and the request is closed.

| ส่วน · Part | ใช้ · Built with |
| --- | --- |
| เว็บแอป · Web app | Next.js 15 (React 19, TypeScript) — host on **Vercel** |
| ฐานข้อมูล ไฟล์ ล็อกอิน · Database, files, sign-in | **Supabase** (PostgreSQL, Storage, Auth) |
| เข้าสู่ระบบ · Sign-in | **Microsoft 365** (Microsoft Entra ID) |
| PDF | html2canvas + jsPDF (keeps Thai fonts and signatures) |

---

## สารบัญ · Contents
1. [สิ่งที่ระบบทำได้ · Features](#1-สิ่งที่ระบบทำได้--features)
2. [ติดตั้งครั้งแรก · First-time setup](#2-ติดตั้งครั้งแรก--first-time-setup) (ประมาณ 45 นาที · about 45 minutes)
3. [เริ่มใช้งาน · Getting started in the app](#3-เริ่มใช้งาน--getting-started-in-the-app)
4. [อัปเดตและดูแลระบบ · Updating & monitoring](#4-อัปเดตและดูแลระบบ--updating--monitoring)
5. [สำหรับนักพัฒนา · For developers](#5-สำหรับนักพัฒนา--for-developers)

---

## 1. สิ่งที่ระบบทำได้ · Features

**ผู้จัดทำ · Preparer**
- สร้างคำขอ: เรื่อง (สั่งซื้อเพื่อสต๊อค / สั่งซื้อทั่วไป / สั่งจ้าง), SKU (ชื่อสินค้าขึ้นอัตโนมัติ), ฝ่ายที่ขอซื้อ, ซื้อเพื่อ (ซ่อมแซม / ทดแทนของเดิม / Stock), ผู้ขาย, ผู้ซื้อ, บริษัทผู้ซื้อ
- ราคาต่อหน่วยก่อน VAT × จำนวน = มูลค่ารวม + VAT = ยอดสุทธิ (คำนวณสด และคำนวณซ้ำที่เซิร์ฟเวอร์)
- เห็นรายชื่อผู้อนุมัติตามวงเงินทันทีที่กรอกจำนวนเงิน
- คู่เทียบราคา: ปุ่ม + / − เพิ่มลดผู้ขาย, กรอกราคาต่อหน่วย ระบบคำนวณยอดและส่วนต่าง; หรือเลือก “ไม่มีคู่เทียบ” แล้วบังคับใส่เหตุผล
- แนบไฟล์ใบเสนอราคาจริง (PDF, รูป, Excel, Word ไม่เกิน 25 MB ต่อไฟล์)
- ดูตัวอย่างร่างหนังสือก่อนส่ง, บันทึกร่าง, แก้ไขและส่งใหม่เมื่อถูกตีกลับ, คัดลอกเป็นคำขอใหม่, ยกเลิกคำขอ

**ผู้อนุมัติ · Approver**
- กล่อง “รอฉันอนุมัติ” เห็นเฉพาะคำขอที่ถึงขั้นของตัวเอง
- ตรวจรายละเอียด เปิดไฟล์แนบ ลงนามด้วยลายเซ็นที่บันทึกไว้ (หรือวาดครั้งแรก) อนุมัติ / ไม่อนุมัติ (ต้องใส่เหตุผล)
- ผู้อนุมัติลำดับสุดท้ายส่งให้ผู้อนุมัติคนอื่นอนุมัติแทนได้ (เลือกได้เฉพาะคนที่มีลายเซ็น)

**ทุกคน · Everyone**
- กระดิ่งแจ้งเตือนแบบ pop-up (อัปเดตทันที) และหน้า “การแจ้งเตือนทั้งหมด”
- หน้า “ประวัติและค้นหา” ค้นตามเลขที่ สินค้า SKU ผู้ขาย สถานะ และช่วงวันที่
- หนังสืออนุมัติ PDF ดาวน์โหลดได้ หัวจดหมาย (ชื่อและโลโก้) เปลี่ยนตามบริษัทผู้ซื้อ · คำขอที่อนุมัติแล้วมีปุ่ม **🖨 PDF** ในรายการ (คำขอของฉัน · ประวัติ · ตัดสินใจล่าสุด) กดดาวน์โหลดไปปริ้นได้ทันที
- รายการสินค้าหลายรายการ: กด **⬇ ฟอร์ม Excel** ไปกรอก แล้วลากไฟล์มาวางที่ส่วน “รายการสินค้า” (หรือเลือกไฟล์ในหน้าต่าง “วางหลายรายการจาก Excel”)
- ตำแหน่ง “ลายเซ็นสด” ใส่ **ชื่อผู้ลงนาม** ได้ในตั้งค่าระบบ → พิมพ์ชื่อใต้กรอบลายเซ็นในตารางเปรียบเทียบ
- รายการสินค้า SKU **แยกตามบริษัท**: เลือกบริษัทเพื่อดู (ผู้จัดทำ/ผู้อนุมัติดูได้) · ผู้ดูแลติ๊กบริษัทก่อนนำเข้า Excel หรือใส่คอลัมน์ “บริษัท” รายแถว (ติ๊กหลายบริษัท = SKU ใช้ร่วมกัน) · รหัสเดียวกันเป็นคนละสินค้าในแต่ละบริษัทได้ — ตารางแสดง “ใช้ร่วมกับ …” หรือ “รหัสซ้ำกับ … (คนละสินค้า)” · หน้าสร้างคำขอค้นหา SKU ในรายการของบริษัทผู้ซื้อ
- ผู้ดูแลกด **🗑 ลบ SKU ทั้งหมด** ในรายการสินค้า SKU เลือกได้ว่าลบของบริษัทไหน (มีปุ่มดาวน์โหลดสำรองก่อนลบ) แล้วอัปโหลดไฟล์ใหม่
- การแจ้งเตือน: ปุ่ม **🗑 ลบทั้งหมด** ใน pop-up กระดิ่งและหน้า “การแจ้งเตือนทั้งหมด” (ลบเฉพาะของตัวเอง ไม่กระทบคำขอ)
- **อีเมลแจ้งเตือน** (ต้องตั้งค่าตามข้อ 2.7): ทุกการแจ้งเตือนส่งเข้าอีเมลเข้าสู่ระบบของผู้ใช้ผ่าน Microsoft 365 · แต่ละบัญชีปิดได้และเพิ่มอีเมลอีก 1 ที่อยู่ (ต้องเป็นโดเมนเดียวกับอีเมลเข้าสู่ระบบ) ที่หน้า “บัญชีและลายเซ็นของฉัน” หรือผู้ดูแลตั้งให้ในหน้า “บัญชีผู้ใช้และลายเซ็น”
- ตั้งค่าระบบ → ฝ่าย: ปุ่ม **ลบ** สำหรับฝ่ายที่ไม่มีคำขอและไม่มีผู้ใช้สังกัด
- รอฉันอนุมัติ: ติ๊กเลือกบริษัทที่ส่งคำขอ · “ตัดสินใจล่าสุด” มีคอลัมน์บริษัท (ตัวย่อ)

**ผู้ดูแลระบบ · Admin**
- ตรวจคำขอเปิดบัญชี (ผู้ใช้ล็อกอินด้วย Microsoft 365 → กรอกใบสมัคร → ผู้ดูแลอนุมัติ → ใช้งานได้)
- จัดการบัญชี บทบาท ตำแหน่งอนุมัติ และลายเซ็นของผู้อนุมัติและผู้จัดทำ
- ตั้งค่าวงเงินและลำดับผู้อนุมัติ ตำแหน่ง ฝ่าย บริษัทผู้ซื้อและโลโก้ VAT ผู้รับหนังสือ รหัสนำหน้าเลขที่
- นำเข้ารายการสินค้า SKU จาก Excel/CSV (ตรวจก่อนนำเข้า) และดาวน์โหลดไฟล์ต้นแบบ
- ควบคุมคำขอทุกใบ: เตือน, เปลี่ยนผู้อนุมัติ, ยกเลิก
- สถานะปัญหา (bug status): ข้อผิดพลาดที่ผู้ใช้เจอถูกบันทึกอัตโนมัติ พร้อมหน้าและการกระทำ
- ดูมุมมองผู้ใช้ (view as user): เห็นสิ่งที่ผู้ใช้คนนั้นเห็น และสิ่งที่อาจทำให้เขาใช้งานติดขัด

**ติดตั้งเป็นแอปบนมือถือ · Install on phones (PWA)**
- Android (Chrome): เปิดลิงก์แอป → จะมีปุ่ม **ติดตั้งแอปบนหน้าจอหลัก** ในแบนเนอร์ หรือเมนู ⋮ → **ติดตั้งแอป / Add to Home screen**
- iPhone/iPad (Safari): ปุ่ม **แชร์** → **เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)** → **เพิ่ม**
- วิธีติดตั้งแสดงในแอปที่ “บัญชีและลายเซ็นของฉัน” และแบนเนอร์บนมือถือ (กด “ไม่ใช่ตอนนี้” เพื่อซ่อน)
- ไฟล์ที่เกี่ยวข้อง: `app/manifest.ts`, `public/sw.js` (ไม่เก็บแคช จึงเห็นข้อมูลล่าสุดเสมอ), `public/icon-*.png`, `public/apple-touch-icon.png`, `components/Pwa.tsx`

**ความปลอดภัย · Security** — ทุกการเปลี่ยนสถานะคำขอทำผ่านฟังก์ชันในฐานข้อมูล ยอดเงิน ผู้อนุมัติ และลายเซ็นจึงแก้จากเบราว์เซอร์ไม่ได้; ผู้ใช้เห็นเฉพาะคำขอที่ตนเกี่ยวข้อง (Row Level Security)
Every state change goes through database functions, so amounts, approvers and signatures can't be altered from the browser. Row Level Security limits each person to the requests they're involved in.

---

## 2. ติดตั้งครั้งแรก · First-time setup

คุณต้องมี · You need: บัญชี GitHub (มี repo นี้แล้ว), บัญชี [Supabase](https://supabase.com), บัญชี [Vercel](https://vercel.com) (สมัครด้วย GitHub ได้), และสิทธิ์ผู้ดูแลใน Microsoft Entra ของบริษัท (หรือให้ฝ่าย IT ทำข้อ 2.2)

### 2.1 สร้างฐานข้อมูล Supabase · Create the Supabase project
1. ที่ [supabase.com/dashboard](https://supabase.com/dashboard) กด **New project** ตั้งชื่อ เช่น `quotation-approval` เลือก Region **Southeast Asia (Singapore)** และตั้งรหัสผ่านฐานข้อมูล (เก็บไว้)
2. เมื่อสร้างเสร็จ ไปที่ **SQL Editor → New query** แล้ววางเนื้อหาไฟล์ [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) ทั้งไฟล์ กด **Run**
3. New query อีกครั้ง วาง [`supabase/migrations/0002_seed.sql`](supabase/migrations/0002_seed.sql) กด **Run** (ค่าเริ่มต้น: ตำแหน่ง วงเงิน 3 ระดับ ฝ่าย และบริษัทตัวอย่าง — แก้ได้ในแอป)
   ต่อด้วย [`supabase/migrations/0003_items_proxy_invites.sql`](supabase/migrations/0003_items_proxy_invites.sql) กด **Run** (หลายรายการต่อคำขอ ราคาก่อนหน้า สร้างบัญชีล่วงหน้า และผู้ดูแลร่างคำขอแทน)
   ต่อด้วย [`supabase/migrations/0004_discount_credit_leadtime.sql`](supabase/migrations/0004_discount_credit_leadtime.sql) กด **Run** (ส่วนลดต่อรายการ เครดิต และ Lead time ของผู้ขายแต่ละราย)
   ต่อด้วย [`supabase/migrations/0005_compare_sheet_fields.sql`](supabase/migrations/0005_compare_sheet_fields.sql) กด **Run** (ตารางเปรียบเทียบแนวนอน: Brand, ราคาประวัติเก่า, Warranty, ช่วงวงเงินของตำแหน่งผู้อนุมัติ)
   ต่อด้วย [`supabase/migrations/0006_wet_signature.sql`](supabase/migrations/0006_wet_signature.sql) กด **Run** (PDF เป็นตารางเปรียบเทียบอย่างเดียว · กรอบผู้อนุมัติครบทุกตำแหน่ง ขีดฆ่าเมื่อวงเงินไม่ถึง · ตำแหน่งลายเซ็นสด · ชื่อ 2 บริษัทในเครือ)
   ต่อด้วย [`supabase/migrations/0007_report_no.sql`](supabase/migrations/0007_report_no.sql) กด **Run** (รายงานเลขที่/วันที่อนุมัติที่กรอกเองในคำขอ และรายงานเลขที่ของแต่ละรายการ)
   ต่อด้วย [`supabase/migrations/0008_award_delivery.sql`](supabase/migrations/0008_award_delivery.sql) กด **Run** (ติ๊ก ✓ ผู้ขายต่อรายการ — ตั้งต้นที่ราคาต่ำสุด เลือกเจ้าอื่นต้องมีเหตุผล แยกซื้อได้ ยอดอนุมัติ = รายการที่ติ๊ก — และสถานที่จัดส่ง 2 ช่องต่อผู้ขาย พร้อมตาราง delivery_places ที่ตั้งค่าได้)
   ต่อด้วย [`supabase/migrations/0009_units.sql`](supabase/migrations/0009_units.sql) กด **Run** (หน่วยสินค้าที่ผู้ดูแลเพิ่ม/ปิดได้ที่ ตั้งค่าระบบ → หน่วยสินค้า)
   ต่อด้วย [`supabase/migrations/0010_split_delete_company_reset.sql`](supabase/migrations/0010_split_delete_company_reset.sql) กด **Run** (แบ่งซื้อต่อรายการ · ผู้จัดทำลบคำขอที่ยังไม่อนุมัติ · ผู้อนุมัติตามบริษัท · ผู้ดูแลล้างคำขอทั้งหมดก่อน Go-Live) — **รันก่อนเปิดเว็บเวอร์ชันนี้**
   ต่อด้วย [`supabase/migrations/0011_multi_vendor.sql`](supabase/migrations/0011_multi_vendor.sql) กด **Run** (ซื้อหลายเจ้า แยกราย SKU — แต่ละเจ้าเสนอราคาไม่ครบทุกรายการได้ · ชื่อผู้ขายที่ซื้อจริงในรายการคำขอ) — **รันก่อนเปิดเว็บเวอร์ชันนี้**
   ต่อด้วย [`supabase/migrations/0012_report_no_required.sql`](supabase/migrations/0012_report_no_required.sql) กด **Run** (รายงานเลขที่บังคับกรอก และใช้เป็นเลขที่คำขอ ห้ามซ้ำ)
   ต่อด้วย [`supabase/migrations/0013_report_no_duplicates.sql`](supabase/migrations/0013_report_no_duplicates.sql) กด **Run** (รายงานเลขที่ใช้ซ้ำกับคำขออื่นได้)
   ต่อด้วย [`supabase/migrations/0014_recall_request.sql`](supabase/migrations/0014_recall_request.sql) กด **Run** (ผู้จัดทำดึงคำขอที่กำลังรออนุมัติกลับมาแก้ไขได้)
   ต่อด้วย [`supabase/migrations/0015_pr_number.sql`](supabase/migrations/0015_pr_number.sql) กด **Run** (เลขที่ใบขอซื้อ รูปแบบ R1x-yy.xxxxxxxx · แก้คำขอที่ส่งแล้วได้เฉพาะหลังถูก Reject — ยกเลิกการดึงกลับของ 0014)
   ต่อด้วย [`supabase/migrations/0016_wet_name_clear_products.sql`](supabase/migrations/0016_wet_name_clear_products.sql) กด **Run** (ชื่อผู้ลงนามของตำแหน่งลายเซ็นสด · ผู้ดูแลลบ SKU ทั้งหมดในคลิกเดียวก่อนอัปโหลดใหม่)
   ต่อด้วย [`supabase/migrations/0017_company_products_clear_notifs.sql`](supabase/migrations/0017_company_products_clear_notifs.sql) กด **Run** (รายการสินค้า SKU แยกตามบริษัท — SKU เดิมถูกคัดลอกให้ทุกบริษัท · ผู้ใช้ลบการแจ้งเตือนทั้งหมดของตัวเองได้)
   ต่อด้วย [`supabase/migrations/0018_email_notify_delete_dept.sql`](supabase/migrations/0018_email_notify_delete_dept.sql) กด **Run** (แจ้งเตือนทางอีเมล: การตั้งค่ารายบัญชี + คิวอีเมล · ลบฝ่ายที่ไม่มีการใช้งาน)
   > ระบบที่ใช้งานอยู่แล้ว: รันเฉพาะไฟล์ที่ยังไม่เคยรัน ตามลำดับเลข ข้อมูลเดิมถูกแปลงให้อัตโนมัติ และรันซ้ำได้โดยไม่เสียหาย
4. ไปที่ **Project Settings → API** (หรือ **Data API / API Keys**) จดค่า:
   - **Project URL** → ใช้เป็น `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key (หรือ **publishable** key) → ใช้เป็น `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - ⚠️ ห้ามใช้ `service_role` / secret key ในแอปนี้ · Never use the service_role/secret key here.

### 2.2 ลงทะเบียนแอปใน Microsoft Entra · Register the app in Microsoft Entra (IT admin)
1. เปิด [entra.microsoft.com](https://entra.microsoft.com) (หรือ portal.azure.com) → **Identity → Applications → App registrations → New registration**
2. Name: `Quotation Approval` · Supported account types: **Accounts in this organizational directory only (Single tenant)**
3. Redirect URI: เลือก **Web** แล้วใส่ `https://<project-ref>.supabase.co/auth/v1/callback` (ใช้ Project URL จากข้อ 2.1 ต่อท้ายด้วย `/auth/v1/callback`) → **Register**
4. จากหน้า Overview จด **Application (client) ID** และ **Directory (tenant) ID**
5. **Certificates & secrets → Client secrets → New client secret** เลือกอายุ (เช่น 24 เดือน) แล้วจด **Value** (ไม่ใช่ Secret ID) · ตั้งเตือนในปฏิทินให้ต่ออายุก่อนหมด
6. (แนะนำ) **Manifest** → ใน `optionalClaims` เพิ่ม `xms_edov` และ `email` ใน `idToken` และ `xms_edov` ใน `accessToken` แล้ว Save — ช่วยให้ Supabase ยืนยันว่าอีเมลจาก Microsoft ผ่านการยืนยันแล้ว (Supabase recommends this, especially for single-tenant apps)

### 2.3 เปิด Microsoft sign-in ใน Supabase · Turn on Microsoft sign-in
1. Supabase → **Authentication → Sign In / Providers → Azure** → เปิด **Enable**
2. **Client ID** = Application (client) ID · **Secret** = ค่า Value ของ client secret
3. **Azure Tenant URL** = `https://login.microsoftonline.com/<Directory (tenant) ID>` — จำกัดให้เฉพาะบัญชีบริษัทคุณ · limits sign-in to your company
4. Save

### 2.4 นำขึ้นออนไลน์ด้วย Vercel · Deploy on Vercel
1. [vercel.com/new](https://vercel.com/new) → Import Git Repository → เลือก repo `quotation-approval`
2. Framework จะเป็น **Next.js** อัตโนมัติ · ที่ **Environment Variables** ใส่:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon / publishable key
3. กด **Deploy** รอ 1–2 นาที จะได้ลิงก์ เช่น `https://quotation-approval.vercel.app` (ตั้งโดเมนบริษัทได้ที่ Settings → Domains)

### 2.5 บอก Supabase ว่าแอปอยู่ที่ไหน · Tell Supabase where the app lives
Supabase → **Authentication → URL Configuration**
- **Site URL** = ลิงก์ Vercel ของคุณ เช่น `https://quotation-approval.vercel.app`
- **Redirect URLs** เพิ่ม `https://quotation-approval.vercel.app/auth/callback` (และ `http://localhost:3000/auth/callback` ถ้าจะทดสอบบนเครื่อง)

### 2.6 เข้าสู่ระบบคนแรก = ผู้ดูแลระบบ · First sign-in becomes the admin
> ⚠️ **คุณต้องเป็นคนแรกที่เข้าสู่ระบบ** ระบบจะตั้งบัญชีแรกเป็นผู้ดูแลระบบอัตโนมัติ (Admin + Preparer) ทุกคนหลังจากนั้นต้องสมัครและรอผู้ดูแลอนุมัติ
> **Sign in first yourself.** The very first account becomes the admin; everyone after that applies and waits for approval.

ถ้าพลาดและคนอื่นเข้าก่อน แก้ได้ใน SQL Editor · If someone else got there first, fix it in the SQL Editor:
```sql
update public.profiles set roles = '{admin,preparer}', status = 'active' where email = 'you@yourcompany.com';
```

---

### 2.7 อีเมลแจ้งเตือนผ่าน Microsoft 365 (ไม่บังคับ) · Notification e-mails (IT admin)

ระบบเก็บอีเมลที่ต้องส่งไว้ในตาราง `email_outbox` (SQL 0018) แล้ว Edge Function `send-emails` ส่งออกทางกล่องจดหมายของบริษัทด้วย Microsoft Graph รหัสลับทั้งหมดอยู่ใน Supabase ไม่อยู่ในแอปหรือ repo

1. **กล่องจดหมายผู้ส่ง** — เตรียมกล่องจดหมาย เช่น `noreply@บริษัท` (shared mailbox ก็ได้)
2. **Microsoft Entra** → App registrations → สร้างแอปใหม่ เช่น `Quotation Approval Mailer` (แยกจากแอปล็อกอิน) →
   - **API permissions → Add → Microsoft Graph → Application permissions → `Mail.Send`** → **Grant admin consent**
   - **Certificates & secrets → New client secret** จดค่าและวันหมดอายุ
   - แนะนำ: จำกัดให้แอปส่งได้เฉพาะกล่องจดหมายผู้ส่ง (Exchange Online *RBAC for Applications* หรือ *Application Access Policy*) เพราะ `Mail.Send` แบบ Application ส่งแทนได้ทุกกล่องจดหมายถ้าไม่จำกัด
3. **Supabase → Edge Functions → Deploy a new function** ชื่อ `send-emails` วางโค้ดจาก [`supabase/functions/send-emails/index.ts`](supabase/functions/send-emails/index.ts) (หรือ `supabase functions deploy send-emails`)
4. **Supabase → Edge Functions → Secrets** เพิ่ม: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_SENDER` (อีเมลกล่องผู้ส่ง), `APP_URL` (ลิงก์แอป เช่น `https://your-app.vercel.app`)
5. **Supabase → Database → Webhooks → Create** : ตาราง `email_outbox` · Events **Insert** · Type **Supabase Edge Functions** → `send-emails` (เพื่อให้ส่งทันทีที่มีการแจ้งเตือนใหม่)
6. ในแอป: **ตั้งค่าระบบ → อีเมลแจ้งเตือน** กด **ส่งอีเมลทดสอบถึงฉัน** — ถ้าตั้งค่าไม่ครบ หน้าจอจะบอกว่าขาดอะไร (เช่น Secret ที่ยังไม่ได้ใส่ หรือข้อความผิดพลาดจาก Microsoft) เมื่อได้รับอีเมลแล้วจึงติ๊ก **เปิดการส่งอีเมลแจ้งเตือนทั้งระบบ**

อีเมลที่ส่งไม่สำเร็จ 3 ครั้งจะขึ้นในตาราง “ส่งไม่สำเร็จ” พร้อมสาเหตุ กด **ลองส่งที่ค้างอีกครั้ง** ได้หลังแก้ไข · อีเมลที่ส่งแล้วเกิน 30 วันถูกลบออกจากคิวเอง

## 3. เริ่มใช้งาน · Getting started in the app

ทำตามลำดับนี้ในเมนู **ผู้ดูแลระบบ** · As admin, in this order:
1. **ตั้งค่าระบบ** — ใส่ชื่อบริษัท ที่อยู่ และอัปโหลดโลโก้ (หัวจดหมาย), ตรวจตำแหน่งผู้อนุมัติ และ **ระดับวงเงิน** ว่าแต่ละช่วงต้องผ่านใครบ้าง, ฝ่ายต่าง ๆ, VAT และผู้รับหนังสือ (เรียน …)
2. **รายการสินค้า SKU** — กด “ดาวน์โหลดไฟล์ต้นแบบ” กรอก SKU / ชื่อสินค้า / หมวด / หน่วย แล้วนำเข้า (สูงสุด 20,000 แถวต่อไฟล์ นำเข้าซ้ำได้ ระบบอัปเดตรายการเดิม)
3. ส่งลิงก์แอปให้พนักงาน ให้แต่ละคน **เข้าสู่ระบบด้วย Microsoft 365 และกรอกใบสมัคร**
4. **คำขอเปิดบัญชี** — อนุมัติทีละคน กำหนดบทบาท และสำหรับผู้อนุมัติต้องเลือก **ตำแหน่งอนุมัติ** และ **ฝ่าย** (ผู้จัดการแผนกจะถูกเลือกตามฝ่ายที่ขอซื้อ)
5. **บัญชีและลายเซ็น** — เพิ่มลายเซ็นให้ผู้อนุมัติ (วาด หรืออัปโหลดรูปลายเซ็น) หรือให้แต่ละคนเพิ่มเองที่ “บัญชีและลายเซ็นของฉัน”
6. ทดลองสร้างคำขอหนึ่งใบแล้วอนุมัติจนครบ เพื่อตรวจหนังสือ PDF

**กฎการเลือกผู้อนุมัติ · How approvers are picked:** ยอดรวม VAT → ระดับวงเงินแรกที่ยอด ≤ “ไม่เกิน” → ตำแหน่งในระดับนั้นเรียงตาม “ลำดับ” → สำหรับแต่ละตำแหน่ง เลือกผู้อนุมัติที่อยู่ฝ่ายเดียวกับฝ่ายที่ขอซื้อก่อน ถ้าไม่มีจะเลือกคนแรกตามชื่อ · The total incl. VAT picks the first tier whose limit it fits; each position in that tier is filled by an approver from the requesting department first, otherwise the first by name.

---

## 4. อัปเดตและดูแลระบบ · Updating & monitoring

**อัปเดตโปรแกรม · Updating the app**
- แก้โค้ดแล้ว push เข้า branch `main` บน GitHub → Vercel สร้างและเผยแพร่เวอร์ชันใหม่อัตโนมัติ (ประมาณ 1–2 นาที ไม่มีช่วงระบบล่ม)
- ทดสอบก่อนขึ้นจริง: สร้าง branch / Pull Request → Vercel ทำลิงก์ **Preview** ให้ทดลองก่อน merge
- ถ้าเวอร์ชันใหม่มีปัญหา: Vercel → Deployments → เลือกเวอร์ชันก่อนหน้า → **Promote to Production** (ย้อนกลับได้ในไม่กี่วินาที)
- การเปลี่ยนโครงสร้างฐานข้อมูล ให้เพิ่มไฟล์ใหม่ใน `supabase/migrations/` (เช่น `0003_xxx.sql`) แล้วรันใน SQL Editor — **อย่าแก้ไฟล์เก่าที่รันไปแล้ว**
- อัปเดตแพ็กเกจเพื่อความปลอดภัยทุก 1–3 เดือน: `npm outdated`, `npm audit`, แล้วอัปเดต Next.js เป็นเวอร์ชันแพตช์ล่าสุดของ 15.5.x

**ติดตามความเร็วและปัญหา · Watching speed and problems**
- ในแอป: **ผู้ดูแลระบบ → สถานะปัญหา** — ข้อผิดพลาดที่ผู้ใช้เจอ (หน้าแสดงผลไม่ได้, บันทึกไม่สำเร็จโดยไม่คาดคิด, สร้าง PDF ไม่ได้) ถูกบันทึกพร้อมผู้ใช้และหน้า; กด “ดูมุมมองผู้ใช้” เพื่อตรวจว่าผู้ใช้คนนั้นเห็นอะไร · หน้าเว็บค้างตั้งแต่ 1 วินาทีขึ้นไปขณะพิมพ์/คลิก (action `slow-interaction`) ถูกบันทึกพร้อมต้นเหตุ: แอปนี้ / ส่วนเสริมของเบราว์เซอร์ / Vercel toolbar / เบราว์เซอร์เอง (Edge, Chrome)
- Vercel → โปรเจกต์ → **Speed Insights** (เปิดใช้ได้ในแดชบอร์ด) ดูความเร็วหน้าเว็บจากผู้ใช้จริง และ **Logs** ดูข้อผิดพลาดฝั่งเซิร์ฟเวอร์
- Supabase → **Reports** ดูการใช้ฐานข้อมูล/พื้นที่ไฟล์ และ **Logs** ดูคำสั่งที่ผิดพลาด; **Database → Backups** สำรองข้อมูลรายวัน (แพ็กเกจ Pro)

**ค่าใช้จ่ายโดยประมาณ · Rough cost** — Vercel Hobby ฟรี (สำหรับใช้งานในองค์กรเชิงพาณิชย์ Vercel กำหนดให้ใช้แพ็กเกจ Pro) · Supabase Free ใช้ทดลองได้ แต่โปรเจกต์ฟรีจะ **หยุดชั่วคราวเมื่อไม่มีการใช้งานราว 1 สัปดาห์** และไม่มีสำรองข้อมูลอัตโนมัติ — สำหรับใช้งานจริงแนะนำ Supabase Pro · ตรวจราคาล่าสุดที่เว็บไซต์ผู้ให้บริการ

---

## 5. สำหรับนักพัฒนา · For developers

```bash
npm install
cp .env.example .env.local   # fill in the two Supabase values
npm run dev                  # http://localhost:3000
npm run typecheck && npm run lint && npm run build
```

```
app/
  login/, auth/callback/        Microsoft 365 sign-in
  (app)/apply                   account application
  (app)/requests, requests/new, requests/[id]   preparer pages, review & sign, letter PDF
  (app)/inbox, history, notifications, profile
  (app)/admin/*                 overview & process control, applications, users & signatures,
                                settings, products (SKU import), errors (bug status), view-as
components/                     AppProvider (session, reference data, live notifications), Shell,
                                RequestForm, CoverLetter, SignaturePad, ui
lib/                            formatting (Thai baht text, dates), calc, pdf, error reporting
supabase/migrations/            schema, row level security, workflow functions, storage buckets
supabase/tests/                 workflow + security test that runs on plain PostgreSQL
```

**ทดสอบฐานข้อมูล · Database tests** (PostgreSQL 15+ on your machine):
```bash
createdb qa_test
psql -d qa_test -f supabase/tests/00_supabase_stub.sql   # stand-in for Supabase auth/storage
psql -d qa_test -f supabase/migrations/0001_init.sql
psql -d qa_test -f supabase/migrations/0002_seed.sql
psql -d qa_test -f supabase/migrations/0003_items_proxy_invites.sql
psql -d qa_test -f supabase/migrations/0004_discount_credit_leadtime.sql
psql -d qa_test -f supabase/migrations/0005_compare_sheet_fields.sql
psql -d qa_test -f supabase/migrations/0006_wet_signature.sql
psql -d qa_test -f supabase/migrations/0007_report_no.sql
psql -d qa_test -f supabase/migrations/0008_award_delivery.sql
psql -d qa_test -f supabase/migrations/0010_split_delete_company_reset.sql
psql -d qa_test -f supabase/migrations/0011_multi_vendor.sql
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/10_workflow_test.sql   # ends with: ALL TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/20_items_proxy_test.sql   # ends with: ALL 0003 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/30_discount_test.sql      # ends with: ALL 0004 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/40_sheet_fields_test.sql  # ends with: ALL 0005 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/50_wet_signature_test.sql # ends with: ALL 0006 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/60_report_no_test.sql     # ends with: ALL 0007 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/70_award_delivery_test.sql # ends with: ALL 0008 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/80_units_test.sql        # runs 0009 itself; ends with: ALL 0009 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/90_split_delete_company_reset_test.sql # runs last (clears requests); ends with: ALL 0010 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/91_multi_vendor_test.sql  # ends with: ALL 0011 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/92_report_no_required_test.sql # runs 0012 itself; ends with: ALL 0012 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/93_report_no_duplicates_test.sql # runs 0013 itself; ends with: ALL 0013 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/94_recall_test.sql             # runs 0014 itself; ends with: ALL 0014 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/95_pr_number_test.sql         # runs 0015 itself; ends with: ALL 0015 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/96_wet_name_clear_products_test.sql  # runs 0016 itself; ends with: ALL 0016 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/97_company_products_test.sql       # runs 0017 itself; ends with: ALL 0017 TESTS PASSED
psql -d qa_test -v ON_ERROR_STOP=1 -f supabase/tests/98_email_notify_delete_dept_test.sql  # runs 0018 itself; ends with: ALL 0018 TESTS PASSED
```
ครอบคลุม · Covers: first admin, applications, self-promotion blocked, server-side amounts and tiers, approver resolution by department, signatures required, forward rules, reject → reopen → resend (keeps number), admin remind/reassign/cancel, letter path rules, visibility for outsiders, disabled accounts.

**Workflow functions (Postgres RPC):** `submit_application`, `admin_review_application`, `preview_approvers`, `submit_request`, `approve_request`, `reject_request`, `forward_candidates`, `forward_request`, `cancel_request`, `reopen_request`, `admin_remind`, `admin_reassign`, `set_letter`, `admin_user_overview`.

**Phase 2 ideas:** email notifications (e.g. Supabase Edge Function + Resend, or Microsoft Graph `sendMail`), Microsoft Teams messages, approval delegation by date range, attaching the quotation file into the PDF, reports/export.
