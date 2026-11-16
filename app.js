(function () {
'use strict';
var C = window.GZ_CONFIG;
var app = document.getElementById('app');
function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
function fmt(n) { n = Number(n) || 0; var s = n.toLocaleString('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3}); return n < 0 ? '‎' + s : s; } /* علامة اتجاه حتى تبقى إشارة السالب يسار الرقم في الصفحة العربية */
function fmt0(n) { n = Number(n) || 0; return n.toLocaleString('en-US', {maximumFractionDigits: 0}); }

var S = {
  token: ls('gz_token'), user: ls('gz_user'), name: ls('gz_name'), tab: 'home',
  dash: null, inv: null, meta: null, stamp: 0, filter: 'all', q: '', select: false, sel: {}, photos: {}
};
try { S.dash = JSON.parse(ls('gz_dash') || 'null'); S.inv = JSON.parse(ls('gz_inv') || 'null'); S.meta = JSON.parse(ls('gz_meta') || 'null'); S.goals = JSON.parse(ls('gz_goals') || 'null'); S.stamp = Number(ls('gz_stamp') || 0); } catch (e) {}

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
    var done = false;
    function take(cam, close) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      if (cam) inp.setAttribute('capture', 'environment');
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return res(null);
        done = true; busy(true); compress(f).then(function (d) { busy(false); res(d); }).catch(function () { busy(false); toast('تعذر قراءة الصورة', true); res(null); });
      };
      inp.click(); close();
    }
    sheet('<h2>مصدر الصورة</h2><div class="menu"><button id="pc"><span class="i">◉</span><div>الكاميرا<small>تصوير القطعة الآن</small></div></button>' +
      '<button id="pg"><span class="i">▣</span><div>الاستوديو<small>اختيار صورة من الهاتف</small></div></button></div>', function (el, close) {
      $('#pc', el).onclick = function () { take(true, close); };
      $('#pg', el).onclick = function () { take(false, close); };
      el.parentNode.addEventListener('click', function (e) { if (e.target === el.parentNode && !done) res(null); });
    });
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
  return Promise.all([api('dash', null, {silent: true}), api('inv', null, {silent: true}), api('meta', null, {silent: true}), api('goals', null, {silent: true}), api('plan', null, {silent: true})]).then(function (a) {
    if (a[4] && a[4].ok) { S.plan = a[4]; }
    if (a[3] && a[3].ok) { S.goals = a[3]; ls('gz_goals', JSON.stringify(a[3])); }
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
    '<div class="nav nav6"><button data-t="home"><span class="i">⌂</span>الرئيسية</button>' +
    '<button data-t="goals"><span class="i">★</span>الأهداف</button>' +
    '<button data-t="recon"><span class="i">✓</span>السبت<em class="dot hide" id="rdot"></em></button>' +
    '<button class="plus" id="plus"><span>+</span></button>' +
    '<button data-t="inv"><span class="i">▦</span>المخزون</button>' +
    '<button data-t="sup"><span class="i">⇅</span>المورد</button></div>';
  $$('.nav [data-t]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-t'); S.select = false; S.sel = {}; renderBody(); window.scrollTo(0, 0); }; });
  $('#plus').onclick = openAdd; $('#rf').onclick = refreshBtn; $('#mn').onclick = openMenu;
  renderBody();
}
function renderBody() {
  if (!S.token || !$('#body')) return;
  $$('.nav [data-t]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === S.tab); });
  $('#ttl').textContent = S.tab === 'home' ? ('أهلاً ' + (S.name || '')) : S.tab === 'goals' ? 'الأهداف والخطة' : S.tab === 'recon' ? 'مطابقة السبت' : S.tab === 'sup' ? 'المورد' : 'المخزون';
  var old = $('.bulk'); if (old) old.remove();
  var rd = $('#rdot'); if (rd) rd.classList.toggle('hide', !(S.plan && !S.plan.recon.done));
  if (S.tab === 'home') viewHome(); else if (S.tab === 'goals') viewGoals(); else if (S.tab === 'recon') viewRecon(); else if (S.tab === 'sup') viewSup(); else viewInv();
}
function openMenu() {
  sheet('<h2>' + esc(S.name || '') + '</h2><div class="menu">' +
    '<button id="m3"><span class="i">☰</span><div>سجل الحركات<small>المصروفات والنقد والمسحوبات، مع حذف ما سُجّل بالخطأ</small></div></button>' +
    '<button id="m5"><span class="i">▤</span><div>الشحنات والموردين<small>شحنة جديدة، قطع، رسوم، وصول، دفعات أسامة</small></div></button>' +
    '<button id="m6"><span class="i">❏</span><div>الأرشيف والإيصالات<small>تحويلات، فواتير مشتريات، فواتير البوتيك، مرجع وحفظ</small></div></button>' +
    '<button id="m8"><span class="i">⇄</span><div>ديون الأشخاص<small>ما اقترضته للمشروع، وسداده، وكم عليك لكل شخص</small></div></button>' +
    '<button id="m7"><span class="i">☎</span><div>عملاء البيع الآجل<small>من لم يسدد بعد، وتسجيل دفعاتهم</small></div></button>' +
    '<button id="m9"><span class="i">✓</span><div>الجرد<small>عدّ المخزن والبوتيك ومقارنته بالنظام</small></div></button>' +
    '<button id="m4"><span class="i">⚙</span><div>الإعدادات<small>بوتيك جديد، الرقم السري، ذاكرة الصور</small></div></button>' +
    '<button id="m1"><span class="i">↻</span><div>تحديث البيانات<small>سحب آخر الأرقام من الشيت</small></div></button>' +
    '<button id="m2"><span class="i">⎋</span><div>تسجيل الخروج<small>على هذا الجهاز</small></div></button></div>', function (el, close) {
    $('#m1', el).onclick = function () { close(); refreshBtn(); };
    $('#m2', el).onclick = function () { close(); logout(); };
    $('#m3', el).onclick = function () { close(); logSheet(); };
    $('#m9', el).onclick = function () { close(); countSheet(); };
    $('#m4', el).onclick = function () { close(); settingsSheet(); };
    $('#m5', el).onclick = function () { close(); shipsSheet(); };
    $('#m6', el).onclick = function () { close(); archiveSheet(); };
    $('#m7', el).onclick = function () { close(); creditSheet(); };
    $('#m8', el).onclick = function () { close(); debtsSheet(); };
  });
}

/* ---------- home ---------- */
function viewHome() {
  var d = S.dash, b = $('#body');
  if (!d) { b.innerHTML = '<div class="sk" style="height:170px"></div><div class="sk"></div><div class="sk"></div>'; return; }
  var net = d.cash + d.recv + d.stock - d.liab, m = d.month, inv = d.inv;
  var upd = S.stamp ? new Date(S.stamp).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'}) : '';
  /* ترتيب بلال (17 نوفمبر): ب1 ب2 ب6 ب7 ب8 ب3، ثم «تفاصيل أكثر» وتحته ب9 ب10 ب4. */
  var bts = d.boutiques.filter(function (x) { return !x.expo || x.pcs > 0; });
  b.innerHTML = heroAsk(d) + todayCard() +
    '<div class="grid2"><div class="tile"><div class="l">المخزون بالتكلفة</div><div class="v">' + fmt(d.stock) + '</div><div class="s">' + fmt0(inv.total.n) + ' قطعة</div></div>' +
    '<div class="tile"><div class="l">مستحق على البوتيكات</div><div class="v">' + fmt(d.recv) + '</div><div class="s">لم يُحوَّل بعد</div></div></div>' +
    homeCharts(d) + rulesCard() +
    '<button class="more" id="mor">' + (S.more ? 'إخفاء التفاصيل ⌃' : 'تفاصيل أكثر ⌄') + '<small>أرباح الأشهر · الراكد · البوتيكات والمعارض</small></button>' +
    '<div id="det"' + (S.more ? '' : ' class="hide"') + '>' +
    '<div id="mcard">' + monthCard(m) + '</div>' + slowCard() +
    '<div class="card"><h3>البوتيكات' + (bts.some(function (x) { return x.expo; }) ? ' والمعارض' : '') + '</h3>' + (bts.length ? bts.map(function (x) {
      if (x.expo) return '<div class="bt" data-b="' + esc(x.n) + '"><div><div class="n">' + esc(x.n) + ' ‹ <span class="mtag ex">معرض</span></div><div class="m">فيه ' + fmt0(x.pcs) + ' قطعة · باع ' + fmt0(x.sold) + '</div></div><div class="o">' + fmt(x.soldVal) + '<div class="m">مبيعاته نقداً</div></div></div>';
      return '<div class="bt" data-b="' + esc(x.n) + '"><div><div class="n">' + esc(x.n) + ' ‹</div><div class="m">عنده ' + fmt0(x.pcs) + ' قطعة · باع ' + fmt0(x.sold) + '</div></div><div class="o">' + fmt(x.owed) + '<div class="m">متبقٍّ عليه</div></div></div>';
    }).join('') : '<div class="empty">لا توجد بوتيكات</div>') + '</div></div>' +
    '<div class="stale">آخر تحديث ' + upd + ' · الأرقام بالريال العماني</div>';
  $$('.bt[data-b]', b).forEach(function (r) { r.onclick = function () { boutiqueSheet(r.getAttribute('data-b')); }; });
  bindGoals(b); bindCharts(b, d); bindJump(b);
  var sl = $('#slw', b); if (sl) sl.onclick = slowSheet;
  bindMonth(b, m);
  $('#mor', b).onclick = function () { S.more = !S.more; viewHome(); if (S.more) { var e = $('#det'); if (e && e.scrollIntoView) e.scrollIntoView({block: 'start', behavior: 'smooth'}); } };
}
/* الشكل 1 (اختيار بلال 17 نوفمبر): البطاقة الخمرية الأصلية، وداخلها الأسئلة بدل العناوين المحاسبية. */
function heroAsk(d) {
  var g = S.goals, mt = g ? g.month.target : 0, md = g ? g.month.done : d.month.qty, p = mt ? Math.min(1, md / mt) : 0;
  var x = monthData().cur, net = x ? x.net : d.month.net, debt = g ? g.supplier : 0;
  if (x && x.closed) { var L = monthData().list; net = L.length ? L[L.length - 1].net : net; }
  return '<div class="hero"><div class="l">كم معي؟</div><div class="v">' + fmt(d.cash) + '<small>ر.ع</small></div>' +
    (debt > 0 && d.cash < debt ? '<div class="hq">أقل من دين المورد (' + fmt0(debt) + ')</div>' : '') +
    '<div class="row2"><div><span>كم بعت هذا الشهر؟</span><b>' + fmt0(md) + (mt ? ' من ' + fmt0(mt) : ' قطعة') + '</b>' + (mt ? '<div class="hbar"><i style="width:' + Math.round(p * 100) + '%"></i></div>' : '') + '</div>' +
    '<div><span>هل الشهر رابح؟</span><b>' + (net >= 0 ? 'ربح ' : 'خسارة ') + fmt0(Math.abs(net)) + '</b><span>حتى الآن</span></div></div></div>';
}
/* «ما عليكِ اليوم»: المطابقة يوم السبت فقط أو إن تأخرت، والباقي من الأهداف (اليوم، خلال 7 أيام، أو متأخر). */
var WD = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
var MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function todayCard() {
  var P = S.plan, rows = [], L = openGoals(), today = new Date(), next = null; today.setHours(0, 0, 0, 0);
  if (P && !P.recon.done) rows.push('<div class="task" data-jump="recon" style="cursor:pointer"><span class="dot" style="background:var(--warn)"></span><span class="t">' + (P.recon.isSat ? 'اليوم السبت: مطابقة الأسبوع' : 'مطابقة السبت متأخرة (' + dmy(P.recon.due) + ')') + '</span><span class="chip on">ابدأ ‹</span></div>');
  L.forEach(function (x, i) {
    if (!x.d) return;
    var days = Math.round((new Date(x.d + 'T00:00:00') - today) / 86400000);
    if (days > 7) { if (!next || x.d < next.d) next = x; return; }
    if (rows.length >= 4) return;
    rows.push('<div class="task"><span class="dot" style="background:' + (days < 0 ? 'var(--bad)' : 'var(--wine)') + '"></span><span class="t">' + esc(x.g) + '<small>' + (days < 0 ? '<b style="color:var(--bad)">متأخر ' + (-days) + ' يوم</b>' : days === 0 ? 'اليوم' : 'بعد ' + days + ' يوم') + (x.rule && x.rneed ? ' · ' + fmt0(x.cur) + ' من ' + fmt0(x.rneed) : '') + '</small></span>' + (x.rule ? '<small class="au">تلقائي</small>' : '<button class="chip" data-gd="' + i + '">تم</button>') + '</div>');
  });
  if (!rows.length) rows.push('<div class="task"><span class="dot" style="background:var(--ok)"></span><span class="t">لا شيء مستعجل ✓' + (next ? '<small>أقرب موعد: ' + esc(next.g) + ' · ' + dmy(next.d) + '</small>' : '') + '</span></div>');
  return '<div class="card today"><h3>ما عليكِ اليوم</h3><div class="d">' + WD[today.getDay()] + ' ' + today.getDate() + ' ' + MN[today.getMonth()] + '</div>' + rows.join('') + '</div>';
}
function openGoals() { var g = S.goals; return g ? (g.goals ? g.goals.filter(function (x) { return !x.done; }) : (g.open || [])) : []; }
function bindGoals(b) {
  var L = openGoals();
  $$('button[data-gd]', b).forEach(function (r) { r.onclick = function (e) { e.stopPropagation(); goalDoneSheet(L[Number(r.getAttribute('data-gd'))]); }; });
  $$('[data-go]', b).forEach(function (r) { r.onclick = function () { S.tab = 'goals'; renderBody(); window.scrollTo(0, 0); }; });
}
function goalsTop() {
  var g = S.goals; if (!g) return '';
  var al = goalAlerts(g), p = g.plan || {}, L = openGoals().slice(0, 3);
  return '<div class="card" style="border:2px solid var(--wine)"><h3>★ أهدافي</h3>' +
    (p.vision ? '<div class="sum" style="margin-bottom:8px"><b>' + esc(p.vision) + '</b></div>' : '') +
    '<div class="stale" style="margin:-2px 0 8px">' + esc(g.stage) + '</div>' +
    (al.length ? al.map(function (t) { return '<div class="sum" style="background:#FBE9EA;color:var(--bad);margin-bottom:8px">⚠ ' + esc(t) + '</div>'; }).join('') : '') +
    '<div class="kv"><span>هدف الشهر</span><b>' + fmt0(g.month.done) + ' من ' + fmt0(g.month.target) + ' قطعة · ' + Math.round(g.month.pct * 100) + '%</b></div>' + pbar(g.month.pct) +
    '<div class="stale" style="margin:-2px 0 6px">مضى ' + Math.round(g.elapsed * 100) + '% من الشهر</div>' +
    goal2027Line(g) +
    (/2027/.test(g.period.label || '') ? '' : '<div class="kv"><span>' + esc(/التجربة/.test(g.period.label || '') ? 'هدف التجربة' : 'هدف الفترة') + '</span><b>' + fmt0(g.period.done) + ' من ' + fmt0(g.period.target) + ' · ' + Math.round(g.period.pct * 100) + '%</b></div>' + pbar(g.period.pct, 'var(--gold)')) +
    (L.length ? '<div style="margin-top:8px;font-weight:700">أقرب الأهداف</div>' + L.map(function (x, i) { return goalRow(x, i); }).join('') : '<div class="empty">لا أهداف مفتوحة</div>') +
    '<button class="chip" data-go="1" style="margin-top:10px">كل الأهداف والخطة ‹</button></div>';
}
/* النسخة 27: هدف 2027 = مجموع أهداف أشهر 2027 فقط في ورقة الأهداف (بلا نوفمبر وديسمبر 2026)، والمحقق منها. */
function goal2027Line(g) {
  var T = 0, C = 0; (g.months || []).forEach(function (m) { if (String(m.m).slice(0, 4) !== '2027') return; T += m.t || 0; C += m.c || 0; });
  return T ? '<div class="kv"><span>هدف 2027</span><b>' + fmt0(C) + ' من ' + fmt0(T) + ' قطعة · ' + Math.round(C / T * 100) + '%</b></div>' + pbar(C / T, 'var(--wine)') : '';
}
function dueAlerts() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var out = [];
  openGoals().forEach(function (x) {
    if (!x.d) return;
    var dd = new Date(x.d + 'T00:00:00'), days = Math.round((dd - today) / 86400000);
    if (days < 0) out.push({late: true, t: 'متأخر ' + (-days) + ' يوم: ' + x.g});
    else if (days <= 3) out.push({late: false, t: (days === 0 ? 'اليوم: ' : 'بعد ' + days + ' يوم: ') + x.g});
  });
  return out;
}
function homeGoals() {
  var g = S.goals; if (!g) return '';
  var da = dueAlerts();
  var p = g.plan || {}, mo = g.months || [], T = 0, C = 0;
  mo.forEach(function (m) { if (String(m.m).slice(0, 4) !== '2027') return; T += m.t || 0; C += m.c || 0; }); /* هدف 2027 فقط، بلا نوفمبر وديسمبر 2026 */
  var all = g.goals || [], dn = all.filter(function (x) { return x.done; }).length;
  var gate = p.gate_title ? (p.gate_title + ': ' + fmt0(g.gate1 || 0) + ' من 7 قطع في بوتيك ثانٍ') : '';
  return '<div class="card" data-go="1" style="border:2px solid var(--wine);cursor:pointer"><h3>★ رؤيتنا وأهداف السنة</h3>' +
    da.map(function (a) { return '<div class="sum" style="margin-bottom:6px;background:' + (a.late ? '#FBE9EA' : '#FFF4DC') + ';color:' + (a.late ? 'var(--bad)' : '#7A5A00') + '">⏰ ' + esc(a.t) + '</div>'; }).join('') +
    (p.vision ? '<div class="sum" style="margin-bottom:10px"><b>' + esc(p.vision) + '</b>' + (g.msg ? '<br><span style="font-size:13px">' + esc(g.msg) + '</span>' : '') + '</div>' : (g.msg ? '<div class="sum" style="margin-bottom:10px">' + esc(g.msg) + '</div>' : '')) +
    (T ? '<div class="kv"><span>هدف 2027</span><b>' + fmt0(C) + ' من ' + fmt0(T) + ' قطعة</b></div>' + pbar(C / T) : '') +
    '<div class="kv"><span>هدف الشهر</span><b>' + fmt0(g.month.done) + ' من ' + fmt0(g.month.target) + ' قطعة</b></div>' + pbar(g.month.pct) +
    '<div class="kv"><span>هدف التجربة</span><b>' + fmt0(g.period.done) + ' من ' + fmt0(g.period.target) + ' قطعة</b></div>' + pbar(g.period.pct, 'var(--gold)') +
    (gate ? '<div class="kv"><span>البوابة</span><b>' + esc(gate) + '</b></div>' : '') +
    (all.length ? '<div class="kv"><span>أهداف منجزة</span><b>' + dn + ' من ' + all.length + '</b></div>' : '') +
    '<div class="stale" style="margin-top:8px">للعرض فقط · اضغط لفتح صفحة الأهداف ‹</div></div>';
}
function goalRow(x, i) {
  var late = !x.done && x.d && x.d < new Date().toISOString().slice(0, 10);
  var prog = (x.rule && x.rneed) ? ' · ' + fmt0(x.cur) + '/' + fmt0(x.rneed) : '';
  return '<div class="bt"><div><div class="n">' + (x.done ? '✓ ' : '') + esc(x.g) + '</div><div class="m">' + (late ? '<span style="color:var(--bad)">متأخر · </span>' : '') + esc(x.d || 'بلا موعد') + ' · ' + esc(x.who || '') + prog + (x.auto ? ' · تلقائي' : '') + '</div></div>' +
    '<div class="o">' + (x.done ? '' : x.rule ? '<div class="m">تلقائي</div>' : (i >= 0 ? '<button class="chip" data-gd="' + i + '">تم</button>' : '')) + '</div></div>';
}
function viewGoals() {
  var g = S.goals, b = $('#body');
  if (!g) { b.innerHTML = '<div class="sk" style="height:170px"></div><div class="sk"></div>'; return; }
  var p = g.plan || {}, all = g.goals || [], open = all.filter(function (x) { return !x.done; }), done = all.filter(function (x) { return x.done; });
  var gates = [1, 2, 3, 4].map(function (n) { return p['gate' + n] ? [n, p['gate' + n]] : null; }).filter(Boolean);
  b.innerHTML = goalsTop().replace(/<button class="chip" data-go[^>]*>.*?<\/button>/, '') +
    (p.mission || p.direction || p.frank ? '<div class="card"><h3>الرؤية والاتجاه</h3>' +
      (p.mission ? '<div class="kv"><span>الرسالة</span><b>' + esc(p.mission) + '</b></div>' : '') +
      (p.values ? '<div class="kv"><span>القيم</span><b>' + esc(p.values) + '</b></div>' : '') +
      (p.direction ? '<div class="kv"><span>الاتجاه</span><b>' + esc(p.direction) + '</b></div>' : '') +
      (p.frank ? '<div class="sum" style="margin-top:8px">' + esc(p.frank) + '</div>' : '') + '</div>' : '') +
    (gates.length ? '<div class="card"><h3>' + esc(p.gate_title || 'بوابة 31 ديسمبر') + '</h3>' + gates.map(function (x) {
      var t = x[1] + (x[0] === 1 ? ' — الآن: ' + fmt0(g.gate1 || 0) + ' من 7' : '');
      return '<div class="kv"><span>' + (x[0] === 1 && (g.gate1 || 0) >= 7 ? '✓' : '○') + '</span><b>' + esc(t) + '</b></div>';
    }).join('') + (p.gate_note ? '<div class="stale" style="margin-top:8px">' + esc(p.gate_note) + '</div>' : '') + '</div>' : '') +
    coverCard() +
    '<div class="card"><h3>كل الأهداف المفتوحة (' + open.length + ')</h3>' + (open.length ? open.map(function (x, i) { return goalRow(x, i); }).join('') : '<div class="empty">لا أهداف مفتوحة</div>') + '</div>' +
    (done.length ? '<div class="card"><h3>المنجزة (' + done.length + ')</h3>' + done.map(function (x) { return goalRow(x, -1); }).join('') + '</div>' : '') +
    barsCard() +
    (g.months && g.months.length ? '<div class="card"><h3>المسار الشهري (نوفمبر 2026 - ديسمبر 2027)</h3>' + g.months.map(function (m) {
      return '<div class="kv"><span>' + esc(m.m) + '</span><b>' + fmt0(m.c) + ' / ' + fmt0(m.t) + '</b></div>';
    }).join('') + '</div>' : '') +
    '<div class="card"><h3>ملخص الشهر</h3>' + g.summary.map(function (t) { return '<div class="stale">' + esc(t) + '</div>'; }).join('') + '</div>';
  bindGoals(b); if (S.dash) bindCharts(b, S.dash);
}
function pbar(p, c) { p = Math.max(0, Math.min(1, p || 0)); return '<div style="height:10px;background:#EADCDD;border-radius:6px;overflow:hidden;margin:6px 0"><div style="height:100%;width:' + Math.round(p * 100) + '%;background:' + (c || 'var(--wine)') + '"></div></div>'; }
function goalAlerts(g) {
  var out = [];
  if (g.supplier > 0 && g.cash < g.supplier) out.push('النقد (' + fmt(g.cash) + ') أقل من دين المورد (' + fmt(g.supplier) + '). لا تُدفع أقساط الشقة من نقد المشروع الآن.');
  if (S.inv && S.inv.items) {
  }
  return out;
}
function goalsCard() {
  var g = S.goals; if (!g) return '';
  var al = goalAlerts(g);
  return '<div class="card"><h3>لوحة الأهداف</h3><div class="stale" style="margin:-6px 0 8px">' + esc(g.stage) + '</div>' +
    (al.length ? al.map(function (t) { return '<div class="sum" style="background:#FBE9EA;color:var(--bad);margin-bottom:8px">⚠ ' + esc(t) + '</div>'; }).join('') : '') +
    '<div class="kv"><span>هدف الشهر</span><b>' + fmt0(g.month.done) + ' من ' + fmt0(g.month.target) + ' قطعة · ' + Math.round(g.month.pct * 100) + '%</b></div>' + pbar(g.month.pct) +
    '<div class="stale" style="margin:-2px 0 6px">مضى ' + Math.round(g.elapsed * 100) + '% من الشهر</div>' +
    goal2027Line(g) +
    (/2027/.test(g.period.label || '') ? '' : '<div class="kv"><span>' + esc(/التجربة/.test(g.period.label || '') ? 'هدف التجربة' : 'هدف الفترة') + '</span><b>' + fmt0(g.period.done) + ' من ' + fmt0(g.period.target) + ' · ' + Math.round(g.period.pct * 100) + '%</b></div>' + pbar(g.period.pct, 'var(--gold)')) +
    '<div class="kv"><span>مبيعات الشهر</span><b>' + fmt(g.sales) + '</b></div><div class="kv"><span>صافي ربح الشهر</span><b class="' + (g.net >= 0 ? 'pos' : 'neg') + '">' + fmt(g.net) + '</b></div>' +
    '<div class="kv"><span>النقد / دين المورد</span><b>' + fmt(g.cash) + ' / ' + fmt(g.supplier) + '</b></div><div class="kv"><span>قطع المخزون</span><b>' + fmt0(g.stock) + '</b></div>' +
    '<div class="sum" style="margin-top:10px"><b>الخطوة التالية:</b> ' + esc(g.next) + (g.nextDate ? '<br>موعدها ' + esc(g.nextDate) : '') + '<br>مطابقة النقد القادمة (السبت): ' + esc(g.sat) + '</div>' +
    '<div class="stale" style="margin-top:8px">' + esc(g.msg) + '</div>' +
    '<h3 style="margin-top:14px">الأهداف المفتوحة</h3>' + (g.open.length ? g.open.map(function (x, i) {
      return '<div class="bt"><div><div class="n">' + esc(x.g) + '</div><div class="m">' + esc(x.d || 'بلا موعد') + ' · ' + esc(x.who) + (x.need ? ' · ' + esc(x.need) : '') + '</div></div><div class="o"><button class="chip" data-gd="' + i + '">تم</button></div></div>';
    }).join('') : '<div class="empty">لا أهداف مفتوحة</div>') +
    '<details style="margin-top:10px"><summary>ملخص الشهر</summary>' + g.summary.map(function (t) { return '<div class="stale">' + esc(t) + '</div>'; }).join('') + '</details></div>';
}
function goalDoneSheet(x) {
  sheet('<h2>تعليم الهدف منجزاً؟</h2><div class="sum">' + esc(x.g) + '</div><button class="act pri" style="width:100%" id="ok">نعم، تم</button>', function (el, close) {
    $('#ok', el).onclick = function () { close(); api('goalDone', {goal: x.g}).then(function (r) { res3(r); }); };
  });
}

/* ---------- inventory ---------- */
var STATUS = {'في المخزن': ['main', 'مخزن'], 'في البوتيك': ['bt', 'بوتيك'], 'مباع': ['sold', 'مباع'], 'في الطريق': ['tr', 'في الطريق']};
function stKey(it) { return (STATUS[it.st] || ['main'])[0]; }
function viewInv() {
  var b = $('#body'), inv = S.inv;
  if (!inv) { b.innerHTML = '<div class="sk" style="height:60px"></div><div class="sk" style="height:300px"></div>'; return; }
  /* الفلاتر بأسماء الأماكن: كل بوتيك أو معرض فيه قطع يظهر باسمه، و«في الطريق» يظهر فقط إن كان فيه شيء. */
  var items = inv.items, cnt = {all: items.length, main: 0, bt: 0, sold: 0, tr: 0}, locs = [], EX = (S.meta && S.meta.expos) || [];
  items.forEach(function (i) { cnt[stKey(i)]++; if (stKey(i) === 'bt') { var k = 'L:' + (i.loc || '؟'); if (cnt[k] == null) { cnt[k] = 0; locs.push(i.loc || '؟'); } cnt[k]++; } });
  var F = [['all', 'الكل'], ['main', 'المخزن']].concat(locs.map(function (l) { return ['L:' + l, (EX.indexOf(l) >= 0 ? '◆ ' : '') + l]; }), [['sold', 'مباع']], cnt.tr ? [['tr', 'في الطريق']] : []);
  if (!F.some(function (f) { return f[0] === S.filter; })) S.filter = 'all';
  var lf = S.filter.indexOf('L:') === 0 ? S.filter.slice(2) : '';
  b.innerHTML = '<div class="search"><input id="q" type="search" placeholder="ابحث بالكود أو الوصف أو اللون" value="' + esc(S.q) + '"><button id="sl" class="' + (S.select ? 'on' : '') + '">' + (S.select ? 'إلغاء' : 'تحديد') + '</button></div>' +
    '<div class="chips">' + F.map(function (f) { return '<button class="chip ' + (S.filter === f[0] ? 'on' : '') + '" data-f="' + f[0] + '">' + f[1] + '<i>' + cnt[f[0]] + '</i></button>'; }).join('') + '</div>' +
    (lf ? '<button class="act" style="width:100%;margin-bottom:10px" id="lopen">صفحة ' + esc(lf) + ' (بيع، إرجاع، نقل' + (EX.indexOf(lf) >= 0 ? '، إنهاء المعرض' : '') + ') ‹</button>' : '') +
    '<div class="items" id="items"></div>';
  if ($('#lopen')) $('#lopen').onclick = function () { boutiqueSheet(lf); };
  $('#q').oninput = function () { S.q = this.value; fillItems(); };
  $('#sl').onclick = function () { S.select = !S.select; S.sel = {}; renderBody(); };
  $$('.chip').forEach(function (c) { c.onclick = function () { S.filter = c.getAttribute('data-f'); renderBody(); }; });
  fillItems();
}
function fillItems() {
  var box = $('#items'); if (!box || !S.inv) return;
  var q = S.q.trim().toLowerCase(), order = {main: 0, bt: 1, tr: 2, sold: 3};
  var list = S.inv.items.filter(function (i) {
    if (S.filter.indexOf('L:') === 0) { if (stKey(i) !== 'bt' || (i.loc || '؟') !== S.filter.slice(2)) return false; }
    else if (S.filter !== 'all' && stKey(i) !== S.filter) return false;
    if (!q) return true;
    var mi = i.m ? modelInfo(i.m) : {}, cs = i.m ? ((S.inv.colors || []).filter(function (c) { return c.m === i.m; }).map(function (c) { return c.c; }).join(' ')) : '';
    return (i.c + ' ' + i.d + ' ' + i.s + ' ' + (i.loc || '') + ' ' + (i.m || '') + ' ' + (mi.n || '') + ' ' + (mi.t || '') + ' ' + cs).toLowerCase().indexOf(q) >= 0;
  }).sort(function (a, b) { return order[stKey(a)] - order[stKey(b)]; });
  if (!list.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">لا توجد قطع مطابقة</div>'; updateBulk(); return; }
  var useM = !S.select && S.inv.models && S.inv.models.length, mHtml = useM ? modelCards(list) : '';
  if (useM) list = list.filter(function (i) { return !i.m; });
  var groups = [], gm = {};
  list.forEach(function (i) {
    var key = [i.d, i.st, i.loc || '', i.sp, i.ap || '', i.sd || '', i.ch || ''].join('|');
    if (!gm[key]) { gm[key] = {k: key, items: []}; groups.push(gm[key]); }
    gm[key].items.push(i);
  });
  S.groups = {}; groups.forEach(function (g, n) { g.id = 'g' + n; S.groups[g.id] = g; });
  box.innerHTML = mHtml + groups.map(function (g) {
    var i = g.items[0], n = g.items.length, k = stKey(i), price = k === 'sold' ? i.ap : i.sp;
    var sel = g.items.filter(function (x) { return S.sel[x.c]; }).length;
    return '<button class="it' + (sel ? ' sel' : '') + '" data-g="' + g.id + '"><div class="ph" data-ph="' + (i.ph ? i.ph + '@360' : '') + '" data-id="' + esc(i.ph) + '">' +
      (i.ph ? '' : '<div class="no"><b>✦</b>بدون صورة</div>') + '</div>' +
      '<span class="badge b-' + k + '">' + (k === 'bt' && i.loc ? esc(i.loc) : STATUS[i.st] ? STATUS[i.st][1] : esc(i.st)) + '</span>' +
      (n > 1 ? '<span class="badge" style="top:56px;inset-inline-start:auto;inset-inline-end:8px;background:var(--wine);color:#fff">× ' + n + '</span>' : '') +
      (S.select && k !== 'sold' && k !== 'tr' ? '<span class="ck">' + (sel ? (n > 1 ? sel + '/' + n : '✓') : '') + '</span>' : '') +
      '<div class="bd"><div class="cd">' + esc(n > 1 ? i.c + ' وما بعده' : i.c) + '</div><div class="ds">' + esc(i.d) + '</div><div class="pr">' + fmt(price) + ' ر.ع</div></div></button>';
  }).join('');
  $$('.it[data-m]', box).forEach(function (el) {
    el.onclick = function () { modelSheet(el.getAttribute('data-m')); };
    var ph = $('.ph', el), id = ph.getAttribute('data-id');
    if (id) { if (S.photos[id + '@360']) paint(id + '@360'); else if (io) io.observe(ph); else wantPhoto(id, 360); }
  });
  $$('.it[data-g]', box).forEach(function (el) {
    var g = S.groups[el.getAttribute('data-g')], n = g.items.length;
    el.onclick = function () {
      var k = stKey(g.items[0]);
      if (S.select) {
        if (k === 'sold' || k === 'tr') return;
        var cur = g.items.filter(function (x) { return S.sel[x.c]; }).length, nx = cur >= n ? 0 : cur + 1;
        g.items.forEach(function (x, j) { if (j < nx) S.sel[x.c] = 1; else delete S.sel[x.c]; });
        el.classList.toggle('sel', nx > 0); var ck = $('.ck', el); if (ck) ck.textContent = nx ? (n > 1 ? nx + '/' + n : '✓') : ''; updateBulk();
      } else if (n === 1) openItem(g.items[0].c);
      else groupSheet(g);
    };
    var ph = $('.ph', el), id = ph.getAttribute('data-id');
    if (id) { if (S.photos[id + '@360']) paint(id + '@360'); else if (io) io.observe(ph); else wantPhoto(id, 360); }
  });
  updateBulk();
}
function groupSheet(g) {
  sheet('<h2>' + esc(g.items[0].d) + '</h2><div class="stale" style="margin:-6px 0 10px">' + g.items.length + ' قطعة · اضغط قطعة لفتحها</div>' +
    g.items.map(function (x) { return '<div class="bt" data-c="' + esc(x.c) + '"><div><div class="n">' + esc(x.c) + ' ‹</div></div><div class="o">' + fmt(stKey(x) === 'sold' ? x.ap : x.sp) + '</div></div>'; }).join(''), function (el, close) {
    $$('.bt[data-c]', el).forEach(function (r) { r.onclick = function () { close(); openItem(r.getAttribute('data-c')); }; });
  });
}
function byCode(c) { return (S.inv ? S.inv.items : []).filter(function (i) { return i.c === c; })[0]; }
function updateBulk() {
  var old = $('.bulk'); if (old) old.remove();
  var n = Object.keys(S.sel).length; if (!S.select || !n) return;
  var d = document.createElement('div'); d.className = 'bulk';
  d.innerHTML = '<div class="c">' + n + ' محددة</div><button id="bs">بيع</button><button id="bm">نقل</button><button id="bb">إرجاع</button><button id="bi">فاتورة</button><button class="g" id="bx">مسح</button>';
  document.body.appendChild(d);
  $('#bs').onclick = function () {
    var items = Object.keys(S.sel).map(byCode).filter(Boolean);
    pickPieces({title: 'بيع ' + items.length + ' قطعة', items: items, withPrice: true, all: true, label: 'تسجيل البيع', run: runSellMany});
  };
  $('#bm').onclick = function () { chooseBoutique(Object.keys(S.sel)); };
  $('#bb').onclick = function () { confirmBack(Object.keys(S.sel)); };
  $('#bi').onclick = function () { var l = Object.keys(S.sel).map(byCode).filter(function (i) { return i && i.st === 'مباع'; }); if (!l.length) return toast('حدّد قطعاً مباعة لإصدار فاتورة', true); invoiceSheet(l); };
  $('#bx').onclick = function () { S.sel = {}; fillItems(); };
}

/* ---------- models ---------- */
var MAIN = 'المخزن الرئيسي';
function modelInfo(m) { return ((S.inv && S.inv.models) || []).filter(function (x) { return x.m === m; })[0] || {m: m, n: '', t: ''}; }
function modelStats(m) {
  var items = S.inv.items.filter(function (i) { return i.m === m; }), loc = {}, sold = 0, tr = 0, first = null;
  items.forEach(function (i) {
    if (!first || (!first.ph && i.ph)) first = i;
    var k = stKey(i);
    if (k === 'sold') sold++; else if (k === 'tr') tr++;
    else { var l = k === 'main' ? MAIN : (i.loc || '؟'); loc[l] = (loc[l] || 0) + 1; }
  });
  var cols = {}; ((S.inv.colors) || []).forEach(function (c) { if (c.m === m) { (cols[c.l] = cols[c.l] || []).push({c: c.c, n: c.n}); } });
  var bad = Object.keys(loc).filter(function (l) { var s = (cols[l] || []).reduce(function (a, x) { return a + x.n; }, 0); return s !== loc[l]; });
  var locs = Object.keys(loc).sort(function (a, b) { return a === MAIN ? -1 : b === MAIN ? 1 : 0; });
  return {m: m, items: items, loc: loc, locs: locs, sold: sold, tr: tr, first: first, cols: cols, bad: bad, total: items.length};
}
function colTxt(arr) { return (arr || []).map(function (x) { return esc(x.c) + ' ' + x.n; }).join(' · '); }
function modelCards(list) {
  var seen = {}, ms = [], F = S.filter;
  list.forEach(function (i) { if (i.m && !seen[i.m]) { seen[i.m] = 1; ms.push(i.m); } });
  return ms.map(function (m) {
    var s = modelStats(m), inf = modelInfo(m), f = s.first || {}, cnt, lines = [], bad = false, lbl = '';
    function colsOf(ls) { var t = {}; ls.forEach(function (l) { (s.cols[l] || []).forEach(function (x) { t[x.c] = (t[x.c] || 0) + x.n; }); }); return Object.keys(t).map(function (c) { return {c: c, n: t[c]}; }); }
    function sumC(a) { return a.reduce(function (z, x) { return z + x.n; }, 0); }
    if (F === 'main' || F === 'bt' || F.indexOf('L:') === 0) {
      var ls = s.locs.filter(function (l) { return F === 'main' ? l === MAIN : F === 'bt' ? l !== MAIN : l === F.slice(2); });
      cnt = ls.reduce(function (z, l) { return z + s.loc[l]; }, 0);
      var cs = colsOf(ls); bad = sumC(cs) !== cnt;
      if (F === 'bt') ls.forEach(function (l) { lines.push(esc(l) + ' ' + s.loc[l]); });
      lines.push(colTxt(cs) || 'لا ألوان مسجلة'); lbl = cnt + ' قطعة';
    } else if (F === 'sold') { cnt = s.sold; lbl = cnt + ' مباع'; }
    else if (F === 'tr') { cnt = s.tr; lbl = cnt + ' في الطريق'; }
    else {
      cnt = s.total - s.sold; bad = s.bad.length > 0; lbl = cnt + ' قطعة';
      s.locs.forEach(function (l) { lines.push((l === MAIN ? 'مخزن' : esc(l)) + ' ' + s.loc[l]); });
      if (s.tr) lines.push('في الطريق ' + s.tr); if (s.sold) lines.push('مباع ' + s.sold);
    }
    return '<button class="it" data-m="' + esc(m) + '"><div class="ph" data-ph="' + (f.ph ? f.ph + '@360' : '') + '" data-id="' + esc(f.ph || '') + '">' + (f.ph ? '' : '<div class="no"><b>✦</b>بدون صورة</div>') + '</div>' +
      '<span class="badge" style="background:var(--wine);color:#fff">' + lbl + '</span>' + (bad ? '<span class="badge" style="top:56px;inset-inline-start:auto;inset-inline-end:8px;background:#C98A00;color:#fff">⚠ ألوان</span>' : '') +
      '<div class="bd"><div class="cd">' + esc(m) + (inf.n ? ' · ' + esc(inf.n) : '') + '</div><div class="ds">' + lines.join(' · ') + '</div><div class="pr">' + fmt(f.sp) + ' ر.ع</div></div></button>';
  }).join('');
}
function stepRow(id, label, max, v) {
  return '<div class="bt" style="align-items:center"><div class="n">' + esc(label) + '</div><div class="o" style="display:flex;gap:6px;align-items:center"><button class="chip" data-st="-1" data-for="' + id + '">−</button><b data-v="' + id + '" data-max="' + max + '" style="min-width:24px;text-align:center">' + (v || 0) + '</b><button class="chip" data-st="1" data-for="' + id + '">＋</button></div></div>';
}
function bindSteps(el, onChange) {
  $$('[data-st]', el).forEach(function (b) {
    b.onclick = function () {
      var v = $('[data-v="' + b.getAttribute('data-for') + '"]', el), max = Number(v.getAttribute('data-max')), n = Math.max(0, Math.min(max, Number(v.textContent) + Number(b.getAttribute('data-st'))));
      v.textContent = n; onChange && onChange();
    };
  });
}
function readSteps(el) { var out = []; $$('[data-v]', el).forEach(function (v) { var n = Number(v.textContent); if (n > 0) out.push({c: v.getAttribute('data-name'), n: n}); }); return out; }
function colorRows(m, loc, count, prefill) {
  var s = modelStats(m), arr = (s.cols[loc] || []).slice(), sum = arr.reduce(function (a, x) { return a + x.n; }, 0), h = '';
  arr.forEach(function (x, i) { h += stepRow('c' + i, x.c, x.n, prefill ? x.n : 0).replace('data-v="c' + i + '"', 'data-v="c' + i + '" data-name="' + esc(x.c) + '"'); });
  if (count - sum > 0) h += stepRow('cu', 'غير محدد', count - sum, prefill ? count - sum : 0).replace('data-v="cu"', 'data-v="cu" data-name="غير محدد"');
  return h;
}
function modelSheet(m) {
  var s = modelStats(m), inf = modelInfo(m);
  var h = '<h2>' + esc(m) + (inf.n ? ' · ' + esc(inf.n) : '') + '</h2><div class="stale" style="margin:-6px 0 10px">المجموع ' + s.total + ' · مباع ' + s.sold + (s.tr ? ' · في الطريق ' + s.tr : '') + '</div>';
  s.locs.forEach(function (l) {
    var sum = (s.cols[l] || []).reduce(function (a, x) { return a + x.n; }, 0), bad = sum !== s.loc[l];
    h += '<div class="card" style="margin:0 0 8px;padding:10px"><div class="kv"><span>' + esc(l) + '</span><b>' + s.loc[l] + ' قطعة</b></div><div class="stale">' + (colTxt(s.cols[l]) || 'لا ألوان مسجلة') + '</div>' +
      (bad ? '<div class="sum" style="background:#FFF3D6;margin-top:6px">⚠ مجموع الألوان ' + sum + ' والقطع ' + s.loc[l] + '</div>' : '') + '<button class="chip" style="margin-top:6px" data-ce="' + esc(l) + '">تحديث الألوان</button></div>';
  });
  h += '<div class="f"><label>اسم الموديل / النوع (للمرجع فقط)</label><input id="mn" value="' + esc(inf.n) + '"></div><div class="f"><label>ملاحظة</label><input id="mt" value="' + esc(inf.t) + '"></div><button class="act" style="width:100%;margin-bottom:10px" id="msv">حفظ الملاحظة</button>';
  var mainN = s.loc[MAIN] || 0, btN = s.locs.length - (mainN ? 1 : 0);
  h += '<div class="acts">' + (mainN ? '<button class="act pri" id="mmv">نقل لبوتيك</button>' : '') + (btN ? '<button class="act" id="mbk">إرجاع للمخزن</button>' : '') + ((mainN || btN) ? '<button class="act full" id="msl">بيع بالعدد</button>' : '') + '</div>';
  h += '<details style="margin-top:10px"><summary>القطع (' + s.total + ')</summary>' + s.items.map(function (x) { return '<div class="bt" data-c="' + esc(x.c) + '"><div><div class="n" style="direction:ltr">' + esc(x.c) + ' ‹</div><div class="m">' + esc(x.st) + (x.loc && stKey(x) === 'bt' ? ' · ' + esc(x.loc) : '') + '</div></div></div>'; }).join('') + '</details>';
  sheet(h, function (el, close) {
    $('#msv', el).onclick = function () { api('modelNote', {m: m, note: $('#mt', el).value.trim(), name: $('#mn', el).value.trim()}).then(function (r) { after(r); }); };
    $$('[data-ce]', el).forEach(function (b) { b.onclick = function () { close(); colorEditor(m, b.getAttribute('data-ce')); }; });
    $$('.bt[data-c]', el).forEach(function (r) { r.onclick = function () { close(); openItem(r.getAttribute('data-c')); }; });
    var on = function (id, fn) { var e = $(id, el); if (e) e.onclick = function () { close(); fn(); }; };
    on('#mmv', function () { modelMove(m); }); on('#mbk', function () { modelBack(m); }); on('#msl', function () { modelSell(m); });
  });
}
function colorEditor(m, loc) {
  var s = modelStats(m), cnt = s.loc[loc] || 0, arr = (s.cols[loc] || []);
  sheet('<h2>ألوان ' + esc(m) + ' في ' + esc(loc) + '</h2><div class="sum" id="cs"></div><div id="cl">' + arr.map(function (x) { return colRow(x.c, x.n); }).join('') + '</div><button class="chip" id="ca">＋ لون</button><button class="act pri" style="width:100%;margin-top:12px" id="ok">حفظ</button>', function (el, close) {
    function read() { var o = []; $$('.cr', el).forEach(function (r) { var c = $('.cn', r).value.trim(), n = Math.floor(Number($('.cv', r).value)); if (c && n > 0) o.push({c: c, n: n}); }); return o; }
    function upd() { var t = read().reduce(function (a, x) { return a + x.n; }, 0); $('#cs', el).textContent = 'مجموع الألوان ' + t + ' من ' + cnt + ' قطعة' + (t === cnt ? ' ✓' : ' ⚠'); }
    function bind() { $$('.cr input', el).forEach(function (i) { i.oninput = upd; }); $$('.cr .rm', el).forEach(function (b) { b.onclick = function () { b.parentNode.remove(); upd(); }; }); }
    $('#ca', el).onclick = function () { $('#cl', el).insertAdjacentHTML('beforeend', colRow('', '')); bind(); };
    bind(); upd();
    $('#ok', el).onclick = function () {
      var o = read(), t = o.reduce(function (a, x) { return a + x.n; }, 0);
      if (t !== cnt && !confirm('مجموع الألوان ' + t + ' لا يساوي ' + cnt + '. حفظ على أي حال؟')) return;
      close(); api('colorSet', {m: m, loc: loc, colors: o}).then(after);
    };
  });
}
function colRow(c, n) { return '<div class="cr" style="display:flex;gap:6px;margin-bottom:8px"><input class="cn" placeholder="اللون" value="' + esc(c) + '" style="flex:1"><input class="cv" type="number" inputmode="numeric" value="' + esc(n) + '" style="width:70px;text-align:center"><button class="chip rm">✕</button></div>'; }
function pickLoc(title, names, cb) {
  sheet('<h2>' + esc(title) + '</h2><div class="bts" id="bts">' + names.map(function (n) { return '<button class="chip" data-n="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>', function (el, close) {
    $$('#bts .chip', el).forEach(function (c) { c.onclick = function () { close(); cb(c.getAttribute('data-n')); }; });
  });
}
function modelMove(m) {
  var s = modelStats(m), main = s.loc[MAIN] || 0, names = (S.meta && S.meta.boutiques) || [];
  sheet('<h2>نقل ' + esc(m) + ' إلى بوتيك</h2><div class="stale">في المخزن ' + main + ' قطعة. حدّد الألوان المنقولة:</div><div id="cr">' + colorRows(m, MAIN, main, false) + '</div><div class="sum" id="cs"></div>' +
    '<div class="f"><label>البوتيك</label><div class="bts" id="bts">' + names.map(function (n) { return '<button class="chip" data-n="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div></div><div class="f"><label>أو اسم بوتيك جديد</label><input id="nn"></div><button class="act pri" style="width:100%" id="ok">نقل</button>', function (el, close) {
    var pick = ''; function upd() { var t = readSteps(el).reduce(function (a, x) { return a + x.n; }, 0); $('#cs', el).textContent = 'سيُنقل ' + t + ' قطعة'; }
    bindSteps(el, upd); upd();
    $$('#bts .chip', el).forEach(function (c) { c.onclick = function () { pick = c.getAttribute('data-n'); $('#nn', el).value = ''; $$('#bts .chip', el).forEach(function (x) { x.classList.toggle('on', x === c); }); }; });
    $('#nn', el).oninput = function () { pick = ''; $$('#bts .chip', el).forEach(function (x) { x.classList.remove('on'); }); };
    $('#ok', el).onclick = function () {
      var cl = readSteps(el), n = cl.reduce(function (a, x) { return a + x.n; }, 0), to = pick || $('#nn', el).value.trim();
      if (!n) return toast('حدّد القطع المنقولة', true); if (!to) return toast('اختر البوتيك', true);
      close(); api('modelOp', {op: 'move', m: m, n: n, to: to, colors: cl}).then(after);
    };
  });
}
function modelBack(m) {
  var s = modelStats(m), bts = s.locs.filter(function (l) { return l !== MAIN; });
  var go = function (loc) {
    var cnt = s.loc[loc];
    sheet('<h2>إرجاع ' + esc(m) + ' من ' + esc(loc) + '</h2><div class="stale">عندهم ' + cnt + ' قطعة، وكلها محددة للإرجاع بألوانها. أنقصي فقط ما سيبقى هناك.</div><div id="cr">' + colorRows(m, loc, cnt, true) + '</div><div class="sum" id="cs"></div><button class="act pri" style="width:100%" id="ok">إرجاع</button>', function (el, close) {
      function upd() { var t = readSteps(el).reduce(function (a, x) { return a + x.n; }, 0); $('#cs', el).textContent = 'سيُرجَع ' + t + ' قطعة'; }
      bindSteps(el, upd); upd();
      $('#ok', el).onclick = function () { var cl = readSteps(el), n = cl.reduce(function (a, x) { return a + x.n; }, 0); if (!n) return toast('حدّد القطع', true); close(); api('modelOp', {op: 'back', m: m, n: n, loc: loc, colors: cl}).then(after); };
    });
  };
  if (bts.length === 1) go(bts[0]); else pickLoc('إرجاع من أي بوتيك؟', bts, go);
}
function modelSell(m) {
  var s = modelStats(m);
  var go = function (loc) {
    var cnt = s.loc[loc], sp = (s.first && s.first.sp) || '', hasCol = (s.cols[loc] || []).length > 0;
    /* النسخة 26: الألوان اختيارية في البيع بالعدد. إن حُدّدت تُخصم من جدول الألوان، وإن تُركت لا يتغير الجدول. */
    sheet('<h2>بيع ' + esc(m) + ' من ' + esc(loc) + '</h2><div class="stale">المتوفر ' + cnt + ' قطعة' + (loc !== MAIN ? ' — يُستلم المبلغ منهم' : '') + '.</div>' + numField('qn', 'عدد القطع المباعة') + numField('pr', 'سعر القطعة (ر.ع)') +
      (hasCol ? '<div class="f"><label>الألوان المباعة (اختياري)</label><div class="stale" style="margin:0 0 6px;text-align:start">إن حدّدتِها تُخصم من جدول الألوان. يمكن تركها.</div><div id="cr">' + colorRows(m, loc, cnt, false) + '</div><div class="sum" id="cs"></div></div>' : '') +
      '<div class="f"><label>التاريخ (اختياري)</label><input id="dt" type="date"></div><button class="act pri" style="width:100%" id="ok">تسجيل البيع</button>', function (el, close) {
      $('#qn', el).value = 1; $('#pr', el).value = sp;
      if (hasCol) { var upd = function () { var t = readSteps(el).reduce(function (a, x) { return a + x.n; }, 0); $('#cs', el).textContent = t ? 'ألوان محددة: ' + t + ' قطعة' : 'لم تُحدَّد ألوان'; }; bindSteps(el, upd); upd(); }
      $('#ok', el).onclick = function () {
        var n = Math.floor(Number($('#qn', el).value)), p = Number($('#pr', el).value), cl = hasCol ? readSteps(el) : [], ct = cl.reduce(function (a, x) { return a + x.n; }, 0);
        if (!(n >= 1) || n > cnt) return toast('العدد من 1 إلى ' + cnt, true); if (!(p > 0)) return toast('اكتب السعر', true);
        if (ct && ct !== n) return toast('مجموع الألوان ' + ct + ' لا يساوي عدد القطع ' + n, true);
        var q = {op: 'sell', m: m, n: n, loc: loc, price: p, date: $('#dt', el).value};
        if (ct) q.colors = cl;
        close();
        lateEdit(String(q.date || '').slice(0, 7), 'تسجيل بيع بتاريخ في ذلك الشهر', function (late) {
          q.late = late;
          api('modelOp', q).then(after);
        });
      };
    });
  };
  if (s.locs.length === 1) go(s.locs[0]); else pickLoc('البيع من أين؟', s.locs, go);
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
  if (k === 'main') acts = '<button class="act pri" id="a-sell">بيع</button><button class="act" id="a-move">نقل لبوتيك</button><button class="act full" id="a-gift">تسجيل كهدية (بدون بيع)</button>';
  else if (k === 'bt') acts = '<button class="act pri" id="a-sell">بيع</button><button class="act" id="a-back">إرجاع للمخزن</button><button class="act full" id="a-move">نقل لبوتيك آخر</button>';
  else if (k === 'sold') acts = '<button class="act pri full" id="a-inv">إصدار فاتورة للعميل</button><button class="act dng full" id="a-unsell">إلغاء البيع</button>';
  acts += '<button class="act" id="a-edit">تعديل الوصف والسعر</button><button class="act" id="a-photo">' + (it.ph ? 'تغيير الصورة' : 'تصوير القطعة') + '</button>';
  sheet('<div class="big" data-ph="' + (it.ph ? it.ph + '@900' : '') + '">' + (it.ph ? '' : '<div class="no" style="color:var(--rose-d)">لا توجد صورة بعد</div>') + '</div>' +
    '<h2>' + esc(it.d) + '</h2>' + rows + '<div class="acts">' + acts + '</div>', function (el, close) {
    if (it.ph) { var key = it.ph + '@900'; if (S.photos[key]) paint(key); else { if (S.photos[it.ph + '@360']) { S.photos[key + 'tmp'] = 1; var big = $('.big', el); var im = document.createElement('img'); im.src = S.photos[it.ph + '@360']; big.appendChild(im); } wantPhoto(it.ph, 900); } }
    var on = function (id, fn) { var e = $(id, el); if (e) e.onclick = function () { close(); fn(); }; };
    on('#a-sell', function () { sellSheet(it); });
    on('#a-move', function () { chooseBoutique([it.c]); });
    on('#a-back', function () { confirmBack([it.c]); });
    on('#a-unsell', function () { confirmUnsell(it); });
    on('#a-photo', function () { photoFlow(it); });
    on('#a-edit', function () { editSheet(it); });
    on('#a-inv', function () { invoiceSheet([it]); });
    on('#a-gift', function () { giftSheet(it); });
  });
}
function after(r, okMsg) {
  if (r && r.ok) { toast(r.msg || okMsg || 'تم'); S.sel = {}; S.select = false; return loadAll(true).then(function () { return true; }); }
  toast((r && r.msg) || 'لم تتم العملية', true); return Promise.resolve(false);
}
function discPrice(sp, kind, v) { v = Number(v) || 0; var p = kind === 'pct' ? sp * (1 - v / 100) : sp - v; return Math.max(0, Math.round(p * 1000) / 1000); }
function discRow(idp) {
  return '<div class="f"><label>خصم (اختياري)</label><div style="display:flex;gap:8px"><select id="' + idp + 'k" style="width:120px"><option value="pct">نسبة %</option><option value="amt">مبلغ ر.ع</option></select><input id="' + idp + 'v" type="number" inputmode="decimal" step="0.001" placeholder="مثال: 10" style="flex:1"></div></div>';
}
function sellSheet(it) {
  sheet('<h2>بيع القطعة</h2><div class="sum">' + esc(it.c) + ' · ' + esc(it.d) + '<br>التكلفة ' + fmt(it.tc) + ' · السعر المعتمد ' + fmt(it.sp) + (it.loc && it.loc !== 'المخزن الرئيسي' ? '<br>في ' + esc(it.loc) + ' — يُستلم المبلغ منه' : '') + '</div>' +
    discRow('d') + (it.loc && it.loc !== 'المخزن الرئيسي' ? '' : '<label class="row-ck"><input type="checkbox" id="cr"> بيع آجل (لم يُستلم المبلغ بعد)</label><div class="f" id="crn" style="display:none"><label>اسم العميل</label><input id="cn" placeholder="مثال: أخت زوجتي"></div>') + '<div class="f"><label>سعر البيع الفعلي (ر.ع)</label><input id="pr" type="number" inputmode="decimal" step="0.001" value="' + it.sp + '"></div>' +
    '<div class="sum" id="pf"></div><button class="act pri" style="width:100%" id="ok">تأكيد البيع</button>', function (el, close) {
    var pr = $('#pr', el); function upd() { var p = Number(pr.value) || 0; $('#pf', el).textContent = 'الربح المتوقع: ' + fmt(p - it.tc) + ' ر.ع' + (p < it.sp ? ' (خصم ' + fmt(it.sp - p) + ')' : ''); } pr.oninput = function () { $('#dv', el).value = ''; upd(); }; upd();
    function dsc() { var v = $('#dv', el).value; pr.value = v === '' ? it.sp : discPrice(it.sp, $('#dk', el).value, v); upd(); }
    $('#dv', el).oninput = dsc; $('#dk', el).onchange = dsc;
    if ($('#cr', el)) $('#cr', el).onchange = function () { $('#crn', el).style.display = this.checked ? '' : 'none'; };
    $('#ok', el).onclick = function () {
      var p = Number(pr.value); if (!(p > 0)) return toast('اكتب سعراً صحيحاً', true);
      var cr = $('#cr', el) && $('#cr', el).checked, cn = cr ? $('#cn', el).value.trim() : '';
      if (cr && !cn) return toast('اكتب اسم العميل للبيع الآجل', true);
      close(); api('sell', {code: it.c, price: p, credit: cn}).then(function (r) { if (r && r.ok && r.profit != null) r.msg += ' · الربح ' + fmt(r.profit); after(r).then(function (ok) { if (ok) offerInvoice([it.c]); }); });
    };
  });
}
function installmentSheet() {
  sheet('<h2>قسط الشقة</h2><div class="sum">يُخصم من نقد المشروع ومن المتبقي في عقد الشقة، ولا يدخل في المصروفات ولا الأرباح.</div>' + numField('am', 'المبلغ (ر.ع)') + '<div class="f"><label>ملاحظة (اختياري)</label><input id="nt"></div><button class="act pri" style="width:100%" id="ok">تسجيل القسط</button>', function (el, close) {
    $('#ok', el).onclick = function () {
      var a = Number($('#am', el).value); if (!(a > 0)) return toast('اكتب المبلغ', true);
      var q = {amount: a, note: $('#nt', el).value.trim()}, P = S.plan;
      close();
      if (P && P.sys.cash < P.sup.left) askOverride('قسط الشقة يخالف قاعدة الخطة الآن', ['النقد ' + fmt(P.sys.cash) + ' ر.ع أقل من دين المورد ' + fmt(P.sup.left) + ' ر.ع', 'القاعدة: لا تُدفع أقساط الشقة من نقد المشروع حتى يزيد النقد على الدين'], function () { q.over = true; api('installment', q).then(after); });
      else api('installment', q).then(after);
    };
  });
}
function creditSheet() {
  sheet('<h2>عملاء البيع الآجل</h2><div id="cl"><div class="sk"></div><div class="sk"></div></div>', function (el, close) {
    api('credit', null, {silent: true}).then(function (r) {
      var box = $('#cl', el); if (!box) return;
      if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'تعذر التحميل') + '</div>'; return; }
      if (!r.customers.length) { box.innerHTML = '<div class="empty">لا يوجد بيع آجل. يُسجَّل من شاشة البيع بخيار «بيع آجل».</div>'; return; }
      box.innerHTML = r.customers.map(function (x, i) {
        return '<div class="bt" data-i="' + i + '" style="cursor:pointer"><div><div class="n">' + esc(x.n) + ' ‹</div><div class="m">' + fmt0(x.pcs) + ' قطعة · قيمتها ' + fmt(x.sold) + ' · سدّد ' + fmt(x.paid) + '</div></div><div class="o">' + fmt(x.left) + '<div class="m">متبقٍ</div></div></div>';
      }).join('');
      $$('.bt[data-i]', box).forEach(function (b) {
        b.onclick = function () {
          var x = r.customers[Number(b.getAttribute('data-i'))]; close();
          sheet('<h2>دفعة من ' + esc(x.n) + '</h2><div class="sum">المتبقي عليه ' + fmt(x.left) + ' ر.ع</div>' + numField('am', 'المبلغ المستلم (ر.ع)') + '<button class="act pri" style="width:100%" id="ok">تسجيل الدفعة</button>', function (e2, c2) {
            $('#ok', e2).onclick = function () {
              var a = Number($('#am', e2).value); if (!(a > 0)) return toast('اكتب المبلغ', true);
              c2(); api('cash', {party: x.n, amount: a, note: 'سداد بيع آجل'}).then(after);
            };
          });
        };
      });
    });
  });
}
function debtsSheet() {
  sheet('<h2>ديون الأشخاص</h2><div id="db"><div class="sk"></div><div class="sk"></div></div>', function (el, close) {
    api('debts', null, {silent: true}).then(function (r) {
      var box = $('#db', el); if (!box) return;
      if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'تعذر التحميل') + '</div>'; return; }
      box.innerHTML = '<div class="sum">إجمالي ما عليك للأشخاص: <b>' + fmt(r.total) + ' ر.ع</b></div><button class="act pri" style="width:100%;margin-bottom:10px" id="dn">تسجيل دين جديد (استلمت مبلغاً)</button>' +
        (r.people.length ? r.people.map(function (x, i) {
          return '<div class="bt" data-i="' + i + '" style="cursor:pointer"><div><div class="n">' + esc(x.n) + (x.left > 0 ? ' ‹' : '') + '</div><div class="m">استلمت ' + fmt(x.got) + ' · سددت ' + fmt(x.paid) + '</div></div><div class="o">' + fmt(x.left) + '<div class="m">' + (x.left > 0 ? 'متبقٍ عليك' : 'مسدَّد') + '</div></div></div>';
        }).join('') : '<div class="empty">لا توجد ديون مسجلة</div>');
      $('#dn', box).onclick = function () { close(); debtSheet(null); };
      $$('.bt[data-i]', box).forEach(function (b) {
        b.onclick = function () { var x = r.people[Number(b.getAttribute('data-i'))]; if (x.left > 0) { close(); debtSheet(x); } };
      });
    });
  });
}
function debtSheet(x) {
  var out = !!x;
  sheet('<h2>' + (out ? 'سداد دين إلى ' + esc(x.n) : 'دين جديد للمشروع') + '</h2>' + (out ? '<div class="sum">المتبقي عليك ' + fmt(x.left) + ' ر.ع</div>' : '<div class="f"><label>اسم الشخص</label><input id="pn"></div>') +
    numField('am', out ? 'المبلغ المسدَّد (ر.ع)' : 'المبلغ المستلم (ر.ع)') + '<div class="f"><label>ملاحظة (السبب أو الاتفاق)</label><input id="nt"></div>' +
    '<label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="cs" checked> ' + (out ? 'سُدِّد من نقد المشروع (يُخصم من الصندوق)' : 'دخل نقد المشروع (يزيد الصندوق)') + '</label><div class="stale">أزل العلامة إذا لم يمر المبلغ بالصندوق، مثل أن يدفع الشخص عنك مباشرة لمورد.</div><button class="act pri" style="width:100%;margin-top:12px" id="ok">تسجيل</button>', function (el, close) {
    if (out) $('#am', el).value = x.left;
    $('#ok', el).onclick = function () {
      var p = out ? x.n : $('#pn', el).value.trim(), a = Number($('#am', el).value);
      if (!p) return toast('اكتب اسم الشخص', true); if (!(a > 0)) return toast('اكتب المبلغ', true);
      close(); api('debtAdd', {kind: out ? 'out' : 'in', person: p, amount: a, note: $('#nt', el).value.trim(), cash: $('#cs', el).checked}).then(function (r) { res3(r, debtsSheet); });
    };
  });
}
function giftSheet(it) {
  sheet('<h2>تسجيل هدية</h2><div class="sum">' + esc(it.c) + ' · ' + esc(it.d) + '<br>تخرج من المخزون بتكلفتها ' + fmt(it.tc) + ' ر.ع، ولا تُحسب بيعاً ولا خصماً، وتُخصم تكلفتها من ربح الشهر.</div>' +
    '<div class="f"><label>لمن الهدية، وما السبب؟</label><input id="nt" placeholder="مثال: هدية لأم سالم - مقابل هدية قدمتها لنا"></div><button class="act pri" style="width:100%" id="ok">تأكيد الهدية</button>', function (el, close) {
    $('#ok', el).onclick = function () {
      var nt = $('#nt', el).value.trim(); if (!nt) return toast('اكتب لمن الهدية والسبب', true);
      close(); api('gift', {code: it.c, note: nt}).then(after);
    };
  });
}
function confirmUnsell(it) {
  sheet('<h2>إلغاء البيع؟</h2><div class="sum">' + esc(it.c) + ' · ' + esc(it.d) + '<br>ستعود القطعة إلى ' + (it.loc && it.loc !== 'المخزن الرئيسي' ? esc(it.loc) : 'المخزن') + ' وتُحذف بيانات البيع.</div><button class="act dng" style="width:100%" id="ok">نعم، ألغِ البيع</button>', function (el, close) {
    $('#ok', el).onclick = function () { close(); lateEdit(String(it.sd || '').slice(0, 7), 'إلغاء بيع قطعة بيعت في ذلك الشهر', function (late) { api('unsell', {code: it.c, late: late}).then(after); }); };
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
    '<button id="x4"><span class="i">↑</span><div>سحب شخصي<small>خارج الأرباح</small></div></button>' +
    '<button id="x5"><span class="i">⌂</span><div>قسط الشقة<small>يُخصم من المتبقي في العقد ومن النقد</small></div></button></div>', function (el, close) {
    $('#x5', el).onclick = function () { close(); installmentSheet(); };
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
      close();
      buyCheck(o.qty, o.buy, function (over) { if (over) o.over = true; api('addPiece', o).then(after); });
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
function cashSheet(pre) {
  var names = ((S.meta && S.meta.boutiques) || []).concat(['من الحساب الشخصي']);
  sheet('<h2>استلام نقد</h2>' + numField('am', 'المبلغ (ر.ع)') + '<div class="f"><label>من</label><select id="pt">' + names.map(function (n) { return '<option' + (n === pre ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '<option value="__o">جهة أخرى…</option></select></div>' +
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

/* ---------- piece picker (bulk actions) ---------- */
function pickPieces(o) {
  if (!o.items.length) return toast('لا توجد قطع', true);
  sheet('<h2>' + esc(o.title) + '</h2><div class="sum" id="ps"></div><div class="f"><input id="pq" type="search" placeholder="بحث بالوصف أو الكود"></div>' +
    (o.withPrice ? '<div class="f"><label>خصم على القطع المحددة (اختياري)</label><div style="display:flex;gap:8px"><select id="bk" style="width:112px"><option value="pct">نسبة %</option><option value="amt">مبلغ ر.ع</option></select><input id="bv" type="number" inputmode="decimal" step="0.001" placeholder="مثال: 10" style="flex:1;min-width:0"><button class="chip" id="bd" type="button">تطبيق</button></div></div>' : '') +
    '<div id="pl">' +
    o.items.map(function (i) {
      return '<label class="row-ck pk" data-c="' + esc(i.c) + '" data-sp="' + i.sp + '" data-s="' + esc((i.c + ' ' + i.d).toLowerCase()) + '"><input type="checkbox"' + (o.all ? ' checked' : '') + '>' +
        '<span style="flex:1;font-size:14px;line-height:1.35">' + esc(i.d) + '<br><small style="color:var(--mute);direction:ltr;display:inline-block">' + esc(i.c) + '</small></span>' +
        (o.withPrice ? '<input class="pp" type="number" inputmode="decimal" step="0.001" value="' + i.sp + '" style="width:86px;padding:8px;border-radius:10px;border:1.5px solid var(--line);text-align:center">' : '<b>' + fmt(i.sp) + '</b>') + '</label>';
    }).join('') + '</div><button class="act pri" style="width:100%;margin-top:12px" id="ok">' + esc(o.label) + '</button>', function (el, close) {
    function sum() {
      var n = 0, tot = 0;
      $$('.pk', el).forEach(function (r) { if ($('input[type=checkbox]', r).checked) { n++; var p = $('.pp', r); tot += p ? Number(p.value) || 0 : 0; } });
      $('#ps', el).textContent = n + ' قطعة محددة' + (o.withPrice ? ' · المجموع ' + fmt(tot) + ' ر.ع' : '');
    }
    $$('.pk input', el).forEach(function (x) { x.oninput = sum; x.onchange = sum; });
    $('#pq', el).oninput = function () { var q = this.value.trim().toLowerCase(); $$('.pk', el).forEach(function (r) { r.style.display = (!q || r.getAttribute('data-s').indexOf(q) >= 0) ? '' : 'none'; }); };
    sum();
    if (o.withPrice) $('#bd', el).onclick = function () {
      var v = $('#bv', el).value; if (v === '' || !(Number(v) >= 0)) return toast('اكتب قيمة الخصم', true);
      var n = 0; $$('.pk', el).forEach(function (r) {
        if (!$('input[type=checkbox]', r).checked) return;
        var sp = Number(r.getAttribute('data-sp')); $('.pp', r).value = discPrice(sp, $('#bk', el).value, v); n++;
      });
      sum(); toast(n ? 'تم تطبيق الخصم على ' + n + ' قطعة' : 'حدّد قطعاً أولاً', !n);
    };
    $('#ok', el).onclick = function () {
      var list = [];
      $$('.pk', el).forEach(function (r) {
        if (!$('input[type=checkbox]', r).checked) return;
        var p = $('.pp', r); list.push({code: r.getAttribute('data-c'), price: p ? Number(p.value) : 0});
      });
      if (!list.length) return toast('اختر قطعة واحدة على الأقل', true);
      if (o.withPrice && list.some(function (x) { return !(x.price > 0); })) return toast('اكتب سعراً صحيحاً لكل قطعة محددة', true);
      close(); o.run(list);
    };
  });
}
function runSellMany(list) {
  api('sellMany', {items: list}).then(function (r) {
    if (r && r.ok && r.profit != null) r.msg += ' · الربح ' + fmt(r.profit);
    if (r && r.results) { var bad = r.results.filter(function (x) { return !x.ok; }); if (bad.length) r.msg += ' — لم تُسجَّل: ' + bad.map(function (x) { return x.code + ' (' + x.msg + ')'; }).join('، '); }
    var codes = (r && r.results ? r.results.filter(function (x) { return x.ok; }).map(function (x) { return x.code; }) : []);
    after(r).then(function (ok) { if (ok && codes.length) offerInvoice(codes); });
  });
}

/* ---------- boutique page ---------- */
function boutiqueSheet(name) {
  var d = ((S.dash && S.dash.boutiques) || []).filter(function (x) { return x.n === name; })[0] || {n: name, pcs: 0, sold: 0, soldVal: 0, paid: 0, prior: 0, owed: 0};
  var items = S.inv ? S.inv.items : [];
  var here = items.filter(function (i) { return i.loc === name && i.st === 'في البوتيك'; });
  var inMain = items.filter(function (i) { return i.st === 'في المخزن'; });
  if ((S.meta && S.meta.expos || []).indexOf(name) >= 0) return expoSheet(name, d, here, inMain);
  sheet('<h2>' + esc(name) + '</h2><div class="card">' +
    '<div class="kv"><span>عنده الآن</span><b>' + here.length + ' قطعة</b></div>' +
    '<div class="kv"><span>باع منذ بدء النظام</span><b>' + fmt0(d.sold) + ' قطعة · ' + fmt(d.soldVal) + '</b></div>' +
    '<div class="kv"><span>مستحق قبل بدء النظام</span><b>' + fmt(d.prior) + '</b></div>' +
    '<div class="kv"><span>نقد استلمته منه</span><b>' + fmt(d.paid) + '</b></div>' +
    '<div class="kv"><span>المتبقي عليه</span><b>' + fmt(d.owed) + '</b></div></div>' +
    '<div class="acts" style="margin-top:0"><button class="act pri" id="b-sell">تسجيل مبيعات</button><button class="act" id="b-cash">استلام نقد منه</button>' +
    '<button class="act" id="b-back">إرجاع قطع</button><button class="act" id="b-move">نقل قطع إليه</button><button class="act full" id="b-ar">إرفاق فاتورة أو إيصال</button></div>' +
    '<h3 style="margin-top:18px">القطع عنده (' + here.length + ')</h3>' +
    (here.length ? here.map(function (i) { return '<div class="kv"><span>' + esc(i.d) + '<br><small style="color:var(--mute);direction:ltr;display:inline-block">' + esc(i.c) + '</small></span><b>' + fmt(i.sp) + '</b></div>'; }).join('') : '<div class="empty">لا توجد قطع عنده</div>'),
    function (el, close) {
      var on = function (id, fn) { $(id, el).onclick = function () { close(); fn(); }; };
      on('#b-sell', function () { pickPieces({title: 'مبيعات ' + name, items: here, withPrice: true, label: 'تسجيل البيع', run: runSellMany}); });
      on('#b-cash', function () { cashSheet(name); });
      on('#b-ar', function () { addArchiveSheet({kind: 'فاتورة بوتيك', ref: name}); });
      on('#b-back', function () { pickPieces({title: 'إرجاع من ' + name, items: here, label: 'إرجاع للمخزن', run: function (l) { api('back', {codes: l.map(function (x) { return x.code; })}).then(after); }}); });
      on('#b-move', function () { pickPieces({title: 'نقل إلى ' + name, items: inMain, label: 'نقل', run: function (l) { api('move', {codes: l.map(function (x) { return x.code; }), boutique: name}).then(after); }}); });
    });
}

/* صفحة المعرض: مثل البوتيك بلا مستحق (البيع نقداً)، ومعها زر «إنهاء المعرض» يُرجع الباقي للمخزن ويُخفيه. */
function expoSheet(name, d, here, inMain) {
  sheet('<h2>' + esc(name) + ' <span class="mtag ex">معرض</span></h2><div class="card">' +
    '<div class="kv"><span>فيه الآن</span><b>' + here.length + ' قطعة</b></div>' +
    '<div class="kv"><span>باع</span><b>' + fmt0(d.sold) + ' قطعة · ' + fmt(d.soldVal) + '</b></div>' +
    '<div class="stale" style="margin:6px 0 0;text-align:start">ما يُباع في المعرض يدخل النقد فوراً.</div></div>' +
    '<div class="acts" style="margin-top:0"><button class="act pri" id="e-sell">تسجيل مبيعات</button><button class="act" id="e-move">نقل قطع إليه</button>' +
    '<button class="act" id="e-back">إرجاع قطع</button><button class="act dng" id="e-end">إنهاء المعرض</button></div>' +
    '<h3 style="margin-top:18px">القطع فيه (' + here.length + ')</h3>' +
    (here.length ? here.map(function (i) { return '<div class="kv"><span>' + esc(i.d) + '<br><small style="color:var(--mute);direction:ltr;display:inline-block">' + esc(i.c) + '</small></span><b>' + fmt(i.sp) + '</b></div>'; }).join('') : '<div class="empty">لا توجد قطع فيه</div>'),
    function (el, close) {
      var on = function (id, fn) { $(id, el).onclick = function () { close(); fn(); }; };
      on('#e-sell', function () { pickPieces({title: 'مبيعات ' + name, items: here, withPrice: true, label: 'تسجيل البيع', run: runSellMany}); });
      on('#e-back', function () { pickPieces({title: 'إرجاع من ' + name, items: here, all: true, label: 'إرجاع للمخزن', run: function (l) { api('back', {codes: l.map(function (x) { return x.code; })}).then(after); }}); });
      on('#e-move', function () { pickPieces({title: 'نقل إلى ' + name, items: inMain, label: 'نقل', run: function (l) { api('move', {codes: l.map(function (x) { return x.code; }), boutique: name}).then(after); }}); });
      on('#e-end', function () {
        sheet('<h2>إنهاء ' + esc(name) + '؟</h2><div class="sum">' + (here.length ? 'ترجع القطع الباقية (' + here.length + ') إلى المخزن بألوانها، ' : '') + 'ويختفي المعرض من الرئيسية والمخزون. مبيعاته تبقى محسوبة في شهرها.</div><button class="act pri" style="width:100%" id="ok">نعم، انتهى المعرض</button>', function (e2, c2) {
          $('#ok', e2).onclick = function () { c2(); api('endExpo', {name: name}).then(after); };
        });
      });
    });
}

/* ---------- edit piece ---------- */
function editSheet(it) {
  sheet('<h2>تعديل القطعة</h2><div class="sum" style="direction:ltr;text-align:right">' + esc(it.c) + '</div>' +
    '<div class="f"><label>الوصف</label><input id="ds" value="' + esc(it.d) + '"></div>' +
    '<div class="f"><label>سعر البيع المعتمد (ر.ع)</label><input id="sp" type="number" inputmode="decimal" step="0.001" value="' + it.sp + '"></div>' +
    '<div class="sum" id="sg"></div>' +
    '<label class="row-ck"><input type="checkbox" id="same"> تطبيق على كل القطع غير المباعة التي لها نفس الوصف الحالي</label>' +
    '<button class="act pri" style="width:100%" id="ok">حفظ التعديل</button>', function (el, close) {
    var sgv = suggestPrice(it.tc);
    function sg() { var v = Number($('#sp', el).value) || 0; $('#sg', el).innerHTML = 'السعر حسب قاعدة الخطة: التكلفة ' + fmt(it.tc) + ' × ' + ruleMult() + ' = <b>' + fmt(sgv) + ' ر.ع</b>' + (v + 0.001 < sgv ? '<br><b style="color:var(--warn)">السعر الحالي أقل من القاعدة</b> <button class="chip" id="us" style="margin-top:6px">استخدم ' + fmt(sgv) + '</button>' : '<br><span class="pos">السعر على القاعدة أو أعلى ✓</span>'); var u = $('#us', el); if (u) u.onclick = function () { $('#sp', el).value = sgv; sg(); }; }
    $('#sp', el).oninput = sg; sg();
    $('#ok', el).onclick = function () {
      var ds = $('#ds', el).value.trim(), sp = Number($('#sp', el).value);
      if (!ds) return toast('اكتب الوصف', true); if (!(sp > 0)) return toast('اكتب سعراً صحيحاً', true);
      close(); api('editPiece', {code: it.c, desc: ds, sale: sp, same: $('#same', el).checked}).then(after);
    };
  });
}


/* ---------- stocktake ---------- */
function countSheet() {
  var ms = (S.inv.models || []).map(function (x) { return x.m; }), cur = 'main', draft = {};
  try { draft = JSON.parse(localStorage.getItem('gz_count') || '{}'); } catch (e) {}
  function sysOf(m, w) {
    var s = modelStats(m), n = 0, cs = [];
    s.locs.forEach(function (l) { if ((w === 'main') === (l === MAIN)) { n += s.loc[l]; (s.cols[l] || []).forEach(function (x) { cs.push(x); }); } });
    return {n: n, c: colTxt(cs)};
  }
  function save() { try { localStorage.setItem('gz_count', JSON.stringify(draft)); } catch (e) {} }
  sheet('<h2>الجرد</h2><div class="chips" id="cw"><button class="chip on" data-w="main">المخزن</button><button class="chip" data-w="bt">البوتيك</button></div>' +
    '<div class="stale" id="csum" style="margin:10px 0"></div><div id="clist"></div>' +
    '<button class="act" style="width:100%;margin-top:10px" id="crs">تصفير الجرد</button>', function (el) {
    function draw() {
      var rows = '', sysT = 0, actT = 0, diff = 0, done = 0;
      ms.forEach(function (m) {
        var y = sysOf(m, cur); if (!y.n && draft[cur + m] == null) return;
        var k = cur + m, a = draft[k], has = a != null; if (!has) a = y.n;
        sysT += y.n; actT += a; if (has) done++; if (has && a !== y.n) diff++;
        rows += '<div class="bt" style="align-items:center' + (has && a !== y.n ? ';background:#FBEAEA' : '') + '"><div class="n"><b>' + esc(m) + '</b> ' + esc(modelInfo(m).n || '') + '<small style="display:block;color:var(--mute)">النظام ' + y.n + (y.c ? ' · ' + y.c : '') + '</small></div>' +
          '<div class="o" style="display:flex;gap:6px;align-items:center"><button class="chip" data-m="' + esc(m) + '" data-d="-1">−</button><b style="min-width:26px;text-align:center;' + (has ? '' : 'opacity:.4') + '">' + a + '</b><button class="chip" data-m="' + esc(m) + '" data-d="1">＋</button><button class="chip" data-m="' + esc(m) + '" data-d="ok">✓</button></div></div>';
      });
      $('#clist', el).innerHTML = rows;
      $('#csum', el).innerHTML = 'النظام ' + sysT + ' · الفعلي ' + actT + ' · الفرق ' + (actT - sysT) + ' · عُدّ ' + done + ' · فروقات ' + diff;
      $$('#clist [data-m]', el).forEach(function (b) {
        b.onclick = function () {
          var m = b.getAttribute('data-m'), d = b.getAttribute('data-d'), y = sysOf(m, cur).n, k = cur + m, a = draft[k] != null ? draft[k] : y;
          draft[k] = d === 'ok' ? y : Math.max(0, a + Number(d)); save(); draw();
        };
      });
    }
    $$('#cw .chip', el).forEach(function (b) {
      b.onclick = function () { cur = b.getAttribute('data-w'); $$('#cw .chip', el).forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); };
    });
    $('#crs', el).onclick = function () { if (confirm('تصفير كل أرقام الجرد؟')) { draft = {}; save(); draw(); } };
    draw();
  });
}

/* ---------- settings / log ---------- */
function settingsSheet() {
  sheet('<h2>الإعدادات</h2><div class="menu">' +
    '<button id="s1"><span class="i">＋</span><div>إضافة بوتيك أو معرض<small>يظهر في التقارير وعند النقل</small></div></button>' +
    '<button id="s2"><span class="i">⌘</span><div>تغيير الرقم السري<small>لحسابك أنت فقط</small></div></button>' +
    '<button id="s3"><span class="i">⌫</span><div>مسح ذاكرة الصور<small>إن ظهرت صورة قديمة بعد تغييرها</small></div></button></div>' +
    '<div class="stale" style="margin-top:14px">المستخدم: ' + esc(S.name || '') + ' · النسخة 26</div>', function (el, close) {
    $('#s1', el).onclick = function () { close(); addBoutiqueSheet(); };
    $('#s2', el).onclick = function () { close(); pinSheet(); };
    $('#s3', el).onclick = function () {
      S.photos = {};
      idbOpen().then(function (d) { try { if (d) d.transaction('ph', 'readwrite').objectStore('ph').clear(); } catch (e) {} });
      close(); toast('تم مسح ذاكرة الصور'); renderBody();
    };
  });
}
function addBoutiqueSheet() {
  sheet('<h2>بوتيك أو معرض جديد</h2><div class="cats" id="kd" style="margin-bottom:12px"><button class="chip on" data-k="bt">بوتيك</button><button class="chip" data-k="expo">معرض (أيام محدودة)</button></div>' +
    '<div class="f"><label>الاسم</label><input id="nm" placeholder="مثال: بوتيك الأناقة"></div><div class="sum" id="kh">البوتيك يبيع القطع ويحوّل المبلغ آخر الشهر.</div><button class="act pri" style="width:100%" id="ok">إضافة</button>', function (el, close) {
    var kind = 'bt';
    $$('#kd .chip', el).forEach(function (c) { c.onclick = function () { kind = c.getAttribute('data-k'); $$('#kd .chip', el).forEach(function (x) { x.classList.toggle('on', x === c); }); $('#nm', el).placeholder = kind === 'expo' ? 'مثال: معرض شيك نوفمبر' : 'مثال: بوتيك الأناقة'; $('#kh', el).textContent = kind === 'expo' ? 'المعرض مثل البوتيك: تنقلين القطع إليه وتبيعين منه. الفرق أن المبلغ يدخل النقد فوراً، وبعد انتهائه ترجعين الباقي للمخزن فيختفي وحده.' : 'البوتيك يبيع القطع ويحوّل المبلغ آخر الشهر.'; }; });
    $('#ok', el).onclick = function () {
      var n = $('#nm', el).value.trim(); if (!n) return toast('اكتب الاسم', true);
      close(); api('addBoutique', {name: n, expo: kind === 'expo'}).then(after);
    };
  });
}
function pinSheet() {
  sheet('<h2>تغيير الرقم السري</h2><div class="f"><label>الرقم الحالي</label><input id="o" type="password" inputmode="numeric" autocomplete="off"></div>' +
    '<div class="f"><label>الرقم الجديد (4 إلى 8 أرقام)</label><input id="n" type="password" inputmode="numeric" autocomplete="off"></div>' +
    '<div class="f"><label>أعد كتابة الرقم الجديد</label><input id="n2" type="password" inputmode="numeric" autocomplete="off"></div>' +
    '<button class="act pri" style="width:100%" id="ok">حفظ</button>', function (el, close) {
    $('#ok', el).onclick = function () {
      var o = $('#o', el).value, n = $('#n', el).value;
      if (n !== $('#n2', el).value) return toast('الرقمان الجديدان غير متطابقين', true);
      if (!/^[0-9]{4,8}$/.test(n)) return toast('الرقم من 4 إلى 8 أرقام فقط', true);
      close(); api('changePin', {old: o, nw: n}).then(function (r) { toast((r && r.msg) || 'تعذر التغيير', !(r && r.ok)); });
    };
  });
}
var DELETABLE = {'مصروف تشغيلي': 1, 'استلام نقد': 1, 'مسحوبات شخصية': 1, 'قسط الشقة': 1, 'دين مستلم': 1, 'سداد دين': 1};
function logSheet() {
  sheet('<h2>سجل الحركات</h2><div id="lg"><div class="sk"></div><div class="sk"></div></div>', function (el, close) {
    api('trx', {n: 60}, {silent: true}).then(function (r) {
      var box = $('#lg', el); if (!box) return;
      if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'تعذر التحميل') + '</div>'; return; }
      if (!r.rows.length) { box.innerHTML = '<div class="empty">لا توجد حركات</div>'; return; }
      box.innerHTML = r.rows.map(function (x, i) {
        var inn = x.t === 'استلام نقد' || x.t === 'دين مستلم';
        var tail = x.del ? (x.can ? '<br><button data-r="' + i + '" class="chip" style="margin-top:4px">استرجاع</button>' : '') :
          DELETABLE[x.t] ? (x.can === false ? '<br><small style="color:var(--mute);font-weight:400">🔒 الحذف عند بلال</small>' : '<br><button data-i="' + i + '" class="chip" style="margin-top:4px;color:var(--bad)">حذف</button>') : '';
        return '<div class="bt"' + (x.del ? ' style="opacity:.6"' : '') + '><div><div class="n"' + (x.del ? ' style="text-decoration:line-through"' : '') + '>' + esc(x.t) + (x.p ? ' · ' + esc(x.p) : '') + '</div><div class="m">' + esc(x.d) + (x.nt ? ' · ' + esc(x.nt) : '') + (x.by ? ' · سجّلها ' + esc(x.by) : '') + (x.del ? '<br><b style="color:var(--bad)">محذوفة</b> · حذفها ' + esc(x.del.by) + ' في ' + esc(x.del.d) + ' · لا تدخل في الحسابات' : '') + '</div></div>' +
          '<div class="o ' + (inn && !x.del ? 'pos' : '') + '"' + (x.del ? ' style="text-decoration:line-through"' : '') + '>' + (inn ? '+' : '') + fmt(x.a) + '</div>' + (tail ? '<div class="o" style="flex:0 0 auto;margin-inline-start:8px">' + tail.replace('<br>', '') + '</div>' : '') + '</div>';
      }).join('');
      $$('button[data-r]', box).forEach(function (b) {
        b.onclick = function () {
          var x = r.rows[Number(b.getAttribute('data-r'))]; close();
          lateEdit(String(x.d || '').slice(0, 7), 'استرجاع حركة محذوفة من ذلك الشهر', function (late) { api('restoreTrx', {row: x.row, late: late}).then(after); });
        };
      });
      $$('button[data-i]', box).forEach(function (b) {
        b.onclick = function () {
          var x = r.rows[Number(b.getAttribute('data-i'))];
          sheet('<h2>حذف هذه الحركة؟</h2><div class="sum">' + esc(x.t) + (x.p ? ' · ' + esc(x.p) : '') + '<br>' + fmt(x.a) + ' ر.ع · ' + esc(x.d) + (x.nt ? '<br>' + esc(x.nt) : '') + '<br>سيتغير رصيد النقد. الحركة تبقى في السجل مشطوبة ويمكن استرجاعها.</div><button class="act dng" style="width:100%" id="ok">نعم، احذفها</button>', function (e2, c2) {
            $('#ok', e2).onclick = function () { c2(); close(); lateEdit(String(x.d || '').slice(0, 7), 'حذف حركة مسجّلة في ذلك الشهر', function (late) { api('delTrx', {row: x.row, typ: x.t, amt: x.a, late: late}).then(after); }); };
          });
        };
      });
    });
  });
}

/* ---------- shipments & suppliers ---------- */
function res3(r, okFn) { if (r && r.ok) { toast(r.msg || 'تم'); return loadAll(true).then(function () { if (okFn) okFn(); }); } toast((r && r.msg) || 'لم تتم العملية', true); }
function shipsSheet() {
  sheet('<h2>الشحنات والموردين</h2><div class="acts" style="margin-top:0"><button class="act pri" id="sn">شحنة جديدة</button><button class="act" id="sp">دفعة / مشتريات أسامة</button></div><div id="sl"><div class="sk"></div><div class="sk"></div></div>', function (el, close) {
    $('#sn', el).onclick = function () { close(); newShipSheet(); };
    $('#sp', el).onclick = function () { close(); supplierSheet(); };
    api('ships', null, {silent: true}).then(function (r) {
      var box = $('#sl', el); if (!box) return;
      if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'تعذر التحميل') + '</div>'; return; }
      box.innerHTML = '<div class="kv"><span>المتبقي علينا لأسامة</span><b>' + fmt(r.supLeft) + ' ر.ع</b></div>' + (r.ships.length ? r.ships.map(function (x, i) {
        return '<div class="bt" data-i="' + i + '" style="cursor:pointer"><div><div class="n">شحنة ' + esc(x.id) + ' ‹</div><div class="m">' + esc(x.s) + ' · ' + fmt0(x.n) + ' قطعة · ' + esc(x.d) + '</div></div><div class="o">' + esc(x.st || '-') + '<div class="m">' + fmt(x.tot) + '</div></div></div>';
      }).join('') : '<div class="empty">لا توجد شحنات</div>');
      $$('.bt[data-i]', box).forEach(function (b) { b.onclick = function () { var x = r.ships[Number(b.getAttribute('data-i'))]; close(); shipSheet(x); }; });
    });
  });
}
function newShipSheet() {
  sheet('<h2>شحنة جديدة</h2><div class="f"><label>رقم الشحنة</label><input id="id" placeholder="مثال: 1126"></div><div class="f"><label>اسم المورد</label><input id="nm" placeholder="مثال: مورد الصين"></div><button class="act pri" style="width:100%" id="ok">إنشاء الشحنة</button><div class="stale" style="margin-top:12px">تُنشأ بحالة «في الطريق». بعدها أضف قطعها.</div>', function (el, close) {
    $('#ok', el).onclick = function () {
      var id = $('#id', el).value.trim(), nm = $('#nm', el).value.trim();
      if (!id || !nm) return toast('اكتب رقم الشحنة والمورد', true);
      close(); api('newShip', {id: id, name: nm}).then(function (r) { res3(r, function () { shipSheet({id: id, s: nm, n: 0, st: 'في الطريق', ship: 0, conv: 0, insp: 0, tot: 0}); }); });
    };
  });
}
function shipSheet(x) {
  var transit = x.st !== 'وصلت';
  sheet('<h2>شحنة ' + esc(x.id) + '</h2><div class="card"><div class="kv"><span>المورد</span><b>' + esc(x.s) + '</b></div><div class="kv"><span>الحالة</span><b>' + esc(x.st || '-') + '</b></div><div class="kv"><span>القطع</span><b>' + fmt0(x.n) + '</b></div>' +
    '<div class="kv"><span>الشحن</span><b>' + fmt(x.ship) + '</b></div><div class="kv"><span>عمولة التحويل</span><b>' + fmt(x.conv) + '</b></div><div class="kv"><span>عمولة الفحص والوسيط</span><b>' + fmt(x.insp) + '</b></div><div class="kv"><span>إجمالي التكلفة</span><b>' + fmt(x.tot) + '</b></div><div class="kv"><span>قيمة البضاعة المدفوعة</span><b>' + fmt(x.paid || 0) + ' من ' + fmt(x.g || 0) + '</b></div></div>' +
    (x.st === 'ملغاة' ? '<div class="sum">هذه الشحنة ملغاة، وقد عُكست تكاليفها في الحركات.</div>' :
    '<div class="acts"><button class="act pri" id="p">إضافة قطع</button><button class="act" id="f">تسجيل رسوم</button>' + (transit ? '<button class="act full" id="a">تسجيل وصول الشحنة</button>' : '') + '<button class="act full" id="ar">إرفاق إيصال أو فاتورة لهذه الشحنة</button>' + ((x.g || 0) - (x.paid || 0) > 0.0005 ? '<button class="act full" id="py">تسجيل دفع قيمة البضاعة (' + fmt((x.g || 0) - (x.paid || 0)) + ' ر.ع)</button>' : '') + '<button class="act full" id="ed">تعديل رقم الشحنة أو المورد</button>' + (!(x.n > 0) ? '<button class="act full" id="cx" style="color:#B3261E">إلغاء الشحنة (بدون حذف)</button>' : '') + '</div>'), function (el, close) {
    if (x.st === 'ملغاة') return;
    $('#ed', el).onclick = function () { close(); editShipSheet(x); };
    if ($('#py', el)) $('#py', el).onclick = function () { close(); shipPaySheet(x); };
    if ($('#cx', el)) $('#cx', el).onclick = function () { close(); cancelShipSheet(x); };
    $('#ar', el).onclick = function () { close(); addArchiveSheet({kind: 'فاتورة مشتريات', ref: 'شحنة ' + x.id}); };
    $('#p', el).onclick = function () { close(); shipPiecesSheet(x); };
    $('#f', el).onclick = function () { close(); shipFeeSheet(x); };
    if (transit) $('#a', el).onclick = function () { close(); arriveSheet(x); };
  });
}
function shipPaySheet(x) {
  var left = Math.round(((x.g || 0) - (x.paid || 0)) * 1000) / 1000;
  sheet('<h2>دفع بضاعة الشحنة ' + esc(x.id) + '</h2><div class="sum">المتبقي من قيمة البضاعة: ' + fmt(left) + ' ر.ع</div>' + numField('a', 'المبلغ المدفوع (ر.ع)') + '<div class="f"><label>مصدر الدفع</label><select id="sr"><option value="cash">من نقد المشروع (يُخصم من الصندوق)</option><option value="per">من مال شخصي (لا يمس الصندوق)</option></select></div><button class="act pri" style="width:100%" id="ok">تسجيل</button>', function (el, close) {
    $('#a', el).value = left;
    $('#ok', el).onclick = function () {
      var a = Number($('#a', el).value); if (!(a > 0)) return toast('اكتب المبلغ', true);
      close(); api('shipPay', {id: x.id, amount: a, personal: $('#sr', el).value === 'per'}).then(function (r) { res3(r); });
    };
  });
}
function editShipSheet(x) {
  sheet('<h2>تعديل الشحنة ' + esc(x.id) + '</h2><div class="f"><label>رقم الشحنة (حروف وأرقام، مثل 1026B)</label><input id="ni" value="' + esc(x.id) + '"></div><div class="f"><label>المورد</label><input id="su" value="' + esc(x.s) + '"></div><div class="stale">تتحدث الحركات والقطع المرتبطة بالرقم الجديد. أكواد القطع القديمة لا تتغير.</div><button class="act pri" style="width:100%;margin-top:12px" id="ok">حفظ</button>', function (el, close) {
    $('#ok', el).onclick = function () {
      var ni = $('#ni', el).value.trim(), su = $('#su', el).value.trim();
      if (!/^[0-9A-Za-z\-]{1,12}$/.test(ni)) return toast('رقم الشحنة: حروف إنجليزية وأرقام فقط', true);
      close(); api('editShip', {id: x.id, nid: ni, supplier: su}).then(function (r) { res3(r); });
    };
  });
}
function cancelShipSheet(x) {
  sheet('<h2>إلغاء الشحنة ' + esc(x.id) + '</h2><div class="sum">لن تُحذف الشحنة. تبقى في السجل بحالة «ملغاة»، وتُسجَّل حركة عكسية تُعيد تكاليفها (' + fmt(x.tot) + ' ر.ع) إلى نقد المشروع.</div><button class="act pri" style="width:100%;background:#B3261E" id="ok">تأكيد الإلغاء</button>', function (el, close) {
    $('#ok', el).onclick = function () { close(); api('cancelShip', {id: x.id}).then(function (r) { res3(r); }); };
  });
}
function shipPiecesSheet(x) {
  sheet('<h2>قطع للشحنة ' + esc(x.id) + '</h2><div class="f"><label>الوصف (الموديل - اللون - التفاصيل)</label><input id="ds"></div><div class="f"><label>العدد (1 إلى 60)</label><input id="q" type="number" inputmode="numeric"></div>' + '<div class="f"><label>سعر الشراء للقطعة</label><div style="display:flex;gap:8px"><input id="b" type="number" inputmode="decimal" step="0.001" style="flex:1"><select id="bc" style="width:110px"><option value="omr">ر.ع</option><option value="cny">يوان</option></select></div></div>' +
    '<div class="f" id="rw" style="display:none"><label>سعر الصرف: كم يوان لكل 1 ر.ع (حسب تحويلك للصراري)</label><input id="rt" type="number" inputmode="decimal" step="0.0001" value="' + (ls('gz_cny') || '') + '"><div class="stale" id="cv" style="margin-top:6px"></div></div>' + numField('s', 'سعر البيع المعتمد (ر.ع)') +
    '<label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" id="pd" checked> دفعتُ ثمن هذه القطع من نقد المشروع (يُخصم من الصندوق الآن)</label><button class="act pri" style="width:100%" id="ok">إضافة</button><div class="stale" style="margin-top:12px">تُنشأ الأكواد تلقائياً، وبعدها صوّر كل قطعة من المخزون.</div>', function (el, close) {
    function conv() {
      var cny = $('#bc', el).value === 'cny'; $('#rw', el).style.display = cny ? '' : 'none';
      var y = Number($('#b', el).value), r = Number($('#rt', el).value);
      $('#cv', el).textContent = cny && y > 0 && r > 0 ? ('= ' + fmt(y / r) + ' ر.ع للقطعة') : '';
    }
    ['#bc', '#b', '#rt'].forEach(function (k) { $(k, el).oninput = conv; $(k, el).onchange = conv; });
    $('#ok', el).onclick = function () {
      var ds = $('#ds', el).value.trim(), q = Math.floor(Number($('#q', el).value)), b = Number($('#b', el).value), sp = Number($('#s', el).value);
      if ($('#bc', el).value === 'cny') { var rt = Number($('#rt', el).value); if (!(rt > 0)) return toast('اكتب سعر الصرف', true); ls('gz_cny', String(rt)); b = Math.round(b / rt * 1000) / 1000; }
      if (!ds) return toast('اكتب الوصف', true); if (!(q >= 1 && q <= 60)) return toast('العدد من 1 إلى 60', true); if (!(b > 0) || !(sp > 0)) return toast('اكتب سعر الشراء وسعر البيع', true);
      var pay = $('#pd', el).checked; close();
      var run = function (over) { api('shipPieces', {id: x.id, qty: q, buy: b, sale: sp, desc: ds, over: over}).then(function (r) {
        if (r && r.ok && pay) return api('shipPay', {id: x.id, amount: Math.round(q * b * 1000) / 1000}).then(function (r2) { res3(r2 && r2.ok ? {ok: true, msg: (r.msg || 'تمت الإضافة') + ' + خُصم ثمن البضاعة من الصندوق'} : r2); });
        res3(r);
      }); };
      buyCheck(q, b, run);
    };
  });
}
function shipFeeSheet(x) {
  sheet('<h2>رسوم الشحنة ' + esc(x.id) + '</h2><div class="f"><label>نوع الرسم</label><select id="k"><option value="ship">الشحن</option><option value="conv">عمولة التحويل</option><option value="insp">عمولة الفحص والوسيط</option></select></div>' + numField('a', 'المبلغ الإجمالي لهذا الرسم (ر.ع)') +
    '<div class="stale">اكتب الإجمالي وليس الإضافة. إن كان مسجلاً سابقاً يُحتسب الفرق فقط ويُخصم من نقد المشروع، ويُوزَّع على القطع بنسبة سعرها.</div><button class="act pri" style="width:100%;margin-top:12px" id="ok">حفظ</button>', function (el, close) {
    $('#ok', el).onclick = function () {
      var a = Number($('#a', el).value); if (!(a >= 0) || $('#a', el).value === '') return toast('اكتب المبلغ', true);
      close(); api('shipFee', {id: x.id, kind: $('#k', el).value, amount: a}).then(function (r) { res3(r); });
    };
  });
}
function arriveSheet(x) {
  sheet('<h2>وصول الشحنة ' + esc(x.id) + '</h2><div class="sum">ستنتقل كل قطع الشحنة من «في الطريق» إلى المخزن الرئيسي.</div>' + numField('a', 'رسوم الشحن (اختياري، ر.ع)') + '<button class="act pri" style="width:100%" id="ok">تأكيد الوصول</button>', function (el, close) {
    $('#ok', el).onclick = function () { var a = Number($('#a', el).value) || 0; close(); api('arrive', {id: x.id, ship: a}).then(function (r) { res3(r); }); };
  });
}
function supplierSheet(pre) {
  sheet('<h2>أسامة راجح</h2><div class="f"><label>العملية</label><select id="t"><option value="pay">سداد دفعة له</option><option value="buy">مشتريات منه (تزيد المستحق)</option></select></div>' + numField('a', 'المبلغ') +
    '<div class="f"><label>العملة</label><select id="c"><option>سعودي</option><option>يمني</option><option>عماني</option></select></div><div class="f"><label>ملاحظة (اختياري)</label><input id="n"></div>' +
    '<label class="row-ck" id="pr"><input type="checkbox" id="p"> مدفوعة من مال شخصي (لا تُخصم من نقد المشروع)</label><div class="sum" id="sh"></div><button class="act pri" style="width:100%" id="ok">حفظ</button>', function (el, close) {
    if (pre) $('#t', el).value = pre;
    function hint() { var sp = S.plan && S.plan.sup, a = Number($('#a', el).value) || 0, t = $('#t', el).value; $('#pr', el).style.display = t === 'pay' ? '' : 'none'; if (!sp) return; var omr = a / (sp.rates[$('#c', el).value] || 1), nb = sp.left + (t === 'pay' ? -omr : omr); $('#sh', el).innerHTML = 'المتبقي الآن ' + fmt(sp.left) + ' ر.ع' + (a > 0 ? ' · يساوي ' + fmt(omr) + ' ر.ع · بعدها <b class="' + (nb > sp.cap ? 'neg' : '') + '">' + fmt(nb) + '</b>' + (nb > sp.cap ? ' (فوق السقف ' + fmt0(sp.cap) + ')' : '') : ''); }
    ['#t', '#a', '#c'].forEach(function (k) { $(k, el).oninput = hint; $(k, el).onchange = hint; }); hint();
    $('#ok', el).onclick = function () {
      var a = Number($('#a', el).value); if (!(a > 0)) return toast('اكتب المبلغ', true);
      var t = $('#t', el).value, cur = $('#c', el).value, q = {type: t, amount: a, cur: cur, note: $('#n', el).value.trim(), personal: t === 'pay' && $('#p', el).checked};
      close();
      var sp = S.plan && S.plan.sup, omr = sp ? a / (sp.rates[cur] || 1) : 0;
      if (t === 'buy' && sp && sp.left + omr > sp.cap + 0.0005) askOverride('تجاوز سقف دين المورد', ['الدين سيصبح ' + fmt(sp.left + omr) + ' ر.ع والسقف ' + fmt0(sp.cap) + ' ر.ع'], function () { q.over = true; api('supPay', q).then(function (r) { res3(r); }); });
      else api('supPay', q).then(function (r) { res3(r); });
    };
  });
}

/* ---------- archive (receipts / invoices) ---------- */
function readFile(mode) {
  return new Promise(function (res) {
    var inp = document.createElement('input'); inp.type = 'file';
    inp.accept = mode === 'pdf' ? 'application/pdf' : 'image/*';
    if (mode === 'cam') inp.setAttribute('capture', 'environment');
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return res(null);
      busy(true);
      if (f.type === 'application/pdf') {
        if (f.size > 6000000) { busy(false); toast('الملف كبير (الحد 6 ميغا)', true); return res(null); }
        var fr = new FileReader(); fr.onload = function () { busy(false); res({data: fr.result, name: f.name, pdf: true}); }; fr.onerror = function () { busy(false); res(null); }; fr.readAsDataURL(f);
      } else compress(f, 1600, 0.8).then(function (d) { busy(false); res({data: d, name: f.name}); }).catch(function () { busy(false); toast('تعذر قراءة الصورة', true); res(null); });
    };
    inp.click();
  });
}
var ARCH_KINDS = ['تحويل مالي', 'استلام مبلغ', 'فاتورة مشتريات', 'فاتورة بوتيك', 'فاتورة مبيعات', 'أخرى'];
function addArchiveSheet(pre) {
  pre = pre || {}; var file = null;
  var refs = ((S.meta && S.meta.shipments) || []).map(function (x) { return 'شحنة ' + x; }).concat((S.meta && S.meta.boutiques) || []);
  sheet('<h2>إرفاق مرجع</h2><div class="f"><label>النوع</label><select id="k">' + ARCH_KINDS.map(function (k) { return '<option' + (k === pre.kind ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></div>' +
    '<div class="f"><label>المرجع (شحنة، بوتيك، أو أي وصف)</label><input id="r" list="rl" value="' + esc(pre.ref || '') + '"><datalist id="rl">' + refs.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>' +
    '<div class="f"><label>ملاحظة (اختياري)</label><input id="n"></div>' +
    '<div class="acts" style="margin-top:0"><button class="act" id="fc">📷 تصوير</button><button class="act" id="fg">🖼 الاستوديو</button><button class="act full" id="fp">📄 ملف PDF</button></div>' +
    '<div class="sum" id="fs" style="margin-top:10px">لم يُختر ملف بعد</div><button class="act pri" style="width:100%" id="ok">حفظ في الأرشيف</button>', function (el, close) {
    function pick(mode) { return function () { readFile(mode).then(function (f) { if (f) { file = f; $('#fs', el).textContent = 'تم اختيار: ' + (f.pdf ? 'ملف PDF' : 'صورة') + ' ✓'; } }); }; }
    $('#fc', el).onclick = pick('cam'); $('#fg', el).onclick = pick('gal'); $('#fp', el).onclick = pick('pdf');
    $('#ok', el).onclick = function () {
      if (!file) return toast('اختر صورة أو ملفاً أولاً', true);
      close(); api('archAdd', {kind: $('#k', el).value, ref: $('#r', el).value.trim(), note: $('#n', el).value.trim(), data: file.data}).then(function (r) { toast((r && r.msg) || 'تعذر الحفظ', !(r && r.ok)); });
    };
  });
}
function archiveSheet() {
  sheet('<h2>الأرشيف والإيصالات</h2><button class="act pri" style="width:100%;margin-bottom:12px" id="ad">إضافة مرجع جديد</button><div id="al"><div class="sk"></div><div class="sk"></div></div>', function (el, close) {
    $('#ad', el).onclick = function () { close(); addArchiveSheet(); };
    api('archList', {n: 40}, {silent: true}).then(function (r) {
      var box = $('#al', el); if (!box) return;
      if (!r || !r.ok) { box.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'تعذر التحميل') + '</div>'; return; }
      if (!r.items.length) { box.innerHTML = '<div class="empty">لا توجد مرفقات بعد</div>'; return; }
      box.innerHTML = r.items.map(function (x, i) {
        return '<div class="bt" data-i="' + i + '" style="cursor:pointer"><div><div class="n">' + esc(x.k) + (x.r ? ' · ' + esc(x.r) : '') + ' ‹</div><div class="m">' + esc(x.d) + ' · ' + esc(x.u) + (x.nt ? ' · ' + esc(x.nt) : '') + '</div></div></div>';
      }).join('');
      $$('.bt[data-i]', box).forEach(function (b) { b.onclick = function () { viewArchive(r.items[Number(b.getAttribute('data-i'))]); }; });
    });
  });
}
function viewArchive(x) {
  sheet('<h2>' + esc(x.k) + (x.r ? ' · ' + esc(x.r) : '') + '</h2><div class="sum">' + esc(x.d) + ' · ' + esc(x.u) + (x.nt ? '<br>' + esc(x.nt) : '') + '</div><div id="vi" class="big" style="min-height:260px"><div class="no" style="color:var(--rose-d)">جارٍ التحميل…</div></div>' +
    '<a class="act" style="display:block;text-align:center;margin-top:12px;text-decoration:none" target="_blank" rel="noopener" href="https://drive.google.com/file/d/' + esc(x.id) + '/view">فتح الملف الأصلي في درايف</a>', function (el) {
    api('photos', {ids: [x.id], sz: 900}, {silent: true}).then(function (r) {
      var box = $('#vi', el); if (!box) return;
      var u = r && r.photos && r.photos[x.id];
      box.innerHTML = u ? '<img src="' + u + '" style="width:100%;border-radius:12px">' : '<div class="no" style="color:var(--rose-d)">لا توجد معاينة، افتح الملف الأصلي</div>';
    });
  });
}

/* ---------- sales invoice ---------- */
function wrapText(ctx, t, w) {
  var words = String(t).split(' '), lines = [], cur = '';
  words.forEach(function (wd) { var test = cur ? cur + ' ' + wd : wd; if (ctx.measureText(test).width > w && cur) { lines.push(cur); cur = wd; } else cur = test; });
  if (cur) lines.push(cur); return lines.slice(0, 3);
}
function drawInvoice(items, cust, no, dateStr, logo) {
  var due = items.filter(function (i) { return String(i.ch || '').indexOf('آجل') === 0; }).reduce(function (a, i) { return a + (Number(i.ap) || 0); }, 0);
  var W = 800, P = 40, f = "'Tajawal', Arial, sans-serif", c = document.createElement('canvas'), ctx = c.getContext('2d');
  ctx.font = '22px ' + f;
  var rows = items.map(function (i) { var ap = Number(i.ap) || 0, sp = Number(i.sp) || ap; return {d: i.d, sp: sp, ds: Math.max(0, sp - ap), net: ap}; });
  rows.forEach(function (r) { r.lines = wrapText(ctx, r.d, 340); r.h = Math.max(54, r.lines.length * 30 + 22); });
  var H = 330 + rows.reduce(function (a, r) { return a + r.h; }, 0) + 290;
  c.width = W; c.height = H; ctx = c.getContext('2d'); ctx.direction = 'rtl';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#46112F'; ctx.fillRect(0, 0, W, 130);
  if (logo) { var lh = 84, lw = logo.width / logo.height * lh; ctx.drawImage(logo, (W - lw) / 2, 23, lw, lh); }
  ctx.fillStyle = '#46112F'; ctx.textAlign = 'right'; ctx.font = 'bold 36px ' + f; ctx.fillText('فاتورة مبيعات', W - P, 190);
  ctx.font = '22px ' + f; ctx.fillStyle = '#555';
  ctx.fillText('رقم الفاتورة: ' + no, W - P, 228); ctx.fillText('التاريخ: ' + dateStr, W - P, 260);
  if (cust) ctx.fillText('العميل: ' + cust, W - P, 292);
  var y = 318;
  ctx.fillStyle = '#F3E3DF'; ctx.fillRect(P, y, W - 2 * P, 46);
  ctx.fillStyle = '#46112F'; ctx.font = 'bold 20px ' + f;
  var cx = {d: W - P - 12, sp: 330, ds: 220, net: 110};
  ctx.textAlign = 'right'; ctx.fillText('الوصف', cx.d, y + 31);
  ctx.textAlign = 'center'; ctx.fillText('السعر', cx.sp, y + 31); ctx.fillText('الخصم', cx.ds, y + 31); ctx.fillText('الصافي', cx.net, y + 31);
  y += 46; var tot = 0, dis = 0;
  rows.forEach(function (r) {
    ctx.fillStyle = '#222'; ctx.font = '22px ' + f; ctx.textAlign = 'right';
    r.lines.forEach(function (l, k) { ctx.fillText(l, cx.d, y + 34 + k * 30); });
    ctx.textAlign = 'center'; ctx.fillText(fmt(r.sp), cx.sp, y + 34); ctx.fillText(r.ds > 0 ? fmt(r.ds) : '-', cx.ds, y + 34); ctx.font = 'bold 22px ' + f; ctx.fillText(fmt(r.net), cx.net, y + 34);
    y += r.h; ctx.strokeStyle = '#E8D6D2'; ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
    tot += r.net; dis += r.ds;
  });
  y += 30;
  if (dis > 0) { ctx.font = '22px ' + f; ctx.fillStyle = '#555'; ctx.textAlign = 'right'; ctx.fillText('إجمالي الخصم: ' + fmt(dis) + ' ر.ع', W - P, y); y += 40; }
  ctx.fillStyle = '#46112F'; ctx.fillRect(P, y, W - 2 * P, 70);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 30px ' + f; ctx.textAlign = 'right'; ctx.fillText('الإجمالي', W - P - 20, y + 46);
  ctx.textAlign = 'left'; ctx.fillText(fmt(tot) + ' ر.ع', P + 20, y + 46);
  y += 100; ctx.textAlign = 'right'; ctx.font = 'bold 24px ' + f;
  if (due > 0) { ctx.fillStyle = '#B3261E'; ctx.fillText('طريقة الدفع: آجل — المبلغ المستحق: ' + fmt(due) + ' ر.ع', W - P, y); }
  else { ctx.fillStyle = '#2E7D32'; ctx.fillText('الحالة: مدفوعة', W - P, y); }
  y += 60; ctx.textAlign = 'center'; ctx.fillStyle = '#46112F'; ctx.font = 'bold 24px ' + f; ctx.fillText('شكراً لتسوقكم من غزل فاشن', W / 2, y);
  ctx.fillStyle = '#888'; ctx.font = '18px ' + f; ctx.fillText('مسقط، سلطنة عُمان', W / 2, y + 34);
  return c;
}
function offerInvoice(codes) {
  var its = codes.map(byCode).filter(function (i) { return i && i.st === 'مباع'; }); if (!its.length) return;
  sheet('<h2>تم البيع</h2><div class="sum">هل تريد إصدار فاتورة للعميل؟</div><div class="acts" style="margin-top:0"><button class="act pri" id="y">إصدار فاتورة</button><button class="act" id="n">لا، شكراً</button></div>', function (el, close) {
    $('#n', el).onclick = close; $('#y', el).onclick = function () { close(); invoiceSheet(its); };
  });
}
function invoiceSheet(items) {
  var d = new Date(), pad = function (n) { return ('0' + n).slice(-2); };
  var no = 'GF-' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  var ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), canvas = null, saved = false, logo = null;
  sheet('<h2>فاتورة للعميل</h2><div class="f"><label>اسم العميل (اختياري)</label><input id="cu"></div><img id="pv" style="width:100%;border:1px solid var(--line);border-radius:12px;min-height:120px"><div class="acts"><button class="act pri" id="sh">مشاركة / حفظ الصورة</button><button class="act" id="cl">إغلاق</button></div><div class="stale" style="margin-top:10px">هذه فاتورة مبيعات عادية وليست فاتورة ضريبية. تُحفظ نسخة منها في الأرشيف عند المشاركة.</div>', function (el, close) {
    function render() {
      var go = function () { canvas = drawInvoice(items, $('#cu', el).value.trim(), no, ds, logo); $('#pv', el).src = canvas.toDataURL('image/jpeg', 0.9); };
      (document.fonts && document.fonts.load ? document.fonts.load("22px Tajawal").catch(function () {}) : Promise.resolve()).then(go);
    }
    var cr0 = items.filter(function (i) { return String(i.ch || '').indexOf('آجل - ') === 0; })[0]; if (cr0) $('#cu', el).value = String(cr0.ch).slice(6);
    var im = new Image(); im.onload = function () { logo = im; render(); }; im.onerror = render; im.src = 'icons/wordmark.png';
    var t; $('#cu', el).oninput = function () { clearTimeout(t); t = setTimeout(render, 300); };
    $('#cl', el).onclick = close;
    $('#sh', el).onclick = function () {
      if (!canvas) return;
      var cust = $('#cu', el).value.trim();
      function archive() { if (saved) return; saved = true; api('archAdd', {kind: 'فاتورة مبيعات', ref: no, note: cust, data: canvas.toDataURL('image/jpeg', 0.85)}, {silent: true}); }
      canvas.toBlob(function (blob) {
        var file = new File([blob], 'invoice-' + no + '.jpg', {type: 'image/jpeg'});
        if (navigator.canShare && navigator.canShare({files: [file]})) {
          navigator.share({files: [file], title: 'فاتورة ' + no}).then(archive).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); archive(); toast('تم حفظ الصورة');
        }
      }, 'image/jpeg', 0.9);
    };
  });
}

/* =====================================================================
   إضافات النسخة التجريبية: قواعد الخطة، مطابقة السبت، تبويب المورد، رسوم الرئيسية
   ===================================================================== */
function RL() { return (S.plan && S.plan.rules) || {buyCap: 300, disc: 10, perColor: 2, mult: 2.3, round: 0.5, debtCap: 1500}; }
function suggestPrice(tc) { var r = RL(), v = (Number(tc) || 0) * r.mult; return Math.round(Math.round(v / r.round) * r.round * 1000) / 1000; }
/* النسخة 27 (قرار بلال 16/11): حد المشتريات الشهري 300 تنبيه فقط، لا يمنع ولا يُعلَّم استثناء. «قطعتان لكل لون» باقية كما هي. */
function buyCapLine(q, b) {
  var r = RL(), P = S.plan, now = P ? P.buy.month : 0, after = now + q * b;
  if (after <= r.buyCap + 0.0005) return '';
  return 'اشتريتم هذا الشهر ' + fmt(now) + ' ر.ع، وبعد هذه ' + fmt(after) + ' ر.ع، أي فوق الحد (' + fmt0(r.buyCap) + ' ر.ع) بـ ' + fmt(after - r.buyCap) + ' ر.ع.';
}
function buyCheck(q, b, go) {
  var cap = buyCapLine(q, b), rules = q > RL().perColor ? ['العدد ' + q + ' والقاعدة قطعتان فقط لكل لون'] : [];
  if (rules.length) return askOverride('الشراء يخالف قاعدة في الخطة', rules.concat(cap ? [cap] : []), function () { go(true); });
  if (!cap) return go(false);
  sheet('<h2>تنبيه: تجاوز حد المشتريات الشهري</h2><div class="sum" style="background:#FFF4DC;color:#7A5A00">' + esc(cap) + '</div>' +
    '<button class="act pri" style="width:100%" id="y">متابعة التسجيل</button><div style="text-align:center;margin-top:10px"><button class="chip" id="n">رجوع</button></div>', function (el, close) {
    $('#y', el).onclick = function () { close(); go(false); };
    $('#n', el).onclick = function () { close(); toast('لم تُسجَّل العملية'); };
  });
}
function askOverride(title, lines, cb) {
  sheet('<h2>' + esc(title) + '</h2>' + lines.map(function (t) { return '<div class="sum" style="background:#FBE9EA;color:var(--bad)">⚠ ' + esc(t) + '</div>'; }).join('') +
    '<div class="acts" style="margin-top:0"><button class="act full" id="n">رجوع بدون تسجيل</button><button class="act dng full" id="y">متابعة كاستثناء (يُسجَّل في الملاحظة)</button></div>', function (el, close) {
    $('#y', el).onclick = function () { close(); cb(true); };
    $('#n', el).onclick = function () { close(); toast('لم تُسجَّل العملية'); };
  });
}
function bindJump(b) { $$('[data-jump]', b).forEach(function (r) { r.onclick = function () { S.tab = r.getAttribute('data-jump'); renderBody(); window.scrollTo(0, 0); }; }); }
function dmy(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }

/* ----- بطاقة قواعد الخطة ----- */
function needServer(what) { return '<div class="card"><h3>' + esc(what) + '</h3><div class="empty" style="padding:20px 10px">يحتاج تحديث الخادم إلى الإصدار الجديد. أخبر بلال.</div></div>'; }
function ruleLine(okk, label, val, bar, barBad, soft) { /* soft: تنبيه برتقالي لا مخالفة حمراء */
  var cls = okk ? 'ok' : soft ? 'wn' : 'no', col = barBad ? (soft ? 'var(--warn)' : 'var(--bad)') : 'var(--ok)';
  return '<div class="rl"><span class="ri ' + cls + '">' + (okk ? '✓' : '!') + '</span><div class="rb"><div class="rt2"><span>' + label + '</span><b>' + val + '</b></div>' + (bar == null ? '' : pbar(bar, col)) + '</div></div>';
}
function rulesCard() {
  var P = S.plan; if (!P) return '';
  var r = P.rules, rc = P.recon, s = P.sup, cashOk = P.sys.cash >= s.left;
  return '<div class="card"><h3>قواعد الخطة</h3>' +
    ruleLine(P.buy.month <= r.buyCap, 'مشتريات هذا الشهر (حد تنبيه ' + fmt0(r.buyCap) + ')', fmt(P.buy.month) + ' من ' + fmt0(r.buyCap), P.buy.month / r.buyCap, P.buy.month > r.buyCap, true) +
    ruleLine(P.low === 0, 'سعر أقل من التكلفة × ' + r.mult, P.low ? P.low + ' قطعة في المخزون' : 'لا يوجد') +
    ruleLine(s.left <= s.cap, 'دين ' + esc(s.name), fmt(s.left) + ' من ' + fmt0(s.cap), s.left / s.cap, s.left > s.cap) +
    ruleLine(cashOk, 'النقد مقابل دين المورد', fmt(P.sys.cash) + ' / ' + fmt(s.left)) +
    (cashOk ? '' : '<div class="sum" style="background:#FBE9EA;color:var(--bad);margin:8px 0 0">لا تُدفع أقساط الشقة من نقد المشروع الآن.</div>') + '</div>';
}

/* ----- رسوم الرئيسية (SVG بدون مكتبات) ----- */
var CH = {set: 'where', pick: -1, mon: -1};
function donutData(d) {
  var P = S.plan, inv = d.inv;
  /* يظهر فقط ما فيه قطع: «في الطريق» و«في المعرض» يختفيان وحدهما إن كانا صفراً. */
  if (CH.set === 'sold' && P) { var c = P.chart.channels; return [{l: 'عبر البوتيك', n: c.bt, col: 'var(--warn)'}, {l: 'في المعرض', n: c.expo || 0, col: 'var(--gold)'}, {l: 'بيع مباشر', n: c.direct, col: 'var(--ok)'}, {l: 'بيع آجل', n: c.credit, col: 'var(--info)'}].filter(function (x) { return x.n > 0; }); }
  var ex = {n: 0, v: 0}, EX = (S.meta && S.meta.expos) || [];
  ((S.inv && S.inv.items) || []).forEach(function (i) { if (i.st === 'في البوتيك' && EX.indexOf(i.loc) >= 0) { ex.n++; ex.v += Number(i.tc) || 0; } });
  return [{l: 'في المخزن', n: inv.main.n, v: inv.main.v, col: 'var(--ok)'}, {l: 'في البوتيكات', n: inv.boutique.n - ex.n, v: inv.boutique.v - ex.v, col: 'var(--warn)'}, {l: 'في المعرض', n: ex.n, v: ex.v, col: 'var(--gold)'}, {l: 'في الطريق', n: inv.transit.n, v: inv.transit.v, col: 'var(--info)'}].filter(function (x) { return x.n > 0; });
}
function donutHTML(d) {
  var data = donutData(d), tot = 0, R = 54, CIR = 2 * Math.PI * R, cum = 0;
  data.forEach(function (x) { tot += x.n; });
  var segs = data.map(function (x, i) {
    var len = tot ? x.n / tot * CIR : 0, s = '<circle class="seg' + (CH.pick === i ? ' on' : '') + '" data-i="' + i + '" cx="80" cy="80" r="' + R + '" fill="none" stroke="' + x.col + '" stroke-width="' + (CH.pick === i ? 26 : 20) + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (CIR - len).toFixed(2) + '" stroke-dashoffset="' + (-cum).toFixed(2) + '"></circle>';
    cum += len; return s;
  }).join('');
  var p = data[CH.pick], mid = p ? '<text x="80" y="74" text-anchor="middle" class="dn">' + fmt0(p.n) + '</text><text x="80" y="96" text-anchor="middle" class="dl">' + esc(p.l) + '</text>' : '<text x="80" y="74" text-anchor="middle" class="dn">' + fmt0(tot) + '</text><text x="80" y="96" text-anchor="middle" class="dl">' + (CH.set === 'sold' ? 'قطعة مباعة' : 'قطعة عندنا') + '</text>';
  return '<div class="dwrap"><svg viewBox="0 0 160 160" class="donut" role="img" aria-label="توزيع القطع"><circle cx="80" cy="80" r="' + R + '" fill="none" stroke="#EADCDD" stroke-width="20"></circle><g transform="rotate(-90 80 80)">' + segs + '</g>' + mid + '</svg>' +
    '<div class="dleg">' + data.map(function (x, i) { return '<button class="lg' + (CH.pick === i ? ' on' : '') + '" data-i="' + i + '"><i style="background:' + x.col + '"></i><span>' + esc(x.l) + '</span><b>' + fmt0(x.n) + (x.v != null ? '<small>' + fmt(x.v) + ' ر.ع</small>' : '') + '</b></button>'; }).join('') + '</div></div>';
}
function barsHTML() {
  var P = S.plan; if (!P) return '';
  var ms = P.chart.months, mx = 1; ms.forEach(function (m) { mx = Math.max(mx, m.t, m.c); });
  var sel = CH.mon >= 0 ? ms[CH.mon] : ms.filter(function (m) { return m.cur; })[0];
  return '<div class="mbars">' + ms.map(function (m, i) {
    return '<button class="mcol' + (m.cur ? ' cur' : '') + (sel === m ? ' on' : '') + '" data-m="' + i + '"><span class="mv">' + m.c + (m.t ? '<small>/' + m.t + '</small>' : '') + '</span><span class="mtrack"><span class="mt" style="height:' + Math.round(m.t / mx * 100) + '%"></span><span class="mc" data-h="' + Math.round(m.c / mx * 100) + '" style="height:0%"></span></span><span class="ml">' + esc(m.l) + '</span></button>';
  }).join('') + '</div>' + (sel ? '<div class="sum" style="margin:10px 0 0">' + esc(sel.l) + ': بيعت <b>' + sel.c + '</b>' + (sel.t ? ' من هدف <b>' + sel.t + '</b> قطعة' : ' قطعة') + ' · المبيعات ' + fmt(sel.sales) + ' · صافي الربح <b class="' + (sel.net >= 0 ? 'pos' : 'neg') + '">' + fmt(sel.net) + '</b></div>' : '');
}
function homeCharts(d) {
  return '<div class="card" id="chd"><h3>أين القطع وكيف بيعت</h3><div class="chips" style="margin-bottom:2px"><button class="chip' + (CH.set === 'where' ? ' on' : '') + '" data-set="where">أين القطع الآن</button><button class="chip' + (CH.set === 'sold' ? ' on' : '') + '" data-set="sold">كيف بيعت</button></div><div id="dn">' + donutHTML(d) + '</div><div class="stale" style="margin:6px 0 0">اضغطي على أي لون لرؤية تفاصيله</div></div>' +
    '';
}
/* أعمدة الأشهر نُقلت إلى تبويب الأهداف، و«النقد مقابل دين المورد» أُزيلت من الرئيسية لأنها مكررة مع تبويب المورد وبطاقة القواعد. */
function barsCard() { return S.plan ? '<div class="card" id="chm"><h3>القطع المباعة كل شهر مقابل الهدف</h3><div id="mb">' + barsHTML() + '</div><div class="stale" style="margin:6px 0 0">اضغطي على شهر لرؤية مبيعاته وربحه</div></div>' : ''; }
function animateCharts(b) { setTimeout(function () { $$('.mc', b).forEach(function (e) { e.style.height = e.getAttribute('data-h') + '%'; }); $$('.hf', b).forEach(function (e) { e.style.width = e.getAttribute('data-w') + '%'; }); }, 40); }
function bindCharts(b, d) {
  function bindDonut() { $$('#dn [data-i]', b).forEach(function (e) { e.onclick = function () { var i = Number(e.getAttribute('data-i')); CH.pick = CH.pick === i ? -1 : i; $('#dn', b).innerHTML = donutHTML(d); bindDonut(); }; }); }
  function bindBars() { $$('#mb [data-m]', b).forEach(function (e) { e.onclick = function () { CH.mon = Number(e.getAttribute('data-m')); $('#mb', b).innerHTML = barsHTML(); bindBars(); animateCharts(b); }; }); }
  $$('#chd [data-set]', b).forEach(function (e) { e.onclick = function () { CH.set = e.getAttribute('data-set'); CH.pick = -1; $$('#chd [data-set]', b).forEach(function (x) { x.classList.toggle('on', x === e); }); $('#dn', b).innerHTML = donutHTML(d); bindDonut(); }; });
  if ($('#dn', b)) bindDonut(); if ($('#mb', b)) bindBars(); animateCharts(b);
}

/* ----- الشهور: بطاقة شهر واحد مع أسهم للتنقل، وتفاصيل المصروفات، وقفل الشهر المنتهي ----- */
var MON = {k: ''};
function monthData(fallback) {
  var L = (S.plan && S.plan.mlist) || [], cur = L.filter(function (x) { return x.k === MON.k; })[0];
  if (!cur && L.length) { cur = L[L.length - 1]; MON.k = cur.k; }
  return {list: L, cur: cur, i: L.indexOf(cur)};
}
function monthCard(m) {
  var D = monthData(), x = D.cur;
  if (!x) return '<div class="card"><h3>أرباح وخسائر الشهر</h3><div class="kv"><span>المبيعات</span><b>' + fmt(m.sales) + '</b></div><div class="kv"><span>صافي الربح</span><b class="' + (m.net >= 0 ? 'pos' : 'neg') + '">' + fmt(m.net) + '</b></div></div>';
  return '<div class="card"><div class="msw"><button id="mprev"' + (D.i <= 0 ? ' disabled' : '') + ' aria-label="الشهر السابق">›</button><div><b>' + esc(x.l) + '</b><span class="mtag ' + (x.closed ? 'cl' : 'op') + '">' + (x.closed ? '🔒 شهر منتهٍ' : 'الشهر الحالي') + '</span></div><button id="mnext"' + (D.i >= D.list.length - 1 ? ' disabled' : '') + ' aria-label="الشهر التالي">‹</button></div>' +
    '<div style="text-align:center;margin:8px 0 4px"><span class="mtag ' + (x.net >= 0 ? 'op' : 'bd') + '">' + (x.net >= 0 ? 'ربح' : 'خسارة') + (x.closed ? '' : ' حتى الآن') + '</span></div>' +
    '<div class="kv"><span>دخل: المبيعات <small style="color:var(--mute)">(' + fmt0(x.qty) + ' قطعة)</small></span><b class="pos">' + fmt(x.sales) + '</b></div>' +
    '<div class="kv"><span>خرج: تكلفة القطع المباعة</span><b>' + fmt(x.soldCost) + '</b></div>' +
    (x.giftN ? '<div class="kv"><span>خرج: هدايا <small style="color:var(--mute)">(' + x.giftN + ' قطعة)</small></span><b>' + fmt(x.gifts) + '</b></div>' : '') +
    '<div class="bt jump" id="mexp"><div><div class="n" style="font-weight:500">خرج: الإيجار والمصاريف ‹</div><div class="m">' + (x.expenses.length ? x.expenses.length + ' بند · اضغطي للتفاصيل' : 'لا مصروفات مسجّلة') + '</div></div><div class="o" style="color:var(--ink)">' + fmt(x.opex) + '</div></div>' +
    '<div class="kv"><span><b>الصافي</b></span><b class="' + (x.net >= 0 ? 'pos' : 'neg') + '">' + fmt(x.net) + '</b></div>' +
    (x.draws ? '<div class="kv"><span>مسحوبات شخصية (خارج الربح)</span><b>' + fmt(x.draws) + '</b></div>' : '') +
    (x.first ? '<div class="sum" style="margin:8px 0 0;background:#FFF4DC;color:#7A5A00">النظام بدأ يوم ' + dmy(S.plan.start) + '. ما قبله غير مسجّل هنا، مثل إيجار هذا الشهر ومبيعات البوتيك في أوله.</div>' : '') +
    (x.edits && x.edits.length ? '<div class="sum" style="margin:8px 0 0">تعديلات بعد انتهاء الشهر: ' + x.edits.map(function (e) { return esc(e.what) + ' (' + esc(e.by) + '، ' + dmy(e.d) + ')'; }).join(' · ') + '</div>' : '') + '</div>';
}
function bindMonth(b, m) {
  var D = monthData(), box = $('#mcard', b); if (!box || !D.cur) return;
  function go(k) { var n = D.list[D.i + k]; if (!n) return; MON.k = n.k; box.innerHTML = monthCard(m); bindMonth(b, m); }
  var p = $('#mprev', box), n = $('#mnext', box), e = $('#mexp', box);
  if (p) p.onclick = function () { go(-1); }; if (n) n.onclick = function () { go(1); };
  if (e) e.onclick = function () { expSheet(D.cur); };
}
function expSheet(x) {
  sheet('<h2>مصروفات ' + esc(x.l) + '</h2><div class="sum">المجموع <b>' + fmt(x.opex) + ' ر.ع</b> · ' + x.expenses.length + ' بند' + (x.closed ? '<br>🔒 الشهر منتهٍ. الحذف والتعديل من حساب بلال فقط، من «سجل الحركات».' : '') + '</div>' +
    (x.expenses.length ? x.expenses.map(function (e) { return '<div class="bt"><div><div class="n">' + esc(e.nt || e.p || 'مصروف') + '</div><div class="m">' + esc(e.d) + (e.p ? ' · ' + esc(e.p) : '') + (e.per ? ' · من مال شخصي' : '') + '</div></div><div class="o">' + fmt(e.a) + '</div></div>'; }).join('') : '<div class="empty">لا مصروفات مسجّلة في هذا الشهر</div>') +
    (x.closed ? '' : '<button class="act pri" style="width:100%;margin-top:12px" id="ne">تسجيل مصروف جديد</button>'), function (el, close) {
    if ($('#ne', el)) $('#ne', el).onclick = function () { close(); expenseSheet(); };
  });
}
/* الشهر المنتهي: غزل تُمنع برسالة واضحة، وبلال يُنبَّه ثم يتابع ويُسجَّل التعديل */
function lateEdit(mk, what, run) {
  var cur = (S.plan && S.plan.today || new Date().toISOString().slice(0, 10)).slice(0, 7);
  if (!mk || mk >= cur) return run(false);
  var nm = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][Number(mk.slice(5, 7)) - 1];
  if (S.user !== 'belal') return sheet('<h2>🔒 شهر ' + nm + ' منتهٍ</h2><div class="sum">' + esc(what) + '.<br>أرقام الشهر المنتهي لا تتغير من هذا الحساب. اطلبي من بلال أن يعدّلها من حسابه.</div><button class="act pri" style="width:100%" id="ok">فهمت</button>', function (el, close) { $('#ok', el).onclick = close; });
  askOverride('تعديل على شهر منتهٍ (' + nm + ')', [what, 'سيتغير ربح ذلك الشهر ويُسجَّل التعديل باسمك وتاريخه'], function () { run(true); });
}

/* ----- تغطية المخزون بالأشهر (تعريف بلال): القطع غير المباعة ÷ متوسط القطع المباعة شهرياً في آخر 3 أشهر (90 يوماً، أو منذ بدء النظام إن كان أقصر) ----- */
function coverCard() {
  var c = S.plan && S.plan.cover; if (!c) return '';
  var mo = c.months, txt = mo == null ? 'لا مبيعات بعد' : (Math.round(mo * 10) / 10) + ' شهر';
  return '<div class="card"><h3>تغطية المخزون</h3><div class="bigv">' + txt + '</div>' +
    '<div class="stale" style="margin:0 0 8px">عندنا ' + fmt0(c.pcs) + ' قطعة · نبيع نحو ' + (Math.round(c.avg * 10) / 10) + ' قطعة في الشهر (آخر ' + c.days + ' يوماً)</div>' +
    ruleLine(mo != null && mo < 8, 'شرط بوابة 31 ديسمبر', 'أقل من 8 أشهر') +
    ruleLine(mo != null && mo < 4, 'شرط أي شراء جديد', 'أقل من 4 أشهر') + '</div>';
}

/* ----- الموديلات الراكدة (من بيانات المخزون، بلا خادم) ----- */
function dayDiff(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5); }
function slowList() {
  var P = S.plan, inv = S.inv; if (!P || !inv || !inv.models) return [];
  return inv.models.map(function (x) {
    var s = modelStats(x.m), stock = s.total - s.sold - s.tr, last = '';
    s.items.forEach(function (i) { if (i.st === 'مباع' && String(i.ch || '').indexOf('هدية') !== 0 && i.sd > last) last = i.sd; });
    return {m: x.m, n: x.n, stock: stock, main: s.loc[MAIN] || 0, bt: stock - (s.loc[MAIN] || 0), last: last, days: dayDiff(last || P.start, P.today), sp: s.first ? s.first.sp : 0};
  }).filter(function (x) { return x.stock > 0; }).sort(function (a, b) { return b.days - a.days || b.stock - a.stock; });
}
function slowCard() {
  var L = slowList(); if (!L.length) return '';
  var slow = L.filter(function (x) { return x.days >= 30; }), never = L.filter(function (x) { return !x.last; }), pcs = 0, npcs = 0;
  slow.forEach(function (x) { pcs += x.stock; }); never.forEach(function (x) { npcs += x.stock; });
  return '<div class="card"><h3>الموديلات الراكدة</h3><div class="kv"><span>بلا بيع منذ 30 يوماً أو أكثر</span><b>' + slow.length + ' موديل · ' + pcs + ' قطعة</b></div>' +
    '<div class="kv"><span>لم يُبع منها شيء منذ بدء النظام</span><b>' + never.length + ' موديل · ' + npcs + ' قطعة</b></div>' +
    '<button class="chip" id="slw" style="margin-top:10px">عرض القائمة مرتبة ‹</button></div>';
}
function slowSheet() {
  var L = slowList();
  sheet('<h2>الموديلات من الأبطأ إلى الأسرع</h2><div class="stale" style="margin:-6px 0 10px">اضغطي على موديل لفتحه (نقل، إرجاع، بيع)</div>' + L.map(function (x) {
    return '<div class="bt" data-sm="' + esc(x.m) + '" style="cursor:pointer"><div><div class="n">' + esc(x.m) + (x.n ? ' · ' + esc(x.n) : '') + ' ‹</div><div class="m">' + (x.last ? 'آخر بيع ' + dmy(x.last) + ' · منذ ' + x.days + ' يوماً' : 'لم يُبع بعد · ' + x.days + ' يوماً منذ بدء النظام') + ' · مخزن ' + x.main + ' · بوتيك ' + x.bt + '</div></div><div class="o ' + (x.days >= 30 ? 'neg' : '') + '">' + x.stock + '<div class="m">قطعة</div></div></div>';
  }).join(''), function (el, close) {
    $$('[data-sm]', el).forEach(function (r) { r.onclick = function () { close(); modelSheet(r.getAttribute('data-sm')); }; });
  });
}

/* ----- ربط المطابقة بشاشة الجرد الموجودة (النسخة 25) ----- */
function kindOf(p, sys) { return p.k === MAIN ? 'main' : (sys.places.length === 2 ? 'bt' : ''); }
function countDraft() {
  var d = {}; try { d = JSON.parse(localStorage.getItem('gz_count') || '{}'); } catch (e) {}
  var out = {main: {sys: 0, act: 0, done: 0, diffs: []}, bt: {sys: 0, act: 0, done: 0, diffs: []}};
  ((S.inv && S.inv.models) || []).forEach(function (x) {
    var s = modelStats(x.m);
    ['main', 'bt'].forEach(function (w) {
      var n = 0; s.locs.forEach(function (l) { if ((w === 'main') === (l === MAIN)) n += s.loc[l]; });
      var a = d[w + x.m], has = a != null; out[w].sys += n; out[w].act += has ? a : n;
      if (has) { out[w].done++; if (a !== n) out[w].diffs.push({m: x.m, sys: n, act: a}); }
    });
  });
  return out;
}

/* ----- مطابقة السبت: ثلاث خطوات بالنقر ----- */
var CASH_WHY = ['مصروف لم أسجّله', 'بيع لم أسجّله', 'مبلغ استلمته ولم أسجّله', 'لا أعرف السبب'];
var STOCK_WHY = ['قطعة بيعت ولم تُسجَّل', 'قطعة نُقلت ولم تُسجَّل', 'قطعة مفقودة', 'لا أعرف السبب'];
function rcNew() { return {step: 0, cashSame: null, cash: '', cashWhy: '', counts: {}, same: {}, why: '', paid: null}; }
function stepDots(n) { return '<div class="dots">' + [1, 2, 3].map(function (i) { return '<span class="' + (i <= n ? 'on' : '') + '">' + i + '</span>'; }).join('<em></em>') + '</div>'; }
function whyChips(list, cur, attr) { return '<div class="cats">' + list.map(function (t) { return '<button class="chip' + (cur === t ? ' on' : '') + '" ' + attr + '="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>'; }
function viewRecon() {
  var b = $('#body'), P = S.plan;
  if (!P) { b.innerHTML = S.stamp ? needServer('مطابقة السبت') : '<div class="sk" style="height:170px"></div><div class="sk"></div>'; return; }
  if (!S.rc) S.rc = rcNew();
  var rc = S.rc, r = P.recon, sys = P.sys, h = '';
  if (rc.step === 0) {
    var last = P.hist[0];
    h = '<div class="hero"><div class="l">مطابقة أسبوع السبت ' + dmy(r.due) + '</div><div class="v" style="font-size:26px">' + (r.done ? '✓ مسجّلة' : (r.isSat ? 'موعدها اليوم' : 'لم تُسجَّل بعد')) + '</div>' +
      '<div class="row"><div>الالتزام<b>' + (r.tot ? r.ok + ' من ' + r.tot : '—') + '</b></div><div>السبت القادم<b>' + dmy(r.isSat && !r.done ? r.due : r.next) + '</b></div><div>المدة<b>10 دقائق</b></div></div></div>' +
      '<div class="card"><h3>ماذا نفعل؟</h3><div class="kv"><span>1 · النقد</span><b>نقارن ما معك بما في النظام</b></div><div class="kv"><span>2 · القطع</span><b>نعدّ ما في البيت وما في البوتيك</b></div><div class="kv"><span>3 · المورد</span><b>نراجع الدين</b></div>' +
      '<button class="act pri" style="width:100%;margin-top:12px" id="st">' + (r.done ? 'إعادة مطابقة هذا الأسبوع' : 'ابدأ المطابقة') + '</button></div>' +
      '<div class="card"><h3>المطابقات السابقة</h3>' + (P.hist.length ? P.hist.map(function (x) {
        var sd = 0; (x.stock || []).forEach(function (s) { sd += Math.abs(s.counted - s.sys); });
        var okk = Math.abs(x.cashDiff) < 0.0005 && !sd;
        return '<div class="bt"><div><div class="n">' + (okk ? '✓ ' : '⚠ ') + 'سبت ' + dmy(x.week) + '</div><div class="m">سجّلتها ' + esc(x.by || '') + ' في ' + dmy(x.date) + (okk ? ' · كل شيء مطابق' : (Math.abs(x.cashDiff) >= 0.0005 ? ' · فرق نقد ' + fmt(x.cashDiff) + ' (' + esc(x.cashNote) + ')' : '') + (sd ? ' · فرق ' + sd + ' قطعة (' + esc(x.note) + ')' : '')) + ((x.models || []).length ? '<br>فروقات الجرد: ' + x.models.map(function (q) { return esc(q.m) + ' ' + esc(q.w) + ' ' + q.act + ' بدل ' + q.sys; }).join('، ') : (x.counted ? '<br>جُرد ' + x.counted + ' موديلاً بلا فروقات' : '')) + '</div></div><div class="o ' + (okk ? 'pos' : 'neg') + '">' + (okk ? 'مطابق' : 'فرق') + '</div></div>';
      }).join('') : '<div class="empty" style="padding:16px 10px">لا توجد مطابقات بعد</div>') + '</div>';
    b.innerHTML = h; $('#st', b).onclick = function () { S.rc = rcNew(); S.rc.step = 1; viewRecon(); window.scrollTo(0, 0); };
    return;
  }
  if (rc.step === 1) {
    h = stepDots(1) + '<div class="card"><h3>1 · النقد</h3><div class="sum" style="text-align:center;margin-bottom:8px">النظام يقول إن نقد المشروع الآن</div><div class="bigv">' + fmt(sys.cash) + ' <small>ر.ع</small></div>' +
      '<div class="stale">عدّي النقد الموجود فعلاً ثم اختاري</div>' +
      '<div class="acts" style="margin-top:6px"><button class="act full' + (rc.cashSame === true ? ' pri' : '') + '" id="cs">نعم، نفس المبلغ ✓</button><button class="act full' + (rc.cashSame === false ? ' pri' : '') + '" id="cd">لا، المبلغ مختلف</button></div>' +
      (rc.cashSame === false ? '<div class="f" style="margin-top:12px"><label>كم النقد الموجود معك؟ (ر.ع)</label><input id="ca" type="number" inputmode="decimal" step="0.001" value="' + esc(rc.cash) + '"></div><div class="sum" id="cdf"></div><div class="f"><label>ما سبب الفرق؟</label>' + whyChips(CASH_WHY, rc.cashWhy, 'data-cw') + '</div>' : '') +
      '</div><div class="acts"><button class="act" id="bk">رجوع</button><button class="act pri" id="nx">التالي ‹</button></div>';
    b.innerHTML = h;
    $('#cs', b).onclick = function () { rc.cashSame = true; rc.cash = sys.cash; rc.cashWhy = ''; rc.step = 2; viewRecon(); window.scrollTo(0, 0); };
    $('#cd', b).onclick = function () { rc.cashSame = false; if (rc.cash === sys.cash) rc.cash = ''; viewRecon(); var i = $('#ca'); if (i) i.focus(); };
    if ($('#ca', b)) {
      var df = function () { var v = $('#ca', b).value; rc.cash = v; var d = v === '' ? null : Math.round((Number(v) - sys.cash) * 1000) / 1000; $('#cdf', b).innerHTML = d == null ? 'اكتبي المبلغ' : Math.abs(d) < 0.0005 ? '<span class="pos">نفس مبلغ النظام ✓</span>' : 'الفرق: <b class="neg" style="direction:ltr;display:inline-block">' + (d > 0 ? '+' : '') + fmt(d) + '</b> ر.ع (' + (d > 0 ? 'معك أكثر من النظام' : 'معك أقل من النظام') + ')'; };
      $('#ca', b).oninput = df; df();
      $$('[data-cw]', b).forEach(function (c) { c.onclick = function () { rc.cashWhy = c.getAttribute('data-cw'); $$('[data-cw]', b).forEach(function (x) { x.classList.toggle('on', x === c); }); }; });
    }
    $('#bk', b).onclick = function () { rc.step = 0; viewRecon(); };
    $('#nx', b).onclick = function () {
      if (rc.cashSame === null) return toast('اختاري: نفس المبلغ أم مختلف', true);
      if (rc.cashSame === false) { if (rc.cash === '' || isNaN(Number(rc.cash))) return toast('اكتبي النقد الموجود معك', true); if (Math.abs(Number(rc.cash) - sys.cash) >= 0.0005 && !rc.cashWhy) return toast('اختاري سبب الفرق', true); }
      rc.step = 2; viewRecon(); window.scrollTo(0, 0);
    };
    return;
  }
  if (rc.step === 2) {
    var anyDiff = sys.places.some(function (p) { return rc.same[p.k] === false && rc.counts[p.k] !== '' && Number(rc.counts[p.k]) !== p.pcs; });
    h = stepDots(2) + sys.places.map(function (p, i) {
      return '<div class="card"><h3>2 · ' + esc(p.n) + '</h3><div class="sum" style="text-align:center;margin-bottom:8px">النظام يقول</div><div class="bigv">' + fmt0(p.pcs) + ' <small>قطعة</small></div>' +
        '<div class="acts" style="margin-top:6px"><button class="act' + (rc.same[p.k] === true ? ' pri' : '') + '" data-ps="' + i + '">نفس العدد ✓</button><button class="act' + (rc.same[p.k] === false ? ' pri' : '') + '" data-pd="' + i + '">العدد مختلف</button></div>' +
        (rc.same[p.k] === false ? '<div class="f" style="margin-top:12px"><label>كم قطعة وجدتِ؟</label><input data-pc="' + i + '" type="number" inputmode="numeric" step="1" min="0" value="' + esc(rc.counts[p.k] == null ? '' : rc.counts[p.k]) + '"></div>' : '') +
        (kindOf(p, sys) ? '<button class="chip" style="margin-top:10px" data-pj="' + i + '">خذي الرقم من الجرد بالموديل</button>' : '') + '</div>';
    }).join('') + (sys.transit ? '<div class="stale">في الطريق ' + sys.transit + ' قطعة لا تُعدّ الآن</div>' : '') +
      '<button class="act" style="width:100%;margin-bottom:12px" id="oj">فتح الجرد بالموديل (عدّ تفصيلي) ‹</button>' +
      '<div class="card' + (anyDiff ? '' : ' hide') + '" id="wy"><h3>ما سبب فرق القطع؟</h3>' + whyChips(STOCK_WHY, rc.why, 'data-sw') + '</div>' +
      '<div class="acts"><button class="act" id="bk">رجوع</button><button class="act pri" id="nx">التالي ‹</button></div>';
    b.innerHTML = h;
    function hasDiff() { return sys.places.some(function (p) { return rc.same[p.k] === false && rc.counts[p.k] !== '' && rc.counts[p.k] != null && Number(rc.counts[p.k]) !== p.pcs; }); }
    $$('[data-ps]', b).forEach(function (e) { e.onclick = function () { var p = sys.places[Number(e.getAttribute('data-ps'))]; rc.same[p.k] = true; rc.counts[p.k] = p.pcs; viewRecon(); }; });
    $$('[data-pd]', b).forEach(function (e) { e.onclick = function () { var i = Number(e.getAttribute('data-pd')), p = sys.places[i]; rc.same[p.k] = false; rc.counts[p.k] = ''; viewRecon(); var inp = $('[data-pc="' + i + '"]'); if (inp) inp.focus(); }; });
    $$('[data-pc]', b).forEach(function (e) { e.oninput = function () { var p = sys.places[Number(e.getAttribute('data-pc'))]; rc.counts[p.k] = e.value; $('#wy', b).classList.toggle('hide', !hasDiff()); }; });
    $$('[data-sw]', b).forEach(function (c) { c.onclick = function () { rc.why = c.getAttribute('data-sw'); $$('[data-sw]', b).forEach(function (x) { x.classList.toggle('on', x === c); }); }; });
    $('#oj', b).onclick = function () { if (S.inv && S.inv.models && S.inv.models.length) countSheet(); else toast('لا توجد موديلات للجرد', true); };
    $$('[data-pj]', b).forEach(function (e) { e.onclick = function () {
      var p = sys.places[Number(e.getAttribute('data-pj'))], x = countDraft()[kindOf(p, sys)];
      if (!x || !x.done) return toast('لم يُعدّ شيء في الجرد بعد. افتحي الجرد بالموديل أولاً', true);
      rc.counts[p.k] = x.act; rc.same[p.k] = x.act === p.pcs; viewRecon(); toast('من الجرد: ' + x.act + ' قطعة (عُدّ ' + x.done + ' موديلاً، فروقات ' + x.diffs.length + ')');
    }; });
    $('#bk', b).onclick = function () { rc.step = 1; viewRecon(); };
    $('#nx', b).onclick = function () {
      var miss = sys.places.some(function (p) { return rc.same[p.k] == null || rc.counts[p.k] === '' || rc.counts[p.k] == null; });
      if (miss) return toast('اختاري لكل مكان: نفس العدد أم مختلف', true);
      if (hasDiff() && !rc.why) return toast('اختاري سبب فرق القطع', true);
      if (!hasDiff()) rc.why = '';
      rc.step = 3; viewRecon(); window.scrollTo(0, 0);
    };
    return;
  }
  var s = P.sup, cd = Math.round((Number(rc.cash) - sys.cash) * 1000) / 1000, sd = 0;
  sys.places.forEach(function (p) { sd += Math.abs(Number(rc.counts[p.k]) - p.pcs); });
  h = stepDots(3) + '<div class="card"><h3>3 · المورد</h3><div class="sum" style="text-align:center;margin-bottom:8px">المتبقي علينا لـ' + esc(s.name) + '</div><div class="bigv">' + fmt(s.left) + ' <small>ر.ع</small></div>' + pbar(s.left / s.cap, s.left > s.cap ? 'var(--bad)' : 'var(--wine)') + '<div class="stale">السقف ' + fmt0(s.cap) + ' ر.ع</div>' +
    '<div class="f"><label>هل دُفع له شيء هذا الأسبوع ولم يُسجَّل؟</label><div class="acts" style="margin-top:0"><button class="act' + (rc.paid === false ? ' pri' : '') + '" id="pn">لا</button><button class="act' + (rc.paid === true ? ' pri' : '') + '" id="py">نعم، أسجّله الآن</button></div></div></div>' +
    '<div class="card"><h3>الخلاصة</h3><div class="kv"><span>النقد</span><b class="' + (Math.abs(cd) < 0.0005 ? 'pos' : 'neg') + '">' + (Math.abs(cd) < 0.0005 ? 'مطابق ✓' : 'فرق ' + fmt(cd) + ' · ' + esc(rc.cashWhy)) + '</b></div><div class="kv"><span>القطع</span><b class="' + (sd ? 'neg' : 'pos') + '">' + (sd ? 'فرق ' + sd + ' قطعة · ' + esc(rc.why) : 'مطابق ✓') + '</b></div>' +
    (Math.abs(cd) >= 0.0005 || sd ? '<div class="sum" style="margin-top:8px">الفرق يُحفظ مع سببه ليراجعه بلال. لا يتغير شيء في الأرقام تلقائياً.</div>' : '') + '</div>' +
    '<div class="acts"><button class="act" id="bk">رجوع</button><button class="act pri" id="sv">حفظ المطابقة</button></div>';
  b.innerHTML = h;
  $('#pn', b).onclick = function () { rc.paid = false; viewRecon(); };
  $('#py', b).onclick = function () { rc.paid = true; viewRecon(); supplierSheet('pay'); };
  $('#bk', b).onclick = function () { rc.step = 2; viewRecon(); };
  $('#sv', b).onclick = function () {
    if (rc.paid === null) return toast('أجيبي عن سؤال المورد', true);
    var cdr = countDraft(), mdl = cdr.main.diffs.map(function (x) { return {m: x.m, w: 'المخزن', sys: x.sys, act: x.act}; }).concat(cdr.bt.diffs.map(function (x) { return {m: x.m, w: 'البوتيك', sys: x.sys, act: x.act}; }));
    api('reconSave', {cash: Number(rc.cash), cashNote: rc.cashWhy, counts: rc.counts, note: rc.why, paid: rc.paid, models: mdl, counted: cdr.main.done + cdr.bt.done}).then(function (r2) {
      if (r2 && r2.ok) { S.rc = null; toast(r2.msg || 'تم'); loadAll(true); } else toast((r2 && r2.msg) || 'لم تُحفظ المطابقة', true);
    });
  };
}

/* ----- تبويب المورد ----- */
function viewSup() {
  var b = $('#body'), P = S.plan;
  if (!P) { b.innerHTML = S.stamp ? needServer('تبويب المورد') : '<div class="sk" style="height:170px"></div><div class="sk"></div>'; return; }
  var s = P.sup, over = s.left > s.cap + 0.0005, near = !over && s.left >= s.cap * 0.8;
  b.innerHTML = '<div class="hero"><div class="l">المتبقي علينا لـ' + esc(s.name) + '</div><div class="v">' + fmt(s.left) + '<small>ر.ع</small></div>' +
    '<div style="height:10px;background:rgba(255,255,255,.18);border-radius:6px;overflow:hidden;margin:0 0 10px"><div style="height:100%;width:' + Math.min(100, Math.round(s.left / s.cap * 100)) + '%;background:' + (over ? '#FF8A92' : 'var(--gold)') + '"></div></div>' +
    '<div class="row"><div>سقف الدين<b>' + fmt0(s.cap) + '</b></div><div>المتاح تحت السقف<b>' + fmt(Math.max(0, s.cap - s.left)) + '</b></div><div>النقد الآن<b>' + fmt(P.sys.cash) + '</b></div></div></div>' +
    (over ? '<div class="sum" style="background:#FBE9EA;color:var(--bad)">⚠ الدين فوق السقف. لا مشتريات جديدة منه حتى ينزل.</div>' : near ? '<div class="sum" style="background:#FFF4DC;color:#7A5A00">الدين قريب من السقف.</div>' : '') +
    '<div class="acts" style="margin-top:0;margin-bottom:12px"><button class="act pri" id="sp1">سداد دفعة له</button><button class="act" id="sp2">مشتريات منه</button></div>' +
    '<div class="card"><h3>آخر الحركات</h3>' + (s.moves.length ? s.moves.map(function (m) {
      return '<div class="bt"><div><div class="n">' + (m.t === 'pay' ? 'سداد' : 'مشتريات') + '</div><div class="m">' + esc(m.d) + ' · ' + fmt0(m.a) + ' ' + esc(m.cur) + (m.per ? ' · من مال شخصي' : '') + (m.nt ? ' · ' + esc(m.nt) : '') + '</div></div><div class="o ' + (m.t === 'pay' ? 'pos' : '') + '">' + (m.t === 'pay' ? '−' : '+') + fmt(m.omr) + '</div></div>';
    }).join('') : '<div class="empty" style="padding:16px 10px">لا توجد دفعات أو مشتريات مسجلة بعد</div>') + '</div>' +
    '<div class="card"><h3>أسعار الصرف</h3>' + Object.keys(s.rates).filter(function (k) { return s.rates[k] !== 1; }).map(function (k) { return '<div class="kv"><span>ريال ' + esc(k) + '</span><b>' + fmt0(s.rates[k]) + ' لكل 1 ر.ع</b></div>'; }).join('') + '</div>' +
    '<button class="act" style="width:100%" id="sp3">كل الشحنات والموردين ‹</button>';
  $('#sp1', b).onclick = function () { supplierSheet('pay'); };
  $('#sp2', b).onclick = function () { supplierSheet('buy'); };
  $('#sp3', b).onclick = shipsSheet;
}

/* ---------- start ---------- */
if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js?v=26').catch(function () {}); }); }
render();
if (S.token) loadAll(true);
document.addEventListener('visibilitychange', function () { if (!document.hidden && S.token && Date.now() - S.stamp > 60000) loadAll(true); });
})();
