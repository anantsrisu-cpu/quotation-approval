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
