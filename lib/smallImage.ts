'use client';
import { useEffect, useState } from 'react';

/**
 * Big pictures shown small (a 4000-px logo in a 62-px box) make the browser decode
 * tens of MB again and again while the page scrolls, which shows as stutter and blank
 * patches. These helpers make a copy that is only as big as it needs to be.
 */

/** the logo kept in storage: this size is plenty for the screen and the PDF */
export const LOGO_MAX = 1000;

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, bad) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('image'));
    im.src = src;
  });

function scaled(im: HTMLImageElement, max: number, type = 'image/png'): Promise<Blob | null> {
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * k));
  c.height = Math.max(1, Math.round(im.naturalHeight * k));
  const g = c.getContext('2d');
  if (!g) return Promise.resolve(null);
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, type, 0.92));
}

/** the image's own size (0 × 0 if it cannot be read) */
export async function imageSize(src: string) {
  try {
    const im = await load(src);
    return { w: im.naturalWidth, h: im.naturalHeight };
  } catch {
    return { w: 0, h: 0 };
  }
}

/** An uploaded picture made no larger than `max` px on its longer side (SVG and small files as they are). */
export async function shrinkFile(f: File, max = LOGO_MAX): Promise<File> {
  if (f.type === 'image/svg+xml') return f;
  const url = URL.createObjectURL(f);
  try {
    const im = await load(url);
    if (Math.max(im.naturalWidth, im.naturalHeight) <= max) return f;
    const type = f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const b = await scaled(im, max, type);
    return b ? new File([b], f.name.replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.png'), { type }) : f;
  } catch {
    return f;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const thumbs = new Map<string, Promise<string>>();
/** a small copy of the picture at `src` for showing at up to `max` px (cached for the visit) */
function thumb(src: string, max: number) {
  const key = `${max}|${src}`;
  let p = thumbs.get(key);
  if (!p) {
    p = load(src)
      .then(async (im) => {
        if (Math.max(im.naturalWidth, im.naturalHeight) <= max * 1.5) return src;
        const b = await scaled(im, max);
        return b ? URL.createObjectURL(b) : src;
      })
      .catch(() => src);
    thumbs.set(key, p);
  }
  return p;
}

/** React: `src` shrunk to `max` px; null until it is ready (show a placeholder meanwhile). */
export function useThumb(src: string | null, max: number) {
  const [out, setOut] = useState<{ src: string; t: string } | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    thumb(src, max).then((t) => live && setOut({ src, t }));
    return () => { live = false; };
  }, [src, max]);
  return src && out?.src === src ? out.t : null;
}
