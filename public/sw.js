// Minimal service worker: makes the app installable. It does not cache pages or data,
// so people always see the latest approvals and a new version never gets "stuck".
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
