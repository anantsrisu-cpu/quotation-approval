'use client';
import { forwardRef } from 'react';
import { useApp } from './AppProvider';
import { PURP, SUBJ, bahtText, dOnly, enDate, fmt, fmtQty, thDate, verifyCode } from '@/lib/format';
import type { RequestRow, RequestStep } from '@/lib/types';

/**
 * หนังสืออนุมัติใบเสนอราคา — the A4 letter. The same component is used for the
 * draft preview (watermarked) and for the final PDF.
 */
export const CoverLetter = forwardRef<HTMLElement, { r: RequestRow; steps: RequestStep[]; draft?: boolean }>(function CoverLetter({ r, steps, draft }, ref) {
  const { company, logoUrl, deptTh, name, people, posTh, settings } = useApp();
  const co = company(r.company_id);
  const logo = logoUrl(co);
  const prep = people[r.preparer_id];
  const subj = SUBJ[r.subject_type] || '';
  const ordered = [...steps].sort((a, b) => a.step_no - b.step_no);
  const tierShort = String(r.tier_label || '').split(' · ')[0];
  const comps = r.comparisons || [];

  const Sig = ({ img, ph }: { img?: string | null; ph: string }) =>
    img ? <img src={img} alt="ลายเซ็น · Signature" /> : <span className="ph">{ph}</span>;

  return (
    <article className="letter" ref={ref} aria-label="หนังสืออนุมัติใบเสนอราคา">
      {draft && <span className="wm" aria-hidden="true">ร่าง · DRAFT</span>}
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 20, borderBottom: '2px solid #111', paddingBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {logo ? (
            <img className="logo-img" src={logo} alt="" crossOrigin="anonymous" />
          ) : (
            <div style={{ width: 62, height: 62, borderRadius: 10, background: 'var(--brown)', color: '#fff', fontFamily: 'var(--f-ui)', fontWeight: 700, fontSize: 20, display: 'grid', placeItems: 'center' }}>
              {co?.initials || 'CO'}
            </div>
          )}
          <div style={{ lineHeight: 1.35 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{co?.th}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{co?.en}</div>
            <div style={{ fontSize: 12, color: '#444' }}>{co?.address}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13, lineHeight: 1.5 }}>
          เลขที่ · Ref: <b>{r.no ? `${r.no}/AP` : '(ยังไม่ออกเลข)'}</b><br />
          วันที่ {draft ? '[เมื่ออนุมัติครบ]' : thDate(r.completed_at || r.letter_at)}<br />
          Date: {draft ? '[on final approval]' : enDate(r.completed_at || r.letter_at)}
        </div>
      </header>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>หนังสืออนุมัติใบเสนอราคา</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Quotation Approval Cover Letter</div>
      </div>

      <div>
        <b>เรื่อง · Subject:</b> ขออนุมัติ{subj} {r.product_name} {deptTh(r.dept)}<br />
        <b>เรียน · To:</b> {settings?.recipient || '[ผู้รับ]'}<br />
        <b>สิ่งที่แนบมาด้วย · Enclosure:</b> ใบเสนอราคา {r.quote_no || '—'}
      </div>

      <p style={{ margin: 0, textIndent: 40 }}>
        ตามที่ {deptTh(r.dept)} ได้เสนอขออนุมัติ{subj} {r.product_name} (SKU {r.sku}) จำนวน {fmtQty(r.qty)} {r.unit} เพื่อ{PURP[r.purpose] || ''} จาก {r.vendor} ตามใบเสนอราคาเลขที่ {r.quote_no || '—'}
        {r.quote_date ? ` ลงวันที่ ${thDate(r.quote_date)}` : ''} {draft ? 'โดยขออนุมัติ' : 'บัดนี้ได้รับการอนุมัติครบถ้วน'}ตามอำนาจอนุมัติวงเงิน {tierShort} {draft ? '' : 'แล้ว '}รายละเอียดดังนี้
      </p>

      <table style={{ fontSize: 14 }}>
        <tbody>
          <tr><td style={{ width: '55%' }}>SKU / สินค้า · Product</td><td>{r.sku} · {r.product_name}</td></tr>
          <tr><td>ราคาต่อหน่วย ก่อน VAT · Unit price before VAT</td><td className="num" style={{ textAlign: 'right' }}>{fmt(r.unit_price)}</td></tr>
          <tr><td>จำนวน · Quantity</td><td style={{ textAlign: 'right' }}>{fmtQty(r.qty)} {r.unit}</td></tr>
          <tr><td>มูลค่ารวม ก่อน VAT · Subtotal before VAT</td><td className="num" style={{ textAlign: 'right' }}>{fmt(r.subtotal)}</td></tr>
          <tr><td>ภาษีมูลค่าเพิ่ม {Math.round((r.vat_rate || 0.07) * 100)}% · VAT</td><td className="num" style={{ textAlign: 'right' }}>{fmt(r.vat)}</td></tr>
          <tr style={{ fontWeight: 700 }}><td>รวมทั้งสิ้น (บาท) · Total (THB)</td><td className="num" style={{ textAlign: 'right' }}>{fmt(r.total)}</td></tr>
          <tr><td colSpan={2} style={{ textAlign: 'center' }}>({bahtText(r.total)})</td></tr>
        </tbody>
      </table>

      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>การเปรียบเทียบราคา · Price comparison</div>
        {r.no_comp ? (
          <div>ไม่มีคู่เทียบ · No comparison — เหตุผล: {r.no_comp_reason}</div>
        ) : (
          <>
            <table style={{ fontSize: 12 }} className="num">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>ผู้ขาย · Vendor</th>
                  <th style={{ textAlign: 'right' }}>ราคาต่อหน่วย ก่อน VAT</th>
                  <th style={{ textAlign: 'right' }}>จำนวน</th>
                  <th style={{ textAlign: 'right' }}>มูลค่ารวม ก่อน VAT</th>
                  <th style={{ textAlign: 'right' }}>รวม VAT</th>
                  <th style={{ textAlign: 'right' }}>ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ fontWeight: 700 }}>
                  <td>{r.vendor} ✓</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.unit_price)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtQty(r.qty)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.subtotal)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(r.total)}</td>
                  <td style={{ textAlign: 'right' }}>ผู้ขายที่เลือก</td>
                </tr>
                {comps.map((x, i) => (
                  <tr key={i}>
                    <td>{x.vendor}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(x.unit_price)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtQty(r.qty)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(x.subtotal)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(x.total)}</td>
                    <td style={{ textAlign: 'right' }}>{(x.diff || 0) >= 0 ? '+' : '−'}{fmt(Math.abs(x.diff || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.low_reason && <div style={{ fontSize: 13, marginTop: 4 }}>เหตุผลที่ไม่เลือกราคาต่ำสุด: {r.low_reason}</div>}
          </>
        )}
      </div>

      <p style={{ margin: 0, textIndent: 40 }}>จึงเรียนมาเพื่อโปรดทราบและดำเนินการต่อไป · For your information and further action.</p>

      <div className="sigs">
        <div className="s">
          <Sig img={r.preparer_signature} ph="" />
          <span className="ln" />
          <span>({prep?.name || ''})</span>
          <span>{prep?.title || ''}</span>
          <b>ผู้จัดทำ · Prepared by</b>
          <span>{dOnly(r.submitted_at)}</span>
        </div>
        {ordered.map((s, i) => (
          <div className="s" key={s.step_no}>
            <Sig img={s.status === 'approved' ? s.signature : null} ph="รอลงนาม · Pending" />
            <span className="ln" />
            <span>({name(s.signer_id || s.approver_id)})</span>
            <span>{posTh(s.position)}</span>
            <b>ผู้อนุมัติ {i + 1} · Approved by</b>
            {s.on_behalf_of && <span>อนุมัติแทน {name(s.on_behalf_of)}</span>}
            <span>{s.status === 'approved' ? dOnly(s.acted_at) : ''}</span>
          </div>
        ))}
      </div>

      <footer style={{ marginTop: 'auto', borderTop: '1px solid var(--tan)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11, color: '#444' }}>
        <span>สร้างโดยระบบอนุมัติใบเสนอราคา · Generated by Quotation Approval</span>
        <span>รหัสตรวจสอบ · Verify: <span className="mono">{verifyCode(r.id + (r.completed_at || ''))}</span></span>
      </footer>
    </article>
  );
});
