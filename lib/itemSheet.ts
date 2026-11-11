/**
 * Excel form for request items (สร้างคำขอ → รายการสินค้า):
 * the preparer downloads it, fills one row per item and drops the file back on the form.
 * Columns are the same as "วางหลายรายการจาก Excel": SKU · จำนวน · ราคาต่อหน่วยก่อน VAT ·
 * ส่วนลด · ราคาก่อนหน้า · คำต่อท้าย.
 */

export const ITEM_HEAD = ['SKU', 'จำนวน', 'ราคาต่อหน่วยก่อน VAT (เจ้าที่ 1)', 'ส่วนลด (5% หรือ 100)', 'ราคาก่อนหน้า', 'คำต่อท้ายชื่อสินค้า'];
export const ITEM_FILE = 'items-form.xlsx';

export async function downloadItemForm() {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const H = (v: string) => ({ value: v, fontWeight: 'bold' as const, backgroundColor: '#EFE6DA' });
  const T = (v: string) => ({ value: v, type: String });
  const fill = [ITEM_HEAD.map(H), ...Array.from({ length: 30 }, () => ITEM_HEAD.map(() => T('')))];
  const help: unknown[][] = [
    [H('วิธีกรอก · How to fill in'), H('')],
    [T('1.'), T('กรอกในชีต “รายการ” 1 แถว = 1 รายการ เริ่มแถวที่ 2 (ห้ามลบแถวหัวคอลัมน์)')],
    [T('2.'), T('SKU ต้องมีในรายการสินค้า SKU ของระบบ ชื่อสินค้าและหน่วยจะขึ้นเอง')],
    [T('3.'), T('ราคาต่อหน่วยก่อน VAT = ราคาของผู้ขายเจ้าที่ 1 (ใบเสนอราคาหลัก) · ราคาคู่เทียบกรอกในหน้าแบบฟอร์ม')],
    [T('4.'), T('ส่วนลด พิมพ์ 5% (เปอร์เซ็นต์) หรือ 100 (บาทต่อหน่วย) หรือเว้นว่าง')],
    [T('5.'), T('บันทึกไฟล์ แล้วลากไฟล์มาวางที่ส่วน “รายการสินค้า” ในหน้าสร้างคำขอ หรือกด “วางหลายรายการจาก Excel” แล้วเลือกไฟล์')],
    [T(''), T('')],
    [H('ตัวอย่าง · Example'), H('')],
    ...ITEM_HEAD.map((h, i) => [T(h), T(['AC-INV-18000', '6', '29050', '5%', '28500', 'ติดตั้งห้องประชุม'][i])]),
  ];
  await writeExcelFile([
    { data: fill as never, sheet: 'รายการ', stickyRowsCount: 1, columns: [18, 10, 24, 18, 16, 36].map((width) => ({ width })) },
    { data: help as never, sheet: 'วิธีกรอก', columns: [{ width: 30 }, { width: 90 }] },
  ]).toFile(ITEM_FILE);
}

const cell = (v: unknown, col: number) => {
  if (v == null) return '';
  if (typeof v === 'number') {
    // a discount typed as 5% in Excel arrives as 0.05
    if (col === 3 && v > 0 && v < 1) return `${Math.round(v * 10000) / 100}%`;
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (v instanceof Date) return '';
  return String(v).trim();
};

/** Reads the first sheet of an .xlsx and returns its rows as tab-separated text (same as a paste). */
export async function readItemFile(file: File): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('ใช้ไฟล์ .xlsx (ฟอร์มที่ดาวน์โหลดจากระบบ) · Use an .xlsx file');
  const { readSheet } = await import('read-excel-file/browser');
  const data = (await readSheet(file)) as unknown[][];
  const q = (s: string) => (/[\t\n]/.test(s) || s.startsWith('"') ? `"${s.replace(/"/g, '""')}"` : s);
  return data
    .map((r) => r.slice(0, 6).map((v, i) => q(cell(v, i))))
    .filter((r) => r.some(Boolean))
    .map((r) => r.join('\t'))
    .join('\n');
}
