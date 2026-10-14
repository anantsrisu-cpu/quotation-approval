'use client';

/** Render an on-screen letter element into an A4 PDF (keeps Thai web fonts and signatures). */
export async function elementToPdf(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210;
  const H = 297;
  const h = (canvas.height * W) / canvas.width;
  const img = canvas.toDataURL('image/jpeg', 0.92);
  // A letter that is only slightly taller than A4 is shrunk onto one page instead of spilling a few lines
  if (h > H && h <= H * 1.12) {
    const w = (W * H) / h;
    pdf.addImage(img, 'JPEG', (W - w) / 2, 0, w, H);
    return pdf.output('blob');
  }
  pdf.addImage(img, 'JPEG', 0, 0, W, h);
  let left = h - H;
  let y = 0;
  while (left > 1) {
    y -= H;
    pdf.addPage();
    pdf.addImage(img, 'JPEG', 0, y, W, h);
    left -= H;
  }
  return pdf.output('blob');
}

/** Trigger a normal browser download for a URL. */
export function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
