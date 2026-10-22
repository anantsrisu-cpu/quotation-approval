'use client';

/**
 * Render the on-screen letter into an A4 PDF, one PDF page per letter page
 * (keeps Thai web fonts and signatures). Pages are laid out by CoverLetter.
 */
export async function elementToPdf(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  if (document.fonts?.ready) await document.fonts.ready;
  // wait (max 3 s) until the letter has been split into pages
  for (let i = 0; i < 30 && el.dataset.ready === '0'; i++) await new Promise((r) => setTimeout(r, 100));
  // portrait letter pages, then the landscape comparison sheet pages (.cs-page)
  const pages = Array.from(el.querySelectorAll<HTMLElement>(':scope > .letter, :scope > .sheet-host > .cs-page'));
  const list = pages.length ? pages : [el];
  const landscape = (p: HTMLElement) => p.classList.contains('cs-page');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape(list[0]) ? 'landscape' : 'portrait', compress: true });
  for (let i = 0; i < list.length; i++) {
    const wide = landscape(list[i]);
    const W = wide ? 297 : 210;
    const H = wide ? 210 : 297;
    const canvas = await html2canvas(list[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const h = (canvas.height * W) / canvas.width;
    if (i > 0) pdf.addPage('a4', wide ? 'landscape' : 'portrait');
    if (h <= H + 0.5) pdf.addImage(img, 'JPEG', 0, 0, W, Math.min(h, H));
    else {
      // a page that grew past A4 (one very long item) is scaled down to fit
      const w = (W * H) / h;
      pdf.addImage(img, 'JPEG', (W - w) / 2, 0, w, H);
    }
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
