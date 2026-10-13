import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaSetup } from '@/components/Pwa';

export const metadata: Metadata = {
  title: 'ระบบอนุมัติใบเสนอราคา · Quotation Approval',
  description: 'Quotation approval workflow with price-tier approvers and signed PDF cover letters.',
  applicationName: 'อนุมัติราคา',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192' }], apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'อนุมัติราคา', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#502D1E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&family=Sarabun:wght@400;600;700&display=swap"
        />
      </head>
      <body>
        <PwaSetup />
        {children}
      </body>
    </html>
  );
}
