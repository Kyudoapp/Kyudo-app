/* 外枠アプリのファイルを端末に保存して、すぐ開けるようにする。
   アプリ本体（GAS）や Google のログイン部品には触らない。
   外枠を更新したら CACHE の番号を1つ上げる。 */
const CACHE = 'kyudo-shell-v10';
const FILES = ['./', './index.html', './manifest.webmanifest',
  './k2-192.png', './k2-512.png', './k2-maskable-512.png', './k2-apple-180.png', './k2-badge-72.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* ページ本体と manifest は、ネットにつながる時は必ず最新を取る（更新がすぐ反映されるように）。
   画像などは保存してある物をすぐ返し、裏で新しい物に入れ替える。 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  const fresh = req.mode === 'navigate' || /\.(webmanifest|html)$/.test(url.pathname) || url.pathname.endsWith('/');
  if(fresh){
    // ページの読込(navigate)はそのまま設定を付け直せないので、同じURLで作り直して取りに行く
    e.respondWith(fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(r => {
      if(r && r.ok){ const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if(r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
/* ---- アプリの通知（サーバーから届いた物を表示する） ---- */
self.addEventListener('push', e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(_){ d = { body: e.data ? e.data.text() : '' }; }
  const opt = { body: d.body || '', icon: 'k2-192.png', badge: 'k2-badge-72.png', data: { url: d.url || './' } };
  if(d.tag){ opt.tag = d.tag + '-' + Date.now(); } // 同じ種類でも1件ずつ並べる
  e.waitUntil(self.registration.showNotification(d.title || '農工大弓道部', opt));
});
/* 通知をタップしたらアプリを開く（開いていれば前に出す） */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for(const c of list){ if(c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
