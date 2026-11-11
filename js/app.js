/* dameum_AR 관람객 웹앱: 화면 전환, 홈, AR 흐름, 사은품 모달, 선물 상자, 직원 수령
   미리보기: ?preview=<포스터번호|home|box>  &reset=1 (미리보기 저장소 비움)  &embed=1 (설정 페이지 iframe, postMessage 로 설정 받음) */
import { applyTheme } from './theme.js';
import { openBox, sha256Hex } from './storage.js';
import * as haptics from './haptics.js';
import { Stage } from './ar.js';
import { createMission, missionGuide } from './missions.js';
import { openPlacer, closePlacer } from './placer.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const PV = Q.get('preview');
const EMBED = Q.get('embed') === '1';
const S = {
  cfg: null, box: null, preview: PV !== null || EMBED, screen: null, stage: null, stageBoot: false,
  cur: null, mission: null, cardOpen: true, descMore: false, repeat: false, sensorDenied: false,
  staff: { step: 1, fails: 0, lockUntil: 0, show: false, sel: new Set(), err: false, timer: 0 },
  giftOk: null, paused: false, embedScene: null
};
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

/* ── 화면 전환 ── */
const SCREENS = ['v0', 'v1', 'v2', 'cam', 'v6', 'v7', 'v8'];
function show(id) {
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  S.screen = id;
  $('stage').hidden = !(id === 'cam' || (id === 'v2' && S.stageBoot));
  document.body.classList.toggle('cam-on', id === 'cam' || id === 'v2' || id === 'v6');
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
    cfg = await r.json();
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
  cfg.home = cfg.home || {};
  applyTheme(cfg.home.mainColor);
  document.title = (cfg.home.title || '').trim() || 'AR 전시';
  const pid = cfg.projectId || 'unknown';
  if (!S.box || S.box.pid !== pid) {
    S.box = openBox(pid, { preview: S.preview, reset: S.preview && Q.get('reset') === '1' && !S.didReset });
    S.box.pid = pid;
    S.didReset = true;
  }
}

function route(pv) {
  if (pv === 'box') { openBoxScreen(); return; }
  const n = parseInt(pv, 10);
  if (Number.isFinite(n) && n >= 1 && n <= posters().length) { enterPreview(n - 1); return; }
  renderHome(); show('v1');
}

/* ── 설정 페이지 미리보기 (postMessage) ── */
function onEmbedMessage(e) {
  const d = e.data;
  if (!d || d.type !== 'dameum:config' || !d.config) return;
  const prevScene = S.embedScene;
  init(d.config);
  const sc = d.scene || { kind: 'home' };
  S.embedScene = sc;
  if (sc.kind === 'found' || sc.kind === 'gift') {
    const i = Math.max(0, Math.min(posters().length - 1, (sc.poster || 1) - 1));
    if (!posters().length) { renderHome(); show('v1'); return; }
    if (S.stage && S.stage.mode === 'preview' && S.screen !== 'v1') refreshPreviewPoster(i, prevScene);
    else enterPreview(i);
    closeGift();
    if (sc.kind === 'gift') previewGiftSheet();
    return;
  }
  closeGift();
  if (S.stage) exitStage();
  if (sc.kind === 'box') openBoxScreen(); else { renderHome(); show('v1'); }
}
function refreshPreviewPoster(i, prevScene) {
  const p = posters()[i];
  const prev = S.cur && S.cur.poster;
  S.stage.setPosters(posters());
  if (!S.cur || S.cur.index !== i || !prev || prev.model !== p.model || prev.id !== p.id) {
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
function previewGiftSheet() {
  const p = S.cur && S.cur.poster;
  if (!p) return;
  showGift({ head: '미션 완료', gift: p.gift || {}, onOk: closeGift });
}

/* ── V1 홈 ── */
function setImg(img, src) {
  if (!src) { img.hidden = true; img.removeAttribute('src'); return; }
  img.onerror = () => { img.hidden = true; };
  img.onload = () => { img.hidden = false; };
  if (img.getAttribute('src') !== src) img.src = src; else img.hidden = !img.complete || !img.naturalWidth;
}
function giftCount() { return Object.keys(S.box.data.gifts).filter((k) => k === '_stampTour' || posters().some((p) => p.id === k)).length; }
function renderHome() {
  const h = S.cfg.home;
  setImg($('homeLogo'), (h.logo || '').trim());
  setImg($('homeHero'), (h.heroImage || '').trim());
  $('homeTitle').textContent = (h.title || '').trim() || 'AR 전시';
  const intro = (h.intro || '').trim();
  $('homeIntro').textContent = intro; $('homeIntro').hidden = !intro;
  const list = posters();
  const showList = h.showPosterList !== false && list.length > 0;
  $('homeList').hidden = !showList;
  if (showList) {
    const mp = missionPosters();
    $('homeListCount').textContent = mp.length ? `${mp.filter((p) => S.box.has(p.id)).length} / ${mp.length} 완료` : '';
    $('homeRows').innerHTML = list.map((p) =>
      `<div class="prow">${p.image ? `<img class="thumb" alt="" src="${esc(p.image)}" onerror="this.style.visibility='hidden'">` : '<span class="thumb"></span>'}` +
      `<span class="nm md w5 ell" title="${esc(p.name)}">${esc(p.name)}</span>` +
      `${S.box.has(p.id) && p.mission && p.mission.type !== 'none' ? '<span class="sm w5 ok">완료</span>' : ''}</div>`).join('');
  }
  const n = giftCount();
  $('homeBoxN').textContent = n; $('homeBoxN').hidden = n < 1;
  const ready = list.length > 0;
  $('homeStart').disabled = !ready;
  $('homeStartTxt').textContent = (h.startLabel || '').trim() || 'AR 시작하기';
  $('homeNote').textContent = ready ? '카메라를 사용합니다. 영상은 저장되지 않습니다.' : '준비 중인 행사입니다';
}
$('homeStart').onclick = () => startAR();
$('homeBox').onclick = () => openBoxScreen();

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
    frame: () => onFrame()
  };
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
  S.stage.setPreviewPoster(posters()[i].image);
  S.stage.resizePreview();
  onFound(i);
}

function onFound(i) {
  haptics.short();
  if (S.cur && S.cur.index === i) { S.stage.refound(); updateTop(); return; }
  switchPoster(i);
}
function switchPoster(i, silent) {
  if (S.mission) { S.mission.destroy(); S.mission = null; }
  const p = posters()[i];
  S.cur = { index: i, poster: p, ready: false };
  S.cardOpen = true; S.descMore = false; S.repeat = false;
  $('card').hidden = true;
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
    onChange: () => updateProgress(),
    onSuccess: () => onMissionSuccess()
  });
  S.mission.setup();
  renderCard();
  S.stage.renderNow();
}
function onLost(i) { updateTop(); }

let lastTop = '';
function updateTop() {
  const vis = !!(S.cur && S.stage && (S.stage.visible() || !S.cur.ready));
  const name = S.cur ? (S.cur.poster.name || '') : '';
  const key = (vis ? 1 : 0) + name;
  const scanOn = !S.cur || !vis;
  $('scanUi').hidden = !scanOn;
  $('scanUi').querySelector('.guide').hidden = !!S.cur;
  if (key === lastTop) return;
  lastTop = key;
  const chip = $('camState');
  chip.classList.toggle('dim', !vis);
  chip.querySelector('.dot').hidden = !vis;
  $('camStateTxt').textContent = vis ? name : '포스터를 찾는 중';
  chip.title = vis ? name : '';
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

/* ── V4 설명·미션 카드 ── */
function renderCard() {
  const card = $('card');
  if (!S.cur || !S.cur.ready) { card.hidden = true; return; }
  const p = S.cur.poster, mi = S.mission;
  const type = mi ? mi.type : 'none';
  const pr = mi && !mi.done ? mi.progress() : null;
  card.hidden = false;
  card.classList.toggle('collapsed', !S.cardOpen);
  if (!S.cardOpen) {
    card.innerHTML = `<div class="handle"></div><div class="sh-top"><span class="md w6 ell" title="${esc(p.name)}">${esc(p.name)}</span>` +
      `<span class="r">${pr ? `<span class="md w6 num" id="cardProgC" aria-live="polite">${esc(pr.text)}</span>` : ''}` +
      `<button class="ib44" id="cardToggle" aria-label="펴기">${ICON('chevU')}</button></span></div>`;
    card.onclick = () => { S.cardOpen = true; renderCard(); };
    return;
  }
  card.onclick = null;
  const desc = (p.description || '').trim();
  let html = `<div class="handle"></div><div class="sh-top"><span class="md w6 ell" title="${esc(p.name)}">${esc(p.name)}</span>` +
    `<button class="ib44" id="cardToggle" aria-label="접기">${ICON('chevD')}</button></div><div class="body">`;
  if (desc) html += `<p class="desc${S.descMore ? '' : ' clamp'}" id="cardDesc">${esc(desc)}</p><button class="abtn text" id="cardMore" hidden style="margin-left:-8px">더 보기</button>`;
  if (type !== 'none') {
    html += desc ? '<div class="sep"></div>' : '<div style="height:4px"></div>';
    if (mi.done) {
      html += `<div class="mrow" style="align-items:center"><span class="md w5 ok">미션 완료</span><button class="abtn text" id="cardRetry" style="margin-right:-8px">다시 하기</button></div>`;
      if (S.repeat) html += '<p class="xs t3">선물은 이미 받았어요</p>';
    } else {
      html += `<div class="mrow"><div class="l"><div class="xs t3">미션</div><div class="md w5">${esc(mi.guide())}</div></div>` +
        (pr ? `<div class="md w6 num" id="cardProg" aria-live="polite" style="flex:none">${esc(pr.text)}</div>` : '') + '</div>';
      if (pr && pr.ratio != null) html += `<div class="prog" style="margin-top:8px"><i id="cardBar" style="width:${Math.round(pr.ratio * 100)}%"></i></div>`;
      if (type === 'quiz') html += '<div id="cardQuiz"></div>';
    }
  }
  html += `</div><button class="abtn secondary h40" id="cardPlace" style="margin-top:16px;flex:none">${ICON('cube')}내 공간에 놓기</button>`;
  card.innerHTML = html;
  $('cardToggle').onclick = (e) => { e.stopPropagation(); S.cardOpen = false; renderCard(); };
  if ($('cardQuiz')) mi.renderQuiz($('cardQuiz'));
  if ($('cardRetry')) $('cardRetry').onclick = () => { S.repeat = false; mi.reset(); renderCard(); };
  if ($('cardDesc') && !S.descMore) {
    const d = $('cardDesc');
    $('cardMore').hidden = !(d.scrollHeight > d.clientHeight + 1);
    $('cardMore').onclick = () => { S.descMore = true; renderCard(); };
  }
  $('cardPlace').onclick = () => openPlace();
}
function updateProgress() {
  if (!S.mission || !S.cur) return;
  const pr = S.mission.done ? null : S.mission.progress();
  if (!pr) return;
  if ($('cardProg')) $('cardProg').textContent = pr.text;
  if ($('cardProgC')) $('cardProgC').textContent = pr.text;
  if ($('cardBar') && pr.ratio != null) $('cardBar').style.width = Math.round(pr.ratio * 100) + '%';
}

/* ── 미션 성공 → V5 사은품 모달 ── */
function onMissionSuccess() {
  haptics.success();
  const p = S.cur.poster;
  const already = S.box.has(p.id);
  S.repeat = already;
  showGift({
    head: already ? '이미 받은 선물' : '미션 완료', gift: p.gift || {},
    onOk: () => {
      if (!already) S.box.earn(p.id);
      closeGift();
      renderCard();
      checkStampTour();
    }
  });
}
function checkStampTour() {
  const st = S.cfg.stampTour;
  if (!st || !st.enabled) return;
  const mp = missionPosters();
  if (!mp.length || S.box.has('_stampTour')) return;
  if (mp.every((p) => S.box.has(p.id))) {
    S.box.earn('_stampTour');
    showGift({ head: '스탬프 투어 완주', gift: st.gift || {}, onOk: closeGift });
  }
}
function showGift({ head, gift, onOk }) {
  const h = $('giftHead');
  h.textContent = head;
  h.style.color = head === '이미 받은 선물' ? 'var(--a-t3)' : 'var(--a-main-text)';
  $('giftTitle').textContent = (gift.title || '').trim() || '선물';
  const img = (gift.image || '').trim();
  $('giftImgBox').hidden = !img;
  if (img) { $('giftImg').src = img; $('giftImg').onerror = () => { $('giftImgBox').hidden = true; }; }
  const desc = (gift.description || '').trim();
  $('giftDesc').textContent = desc; $('giftDesc').hidden = !desc;
  const cn = (gift.claimNote || '').trim();
  $('giftClaimTxt').textContent = cn; $('giftClaim').hidden = !cn;
  $('giftNoSave').hidden = S.box.persistent;
  S.giftOk = onOk;
  $('giftScrim').hidden = false;
  $('gift').hidden = false;
  $('giftOk').focus({ preventScroll: true });
}
function closeGift() { $('giftScrim').hidden = true; $('gift').hidden = true; S.giftOk = null; }
$('giftOk').onclick = () => { const f = S.giftOk; if (f) f(); else closeGift(); };

/* ── V6 내 공간에 놓기 ── */
async function openPlace() {
  if (S.preview) { notice('미리보기에서는 실행되지 않아요'); return; }
  const p = S.cur && S.cur.poster;
  if (!p) return;
  const failed = S.cur.model && S.cur.model.failed;
  const src = p.model && !failed ? p.model : 'assets/placeholder.glb';
  if (S.mission && !S.mission.done && S.mission.pointerCancel) { /* 진행 상태는 유지 */ }
  await S.stage.pauseAR();
  $('v6Notice').hidden = true;
  show('v6');
  try {
    await openPlacer($('v6Host'), src, { onUnsupported: () => { $('v6Notice').hidden = false; } });
  } catch (err) {
    console.warn(err);
    $('v6Notice').hidden = false;
  }
}
$('v6Back').onclick = async () => {
  closePlacer($('v6Host'));
  show('cam');
  updateTop();
  try { await S.stage.resumeAR(); } catch (err) { console.warn(err); cameraError(err || {}); }
};

/* ── 종료 ── */
function exitStage() {
  if (S.mission) { S.mission.destroy(); S.mission = null; }
  if (S.stage) { S.stage.destroy(); S.stage = null; }
  S.cur = null;
  $('card').hidden = true; $('mload').hidden = true; $('camNotice').hidden = true;
  $('mlayer').innerHTML = '';
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
  if (S.mission && !S.mission.done) { S.mission.reset(); renderCard(); }
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
  if (!p) return null;
  const g = p.gift || {};
  return { id, title: (g.title || '').trim() || '선물', image: g.image || '', from: p.name || '' };
}
function receivedList() {
  return Object.entries(S.box.data.gifts).map(([id, v]) => ({ ...giftInfo(id), ...v, id }))
    .filter((x) => x.title).sort((a, b) => String(b.earnedAt).localeCompare(String(a.earnedAt)));
}
function openBoxScreen() {
  if (S.stage) exitStage();
  renderBox();
  $('boxPv').hidden = !S.preview;
  show('v7');
}
function renderBox() {
  const st = S.cfg.stampTour;
  let html = '';
  if (st && st.enabled) {
    const mp = missionPosters();
    const M = mp.filter((p) => S.box.has(p.id)).length, N = mp.length;
    html += `<div class="shead" style="margin-top:8px;margin-bottom:4px"><span class="md w6">스탬프 투어</span><span class="md w6 num">${M} / ${N}</span></div>` +
      `<p class="sm t2">포스터 ${N}개 중 ${M}개 완료</p><div class="prog" style="margin-top:8px"><i style="width:${N ? Math.round(M / N * 100) : 0}%"></i></div>`;
    if (N) {
      html += '<div class="stamps">' + mp.map((p) => {
        const done = S.box.has(p.id), no = posters().indexOf(p) + 1;
        return `<div class="srow"><span class="stamp${done ? ' done' : ''}" aria-hidden="true"><span class="sm w5 num">${no}</span></span>` +
          `<span class="snm sm w5">${esc(p.name)}</span>` +
          `<span class="sst sm w5${done ? ' ok' : ' t3'}">${done ? '완료' : '미완료'}</span></div>`;
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
    html += '<div class="empty"><p class="md w5">아직 받은 선물이 없습니다</p><p class="sm t2" style="margin-top:4px">포스터 미션을 완료하면 여기에 담깁니다.</p></div>';
  } else {
    html += list.map((g) => `<div class="grow">${g.image ? `<img class="gthumb" alt="" src="${esc(g.image)}" onerror="this.removeAttribute('src')">` : '<span class="gthumb"></span>'}` +
      `<div class="mid"><div class="md w5 ell${g.claimedAt ? ' t2' : ''}" title="${esc(g.title)}">${esc(g.title)}</div><div class="xs t3 num ell">${esc(g.from)} · ${stamp(g.earnedAt)}</div></div>` +
      `<div class="st">${g.claimedAt ? `<div class="sm w5 ok">수령 완료</div><div class="xs t3 num">${stamp(g.claimedAt)}</div>` : '<div class="sm w5">수령 전</div>'}</div></div>`).join('');
  }
  $('boxBody').innerHTML = html;
  const pending = list.filter((g) => !g.claimedAt).length;
  $('boxStaff').disabled = !pending;
  $('boxNote').hidden = !!pending;
}
$('boxBack').onclick = () => { renderHome(); show('v1'); };
$('boxStaff').onclick = () => openStaff();

/* ── V8 직원 확인 ── */
function openStaff() {
  const sf = S.staff;
  sf.step = 1; sf.err = false; sf.show = false;
  renderStaff();
  show('v8');
  setTimeout(() => { const i = $('staffCode'); if (i && !i.disabled) i.focus(); }, 50);
}
function lockLeft() { return Math.max(0, Math.ceil((S.staff.lockUntil - Date.now()) / 1000)); }
function renderStaff() {
  const sf = S.staff, body = $('staffBody'), ok = $('staffOk');
  clearInterval(sf.timer);
  if (sf.step === 1) {
    const left = lockLeft();
    const locked = left > 0;
    body.innerHTML = `<label class="flabel" for="staffCode">직원 코드</label>` +
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
    $('staffShow').onclick = () => { sf.show = !sf.show; renderStaff(); $('staffCode').focus(); };
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
