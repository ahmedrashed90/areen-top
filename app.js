import {
  auth, db, watchAuth, loginWithUsername, logout, createAuthUserWithoutSwitching,
  usernameToEmail, normalizeUsername,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
  writeBatch, runTransaction, serverTimestamp
} from './firebase.js';
import { t, months } from './i18n.js';

const state = {
  lang: localStorage.getItem('areen_lang') || 'ar',
  user: null,
  profile: null,
  page: null,
  regions: [],
  reps: [],
  customers: [],
  products: [],
  reportRows: [],
  reportColumns: [],
  reportTitle: '',
  dashboard: {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    region: '',
    rep: ''
  }
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const tr = (key, fallback = '') => t(state.lang, key, fallback);
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const num = (v) => Number(v || 0);
const money = (v) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v));
const intFmt = (v) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num(v));
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const monthKey = (year, month) => `${year}-${String(month).padStart(2,'0')}`;
const nowReadableId = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}${String(d.getMilliseconds()).padStart(3,'0')}`;
};
const slug = (text) => String(text || '')
  .trim()
  .toUpperCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9\u0600-\u06FF]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 36) || 'ITEM';
const docData = (snap) => ({ id: snap.id, ...snap.data() });
const localDateTime = () => new Date().toISOString();

function applyLanguage() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'INPUT' && el.type !== 'button' && el.type !== 'submit') {
      if (el.dataset.i18nPlaceholder) el.placeholder = tr(el.dataset.i18nPlaceholder);
    } else {
      el.textContent = tr(key, el.textContent);
    }
  });
  $('#authLangToggle').textContent = state.lang === 'ar' ? 'English' : 'العربية';
  $('#langToggle').textContent = state.lang === 'ar' ? 'English' : 'العربية';
}

function toggleLanguage() {
  state.lang = state.lang === 'ar' ? 'en' : 'ar';
  localStorage.setItem('areen_lang', state.lang);
  applyLanguage();
  if (state.profile) renderAppShell();
}

function toast(message, type = 'success', title = '') {
  const host = $('#toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div>${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</div><div><strong>${esc(title || (type === 'error' ? tr('error') : tr('success')))}</strong><p>${esc(message)}</p></div>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function showLoading() {
  const tpl = $('#loadingTemplate');
  $('#pageContent').innerHTML = tpl.innerHTML;
  applyLanguage();
}

function showModal({ title, body, size = '', onOpen = null }) {
  const root = $('#modalRoot');
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal-card ${size === 'lg' ? 'modal-lg' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close-modal type="button">×</button></div>
      <div class="modal-body">${body}</div>
    </div>`;
  $('[data-close-modal]', root).addEventListener('click', closeModal);
  root.addEventListener('click', (e) => { if (e.target === root) closeModal(); }, { once: true });
  if (onOpen) onOpen(root);
  applyLanguage();
}

function closeModal() {
  const root = $('#modalRoot');
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '';
}

function navItems() {
  if (state.profile?.role === 'manager') {
    return [
      ['dashboard','⌂','dashboard'],
      ['representatives','♙','representatives'],
      ['regions','⌖','regions'],
      ['customers','♧','customers'],
      ['products','▦','products'],
      ['reports','▤','reports']
    ];
  }
  return [
    ['dashboard','⌂','dashboard'],
    ['customers','♧','myCustomers'],
    ['mySales','▤','mySales'],
    ['profile','⚙','profile']
  ];
}

function renderNav() {
  const items = navItems();
  const desktop = $('#desktopNav');
  const drawer = $('#drawerNav');
  const bottom = $('#mobileBottomNav');
  const navHtml = items.map(([page, icon, key]) => `
    <button type="button" class="nav-item ${state.page === page ? 'active' : ''}" data-nav="${page}">
      <span class="nav-icon">${icon}</span><span>${tr(key)}</span>
    </button>`).join('');
  desktop.innerHTML = navHtml;
  drawer.innerHTML = navHtml;

  const bottomItems = state.profile?.role === 'manager'
    ? items.filter(([p]) => ['dashboard','customers','products','representatives','reports'].includes(p))
    : items;
  bottom.innerHTML = bottomItems.map(([page, icon, key]) => `
    <button type="button" class="mobile-nav-item ${state.page === page ? 'active' : ''}" data-nav="${page}">
      <span class="nav-icon">${icon}</span><span>${tr(key)}</span>
    </button>`).join('');

  $$('[data-nav]').forEach((btn) => btn.addEventListener('click', () => {
    $('#mobileDrawer').classList.add('hidden');
    goTo(btn.dataset.nav);
  }));
}

function setPageMeta(title, subtitle = '') {
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
}

function renderAppShell() {
  $('#authScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  const displayName = state.lang === 'ar'
    ? (state.profile.nameAr || state.profile.nameEn || state.profile.username)
    : (state.profile.nameEn || state.profile.nameAr || state.profile.username);
  const roleName = state.profile.role === 'manager' ? tr('salesManager') : tr('salesRepresentative');
  $('#topUserBadge').innerHTML = `<span class="avatar">${esc(displayName.slice(0,1))}</span><span class="name">${esc(displayName)}</span>`;
  $('#sidebarUser').innerHTML = `<strong>${esc(displayName)}</strong><br><span>${esc(roleName)}</span>`;
  renderNav();
  if (!state.page) state.page = 'dashboard';
  renderPage();
}

async function loadProfile(user) {
  const ref = doc(db, 'users', user.email);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  if (user.email === 'manager@areen.local') {
    return null;
  }
  throw new Error('PROFILE_NOT_FOUND');
}

function bootstrapManagerModal() {
  showModal({
    title: tr('setupRequired'),
    body: `
      <p class="muted" style="line-height:1.8">${esc(tr('setupManagerMessage'))}</p>
      <div class="form-actions">
        <button id="initializeManagerBtn" class="btn btn-primary" type="button">${tr('initialize')}</button>
      </div>`,
    onOpen: (root) => {
      $('#initializeManagerBtn', root).addEventListener('click', async () => {
        try {
          const ref = doc(db, 'users', 'manager@areen.local');
          await setDoc(ref, {
            username: 'manager',
            nameAr: 'مدير المبيعات',
            nameEn: 'Sales Manager',
            role: 'manager',
            active: true,
            uid: auth.currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          closeModal();
          state.profile = await loadProfile(auth.currentUser);
          await loadBaseData();
          renderAppShell();
          toast(tr('saved'));
        } catch (err) {
          console.error(err);
          toast(tr('insufficientSetup'), 'error');
        }
      });
    }
  });
}

async function loadBaseData() {
  const [regionsSnap, productsSnap] = await Promise.all([
    getDocs(collection(db, 'regions')),
    getDocs(collection(db, 'products'))
  ]);
  state.regions = regionsSnap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
  state.products = productsSnap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));

  if (state.profile.role === 'manager') {
    const [repsSnap, customersSnap] = await Promise.all([
      getDocs(collection(db, 'sales_representatives')),
      getDocs(collection(db, 'customers'))
    ]);
    state.reps = repsSnap.docs.map(docData).sort((a,b) => (a.nameAr || '').localeCompare(b.nameAr || ''));
    state.customers = customersSnap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
  } else {
    state.reps = [];
    const repCode = state.profile.representativeCode;
    if (repCode) {
      const repSnap = await getDoc(doc(db, 'sales_representatives', repCode));
      if (repSnap.exists()) state.reps = [docData(repSnap)];
      const custSnap = await getDocs(query(collection(db, 'customers'), where('representativeCode', '==', repCode)));
      state.customers = custSnap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
    } else {
      state.customers = [];
    }
  }
}

async function refreshCustomers() {
  if (state.profile.role === 'manager') {
    const snap = await getDocs(collection(db, 'customers'));
    state.customers = snap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
  } else {
    const snap = await getDocs(query(collection(db, 'customers'), where('representativeCode','==',state.profile.representativeCode)));
    state.customers = snap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
  }
}

async function refreshProducts() {
  const snap = await getDocs(collection(db, 'products'));
  state.products = snap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
}

async function refreshReps() {
  if (state.profile.role !== 'manager') return;
  const snap = await getDocs(collection(db, 'sales_representatives'));
  state.reps = snap.docs.map(docData).sort((a,b) => (a.nameAr || '').localeCompare(b.nameAr || ''));
}

async function refreshRegions() {
  const snap = await getDocs(collection(db, 'regions'));
  state.regions = snap.docs.map(docData).sort((a,b) => (a.nameAr || a.nameEn || '').localeCompare(b.nameAr || b.nameEn || ''));
}

function goTo(page) {
  state.page = page;
  renderNav();
  renderPage();
}

function renderPage() {
  showLoading();
  const managerOnly = ['representatives','regions','products','reports'];
  if (managerOnly.includes(state.page) && state.profile.role !== 'manager') state.page = 'dashboard';
  switch (state.page) {
    case 'dashboard': renderDashboard(); break;
    case 'representatives': renderRepresentatives(); break;
    case 'regions': renderRegions(); break;
    case 'customers': renderCustomers(); break;
    case 'products': renderProducts(); break;
    case 'reports': renderReports(); break;
    case 'mySales': renderMySales(); break;
    case 'profile': renderProfile(); break;
    default: state.page = 'dashboard'; renderDashboard();
  }
}

function regionName(code) {
  const r = state.regions.find((x) => x.id === code || x.regionCode === code);
  return r ? (state.lang === 'ar' ? (r.nameAr || r.nameEn) : (r.nameEn || r.nameAr)) : code || '-';
}
function repName(code) {
  const r = state.reps.find((x) => x.id === code || x.representativeCode === code);
  return r ? (state.lang === 'ar' ? (r.nameAr || r.nameEn) : (r.nameEn || r.nameAr)) : code || '-';
}
function customerName(c) {
  return state.lang === 'ar' ? (c.nameAr || c.nameEn || c.customerCode) : (c.nameEn || c.nameAr || c.customerCode);
}
function productName(p) {
  return state.lang === 'ar' ? (p.nameAr || p.nameEn || p.productCode) : (p.nameEn || p.nameAr || p.productCode);
}

function yearOptions(selected) {
  const y = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => y - 2 + i).map((v) => `<option value="${v}" ${Number(selected) === v ? 'selected' : ''}>${v}</option>`).join('');
}
function monthOptions(selected) {
  return months[state.lang].map((name, i) => `<option value="${i+1}" ${Number(selected) === i+1 ? 'selected' : ''}>${esc(name)}</option>`).join('');
}
function regionOptions(selected = '', allowAll = true, allowed = null) {
  let list = state.regions.filter((r) => r.active !== false);
  if (Array.isArray(allowed)) list = list.filter((r) => allowed.includes(r.id));
  return `${allowAll ? `<option value="">${tr('all')}</option>` : `<option value="">${tr('select')}</option>`}${list.map((r) => `<option value="${esc(r.id)}" ${selected === r.id ? 'selected' : ''}>${esc(state.lang === 'ar' ? (r.nameAr || r.nameEn) : (r.nameEn || r.nameAr))}</option>`).join('')}`;
}
function repOptions(selected = '', allowAll = true) {
  const list = state.reps.filter((r) => r.active !== false);
  return `${allowAll ? `<option value="">${tr('all')}</option>` : `<option value="">${tr('select')}</option>`}${list.map((r) => `<option value="${esc(r.id)}" ${selected === r.id ? 'selected' : ''}>${esc(repName(r.id))}</option>`).join('')}`;
}
function customerOptions(selected = '', allowAll = false) {
  return `${allowAll ? `<option value="">${tr('all')}</option>` : `<option value="">${tr('select')}</option>`}${state.customers.filter((c) => c.active !== false).map((c) => `<option value="${esc(c.id)}" ${selected === c.id ? 'selected' : ''}>${esc(customerName(c))}</option>`).join('')}`;
}

async function fetchActivity(month = null) {
  const repCode = state.profile.role === 'manager' ? null : state.profile.representativeCode;
  const getCol = async (name) => {
    let snap;
    if (repCode) snap = await getDocs(query(collection(db, name), where('representativeCode','==',repCode)));
    else if (month) snap = await getDocs(query(collection(db, name), where('monthKey','==',month)));
    else snap = await getDocs(collection(db, name));
    return snap.docs.map(docData);
  };
  const [sales, payments, visits] = await Promise.all([getCol('sales'), getCol('payments'), getCol('visits')]);
  return { sales, payments, visits };
}

async function getTargetDocs(year) {
  if (state.profile.role === 'manager') {
    const snap = await getDocs(query(collection(db, 'monthly_targets'), where('year','==',Number(year))));
    return snap.docs.map(docData);
  }
  const repCode = state.profile.representativeCode;
  const ref = doc(db, 'monthly_targets', `TGT-${repCode}-${year}`);
  const snap = await getDoc(ref);
  return snap.exists() ? [docData(snap)] : [];
}

async function renderDashboard() {
  setPageMeta(tr('dashboard'), state.profile.role === 'manager' ? tr('salesOverview') : `${tr('welcome')} ${esc(state.profile.nameAr || state.profile.nameEn || state.profile.username)}`);
  const content = $('#pageContent');
  const isManager = state.profile.role === 'manager';
  const rep = isManager ? state.dashboard.rep : state.profile.representativeCode;
  const allowedRegions = isManager ? null : (state.reps[0]?.regions || []);
  content.innerHTML = `
    <div class="filters-bar card card-pad">
      <label class="field"><span>${tr('year')}</span><select id="dashYear">${yearOptions(state.dashboard.year)}</select></label>
      <label class="field"><span>${tr('month')}</span><select id="dashMonth">${monthOptions(state.dashboard.month)}</select></label>
      <label class="field"><span>${tr('region')}</span><select id="dashRegion">${regionOptions(state.dashboard.region, true, allowedRegions)}</select></label>
      ${isManager ? `<label class="field"><span>${tr('representative')}</span><select id="dashRep">${repOptions(state.dashboard.rep, true)}</select></label>` : `<div class="field"><span>${tr('representative')}</span><input readonly value="${esc(repName(rep))}" /></div>`}
    </div>
    <div id="dashboardBody"><div class="loading-state"><div class="spinner"></div><p>${tr('loading')}</p></div></div>`;

  const refresh = () => {
    state.dashboard.year = Number($('#dashYear').value);
    state.dashboard.month = Number($('#dashMonth').value);
    state.dashboard.region = $('#dashRegion').value;
    if (isManager) state.dashboard.rep = $('#dashRep').value;
    renderDashboardData();
  };
  ['#dashYear','#dashMonth','#dashRegion'].forEach((id) => $(id).addEventListener('change', refresh));
  if (isManager) $('#dashRep').addEventListener('change', refresh);
  renderDashboardData();
}

async function renderDashboardData() {
  const body = $('#dashboardBody');
  if (!body) return;
  body.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${tr('loading')}</p></div>`;
  try {
    const mk = monthKey(state.dashboard.year, state.dashboard.month);
    const [{ sales, payments, visits }, targets] = await Promise.all([fetchActivity(mk), getTargetDocs(state.dashboard.year)]);
    const repFilter = state.profile.role === 'manager' ? state.dashboard.rep : state.profile.representativeCode;
    const regionFilter = state.dashboard.region;
    const filterRows = (rows) => rows.filter((r) => (!repFilter || r.representativeCode === repFilter) && (!regionFilter || r.regionCode === regionFilter) && r.monthKey === mk);
    const s = filterRows(sales);
    const p = filterRows(payments);
    const v = filterRows(visits);
    const totalSales = s.reduce((a,x) => a + num(x.total), 0);
    const totalCollection = p.reduce((a,x) => a + num(x.amount), 0);

    const repCodes = repFilter
      ? [repFilter]
      : state.reps.filter((r) => r.active !== false && (!regionFilter || (r.regions || []).includes(regionFilter))).map((r) => r.id);
    let monthlyTarget = 0, targetToDate = 0, totalWorkingDays = 0, executedDays = 0;
    for (const code of repCodes) {
      const targetDoc = targets.find((x) => x.representativeCode === code);
      const m = targetDoc?.months?.[String(state.dashboard.month)] || {};
      const target = num(m.target);
      const workDays = num(m.workingDays);
      const uniqueDays = new Set(v.filter((x) => x.representativeCode === code).map((x) => x.dateKey));
      const executed = uniqueDays.size;
      monthlyTarget += target;
      totalWorkingDays += workDays;
      executedDays += executed;
      targetToDate += workDays > 0 ? (target / workDays) * Math.min(executed, workDays) : 0;
    }
    const remainingDays = Math.max(totalWorkingDays - executedDays, 0);
    const remainingTarget = Math.max(monthlyTarget - totalSales, 0);
    const dailyRemaining = remainingDays > 0 ? remainingTarget / remainingDays : remainingTarget;
    const achievement = monthlyTarget > 0 ? Math.min((totalSales / monthlyTarget) * 100, 999) : 0;

    const recent = [...s].sort((a,b) => String(b.createdAtIso || b.dateKey).localeCompare(String(a.createdAtIso || a.dateKey))).slice(0,8);
    const days = Array.from({length: 7}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate() - (6-i));
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return { key:k, label:String(d.getDate()).padStart(2,'0'), sales:s.filter(x=>x.dateKey===k).reduce((a,x)=>a+num(x.total),0), col:p.filter(x=>x.dateKey===k).reduce((a,x)=>a+num(x.amount),0) };
    });
    const maxBar = Math.max(...days.flatMap(d => [d.sales,d.col]), 1);

    body.innerHTML = `
      <div class="kpi-grid">
        ${kpi(tr('workingDaysExecuted'), intFmt(executedDays), '◫', 'green', tr('totalWorkingDays') + ': ' + intFmt(totalWorkingDays))}
        ${kpi(tr('workingDaysRemaining'), intFmt(remainingDays), '◧', '', tr('totalWorkingDays') + ': ' + intFmt(totalWorkingDays))}
        ${kpi(tr('totalSales'), money(totalSales), '↗', 'green', tr('actual'))}
        ${kpi(tr('totalCollection'), money(totalCollection), '●', '', tr('collection'))}
      </div>
      <div class="dashboard-grid">
        <div class="card goal-card">
          <div class="section-title"><div><h4>${tr('targets')}</h4><p>${months[state.lang][state.dashboard.month-1]} ${state.dashboard.year}</p></div><span class="badge ${achievement >= 100 ? 'green' : 'amber'}">${money(achievement)}%</span></div>
          <div class="goal-metrics">
            ${goalChip(tr('monthlyTarget'), money(monthlyTarget))}
            ${goalChip(tr('targetToDate'), money(targetToDate))}
            ${goalChip(tr('actual'), money(totalSales), 'text-green')}
            ${goalChip(tr('remainingTarget'), money(remainingTarget), 'text-red')}
            ${goalChip(tr('dailyRemainingTarget'), money(dailyRemaining))}
          </div>
          <div class="progress-wrap"><div class="progress"><span style="width:${Math.min(achievement,100)}%"></span></div><div class="progress-num">${money(achievement)}%</div></div>
        </div>
        <div class="card card-pad donut-wrap">
          <div class="donut" style="--pct:${Math.min(achievement,100)}"><div class="donut-value">${Math.round(achievement)}%</div></div>
          <strong>${tr('performance')}</strong>
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="card card-pad">
          <div class="section-title"><div><h4>${tr('salesAndCollection')}</h4><p>${tr('salesOverview')}</p></div></div>
          <div class="chart-bars">
            ${days.map((d) => `<div style="flex:1;display:flex;gap:3px;align-items:end;height:100%;position:relative"><div class="chart-bar" title="${money(d.sales)}" style="height:${Math.max((d.sales/maxBar)*100,3)}%"></div><div class="chart-bar red" title="${money(d.col)}" style="height:${Math.max((d.col/maxBar)*100,3)}%"></div><span class="chart-bar-label">${d.label}</span></div>`).join('')}
          </div>
        </div>
        <div class="card card-pad">
          <div class="section-title"><div><h4>${tr('recentSales')}</h4><p>${recent.length} ${tr('salesReport')}</p></div></div>
          ${recent.length ? recent.map((sale) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)"><div><strong>${esc(customerName(state.customers.find(c=>c.id===sale.customerCode)||{customerCode:sale.customerCode}))}</strong><div class="muted" style="font-size:11px">${esc(sale.dateKey)} · ${esc(repName(sale.representativeCode))}</div></div><strong class="text-green">${money(sale.total)}</strong></div>`).join('') : emptyMini(tr('noData'))}
        </div>
      </div>`;
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="card empty-state"><div><div class="empty-icon">!</div><p>${esc(tr('insufficientSetup'))}</p></div></div>`;
  }
}

function kpi(label, value, icon, tone = '', foot = '') {
  return `<div class="kpi-card ${tone}"><div style="display:flex;justify-content:space-between;gap:10px"><span class="kpi-label">${esc(label)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${esc(value)}</div><div class="kpi-foot"><span>${esc(foot)}</span></div></div>`;
}
function goalChip(label, value, cls = '') { return `<div class="goal-chip"><span>${esc(label)}</span><strong class="${cls}">${esc(value)}</strong></div>`; }
function emptyMini(text) { return `<div class="empty-state" style="min-height:120px;padding:10px"><div><div class="empty-icon">—</div><p>${esc(text)}</p></div></div>`; }

async function renderRepresentatives() {
  setPageMeta(tr('representatives'), tr('targetsAnnual'));
  const content = $('#pageContent');
  content.innerHTML = `
    <div class="page-head"><div><h3>${tr('representatives')}</h3><p>${tr('accountData')}</p></div><div class="page-actions"><button id="addRepBtn" class="btn btn-primary">+ ${tr('addRepresentative')}</button></div></div>
    <div class="card table-card">
      <div class="table-toolbar"><div class="search-box"><span>⌕</span><input id="repSearch" placeholder="${tr('search')}" /></div></div>
      <div class="table-scroll mobile-hide"><table><thead><tr><th>${tr('representativeCode')}</th><th>${tr('name')}</th><th>${tr('username')}</th><th>${tr('mobile')}</th><th>${tr('regions')}</th><th>${tr('status')}</th><th>${tr('actions')}</th></tr></thead><tbody id="repTbody"></tbody></table></div>
      <div id="repMobileList" class="mobile-card-list"></div>
    </div>`;
  $('#addRepBtn').addEventListener('click', () => openRepresentativeModal());
  $('#repSearch').addEventListener('input', renderRepRows);
  renderRepRows();
}

function renderRepRows() {
  const qv = ($('#repSearch')?.value || '').toLowerCase();
  const rows = state.reps.filter((r) => [r.id,r.nameAr,r.nameEn,r.username,r.mobile].join(' ').toLowerCase().includes(qv));
  const tbody = $('#repTbody');
  const mobile = $('#repMobileList');
  if (!tbody || !mobile) return;
  tbody.innerHTML = rows.length ? rows.map((r) => `<tr>
    <td><strong>${esc(r.id)}</strong></td><td>${esc(repName(r.id))}</td><td>${esc(r.username || '-')}</td><td>${esc(r.mobile || '-')}</td>
    <td>${(r.regions || []).map((x)=>`<span class="badge gray">${esc(regionName(x))}</span>`).join(' ') || '-'}</td>
    <td><span class="badge ${r.active === false ? 'red' : 'green'}">${r.active === false ? tr('inactive') : tr('active')}</span></td>
    <td><div class="actions-cell"><button class="btn btn-outline btn-xs" data-edit-rep="${esc(r.id)}">${tr('edit')}</button><button class="btn btn-outline btn-xs" data-targets-rep="${esc(r.id)}">${tr('targets')}</button><button class="btn btn-danger-soft btn-xs" data-toggle-rep="${esc(r.id)}">${r.active === false ? tr('active') : tr('inactive')}</button></div></td>
  </tr>`).join('') : `<tr><td colspan="7">${tr('noReps')}</td></tr>`;
  mobile.innerHTML = rows.map((r) => `<div class="mobile-card-row"><div class="mobile-card-row-head"><div><h4>${esc(repName(r.id))}</h4><p>${esc(r.id)} · ${esc(r.username || '')}</p></div><span class="badge ${r.active === false ? 'red':'green'}">${r.active === false ? tr('inactive'):tr('active')}</span></div><div class="mobile-card-row-grid"><div><span>${tr('mobile')}</span><strong>${esc(r.mobile || '-')}</strong></div><div><span>${tr('regions')}</span><strong>${(r.regions||[]).length}</strong></div></div><div class="form-actions"><button class="btn btn-outline btn-xs" data-edit-rep="${esc(r.id)}">${tr('edit')}</button><button class="btn btn-outline btn-xs" data-targets-rep="${esc(r.id)}">${tr('targets')}</button></div></div>`).join('');
  $$('[data-edit-rep]').forEach((b) => b.addEventListener('click', () => openRepresentativeModal(state.reps.find(r=>r.id===b.dataset.editRep))));
  $$('[data-targets-rep]').forEach((b) => b.addEventListener('click', () => openTargetsModal(state.reps.find(r=>r.id===b.dataset.targetsRep))));
  $$('[data-toggle-rep]').forEach((b) => b.addEventListener('click', () => toggleRepStatus(b.dataset.toggleRep)));
}

function openRepresentativeModal(rep = null) {
  const editing = !!rep;
  const body = `
    <form id="repForm" class="stack-form">
      <div class="form-grid cols-3">
        <label class="field"><span>${tr('representativeCode')}</span><input id="repCode" value="${esc(rep?.id || '')}" ${editing ? 'readonly' : ''} placeholder="REP-AHMED" required /></label>
        <label class="field"><span>${tr('nameAr')}</span><input id="repNameAr" value="${esc(rep?.nameAr || '')}" required /></label>
        <label class="field"><span>${tr('nameEn')}</span><input id="repNameEn" value="${esc(rep?.nameEn || '')}" /></label>
        <label class="field"><span>${tr('mobile')}</span><input id="repMobile" value="${esc(rep?.mobile || '')}" inputmode="tel" /></label>
        <label class="field"><span>${tr('username')}</span><input id="repUsername" value="${esc(rep?.username || '')}" ${editing ? 'readonly' : ''} required pattern="[A-Za-z0-9._-]+" /></label>
        ${editing ? '' : `<label class="field"><span>${tr('password')}</span><input id="repPassword" type="password" minlength="6" required /></label>`}
      </div>
      <div class="field"><span>${tr('assignedRegions')}</span><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">${state.regions.filter(r=>r.active!==false).map((r)=>`<label style="display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:10px"><input type="checkbox" name="repRegion" value="${esc(r.id)}" style="width:auto;min-height:auto" ${(rep?.regions||[]).includes(r.id) ? 'checked':''}><span>${esc(regionName(r.id))}</span></label>`).join('') || `<span class="muted">${tr('noData')}</span>`}</div></div>
      <div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-primary" type="submit">${tr('save')}</button></div>
    </form>`;
  showModal({ title: editing ? tr('edit') : tr('addRepresentative'), body, size: 'lg', onOpen: (root) => {
    $('[data-close-modal]', root).addEventListener('click', closeModal);
    if (!editing) {
      let repCodeTouched = false;
      $('#repCode', root).addEventListener('input', () => { repCodeTouched = true; });
      $('#repUsername', root).addEventListener('input', () => {
        if (!repCodeTouched) $('#repCode',root).value = `REP-${slug($('#repUsername',root).value)}`;
      });
    }
    $('#repForm', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      try {
        const repCode = $('#repCode',root).value.trim().toUpperCase();
        const username = normalizeUsername($('#repUsername',root).value);
        const data = {
          representativeCode: repCode,
          nameAr: $('#repNameAr',root).value.trim(),
          nameEn: $('#repNameEn',root).value.trim(),
          mobile: $('#repMobile',root).value.trim(),
          username,
          regions: $$('input[name="repRegion"]:checked', root).map(x=>x.value),
          active: rep?.active !== false,
          updatedAt: serverTimestamp()
        };
        if (!editing) {
          const authUser = await createAuthUserWithoutSwitching(username, $('#repPassword',root).value);
          data.createdAt = serverTimestamp();
          data.uid = authUser.uid;
          await setDoc(doc(db,'sales_representatives',repCode), data);
          await setDoc(doc(db,'users',usernameToEmail(username)), {
            username, nameAr: data.nameAr, nameEn: data.nameEn, role:'representative', representativeCode:repCode,
            active:true, uid:authUser.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp()
          });
        } else {
          await updateDoc(doc(db,'sales_representatives',rep.id), data);
          await updateDoc(doc(db,'users',usernameToEmail(username)), { nameAr:data.nameAr,nameEn:data.nameEn,active:data.active,updatedAt:serverTimestamp() });
        }
        await refreshReps(); closeModal(); renderRepresentatives(); toast(tr('saved'));
      } catch (err) { console.error(err); toast(err.code?.includes('email-already') ? 'Username already exists' : tr('error'), 'error'); }
      finally { btn.disabled = false; }
    });
  }});
}

async function toggleRepStatus(repCode) {
  const rep = state.reps.find(r=>r.id===repCode); if (!rep) return;
  try {
    const active = rep.active === false;
    const batch = writeBatch(db);
    batch.update(doc(db,'sales_representatives',repCode), { active, updatedAt:serverTimestamp() });
    batch.update(doc(db,'users',usernameToEmail(rep.username)), { active, updatedAt:serverTimestamp() });
    await batch.commit();
    await refreshReps(); renderRepRows(); toast(tr('saved'));
  } catch (err) { console.error(err); toast(tr('error'),'error'); }
}

async function openTargetsModal(rep) {
  const year = new Date().getFullYear();
  const render = async (y) => {
    const ref = doc(db,'monthly_targets',`TGT-${rep.id}-${y}`);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : { months:{} };
    const body = `
      <div class="form-grid" style="margin-bottom:14px"><label class="field"><span>${tr('year')}</span><select id="targetYear">${yearOptions(y)}</select></label><div></div></div>
      <form id="targetsForm"><div class="month-targets">${months[state.lang].map((m,i)=>{
        const row = data.months?.[String(i+1)] || {};
        return `<div class="month-target"><label>${esc(m)}</label><input name="target_${i+1}" type="number" min="0" step="0.01" value="${num(row.target)}" placeholder="${tr('monthlyTarget')}" /><input name="days_${i+1}" type="number" min="0" max="31" value="${num(row.workingDays)}" placeholder="${tr('workingDays')}" style="margin-top:6px" /></div>`;
      }).join('')}</div><div id="annualTotal" style="margin-top:14px;font-weight:900"></div><div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-primary" type="submit">${tr('save')}</button></div></form>`;
    showModal({ title: `${tr('targetsAnnual')} - ${repName(rep.id)}`, body, size:'lg', onOpen:(root)=>{
      $('[data-close-modal]',root).addEventListener('click',closeModal);
      const calc = () => { const total = months[state.lang].reduce((a,_,i)=>a+num($(`[name="target_${i+1}"]`,root).value),0); $('#annualTotal',root).textContent=`${tr('totalAnnualTarget')}: ${money(total)}`; };
      $$('input[name^="target_"]',root).forEach(x=>x.addEventListener('input',calc)); calc();
      $('#targetYear',root).addEventListener('change',()=>render(Number($('#targetYear',root).value)));
      $('#targetsForm',root).addEventListener('submit',async(e)=>{
        e.preventDefault(); const btn=e.submitter; btn.disabled=true;
        try {
          const selectedYear=Number($('#targetYear',root).value); const monthsData={};
          for(let i=1;i<=12;i++) monthsData[String(i)]={ target:num($(`[name="target_${i}"]`,root).value), workingDays:num($(`[name="days_${i}"]`,root).value) };
          await setDoc(doc(db,'monthly_targets',`TGT-${rep.id}-${selectedYear}`),{ representativeCode:rep.id, year:selectedYear, months:monthsData, updatedAt:serverTimestamp(), updatedBy:state.user.email },{merge:true});
          toast(tr('saved')); closeModal();
        } catch(err){ console.error(err); toast(tr('error'),'error'); } finally{ btn.disabled=false; }
      });
    }});
  };
  await render(year);
}

async function renderRegions() {
  setPageMeta(tr('regions'), tr('administration'));
  $('#pageContent').innerHTML = `
    <div class="page-head"><div><h3>${tr('regions')}</h3><p>${tr('assignedRegions')}</p></div><div class="page-actions"><button id="addRegionBtn" class="btn btn-primary">+ ${tr('addRegion')}</button></div></div>
    <div class="card table-card"><div class="table-scroll"><table><thead><tr><th>${tr('regionCode')}</th><th>${tr('nameAr')}</th><th>${tr('nameEn')}</th><th>${tr('status')}</th><th>${tr('actions')}</th></tr></thead><tbody>${state.regions.map(r=>`<tr><td><strong>${esc(r.id)}</strong></td><td>${esc(r.nameAr||'-')}</td><td>${esc(r.nameEn||'-')}</td><td><span class="badge ${r.active===false?'red':'green'}">${r.active===false?tr('inactive'):tr('active')}</span></td><td><div class="actions-cell"><button class="btn btn-outline btn-xs" data-edit-region="${esc(r.id)}">${tr('edit')}</button><button class="btn btn-danger-soft btn-xs" data-toggle-region="${esc(r.id)}">${r.active===false?tr('active'):tr('inactive')}</button></div></td></tr>`).join('') || `<tr><td colspan="5">${tr('noData')}</td></tr>`}</tbody></table></div></div>`;
  $('#addRegionBtn').addEventListener('click',()=>openRegionModal());
  $$('[data-edit-region]').forEach(b=>b.addEventListener('click',()=>openRegionModal(state.regions.find(r=>r.id===b.dataset.editRegion))));
  $$('[data-toggle-region]').forEach(b=>b.addEventListener('click',()=>toggleRegion(b.dataset.toggleRegion)));
}

function openRegionModal(region=null){
  const editing=!!region;
  showModal({title:editing?tr('edit'):tr('addRegion'),body:`<form id="regionForm" class="stack-form"><div class="form-grid"><label class="field"><span>${tr('regionCode')}</span><input id="regionCode" value="${esc(region?.id||'')}" ${editing?'readonly':''} placeholder="REG-RIYADH-EAST" required /></label><label class="field"><span>${tr('nameAr')}</span><input id="regionNameAr" value="${esc(region?.nameAr||'')}" required /></label><label class="field"><span>${tr('nameEn')}</span><input id="regionNameEn" value="${esc(region?.nameEn||'')}" /></label></div><div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-primary" type="submit">${tr('save')}</button></div></form>`,onOpen:(root)=>{
    $('[data-close-modal]',root).addEventListener('click',closeModal);
    if(!editing){let regionCodeTouched=false;$('#regionCode',root).addEventListener('input',()=>{regionCodeTouched=true;});const autoRegionCode=()=>{if(!regionCodeTouched){const basis=$('#regionNameEn',root).value||$('#regionNameAr',root).value;$('#regionCode',root).value=`REG-${slug(basis)}`;}};$('#regionNameEn',root).addEventListener('input',autoRegionCode);$('#regionNameAr',root).addEventListener('input',autoRegionCode);}
    $('#regionForm',root).addEventListener('submit',async(e)=>{e.preventDefault();try{const id=$('#regionCode',root).value.trim().toUpperCase();await setDoc(doc(db,'regions',id),{regionCode:id,nameAr:$('#regionNameAr',root).value.trim(),nameEn:$('#regionNameEn',root).value.trim(),active:region?.active!==false,updatedAt:serverTimestamp(),...(editing?{}:{createdAt:serverTimestamp()})},{merge:true});await refreshRegions();closeModal();renderRegions();toast(tr('saved'));}catch(err){console.error(err);toast(tr('error'),'error');}});
  }});
}
async function toggleRegion(id){const r=state.regions.find(x=>x.id===id);if(!r)return;try{await updateDoc(doc(db,'regions',id),{active:r.active===false,updatedAt:serverTimestamp()});await refreshRegions();renderRegions();toast(tr('saved'));}catch(err){console.error(err);toast(tr('error'),'error');}}

async function renderProducts(){
  setPageMeta(tr('products'),tr('administration'));
  $('#pageContent').innerHTML=`
    <div class="page-head"><div><h3>${tr('products')}</h3><p>${tr('importExcel')}</p></div><div class="page-actions"><button id="productTemplateBtn" class="btn btn-outline">${tr('downloadTemplate')}</button><button id="importProductsBtn" class="btn btn-outline">${tr('importExcel')}</button><button id="addProductBtn" class="btn btn-primary">+ ${tr('addProduct')}</button></div></div>
    <div class="card table-card"><div class="table-toolbar"><div class="search-box"><span>⌕</span><input id="productSearch" placeholder="${tr('search')}" /></div></div><div class="table-scroll mobile-hide"><table><thead><tr><th>${tr('productCode')}</th><th>${tr('productName')}</th><th>${tr('unit')}</th><th>${tr('price')}</th><th>${tr('status')}</th><th>${tr('actions')}</th></tr></thead><tbody id="productTbody"></tbody></table></div><div id="productMobileList" class="mobile-card-list"></div></div>`;
  $('#addProductBtn').addEventListener('click',()=>openProductModal());
  $('#importProductsBtn').addEventListener('click',()=>openImportModal('products'));
  $('#productTemplateBtn').addEventListener('click',()=>downloadTemplate('products'));
  $('#productSearch').addEventListener('input',renderProductRows);renderProductRows();
}
function renderProductRows(){
  const qv=($('#productSearch')?.value||'').toLowerCase();const rows=state.products.filter(p=>[p.id,p.nameAr,p.nameEn,p.unit].join(' ').toLowerCase().includes(qv));const tbody=$('#productTbody'),mobile=$('#productMobileList');if(!tbody||!mobile)return;
  tbody.innerHTML=rows.map(p=>`<tr><td><strong>${esc(p.id)}</strong></td><td>${esc(productName(p))}</td><td>${esc(p.unit||'-')}</td><td>${money(p.price)}</td><td><span class="badge ${p.active===false?'red':'green'}">${p.active===false?tr('inactive'):tr('active')}</span></td><td><div class="actions-cell"><button class="btn btn-outline btn-xs" data-edit-product="${esc(p.id)}">${tr('edit')}</button><button class="btn btn-danger-soft btn-xs" data-toggle-product="${esc(p.id)}">${p.active===false?tr('active'):tr('inactive')}</button></div></td></tr>`).join('')||`<tr><td colspan="6">${tr('noProducts')}</td></tr>`;
  mobile.innerHTML=rows.map(p=>`<div class="mobile-card-row"><div class="mobile-card-row-head"><div><h4>${esc(productName(p))}</h4><p>${esc(p.id)}</p></div><span class="badge ${p.active===false?'red':'green'}">${p.active===false?tr('inactive'):tr('active')}</span></div><div class="mobile-card-row-grid"><div><span>${tr('unit')}</span><strong>${esc(p.unit||'-')}</strong></div><div><span>${tr('price')}</span><strong>${money(p.price)}</strong></div></div><div class="form-actions"><button class="btn btn-outline btn-xs" data-edit-product="${esc(p.id)}">${tr('edit')}</button></div></div>`).join('');
  $$('[data-edit-product]').forEach(b=>b.addEventListener('click',()=>openProductModal(state.products.find(p=>p.id===b.dataset.editProduct))));$$('[data-toggle-product]').forEach(b=>b.addEventListener('click',()=>toggleProduct(b.dataset.toggleProduct)));
}
function openProductModal(product=null){const editing=!!product;showModal({title:editing?tr('edit'):tr('addProduct'),body:`<form id="productForm" class="stack-form"><div class="form-grid cols-3"><label class="field"><span>${tr('productCode')}</span><input id="productCode" value="${esc(product?.id||'')}" ${editing?'readonly':''} required /></label><label class="field"><span>${tr('nameAr')}</span><input id="productNameAr" value="${esc(product?.nameAr||'')}" required /></label><label class="field"><span>${tr('nameEn')}</span><input id="productNameEn" value="${esc(product?.nameEn||'')}" /></label><label class="field"><span>${tr('unit')}</span><input id="productUnit" value="${esc(product?.unit||'')}" required /></label><label class="field"><span>${tr('price')}</span><input id="productPrice" type="number" min="0" step="0.01" value="${num(product?.price)}" required /></label></div><div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-primary" type="submit">${tr('save')}</button></div></form>`,onOpen:(root)=>{$('[data-close-modal]',root).addEventListener('click',closeModal);$('#productForm',root).addEventListener('submit',async(e)=>{e.preventDefault();try{const id=$('#productCode',root).value.trim().toUpperCase();await setDoc(doc(db,'products',id),{productCode:id,nameAr:$('#productNameAr',root).value.trim(),nameEn:$('#productNameEn',root).value.trim(),unit:$('#productUnit',root).value.trim(),price:num($('#productPrice',root).value),active:product?.active!==false,updatedAt:serverTimestamp(),...(editing?{}:{createdAt:serverTimestamp()})},{merge:true});await refreshProducts();closeModal();renderProducts();toast(tr('saved'));}catch(err){console.error(err);toast(tr('error'),'error');}});}});}
async function toggleProduct(id){const p=state.products.find(x=>x.id===id);if(!p)return;try{await updateDoc(doc(db,'products',id),{active:p.active===false,updatedAt:serverTimestamp()});await refreshProducts();renderProductRows();toast(tr('saved'));}catch(err){console.error(err);toast(tr('error'),'error');}}

async function renderCustomers(){
  const isManager=state.profile.role==='manager';setPageMeta(isManager?tr('customers'):tr('myCustomers'),isManager?tr('administration'):tr('salesRepresentative'));
  $('#pageContent').innerHTML=`
    <div class="page-head"><div><h3>${isManager?tr('customers'):tr('myCustomers')}</h3><p>${state.customers.length} ${tr('customers')}</p></div><div class="page-actions">${isManager?`<button id="customerTemplateBtn" class="btn btn-outline">${tr('downloadTemplate')}</button><button id="importCustomersBtn" class="btn btn-outline">${tr('importExcel')}</button>`:''}<button id="addCustomerBtn" class="btn btn-primary">+ ${tr('addCustomer')}</button></div></div>
    <div class="card table-card"><div class="table-toolbar"><div class="search-box"><span>⌕</span><input id="customerSearch" placeholder="${tr('search')}" /></div></div><div class="table-scroll mobile-hide"><table><thead><tr><th>${tr('customerCode')}</th><th>${tr('name')}</th><th>${tr('mobile')}</th><th>${tr('region')}</th>${isManager?`<th>${tr('representative')}</th>`:''}<th>${tr('currentBalance')}</th><th>${tr('customerType')}</th><th>${tr('actions')}</th></tr></thead><tbody id="customerTbody"></tbody></table></div><div id="customerMobileList" class="mobile-card-list"></div></div>`;
  $('#addCustomerBtn').addEventListener('click',()=>openCustomerModal());
  if(isManager){$('#importCustomersBtn').addEventListener('click',()=>openImportModal('customers'));$('#customerTemplateBtn').addEventListener('click',()=>downloadTemplate('customers'));}
  $('#customerSearch').addEventListener('input',renderCustomerRows);renderCustomerRows();
}
function customerTypeLabel(v){return v==='new'?tr('newCustomer'):v==='potential'?tr('potentialCustomer'):v==='unlikely'?tr('unlikelyCustomer'):v||'-';}
function renderCustomerRows(){
  const isManager=state.profile.role==='manager',qv=($('#customerSearch')?.value||'').toLowerCase();const rows=state.customers.filter(c=>[c.id,c.nameAr,c.nameEn,c.mobile,c.address].join(' ').toLowerCase().includes(qv));const tbody=$('#customerTbody'),mobile=$('#customerMobileList');if(!tbody||!mobile)return;
  tbody.innerHTML=rows.map(c=>`<tr><td><strong>${esc(c.id)}</strong></td><td>${esc(customerName(c))}</td><td>${esc(c.mobile||'-')}</td><td>${esc(regionName(c.regionCode))}</td>${isManager?`<td>${esc(repName(c.representativeCode))}</td>`:''}<td class="${num(c.currentBalance)>0?'text-red':'text-green'}"><strong>${money(c.currentBalance)}</strong></td><td><span class="badge ${c.customerType==='unlikely'?'red':c.customerType==='potential'?'amber':'green'}">${esc(customerTypeLabel(c.customerType))}</span></td><td><div class="actions-cell"><button class="btn btn-outline btn-xs" data-view-customer="${esc(c.id)}">${tr('customerDetails')}</button>${isManager?`<button class="btn btn-outline btn-xs" data-edit-customer="${esc(c.id)}">${tr('edit')}</button>`:''}</div></td></tr>`).join('')||`<tr><td colspan="8">${tr('noCustomers')}</td></tr>`;
  mobile.innerHTML=rows.map(c=>`<div class="mobile-card-row" data-view-customer="${esc(c.id)}"><div class="mobile-card-row-head"><div><h4>${esc(customerName(c))}</h4><p>${esc(c.mobile||'-')} · ${esc(regionName(c.regionCode))}</p></div><span class="badge ${c.customerType==='unlikely'?'red':c.customerType==='potential'?'amber':'green'}">${esc(customerTypeLabel(c.customerType))}</span></div><div class="customer-balance"><span>${tr('currentBalance')}</span><strong>${money(c.currentBalance)}</strong></div></div>`).join('');
  $$('[data-view-customer]').forEach(b=>b.addEventListener('click',()=>openCustomerDetails(state.customers.find(c=>c.id===b.dataset.viewCustomer))));$$('[data-edit-customer]').forEach(b=>b.addEventListener('click',()=>openCustomerModal(state.customers.find(c=>c.id===b.dataset.editCustomer))));
}

function openCustomerModal(customer=null){
  const isManager=state.profile.role==='manager',editing=!!customer;const repCode=customer?.representativeCode||(isManager?'':state.profile.representativeCode);const allowedRegions=isManager?null:(state.reps[0]?.regions||[]);
  showModal({title:editing?tr('edit'):tr('addCustomer'),size:'lg',body:`<form id="customerForm" class="stack-form"><div class="form-grid cols-3"><label class="field"><span>${tr('customerCode')}</span><input id="customerCode" value="${esc(customer?.id||'')}" ${editing?'readonly':''} placeholder="${isManager?'CUST-0001':'Auto'}" /></label><label class="field"><span>${tr('nameAr')}</span><input id="customerNameAr" value="${esc(customer?.nameAr||'')}" required /></label><label class="field"><span>${tr('nameEn')}</span><input id="customerNameEn" value="${esc(customer?.nameEn||'')}" /></label><label class="field"><span>${tr('mobile')}</span><input id="customerMobile" value="${esc(customer?.mobile||'')}" inputmode="tel" /></label><label class="field"><span>${tr('address')}</span><input id="customerAddress" value="${esc(customer?.address||'')}" /></label><label class="field"><span>${tr('region')}</span><select id="customerRegion" required>${regionOptions(customer?.regionCode||'',false,allowedRegions)}</select></label>${isManager?`<label class="field"><span>${tr('representative')}</span><select id="customerRep" required>${repOptions(repCode,false)}</select></label>`:`<input id="customerRep" type="hidden" value="${esc(repCode)}" />`}${!editing&&isManager?`<label class="field"><span>${tr('openingBalance')}</span><input id="customerOpening" type="number" min="0" step="0.01" value="0" /></label>`:''}<label class="field"><span>${tr('customerType')}</span><select id="customerType"><option value="new" ${customer?.customerType==='new'?'selected':''}>${tr('newCustomer')}</option><option value="potential" ${customer?.customerType==='potential'?'selected':''}>${tr('potentialCustomer')}</option><option value="unlikely" ${customer?.customerType==='unlikely'?'selected':''}>${tr('unlikelyCustomer')}</option></select></label></div><label class="field"><span>${tr('notes')}</span><textarea id="customerNotes">${esc(customer?.notes||'')}</textarea></label>${editing?`<div class="customer-balance"><span>${tr('currentBalance')}</span><strong>${money(customer.currentBalance)}</strong></div>`:''}<div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-primary" type="submit">${tr('save')}</button></div></form>`,onOpen:(root)=>{
    $('[data-close-modal]',root).addEventListener('click',closeModal);$('#customerForm',root).addEventListener('submit',async(e)=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{let id=$('#customerCode',root).value.trim().toUpperCase();if(!id) id=`CUST-${nowReadableId()}-${slug(state.profile.representativeCode||'ADMIN')}`;const selectedRep=$('#customerRep',root).value;if(!selectedRep) throw new Error('REP_REQUIRED');const selectedRegion=$('#customerRegion',root).value;if(!selectedRegion) throw new Error('REGION_REQUIRED');if(!isManager&&selectedRep!==state.profile.representativeCode) throw new Error('PERMISSION');const base={customerCode:id,nameAr:$('#customerNameAr',root).value.trim(),nameEn:$('#customerNameEn',root).value.trim(),mobile:$('#customerMobile',root).value.trim(),address:$('#customerAddress',root).value.trim(),regionCode:selectedRegion,representativeCode:selectedRep,customerType:$('#customerType',root).value,notes:$('#customerNotes',root).value.trim(),active:true,updatedAt:serverTimestamp()};if(editing){await updateDoc(doc(db,'customers',id),base);}else{const opening=isManager?num($('#customerOpening',root)?.value):0;await setDoc(doc(db,'customers',id),{...base,openingBalance:opening,currentBalance:opening,totalWithdrawals:0,totalPaid:0,createdByEmail:state.user.email,createdAt:serverTimestamp()});}await refreshCustomers();closeModal();renderCustomers();toast(tr('saved'));}catch(err){console.error(err);toast(err.message==='PERMISSION'?tr('permissionDenied'):tr('error'),'error');}finally{btn.disabled=false;}});
  }});
}

async function openCustomerDetails(customer){
  const repAllowed=state.profile.role==='manager'||customer.representativeCode===state.profile.representativeCode;if(!repAllowed){toast(tr('permissionDenied'),'error');return;}
  let sales=[];try{const snap=state.profile.role==='manager'?await getDocs(query(collection(db,'sales'),where('customerCode','==',customer.id))):await getDocs(query(collection(db,'sales'),where('representativeCode','==',state.profile.representativeCode)));sales=snap.docs.map(docData).filter(x=>x.customerCode===customer.id).sort((a,b)=>String(b.dateKey).localeCompare(String(a.dateKey)));}catch(err){console.error(err);}
  const canCollect=state.profile.role==='manager';
  showModal({title:tr('customerDetails'),size:'lg',body:`<div class="card card-pad" style="box-shadow:none;margin-bottom:14px"><div class="customer-card-head"><div><h4 style="margin:0">${esc(customerName(customer))}</h4><p>${esc(customer.mobile||'-')} · ${esc(customer.address||'-')} · ${esc(regionName(customer.regionCode))}</p></div><span class="badge gray">${esc(customer.id)}</span></div><div class="customer-meta"><div><span>${tr('currentBalance')}</span><strong class="text-red">${money(customer.currentBalance)}</strong></div><div><span>${tr('itemsTotal')}</span><strong>${money(customer.totalWithdrawals)}</strong></div><div><span>${tr('collection')}</span><strong>${money(customer.totalPaid)}</strong></div><div><span>${tr('representative')}</span><strong>${esc(repName(customer.representativeCode))}</strong></div></div></div><div class="quick-actions"><button id="customerNewSaleBtn" class="btn btn-green quick-action" type="button"><span class="qa-icon">＋</span><strong>${tr('newSale')}</strong></button>${canCollect?`<button id="customerCollectionBtn" class="btn btn-primary quick-action" type="button"><span class="qa-icon">●</span><strong>${tr('collection')}</strong></button>`:''}</div><div class="section-title" style="margin-top:18px"><h4>${tr('salesHistory')}</h4></div><div class="table-scroll"><table><thead><tr><th>${tr('date')}</th><th>${tr('saleNumber')}</th><th>${tr('amount')}</th><th>${tr('collection')}</th><th>${tr('newBalance')}</th></tr></thead><tbody>${sales.map(s=>`<tr><td>${esc(s.dateKey)}</td><td>${esc(s.id)}</td><td>${money(s.total)}</td><td>${money(s.paidAmount)}</td><td>${money(s.newBalance)}</td></tr>`).join('')||`<tr><td colspan="5">${tr('noData')}</td></tr>`}</tbody></table></div>`,onOpen:(root)=>{$('#customerNewSaleBtn',root).addEventListener('click',()=>openSaleModal(customer));if(canCollect)$('#customerCollectionBtn',root).addEventListener('click',()=>openCollectionModal(customer));}});
}

function openSaleModal(customer=null){
  const allowedCustomers=state.profile.role==='manager'?state.customers:state.customers.filter(c=>c.representativeCode===state.profile.representativeCode);let selected=customer||allowedCustomers[0]||null;
  showModal({title:tr('newSale'),size:'lg',body:`<form id="saleForm" class="stack-form"><div class="form-grid"><label class="field"><span>${tr('customer')}</span><select id="saleCustomer" ${customer?'disabled':''}>${allowedCustomers.map(c=>`<option value="${esc(c.id)}" ${selected?.id===c.id?'selected':''}>${esc(customerName(c))}</option>`).join('')}</select></label><div class="field"><span>${tr('previousBalance')}</span><input id="salePreviousBalance" readonly value="${money(selected?.currentBalance)}" /></div></div><div><div class="section-title"><h4>${tr('products')}</h4><button id="addSaleLineBtn" class="btn btn-outline btn-sm" type="button">+ ${tr('addLine')}</button></div><div id="saleLines" class="sale-lines"></div></div><div class="form-grid"><label class="field"><span>${tr('paidNow')}</span><input id="salePaid" type="number" min="0" step="0.01" value="0" /></label><label class="field"><span>${tr('notes')}</span><input id="saleNotes" /></label></div><div class="sale-summary"><div class="sale-summary-row"><span>${tr('itemsTotal')}</span><strong id="saleItemsTotal">0.00</strong></div><div class="sale-summary-row"><span>${tr('paidNow')}</span><strong id="salePaidView">0.00</strong></div><div class="sale-summary-row balance"><span>${tr('newBalance')}</span><strong id="saleNewBalance">${money(selected?.currentBalance)}</strong></div></div><div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-green" type="submit">${tr('saveSale')}</button></div></form>`,onOpen:(root)=>{
    $('[data-close-modal]',root).addEventListener('click',closeModal);
    const lines=$('#saleLines',root);const addLine=(preset=null)=>{const row=document.createElement('div');row.className='sale-line';row.innerHTML=`<label class="field sale-product"><span>${tr('product')}</span><select class="line-product"><option value="">${tr('chooseProduct')}</option>${state.products.filter(p=>p.active!==false).map(p=>`<option value="${esc(p.id)}" ${preset?.productCode===p.id?'selected':''}>${esc(productName(p))}</option>`).join('')}</select></label><label class="field"><span>${tr('quantity')}</span><input class="line-qty" type="number" min="0.01" step="0.01" value="${preset?.quantity||1}" /></label><label class="field"><span>${tr('price')}</span><input class="line-price" type="number" min="0" step="0.01" value="${preset?.unitPrice||0}" readonly /></label><label class="field"><span>${tr('lineTotal')}</span><input class="line-total" readonly value="0.00" /></label><button type="button" class="btn btn-danger-soft btn-xs sale-remove">×</button>`;lines.appendChild(row);const productSel=$('.line-product',row),qty=$('.line-qty',row),price=$('.line-price',row),remove=$('.sale-remove',row);const syncProduct=()=>{const p=state.products.find(x=>x.id===productSel.value);price.value=p?num(p.price):0;recalc();};productSel.addEventListener('change',syncProduct);qty.addEventListener('input',recalc);remove.addEventListener('click',()=>{row.remove();recalc();});if(preset)syncProduct();else recalc();};
    const currentCustomer=()=>allowedCustomers.find(c=>c.id===$('#saleCustomer',root).value)||selected;
    const recalc=()=>{let total=0;$$('.sale-line',root).forEach(row=>{const q=num($('.line-qty',row).value),p=num($('.line-price',row).value),lt=q*p;$('.line-total',row).value=money(lt);total+=lt;});const paid=num($('#salePaid',root).value),prev=num(currentCustomer()?.currentBalance);$('#saleItemsTotal',root).textContent=money(total);$('#salePaidView',root).textContent=money(paid);$('#saleNewBalance',root).textContent=money(prev+total-paid);$('#salePreviousBalance',root).value=money(prev);};
    $('#addSaleLineBtn',root).addEventListener('click',()=>addLine());$('#salePaid',root).addEventListener('input',recalc);if(!customer)$('#saleCustomer',root).addEventListener('change',recalc);addLine();
    $('#saleForm',root).addEventListener('submit',async(e)=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const c=currentCustomer();if(!c)throw new Error('CUSTOMER');const saleItems=$$('.sale-line',root).map(row=>{const productCode=$('.line-product',row).value,q=num($('.line-qty',row).value),unitPrice=num($('.line-price',row).value),p=state.products.find(x=>x.id===productCode);return{productCode,productNameAr:p?.nameAr||'',productNameEn:p?.nameEn||'',unit:p?.unit||'',quantity:q,unitPrice,lineTotal:q*unitPrice};}).filter(x=>x.productCode&&x.quantity>0);if(!saleItems.length)throw new Error('ITEMS');const total=saleItems.reduce((a,x)=>a+x.lineTotal,0),paid=num($('#salePaid',root).value);if(total<=0||paid<0)throw new Error('AMOUNT');const saleId=`SALE-${nowReadableId()}-${slug(c.representativeCode)}`,visitId=`VIS-${nowReadableId()}-${slug(c.representativeCode)}`,paymentId=`PAY-${nowReadableId()}-${slug(c.representativeCode)}`,date=todayKey(),mk=date.slice(0,7);await runTransaction(db,async(tx)=>{const cref=doc(db,'customers',c.id),csnap=await tx.get(cref);if(!csnap.exists())throw new Error('CUSTOMER_NOT_FOUND');const cd=csnap.data();if(state.profile.role!=='manager'&&cd.representativeCode!==state.profile.representativeCode)throw new Error('PERMISSION');const previous=num(cd.currentBalance),newBalance=previous+total-paid;if(paid>previous+total)throw new Error('OVERPAY');const common={customerCode:c.id,customerNameAr:cd.nameAr||'',customerNameEn:cd.nameEn||'',representativeCode:cd.representativeCode,regionCode:cd.regionCode,dateKey:date,monthKey:mk,createdByEmail:state.user.email,createdAtIso:localDateTime(),createdAt:serverTimestamp()};tx.set(doc(db,'sales',saleId),{...common,saleCode:saleId,visitId,items:saleItems,total,paidAmount:paid,previousBalance:previous,newBalance,notes:$('#saleNotes',root).value.trim()});tx.set(doc(db,'visits',visitId),{...common,visitCode:visitId,visitType:'sale',saleId,total,paidAmount:paid,notes:$('#saleNotes',root).value.trim()});if(paid>0)tx.set(doc(db,'payments',paymentId),{...common,paymentCode:paymentId,source:'sale',saleId,visitId,amount:paid});tx.update(cref,{currentBalance:newBalance,totalWithdrawals:num(cd.totalWithdrawals)+total,totalPaid:num(cd.totalPaid)+paid,lastSaleDate:date,lastVisitDate:date,lastSaleId:saleId,updatedAt:serverTimestamp()});});await refreshCustomers();closeModal();toast(tr('saved'));if(state.page==='customers')renderCustomers();else renderDashboard();}catch(err){console.error(err);toast(err.message==='ITEMS'?tr('saleNeedsItem'):err.message==='PERMISSION'?tr('permissionDenied'):tr('invalidAmount'),'error');}finally{btn.disabled=false;}});
  }});
}

function openCollectionModal(customer){
  if(state.profile.role!=='manager')return;showModal({title:tr('collection'),body:`<form id="collectionForm" class="stack-form"><div class="customer-balance"><span>${tr('currentBalance')}</span><strong>${money(customer.currentBalance)}</strong></div><label class="field"><span>${tr('collection')}</span><input id="collectionAmount" type="number" min="0.01" max="${num(customer.currentBalance)}" step="0.01" required /></label><label class="field"><span>${tr('notes')}</span><textarea id="collectionNotes"></textarea></label><div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button class="btn btn-primary" type="submit">${tr('save')}</button></div></form>`,onOpen:(root)=>{$('[data-close-modal]',root).addEventListener('click',closeModal);$('#collectionForm',root).addEventListener('submit',async(e)=>{e.preventDefault();const amount=num($('#collectionAmount',root).value);try{const payId=`PAY-${nowReadableId()}-ADMIN`,visitId=`VIS-${nowReadableId()}-ADMIN`,date=todayKey(),mk=date.slice(0,7);await runTransaction(db,async(tx)=>{const cref=doc(db,'customers',customer.id),csnap=await tx.get(cref);if(!csnap.exists())throw new Error('NOT_FOUND');const cd=csnap.data(),prev=num(cd.currentBalance);if(amount<=0||amount>prev)throw new Error('AMOUNT');const common={customerCode:customer.id,customerNameAr:cd.nameAr||'',customerNameEn:cd.nameEn||'',representativeCode:cd.representativeCode,regionCode:cd.regionCode,dateKey:date,monthKey:mk,createdByEmail:state.user.email,createdAtIso:localDateTime(),createdAt:serverTimestamp()};tx.set(doc(db,'payments',payId),{...common,paymentCode:payId,source:'collection',amount,previousBalance:prev,newBalance:prev-amount,notes:$('#collectionNotes',root).value.trim()});tx.set(doc(db,'visits',visitId),{...common,visitCode:visitId,visitType:'collection',paymentId:payId,amount,notes:$('#collectionNotes',root).value.trim()});tx.update(cref,{currentBalance:prev-amount,totalPaid:num(cd.totalPaid)+amount,lastVisitDate:date,updatedAt:serverTimestamp()});});await refreshCustomers();closeModal();toast(tr('saved'));if(state.page==='customers')renderCustomers();}catch(err){console.error(err);toast(tr('invalidAmount'),'error');}});}});
}

function downloadTemplate(type){
  if(!window.XLSX){toast('XLSX library not loaded','error');return;}const rows=type==='customers'?[{customer_code:'CUST-0001',name_ar:'مؤسسة النور',name_en:'Al Noor',mobile:'0500000000',address:'الرياض',region_code:'REG-RIYADH',representative_code:'REP-AHMED',opening_balance:0,customer_type:'new',notes:''}]:[{product_code:'PRD-0001',name_ar:'اسم الصنف',name_en:'Product Name',unit:'كرتون',price:25}];const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,type==='customers'?'Customers':'Products');XLSX.writeFile(wb,`AREEN-${type}-template.xlsx`);
}

function openImportModal(type){
  const isCustomers=type==='customers';showModal({title:`${tr('importExcel')} - ${isCustomers?tr('customers'):tr('products')}`,size:'lg',body:`<div class="import-panel"><h5>${tr('importExcel')}</h5><p>${tr('uploadHint')}</p><input id="importFile" type="file" accept=".xlsx,.xls,.csv" /></div><div id="importStats" style="margin-top:12px"></div><div id="importPreview" class="import-preview hidden"></div><div class="form-actions"><button class="btn btn-outline" data-close-modal type="button">${tr('cancel')}</button><button id="confirmImportBtn" class="btn btn-primary" type="button" disabled>${tr('confirmImport')}</button></div>`,onOpen:(root)=>{
    $('[data-close-modal]',root).addEventListener('click',closeModal);let parsed=[];$('#importFile',root).addEventListener('change',async(e)=>{const file=e.target.files?.[0];if(!file)return;try{const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:''});parsed=isCustomers?normalizeCustomerImport(rows):normalizeProductImport(rows);renderImportPreview(parsed,root,isCustomers);$('#confirmImportBtn',root).disabled=!parsed.some(x=>x.valid);}catch(err){console.error(err);toast(tr('error'),'error');}});$('#confirmImportBtn',root).addEventListener('click',async()=>{const valid=parsed.filter(x=>x.valid);if(!valid.length)return;const btn=$('#confirmImportBtn',root);btn.disabled=true;try{for(let i=0;i<valid.length;i+=350){const batch=writeBatch(db);valid.slice(i,i+350).forEach(row=>{const d=row.data;batch.set(doc(db,type,d.id),d,{merge:true});});await batch.commit();}if(isCustomers)await refreshCustomers();else await refreshProducts();closeModal();toast(tr('imported'));isCustomers?renderCustomers():renderProducts();}catch(err){console.error(err);toast(tr('error'),'error');}finally{btn.disabled=false;}});
  }});
}

function pick(row,names){for(const n of names){if(row[n]!==undefined&&row[n]!==null&&String(row[n]).trim()!=='')return row[n];}return '';}
function normalizeCustomerImport(rows){return rows.map((r,i)=>{let id=String(pick(r,['customer_code','Customer Code','كود العميل'])).trim().toUpperCase();if(!id)id=`CUST-${nowReadableId()}-${String(i+1).padStart(3,'0')}`;const nameAr=String(pick(r,['name_ar','اسم العميل','اسم العميل بالعربي','Arabic Name'])).trim(),nameEn=String(pick(r,['name_en','اسم العميل بالإنجليزي','English Name'])).trim(),regionRaw=String(pick(r,['region_code','كود المنطقة','Region Code','المنطقة'])).trim(),repRaw=String(pick(r,['representative_code','كود المندوب','Representative Code','اسم المندوب'])).trim();const region=state.regions.find(x=>x.id===regionRaw||x.nameAr===regionRaw||x.nameEn===regionRaw),rep=state.reps.find(x=>x.id===repRaw||x.nameAr===repRaw||x.nameEn===repRaw);const opening=num(pick(r,['opening_balance','الرصيد الافتتاحي','Opening Balance']));const errors=[];if(!nameAr&&!nameEn)errors.push('name');if(!region)errors.push('region');if(!rep)errors.push('representative');const existing=state.customers.find(c=>c.id===id);const data={id,customerCode:id,nameAr,nameEn,mobile:String(pick(r,['mobile','رقم الجوال','Mobile'])).trim(),address:String(pick(r,['address','العنوان','Address'])).trim(),regionCode:region?.id||'',representativeCode:rep?.id||'',openingBalance:existing?num(existing.openingBalance):opening,currentBalance:existing?num(existing.currentBalance):opening,totalWithdrawals:existing?num(existing.totalWithdrawals):0,totalPaid:existing?num(existing.totalPaid):0,customerType:(()=>{const v=String(pick(r,['customer_type','نوع العميل','Customer Type'])).trim().toLowerCase();if(['new','عميل جديد'].includes(v))return'new';if(['potential','محتمل'].includes(v))return'potential';if(['unlikely','غير محتمل'].includes(v))return'unlikely';return v||'new';})(),notes:String(pick(r,['notes','ملاحظات','Notes'])).trim(),active:existing?.active!==false,createdByEmail:existing?.createdByEmail||state.user.email,createdAt:existing?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()};return{valid:!errors.length,errors,data};});}
function normalizeProductImport(rows){return rows.map((r,i)=>{let id=String(pick(r,['product_code','كود الصنف','Product Code'])).trim().toUpperCase();if(!id)id=`PRD-${String(i+1).padStart(4,'0')}`;const nameAr=String(pick(r,['name_ar','اسم الصنف','Arabic Name'])).trim(),nameEn=String(pick(r,['name_en','اسم الصنف بالإنجليزي','English Name'])).trim(),unit=String(pick(r,['unit','الوحدة','Unit'])).trim(),price=num(pick(r,['price','سعر البيع','Price']));const errors=[];if(!nameAr&&!nameEn)errors.push('name');if(!unit)errors.push('unit');if(price<0)errors.push('price');return{valid:!errors.length,errors,data:{id,productCode:id,nameAr,nameEn,unit,price,active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}};});}
function renderImportPreview(parsed,root,isCustomers){const valid=parsed.filter(x=>x.valid).length,invalid=parsed.length-valid;$('#importStats',root).innerHTML=`<span class="badge green">${tr('rowsValid')}: ${valid}</span> <span class="badge ${invalid?'red':'gray'}">${tr('rowsInvalid')}: ${invalid}</span>`;const prev=$('#importPreview',root);prev.classList.remove('hidden');prev.innerHTML=`<table><thead><tr><th>#</th><th>${isCustomers?tr('customerCode'):tr('productCode')}</th><th>${tr('name')}</th><th>${tr('status')}</th></tr></thead><tbody>${parsed.slice(0,100).map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.data.id)}</td><td>${esc(x.data.nameAr||x.data.nameEn)}</td><td><span class="badge ${x.valid?'green':'red'}">${x.valid?tr('active'):esc(x.errors.join(', '))}</span></td></tr>`).join('')}</tbody></table>`;}

async function renderMySales(){
  setPageMeta(tr('mySales'),tr('salesRepresentative'));$('#pageContent').innerHTML=`<div class="page-head"><div><h3>${tr('mySales')}</h3><p>${tr('salesHistory')}</p></div><div class="page-actions"><button id="myNewSaleBtn" class="btn btn-primary">+ ${tr('newSale')}</button></div></div><div id="mySalesBody" class="card table-card"><div class="loading-state"><div class="spinner"></div></div></div>`;$('#myNewSaleBtn').addEventListener('click',()=>openSaleModal());try{const snap=await getDocs(query(collection(db,'sales'),where('representativeCode','==',state.profile.representativeCode)));const rows=snap.docs.map(docData).sort((a,b)=>String(b.createdAtIso||b.dateKey).localeCompare(String(a.createdAtIso||a.dateKey)));$('#mySalesBody').innerHTML=`<div class="table-scroll"><table><thead><tr><th>${tr('date')}</th><th>${tr('saleNumber')}</th><th>${tr('customer')}</th><th>${tr('amount')}</th><th>${tr('collection')}</th><th>${tr('outstanding')}</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${esc(s.dateKey)}</td><td>${esc(s.id)}</td><td>${esc(s.customerNameAr||s.customerNameEn||s.customerCode)}</td><td>${money(s.total)}</td><td>${money(s.paidAmount)}</td><td>${money(s.newBalance)}</td></tr>`).join('')||`<tr><td colspan="6">${tr('noData')}</td></tr>`}</tbody></table></div>`;}catch(err){console.error(err);$('#mySalesBody').innerHTML=emptyMini(tr('noData'));}
}

function renderProfile(){setPageMeta(tr('profile'),tr('accountData'));const rep=state.reps[0];$('#pageContent').innerHTML=`<div class="card card-pad"><div class="section-title"><div><h4>${esc(state.profile.nameAr||state.profile.nameEn||state.profile.username)}</h4><p>${state.profile.role==='manager'?tr('salesManager'):tr('salesRepresentative')}</p></div><span class="badge green">${tr('active')}</span></div><div class="form-grid"><div class="field"><span>${tr('username')}</span><input readonly value="${esc(state.profile.username)}" /></div><div class="field"><span>${tr('representativeCode')}</span><input readonly value="${esc(state.profile.representativeCode||'-')}" /></div><div class="field"><span>${tr('regions')}</span><input readonly value="${esc((rep?.regions||[]).map(regionName).join('، ')||'-')}" /></div><div class="field"><span>${tr('language')}</span><button id="profileLangBtn" class="btn btn-outline" type="button">${state.lang==='ar'?'English':'العربية'}</button></div></div></div>`;$('#profileLangBtn').addEventListener('click',toggleLanguage);}

async function renderReports(){
  setPageMeta(tr('reports'),tr('administration'));const today=todayKey(),first=today.slice(0,8)+'01';$('#pageContent').innerHTML=`<div class="page-head"><div><h3>${tr('reports')}</h3><p>${tr('exportPdf')} / ${tr('exportExcel')}</p></div></div><div class="card report-card no-print"><div class="form-grid cols-4"><label class="field"><span>${tr('reportType')}</span><select id="reportType"><option value="sales">${tr('salesReport')}</option><option value="collections">${tr('collectionReport')}</option><option value="balances">${tr('balancesReport')}</option><option value="performance">${tr('repPerformanceReport')}</option><option value="customerStatement">${tr('customerStatement')}</option><option value="visits">${tr('visitsReport')}</option></select></label><label class="field"><span>${tr('fromDate')}</span><input id="reportFrom" type="date" value="${first}" /></label><label class="field"><span>${tr('toDate')}</span><input id="reportTo" type="date" value="${today}" /></label><label class="field"><span>${tr('region')}</span><select id="reportRegion">${regionOptions('',true)}</select></label><label class="field"><span>${tr('representative')}</span><select id="reportRep">${repOptions('',true)}</select></label><label class="field"><span>${tr('customer')}</span><select id="reportCustomer">${customerOptions('',true)}</select></label></div><div class="form-actions"><button id="generateReportBtn" class="btn btn-primary">${tr('generateReport')}</button><button id="reportExcelBtn" class="btn btn-green" disabled>${tr('exportExcel')}</button><button id="reportPdfBtn" class="btn btn-outline" disabled>${tr('exportPdf')}</button></div></div><div id="reportContainer" style="margin-top:14px"></div>`;$('#generateReportBtn').addEventListener('click',generateReport);$('#reportExcelBtn').addEventListener('click',exportReportExcel);$('#reportPdfBtn').addEventListener('click',exportReportPdf);
}

async function generateReport(){
  const type=$('#reportType').value,from=$('#reportFrom').value,to=$('#reportTo').value,region=$('#reportRegion').value,rep=$('#reportRep').value,customer=$('#reportCustomer').value;const container=$('#reportContainer');container.innerHTML=`<div class="loading-state"><div class="spinner"></div></div>`;try{let rows=[],cols=[],title='';const inRange=(x)=>x.dateKey>=from&&x.dateKey<=to&&(!region||x.regionCode===region)&&(!rep||x.representativeCode===rep)&&(!customer||x.customerCode===customer);if(type==='sales'){const snap=await getDocs(collection(db,'sales'));rows=snap.docs.map(docData).filter(inRange).sort((a,b)=>String(a.dateKey).localeCompare(String(b.dateKey))).map(x=>({date:x.dateKey,number:x.id,customer:x.customerNameAr||x.customerNameEn||x.customerCode,rep:repName(x.representativeCode),region:regionName(x.regionCode),sales:num(x.total),paid:num(x.paidAmount),balance:num(x.newBalance)}));cols=[['date',tr('date')],['number',tr('saleNumber')],['customer',tr('customer')],['rep',tr('representative')],['region',tr('region')],['sales',tr('totalSales')],['paid',tr('collection')],['balance',tr('currentBalance')]];title=tr('salesReport');}else if(type==='collections'){const snap=await getDocs(collection(db,'payments'));rows=snap.docs.map(docData).filter(inRange).sort((a,b)=>String(a.dateKey).localeCompare(String(b.dateKey))).map(x=>({date:x.dateKey,number:x.id,customer:x.customerNameAr||x.customerNameEn||x.customerCode,rep:repName(x.representativeCode),region:regionName(x.regionCode),amount:num(x.amount),source:x.source}));cols=[['date',tr('date')],['number','#'],['customer',tr('customer')],['rep',tr('representative')],['region',tr('region')],['amount',tr('collection')],['source','Source']];title=tr('collectionReport');}else if(type==='balances'){rows=state.customers.filter(c=>(!region||c.regionCode===region)&&(!rep||c.representativeCode===rep)&&(!customer||c.id===customer)).map(c=>({code:c.id,customer:customerName(c),rep:repName(c.representativeCode),region:regionName(c.regionCode),sales:num(c.totalWithdrawals),paid:num(c.totalPaid),balance:num(c.currentBalance)}));cols=[['code',tr('customerCode')],['customer',tr('customer')],['rep',tr('representative')],['region',tr('region')],['sales',tr('itemsTotal')],['paid',tr('collection')],['balance',tr('currentBalance')]];title=tr('balancesReport');}else if(type==='visits'){const snap=await getDocs(collection(db,'visits'));rows=snap.docs.map(docData).filter(inRange).sort((a,b)=>String(a.dateKey).localeCompare(String(b.dateKey))).map(x=>({date:x.dateKey,number:x.id,customer:x.customerNameAr||x.customerNameEn||x.customerCode,rep:repName(x.representativeCode),region:regionName(x.regionCode),type:x.visitType,amount:num(x.total||x.amount||0)}));cols=[['date',tr('date')],['number','#'],['customer',tr('customer')],['rep',tr('representative')],['region',tr('region')],['type',tr('reportType')],['amount',tr('amount')]];title=tr('visitsReport');}else if(type==='customerStatement'){const salesSnap=await getDocs(collection(db,'sales')),paySnap=await getDocs(collection(db,'payments'));const lines=[...salesSnap.docs.map(docData).filter(inRange).map(x=>({date:x.dateKey,type:'Sale',number:x.id,debit:num(x.total),credit:num(x.paidAmount),balance:num(x.newBalance)})),...paySnap.docs.map(docData).filter(x=>inRange(x)&&x.source==='collection').map(x=>({date:x.dateKey,type:'Collection',number:x.id,debit:0,credit:num(x.amount),balance:num(x.newBalance)}))].sort((a,b)=>a.date.localeCompare(b.date));rows=lines;cols=[['date',tr('date')],['type',tr('reportType')],['number','#'],['debit',tr('totalSales')],['credit',tr('collection')],['balance',tr('currentBalance')]];title=tr('customerStatement');}else if(type==='performance'){const salesSnap=await getDocs(collection(db,'sales')),allSales=salesSnap.docs.map(docData).filter(inRange),year=Number(from.slice(0,4)),month=Number(from.slice(5,7)),targets=await getTargetDocs(year);rows=state.reps.filter(r=>(!rep||r.id===rep)&&(!region||(r.regions||[]).includes(region))).map(r=>{const targetDoc=targets.find(x=>x.representativeCode===r.id),m=targetDoc?.months?.[String(month)]||{},target=num(m.target),actual=allSales.filter(s=>s.representativeCode===r.id).reduce((a,x)=>a+num(x.total),0);return{rep:repName(r.id),target,actual,remaining:Math.max(target-actual,0),achievement:target?`${money(actual/target*100)}%`:'0%'};});cols=[['rep',tr('representative')],['target',tr('monthlyTarget')],['actual',tr('actual')],['remaining',tr('remainingTarget')],['achievement',tr('performance')]];title=tr('repPerformanceReport');}
    state.reportRows=rows;state.reportColumns=cols;state.reportTitle=title;renderReportPreview(title,cols,rows,from,to);$('#reportExcelBtn').disabled=!rows.length;$('#reportPdfBtn').disabled=!rows.length;
  }catch(err){console.error(err);container.innerHTML=emptyMini(tr('noData'));toast(tr('error'),'error');}
}
function renderReportPreview(title,cols,rows,from,to){const container=$('#reportContainer');container.innerHTML=`<div id="reportPrintable" class="report-preview"><div class="report-header"><div><h3>${esc(title)}</h3><p>${esc(from)} → ${esc(to)}</p></div><img src="./assets/areen-logo.jpg" alt="AREEN" /></div><div class="report-body"><div class="table-scroll"><table><thead><tr>${cols.map(c=>`<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(([key])=>`<td>${typeof r[key]==='number'?money(r[key]):esc(r[key]??'')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length}">${tr('noData')}</td></tr>`}</tbody></table></div></div></div>`;}
function exportReportExcel(){if(!window.XLSX||!state.reportRows.length)return;const data=state.reportRows.map(r=>Object.fromEntries(state.reportColumns.map(([k,label])=>[label,r[k]]))),ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Report');XLSX.writeFile(wb,`AREEN-${state.reportTitle.replace(/\s+/g,'-')}.xlsx`);}
function exportReportPdf(){const el=$('#reportPrintable');if(!el)return;if(!window.html2pdf){window.print();return;}const opt={margin:[8,8,8,8],filename:`AREEN-${state.reportTitle.replace(/\s+/g,'-')}.pdf`,image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'landscape'}};html2pdf().set(opt).from(el).save();}

$('#loginForm').addEventListener('submit',async(e)=>{e.preventDefault();const btn=$('#loginBtn');btn.disabled=true;try{await loginWithUsername($('#loginUsername').value,$('#loginPassword').value);}catch(err){console.error(err);toast(tr('invalidLogin'),'error');}finally{btn.disabled=false;}});
$('#authLangToggle').addEventListener('click',toggleLanguage);$('#langToggle').addEventListener('click',toggleLanguage);$('#logoutBtnDesktop').addEventListener('click',()=>logout());$('#logoutBtnMobile').addEventListener('click',()=>logout());$('#mobileMenuBtn').addEventListener('click',()=>$('#mobileDrawer').classList.remove('hidden'));$('#closeDrawerBtn').addEventListener('click',()=>$('#mobileDrawer').classList.add('hidden'));

watchAuth(async(user)=>{
  state.user=user;
  if(!user){state.profile=null;state.page=null;$('#appShell').classList.add('hidden');$('#authScreen').classList.remove('hidden');applyLanguage();return;}
  try{const profile=await loadProfile(user);if(!profile){bootstrapManagerModal();return;}if(profile.active===false){await logout();toast(tr('permissionDenied'),'error');return;}state.profile=profile;await loadBaseData();renderAppShell();}catch(err){console.error(err);await logout().catch(()=>{});toast(tr('insufficientSetup'),'error');}
});

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));}
applyLanguage();
