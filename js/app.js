/* dameum_AR 관람객 웹앱 v3: 화면 전환, 홈, AR 흐름, 성공 연출, 사은품·「미션 성공」 시트, 선물 상자, 직원 수령
   미리보기: ?preview=<포스터번호|home|box>  &reset=1 (미리보기 저장소 비움)  &embed=1 (설정 페이지 iframe, postMessage 로 설정 받음) */
import { applyTheme, applyHomeTheme, PRESET_REP, avgBottom } from './theme.js?v=3.8';
import { openBox, sha256Hex } from './storage.js?v=3.8';
import * as haptics from './haptics.js?v=3.8';
import { Stage } from './ar.js?v=3.8';
import { createMission, missionGuide } from './missions.js?v=3.8';
import { normalizeConfig, builtinUrl, GIFT_BOX_PATH } from './config.js?v=3.8';
import { playEffect } from './effects.js?v=3.8';

const $ = (id) => document.getElementById(id);
/* 그림 칸의 <img>: 주소가 정해지는 렌더 시점에 처음 만든다(HTML 에 src 없는 img 를 두지 않는다) */
const slotImg = (boxId, id, hidden) => {
  let img = $(id);
  if (!img) { img = document.createElement('img'); img.id = id; img.alt = ''; img.hidden = !!hidden; $(boxId).appendChild(img); }
  return img;
};
const Q = new URLSearchParams(location.search);
const PV = Q.get('preview');
const EMBED = Q.get('embed') === '1';
const S = {
  cfg: null, box: null, preview: PV !== null || EMBED, screen: null, stage: null, stageBoot: false,
  cur: null, mission: null, cardOpen: true, sensorDenied: false,
  staff: { step: 1, fails: 0, lockUntil: 0, show: false, sel: new Set(), err: false, timer: 0 },
  giftOk: null, paused: false, embedScene: null,
  /* sheet: null | 'leaving'(카드 내려가는 중) | 'open'(사은품 시트) — 그동안 다른 포스터 인식·칩 변경 무시
     boxFrom: 선물 상자에 들어온 길 'home' | 'ar' (직원 확인을 다녀와도 유지) */
  sheet: null, boxFrom: 'home', lastIndex: 0
};
const REDUCED = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.__ar = { S, haptics: window.__haptics };

const ICON = (n, cls = 'i') => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const posters = () => (S.cfg && Array.isArray(S.cfg.posters) ? S.cfg.posters : []);
const missionPosters = () => posters().filter((p) => p.mission && p.mission.type && p.mission.type !== 'none');
/* 사은품이 있는 미션인지(명세 C6) — 보이는 기준은 현재 config */
const giftOn = (p) => !!(p && p.mission && p.mission.type !== 'none' && p.gift && p.gift.enabled !== false);
const GIFT_BOX = builtinUrl(GIFT_BOX_PATH);
/* 설정 페이지 미리보기(embed) 안에서는 어떤 요소에도 focus() 를 걸지 않는다 — 설정 페이지 입력 칸의 포커스를 빼앗지 않게(명세 C2) */
const focusEl = (el) => { if (!EMBED && el && !el.disabled) el.focus({ preventScroll: true }); };
/* 사은품 이미지: 비었거나 읽기 실패면 기본 선물 상자 그림, 그것도 실패하면 칸을 비운다(명세 C10, D3-5) */
function giftImg(img, src, onEmpty) {
  img.onerror = () => {
    if (img.dataset.fb !== '1') { img.dataset.fb = '1'; img.src = GIFT_BOX; return; }
    img.removeAttribute('src'); if (onEmpty) onEmpty();
  };
  img.dataset.fb = src ? '0' : '1';
  img.src = src || GIFT_BOX;
}
window.__giftImgErr = (img) => { if (img.dataset.fb !== '1') { img.dataset.fb = '1'; img.src = GIFT_BOX; } else img.removeAttribute('src'); };

/* ── 화면 전환 ── */
const SCREENS = ['v0', 'v1', 'v2', 'cam', 'v7', 'v8'];
function show(id) {
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  S.screen = id;
  $('stage').hidden = !(id === 'cam' || (id === 'v2' && S.stageBoot));
  document.body.classList.toggle('cam-on', id === 'cam' || id === 'v2');
  document.body.classList.toggle('home-on', id === 'v1');
}
function status(title, msg, actions = [], loading = false) {
  $('v2Spin').hidden = !loading;
  $('v2Title').textContent = title;
  $('v2Msg').textContent = msg || '';
  $('v2Msg').hidden = !msg;
  const box = $('v2Acts'); box.innerHTML = '';
  actions.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'abtn ' + (i === 0 ? 'primary' : 'secondary');
    b.textContent = a.label;
    b.onclick = a.onClick;
    box.appendChild(b);
  });
  box.hidden = !actions.length;
  show('v2');
}
let toastT = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2400);
}
let noticeT = 0;
function notice(msg, ms = 3000) {
  $('camNoticeTxt').textContent = msg;
  $('camNotice').hidden = false;
  clearTimeout(noticeT);
  noticeT = setTimeout(() => { $('camNotice').hidden = true; }, ms);
}

/* ── 시작 ── */
const ua = navigator.userAgent;
const inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\/|everytimeApp|DaumApps/i.test(ua);
const isAndroid = /Android/i.test(ua);

function boot() {
  if (EMBED) {
    window.addEventListener('message', onEmbedMessage);
    status('준비 중', '', [], true);
    try { parent.postMessage({ type: 'dameum:ready' }, '*'); } catch (_) {}
    return;
  }
  if (inApp && !S.preview) { showInApp(); return; }
  loadConfig();
}

function showInApp() {
  $('v0Msg').textContent = `앱 안의 브라우저에서는 카메라가 동작하지 않을 수 있습니다. ${isAndroid ? 'Chrome' : 'Safari'}에서 열어 주세요.`;
  $('v0Open').textContent = isAndroid ? 'Chrome에서 열기' : '주소 복사';
  $('v0Open').onclick = () => {
    const url = location.href;
    if (/KAKAOTALK/i.test(ua)) { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url); return; }
    if (isAndroid) { location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end'; return; }
    try { navigator.clipboard.writeText(url).then(() => toast('주소를 복사했습니다. Safari 주소창에 붙여 넣어 주세요.'), () => toast('주소를 길게 눌러 복사해 주세요.')); }
    catch (_) { toast('주소를 길게 눌러 복사해 주세요.'); }
  };
  $('v0Stay').onclick = () => loadConfig();
  show('v0');
}

async function loadConfig() {
  status('준비 중', '', [], true);
  let cfg = null;
  try {
    const r = await fetch('config.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    cfg = normalizeConfig(await r.json()); // v1·v2(schema 1·2) config 도 메모리에서 v3(schema 3)로 바꿔 쓴다(파일은 그대로)
  } catch (err) {
    if (location.protocol === 'file:') {
      status('HTTPS 주소가 필요합니다', '파일로 열면 설정을 읽을 수 없습니다. 배포된 https:// 주소나 로컬 서버(serve.ps1)로 열어 주세요.');
    } else {
      status('설정을 불러오지 못했습니다', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.', [{ label: '다시 시도', onClick: loadConfig }]);
    }
    return;
  }
  init(cfg);
  route(PV);
}

function init(cfg) {
  S.cfg = cfg;
  applyTheme(cfg.home.mainColor);
  applyHomeTheme(cfg.home.background, cfg.home.mainColor);
  document.title = (cfg.projectName || '').trim() || 'AR 전시';
  const pid = cfg.projectId || 'unknown';
  if (!S.box || S.box.pid !== pid) {
    S.box = openBox(pid, { preview: S.preview, reset: S.preview && Q.get('reset') === '1' && !S.didReset });
    S.box.pid = pid;
    S.didReset = true;
  }
}

function route(pv) {
  if (pv === 'box') { openBoxScreen('home'); return; }
  const n = parseInt(pv, 10);
  if (Number.isFinite(n) && n >= 1 && n <= posters().length) { enterPreview(n - 1); return; }
  renderHome(); show('v1');
}

/* ── 설정 페이지 미리보기 (postMessage) ── */
function onEmbedMessage(e) {
  const d = e.data;
  if (d && d.type === 'dameum:playfx') { playFxPreview(); return; }
  if (!d || d.type !== 'dameum:config' || !d.config) return;
  const prevScene = S.embedScene;
  init(normalizeConfig(d.config));
  const sc = d.scene || { kind: 'home' };
  S.embedScene = sc;
  if (sc.kind === 'found' || sc.kind === 'gift') {
    const i = Math.max(0, Math.min(posters().length - 1, (sc.poster || 1) - 1));
    if (!posters().length) { closeGift(); if (S.stage) exitStage(); renderHome(); show('v1'); return; }
    closeGift();
    if (S.stage && S.stage.mode === 'preview' && S.screen === 'cam') refreshPreviewPoster(i, prevScene);
    else enterPreview(i);
    if (sc.kind === 'gift') previewGiftSheet();
    return;
  }
  closeGift();
  if (S.stage) exitStage();
  if (sc.kind === 'box') openBoxScreen('home'); else { renderHome(); show('v1'); }
}
function refreshPreviewPoster(i, prevScene) {
  const p = posters()[i];
  const prev = S.cur && S.cur.poster;
  S.stage.setPosters(posters());
  // 미리보기에서 이미 성공(연출로 3D 가 사라짐)했으면 「인식 후」를 처음부터 다시 보인다.
  // 「사은품」 장면끼리 바뀔 때는 3D 를 숨긴 채로 둔다(시트만 다시 채움)
  const giftStay = !!(prevScene && prevScene.kind === 'gift' && S.embedScene && S.embedScene.kind === 'gift');
  const finished = !!((S.stage.fxHidden && !giftStay) || (S.mission && S.mission.done));
  if (finished || !S.cur || S.cur.index !== i || !prev || prev.model !== p.model || prev.id !== p.id) {
    S.stage.setPreviewPoster(p.image);
    switchPoster(i, true);
    return;
  }
  if (prev.image !== p.image) S.stage.setPreviewPoster(p.image);
  S.cur.poster = p;
  S.stage.cur.poster = p;
  if (JSON.stringify(prev.mission) !== JSON.stringify(p.mission) || prev.animation !== p.animation) { switchPoster(i, true); return; }
  updateTop();
  renderCard();
  S.stage.renderNow();
}
/* 설정 페이지 「사은품」 탭 미리보기: 실제 흐름처럼 3D·카드·미션 그래픽을 숨긴 뒤 시트만 (확인 → 미리보기 선물 상자) */
function previewGiftSheet() {
  const p = S.cur && S.cur.poster;
  if (!p) return;
  if (S.stage) { S.stage.fxHidden = true; S.stage.update(); S.stage.renderNow(); } // 성공 연출 뒤처럼 3D 를 숨긴다
  $('mload').hidden = true;
  const onOk = () => { closeGift(); goBoxFromAR(); };
  if (giftOn(p) || !p.mission || p.mission.type === 'none') showGift({ head: '미션 완료', gift: p.gift || {}, onOk });
  else showGift({ success: true, note: p.successNote, onOk }); // 사은품 꺼짐 = 「미션 성공」 시트(명세 C6)
}
/* 설정 「미리보기로 보기」: 「인식 후」에서 연출만 1회 → 끝나면 3D·카드를 처음 상태로(시트 없음) */
function playFxPreview() {
  if (S.screen !== 'cam' || !S.cur) return;
  if (!S.cur.ready || !S.mission) { S.pendingFx = true; return; }
  if (S.sheet) return;
  S.pendingFx = false;
  const i = S.cur.index;
  if (S.mission) { S.mission.destroy(); S.mission = null; }
  S.sheet = 'leaving';
  $('mlayer').hidden = true;
  let n = 2;
  const next = () => { if (--n) return; if (S.sheet !== 'leaving') return; S.sheet = null; if (S.screen === 'cam') switchPoster(i, true); };
  runEffect(S.cur.poster, next);
  cardLeave(next);
}

/* ── V1 홈 (배경 + 홈 이미지 + 버튼 두 개) ── */
/* 홈 배경(명세 C1): 단색 / 프리셋 이미지 / 홈 이미지 블러. 그림을 읽기 전·실패 = 배경색, 읽은 뒤 = 그림 아래 띠 색 기준으로 버튼 대비 */
let bgToken = 0;
function applyHomeBg() {
  const h = S.cfg.home, box = $('homeBg'), img = slotImg('homeBg', 'homeBgImg');
  const tk = ++bgToken;
  let src = '', blur = false, rep = null;
  if (h.bgType === 'preset' && PRESET_REP[h.bgPreset]) { src = builtinUrl(`builtin/bg/${h.bgPreset}.jpg`); rep = PRESET_REP[h.bgPreset]; }
  else if (h.bgType === 'blur' && (h.image || '').trim()) { src = h.image.trim(); blur = true; }
  const plain = () => { box.hidden = true; document.body.classList.remove('bgimg'); applyHomeTheme(h.background, h.mainColor); };
  if (!src) { img.removeAttribute('src'); plain(); return; }
  if (img.getAttribute('src') !== src) plain(); // 새 그림을 읽는 동안은 배경색 + 배경색 기준 버튼
  else applyHomeTheme(h.background, h.mainColor);
  img.classList.toggle('blur', blur);
  const shown = async () => {
    if (tk !== bgToken) return;
    if (blur) rep = await avgBottom(src, h.background);
    if (tk !== bgToken) return;
    box.hidden = false; document.body.classList.add('bgimg');
    applyHomeTheme(h.background, h.mainColor, document.documentElement, rep);
  };
  img.onload = shown;
  img.onerror = () => { if (tk === bgToken) plain(); };
  if (img.getAttribute('src') !== src) img.src = src;
  else if (img.complete && img.naturalWidth) shown();
}
function setImg(img, src) {
  if (!src) { img.hidden = true; img.removeAttribute('src'); return; }
  img.onerror = () => { img.hidden = true; }; // 로드 실패 = 이미지 자리 비움(깨진 이미지 금지)
  img.onload = () => { img.hidden = false; };
  if (img.getAttribute('src') !== src) { img.hidden = true; img.src = src; } else img.hidden = !img.complete || !img.naturalWidth;
}
/* 홈 「선물 상자」 개수: 사은품 없는 미션의 완료 기록은 세지 않는다(명세 C6) */
function giftCount() { return Object.keys(S.box.data.gifts).filter((k) => k === '_stampTour' || posters().some((p) => p.id === k && giftOn(p))).length; }
function renderHome() {
  const h = S.cfg.home;
  setImg(slotImg('homeImgBox', 'homeImg', true), (h.image || '').trim());
  applyHomeBg();
  const n = giftCount();
  $('homeBoxN').textContent = n; $('homeBoxN').hidden = n < 1;
  const ready = posters().length > 0;
  $('homeStart').disabled = !ready;
  $('homeStartTxt').textContent = (h.startLabel || '').trim() || 'AR 시작하기';
  $('homeNote').hidden = ready;
}
$('homeStart').onclick = () => startAR();
$('homeBox').onclick = () => openBoxScreen('home');

/* ── AR 시작 ── */
async function startAR() {
  if (!posters().length) return;
  if (S.preview) { enterPreview(0); return; }
  if (!window.isSecureContext) {
    status('HTTPS 주소가 필요합니다', '카메라는 https:// 주소에서만 켜집니다. 배포된 주소로 접속해 주세요.', [{ label: '홈으로', onClick: goHome }]);
    return;
  }
  // 같은 탭 처리 안에서: iOS 방향 센서 권한 → 카메라 권한
  S.sensorDenied = false;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      S.sensorDenied = r !== 'granted';
    }
  } catch (_) { S.sensorDenied = true; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cameraError({ name: 'NotFoundError' }); return; }
  status('준비 중', 'AR 엔진과 3D 모델을 불러오고 있습니다.', [], true);
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    s.getTracks().forEach((t) => t.stop());
  } catch (err) { cameraError(err); return; }
  let mindUrl;
  try {
    const r = await fetch(S.cfg.mindFile || 'assets/targets.mind', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    mindUrl = URL.createObjectURL(await r.blob());
  } catch (_) {
    status('인식 파일이 없습니다', '운영자에게 알려 주세요.', [{ label: '홈으로', onClick: goHome }]);
    return;
  }
  try {
    S.stageBoot = true;
    $('stage').hidden = false;
    S.stage = new Stage($('stage'), stageHooks());
    S.stage.setPosters(posters());
    await S.stage.startAR(mindUrl);
    S.stageBoot = false;
    enterScan();
    setTimeout(() => {
      if (S.screen === 'cam' && (S.sensorDenied || !S.stage || !S.stage.sensor.ok)) notice('폰을 돌리면 3D가 사라질 수 있어요');
    }, S.sensorDenied ? 0 : 1500);
  } catch (err) {
    console.warn(err);
    S.stageBoot = false;
    if (S.stage) { S.stage.destroy(); S.stage = null; }
    cameraError(err || {});
  }
}
function cameraError(err) {
  const name = (err && err.name) || '';
  const retry = [{ label: '다시 시도', onClick: () => startAR() }, { label: '홈으로', onClick: goHome }];
  if (/NotAllowed|Permission|Security/i.test(name) || /permission/i.test(String(err && err.message))) {
    status('카메라 권한이 필요합니다', '브라우저 설정에서 이 사이트의 카메라 권한을 허용한 뒤 다시 시도해 주세요.', retry);
  } else if (/NotFound|Overconstrained|DevicesNotFound/i.test(name)) {
    status('카메라를 찾을 수 없습니다', '카메라가 있는 기기에서 접속해 주세요.', retry);
  } else {
    status('시작하지 못했습니다', '잠시 후 다시 시도해 주세요.', retry);
  }
}

function stageHooks() {
  return {
    found: (i) => onFound(i),
    lost: (i) => onLost(i),
    ready: (i, m) => onModelReady(i, m),
    frame: () => onFrame(),
    region: () => floatRegion()
  };
}
/* 상단 칩 아래 끝(client y) — 움직이는 3D·목표가 칩에 가리지 않게 */
function chipBottom() { const t = document.querySelector('#cam .topbar'); return t ? t.getBoundingClientRect().bottom : 0; }
/* 떠다니는 3D 영역(명세 C5, D3-3): 위 = 상단 칩 아래 8, 아래 = 현재 카드 윗변 − 16, 좌우 = 화면 안 */
function floatRegion() {
  const c = $('cam').getBoundingClientRect(), card = $('card');
  const bottom = !card.hidden && !card.classList.contains('leaving') ? card.getBoundingClientRect().top - 16 : c.bottom - 16;
  return { left: c.left, right: c.right, top: chipBottom() + 8, bottom };
}

function enterScan() {
  S.cur = null; S.mission = null;
  $('card').hidden = true;
  $('camPv').hidden = !S.preview;
  updateTop();
  show('cam');
}

/* 미리보기 모드: 카메라 없이 그 포스터를 인식한 상태로 시작 */
function enterPreview(i) {
  closeGift();
  if (S.stage && S.stage.mode !== 'preview') exitStage();
  if (!S.stage) {
    $('stage').hidden = false;
    S.stage = new Stage($('stage'), stageHooks());
    S.stage.setPosters(posters());
    show('cam');
    S.stage.initPreview();
  } else {
    S.stage.setPosters(posters());
  }
  $('camPv').hidden = false;
  show('cam');
  S.lastIndex = i;
  S.stage.setPreviewPoster(posters()[i].image);
  S.stage.resizePreview();
  onFound(i);
}

function onFound(i) {
  if (S.sheet) return; // 카드 퇴장·사은품 시트 중에는 다른 포스터 인식을 무시한다
  haptics.short();
  if (S.cur && S.cur.index === i) { S.stage.refound(); updateTop(); return; }
  switchPoster(i);
}
function switchPoster(i, silent) {
  if (S.mission) { S.mission.destroy(); S.mission = null; }
  const p = posters()[i];
  S.cur = { index: i, poster: p, ready: false };
  S.cardOpen = true;
  $('card').hidden = true;
  $('card').classList.remove('leaving');
  $('mlayer').hidden = false;
  $('mload').hidden = false;
  updateTop();
  S.stage.setPoster(i);
}
function onModelReady(i, m) {
  if (!S.cur || S.cur.index !== i) return;
  S.cur.ready = true;
  S.cur.model = m;
  $('mload').hidden = true;
  S.mission = createMission(S.cur.poster, {
    stage: S.stage, layer: $('mlayer'), resolve: (u) => u,
    topLimit: () => chipBottom() + 8,
    onChange: () => updateProgress(),
    onSuccess: () => onMissionSuccess()
  });
  S.mission.setup();
  renderCard();
  S.stage.renderNow();
  if (S.pendingFx) setTimeout(playFxPreview, 0);
}
function onLost(i) { updateTop(); }

let lastTop = '';
function updateTop() {
  if (S.sheet) return; // 시트 중에는 칩도 바꾸지 않는다
  const shown = !!(S.cur && S.stage && (S.stage.visible() || !S.cur.ready));
  // 칩 = 포스터 인식 여부(v2 와 같음). 3D 가 화면 기준으로 떠다니는 중에도 칩은 포스터 상태를 따른다(명세 C5).
  const vis = shown && (!S.stage.float || S.stage.posterVisible());
  const key = vis ? '1' : '0';
  const scanOn = !S.cur || !shown;
  $('scanUi').hidden = !scanOn;
  $('scanUi').querySelector('.guide').hidden = !!S.cur;
  if (key === lastTop) return;
  lastTop = key;
  const chip = $('camState');
  chip.classList.toggle('dim', !vis);
  chip.querySelector('.dot').hidden = !vis;
  // 포스터 이름은 운영용 정보라 칩에 쓰지 않는다(명세 v2 R6)
  $('camStateTxt').textContent = vis ? '인식됨' : '포스터를 찾는 중';
}
function onFrame() {
  if (S.screen !== 'cam') return;
  if (S.mission) S.mission.sync();
  if (S.cur && !S.cur.ready && S.stage) {
    const c = S.stage.posterClient();
    const ml = $('mload');
    if (c) { const r = $('cam').getBoundingClientRect(); ml.style.left = (c.x - r.left) + 'px'; ml.style.top = (c.y - r.top) + 'px'; }
  }
  updateTop();
}

/* ── 3D 입력 ── */
const touch = $('touch');
touch.addEventListener('pointerdown', (e) => {
  if (!S.mission) return;
  try { touch.setPointerCapture(e.pointerId); } catch (_) {}
  S.mission.pointerDown(e);
});
touch.addEventListener('pointermove', (e) => { if (S.mission) S.mission.pointerMove(e); });
touch.addEventListener('pointerup', (e) => { if (S.mission) S.mission.pointerUp(e); });
touch.addEventListener('pointercancel', (e) => { if (S.mission) S.mission.pointerCancel(e); });

/* ── V4 미션 카드: 안내 문구 + 진행 (제목·설명글·완료 줄 없음) ── */
function renderCard() {
  const card = $('card');
  const mi = S.mission;
  const type = mi ? mi.type : 'none';
  // 미션 없음 = 카드 없이 3D만. 퇴장·시트 중에는 다시 그리지 않는다.
  if (!S.cur || !S.cur.ready || type === 'none' || S.sheet) { if (!S.sheet || S.sheet === 'open') card.hidden = true; return; }
  const pr = mi.progress();
  const guide = esc(mi.guide());
  card.hidden = false;
  card.classList.remove('leaving');
  card.classList.toggle('collapsed', !S.cardOpen);
  const prog = (id) => (pr ? `<span class="md w6 num cprog" id="${id}" aria-live="polite">${esc(pr.text)}</span>` : '');
  if (!S.cardOpen) {
    card.innerHTML = `<div class="crow1"><span class="cguide one md w5">${guide}</span>${prog('cardProg')}` +
      `<button class="ib44" id="cardToggle" aria-label="카드 펴기">${ICON('chevU')}</button></div>`;
    card.onclick = () => { S.cardOpen = true; renderCard(); };
    return;
  }
  card.onclick = null;
  let html = `<div class="handle"></div><div class="crow1"><span class="cguide md w5${type === 'quiz' ? ' full' : ''}">${guide}</span>${type === 'quiz' ? '' : prog('cardProg')}` +
    `<button class="ib44" id="cardToggle" aria-label="카드 접기">${ICON('chevD')}</button></div>`;
  if (pr && pr.ratio != null) html += `<div class="prog cbar"><i id="cardBar" style="width:${Math.round(pr.ratio * 100)}%"></i></div>`;
  if (type === 'quiz') html += '<div id="cardQuiz" class="cquiz"></div>';
  card.innerHTML = html;
  $('cardToggle').onclick = (e) => { e.stopPropagation(); S.cardOpen = false; renderCard(); };
  if ($('cardQuiz')) mi.renderQuiz($('cardQuiz'));
}
function updateProgress() {
  if (!S.mission || !S.cur || S.sheet) return;
  const pr = S.mission.progress();
  if (!pr) return;
  if ($('cardProg')) $('cardProg').textContent = pr.text;
  if ($('cardBar') && pr.ratio != null) $('cardBar').style.width = Math.round(pr.ratio * 100) + '%';
}

/* ── 미션 성공 → 진동 → 성공 연출 + 카드 퇴장 → (둘 다 끝난 뒤) V5 사은품 시트 또는 「미션 성공」 시트 → (완주 시트) → V7 ── */
function onMissionSuccess() {
  haptics.success();
  const p = S.cur.poster;
  const already = S.box.has(p.id);
  S.sheet = 'leaving';
  $('mlayer').hidden = true; // 카메라 위 미션 그래픽은 즉시 숨김
  const onOk = () => {
    if (!already) S.box.earn(p.id); // 이미 받은(완료한) 포스터는 다시 담지 않는다(중복 기록 없음)
    const st = stampTourJustDone();
    if (st) swapGift({ head: '스탬프 투어 완주', gift: st.gift || {}, onOk: finishToBox });
    else finishToBox();
  };
  let n = 2;
  const next = () => {
    if (--n) return;
    if (giftOn(p)) showGift({ head: already ? '이미 받은 선물' : '미션 완료', gift: p.gift || {}, onOk });
    else showGift({ success: true, note: p.successNote, onOk }); // 사은품 없음: 다시 성공해도 같은 시트
  };
  runEffect(p, next); // 연출과 카드 퇴장은 동시에 시작, 둘 다 끝난 뒤에 시트
  cardLeave(next);
}
/* 성공 연출(명세 C3): 3D 는 지금 보이는 자리에서 사라지고 다시 나타나지 않는다. 연출 중 터치는 미션이 끝난 상태라 무시된다. */
function runEffect(p, done) {
  const st = S.stage, cam = $('cam').getBoundingClientRect();
  const W = cam.width, H = cam.height;
  let o = { x: W / 2, y: H * 0.35 }, r = W * 0.16;
  if (st && !st.noGL) {
    const c = st.screenCircle();
    if (c) { o = { x: c.x - cam.left, y: c.y - cam.top }; r = c.r; }
  }
  if (st) st.beginFx();
  if (st && st.noGL) st.endFx(true); // WebGL 없음: 3D 대체 표시를 숨기고 조각 연출만
  playEffect({
    canvas: $('fx'), type: p.effect, main: S.cfg.home.mainColor, o, r, reduced: REDUCED(),
    onModel: (k, a) => { if (S.stage === st && st && st.fx) st.setFx(k, a); },
    done: () => { if (st && S.stage === st) st.endFx(true); if (S.sheet === 'leaving') done(); }
  });
}
/* 카드가 아래로 내려가 화면 밖으로 나간 뒤(transitionend)에만 다음 단계. 두 시트가 같은 프레임에 보이지 않는다. */
function cardLeave(next) {
  const card = $('card');
  let done = false;
  const go = () => {
    if (done) return; done = true;
    card.hidden = true;
    card.classList.remove('leaving');
    let called = false;
    const once = () => { if (called) return; called = true; if (S.sheet === 'leaving') next(); };
    if (REDUCED()) { requestAnimationFrame(once); setTimeout(once, 50); } // 숨긴 다음 프레임(rAF 가 멈춘 창 대비 타이머)
    else once();
  };
  if (card.hidden || REDUCED()) { go(); return; }
  card.onclick = null;
  card.addEventListener('transitionend', function te(e) { if (e.target === card) { card.removeEventListener('transitionend', te); go(); } });
  card.classList.add('leaving');
  setTimeout(go, 400); // transitionend 가 오지 않는 환경(숨은 탭 등) 대비
}
function stampTourJustDone() {
  const st = S.cfg.stampTour;
  if (!st || !st.enabled) return null;
  const mp = missionPosters();
  if (!mp.length || S.box.has('_stampTour')) return null;
  if (!mp.every((p) => S.box.has(p.id))) return null;
  S.box.earn('_stampTour');
  return st;
}
/* 시트 내용: 사은품(머리 + 제목 + 이미지 + 설명 + 받는 곳) 또는 「미션 성공」(제목 + 성공 안내 문구만, 명세 C6·D3-5) */
function fillGift({ head, gift, success, note }) {
  $('giftSheet').classList.toggle('okonly', !!success);
  const h = $('giftHead');
  if (success) {
    h.hidden = true;
    $('giftTitle').textContent = '미션 성공';
    $('giftImgBox').hidden = true; if ($('giftImg')) $('giftImg').removeAttribute('src');
    const t = (note || '').trim();
    $('giftNote').textContent = t; $('giftNote').hidden = !t;
    $('giftDesc').hidden = true; $('giftClaim').hidden = true; $('giftNoSave').hidden = true;
    return;
  }
  h.hidden = false;
  $('giftNote').hidden = true;
  h.textContent = head;
  h.style.color = head === '이미 받은 선물' ? 'var(--a-t3)' : 'var(--a-main-text)';
  $('giftTitle').textContent = (gift.title || '').trim() || '선물';
  $('giftImgBox').hidden = false;
  giftImg(slotImg('giftImgBox', 'giftImg'), (gift.image || '').trim(), () => { $('giftImgBox').hidden = true; });
  const desc = (gift.description || '').trim();
  $('giftDesc').textContent = desc; $('giftDesc').hidden = !desc;
  const cn = (gift.claimNote || '').trim();
  $('giftClaimTxt').textContent = cn; $('giftClaim').hidden = !cn;
  $('giftNoSave').hidden = S.box.persistent;
}
function showGift(o) {
  if (S.screen !== 'cam') return; // 그사이 AR 을 떠났으면 띄우지 않는다
  S.sheet = 'open';
  $('card').hidden = true;
  $('mlayer').hidden = true;
  fillGift(o);
  S.giftOk = o.onOk;
  $('giftScrim').hidden = false;
  $('gift').hidden = false;
  focusEl($('giftOk'));
}
/* 완주가 이어질 때: 시트는 그대로, 내용만 바꾼다(150ms 페이드) */
function swapGift(o) {
  fillGift(o);
  S.giftOk = o.onOk;
  const b = $('giftBody');
  b.classList.remove('swap'); void b.offsetWidth; b.classList.add('swap');
  focusEl($('giftOk'));
}
function closeGift() { $('giftScrim').hidden = true; $('gift').hidden = true; S.giftOk = null; S.sheet = null; }
$('giftOk').onclick = () => { const f = S.giftOk; if (f) f(); else closeGift(); };
/* 마지막 「확인」: 카메라·AR 종료 → 선물 상자(V7). 「뒤로」는 AR 로 돌아온다. */
function finishToBox() { closeGift(); goBoxFromAR(); }
function goBoxFromAR() { S.lastIndex = S.cur ? S.cur.index : S.lastIndex; openBoxScreen('ar'); }

/* ── 종료 ── */
function exitStage() {
  if (S.mission) { S.mission.destroy(); S.mission = null; }
  if (S.stage) { S.stage.destroy(); S.stage = null; }
  S.cur = null;
  $('card').hidden = true; $('mload').hidden = true; $('camNotice').hidden = true;
  $('mlayer').innerHTML = ''; $('mlayer').hidden = false;
  lastTop = '';
}
function goHome() { exitStage(); closeGift(); renderHome(); show('v1'); }
$('camExit').onclick = () => goHome();

/* 앱 전환·화면 꺼짐: 돌아오면 카메라 재시작, 진행 중 미션은 처음부터 */
document.addEventListener('visibilitychange', async () => {
  if (!S.stage || S.stage.mode !== 'ar' || S.screen !== 'cam') return;
  if (document.hidden) { S.paused = true; await S.stage.pauseAR(); return; }
  if (!S.paused) return;
  S.paused = false;
  if (S.mission && !S.mission.done) { S.stage.resetFloat(); S.mission.reset(); renderCard(); } // 떠다님도 포스터 위치 등장부터 다시
  try { await S.stage.resumeAR(); } catch (err) { console.warn(err); cameraError(err || {}); }
  updateTop();
});

/* ── V7 선물 상자 ── */
function giftInfo(id) {
  if (id === '_stampTour') {
    const g = (S.cfg.stampTour && S.cfg.stampTour.gift) || {};
    return { id, title: (g.title || '').trim() || '완주 선물', image: g.image || '', from: '스탬프 투어' };
  }
  const p = posters().find((x) => x.id === id);
  if (!p || !giftOn(p)) return null; // 사은품 없는 미션은 받은 선물·직원 확인 목록에 없다(명세 C6)
  const g = p.gift || {};
  return { id, title: (g.title || '').trim() || '선물', image: g.image || '', from: p.name || '' };
}
function receivedList() {
  return Object.entries(S.box.data.gifts).map(([id, v]) => ({ ...giftInfo(id), ...v, id }))
    .filter((x) => x.title).sort((a, b) => String(b.earnedAt).localeCompare(String(a.earnedAt)));
}
function openBoxScreen(from = 'home') {
  if (S.stage) exitStage();
  S.boxFrom = from === 'ar' ? 'ar' : 'home';
  renderBox();
  $('boxPv').hidden = !S.preview;
  show('v7');
  layoutBoxBar();
  // 휴대폰 뒤로 가기도 앱바 「뒤로」와 같은 목적지(설정 페이지 미리보기 안에서는 쓰지 않음)
  if (!EMBED && !(history.state && history.state.dv7)) { try { history.pushState({ dv7: 1 }, ''); } catch (_) {} }
}
/* 앱바 뒤로 버튼이 목적지를 보인다: 홈 = chevron 만 / AR = chevron + 「AR」. 제목이 가운데 남도록 오른쪽 칸을 같은 폭으로. */
function layoutBoxBar() {
  const ar = S.boxFrom === 'ar';
  const b = $('boxBack');
  $('boxBackTxt').hidden = !ar;
  b.classList.toggle('wide', ar);
  b.setAttribute('aria-label', ar ? 'AR 화면으로 돌아가기' : '홈으로');
  const slot = $('boxSlot');
  slot.style.minWidth = '';
  const w = Math.max(b.offsetWidth, slot.scrollWidth, 44);
  slot.style.minWidth = w + 'px';
  $('boxTtl').style.left = $('boxTtl').style.right = (w + 8) + 'px';
}
function doBoxBack() {
  if (S.boxFrom === 'ar') {
    if (S.preview) { enterPreview(Math.min(S.lastIndex || 0, Math.max(0, posters().length - 1))); return; } // 미리보기: 「인식 후」 처음부터
    if (!posters().length) { renderHome(); show('v1'); return; }
    startAR(); // V2 준비(스피너) → V3 스캔
    return;
  }
  renderHome(); show('v1');
}
window.addEventListener('popstate', () => {
  if (S.skipPop) { S.skipPop = false; return; } // 「뒤로」 버튼이 이미 처리함
  if (S.screen === 'v8') { clearInterval(S.staff.timer); S.staff.draft = ''; renderBox(); show('v7'); layoutBoxBar(); try { history.pushState({ dv7: 1 }, ''); } catch (_) {} return; }
  if (S.screen === 'v7') doBoxBack();
});
function renderBox() {
  const st = S.cfg.stampTour;
  let html = '';
  if (st && st.enabled) {
    const mp = missionPosters();
    const M = mp.filter((p) => S.box.has(p.id)).length, N = mp.length;
    html += `<div class="shead" style="margin-top:8px;margin-bottom:4px"><span class="md w6">스탬프 투어</span><span class="md w6 num">${M} / ${N}</span></div>` +
      `<p class="sm t2">포스터 ${N}개 중 ${M}개 완료</p><div class="prog" style="margin-top:8px"><i style="width:${N ? Math.round(M / N * 100) : 0}%"></i></div>`;
    if (N) {
      // 행 4상태(명세 C8, D3-8): 미완료 / 완료(사은품 없음) / 수령 전 ›(누르면 그 사은품만 직원 확인) / 수령 완료
      html += '<div class="stamps">' + mp.map((p) => {
        const rec = S.box.get(p.id), done = !!rec, no = posters().indexOf(p) + 1;
        const head = `<span class="stamp${done ? ' done' : ''}" aria-hidden="true"><span class="sm w5 num">${no}</span></span><span class="snm sm w5">${esc(p.name)}</span>`;
        if (done && giftOn(p) && !rec.claimedAt) {
          return `<button class="srow press" type="button" data-claim="${esc(p.id)}" aria-label="${esc(p.name)} 사은품 수령 확인">${head}` +
            `<span class="sst sm w5">수령 전</span><svg class="i chev"><use href="#i-chevR"/></svg></button>`;
        }
        const right = !done ? '<span class="sst sm w5 t3">미완료</span>' : giftOn(p) ? '<span class="sst sm w5 ok">수령 완료</span>' : '<span class="sst sm w5 ok">완료</span>';
        return `<div class="srow">${head}${right}</div>`;
      }).join('') + '</div>';
    }
    const g = (st.gift || {});
    const sg = S.box.get('_stampTour');
    const right = sg ? (sg.claimedAt ? '<span class="ok w5">수령 완료</span>' : '<span>받음</span>') : `<span class="t3 num">${Math.max(0, N - M)}개 남음</span>`;
    html += `<div class="trow sm"><span class="ell" title="${esc(g.title || '')}">완주 선물 · ${esc((g.title || '').trim() || '완주 선물')}</span>${right.replace('<span', '<span style="flex:none"')}</div>`;
    html += '<div class="divline"></div>';
  }
  const list = receivedList();
  html += `<div class="shead" style="margin-top:${st && st.enabled ? 20 : 8}px"><span class="md w6">받은 선물 <span class="num">${list.length}</span></span></div>`;
  if (!list.length) {
    html += '<div class="empty"><p class="md w5">아직 받은 선물이 없습니다</p><p class="sm t2" style="margin-top:4px">사은품이 있는 미션을 완료하면 여기에 담깁니다.</p></div>';
  } else {
    html += list.map((g) => `<div class="grow"><img class="gthumb" alt="" data-fb="${g.image ? 0 : 1}" src="${esc(g.image || GIFT_BOX)}" onerror="__giftImgErr(this)">` +
      `<div class="mid"><div class="md w5 ell${g.claimedAt ? ' t2' : ''}" title="${esc(g.title)}">${esc(g.title)}</div><div class="xs t3 num gfrom"><span class="gname" title="${esc(g.from)}">${esc(g.from)}</span><span class="gdate">&nbsp;· ${stamp(g.earnedAt)}</span></div></div>` +
      `<div class="st">${g.claimedAt ? `<div class="sm w5 ok">수령 완료</div><div class="xs t3 num">${stamp(g.claimedAt)}</div>` : '<div class="sm w5">수령 전</div>'}</div></div>`).join('');
  }
  $('boxBody').innerHTML = html;
  $('boxBody').querySelectorAll('[data-claim]').forEach((b) => { b.onclick = () => openStaff(b.dataset.claim); });
  const pending = list.filter((g) => !g.claimedAt).length;
  $('boxStaff').disabled = !pending;
  $('boxNote').hidden = !!pending;
}
// 탭 처리 안에서 바로 이동한다(아이폰 방향 센서 권한 요청은 사용자 탭 안에서만 허용됨). 쌓아 둔 기록만 조용히 되돌린다.
$('boxBack').onclick = () => { if (!EMBED && history.state && history.state.dv7) { S.skipPop = true; history.back(); } doBoxBack(); };
$('boxStaff').onclick = () => openStaff();

/* ── V8 직원 확인 ── */
/* one = 스탬프 행에서 들어온 그 사은품 하나(포스터 id) — 코드가 맞으면 목록 단계 없이 바로 수령 완료(명세 C8) */
function openStaff(one) {
  const sf = S.staff;
  sf.step = 1; sf.err = false; sf.show = false;
  sf.one = typeof one === 'string' ? one : null;
  renderStaff();
  show('v8');
  setTimeout(() => focusEl($('staffCode')), 50);
}
function lockLeft() { return Math.max(0, Math.ceil((S.staff.lockUntil - Date.now()) / 1000)); }
function renderStaff() {
  const sf = S.staff, body = $('staffBody'), ok = $('staffOk');
  clearInterval(sf.timer);
  if (sf.step === 1) {
    const left = lockLeft();
    const locked = left > 0;
    const oneInfo = sf.one ? giftInfo(sf.one) : null;
    body.innerHTML = (oneInfo ? `<div class="kv one"><span class="k">선물</span><span>${esc(oneInfo.title)}</span></div>` : '') +
      `<label class="flabel" for="staffCode">직원 코드</label>` +
      `<div class="finput${sf.err && !locked ? ' error' : ''}${locked ? ' dis' : ''}"><input id="staffCode" type="${sf.show ? 'text' : 'password'}" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="32" ${locked ? 'disabled' : ''}>` +
      `<button class="abtn text" id="staffShow" type="button" ${locked ? 'disabled' : ''}>${sf.show ? '숨기기' : '보기'}</button></div>` +
      (locked ? `<p class="fhelp t2 num" id="staffLock">${left}초 뒤에 다시 입력할 수 있어요</p>`
        : sf.err ? '<p class="fhelp err">코드가 맞지 않아요</p>' : '<p class="fhelp t3">부스 직원이 입력합니다</p>');
    const inp = $('staffCode');
    inp.value = sf.draft || '';
    ok.textContent = '확인';
    ok.disabled = locked || !inp.value;
    inp.oninput = () => { sf.draft = inp.value; ok.disabled = !inp.value || lockLeft() > 0; };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); };
    $('staffShow').onclick = () => { sf.show = !sf.show; renderStaff(); focusEl($('staffCode')); };
    if (locked) {
      sf.timer = setInterval(() => {
        const l = lockLeft();
        if (l <= 0) { sf.fails = 0; sf.err = false; renderStaff(); return; }
        if ($('staffLock')) $('staffLock').textContent = `${l}초 뒤에 다시 입력할 수 있어요`;
      }, 1000);
    }
    ok.onclick = checkStaffCode;
    return;
  }
  const items = receivedList().filter((g) => !g.claimedAt);
  body.innerHTML = `<div class="shead" style="margin-bottom:4px"><span class="md w6">수령 처리할 선물</span><span class="md w6 num">${items.length}</span></div>` +
    items.map((g) => `<button class="crow" type="button" data-id="${esc(g.id)}" role="checkbox" aria-checked="${sf.sel.has(g.id)}">` +
      `<span class="cbox${sf.sel.has(g.id) ? ' on' : ''}">${ICON('check')}</span>` +
      `<span style="flex:1;min-width:0"><span class="md w5 ell" style="display:block" title="${esc(g.title)}">${esc(g.title)}</span><span class="xs t3 num ell" style="display:block">${esc(g.from)} · ${stamp(g.earnedAt)}</span></span></button>`).join('');
  body.querySelectorAll('.crow').forEach((b) => {
    b.onclick = () => { const id = b.dataset.id; if (sf.sel.has(id)) sf.sel.delete(id); else sf.sel.add(id); renderStaff(); };
  });
  const n = items.filter((g) => sf.sel.has(g.id)).length;
  ok.textContent = `수령 완료 (${n})`;
  ok.disabled = n === 0;
  ok.onclick = () => {
    const ids = items.filter((g) => sf.sel.has(g.id)).map((g) => g.id);
    const done = S.box.claim(ids);
    toast(`${done}개를 수령 완료로 바꿨습니다`);
    sf.step = 1; sf.draft = '';
    renderBox(); show('v7');
  };
}
async function checkStaffCode() {
  const sf = S.staff;
  if (lockLeft() > 0) return;
  const code = ($('staffCode').value || '').trim();
  if (!code) return;
  const want = String((S.cfg.staff && S.cfg.staff.codeHash) || '').toLowerCase();
  const got = await sha256Hex((S.cfg.projectId || '') + ':' + code);
  if (want && got === want) {
    sf.fails = 0; sf.err = false; sf.draft = '';
    if (sf.one) { // 한 개 수령: 그 사은품만 바로 수령 완료 → V7
      S.box.claim([sf.one]);
      sf.one = null;
      toast('수령 완료로 바꿨습니다');
      renderBox(); show('v7'); layoutBoxBar();
      return;
    }
    sf.step = 2;
    sf.sel = new Set(receivedList().filter((g) => !g.claimedAt).map((g) => g.id));
    renderStaff();
    return;
  }
  sf.fails++;
  sf.err = true;
  sf.draft = '';
  if (sf.fails >= 5) sf.lockUntil = Date.now() + 30000;
  renderStaff();
}
$('staffBack').onclick = () => { clearInterval(S.staff.timer); S.staff.draft = ''; renderBox(); show('v7'); };

window.__ar.missionGuide = missionGuide;
window.__ar.center = () => S.stage && S.stage.centerClient();
boot();
