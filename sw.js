/* 外枠アプリのファイルを端末に保存して、すぐ開けるようにする。
   アプリ本体（GAS）や Google のログイン部品には触らない。
   外枠を更新したら CACHE の番号を1つ上げる。 */
const CACHE = 'kyudo-shell-v18';
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
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || '農工大弓道部', opt),
    bumpBadge(d.badge)
  ]));
});
/* アイコンの右上の数字：サーバーが数えた未読数があればそれを、無ければ覚えている数に1足す */
async function bumpBadge(fromServer){
  try{
    const c = await caches.open('kyudo-badge');
    let n = 0;
    const r = await c.match('./__badge'); if(r) n = parseInt(await r.text(), 10) || 0;
    n = (typeof fromServer === 'number') ? Math.max(fromServer, n + 1) : n + 1;
    n = Math.min(99, n);
    await c.put('./__badge', new Response(String(n)));
    if(self.navigator && 'setAppBadge' in self.navigator) await self.navigator.setAppBadge(n);
  }catch(e){}
}
/* 外枠から「アイコンの数字をこの数に」と頼まれた時（アプリで読んだ時など） */
self.addEventListener('message', e => {
  const m = e.data;
  if(!m || m.kyudo !== 1 || m.type !== 'badge') return;
  const n = Math.max(0, Math.min(99, +m.count || 0));
  e.waitUntil((async () => {
    try{
      const c = await caches.open('kyudo-badge');
      await c.put('./__badge', new Response(String(n)));
      if(self.navigator && 'setAppBadge' in self.navigator){
        if(n > 0) await self.navigator.setAppBadge(n); else await self.navigator.clearAppBadge();
      }
    }catch(err){}
  })());
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

/* ---- アプリを閉じていても、電波が戻ったら送っていない変更を届ける（Android） ---- */
function kvGet(db, k){ return new Promise(res => { try{ const r = db.transaction('kv', 'readonly').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }catch(e){ res(null); } }); }
function kvDel(db, k){ return new Promise(res => { try{ const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); }catch(e){ res(); } }); }
function openKv(){ return new Promise((res, rej) => { const r = indexedDB.open('kyudo-app', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function flushPending(){
  const db = await openKv();
  const raw = await kvGet(db, 'kudo_pending'), tok = await kvGet(db, '_session'), url = await kvGet(db, '_appurl');
  if(!raw || !tok || !url) return;
  const p = JSON.parse(raw);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: 'save', token: tok, data: JSON.stringify(p.delta) }), redirect: 'follow' });
  const j = await r.json();
  if(!j || j.ok === false) throw new Error('not saved'); // もう一度、電波が戻った時に試してもらう
  if((await kvGet(db, 'kudo_pending')) === raw) await kvDel(db, 'kudo_pending');
}
self.addEventListener('sync', e => { if(e.tag === 'kyudo-sync') e.waitUntil(flushPending()); });
