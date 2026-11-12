/* dameum_AR 설정 페이지: 설정 편집, 휴대폰 미리보기, 3D 미리보기, 인식 파일 변환, 불러오기·발행
   편집 중 내용은 이 PC 브라우저 IndexedDB(dameum_ar_admin)에 자동 저장한다. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { derive, deriveHome, validHex, DEFAULT_MAIN, DEFAULT_HOME_BG, PRESET_REP, avgBottom } from './theme.js?v=3.10';
import { sha256Hex, isoNow } from './storage.js?v=3.10';
import { loadModel, deg, PLACEMENT_DEFAULT } from './ar.js?v=3.10';
import { DRAG_SAFE, clampDragY, defaultGuide } from './missions.js?v=3.10';
import { toGlb, MODEL_ACCEPT, MODEL_FMT_LABEL } from './convert.js?v=3.10';
import { compressGlb } from './compress.js?v=3.10';
import { GitHub, gitBlobSha, loadSettings, saveSettings, clearSettings, validRepo, siteUrl, errorInfo } from './github.js?v=3.10';
import { verifyPassword, seal, unseal, fetchVault, VAULT_PATH } from './vault.js?v=3.10';
import { normalizeConfig, normalizeMission, GUIDE_MAX, SCHEMA, BG_PRESETS, EFFECTS, BUILTIN_MODELS, builtinModelPath, isBuiltin, builtinUrl, SUCCESS_NOTE_MAX } from './config.js?v=3.10';
import { IMG_SPECS, SRC_MAX, decodeImage, openImageEditor } from './imageEditor.js?v=3.10';

/* ───────── 기본값 ───────── */
const MB = 1024 * 1024;
const GLB_WARN = 15 * MB, FILE_MAX = 50 * MB, POSTER_WARN = 20;
const CLEAN = ['assets/posters/', 'assets/models/', 'assets/gifts/', 'assets/brand/']; // v2: 안 쓰게 된 v1 로고·대표 이미지도 정리
const MISSION_LABEL = { tap: '터치 N회', drag: '드래그 앤 드롭', hold: '길게 누르기', rotate: '돌려 보기', find: '숨은 아이템 찾기', quiz: '퀴즈', none: '미션 없음' };
/* 새로 만드는 미션의 움직임 속도 = 보통(2). v2 에서 넘어온 미션은 변환 때 고정(0) — 명세 C4·C5 */
const MISSION_DEFAULT = {
  tap: () => ({ type: 'tap', count: 5, guide: '', speed: 2 }),
  drag: () => ({ type: 'drag', target: { x: DRAG_SAFE.defX, y: DRAG_SAFE.defY }, icon: '', guide: '', speed: 2 }),
  hold: () => ({ type: 'hold', seconds: 2, guide: '', speed: 2 }),
  rotate: () => ({ type: 'rotate', marker: 'back', icon: '', guide: '' }),
  find: () => ({ type: 'find', count: 3, icon: '', guide: '' }),
  quiz: () => ({ type: 'quiz', mode: 'choice', question: '', options: ['', ''], answer: 0 }),
  none: () => ({ type: 'none' })
};
const NAME_HELP = '선물 상자·직원 확인 화면에서 관람객에게 보이는 이름으로 지어 주세요';
const MARKERS = [['front', '앞'], ['back', '뒤'], ['left', '왼쪽'], ['right', '오른쪽'], ['up', '위'], ['down', '아래']];
const rid = (n = 6) => { const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const a = crypto.getRandomValues(new Uint8Array(n)); a.forEach((v) => { s += c[v % c.length]; }); return s; };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mdhm = (d) => `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${hm(d)}`;
const sizeTxt = (b) => b >= MB ? (b / MB).toFixed(1) + 'MB' : Math.max(0.1, b / MB).toFixed(1) + 'MB';
const clone = (o) => JSON.parse(JSON.stringify(o));

function blankConfig() {
  return {
    schema: SCHEMA, projectId: `evt-${ymd()}-${rid(6)}`, projectName: '',
    home: { background: DEFAULT_HOME_BG, bgType: 'color', bgPreset: '', image: '', mainColor: DEFAULT_MAIN, startLabel: '' },
    mindFile: 'assets/targets.mind', posters: [],
    stampTour: { enabled: false, gift: { image: '', title: '', description: '', claimNote: '' } },
    staff: { codeHash: '' }, updatedAt: ''
  };
}
function blankMeta() { return { files: {}, needMind: false, publishedSig: '', publishedAt: '', drafts: {} }; }

/* 직원 코드 원문(명세 C9): 이 PC 브라우저의 설정 페이지 전용 저장소에만 둔다(프로젝트 id·해시와 함께).
   발행 파일·config·커밋에는 넣지 않는다. 「새 프로젝트」면 지운다. */
const STAFF_RAW_KEY = 'dameum_ar_admin:staffCode';
const StaffRaw = {
  get() { try { return JSON.parse(localStorage.getItem(STAFF_RAW_KEY) || 'null'); } catch (_) { return null; } },
  set(pid, hash, code) { try { localStorage.setItem(STAFF_RAW_KEY, JSON.stringify({ pid, hash, code })); } catch (_) {} },
  clear() { try { localStorage.removeItem(STAFF_RAW_KEY); } catch (_) {} },
  /* 지금 프로젝트·해시와 맞는 원문만 돌려준다 */
  match(cfg) { const r = StaffRaw.get(); const hsh = cfg.staff && cfg.staff.codeHash; return r && hsh && r.pid === cfg.projectId && r.hash === hsh ? r.code : null; }
};

/* ───────── IndexedDB ─────────
   kv: 편집 상태 · files: 발행할 파일 · orig(v2): 이미지 편집기 원본과 마지막 배치(이 PC에만, 발행하지 않음) */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('dameum_ar_admin', 2);
      r.onupgradeneeded = () => { const d = r.result; ['kv', 'files', 'orig'].forEach((n) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); }); };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode); const s = t.objectStore(store); const q = fn(s);
      t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
    });
  },
  get: (store, k) => DB.tx(store, 'readonly', (s) => s.get(k)),
  put: (store, k, v) => DB.tx(store, 'readwrite', (s) => s.put(v, k)),
  del: (store, k) => DB.tx(store, 'readwrite', (s) => s.delete(k)),
  clear: (store) => DB.tx(store, 'readwrite', (s) => s.clear()),
  keys: (store) => DB.tx(store, 'readonly', (s) => s.getAllKeys())
};
/* 편집기 원본 저장소 (키 = 확장자를 뺀 저장 경로, 예: assets/brand/home) */
const Orig = {
  get: async (k) => { try { return DB.db ? await DB.get('orig', k) : null; } catch (_) { return null; } },
  put: async (k, v) => { try { if (DB.db) await DB.put('orig', k, v); } catch (err) { console.warn('원본 저장 실패', err); } },
  del: async (k) => { try { if (DB.db && k) await DB.del('orig', k); } catch (_) {} },
  clear: async () => { try { if (DB.db) await DB.clear('orig'); } catch (_) {} }
};
const stripExt = (p) => String(p || '').replace(/\.[a-z0-9]+$/i, '');

/* ───────── 상태 ───────── */
const A = {
  cfg: blankConfig(), meta: blankMeta(), blobs: new Map(), urls: new Map(),
  view: 'home', pid: null, tab: 'basic', pvUser: null, gh: loadSettings(), unlocked: false, pw: '', // v3.7 발행 설정 잠금
  busy: false, savedAt: null, err: {}, ghResult: null, staffEdit: false, progress: null, ready: false
};
window.__admin = { A };

/* ───────── DOM 도우미 ───────── */
const $ = (id) => document.getElementById(id);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  kids.flat(9).forEach((c) => { if (c == null || c === false) return; el.append(c.nodeType ? c : String(c)); });
  return el;
}
const icon = (n, cls = 'i') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + n); s.appendChild(u); return s; };
const btn = (label, onClick, { kind = 'secondary', size, ic, dis, busy, cls, title, id } = {}) =>
  h('button', { class: `b ${kind}${size ? ' ' + size : ''}${cls ? ' ' + cls : ''}`, onclick: onClick, disabled: dis || busy, title, id, type: 'button' },
    busy ? h('span', { class: 'spin14' }) : (ic ? icon(ic) : null), label);
const iconBtn = (name, onClick, title, { size, dis, cls } = {}) => h('button', { class: `ibtn${size ? ' ' + size : ''}${cls ? ' ' + cls : ''}`, onclick: onClick, title, 'aria-label': title, disabled: dis, type: 'button' }, icon(name));
const help = (text, kind = 'info') => h('p', { class: 'help' + (kind !== 'info' && kind !== 'lock' ? ' ' + kind : '') }, kind === 'lock' ? icon('lock', 'i i14') : null, h('span', null, text));
const statusEl = (kind, label) => h('span', { class: 'status ' + kind }, label);
const tag = (t) => h('span', { class: 'tag' }, t);
const toggle = (on, onClick, dis) => h('button', { class: 'tg' + (on ? ' on' : ''), onclick: onClick, disabled: dis, role: 'switch', 'aria-checked': String(!!on), type: 'button' });
const seg = (opts, value, onChange, { label } = {}) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
  opts.map(([v, l]) => h('button', { class: v === value ? 'on' : '', type: 'button', onclick: () => onChange(v), 'aria-pressed': String(v === value) }, l)));
const field = (label, control, { hint, helpEl, count } = {}) => h('div', { class: 'fld' },
  h('label', { class: 'lbl' }, label, hint ? h('span', { class: 'u' }, hint) : null, count || null), control, helpEl || null);
const section = (title, { desc, right, box } = {}, ...content) => h('section', { class: 'sect' },
  h('div', { class: 'sect-h' }, h('h2', null, title), right || null), desc ? h('p', { class: 'sect-d' }, desc) : null,
  h('div', { class: 'sect-c' + (box ? ' box' : '') }, content));
const settingRow = (label, hintText, control, { end } = {}) => h('div', { class: 'srow' },
  h('div', { class: 'l' }, label, hintText ? h('div', { class: 'h' }, hintText) : null), h('div', { class: 'c' + (end ? ' end' : '') }, control));

/* 12-F-12 썸네일 칩 묶음 thumbChip({items:[{value,label,thumb,pos,disabled}], value, onChange, clearable, label})
   thumb = 그림 주소(문자열) 또는 () => Promise<주소>(3D 모델 렌더). 렌더 전·실패 = 빈 원. */
function thumbChip({ items, value, onChange, clearable = false, label }) {
  const group = h('div', { class: 'tchips', role: 'radiogroup', 'aria-label': label });
  const chips = items.map((it, i) => {
    const on = it.value === value;
    const th = h('span', { class: 'th' });
    const setImg = (src) => { if (src) th.replaceChildren(h('img', { alt: '', src, style: it.pos ? `object-position:${it.pos}` : null, onerror: (e) => e.target.remove() })); };
    if (typeof it.thumb === 'function') it.thumb().then(setImg, () => {}); else setImg(it.thumb);
    const b = h('button', { class: 'tchip' + (on ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(on), disabled: it.disabled, tabindex: on || (value == null && i === 0) ? '0' : '-1',
      onclick: () => { if (it.disabled) return; onChange(on && clearable ? null : it.value); } }, th, h('span', { class: 'nm' }, it.label));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const list = chips.filter((c) => !c.disabled);
      const k = list.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1);
      const nx = list[(k + list.length) % list.length];
      if (nx) { chips.forEach((c) => c.setAttribute('tabindex', '-1')); nx.setAttribute('tabindex', '0'); nx.focus(); }
    });
    return b;
  });
  group.append(...chips);
  return group;
}

function input(value, onInput, { ph, type = 'text', cls = '', max, err, id, onChange } = {}) {
  const el = h('input', { class: 'inp ' + cls + (err ? ' err' : ''), type, placeholder: ph, maxlength: max, id, autocomplete: 'off', spellcheck: 'false' });
  el.value = value ?? '';
  el.addEventListener('input', () => onInput(el.value, el));
  if (onChange) el.addEventListener('change', () => onChange(el.value, el));
  return el;
}
function textarea(value, onInput, { ph, max, rows = 4 } = {}) {
  const el = h('textarea', { class: 'inp', placeholder: ph, maxlength: max, rows });
  el.value = value ?? '';
  el.addEventListener('input', () => onInput(el.value, el));
  return el;
}

/* ───────── 토스트 · 메뉴 · 확인 · 모달 ───────── */
let toastT = 0;
function toast(msg, { kind, link } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), role: 'status' }, h('span', null, msg),
    link ? h('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.label) : null);
  document.body.appendChild(t);
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), link ? 6000 : 2400);
}
function closeMenu() { document.querySelectorAll('.menu').forEach((m) => m.remove()); document.removeEventListener('mousedown', menuAway, true); }
function menuAway(e) { if (!e.target.closest('.menu')) closeMenu(); }
function menu(items, anchor) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' }, items.map((it) => h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', disabled: it.dis, type: 'button',
    onclick: (e) => { e.stopPropagation(); closeMenu(); it.onClick(); } }, it.label)));
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  m.style.top = (r.bottom + 4) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  setTimeout(() => document.addEventListener('mousedown', menuAway, true), 0);
}
function askConfirm({ title, msg, ok = '확인', tone = 'brand', onOk, noCancel, cancel = '취소' }) {
  const wrap = h('div', { class: 'mscrim top' });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const okBtn = btn(ok, async () => { close(); if (onOk) await onOk(); }, { kind: tone === 'danger' ? 'danger' : 'primary' });
  wrap.appendChild(h('div', { class: 'confirm', role: 'alertdialog', 'aria-modal': 'true' },
    h('h2', { class: 'f-lg' }, title), msg ? h('p', { class: 'msg' }, msg) : null,
    h('div', { class: 'bt' }, noCancel ? null : btn(cancel, close), okBtn)));
  document.body.appendChild(wrap);
  document.addEventListener('keydown', esc);
  okBtn.focus();
  return close;
}

/* ───────── 파일 ───────── */
function urlOf(path) {
  if (!path) return '';
  if (A.urls.has(path)) return A.urls.get(path);
  const b = A.blobs.get(path);
  if (!b) return builtinUrl(path); // 아직 받지 않은 파일·builtin/ 내장 파일은 사이트 상대 경로
  const u = URL.createObjectURL(b);
  A.urls.set(path, u);
  return u;
}
async function putFile(path, blob, info = {}) {
  if (A.urls.has(path)) { URL.revokeObjectURL(A.urls.get(path)); A.urls.delete(path); }
  A.blobs.set(path, blob);
  A.meta.files[path] = { name: info.name || path.split('/').pop(), size: blob.size, v: rid(4), anims: info.anims ?? null, failed: !!info.failed,
    from: info.from || null, missing: info.missing && info.missing.length ? info.missing : null, w: info.w || null, h: info.h || null,
    packed: info.packed || null }; // v3.5: { before, after } 또는 { skip: 이유 }
  await DB.put('files', path, blob);
}
async function dropFile(path) {
  if (!path) return;
  if (A.urls.has(path)) { URL.revokeObjectURL(A.urls.get(path)); A.urls.delete(path); }
  A.blobs.delete(path);
  delete A.meta.files[path];
  await DB.del('files', path);
}
const extOf = (file) => (/\.png$/i.test(file.name) || file.type === 'image/png') ? 'png'
  : (/\.webp$/i.test(file.name) || file.type === 'image/webp') ? 'webp' // v3.3
  : (/\.glb$/i.test(file.name) ? 'glb' : 'jpg');
const isImg = (file) => /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
const IMG_ACCEPT = 'image/png,image/jpeg,image/webp';
const fmtOfPath = (p) => (/\.png$/i.test(p) ? 'PNG' : /\.webp$/i.test(p) ? 'WebP' : 'JPG');

/* v3.5 모델 압축: Draco 로 줄이고, 줄인 파일이 실제로 다시 읽히는지 확인한 뒤에만 쓴다.
   결과: { blob, packed: {before, after} | {skip: 이유} } */
async function packModel(blob) {
  let c;
  try { c = await compressGlb(blob); } catch (e) { console.warn('모델 압축 실패:', e); return { blob, packed: { skip: '압축 실패' } }; }
  if (!c.compressed) return { blob, packed: { skip: c.reason || '효과 작음' } };
  const u = URL.createObjectURL(c.blob);
  const m = await loadModel(u);
  URL.revokeObjectURL(u);
  if (m.failed) return { blob, packed: { skip: '압축본 확인 실패' } };
  return { blob: c.blob, packed: { before: c.before, after: c.after } };
}

/* 파일 칸 (12-F-6) */
function fileField({ path, kind = 'image', required, onFile, onClear, warn, error }) {
  const accept = kind === 'glb' ? MODEL_ACCEPT : IMG_ACCEPT;
  const picker = h('input', { type: 'file', accept, hidden: true, multiple: kind === 'glb' ? '' : null });
  const wrap = h('div');
  let err = error || '', busy = false, busyTxt = '';
  const take = async (list) => {
    const files = [...(list || [])];
    if (!files.length || busy) return;
    if (kind === 'glb') {
      // 3D 모델: GLB 가 아니면 브라우저에서 GLB 로 바꾼 뒤 저장한다. 크기 기준은 변환 결과에 적용한다.
      busy = true; err = ''; draw();
      let res;
      try { res = await toGlb(files); } catch (e) { busy = false; err = (e && e.message) || '3D 모델을 읽지 못했습니다'; draw(); return; }
      // v3.5: 도형을 Draco로 압축해 관람객 로딩을 빠르게 한다(다시 읽히는지 확인하고, 안 되면 원본 유지)
      busyTxt = '용량을 줄이는 중…'; draw();
      const pk = await packModel(res.blob);
      res = { ...res, blob: pk.blob, packed: pk.packed };
      busy = false; busyTxt = '';
      if (res.blob.size > FILE_MAX) {
        err = `${res.converted ? `${res.from}에서 변환한 GLB가 ` : ''}${sizeTxt(res.blob.size)} — 50MB를 넘는 파일은 저장소에 올릴 수 없습니다`; draw(); return;
      }
      await onFile(res.blob, res);
      return;
    }
    const file = files[0];
    if (!isImg(file)) { err = 'JPG·PNG·WebP 파일만 올릴 수 있습니다'; draw(); return; }
    if (file.size > FILE_MAX) { err = `${sizeTxt(file.size)} — 50MB를 넘는 파일은 저장소에 올릴 수 없습니다`; draw(); return; }
    err = '';
    await onFile(file);
  };
  picker.addEventListener('change', () => { take(picker.files); picker.value = ''; });
  const packExisting = async () => {
    if (busy || !path) return;
    busy = true; busyTxt = '용량을 줄이는 중…'; err = ''; draw();
    let src = A.blobs.get(path);
    try { if (!src) src = await (await fetch(urlOf(path))).blob(); } catch (_) { src = null; }
    if (!src) { busy = false; busyTxt = ''; err = '모델 파일을 읽지 못했습니다'; draw(); return; }
    const pk = await packModel(src);
    busy = false; busyTxt = '';
    const meta = A.meta.files[path] || {};
    await onFile(pk.blob, { name: meta.name, from: meta.from, converted: !!meta.from, missing: meta.missing || [], packed: pk.packed });
    if (pk.packed && pk.packed.skip) toast(`더 줄일 수 없는 모델입니다 (${pk.packed.skip})`);
  };
  const draw = () => {
    wrap.innerHTML = '';
    const meta = path ? A.meta.files[path] : null;
    if (busy) {
      wrap.append(h('div', { class: 'drop', 'aria-busy': 'true' }, h('span', { class: 'spin14' }), busyTxt || 'GLB로 변환하는 중…'));
    } else if (path && (meta || A.blobs.has(path))) {
      const name = (meta && meta.name) || path.split('/').pop();
      const size = meta ? meta.size : (A.blobs.get(path) || {}).size || 0;
      const pkd = kind === 'glb' && meta && meta.packed && meta.packed.after;
      const extra = (pkd ? ` · 압축됨(${sizeTxt(meta.packed.before)}에서 줄임)` : '') +
        (kind === 'glb' && meta && meta.from ? ` · ${meta.from}에서 GLB로 변환` : '') +
        (kind === 'glb' && meta && meta.anims != null ? (meta.anims ? ` · 애니메이션 ${meta.anims}개` : '') : '');
      // v3.5: 압축 전에 올린 모델은 「용량 줄이기」로 한 번에 압축한다(시도해서 효과가 없었으면 버튼을 숨김)
      const canPack = kind === 'glb' && meta && !meta.packed && !meta.failed && size > 300 * 1024;
      wrap.append(h('div', { class: 'file' },
        h('span', { class: 'ft' }, kind === 'glb' ? 'GLB' : h('img', { alt: '', src: urlOf(path) })),
        h('div', { class: 'nm' }, h('div', { class: 'n ell', title: name }, name), h('div', { class: 'sz' }, sizeTxt(size) + extra)),
        canPack ? h('span', { class: 'f-xs t3' }, '자동 압축 대기') : null, // v3.6: 버튼 대신 자동 압축
        btn('바꾸기', () => picker.click(), { kind: 'ghost', size: 'sm' }),
        required ? null : btn('지우기', () => onClear && onClear(), { kind: 'ghost', size: 'sm' })));
      if (!err && kind === 'glb' && size > GLB_WARN) wrap.append(help('15MB를 넘어 관람객 로딩이 느려질 수 있습니다.', 'warn'));
      if (!err && kind === 'glb' && meta && meta.missing) wrap.append(help(`재질·텍스처 파일 ${meta.missing.length}개를 찾지 못해 그 부분은 기본 색으로 바꿨습니다: ${meta.missing.slice(0, 3).join(', ')}${meta.missing.length > 3 ? ` 외 ${meta.missing.length - 3}개` : ''}. 모델 파일과 함께 선택하거나 zip으로 올려 주세요.`, 'warn'));
      if (!err && warn) wrap.append(help(warn, 'warn'));
    } else {
      const d = h('div', { class: 'drop' + (err ? ' err' : ''), role: 'button', tabindex: '0', onclick: () => picker.click(),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } } },
        '파일을 끌어 놓거나 ', h('span', { class: 'link' }, '선택'), h('span', { class: 'fmt' }, kind === 'glb' ? MODEL_FMT_LABEL : 'JPG·PNG·WebP'));
      d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); take(e.dataTransfer.files); });
      wrap.append(d);
    }
    if (err) wrap.append(help(err, 'error'));
    wrap.append(picker);
  };
  draw();
  return wrap;
}

/* 규격 이미지 칸 (12-F-6 「규격 이미지」 변형): 고르거나 끌어 놓으면 저장 전에 이미지 편집기(12-F-11)를 연다.
   specKey: home | gift | icon · base: 확장자를 뺀 저장 경로(출력 형식에 따라 .png/.jpg) */
const kbTxt = (b) => (b >= MB ? (b / MB).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB');
const editorUi = () => ({ h, btn, iconBtn, icon, help, seg, colorField });
function specField({ specKey, path, base, onSaved, onClear }) {
  const spec = IMG_SPECS[specKey];
  const picker = h('input', { type: 'file', accept: IMG_ACCEPT, hidden: true });
  const wrap = h('div');
  let err = '', busy = false;
  const fail = (m) => { busy = false; err = m; draw(); };
  const openEd = (img, srcBlob, place, bg) => openImageEditor({
    spec, img, place, bg, ui: editorUi(),
    onApply: async (blob, info) => {
      const np = `${base}.${info.fmt}`;
      if (path && path !== np) await dropFile(path);
      await putFile(np, blob, { name: np.split('/').pop(), w: info.w, h: info.h });
      if (srcBlob) await Orig.put(base, { blob: srcBlob, place: info.place, bg: info.bg });
      onSaved(np);
    }
  });
  const take = async (list) => {
    const file = [...(list || [])][0];
    if (!file || busy) return;
    if (!isImg(file)) { fail('JPG·PNG·WebP 파일만 올릴 수 있습니다'); return; }
    if (file.size > SRC_MAX) { fail('30MB 이하 이미지를 올려 주세요'); return; }
    busy = true; err = ''; draw();
    let img;
    try { img = await decodeImage(file); } catch (_) { fail('이미지를 읽지 못했습니다'); return; } // 읽지 못하면 편집기를 열지 않는다
    busy = false; draw();
    openEd(img, file, null, null);
  };
  const edit = async () => {
    if (busy) return;
    busy = true; err = ''; draw();
    const rec = await Orig.get(base);
    try {
      if (rec && rec.blob) { const img = await decodeImage(rec.blob); busy = false; draw(); openEd(img, rec.blob, rec.place, rec.bg); return; }
      // 원본이 없으면(다른 PC·사이트에서 불러옴) 지금 저장된 이미지를 원본으로 연다
      const img = await decodeImage(urlOf(path));
      busy = false; draw();
      openEd(img, A.blobs.get(path) || null, null, null);
    } catch (_) { fail('이미지를 읽지 못했습니다'); }
  };
  picker.addEventListener('change', () => { take(picker.files); picker.value = ''; });
  const draw = () => {
    wrap.replaceChildren();
    const meta = path ? A.meta.files[path] : null;
    if (busy) {
      wrap.append(h('div', { class: 'drop', 'aria-busy': 'true' }, h('span', { class: 'spin14' }), '이미지를 불러오는 중…'));
    } else if (path && (meta || A.blobs.has(path))) {
      const name = (meta && meta.name) || path.split('/').pop();
      const size = meta ? meta.size : (A.blobs.get(path) || {}).size || 0;
      const fmt = fmtOfPath(path);
      const w = meta && meta.w, hh = meta && meta.h;
      if (meta && !w) { // v1 에서 올린 이미지: 픽셀 크기를 읽어 둔다(발행 내용은 바뀌지 않음)
        decodeImage(urlOf(path)).then((im) => { meta.w = im.naturalWidth; meta.h = im.naturalHeight; if (wrap.isConnected) draw(); }).catch(() => {});
      }
      wrap.append(h('div', { class: 'file' },
        h('span', { class: 'ft' }, h('img', { alt: '', src: urlOf(path) })),
        h('div', { class: 'nm' }, h('div', { class: 'n ell', title: name }, name), h('div', { class: 'sz' }, (w ? `${w}×${hh} · ` : '') + `${fmt} · ${kbTxt(size)}`)),
        btn('편집', () => edit(), { kind: 'ghost', size: 'sm' }),
        btn('바꾸기', () => picker.click(), { kind: 'ghost', size: 'sm' }),
        btn('지우기', () => onClear && onClear(), { kind: 'ghost', size: 'sm' })));
      const off = w && (w !== spec.w || hh !== spec.h || (spec.pngOnly && fmt === 'JPG'));
      if (!err && off) wrap.append(help('규격과 다릅니다 · 편집으로 맞출 수 있습니다'));
      else if (!err && size > spec.max) wrap.append(help(`권장 용량(${spec.maxTxt})보다 커서 관람객 화면에서 늦게 뜰 수 있습니다`, 'warn')); // v3.3
    } else {
      const d = h('div', { class: 'drop' + (err ? ' err' : ''), role: 'button', tabindex: '0', onclick: () => picker.click(),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } } },
        '파일을 끌어 놓거나 ', h('span', { class: 'link' }, '선택'), h('span', { class: 'fmt num' }, spec.line));
      d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); take(e.dataTransfer.files); });
      wrap.append(d);
    }
    if (err) wrap.append(help(err, 'error'));
    wrap.append(picker);
  };
  draw();
  return wrap;
}

/* ───────── 저장 · 발행 상태 ───────── */
function sig() {
  const f = Object.entries(A.meta.files).map(([p, m]) => p + ':' + m.v).sort().join('|');
  const c = { ...A.cfg, updatedAt: '' };
  return JSON.stringify(c) + '#' + f;
}
let saveT = 0;
function changed({ preview = true, header = true } = {}) {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 300);
  if (preview) sendPreviewSoon();
  if (header) renderHeader();
}
async function saveNow() {
  try {
    await DB.put('kv', 'project', { cfg: A.cfg, meta: A.meta });
    A.savedAt = new Date();
    renderHeader();
  } catch (err) { console.warn('자동 저장 실패', err); }
}
function pubState() {
  if (A.meta.needMind && A.cfg.posters.length) return ['warning', '인식 파일 다시 만들기 필요'];
  if (sig() !== A.meta.publishedSig) return ['warning', '발행 안 한 변경 있음'];
  if (A.meta.publishedAt) return ['success', '발행됨 ' + mdhm(new Date(A.meta.publishedAt))];
  return null;
}
function markMind() { if (A.cfg.posters.length) A.meta.needMind = true; }

/* ───────── 헤더 · 사이드바 ───────── */
function projName() { return (A.cfg.projectName || '').trim() || '새 프로젝트'; }
function renderHeader() {
  const hd = $('hdr');
  const st = pubState();
  hd.replaceChildren(
    h('span', { class: 'prod' }, 'dameum AR 설정'), h('span', { class: 'vline' }),
    h('span', { class: 'proj ell', title: projName() }, projName()),
    h('div', { class: 'right' },
      A.savedAt ? h('span', { class: 'meta num' }, '자동 저장 ' + hm(A.savedAt)) : null,
      h('span', { class: 'gap3' }),
      st ? statusEl(st[0], st[1]) : null,
      // v3.7: 열 때 사이트 설정을 자동으로 가져오므로 「사이트에서 불러오기」·「사이트 열기」는 없앰
      h('span', { class: 'gap3' }),
      iconBtn('more', (e) => menu([
        { label: '새 프로젝트', onClick: () => newProject(), dis: A.busy },
        { label: '인식 파일 만들기', onClick: () => compileMind(), dis: A.busy || !A.cfg.posters.length }
      ], e.currentTarget), '더보기', { dis: A.busy }),
      btn(A.busy ? '발행 중…' : 'GitHub에 바로 발행', () => publish(), { kind: 'primary', busy: A.busy, id: 'btnPublish' })),
    A.progress != null ? h('div', { class: 'pbar' }, h('i', { style: `width:${Math.round(A.progress * 100)}%` })) : '');
}
function renderSide() {
  const n = A.cfg.posters.length;
  const item = (v, label, extra) => h('button', { class: (A.view === v || (v === 'posters' && A.view === 'poster')) ? 'cur' : '', type: 'button', onclick: () => go(v) }, label, extra || null);
  $('side').replaceChildren(
    item('home', '홈 꾸미기'),
    item('posters', '포스터', n > POSTER_WARN ? h('span', { class: 'f-xs warnN num' }, n) : h('span', { class: 'cnt' }, n)),
    item('staff', '직원 코드·스탬프 투어'),
    item('github', '발행 설정'));
}

/* ───────── 화면 전환 ───────── */
function go(view, opts = {}) {
  closeMenu();
  if (view !== A.view || opts.pid !== A.pid) A.pvUser = null;
  A.view = view;
  if (opts.pid !== undefined) A.pid = opts.pid;
  if (opts.tab) A.tab = opts.tab;
  render();
  $('main').scrollTop = 0;
}
function render() {
  renderHeader(); renderSide();
  const ph = $('pheadHost'), form = $('formCol'), plain = $('plainHost'), edit = $('editWrap');
  ph.replaceChildren(); form.replaceChildren(); plain.replaceChildren();
  const withPhone = A.view === 'home' || A.view === 'poster';
  edit.hidden = !withPhone;
  if (A.vp && A.vp.el.parentNode) A.vp.el.remove();
  if (A.view === 'home') viewHome(ph, form);
  else if (A.view === 'posters') viewPosters(ph, plain);
  else if (A.view === 'poster') viewPoster(ph, form);
  else if (A.view === 'staff') viewStaff(ph, plain);
  else if (A.view === 'github') viewGithub(ph, plain);
  if (withPhone) { renderPvSeg(); layoutPhone(); sendPreview(); }
}
function pageHeader(host, title, { right, back, tabs, tagEl, status } = {}) {
  const head = h('div', { class: 'phead' + (tabs ? ' withtabs' : '') });
  const titleRow = h('div', { class: 'row' }, h('h1', { class: 'f-xl ell t', title }, title), tagEl || null, status || null, right ? h('div', { class: 'acts' }, right) : null);
  if (back) head.append(h('div', null, h('button', { class: 'back', type: 'button', onclick: back.onClick }, icon('chevL', 'i i14'), back.label)));
  head.append(titleRow);
  if (tabs) head.append(tabs);
  host.append(head);
}

/* ───────── 휴대폰 미리보기 (12-F-3) ───────── */
const iframe = $('pvIframe');
let pvReady = false, pvT = 0;
function pvSrc() { return 'index.html?preview=1&embed=1&reset=1'; }
function autoScene() {
  if (A.view === 'home') return 'home';
  if (A.view === 'poster') return A.tab === 'gift' ? 'gift' : 'found';
  return 'home';
}
function pvScene() { return A.pvUser || autoScene(); }
function renderPvSeg() {
  const cur = pvScene();
  const hasPoster = A.cfg.posters.length > 0;
  $('pvSeg').replaceChildren(...[['home', '홈'], ['found', '인식 후'], ['box', '선물 상자']].map(([v, l]) =>
    h('button', { class: (cur === v || (v === 'found' && cur === 'gift')) ? 'on' : '', type: 'button', disabled: v === 'found' && !hasPoster,
      onclick: () => { A.pvUser = v; renderPvSeg(); sendPreview(); } }, l)));
}
function resolvedConfig() {
  const c = normalizeConfig(A.cfg);
  const r = (p) => (p ? urlOf(p) : p);
  c.home.image = r(c.home.image);
  c.posters.forEach((p) => {
    p.image = r(p.image); p.model = p.model ? r(p.model) : null;
    if (p.gift) p.gift.image = r(p.gift.image);
    if (p.mission && p.mission.icon) p.mission.icon = r(p.mission.icon);
  });
  if (c.stampTour && c.stampTour.gift) c.stampTour.gift.image = r(c.stampTour.gift.image);
  return c;
}
function sendPreview() {
  if (!pvReady || !iframe.contentWindow) return;
  const sc = pvScene();
  let poster = 1;
  if (A.view === 'poster') poster = Math.max(1, A.cfg.posters.findIndex((p) => p.id === A.pid) + 1);
  iframe.contentWindow.postMessage({ type: 'dameum:config', config: resolvedConfig(), scene: { kind: sc, poster } }, location.origin);
}
function sendPreviewSoon() { clearTimeout(pvT); pvT = setTimeout(sendPreview, 150); }
/* 「미리보기로 보기」: 휴대폰 미리보기 「인식 후」에서 성공 연출만 1회(명세 C3) */
function playPreviewFx() {
  if (!pvReady || !iframe.contentWindow) return;
  if (pvScene() !== 'found') { A.pvUser = 'found'; renderPvSeg(); }
  clearTimeout(pvT);
  sendPreview();
  iframe.contentWindow.postMessage({ type: 'dameum:playfx' }, location.origin);
}
function layoutPhone() {
  const fr = $('pvFrame');
  $('phoneCol').style.top = Math.max(16, $('pheadHost').offsetHeight - 24 + 16) + 'px';
  const top = Math.max(fr.getBoundingClientRect().top, 48 + 16 + 36);
  const avail = window.innerHeight - top - 24;
  const s = Math.max(0.3, Math.min(360 / 390, avail / 844));
  fr.style.width = Math.round(390 * s) + 'px';
  fr.style.height = Math.round(844 * s) + 'px';
  iframe.style.transform = `scale(${s})`;
}
function loadIframe() {
  pvReady = false;
  $('pvOver').hidden = false;
  $('pvOver').replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin14' }), '미리보기를 불러오는 중…'));
  if (location.protocol === 'file:') {
    $('pvOver').replaceChildren(h('div', { class: 'empty', style: 'padding-top:96px' }, h('p', { class: 'w5' }, '미리보기를 열 수 없습니다'), h('p', { class: 'd' }, '로컬 서버(serve.ps1)로 열어 주세요')));
    return;
  }
  iframe.src = pvSrc();
}
window.addEventListener('message', (e) => {
  if (e.source !== iframe.contentWindow || !e.data) return;
  if (e.data.type === 'dameum:ready') { pvReady = true; $('pvOver').hidden = true; sendPreview(); }
});
$('pvReload').onclick = () => loadIframe();
window.addEventListener('resize', () => { if (!$('editWrap').hidden) layoutPhone(); });

/* ───────── A1 홈 꾸미기 ───────── */
/* 홈 버튼 대비 기준 색(rep): 프리셋 = 대표색, 블러 = 홈 이미지 아래 띠 평균(읽기 전·실패 = 배경색), 단색 = 배경색 */
function homeRep() {
  const hm_ = A.cfg.home;
  if (hm_.bgType === 'preset' && PRESET_REP[hm_.bgPreset]) return PRESET_REP[hm_.bgPreset];
  if (hm_.bgType === 'blur' && hm_.image && A.blurRep && A.blurRep.key === urlOf(hm_.image) + '|' + hm_.background && A.blurRep.rep) return A.blurRep.rep;
  return hm_.background;
}
function viewHome(ph, form) {
  pageHeader(ph, '홈 꾸미기');
  const hm_ = A.cfg.home;
  if (!['color', 'preset', 'blur'].includes(hm_.bgType)) hm_.bgType = 'color';
  if (hm_.bgType === 'blur' && !hm_.image) hm_.bgType = 'color';
  let mainField = null;
  const bgField = colorField(hm_.background, (v) => { hm_.background = v; changed(); refreshRep(); if (mainField) mainField.repaint(); },
    { plain: true, fallback: DEFAULT_HOME_BG, label: '배경색' });
  mainField = colorField(hm_.mainColor, (v) => { hm_.mainColor = v; changed(); }, { bg: homeRep });
  // 블러 기준 색은 이미지를 읽어야 알 수 있다 → 읽은 뒤 메인 색 도움말을 다시 그린다
  function refreshRep() {
    if (hm_.bgType !== 'blur' || !hm_.image) return;
    const key = urlOf(hm_.image) + '|' + hm_.background;
    if (A.blurRep && A.blurRep.key === key) return;
    A.blurRep = { key, rep: null };
    avgBottom(urlOf(hm_.image), hm_.background).then((rep) => { if (A.blurRep && A.blurRep.key === key) { A.blurRep.rep = rep; if (mainField && mainField.isConnected) mainField.repaint(); } });
  }
  refreshRep();
  const imgHost = h('div', null, specField({
    specKey: 'home', path: hm_.image, base: 'assets/brand/home',
    onSaved: (np) => { hm_.image = np; changed(); render(); },
    // 블러를 고른 뒤 홈 이미지를 지우면 배경은 단색으로 바뀐다(명세 C1)
    onClear: async () => { await dropFile(hm_.image); await Orig.del('assets/brand/home'); hm_.image = ''; if (hm_.bgType === 'blur') hm_.bgType = 'color'; changed(); render(); }
  }), hm_.image ? null : help('홈 이미지가 없으면 관람객 홈에 버튼만 보입니다'));
  const cnt = h('span', { class: 'cnt-r' }, `${(hm_.startLabel || '').length} / 20`);
  // 「배경」 (12-F-8 v2.5): seg 3칸 → 선택별 칸
  const bgSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '배경' }, [['color', '단색'], ['preset', '프리셋 이미지'], ['blur', '홈 이미지 블러']].map(([v, l]) => {
    const dis = v === 'blur' && !hm_.image;
    return h('button', { class: hm_.bgType === v ? 'on' : '', type: 'button', 'aria-pressed': String(hm_.bgType === v), disabled: dis, title: dis ? '홈 이미지를 넣으면 고를 수 있습니다' : null,
      onclick: () => {
        if (dis || hm_.bgType === v) return;
        hm_.bgType = v;
        if (v === 'preset' && !BG_PRESETS.some(([k]) => k === hm_.bgPreset)) hm_.bgPreset = BG_PRESETS[0][0]; // 처음 고르면 첫 칩
        changed(); render();
      } }, l);
  }));
  let sub;
  if (hm_.bgType === 'preset') {
    sub = thumbChip({ label: '배경 프리셋', value: hm_.bgPreset, clearable: false,
      items: BG_PRESETS.map(([id, name]) => ({ value: id, label: name, thumb: builtinUrl(`builtin/bg/${id}.jpg`), pos: '50% 30%' })),
      onChange: (v) => { if (!v || v === hm_.bgPreset) return; hm_.bgPreset = v; changed(); render(); setTimeout(() => { const b = document.querySelector('.tchips .tchip.on'); if (b) b.focus(); }, 0); } });
  } else if (hm_.bgType === 'blur') sub = help('홈 이미지를 흐리게 해 화면 전체에 깝니다.');
  else sub = bgField;
  form.append(section('홈 화면', {},
    field('배경', h('div', null, h('div', null, bgSeg), h('div', { class: 'bgsub' }, sub),
      hm_.image ? null : help('홈 이미지를 넣으면 「홈 이미지 블러」를 고를 수 있습니다.'))),
    field('홈 이미지', imgHost),
    field('메인 색', mainField),
    field('시작 버튼 문구', input(hm_.startLabel, (v) => { hm_.startLabel = v; cnt.textContent = `${v.length} / 20`; changed(); }, { ph: 'AR 시작하기', max: 20 }),
      { count: cnt, helpEl: help('10자 이내를 권장합니다. 길면 버튼 안에서 두 줄로 나뉩니다(최대 20자).') })));
}

/* 색 입력 (12-F-8). plain = 배경색 변형(견본 + HEX만), sm = 편집기 안 작은 크기.
   bg 가 있으면(메인 색 칸) 홈 버튼이 배경에 묻혀 흑/백으로 바뀌는지도 같은 도움말 한 줄에 알린다(AR1.3 3-3 (E)). */
function colorField(value, onChange, { plain = false, sm = false, bg = null, fallback = DEFAULT_MAIN, label } = {}) {
  const wrap = h('div');
  let hex = validHex(value) ? value.toUpperCase() : fallback;
  let ok = true;
  const picker = h('input', { type: 'color', 'aria-label': (label ? label + ' ' : '') + '색 고르기' }); picker.value = hex.toLowerCase();
  const sw = h('label', { class: 'cswatch' + (sm ? ' sm' : ''), title: '색 고르기' }, picker);
  const txt = h('input', { class: 'left', maxlength: '7', 'aria-label': (label ? label + ' ' : '') + 'HEX 값' });
  txt.value = hex.slice(1);
  const pre = h('div', { class: 'pre' + (sm ? '' : ' h32'), style: `flex:none;width:${sm ? 120 : 140}px` }, h('span', null, '#'), txt);
  const prev = plain ? null : h('div', { class: 'cprev' });
  const msg = h('div');
  const paint = () => {
    sw.style.background = hex;
    pre.classList.toggle('err', !ok);
    if (plain) { msg.replaceChildren(!ok ? help('#과 6자리 16진수로 입력하세요', 'error') : ''); return; }
    const t = derive(hex);
    prev.replaceChildren(
      h('span', { class: 'meta' }, '버튼'),
      h('span', { class: 'btn', style: `background:${t.solid};color:${t.on};border-color:${t.bdLight}` }, 'AR 시작하기'),
      h('span', { class: 'meta' }, '글자'),
      h('span', { class: 'txt', style: `color:${t.text}` }, '링크 글자'));
    const notes = [];
    if (t.adjusted) notes.push(`글자가 잘 보이도록 버튼 바탕을 ${t.solid}으로 씁니다`);
    if (bg) { const hb = deriveHome(bg(), hex); if (hb.swap) notes.push(`배경과 버튼 색이 비슷해 홈 버튼은 ${hb.solid === '#000000' ? '검정' : '흰색'}으로 보입니다`); }
    msg.replaceChildren(!ok ? help('#과 6자리 16진수로 입력하세요', 'error') : notes.length ? help(notes.join(' · ')) : '');
  };
  txt.addEventListener('input', () => {
    const v = '#' + txt.value.replace(/^#/, '').trim();
    ok = validHex(v);
    if (ok) { hex = v.toUpperCase(); picker.value = hex.toLowerCase(); paint(); onChange(hex); } else paint();
  });
  picker.addEventListener('input', () => { hex = picker.value.toUpperCase(); txt.value = hex.slice(1); ok = true; paint(); onChange(hex); });
  wrap.append(...[h('div', { class: 'colorrow' }, sw, pre), prev, msg].filter(Boolean));
  wrap.repaint = () => { if (wrap.isConnected) paint(); };
  wrap.setValue = (v) => { if (validHex(v)) { hex = v.toUpperCase(); txt.value = hex.slice(1); picker.value = hex.toLowerCase(); ok = true; paint(); } };
  paint();
  return wrap;
}

/* ───────── A2 포스터 목록 ───────── */
let addPanel = null;
function viewPosters(ph, host) {
  const list = A.cfg.posters;
  pageHeader(ph, '포스터', { right: list.length ? btn('포스터 추가', () => openAddPanel(), { kind: 'primary', ic: 'plus' }) : null });
  if (!list.length) {
    host.append(h('div', { class: 'empty' }, h('p', { class: 'w5' }, '아직 포스터가 없습니다'),
      h('p', { class: 'd' }, '포스터를 추가하면 인식 파일에 들어갑니다.'),
      h('div', { class: 'a' }, btn('포스터 추가', () => openAddPanel(), { kind: 'primary', ic: 'plus' }))));
    return;
  }
  if (list.length > POSTER_WARN) host.append(h('div', { style: 'margin-bottom:12px' }, help('포스터가 20장을 넘으면 인식 속도가 느려질 수 있습니다', 'warn')));
  let dragFrom = -1;
  const rows = list.map((p, i) => {
    const glbBad = !!(p.model && A.meta.files[p.model] && A.meta.files[p.model].failed);
    const hasGlb = !!p.model && !glbBad;
    const tr = h('tr', { draggable: 'true', onclick: () => go('poster', { pid: p.id, tab: 'basic' }) },
      h('td', { class: 'grip', onclick: (e) => e.stopPropagation() }, h('span', { class: 'drag', title: '끌어서 순서 바꾸기' }, icon('grip', 'i i14'))),
      h('td', { class: 'r num' }, i + 1),
      h('td', null, p.image ? h('img', { class: 'pthumb', alt: '', src: urlOf(p.image) }) : h('span', { class: 'pthumb' })),
      h('td', { class: 'name' }, h('div', { class: 'ell', title: p.name }, p.name)),
      h('td', null, tag(MISSION_LABEL[(p.mission && p.mission.type) || 'none'] || '미션 없음')),
      h('td', null, isBuiltin(p.model) ? statusEl('success', '기본 모델') : glbBad ? statusEl('danger', 'GLB 오류') : hasGlb ? statusEl('success', 'GLB 있음') : statusEl('neutral', '임시 모델')),
      h('td', { class: 'acts', onclick: (e) => e.stopPropagation() }, h('div', null,
        iconBtn('chevU', () => movePoster(i, i - 1), '위로', { dis: i === 0 }),
        iconBtn('chevD', () => movePoster(i, i + 1), '아래로', { dis: i === list.length - 1 }),
        iconBtn('more', (e) => menu([{ label: '수정', onClick: () => go('poster', { pid: p.id, tab: 'basic' }) },
          { label: '삭제', danger: true, onClick: () => deletePoster(p.id) }], e.currentTarget), '더보기'))));
    tr.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    tr.addEventListener('dragover', (e) => { e.preventDefault(); tr.classList.add('dragover'); });
    tr.addEventListener('dragleave', () => tr.classList.remove('dragover'));
    tr.addEventListener('drop', (e) => { e.preventDefault(); tr.classList.remove('dragover'); if (dragFrom >= 0 && dragFrom !== i) movePoster(dragFrom, i); dragFrom = -1; });
    return tr;
  });
  const col = (w) => h('col', { style: w ? `width:${w}px` : '' });
  host.append(h('div', { class: 'twrap' }, h('table', { class: 't' },
    h('colgroup', null, col(32), col(48), col(64), col(), col(136), col(112), col(104)),
    h('thead', null, h('tr', null, h('th', { class: 'grip' }), h('th', { class: 'r' }, '순서'), h('th', null, '포스터'), h('th', null, '이름'), h('th', null, '미션'), h('th', null, '3D'), h('th'))),
    h('tbody', null, rows))));
}
function movePoster(from, to) {
  const l = A.cfg.posters;
  if (to < 0 || to >= l.length) return;
  const [p] = l.splice(from, 1);
  l.splice(to, 0, p);
  markMind();
  changed();
  render();
}
function deletePoster(id) {
  askConfirm({
    title: '포스터를 삭제할까요?', msg: '이 포스터와 연결된 3D·미션·사은품 설정이 함께 삭제됩니다.', ok: '삭제', tone: 'danger',
    onOk: async () => {
      const p = A.cfg.posters.find((x) => x.id === id);
      if (!p) return;
      A.cfg.posters = A.cfg.posters.filter((x) => x.id !== id);
      const paths = [p.image, p.model, p.gift && p.gift.image, p.mission && p.mission.icon];
      const dr = A.meta.drafts[id] || {};
      Object.values(dr).forEach((m) => paths.push(m && m.icon));
      for (const x of new Set(paths.filter(Boolean))) { await dropFile(x); await Orig.del(stripExt(x)); }
      delete A.meta.drafts[id];
      A.meta.needMind = A.cfg.posters.length > 0;
      changed();
      toast('포스터를 삭제했습니다');
      go('posters');
    }
  });
}
function openAddPanel() {
  closeAddPanel();
  const st = { name: '', file: null, err: '' };
  const scrim = h('div', { class: 'scrim', onclick: () => { if (!st.name && !st.file) closeAddPanel(); } });
  const body = h('div', { class: 'pb' });
  const addBtn = btn('추가', () => doAdd(), { kind: 'primary', dis: true });
  const panel = h('aside', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '포스터 추가' },
    h('div', { class: 'ph' }, h('h2', { class: 'f-lg' }, '포스터 추가'), iconBtn('x', () => closeAddPanel(), '닫기')),
    body, h('div', { class: 'pf' }, btn('취소', () => closeAddPanel()), addBtn));
  const fileWrap = h('div');
  const drawFile = () => {
    fileWrap.replaceChildren();
    if (st.file) {
      const u = URL.createObjectURL(st.file);
      fileWrap.append(h('div', { class: 'file' }, h('span', { class: 'ft' }, h('img', { alt: '', src: u })),
        h('div', { class: 'nm' }, h('div', { class: 'n ell', title: st.file.name }, st.file.name), h('div', { class: 'sz' }, sizeTxt(st.file.size))),
        btn('바꾸기', () => pick.click(), { kind: 'ghost', size: 'sm' })));
    } else {
      const d = h('div', { class: 'drop' + (st.err ? ' err' : ''), role: 'button', tabindex: '0', onclick: () => pick.click() }, '파일을 끌어 놓거나 ', h('span', { class: 'link' }, '선택'), h('span', { class: 'fmt' }, 'JPG·PNG·WebP'));
      d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer.files[0]); });
      fileWrap.append(d);
    }
    if (st.err) fileWrap.append(help(st.err, 'error'));
    addBtn.disabled = !(st.name.trim() && st.file);
  };
  const pick = h('input', { type: 'file', accept: IMG_ACCEPT, hidden: true });
  const take = (f) => {
    if (!f) return;
    if (!isImg(f)) { st.err = 'JPG·PNG·WebP 파일만 올릴 수 있습니다'; st.file = null; }
    else if (f.size > FILE_MAX) { st.err = '50MB를 넘는 파일은 저장소에 올릴 수 없습니다'; st.file = null; }
    else { st.err = ''; st.file = f; }
    drawFile();
  };
  pick.addEventListener('change', () => { take(pick.files[0]); pick.value = ''; });
  const nameIn = input('', (v) => { st.name = v; addBtn.disabled = !(st.name.trim() && st.file); }, { max: 40, ph: '예: 포스터 01' });
  body.append(field('이름', nameIn, { helpEl: help(NAME_HELP) }), field('포스터 이미지', fileWrap), pick);
  drawFile();
  const doAdd = async () => {
    const id = 'p' + rid(6);
    const path = `assets/posters/poster-${id}.${extOf(st.file)}`;
    await putFile(path, st.file, { name: st.file.name });
    A.cfg.posters.push({
      id, name: st.name.trim(), image: path, model: null, placement: 'front', scale: 0.6, position: [...PLACEMENT_DEFAULT.front], rotation: [0, 0, 0],
      animation: false, spin: false, mission: MISSION_DEFAULT.tap(), gift: { enabled: true, image: '', title: '', description: '', claimNote: '' },
      effect: 'burst', successNote: '' // 새 포스터 기본: 연출 터짐 · 사은품 있음(명세 C3·C6)
    });
    A.meta.needMind = true;
    closeAddPanel();
    changed();
    toast('포스터를 추가했습니다');
    render();
  };
  addPanel = h('div', null, scrim, panel);
  document.body.append(addPanel);
  nameIn.focus();
}
function closeAddPanel() { if (addPanel) { addPanel.remove(); addPanel = null; } }

/* ───────── A3 포스터 편집 ───────── */
function curPoster() { return A.cfg.posters.find((p) => p.id === A.pid); }
function viewPoster(ph, form) {
  const p = curPoster();
  if (!p) { A.view = 'posters'; render(); return; }
  const idx = A.cfg.posters.indexOf(p) + 1;
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['basic', '기본 정보'], ['place', '3D 배치'], ['mission', '미션'], ['gift', '사은품']].map(([v, l]) =>
    h('button', { class: A.tab === v ? 'on' : '', role: 'tab', 'aria-selected': String(A.tab === v), type: 'button', onclick: () => { A.tab = v; A.pvUser = null; render(); } }, l)));
  pageHeader(ph, p.name || '이름 없는 포스터', {
    back: { label: '포스터', onClick: () => go('posters') }, tabs, tagEl: tag(idx + '번'),
    right: iconBtn('more', (e) => menu([{ label: '삭제', danger: true, onClick: () => deletePoster(p.id) }], e.currentTarget), '더보기')
  });
  if (A.tab === 'basic') tabBasic(p, form);
  else if (A.tab === 'place') tabPlace(p, form);
  else if (A.tab === 'mission') tabMission(p, form);
  else tabGift(p, form);
}
function tabBasic(p, form) {
  const nameIn = input(p.name, (v) => { p.name = v; changed(); const t = document.querySelector('.phead h1'); if (t) { t.textContent = v || '이름 없는 포스터'; t.title = v; } }, { max: 40 });
  const glbMeta = p.model ? A.meta.files[p.model] : null;
  form.append(section('기본 정보', {},
    field('이름', nameIn, { helpEl: help(NAME_HELP) }),
    field('포스터 이미지', h('div', null, fileField({
      path: p.image, kind: 'image', required: true, error: A.err.posterImage === p.id ? '포스터 이미지를 올려 주세요' : '',
      onFile: async (file) => { const np = `assets/posters/poster-${p.id}.${extOf(file)}`; if (p.image && p.image !== np) await dropFile(p.image); await putFile(np, file, { name: file.name }); p.image = np; A.err.posterImage = null; A.meta.needMind = true; changed(); render(); }
    }), help('바꾸면 인식 파일을 다시 만듭니다.'))),
    field('3D 모델', h('div', null,
      // 기본 모델 칩 5개(12-F-12, clearable): 칩과 파일은 둘 중 하나. 고르면 애니메이션 켬(명세 C7)
      thumbChip({ label: '기본 모델', value: isBuiltin(p.model) ? p.model : null, clearable: true,
        items: BUILTIN_MODELS.map(([id, name]) => ({ value: builtinModelPath(id), label: name, thumb: () => modelThumb(builtinModelPath(id)) })),
        onChange: async (v) => {
          if (p.model && !isBuiltin(p.model)) await dropFile(p.model); // 올렸던 파일은 쓰지 않으므로 다음 발행 때 정리된다
          p.model = v || null;
          p.animation = !!v;
          changed(); render();
        } }),
      h('div', { style: 'height:var(--s2)' }),
      fileField({
      path: isBuiltin(p.model) ? null : p.model, kind: 'glb',
      onFile: async (file, res = {}) => {
        const np = `assets/models/model-${p.id}.glb`;
        const u = URL.createObjectURL(file);
        const m = await loadModel(u);
        URL.revokeObjectURL(u);
        await putFile(np, file, { name: res.name || file.name, from: res.converted ? res.from : null, missing: res.missing,
          anims: m.failed ? 0 : m.clips.length, failed: m.failed, packed: res.packed });
        p.model = np;
        if (!m.clips.length) p.animation = false;
        changed(); render();
      },
      onClear: async () => { await dropFile(p.model); p.model = null; p.animation = false; changed(); render(); },
      error: glbMeta && glbMeta.failed ? 'GLB를 읽지 못했습니다 · 임시 모델로 보입니다' : ''
    }), p.model ? null : help('기본 모델을 고르거나 직접 올려 주세요 · 고르기 전까지 임시 모델로 보입니다'),
    help('GLB(5MB 안팎) 권장. 다른 형식은 GLB로 바꿔 저장하고 텍스처는 함께 선택하거나 zip으로 올려 주세요.')))));
}

/* 3D 미리보기 패널 (12-F-4) */
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

/* 기본 모델 칩 썸네일(D3-7): GLB 를 처음 한 번 48px 로 렌더(바탕 n100, 정면에서 오른쪽 20°·위 15°, 클립 0초 자세, 3D 미리보기와 같은 조명).
   별도 썸네일 파일은 만들지 않는다. 실패하면 빈 원. */
const thumbCache = new Map();
function modelThumb(path) {
  if (thumbCache.has(path)) return thumbCache.get(path);
  const job = loadModel(urlOf(path)).then((m) => {
    if (m.failed) throw new Error('model');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(cssVar('--n100'));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.5, 1, 1); scene.add(sun);
    const obj = m.wrap.clone(true);
    scene.add(obj);
    if (m.clips && m.clips.length) { const mx = new THREE.AnimationMixer(obj); m.clips.forEach((c) => mx.clipAction(c).play()); mx.update(0); }
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3());
    const rad = box.getBoundingSphere(new THREE.Sphere()).radius || 0.5;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const d = rad / Math.sin(deg(15)) * 1.02;
    cam.position.set(c.x + d * Math.cos(deg(15)) * Math.sin(deg(20)), c.y + d * Math.sin(deg(15)), c.z + d * Math.cos(deg(15)) * Math.cos(deg(20)));
    cam.lookAt(c);
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    try {
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.setPixelRatio(1); r.setSize(48, 48, false);
      r.render(scene, cam);
      return r.domElement.toDataURL('image/png');
    } finally { r.dispose(); r.forceContextLoss(); }
  });
  job.catch(() => thumbCache.delete(path));
  thumbCache.set(path, job);
  return job;
}
function makeViewport() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cssVar('--n50'));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.5, 1, 1); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 592 / 320, 0.01, 100);
  let renderer = null;
  const sceneEl = h('div', { class: 'vp-scene' });
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    sceneEl.append(renderer.domElement);
  } catch (_) { sceneEl.append(h('div', { class: 'loading' }, '이 브라우저에서는 3D 미리보기를 쓸 수 없습니다')); }
  const grid = new THREE.GridHelper(4, 16, new THREE.Color(cssVar('--n200')), new THREE.Color(cssVar('--n200')));
  grid.position.set(0, -1.5, 1);
  scene.add(grid);
  const posterG = new THREE.Group(); scene.add(posterG);
  const holder = new THREE.Group(); scene.add(holder);
  const scaleG = new THREE.Group(); holder.add(scaleG);
  const outline = new THREE.BoxHelper(undefined, new THREE.Color(cssVar('--accent')));
  scene.add(outline);
  const loadingEl = h('div', { class: 'loading' }, h('span', { class: 'spin14' }), '모델을 불러오는 중…');
  const bot = h('div', { class: 'vp-bot' });
  let viewName = 'front';
  const segHost = h('span');
  const controls = renderer ? new OrbitControls(camera, renderer.domElement) : null;
  const draw = () => { if (!renderer) return; outline.setFromObject(scaleG); renderer.render(scene, camera); };
  if (controls) { controls.target.set(0, -0.3, 0.3); controls.addEventListener('change', draw); }
  const views = { front: [0, -0.2, 4.4], side: [4.4, -0.2, 0.4], top: [0, 4.4, 0.6] };
  const setView = (v) => {
    viewName = v;
    camera.position.set(...views[v]);
    if (controls) { controls.target.set(0, -0.3, 0.3); controls.update(); } else camera.lookAt(0, -0.3, 0.3);
    segHost.replaceChildren(seg([['front', '정면'], ['side', '옆'], ['top', '위']], v, setView, { label: '시점' }));
    draw();
  };
  const el = h('div', { class: 'vp' },
    h('div', { class: 'vp-top' }, segHost, iconBtn('fit', () => setView(viewName), '전체 보기', { size: 's24' })), sceneEl, bot);
  let posterUrl = null, modelKey;
  const vp = {
    el,
    async set(p) {
      if (renderer) {
        const w = sceneEl.clientWidth || 592;
        renderer.setSize(w, 320, false);
        renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '320px';
        camera.aspect = w / 320; camera.updateProjectionMatrix();
      }
      const pu = urlOf(p.image);
      if (pu !== posterUrl) {
        posterUrl = pu;
        posterG.clear();
        if (pu) new THREE.TextureLoader().load(pu, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const ar = tex.image ? tex.image.height / tex.image.width : 1.4;
          posterG.add(new THREE.Mesh(new THREE.PlaneGeometry(1, ar), new THREE.MeshBasicMaterial({ map: tex })));
          draw();
        });
      }
      const pos = p.position || PLACEMENT_DEFAULT[p.placement] || PLACEMENT_DEFAULT.front;
      holder.position.set(pos[0], pos[1], pos[2]);
      const r = (p.rotation || [0, 0, 0]).map(deg);
      holder.rotation.set(r[0], r[1], r[2]);
      scaleG.scale.setScalar(p.scale ?? 0.6);
      const key = p.model ? urlOf(p.model) : null;
      const meta = p.model ? A.meta.files[p.model] : null;
      bot.className = 'vp-bot';
      bot.textContent = !p.model ? '기본 모델을 고르거나 GLB를 올리기 전까지 임시 모델로 보입니다' : '끌기: 돌려 보기 · 휠: 확대 · 오른쪽 끌기: 이동';
      if (key !== modelKey) {
        modelKey = key;
        scaleG.clear();
        sceneEl.append(loadingEl);
        const m = await loadModel(key);
        loadingEl.remove();
        if (modelKey !== key) return;
        scaleG.add(m.wrap);
        if (m.failed || (meta && meta.failed)) { bot.className = 'vp-bot err'; bot.textContent = 'GLB를 읽지 못했습니다 · 임시 모델로 보입니다'; }
      } else if (meta && meta.failed) { bot.className = 'vp-bot err'; bot.textContent = 'GLB를 읽지 못했습니다 · 임시 모델로 보입니다'; }
      draw();
    }
  };
  setView('front');
  return vp;
}

function tabPlace(p, form) {
  if (!A.vp) A.vp = makeViewport();
  const reset = () => {
    p.scale = 0.6; p.position = [...(PLACEMENT_DEFAULT[p.placement] || PLACEMENT_DEFAULT.front)]; p.rotation = [0, 0, 0];
    changed(); render();
  };
  const update = () => { A.vp.set(p); changed(); };
  // 크기
  const sMin = 0.1, sMax = 3;
  const sc = p.scale ?? 0.6;
  const range = h('input', { type: 'range', min: sMin, max: sMax, step: 0.05, 'aria-label': '크기' }); range.value = sc;
  const fill = h('i'), knob = h('b');
  const scaleNum = input(sc.toFixed(2), () => {}, { cls: 'sm numr' });
  const scaleErr = h('div');
  const paintScale = (v) => { const pct = (v - sMin) / (sMax - sMin) * 100; fill.style.width = pct + '%'; knob.style.left = pct + '%'; };
  paintScale(sc);
  range.addEventListener('input', () => { const v = Number(range.value); p.scale = v; scaleNum.value = v.toFixed(2); scaleNum.classList.remove('err'); scaleErr.replaceChildren(); paintScale(v); update(); });
  scaleNum.addEventListener('input', () => {
    const v = Number(scaleNum.value);
    if (!Number.isFinite(v) || v < sMin || v > sMax) { scaleNum.classList.add('err'); scaleErr.replaceChildren(help(`${sMin}~${sMax} 사이로 입력하세요`, 'error')); return; }
    scaleNum.classList.remove('err'); scaleErr.replaceChildren(); p.scale = v; range.value = v; paintScale(v); update();
  });
  const xyz = (key, min, max, step, digits) => {
    const errBox = h('div');
    const row = h('div', { class: 'xyz' }, ['X', 'Y', 'Z'].map((ax, i) => {
      const inEl = h('input', { inputmode: 'decimal', 'aria-label': `${key === 'position' ? '위치' : '회전'} ${ax}` });
      inEl.value = Number((p[key] || [0, 0, 0])[i]).toFixed(digits);
      const box = h('div', { class: 'pre' }, h('span', null, ax), inEl);
      inEl.addEventListener('input', () => {
        const v = Number(inEl.value);
        if (inEl.value.trim() === '' || !Number.isFinite(v) || v < min || v > max) { box.classList.add('err'); errBox.replaceChildren(help(`${min}~${max} 사이로 입력하세요`, 'error')); return; }
        box.classList.remove('err'); errBox.replaceChildren();
        p[key] = [...(p[key] || [0, 0, 0])]; p[key][i] = v; update();
      });
      return box;
    }));
    return h('div', null, row, errBox);
  };
  const glbMeta = p.model ? A.meta.files[p.model] : null;
  const anims = isBuiltin(p.model) ? 1 : glbMeta && !glbMeta.failed ? (glbMeta.anims || 0) : 0; // 기본 모델 = 클립 1개
  const rotateMission = p.mission && p.mission.type === 'rotate';
  form.append(section('3D 배치', { right: btn('기본값으로', reset, { size: 'sm' }) },
    A.vp.el,
    field('위치 유형', seg([['front', '포스터 앞'], ['floor', '바닥 쪽']], p.placement || 'front', (v) => {
      if (v === p.placement) return; p.placement = v; p.position = [...PLACEMENT_DEFAULT[v]]; changed(); render();
    }, { label: '위치 유형' })),
    field('크기', h('div', null, h('div', { class: 'slider' }, h('div', { class: 'track' }, fill, knob, range), scaleNum, h('span', { class: 'help', style: 'margin:0' }, '배')), scaleErr)),
    field('위치', xyz('position', -5, 5, 0.05, 2), { hint: '· 포스터 가로폭 = 1' }),
    field('회전', xyz('rotation', -180, 180, 1, 0), { hint: '· °' }),
    h('div', { class: 'trow', style: 'margin-top:16px' },
      h('div', null, h('div', { class: 'w5' }, '애니메이션 재생'),
        h('div', { class: 'h' }, !p.model ? 'GLB를 올리면 쓸 수 있습니다' : isBuiltin(p.model) ? '기본 모델의 움직임을 반복 재생합니다' : anims ? `GLB의 애니메이션 ${anims}개를 반복 재생합니다` : '이 GLB에는 애니메이션이 없습니다')),
      toggle(!!p.animation && anims > 0, () => { p.animation = !p.animation; changed(); render(); }, !anims)),
    h('div', { class: 'trow' },
      h('div', null, h('div', { class: 'w5' }, '천천히 돌리기'), rotateMission ? help('돌려 보기 미션에서는 꺼집니다', 'lock') : null),
      toggle(!!p.spin && !rotateMission, () => { p.spin = !p.spin; changed(); render(); }, rotateMission))));
  requestAnimationFrame(() => A.vp.set(p));
  A.vp.set(p);
}

function tabMission(p, form) {
  form.append(section('미션', {}, missionForm(p)));
}
function missionForm(p) {
  const m = p.mission || (p.mission = MISSION_DEFAULT.tap());
  const wrap = h('div');
  /* 안내 문구 칸(퀴즈·없음 제외): 비우면 placeholder 의 기본 문구를 쓴다. 조건값이 바뀌면 placeholder 도 바로 바뀐다. */
  const hasGuide = ['tap', 'drag', 'hold', 'rotate', 'find'].includes(m.type);
  if (hasGuide && typeof m.guide !== 'string') m.guide = '';
  const guideCnt = h('span', { class: 'cnt-r' }, `${(m.guide || '').length} / ${GUIDE_MAX}`);
  const guideIn = hasGuide ? input(m.guide, (v) => { m.guide = v; guideCnt.textContent = `${v.length} / ${GUIDE_MAX}`; changed(); }, { max: GUIDE_MAX, ph: defaultGuide(m) }) : null;
  const refreshPh = () => { if (guideIn) guideIn.placeholder = defaultGuide(m); };
  const sel = h('select', { class: 'inp', style: 'width:240px', 'aria-label': '미션 종류' },
    Object.entries(MISSION_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  sel.value = m.type;
  sel.addEventListener('change', () => {
    const d = A.meta.drafts[p.id] || (A.meta.drafts[p.id] = {});
    d[m.type] = clone(m);
    p.mission = d[sel.value] ? clone(d[sel.value]) : MISSION_DEFAULT[sel.value]();
    if (sel.value === 'rotate') p.spin = false;
    changed(); render();
  });
  wrap.append(field('종류', sel));
  const box = h('div', { style: 'margin-top:16px' });
  const numField = (label, key, unit, { min, max, step, def }) => {
    const errBox = h('div');
    const el = input(m[key] ?? def, (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max || Math.round(n / step) * step !== n) { el.classList.add('err'); errBox.replaceChildren(help(`${min}~${max} 사이로 입력하세요${step < 1 ? ' (0.5 단위)' : ''}`, 'error')); return; }
      el.classList.remove('err'); errBox.replaceChildren(); m[key] = n; refreshPh(); changed(); renderSideSoon();
    }, { cls: 'numr', type: 'text' });
    el.style.width = '120px';
    return field(label, h('div', null, h('div', { class: 'unitrow' }, el, h('span', { class: 'help', style: 'margin:0' }, unit)), errBox));
  };
  const iconField = (label) => field(label, specField({
    specKey: 'icon', path: m.icon, base: `assets/gifts/icon-${p.id}-${m.type}`,
    onSaved: (np) => { m.icon = np; changed(); render(); },
    onClear: async () => { await dropFile(m.icon); await Orig.del(stripExt(m.icon)); m.icon = ''; changed(); render(); }
  }));
  switch (m.type) {
    case 'tap': box.append(numField('횟수', 'count', '회', { min: 1, max: 50, step: 1, def: 5 })); break;
    case 'hold': box.append(numField('누르는 시간', 'seconds', '초', { min: 0.5, max: 10, step: 0.5, def: 2 })); break;
    case 'find': box.append(numField('개수', 'count', '개', { min: 1, max: 10, step: 1, def: 3 }), iconField('아이템 아이콘')); break;
    case 'rotate':
      box.append(field('숨은 표시 방향', seg(MARKERS, m.marker || 'back', (v) => { m.marker = v; changed(); render(); }, { label: '숨은 표시 방향' })), iconField('표시 아이콘'));
      break;
    case 'drag': {
      m.target = m.target || { x: DRAG_SAFE.defX, y: DRAG_SAFE.defY };
      if (!(Number(m.target.y) <= DRAG_SAFE.yMax)) m.target = { ...m.target, y: clampDragY(Number(m.target.y) || DRAG_SAFE.defY) };
      const dot = h('i');
      const cardArea = h('div', { class: 'pcard', style: `top:${DRAG_SAFE.cardTop}%`, title: '설명·미션 카드가 덮는 영역' });
      const pbox = h('div', { class: 'pbox', title: '누른 곳이 목표 위치가 됩니다' }, cardArea, dot);
      const xin = h('input', { inputmode: 'numeric', 'aria-label': '목표 X %' }), yin = h('input', { inputmode: 'numeric', 'aria-label': '목표 Y %' });
      const paint = () => { dot.style.left = m.target.x + '%'; dot.style.top = m.target.y + '%'; xin.value = m.target.x; yin.value = m.target.y; };
      pbox.addEventListener('click', (e) => {
        const r = pbox.getBoundingClientRect();
        const y = Math.round(Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100)));
        if (y > DRAG_SAFE.yMax) return; // 카드가 덮는 영역에는 놓을 수 없다
        m.target = { x: Math.round(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100))), y };
        paint(); changed();
      });
      const onNum = (k, el, boxEl) => el.addEventListener('input', () => {
        const n = Number(el.value);
        const max = k === 'y' ? DRAG_SAFE.yMax : 100;
        if (el.value.trim() === '' || !Number.isFinite(n) || n < 0 || n > max) { boxEl.classList.add('err'); return; }
        boxEl.classList.remove('err'); m.target = { ...m.target, [k]: Math.round(n) }; dot.style.left = m.target.x + '%'; dot.style.top = m.target.y + '%'; changed();
      });
      const xb = h('div', { class: 'pre' }, h('span', null, 'X'), xin, h('span', { style: 'border-right:0;border-left:1px solid var(--n200)' }, '%'));
      const yb = h('div', { class: 'pre' }, h('span', null, 'Y'), yin, h('span', { style: 'border-right:0;border-left:1px solid var(--n200)' }, '%'));
      onNum('x', xin, xb); onNum('y', yin, yb);
      paint();
      box.append(iconField('목표 아이콘'),
        field('목표 위치', h('div', null, h('div', { class: 'picker' }, pbox, h('div', { class: 'pickin' }, xb, yb)), help(`상자에서 누른 곳이 관람객 화면의 목표 위치가 됩니다. 회색 영역은 설명·미션 카드가 덮는 곳이라 놓을 수 없습니다(Y 0~${DRAG_SAFE.yMax}%).`))));
      break;
    }
    case 'quiz': {
      m.options = Array.isArray(m.options) && m.options.length >= 2 ? m.options : ['', ''];
      box.append(field('형식', seg([['ox', 'OX'], ['choice', '객관식']], m.mode || 'choice', (v) => { m.mode = v; m.answer = 0; changed(); render(); }, { label: '퀴즈 형식' })));
      box.append(field('질문', textarea(m.question, (v) => { m.question = v; changed(); }, { max: 120, rows: 2 })));
      if (m.mode === 'ox') {
        box.append(field('정답', seg([[0, 'O'], [1, 'X']], Number(m.answer) === 1 ? 1 : 0, (v) => { m.answer = v; changed(); render(); }, { label: '정답' })));
      } else {
        const rows = m.options.map((o, i) => h('tr', null,
          h('td', null, h('button', { class: 'rd' + (Number(m.answer) === i ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(Number(m.answer) === i), 'aria-label': `${i + 1}번을 정답으로`, onclick: () => { m.answer = i; changed(); render(); } })),
          h('td', null, input(o, (v) => { m.options[i] = v; changed(); }, { cls: 'sm', max: 40, ph: `보기 ${i + 1}` })),
          h('td', { class: 'r' }, iconBtn('trash', () => { m.options.splice(i, 1); if (Number(m.answer) >= m.options.length) m.answer = 0; else if (Number(m.answer) > i) m.answer = Number(m.answer) - 1; changed(); render(); }, '보기 삭제', { size: 's24', dis: m.options.length <= 2 }))));
        const col = (w) => h('col', { style: w ? `width:${w}px` : '' });
        box.append(field('보기', h('div', null,
          h('div', { class: 'twrap' }, h('table', { class: 't etable' }, h('colgroup', null, col(56), col(), col(56)),
            h('thead', null, h('tr', null, h('th', null, '정답'), h('th', null, '보기'), h('th'))), h('tbody', null, rows))),
          m.options.length < 4 ? h('div', { style: 'margin-top:8px' }, btn('보기 추가', () => { m.options.push(''); changed(); render(); }, { kind: 'ghost', size: 'sm', ic: 'plus' })) : null)));
      }
      break;
    }
    default: box.append(help('관람객 화면에는 카드 없이 3D만 보입니다. 스탬프 투어 집계에서 빠집니다.'));
  }
  // 움직임 속도(12-F-7 v2.5): 드래그 = 목표, 터치·길게 누르기 = 3D
  if (['tap', 'hold', 'drag'].includes(m.type)) {
    const sp = [0, 1, 2, 3].includes(Number(m.speed)) ? Number(m.speed) : 0;
    const isDrag = m.type === 'drag';
    const hint = isDrag ? (sp ? '목표 위치에서 출발해 회색 영역 위(Y 0~48%)를 움직입니다.' : '목표 위치에 고정됩니다.')
      : (sp ? '인식 직후 포스터 위에 나타난 뒤 카드 위 영역을 떠다닙니다.' : '3D 배치 위치에 고정됩니다.');
    box.append(field(isDrag ? '목표 움직임 속도' : '3D 움직임 속도', h('div', null,
      seg([[0, '고정'], [1, '느림'], [2, '보통'], [3, '빠름']], sp, (v) => { m.speed = v; changed(); render(); }, { label: isDrag ? '목표 움직임 속도' : '3D 움직임 속도' }),
      help(hint))));
  }
  if (guideIn) box.append(field('안내 문구', guideIn, { count: guideCnt, helpEl: help('비우면 기본 문구를 씁니다. 횟수를 바꾸면 직접 쓴 문구도 함께 고쳐 주세요.') }));
  // 성공 연출(미션 없음 제외, 맨 아래): seg 3칸 + 「미리보기로 보기」
  if (m.type !== 'none') {
    const fx = EFFECTS.some(([k]) => k === p.effect) ? p.effect : 'burst';
    box.append(field('성공 연출', h('div', { class: 'inline' },
      seg(EFFECTS, fx, (v) => { p.effect = v; changed(); render(); }, { label: '성공 연출' }),
      btn('미리보기로 보기', () => playPreviewFx(), { kind: 'ghost', size: 'sm' }))));
  }
  wrap.append(box);
  return wrap;
}
let sideT = 0;
function renderSideSoon() { clearTimeout(sideT); sideT = setTimeout(renderSide, 200); }

function giftFields(g, base, onDone) {
  return [
    field('이미지', h('div', null, specField({
      specKey: 'gift', path: g.image, base: `assets/gifts/${base}`,
      onSaved: (np) => { g.image = np; changed(); onDone(); },
      onClear: async () => { await dropFile(g.image); await Orig.del(stripExt(g.image)); g.image = ''; changed(); onDone(); }
    }), g.image ? null : help('비우면 기본 선물 상자 그림이 보입니다'))),
    field('제목', input(g.title, (v) => { g.title = v; changed(); }, { max: 40, ph: '예: 스티커 1장' })),
    // v3.2: 긴 글 칸은 여러 줄 입력(Enter = 줄바꿈). 관람객 화면도 줄바꿈 그대로 보인다.
    field('설명', textarea(g.description, (v) => { g.description = v; changed(); }, { max: 80, rows: 3 })),
    field('수령 안내', textarea(g.claimNote, (v) => { g.claimNote = v; changed(); }, { max: 60, rows: 2, ph: '예: B-12 부스에서 선물 상자를 보여 주세요' }), { helpEl: help('비우면 그 줄이 관람객 화면에 보이지 않습니다.') })
  ];
}
function tabGift(p, form) {
  p.gift = p.gift || { enabled: true, image: '', title: '', description: '', claimNote: '' };
  if (typeof p.gift.enabled !== 'boolean') p.gift.enabled = true;
  if (typeof p.successNote !== 'string') p.successNote = '';
  const g = p.gift;
  // 「사은품 주기」(12-F-7 v2.5): 끄면 성공 안내 문구 한 칸만. 끈 동안 사은품 칸 값은 그대로 보관한다.
  const top = settingRow('사은품 주기', null, toggle(g.enabled, () => { g.enabled = !g.enabled; changed(); render(); }), { end: true });
  let rest;
  if (g.enabled) rest = giftFields(g, 'gift-' + p.id, () => render());
  else {
    const cnt = h('span', { class: 'cnt-r' }, `${p.successNote.length} / ${SUCCESS_NOTE_MAX}`);
    rest = [field('성공 안내 문구', textarea(p.successNote, (v) => { p.successNote = v; cnt.textContent = `${v.length} / ${SUCCESS_NOTE_MAX}`; changed(); }, { max: SUCCESS_NOTE_MAX, rows: 3 }),
      { count: cnt, helpEl: help('미션을 성공하면 「미션 성공」과 이 문구만 보입니다. 스탬프 투어 완료 개수에는 들어갑니다.') })];
  }
  form.append(section('사은품 시트', {}, top, rest));
}

/* ───────── A4 직원 코드·스탬프 투어 ───────── */
function viewStaff(ph, host) {
  pageHeader(ph, '직원 코드·스탬프 투어');
  const wrap = h('div', { class: 'form880' });
  const set = !!(A.cfg.staff && A.cfg.staff.codeHash);
  let control;
  if (!A.staffEdit) {
    // 12-F-13 현재 코드 행: 원문(이 PC에서 정한 코드) / 없음 / 다른 PC
    const raw = set ? StaffRaw.match(A.cfg) : null;
    const val = !set ? h('span', { class: 'kvv none' }, '없음')
      : raw ? h('span', { class: 'kvv code num' }, raw)
        : h('span', { class: 'kvv none' }, '이 PC에서 정한 코드가 아닙니다');
    control = h('div', null, h('div', { class: 'kvrow' }, h('span', { class: 'kvl' }, '현재 코드'), val,
      btn('새로 정하기', () => { A.staffEdit = true; render(); setTimeout(() => { const i = $('staffNew'); if (i) i.focus(); }, 0); }, { size: 'sm' })),
    set && !raw ? help('새로 정하면 이 PC에서 원문이 보입니다.') : null,
    A.err.staff && !set ? help('직원 코드를 먼저 정해 주세요', 'error') : null);
  } else {
    const errBox = h('div');
    const inp = input('', () => { inp.classList.remove('err'); errBox.replaceChildren(); }, { type: 'password', id: 'staffNew', max: 12, cls: 'sm', ph: '4~12자' });
    inp.style.width = '200px';
    const save = async () => {
      const v = inp.value.trim();
      if (v.length < 4 || v.length > 12) { inp.classList.add('err'); errBox.replaceChildren(help('4~12자로 입력하세요', 'error')); return; }
      A.cfg.staff = { codeHash: await sha256Hex(A.cfg.projectId + ':' + v) };
      StaffRaw.set(A.cfg.projectId, A.cfg.staff.codeHash, v); // 원문은 이 PC 설정 페이지 저장소에만(공개 config 에는 해시만)
      A.staffEdit = false; A.err.staff = false;
      changed(); toast('직원 코드를 저장했습니다'); render();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { A.staffEdit = false; render(); } });
    control = h('div', null, h('div', { class: 'inline' }, inp, btn('저장', save, { kind: 'primary', size: 'sm' }), btn('취소', () => { A.staffEdit = false; render(); }, { kind: 'ghost', size: 'sm' })), errBox);
  }
  wrap.append(section('직원 코드', { box: true, desc: '관람객 선물 상자에서 수령 처리할 때 부스 직원이 입력합니다. 원문은 코드를 정한 PC 브라우저에만 남고 공개 config에는 해시만 저장됩니다.' },
    A.staffEdit ? settingRow('현재 코드', null, control) : control));
  const st = A.cfg.stampTour || (A.cfg.stampTour = { enabled: false, gift: { image: '', title: '', description: '', claimNote: '' } });
  st.gift = st.gift || { image: '', title: '', description: '', claimNote: '' };
  const rows = [settingRow('사용', '미션이 있는 포스터를 모두 완료하면 완주 선물을 줍니다', toggle(!!st.enabled, () => { st.enabled = !st.enabled; changed(); render(); }), { end: true })];
  if (st.enabled) rows.push(settingRow('완주 사은품', '모든 포스터를 완료한 순간 관람객 화면에 뜨는 선물입니다', h('div', null, giftFields(st.gift, 'gift-stamptour', () => render()))));
  wrap.append(section('스탬프 투어', { box: true }, rows));
  host.append(wrap);
}

/* ───────── A5 발행 설정 ───────── */
/* v3.7 잠금 해제: 비밀번호가 맞으면 이번 페이지 동안 열어 두고, 이 PC에 접근 키가 없으면 저장소에 보관된 암호화 키를 풀어 쓴다 */
async function tryUnlock(pw) {
  if (!(await verifyPassword(pw))) return false;
  A.unlocked = true; A.pw = pw;
  if (!A.gh.token) {
    const v = await fetchVault();
    if (v) { try { A.gh = await unseal(pw, v); saveSettings(A.gh); } catch (e) { console.warn('보관된 접근 키를 풀지 못했습니다', e); } }
  } else {
    // v3.8: 이 PC에 접근 키가 있으면 보관된 키를 지금 비밀번호로 다시 맞춰 둔다(비밀번호를 바꿨을 때 자동 갱신, 같으면 아무것도 안 함)
    storeVault().then((r) => { if (r === 'saved') toast('다른 PC용 보관 키를 새 비밀번호로 갱신했습니다'); }).catch((e) => console.warn('보관 키 갱신 실패', e));
  }
  return true;
}
function askPassword({ title = '비밀번호를 입력해 주세요', msg = '발행 설정은 비밀번호를 넣어야 열립니다.' } = {}) {
  return new Promise((resolve) => {
    const wrap = h('div', { class: 'mscrim top' });
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', esc); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') close(false); };
    const err = h('div');
    const pwIn = input('', () => { err.replaceChildren(); }, { type: 'password', ph: '비밀번호' });
    const ok = btn('확인', async () => {
      ok.disabled = true; ok.replaceChildren(h('span', { class: 'spin14' }), '확인 중…');
      const good = await tryUnlock(pwIn.value);
      if (good) { close(true); return; }
      ok.disabled = false; ok.replaceChildren('확인'); err.replaceChildren(help('비밀번호가 맞지 않습니다', 'error')); pwIn.select();
    }, { kind: 'primary' });
    pwIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    wrap.appendChild(h('div', { class: 'confirm', role: 'dialog', 'aria-modal': 'true' },
      h('h2', { class: 'f-lg' }, title), h('p', { class: 'msg' }, msg), pwIn, err,
      h('div', { class: 'bt' }, btn('취소', () => close(false)), ok)));
    document.body.appendChild(wrap);
    document.addEventListener('keydown', esc);
    pwIn.focus();
  });
}
/* 접근 키를 비밀번호로 암호화해 저장소에 보관(이미 같은 값이면 건너뜀) */
// v3.9: 사이트(Pages)는 반영이 1~3분 늦어 방금 보관한 키를 못 보고 또 저장하다 충돌했다 → 저장소에서 바로 읽고, 동시에 두 번 돌지 않게 한다
let vaultJob = null;
function storeVault() {
  if (vaultJob) return vaultJob;
  vaultJob = (async () => {
    if (!A.pw || !A.gh.token || !validRepo(A.gh.repo)) return 'skip';
    const gh = new GitHub(A.gh);
    let cur = null;
    try { const hd = await gh.head(); const tree = await gh.tree(hd.treeSha); if (tree.has(VAULT_PATH)) cur = JSON.parse(new TextDecoder().decode(await gh.blobRaw(tree.get(VAULT_PATH)))); }
    catch (_) { cur = await fetchVault(); }
    if (cur) { try { const s = await unseal(A.pw, cur); if (s.token === A.gh.token && s.repo === A.gh.repo && s.branch === (A.gh.branch || 'main')) return 'same'; } catch (_) {} }
    const v = await seal(A.pw, A.gh);
    await gh.putOne(VAULT_PATH, new Blob([JSON.stringify(v, null, 2) + '\n'], { type: 'application/json' }), 'dameum_AR 발행 키 보관(암호화)');
    return 'saved';
  })().finally(() => { vaultJob = null; });
  return vaultJob;
}

function viewGithub(ph, host) {
  pageHeader(ph, '발행 설정');
  if (!A.unlocked) { // v3.7: 비밀번호 잠금
    const err = h('div');
    const pwIn = input('', () => err.replaceChildren(), { type: 'password', ph: '비밀번호' });
    const go_ = btn('잠금 풀기', async () => {
      go_.disabled = true; go_.replaceChildren(h('span', { class: 'spin14' }), '확인 중…');
      if (await tryUnlock(pwIn.value)) { render(); return; }
      go_.disabled = false; go_.replaceChildren('잠금 풀기'); err.replaceChildren(help('비밀번호가 맞지 않습니다', 'error')); pwIn.select();
    }, { kind: 'primary' });
    pwIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go_.click(); });
    host.append(h('div', { class: 'form880' }, section('잠겨 있습니다', { desc: '발행 설정은 비밀번호를 넣어야 열립니다.' },
      h('div', { class: 'box' }, settingRow('비밀번호', null, h('div', null, h('div', { class: 'inline' }, pwIn, go_), err))))));
    setTimeout(() => pwIn.focus(), 0);
    return;
  }
  const g = A.gh;
  const wrap = h('div', { class: 'form880' });
  const saveGh = () => { saveSettings(A.gh); A.ghResult = null; resBox.replaceChildren(); };
  const resBox = h('div');
  if (A.ghResult) resBox.append(help(A.ghResult.msg, A.ghResult.ok ? 'ok' : 'error'));
  const tok = input(g.token, (v) => { g.token = v.trim(); tok.classList.remove('err'); saveGh(); }, { type: 'password', ph: 'github_pat_…', err: A.err.gh && !g.token });
  const repo = input(g.repo, (v) => { g.repo = v.trim(); repo.classList.toggle('err', !!v && !validRepo(v)); saveGh(); }, { ph: 'owner/repo', err: A.err.gh && !validRepo(g.repo) });
  const br = input(g.branch, (v) => { g.branch = v.trim() || 'main'; saveGh(); }, { ph: 'main' });
  const check = async (e) => {
    const b = e.currentTarget;
    if (!g.token || !validRepo(g.repo)) { A.ghResult = { ok: false, msg: '접근 키와 저장소(owner/repo)를 입력해 주세요' }; render(); return; }
    b.disabled = true; b.replaceChildren(h('span', { class: 'spin14' }), '확인 중…');
    try {
      await new GitHub(g).check();
      let shared = '';
      try { const r = await storeVault(); shared = r === 'saved' ? ' · 다른 PC에서도 비밀번호만으로 발행할 수 있게 보관했습니다' : r === 'same' ? ' · 다른 PC에서도 비밀번호만으로 발행할 수 있습니다' : ''; }
      catch (e) { console.warn(e); shared = ' · 다른 PC용 키 보관은 실패했습니다'; }
      A.ghResult = { ok: true, msg: `연결됐습니다 · ${g.repo} · ${g.branch || 'main'}${shared}` };
    } catch (err) {
      const info = errorInfo(err);
      A.ghResult = { ok: false, msg: info.title };
    }
    render();
  };
  wrap.append(section('GitHub 연결', { desc: '「연결 확인」을 누르면 접근 키를 비밀번호로 암호화해 보관합니다. 다른 PC에서는 비밀번호만 넣으면 됩니다.', right: btn('연결 확인', check, { size: 'sm' }) },
    h('div', { class: 'box' },
      settingRow('접근 키 (토큰)', '저장소 Contents 읽기·쓰기 권한이 있는 fine-grained 토큰', h('div', null, tok, A.err.gh && !g.token ? help('접근 키를 입력해 주세요', 'error') : null)),
      settingRow('저장소', 'owner/repo 형식', h('div', null, repo, A.err.gh && !validRepo(g.repo) ? help('owner/repo 형식으로 입력해 주세요', 'error') : null)),
      settingRow('브랜치', '기본 main', br)),
    resBox));
  wrap.append(section('위험 영역', { box: true }, settingRow('키 지우기', '이 PC에 저장된 토큰·저장소·브랜치를 지웁니다. 저장소에 보관된 암호화 키와 행사 데이터는 그대로입니다.',
    btn('키 지우기', () => askConfirm({
      title: '키를 지울까요?', msg: '이 PC에 저장된 GitHub 접근 키와 저장소 정보가 지워집니다.', ok: '지우기', tone: 'danger',
      onOk: () => { clearSettings(); A.gh = loadSettings(); A.ghResult = null; toast('키를 지웠습니다'); render(); }
    }), { cls: 'dangerText' }), { end: true })));
  host.append(wrap);
}

/* ───────── 인식 파일 만들기 (MindAR Compiler) ───────── */
function loadImg(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('이미지를 읽지 못했습니다')); im.src = src; });
}
function compileMind({ inPublish = false } = {}) {
  return new Promise((resolve) => {
    const n = A.cfg.posters.length;
    if (!n) { resolve(false); return; }
    const label = h('span', null, `포스터 1 / ${n}`), val = h('b', null, '0%'), fill = h('i');
    const errBox = h('div');
    const foot = h('div', { class: 'mf' });
    const wrap = h('div', { class: 'mscrim' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'mh' }, h('h2', { class: 'f-lg' }, '인식 파일 만드는 중')),
      h('div', { class: 'mb' }, h('div', { class: 'ubar' }, h('div', { class: 'top' }, label, val), h('div', { class: 'track' }, fill)),
        help('이 탭을 닫거나 다른 탭으로 옮기면 멈출 수 있습니다'), errBox), foot));
    document.body.append(wrap);
    const run = async () => {
      errBox.replaceChildren(); foot.replaceChildren();
      try {
        const { Compiler } = await import('../lib/mindar/mindar-image.prod.js');
        const imgs = [];
        for (const p of A.cfg.posters) imgs.push(await loadImg(urlOf(p.image)));
        const c = new Compiler();
        await c.compileImageTargets(imgs, (pct) => {
          const k = Math.min(n, Math.floor(pct / 100 * n) + 1);
          label.textContent = `포스터 ${k} / ${n}`; val.textContent = Math.floor(pct) + '%'; fill.style.width = pct.toFixed(1) + '%';
          if (inPublish) { A.progress = pct / 100 * 0.5; const pb = document.querySelector('.pbar i'); if (pb) pb.style.width = Math.round(A.progress * 100) + '%'; }
        });
        const buf = await c.exportData();
        await putFile(A.cfg.mindFile || 'assets/targets.mind', new Blob([buf], { type: 'application/octet-stream' }), { name: 'targets.mind' });
        A.meta.needMind = false;
        changed({ preview: false });
        wrap.remove();
        if (!inPublish) toast('인식 파일을 만들었습니다');
        resolve(true);
      } catch (err) {
        console.warn(err);
        errBox.replaceChildren(help('인식 파일을 만들지 못했습니다: ' + ((err && err.message) || err), 'error'));
        foot.replaceChildren(btn('닫기', () => { wrap.remove(); resolve(false); }), btn('다시 시도', run, { kind: 'primary' }));
      }
    };
    run();
  });
}

/* ───────── 불러오기 · 새 프로젝트 ───────── */
function referenced(cfg) {
  const s = new Set();
  // builtin/ 은 코드와 함께 배포되는 내장 파일이라 불러오기·발행 파일 목록에서 건너뛴다(명세 §3)
  const add = (p) => { if (p && typeof p === 'string' && !/^(https?:|blob:|data:)/.test(p) && !p.startsWith('builtin/')) s.add(p); };
  add(cfg.home && cfg.home.image); add(cfg.mindFile); // v2: 로고·대표 이미지는 참조하지 않는다(불러오지 않고, 발행 때 정리)
  (cfg.posters || []).forEach((p) => { add(p.image); add(p.model); add(p.gift && p.gift.image); add(p.mission && p.mission.icon); });
  add(cfg.stampTour && cfg.stampTour.gift && cfg.stampTour.gift.image);
  return s;
}
async function resetLocal() {
  A.urls.forEach((u) => URL.revokeObjectURL(u));
  A.urls.clear(); A.blobs.clear();
  await DB.clear('files'); await DB.clear('kv'); await Orig.clear(); // 편집기 원본도 남기지 않는다(데이터 분리)
  A.meta = blankMeta();
  A.err = {}; A.staffEdit = false; A.pid = null;
  if (A.vp) { A.vp.el.remove(); A.vp = null; }
}
function newProject() {
  askConfirm({
    title: '새 프로젝트를 만들까요?', msg: '편집 중인 내용이 모두 지워집니다.', ok: '새 프로젝트', tone: 'danger',
    onOk: async () => {
      await resetLocal();
      StaffRaw.clear(); // 이 PC의 직원 코드 원문도 지운다(데이터 분리)
      A.cfg = blankConfig();
      await saveNow();
      toast('새 프로젝트를 만들었습니다');
      go('home');
      loadIframe();
    }
  });
}
function hasEdits() {
  const c = A.cfg, hm_ = c.home || {};
  return c.posters.length > 0 || !!(hm_.image || hm_.startLabel) || (hm_.background || DEFAULT_HOME_BG).toUpperCase() !== DEFAULT_HOME_BG || (hm_.bgType || 'color') !== 'color' ||
    !!(c.staff && c.staff.codeHash) || !!(c.stampTour && c.stampTour.enabled) || (hm_.mainColor || DEFAULT_MAIN).toUpperCase() !== DEFAULT_MAIN;
}
function loadFromSite({ auto = false } = {}) {
  const run = async () => {
    A.busy = true; renderHeader();
    try {
      const useGh = !auto && !!(A.gh.token && validRepo(A.gh.repo));
      let cfg, files = new Map();
      if (useGh) {
        const gh = new GitHub(A.gh);
        const hd = await gh.head();
        const tree = await gh.tree(hd.treeSha);
        if (!tree.has('config.json')) throw Object.assign(new Error('config.json 없음'), { status: 404 });
        cfg = JSON.parse(new TextDecoder().decode(await gh.blobRaw(tree.get('config.json'))));
        for (const p of referenced(cfg)) if (tree.has(p)) files.set(p, new Blob([await gh.blobRaw(tree.get(p))]));
      } else {
        const r = await fetch('config.json', { cache: 'no-store' });
        if (!r.ok) throw Object.assign(new Error('config.json'), { status: r.status });
        cfg = await r.json();
        for (const p of referenced(cfg)) { const fr = await fetch(p, { cache: 'no-store' }); if (fr.ok) files.set(p, await fr.blob()); }
      }
      if (!cfg || !Array.isArray(cfg.posters) || !cfg.home) throw new Error('설정 형식이 맞지 않습니다');
      const fromV1 = cfg.schema !== SCHEMA; // v1·v2 형식이면 다시 발행해야 schema 3 으로 바뀐다
      await resetLocal();
      const base = blankConfig();
      A.cfg = normalizeConfig(cfg); // v1·v2(schema 1·2)면 v3로 변환. 발행하면 schema 3으로 저장된다
      if (!A.cfg.projectId) A.cfg.projectId = base.projectId;
      for (const [p, b] of files) {
        let info = { name: p.split('/').pop() };
        if (/\.glb$/i.test(p)) { const u = URL.createObjectURL(b); const m = await loadModel(u); URL.revokeObjectURL(u); info = { ...info, anims: m.failed ? 0 : m.clips.length, failed: m.failed }; }
        await putFile(p, b, info);
      }
      A.meta.needMind = A.cfg.posters.length > 0 && !files.has(A.cfg.mindFile);
      A.meta.publishedSig = fromV1 ? '' : sig(); // v1·v2 형식이면 다시 발행해야 schema 3으로 바뀐다
      A.meta.publishedAt = cfg.updatedAt || '';
      await saveNow();
      A.busy = false;
      toast(auto ? '발행된 최신 설정을 불러왔습니다' : useGh ? '저장소에서 설정을 불러왔습니다' : '사이트에서 설정을 불러왔습니다');
      go('home');
      loadIframe();
      autoPackModels(); // v3.6: 불러온 모델 중 압축 안 된 것 자동 압축
    } catch (err) {
      console.warn(err);
      A.busy = false; renderHeader();
      const info = err && err.status !== undefined ? errorInfo(err) : { title: '사이트 설정을 읽지 못했습니다', msg: String((err && err.message) || err), retry: false };
      askConfirm({ title: info.title, msg: info.msg, ok: info.retry ? '다시 시도' : '확인', noCancel: !info.retry, onOk: info.retry ? run : null });
    }
  };
  if (!auto && hasEdits()) askConfirm({ title: '사이트에서 불러올까요?', msg: '편집 중인 내용을 사이트 설정으로 덮어씁니다.', ok: '불러오기', onOk: run });
  else return run();
}

/* v3.7 열 때 자동 동기화: 발행된 설정이 이 PC 것보다 새것이면 가져온다.
   이 PC에 발행 안 한 수정이 있을 때만 어느 쪽을 쓸지 묻는다(말없이 덮어쓰지 않음). */
async function autoSync() {
  let cfg;
  try { const r = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return; cfg = await r.json(); } catch (_) { return; }
  if (!cfg || !Array.isArray(cfg.posters) || !cfg.home) return;
  const siteAt = Date.parse(cfg.updatedAt || '') || 0;
  const localAt = Date.parse(A.meta.publishedAt || '') || 0;
  const empty = !hasEdits();
  const unpublished = !empty && sig() !== A.meta.publishedSig;
  const sameProject = cfg.projectId && cfg.projectId === A.cfg.projectId;
  if (empty) { if (cfg.posters.length || siteAt) await loadFromSite({ auto: true }); return; }
  if (sameProject && siteAt <= localAt) return; // 이 PC 것이 최신
  if (!siteAt && sameProject) return;
  if (!unpublished) { await loadFromSite({ auto: true }); return; }
  askConfirm({
    title: '다른 곳에서 발행한 새 설정이 있습니다',
    msg: '이 PC에는 아직 발행하지 않은 수정이 있습니다. 사이트 설정을 불러오면 이 PC의 발행 안 한 수정은 사라집니다.',
    ok: '사이트 설정 불러오기', cancel: '이 PC 수정 유지',
    onOk: () => loadFromSite({ auto: true })
  });
}

/* ───────── 발행 ───────── */
function validate() {
  const c = A.cfg;
  if (!c.posters.length) { go('posters'); toast('포스터를 1장 이상 추가해 주세요', { kind: 'error' }); return false; }
  const noImg = c.posters.find((p) => !p.image || !A.blobs.has(p.image));
  if (noImg) { A.err.posterImage = noImg.id; go('poster', { pid: noImg.id, tab: 'basic' }); toast('포스터 이미지를 올려 주세요', { kind: 'error' }); return false; }
  if (!c.staff || !c.staff.codeHash) { A.err.staff = true; go('staff'); toast('직원 코드를 먼저 정해 주세요', { kind: 'error' }); return false; }
  if (!A.gh.token || !validRepo(A.gh.repo)) { A.err.gh = true; go('github'); toast('발행 설정에서 접근 키와 저장소를 입력해 주세요', { kind: 'error' }); return false; }
  return true;
}
function commitMessage(d = new Date()) { return `dameum_AR 설정 발행 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(d)}`; }
async function buildLocalFiles() {
  const cfg = normalizeConfig(A.cfg); // 발행은 언제나 schema 3, 알 수 없는 필드는 뺀다(직원 코드 원문은 cfg 에 없다)
  cfg.updatedAt = isoNow();
  const keep = referenced(cfg);
  const local = [];
  for (const p of keep) { const b = A.blobs.get(p); if (b) local.push({ path: p, blob: b, sha: await gitBlobSha(b) }); }
  const cb = new Blob([JSON.stringify(cfg, null, 2) + '\n'], { type: 'application/json' });
  local.push({ path: 'config.json', blob: cb, sha: await gitBlobSha(cb) });
  return { cfg, local, keep: [...keep, 'config.json'] };
}
async function publish() {
  if (A.busy) return;
  // v3.7: 이 PC에 접근 키가 없으면 비밀번호 한 번으로 보관된 키를 풀어 쓴다
  if (!A.gh.token && !A.unlocked) {
    const ok = await askPassword({ title: '발행 비밀번호', msg: '처음 발행하는 PC입니다. 발행 설정 비밀번호를 넣으면 보관된 접근 키로 바로 발행합니다.' });
    if (!ok) return;
    renderHeader();
  }
  if (!validate()) return;
  A.busy = true; A.progress = 0; renderHeader();
  const done = (ok) => { A.busy = false; A.progress = null; renderHeader(); return ok; };
  try { await autoPackModels(); } catch (e) { console.warn('발행 전 자동 압축 실패(원본으로 발행):', e); } // v3.6
  if (A.meta.needMind) {
    const ok = await compileMind({ inPublish: true });
    if (!ok) return done(false);
  }
  try {
    const { cfg, local, keep } = await buildLocalFiles();
    const gh = new GitHub(A.gh);
    const base = A.meta.needMind ? 0.5 : (A.progress || 0);
    await gh.publish(local, commitMessage(), CLEAN, keep, (p) => {
      A.progress = base + (1 - base) * p;
      const pb = document.querySelector('.pbar i'); if (pb) pb.style.width = Math.round(A.progress * 100) + '%';
    });
    A.cfg.updatedAt = cfg.updatedAt;
    A.meta.publishedSig = sig();
    A.meta.publishedAt = new Date().toISOString();
    await saveNow();
    done(true);
    toast('발행했습니다. 사이트 반영까지 1~3분 걸립니다');
  } catch (err) {
    console.warn(err);
    done(false);
    const info = errorInfo(err);
    askConfirm({ title: info.title, msg: info.msg, ok: info.retry ? '다시 시도' : '확인', noCancel: !info.retry, onOk: info.retry ? publish : null });
  }
}

/* 테스트용: 실제 호출 없이 발행 요청 묶음을 계산한다 */
window.__admin.planPublish = async (remoteEntries = []) => {
  const { cfg, local, keep } = await buildLocalFiles();
  const plan = GitHub.plan(local, new Map(remoteEntries), CLEAN, keep);
  return { message: commitMessage(), config: cfg, upload: plan.upload.map((f) => f.path), remove: plan.remove };
};
window.__admin.publish = publish;
window.__admin.validate = validate;
window.__admin.autoPack = () => autoPackModels();

/* v3.6 자동 압축: 아직 압축하지 않은 업로드 모델(GLB)을 찾아 Draco 로 줄인다.
   설정 페이지를 열 때·사이트에서 불러온 뒤·발행 직전에 돈다. 이미 압축됐거나 효과가 없던 모델은 다시 시도하지 않는다. */
let packing = null;
function autoPackModels() {
  if (packing) return packing;
  packing = (async () => {
    const paths = [...new Set(A.cfg.posters.map((p) => p.model).filter((m) => m && !isBuiltin(m) && /\.glb$/i.test(m)))];
    let n = 0, saved = 0;
    for (const path of paths) {
      const meta = A.meta.files[path];
      if (!meta || meta.failed || (meta.packed && (meta.packed.after || meta.packed.skip))) continue;
      const src = A.blobs.get(path);
      if (!src) continue;
      if (src.size < 300 * 1024) { meta.packed = { skip: '작은 모델' }; continue; }
      const pk = await packModel(src);
      if (pk.packed && pk.packed.after) {
        await putFile(path, pk.blob, { ...meta, packed: pk.packed });
        n++; saved += pk.packed.before - pk.packed.after;
      } else meta.packed = pk.packed;
    }
    if (n) { changed(); render(); toast(`3D 모델 ${n}개를 자동으로 압축했습니다(${sizeTxt(saved)} 줄임)`); }
    else if (DB.db) await saveNow();
    return n;
  })().finally(() => { packing = null; });
  return packing;
}

/* ───────── 시작 ───────── */
async function boot() {
  try { await DB.open(); } catch (err) { console.warn('IndexedDB 를 쓸 수 없습니다', err); }
  let saved = null;
  try { if (DB.db) saved = await DB.get('kv', 'project'); } catch (_) {}
  if (saved && saved.cfg) {
    // v1 편집 상태도 v2로 변환한다(옛 필드 버림, 기본값 채움). 미션 종류별 초안도 같은 규칙.
    A.cfg = normalizeConfig(saved.cfg); A.meta = { ...blankMeta(), ...saved.meta };
    if (!A.cfg.projectId) A.cfg.projectId = blankConfig().projectId;
    Object.values(A.meta.drafts || {}).forEach((d) => { Object.keys(d || {}).forEach((t) => { d[t] = normalizeMission(d[t]); }); });
    try {
      const keys = await DB.keys('files');
      for (const k of keys) { const b = await DB.get('files', k); if (b) A.blobs.set(k, b); }
    } catch (_) {}
    // v1 의 로고·대표 이미지 Blob 은 더 이상 참조하지 않으므로 편집 저장소에서 지운다
    for (const k of [...A.blobs.keys()]) if (k.startsWith('assets/brand/') && k !== A.cfg.home.image) await dropFile(k);
    Object.keys(A.meta.files).forEach((k) => { if (k.startsWith('assets/brand/') && k !== A.cfg.home.image) delete A.meta.files[k]; });
    if (saved.cfg.schema !== SCHEMA && DB.db) await saveNow();
  } else {
    A.cfg = blankConfig();
    if (DB.db) await saveNow();
  }
  A.ready = true;
  A.view = 'home'; // v3.7: 접근 키가 없어도 홈부터(발행 때 비밀번호로 보관된 키를 씀)
  render();
  loadIframe();
  await autoSync(); // v3.7: 다른 PC에서도 발행된 설정을 바로 가져온다
  autoPackModels(); // v3.6: 예전에 올린 모델도 열자마자 자동으로 압축
}
boot();
