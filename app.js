(function () {
'use strict';
var C = window.GZ_CONFIG;
var app = document.getElementById('app');
function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function fmt(n) { n = Number(n) || 0; return n.toLocaleString('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3}); }
function fmt0(n) { n = Number(n) || 0; return n.toLocaleString('en-US', {maximumFractionDigits: 0}); }

var S = {
  token: ls('gz_token'), user: ls('gz_user'), name: ls('gz_name'), tab: 'home',
  dash: null, inv: null, meta: null, stamp: 0, filter: 'all', q: '', select: false, sel: {}, photos: {}
};
try { S.dash = JSON.parse(ls('gz_dash') || 'null'); S.inv = JSON.parse(ls('gz_inv') || 'null'); S.meta = JSON.parse(ls('gz_meta') || 'null'); S.stamp = Number(ls('gz_stamp') || 0); } catch (e) {}

/* ---------- ui helpers ---------- */
var tt;
function toast(m, bad) {
  var t = $('#toast'); t.textContent = m; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(tt); tt = setTimeout(function () { t.className = ''; }, bad ? 4500 : 2800);
}
var busyN = 0;
function busy(on) { busyN += on ? 1 : -1; if (busyN < 0) busyN = 0; $('#busy').classList.toggle('hide', busyN === 0); }

function api(a, data, opt) {
  opt = opt || {};
  if (!opt.silent) busy(true);
  var ctrl = ('AbortController' in window) ? new AbortController() : null;
  var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 70000);
  var body = JSON.stringify(Object.assign({a: a, t: S.token}, data || {}));
  return fetch(C.API, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: body, signal: ctrl ? ctrl.signal : undefined})
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.err === 'auth' && a !== 'login') { logout(true); } return j; })
    .catch(function () { return {ok: false, err: 'net', msg: 'تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'}; })
    .then(function (j) { clearTimeout(to); if (!opt.silent) busy(false); return j; });
}

/* ---------- photo cache ---------- */
var idb;
function idbOpen() {
  return new Promise(function (res) {
    if (idb) return res(idb);
    try {
      var rq = indexedDB.open('gz', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('ph'); };
      rq.onsuccess = function () { idb = rq.result; res(idb); };
      rq.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function idbGet(k) { return idbOpen().then(function (d) { return new Promise(function (res) { if (!d) return res(null); try { var r = d.transaction('ph').objectStore('ph').get(k); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; } catch (e) { res(null); } }); }); }
function idbSet(k, v) { idbOpen().then(function (d) { try { if (d) d.transaction('ph', 'readwrite').objectStore('ph').put(v, k); } catch (e) {} }); }
function idbDel(k) { idbOpen().then(function (d) { try { if (d) d.transaction('ph', 'readwrite').objectStore('ph').delete(k); } catch (e) {} }); }

var pq = {}, inflight = {}, ptimer;
function paint(key) {
  var src = S.photos[key]; if (!src) return;
  $$('[data-ph="' + key + '"]').forEach(function (el) {
    var im = el.querySelector('img'); if (!im) { im = document.createElement('img'); el.innerHTML = ''; el.appendChild(im); }
    im.src = src;
  });
}
function wantPhoto(id, sz) {
  sz = sz || 360;
  var key = id + '@' + sz;
  if (!id) return;
  if (S.photos[key]) { paint(key); return; }
  if (inflight[key] || pq[key]) return;
  pq[key] = {id: id, sz: sz};
  idbGet(key).then(function (v) {
    if (v) { S.photos[key] = v; delete pq[key]; paint(key); }
    else { clearTimeout(ptimer); ptimer = setTimeout(flushPhotos, 150); }
  });
}
function flushPhotos() {
  var keys = Object.keys(pq); if (!keys.length) return;
  var first = pq[keys[0]], sz = first.sz, batch = keys.filter(function (k) { return pq[k].sz === sz; }).slice(0, sz > 500 ? 2 : 6);
  var ids = batch.map(function (k) { return pq[k].id; });
  batch.forEach(function (k) { delete pq[k]; inflight[k] = 1; });
  api('photos', {ids: ids, sz: sz}, {silent: true}).then(function (r) {
    batch.forEach(function (k) { delete inflight[k]; });
    if (r && r.ok) {
      batch.forEach(function (k) {
        var id = k.split('@')[0];
        if (r.photos[id]) { S.photos[k] = r.photos[id]; idbSet(k, r.photos[id]); paint(k); }
      });
    }
    if (Object.keys(pq).length) ptimer = setTimeout(flushPhotos, 50);
  });
}
var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
  es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); wantPhoto(e.target.getAttribute('data-id'), 360); } });
}, {rootMargin: '300px'}) : null;

/* ---------- image capture ---------- */
function compress(file, max, q) {
  max = max || 1100; q = q || 0.72;
  return new Promise(function (res, rej) {
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(u);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = function () { rej(new Error('img')); };
    img.src = u;
  });
}
function pickPhoto() {
  return new Promise(function (res) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return res(null);
      busy(true); compress(f).then(function (d) { busy(false); res(d); }).catch(function () { busy(false); toast('تعذر قراءة الصورة', true); res(null); });
    };
    inp.click();
  });
}

/* ---------- sheet ---------- */
function sheet(html, mount) {
  var o = document.createElement('div'); o.className = 'ovl';
  o.innerHTML = '<div class="sheet"><div class="grab"></div>' + html + '</div>';
  document.body.appendChild(o);
  function close() { if (o.parentNode) o.parentNode.removeChild(o); }
  o.addEventListener('click', function (e) { if (e.target === o) close(); });
  if (mount) mount($('.sheet', o), close);
  return close;
}

/* ---------- auth ---------- */
function logout(expired) {
  S.token = null; ls('gz_token', null); ls('gz_dash', null); ls('gz_inv', null); S.dash = null; S.inv = null;
  render(); if (expired) toast('انتهت الجلسة، سجّل الدخول من جديد', true);
}
function viewLogin() {
  var last = ls('gz_last') || C.USERS[0].id, sel = last;
  app.innerHTML = '<div class="login"><img class="wm" src="icons/wordmark.png" alt="Ghazal Fashion"><p>نظام المبيعات والمخزون</p>' +
    '<div class="who">' + C.USERS.map(function (u) { return '<button data-u="' + u.id + '" class="' + (u.id === last ? 'on' : '') + '">' + esc(u.name) + '</button>'; }).join('') + '</div>' +
    '<input class="pin" id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="الرقم السري">' +
    '<button class="btn-main" id="go">دخول</button><div class="err" id="err"></div></div>';
  $$('.who button').forEach(function (b) { b.onclick = function () { sel = b.getAttribute('data-u'); $$('.who button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('#pin').focus(); }; });
  function go() {
    var pin = $('#pin').value.trim(); if (!pin) return;
    var btn = $('#go'); btn.disabled = true; $('#err').textContent = '';
    api('login', {user: sel, pin: pin}).then(function (r) {
      btn.disabled = false;
      if (r.ok) {
        S.token = r.token; S.user = r.user; S.name = r.name; ls('gz_token', r.token); ls('gz_user', r.user); ls('gz_name', r.name); ls('gz_last', r.user);
        S.tab = 'home'; render(); loadAll();
      } else {
        var m = {bad: 'الرقم السري غير صحيح', locked: 'محاولات كثيرة خاطئة. انتظر 10 دقائق ثم حاول.', nopin: 'لم يُضبط الرقم السري لهذا المستخدم بعد.', net: r.msg}[r.err] || (r.msg || 'حدث خطأ');
        $('#err').textContent = m; $('#pin').value = '';
      }
    });
  }
  $('#go').onclick = go; $('#pin').onkeydown = function (e) { if (e.key === 'Enter') go(); };
}

/* ---------- data ---------- */
function loadAll(silent) {
  if (!S.token) return Promise.resolve();
  return Promise.all([api('dash', null, {silent: true}), api('inv', null, {silent: true}), api('meta', null, {silent: true})]).then(function (a) {
    if (a[0] && a[0].ok) { S.dash = a[0]; ls('gz_dash', JSON.stringify(a[0])); }
    if (a[1] && a[1].ok) { S.inv = a[1]; ls('gz_inv', JSON.stringify(a[1])); }
    if (a[2] && a[2].ok) { S.meta = a[2]; ls('gz_meta', JSON.stringify(a[2])); }
    var failed = !(a[0] && a[0].ok && a[1] && a[1].ok);
    if (!failed) { S.stamp = Date.now(); ls('gz_stamp', String(S.stamp)); }
    else if (!silent) toast((a[0] && a[0].msg) || (a[1] && a[1].msg) || 'تعذر تحديث البيانات', true);
    if (S.token) renderBody();
  });
}
function refreshBtn() {
  var b = $('#rf'); if (b) b.style.opacity = '.5';
  loadAll().then(function () { var b2 = $('#rf'); if (b2) b2.style.opacity = '1'; toast('تم التحديث'); });
}

/* ---------- shell ---------- */
function render() {
  if (!S.token) return viewLogin();
  app.innerHTML = '<div class="top"><img src="icons/wordmark.png" alt=""><div class="ttl" id="ttl"></div>' +
    '<button class="ic" id="rf" title="تحديث">↻</button><button class="ic" id="mn" title="القائمة">⋮</button></div>' +
    '<div class="page" id="body"></div>' +
    '<div class="nav"><button data-t="home"><span class="i">⌂</span>الرئيسية</button>' +
    '<button class="plus" id="plus"><span>+</span></button>' +
    '<button data-t="inv"><span class="i">▦</span>المخزون</button></div>';
  $$('.nav [data-t]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-t'); S.select = false; S.sel = {}; renderBody(); window.scrollTo(0, 0); }; });
  $('#plus').onclick = openAdd; $('#rf').onclick = refreshBtn; $('#mn').onclick = openMenu;
  renderBody();
}
function renderBody() {
  if (!S.token || !$('#body')) return;
  $$('.nav [data-t]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === S.tab); });
  $('#ttl').textContent = S.tab === 'home' ? ('أهلاً ' + (S.name || '')) : 'المخزون';
  var old = $('.bulk'); if (old) old.remove();
  if (S.tab === 'home') viewHome(); else viewInv();
}
function openMenu() {
  sheet('<h2>' + esc(S.name || '') + '</h2><div class="menu"><button id="m1"><span class="i">↻</span><div>تحديث البيانات<small>سحب آخر الأرقام من الشيت</small></div></button>' +
    '<button id="m2"><span class="i">⎋</span><div>تسجيل الخروج<small>على هذا الجهاز</small></div></button></div>', function (el, close) {
    $('#m1', el).onclick = function () { close(); refreshBtn(); };
    $('#m2', el).onclick = function () { close(); logout(); };
  });
}

/* ---------- home ---------- */
function viewHome() {
  var d = S.dash, b = $('#body');
  if (!d) { b.innerHTML = '<div class="sk" style="height:170px"></div><div class="sk"></div><div class="sk"></div>'; return; }
  var net = d.cash + d.recv + d.stock - d.liab, m = d.month, inv = d.inv;
  var upd = S.stamp ? new Date(S.stamp).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'}) : '';
  b.innerHTML =
    '<div class="hero"><div class="l">النقد الفعلي (نقد المشروع)</div><div class="v">' + fmt(d.cash) + '<small>ر.ع</small></div>' +
    '<div class="row"><div>الصافي التشغيلي<b>' + fmt(net) + '</b></div><div>مبيعات الشهر<b>' + fmt(m.sales) + '</b></div><div>صافي ربح الشهر<b>' + fmt(m.net) + '</b></div></div></div>' +
    '<div class="grid2"><div class="tile"><div class="l">المخزون بالتكلفة</div><div class="v">' + fmt(d.stock) + '</div><div class="s">' + fmt0(inv.total.n) + ' قطعة</div></div>' +
    '<div class="tile"><div class="l">مستحق على البوتيكات</div><div class="v">' + fmt(d.recv) + '</div><div class="s">لم يُحوَّل بعد</div></div>' +
    '<div class="tile"><div class="l">التزامات الموردين</div><div class="v">' + fmt(d.liab) + '</div><div class="s">علينا للموردين</div></div>' +
    '<div class="tile"><div class="l">قطع مباعة هذا الشهر</div><div class="v">' + fmt0(m.qty) + '</div><div class="s">من ' + esc(m.from) + '</div></div></div>' +
    '<div class="card"><h3>أين القطع الآن</h3>' +
    '<div class="kv"><span>في المخزن</span><b>' + fmt0(inv.main.n) + ' قطعة · ' + fmt(inv.main.v) + '</b></div>' +
    '<div class="kv"><span>في البوتيكات</span><b>' + fmt0(inv.boutique.n) + ' قطعة · ' + fmt(inv.boutique.v) + '</b></div>' +
    '<div class="kv"><span>في الطريق</span><b>' + fmt0(inv.transit.n) + ' قطعة · ' + fmt(inv.transit.v) + '</b></div></div>' +
    '<div class="card"><h3>البوتيكات</h3>' + (d.boutiques.length ? d.boutiques.map(function (x) {
      return '<div class="bt"><div><div class="n">' + esc(x.n) + '</div><div class="m">عنده ' + fmt0(x.pcs) + ' قطعة · باع ' + fmt0(x.sold) + '</div></div><div class="o">' + fmt(x.owed) + '<div class="m">متبقٍّ عليه</div></div></div>';
    }).join('') : '<div class="empty">لا توجد بوتيكات</div>') + '</div>' +
    '<div class="card"><h3>أرباح وخسائر الشهر</h3>' +
    '<div class="kv"><span>المبيعات</span><b>' + fmt(m.sales) + '</b></div><div class="kv"><span>تكلفة القطع المباعة</span><b>' + fmt(m.cost) + '</b></div>' +
    '<div class="kv"><span>مجمل الربح</span><b>' + fmt(m.gross) + '</b></div><div class="kv"><span>المصروفات التشغيلية</span><b>' + fmt(m.opex) + '</b></div>' +
    '<div class="kv"><span>صافي الربح</span><b class="' + (m.net >= 0 ? 'pos' : 'neg') + '">' + fmt(m.net) + '</b></div>' +
    '<div class="kv"><span>مسحوبات شخصية (خارج الربح)</span><b>' + fmt(m.draws) + '</b></div></div>' +
    '<div class="stale">آخر تحديث ' + upd + ' · الأرقام بالريال العماني</div>';
}

/* ---------- inventory ---------- */
var STATUS = {'في المخزن': ['main', 'مخزن'], 'في البوتيك': ['bt', 'بوتيك'], 'مباع': ['sold', 'مباع'], 'في الطريق': ['tr', 'في الطريق']};
function stKey(it) { return (STATUS[it.st] || ['main'])[0]; }
function viewInv() {
  var b = $('#body'), inv = S.inv;
  if (!inv) { b.innerHTML = '<div class="sk" style="height:60px"></div><div class="sk" style="height:300px"></div>'; return; }
  var items = inv.items, cnt = {all: items.length, main: 0, bt: 0, sold: 0, tr: 0};
  items.forEach(function (i) { cnt[stKey(i)]++; });
  var F = [['all', 'الكل'], ['main', 'في المخزن'], ['bt', 'في البوتيك'], ['sold', 'مباع'], ['tr', 'في الطريق']];
  b.innerHTML = '<div class="search"><input id="q" type="search" placeholder="ابحث بالكود أو الوصف أو اللون" value="' + esc(S.q) + '"><button id="sl" class="' + (S.select ? 'on' : '') + '">' + (S.select ? 'إلغاء' : 'تحديد') + '</button></div>' +
    '<div class="chips">' + F.map(function (f) { return '<button class="chip ' + (S.filter === f[0] ? 'on' : '') + '" data-f="' + f[0] + '">' + f[1] + '<i>' + cnt[f[0]] + '</i></button>'; }).join('') + '</div>' +
    '<div class="items" id="items"></div>';
  $('#q').oninput = function () { S.q = this.value; fillItems(); };
  $('#sl').onclick = function () { S.select = !S.select; S.sel = {}; renderBody(); };
  $$('.chip').forEach(function (c) { c.onclick = function () { S.filter = c.getAttribute('data-f'); renderBody(); }; });
  fillItems();
}
function fillItems() {
  var box = $('#items'); if (!box || !S.inv) return;
  var q = S.q.trim().toLowerCase(), order = {main: 0, bt: 1, tr: 2, sold: 3};
  var list = S.inv.items.filter(function (i) {
    if (S.filter !== 'all' && stKey(i) !== S.filter) return false;
    if (!q) return true;
    return (i.c + ' ' + i.d + ' ' + i.s + ' ' + (i.loc || '')).toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return order[stKey(a)] - order[stKey(b)]; });
  if (!list.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">لا توجد قطع مطابقة</div>'; updateBulk(); return; }
  box.innerHTML = list.map(function (i) {
    var k = stKey(i), price = k === 'sold' ? i.ap : i.sp, on = S.sel[i.c] ? ' sel' : '';
    return '<button class="it' + on + '" data-c="' + esc(i.c) + '"><div class="ph" data-ph="' + (i.ph ? i.ph + '@360' : '') + '" data-id="' + esc(i.ph) + '">' +
      (i.ph ? '' : '<div class="no"><b>✦</b>بدون صورة</div>') + '</div>' +
      '<span class="badge b-' + k + '">' + (k === 'bt' && i.loc ? esc(i.loc) : STATUS[i.st] ? STATUS[i.st][1] : esc(i.st)) + '</span>' +
      (S.select && k !== 'sold' && k !== 'tr' ? '<span class="ck">' + (S.sel[i.c] ? '✓' : '') + '</span>' : '') +
      '<div class="bd"><div class="cd">' + esc(i.c) + '</div><div class="ds">' + esc(i.d) + '</div><div class="pr">' + fmt(price) + ' ر.ع</div></div></button>';
  }).join('');
  $$('.it', box).forEach(function (el) {
    var c = el.getAttribute('data-c');
    el.onclick = function () {
      if (S.select) {
        var it = byCode(c); if (!it || stKey(it) === 'sold' || stKey(it) === 'tr') return;
        if (S.sel[c]) delete S.sel[c]; else S.sel[c] = 1;
        el.classList.toggle('sel', !!S.sel[c]); var ck = $('.ck', el); if (ck) ck.textContent = S.sel[c] ? '✓' : ''; updateBulk();
      } else openItem(c);
    };
    var ph = $('.ph', el), id = ph.getAttribute('data-id');
    if (id) { if (S.photos[id + '@360']) paint(id + '@360'); else if (io) io.observe(ph); else wantPhoto(id, 360); }
  });
  updateBulk();
}
function byCode(c) { return (S.inv ? S.inv.items : []).filter(function (i) { return i.c === c; })[0]; }
function updateBulk() {
  var old = $('.bulk'); if (old) old.remove();
  var n = Object.keys(S.sel).length; if (!S.select || !n) return;
  var d = document.createElement('div'); d.className = 'bulk';
  d.innerHTML = '<div class="c">' + n + ' محددة</div><button id="bm">نقل لبوتيك</button><button id="bb">إرجاع للمخزن</button><button class="g" id="bx">مسح</button>';
  document.body.appendChild(d);
  $('#bm').onclick = function () { chooseBoutique(Object.keys(S.sel)); };
  $('#bb').onclick = function () { confirmBack(Object.keys(S.sel)); };
  $('#bx').onclick = function () { S.sel = {}; fillItems(); };
}

/* ---------- item sheet ---------- */
function openItem(code) {
  var it = byCode(code); if (!it) return;
  var k = stKey(it);
  var rows = '<div class="kv"><span>الكود</span><b style="direction:ltr">' + esc(it.c) + '</b></div>' +
    '<div class="kv"><span>الحالة</span><b>' + esc(it.st) + (it.loc ? ' · ' + esc(it.loc) : '') + '</b></div>' +
    '<div class="kv"><span>سعر البيع المعتمد</span><b>' + fmt(it.sp) + '</b></div>' +
    '<div class="kv"><span>التكلفة الكلية</span><b>' + fmt(it.tc) + '</b></div>';
  if (k === 'sold') rows += '<div class="kv"><span>بيعت بـ</span><b>' + fmt(it.ap) + '</b></div><div class="kv"><span>الربح</span><b class="' + ((it.pf || 0) >= 0 ? 'pos' : 'neg') + '">' + (it.pf == null ? '-' : fmt(it.pf)) + '</b></div><div class="kv"><span>القناة · التاريخ</span><b>' + esc(it.ch) + ' · ' + esc(it.sd) + '</b></div>';
  var acts = '';
  if (k === 'main') acts = '<button class="act pri" id="a-sell">بيع</button><button class="act" id="a-move">نقل لبوتيك</button>';
  else if (k === 'bt') acts = '<button class="act pri" id="a-sell">بيع</button><button class="act" id="a-back">إرجاع للمخزن</button><button class="act full" id="a-move">نقل لبوتيك آخر</button>';
  else if (k === 'sold') acts = '<button class="act dng full" id="a-unsell">إلغاء البيع</button>';
  acts += '<button class="act full" id="a-photo">' + (it.ph ? 'تغيير الصورة' : 'تصوير القطعة') + '</button>';
  sheet('<div class="big" data-ph="' + (it.ph ? it.ph + '@900' : '') + '">' + (it.ph ? '' : '<div class="no" style="color:var(--rose-d)">لا توجد صورة بعد</div>') + '</div>' +
    '<h2>' + esc(it.d) + '</h2>' + rows + '<div class="acts">' + acts + '</div>', function (el, close) {
    if (it.ph) { var key = it.ph + '@900'; if (S.photos[key]) paint(key); else { if (S.photos[it.ph + '@360']) { S.photos[key + 'tmp'] = 1; var big = $('.big', el); var im = document.createElement('img'); im.src = S.photos[it.ph + '@360']; big.appendChild(im); } wantPhoto(it.ph, 900); } }
    var on = function (id, fn) { var e = $(id, el); if (e) e.onclick = function () { close(); fn(); }; };
    on('#a-sell', function () { sellSheet(it); });
    on('#a-move', function () { chooseBoutique([it.c]); });
    on('#a-back', function () { confirmBack([it.c]); });
    on('#a-unsell', function () { confirmUnsell(it); });
    on('#a-photo', function () { photoFlow(it); });
  });
}
function after(r, okMsg) {
  if (r && r.ok) { toast(r.msg || okMsg || 'تم'); S.sel = {}; S.select = false; return loadAll(true).then(function () { return true; }); }
  toast((r && r.msg) || 'لم تتم العملية', true); return Promise.resolve(false);
}
function sellSheet(it) {
  sheet('<h2>بيع القطعة</h2><div class="sum">' + esc(it.c) + ' · ' + esc(it.d) + '<br>التكلفة ' + fmt(it.tc) + ' · السعر المعتمد ' + fmt(it.sp) + (it.loc && it.loc !== 'المخزن الرئيسي' ? '<br>في ' + esc(it.loc) + ' — يُستلم المبلغ منه' : '') + '</div>' +
    '<div class="f"><label>سعر البيع الفعلي (ر.ع)</label><input id="pr" type="number" inputmode="decimal" step="0.001" value="' + it.sp + '"></div>' +
    '<div class="sum" id="pf"></div><button class="act pri" style="width:100%" id="ok">تأكيد البيع</button>', function (el, close) {
    var pr = $('#pr', el); function upd() { var p = Number(pr.value) || 0; $('#pf', el).textContent = 'الربح المتوقع: ' + fmt(p - it.tc) + ' ر.ع' + (p < it.sp ? ' (خصم ' + fmt(it.sp - p) + ')' : ''); } pr.oninput = upd; upd();
    $('#ok', el).onclick = function () {
      var p = Number(pr.value); if (!(p > 0)) return toast('اكتب سعراً صحيحاً', true);
      close(); api('sell', {code: it.c, price: p}).then(function (r) { if (r && r.ok && r.profit != null) r.msg += ' · الربح ' + fmt(r.profit); after(r); });
    };
  });
}
function confirmUnsell(it) {
  sheet('<h2>إلغاء البيع؟</h2><div class="sum">' + esc(it.c) + ' · ' + esc(it.d) + '<br>ستعود القطعة إلى ' + (it.loc && it.loc !== 'المخزن الرئيسي' ? esc(it.loc) : 'المخزن') + ' وتُحذف بيانات البيع.</div><button class="act dng" style="width:100%" id="ok">نعم، ألغِ البيع</button>', function (el, close) {
    $('#ok', el).onclick = function () { close(); api('unsell', {code: it.c}).then(after); };
  });
}
function chooseBoutique(codes) {
  var names = (S.meta && S.meta.boutiques) || [];
  sheet('<h2>نقل ' + codes.length + ' قطعة إلى</h2><div class="bts" id="bts">' + names.map(function (n) { return '<button class="chip" data-n="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>' +
    '<div class="f" style="margin-top:12px"><label>أو اكتب اسم بوتيك جديد</label><input id="nn" placeholder="اسم البوتيك"></div><button class="act pri" style="width:100%" id="ok">نقل</button>', function (el, close) {
    var pick = '';
    $$('#bts .chip', el).forEach(function (c) { c.onclick = function () { pick = c.getAttribute('data-n'); $('#nn', el).value = ''; $$('#bts .chip', el).forEach(function (x) { x.classList.toggle('on', x === c); }); }; });
    $('#nn', el).oninput = function () { pick = ''; $$('#bts .chip', el).forEach(function (x) { x.classList.remove('on'); }); };
    $('#ok', el).onclick = function () {
      var name = pick || $('#nn', el).value.trim(); if (!name) return toast('اختر البوتيك', true);
      close(); api('move', {codes: codes, boutique: name}).then(after);
    };
  });
}
function confirmBack(codes) {
  sheet('<h2>إرجاع ' + codes.length + ' قطعة؟</h2><div class="sum">ستعود إلى المخزن الرئيسي.</div><button class="act pri" style="width:100%" id="ok">نعم، أرجعها</button>', function (el, close) {
    $('#ok', el).onclick = function () { close(); api('back', {codes: codes}).then(after); };
  });
}
function photoFlow(it) {
  pickPhoto().then(function (data) {
    if (!data) return;
    sheet('<h2>حفظ الصورة</h2><div class="photo-btn" style="aspect-ratio:3/4;max-height:48dvh"><img src="' + data + '"></div>' +
      '<label class="row-ck"><input type="checkbox" id="same" checked> تطبيقها على كل القطع المشابهة بنفس الوصف وبدون صورة</label>' +
      '<div class="acts"><button class="act" id="re">إعادة التصوير</button><button class="act pri" id="ok">حفظ</button></div>', function (el, close) {
      $('#re', el).onclick = function () { close(); photoFlow(it); };
      $('#ok', el).onclick = function () {
        var same = $('#same', el).checked; close();
        api('setPhoto', {code: it.c, photo: data, same: same}).then(function (r) { if (r && r.ok && it.ph) { idbDel(it.ph + '@360'); idbDel(it.ph + '@900'); } after(r); });
      };
    });
  });
}

/* ---------- add menu ---------- */
function openAdd() {
  sheet('<h2>ماذا تريد أن تسجّل؟</h2><div class="menu">' +
    '<button id="x1"><span class="i">＋</span><div>قطعة جديدة<small>تصوير وإضافة للمخزون</small></div></button>' +
    '<button id="x2"><span class="i">−</span><div>مصروف تشغيلي<small>إيجار، تغليف، توصيل…</small></div></button>' +
    '<button id="x3"><span class="i">↓</span><div>استلام نقد<small>من بوتيك أو من حسابك الشخصي</small></div></button>' +
    '<button id="x4"><span class="i">↑</span><div>سحب شخصي<small>خارج الأرباح</small></div></button></div>', function (el, close) {
    $('#x1', el).onclick = function () { close(); addPieceSheet(); };
    $('#x2', el).onclick = function () { close(); expenseSheet(); };
    $('#x3', el).onclick = function () { close(); cashSheet(); };
    $('#x4', el).onclick = function () { close(); withdrawSheet(); };
  });
}
function numField(id, label, ph) { return '<div class="f"><label>' + label + '</label><input id="' + id + '" type="number" inputmode="decimal" step="0.001" placeholder="' + (ph || '') + '"></div>'; }
function addPieceSheet() {
  var ships = ((S.meta && S.meta.shipments) || []).slice().reverse();
  if (!ships.length) return toast('لا توجد شحنات. حدّث البيانات أولاً', true);
  var data = null;
  sheet('<h2>قطعة جديدة</h2><button class="photo-btn" id="ph"><div><span>📷</span>اضغط للتصوير</div></button>' +
    '<div class="f" style="margin-top:12px"><label>الشحنة</label><select id="sh">' + ships.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
    '<div class="f"><label>الوصف (الموديل واللون)</label><input id="ds" placeholder="مثال: DS984 - أزرق - تطريز زهور"></div>' +
    '<div class="f2">' + numField('by', 'سعر الشراء (ر.ع)') + numField('sp', 'سعر البيع (ر.ع)') + '</div>' +
    '<div class="f"><label>العدد (نفس القطعة)</label><input id="qt" type="number" inputmode="numeric" value="1" min="1" max="60"></div>' +
    '<button class="act pri" style="width:100%" id="ok">إضافة للمخزون</button>', function (el, close) {
    $('#ph', el).onclick = function () { pickPhoto().then(function (d) { if (d) { data = d; $('#ph', el).innerHTML = '<img src="' + d + '">'; } }); };
    $('#ok', el).onclick = function () {
      var o = {ship: $('#sh', el).value, desc: $('#ds', el).value.trim(), buy: Number($('#by', el).value), sale: Number($('#sp', el).value), qty: Number($('#qt', el).value) || 1, photo: data};
      if (!o.desc) return toast('اكتب الوصف', true);
      if (!(o.buy > 0) || !(o.sale > 0)) return toast('اكتب سعر الشراء والبيع', true);
      close(); api('addPiece', o).then(after);
    };
  });
}
function expenseSheet() {
  var cat = '';
  sheet('<h2>مصروف تشغيلي</h2>' + numField('am', 'المبلغ (ر.ع)') + '<div class="f"><label>النوع</label><div class="cats" id="ct">' + C.EXPENSE_CATS.map(function (c) { return '<button class="chip" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
    '<div class="f"><label>ملاحظة (اختياري)</label><input id="nt"></div><button class="act pri" style="width:100%" id="ok">تسجيل المصروف</button>', function (el, close) {
    $$('#ct .chip', el).forEach(function (c) { c.onclick = function () { cat = c.getAttribute('data-c'); $$('#ct .chip', el).forEach(function (x) { x.classList.toggle('on', x === c); }); }; });
    $('#ok', el).onclick = function () {
      var a = Number($('#am', el).value); if (!(a > 0)) return toast('اكتب المبلغ', true);
      var note = $('#nt', el).value.trim(); if (!cat && !note) return toast('اختر النوع أو اكتب ملاحظة', true);
      close(); api('expense', {amount: a, cat: cat, note: note}).then(after);
    };
  });
}
function cashSheet() {
  var names = ((S.meta && S.meta.boutiques) || []).concat(['من الحساب الشخصي']);
  sheet('<h2>استلام نقد</h2>' + numField('am', 'المبلغ (ر.ع)') + '<div class="f"><label>من</label><select id="pt">' + names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '<option value="__o">جهة أخرى…</option></select></div>' +
    '<div class="f hide" id="oth"><label>اسم الجهة</label><input id="on"></div><div class="f"><label>ملاحظة (اختياري)</label><input id="nt"></div><button class="act pri" style="width:100%" id="ok">تسجيل الاستلام</button>', function (el, close) {
    $('#pt', el).onchange = function () { $('#oth', el).classList.toggle('hide', this.value !== '__o'); };
    $('#ok', el).onclick = function () {
      var a = Number($('#am', el).value), p = $('#pt', el).value; if (p === '__o') p = $('#on', el).value.trim();
      if (!(a > 0)) return toast('اكتب المبلغ', true); if (!p) return toast('اكتب الجهة', true);
      close(); api('cash', {amount: a, party: p, note: $('#nt', el).value.trim()}).then(after);
    };
  });
}
function withdrawSheet() {
  sheet('<h2>سحب شخصي</h2><div class="sum">يُخصم من نقد المشروع ولا يدخل في المصروفات ولا الأرباح.</div>' + numField('am', 'المبلغ (ر.ع)') + '<div class="f"><label>ملاحظة (اختياري)</label><input id="nt"></div><button class="act pri" style="width:100%" id="ok">تسجيل السحب</button>', function (el, close) {
    $('#ok', el).onclick = function () {
      var a = Number($('#am', el).value); if (!(a > 0)) return toast('اكتب المبلغ', true);
      close(); api('withdraw', {amount: a, note: $('#nt', el).value.trim()}).then(after);
    };
  });
}

/* ---------- start ---------- */
if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); }); }
render();
if (S.token) loadAll(true);
document.addEventListener('visibilitychange', function () { if (!document.hidden && S.token && Date.now() - S.stamp > 60000) loadAll(true); });
})();
