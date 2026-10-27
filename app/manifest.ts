import type { MetadataRoute } from 'next';

/** Lets Android and iPhone install the app on the home screen (Progressive Web App). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'ระบบอนุมัติใบเสนอราคา · Quotation Approval',
    short_name: 'อนุมัติราคา',
    description: 'ขออนุมัติใบเสนอราคา อนุมัติและลงนาม และดาวน์โหลด PDF ตารางเปรียบเทียบราคา',
    lang: 'th',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F4EEE8',
    theme_color: '#502D1E',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
