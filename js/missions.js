/* 미션 6종: tap · drag · hold · rotate · find · quiz (+ none)
   판정은 입력 이벤트와 performance.now() 경과 시간으로만 한다. 화면 위치 맞추기만 그리기 주기에 맡긴다. */
import * as THREE from 'three';
import * as haptics from './haptics.js?v=2';

export const MISSION_TYPES = ['tap', 'drag', 'hold', 'rotate', 'find', 'quiz', 'none'];
/* 드래그 목표 안전 영역(화면 높이 %): 설명·미션 카드는 최대 높이 45%라 위쪽 55%만 늘 보인다.
   목표 원(지름 72)의 아래 끝까지 카드에 닿지 않도록 중심 y는 48% 이하로 제한한다. */
export const DRAG_SAFE = { cardTop: 55, yMax: 48, defX: 50, defY: 45 };
export const clampDragY = (y) => Math.max(0, Math.min(DRAG_SAFE.yMax, y));
const DIRS = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const ICON_CHECK = '<svg class="i i24"><use href="#i-check"/></svg>';
const MOVE_TAP = 12;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const fmt1 = (v) => (Math.floor(v * 10) / 10).toFixed(1);

/* 안내 문구: 운영자가 쓴 mission.guide(퀴즈·없음 제외), 비면 종류·조건값에 맞는 기본 문구 */
export function missionGuide(m) {
  const own = m && m.type !== 'quiz' && m.type !== 'none' && typeof m.guide === 'string' ? m.guide.trim() : '';
  return own || defaultGuide(m);
}
export function defaultGuide(m) {
  switch (m && m.type) {
    case 'tap': return `3D를 ${num(m.count, 5)}번 터치하세요`;
    case 'drag': return '3D를 표시된 곳으로 끌어다 놓으세요';
    case 'hold': return `3D를 ${num(m.seconds, 2)}초 동안 누르고 있으세요`;
    case 'rotate': return '3D를 돌려 숨은 표시를 찾아 누르세요';
    case 'find': return `3D 주변에 숨은 아이템 ${num(m.count, 3)}개를 찾으세요`;
    case 'quiz': return (m.question || '').trim() || '퀴즈를 풀어 보세요';
    default: return '';
  }
}

export function createMission(poster, ctx) {
  const m = poster.mission || { type: 'none' };
  const type = MISSION_TYPES.includes(m.type) ? m.type : 'none';
  const { stage, layer } = ctx;
  const st = { done: false, count: 0, ptr: null, holdAt: 0, holdTimer: 0, lastPulse: 0, inside: false, els: [], markers: [], quizPick: null, quizWrong: false };

  const lrect = () => layer.getBoundingClientRect();
  const place = (el, x, y) => { const r = lrect(); el.style.left = (x - r.left) + 'px'; el.style.top = (y - r.top) + 'px'; };
  const iconHtml = (url) => url ? `<img alt="" src="${ctx.resolve(url)}">` : ICON_CHECK;
  const changed = () => ctx.onChange && ctx.onChange();
  const win = () => {
    if (st.done) return;
    st.done = true;
    clearHold();
    changed();
    ctx.onSuccess && ctx.onSuccess();
  };

  /* ── 공통 요소 정리 ── */
  function clearEls() { st.els.forEach((e) => e.remove()); st.els = []; st.markers.forEach((mk) => stage.removeMarker(mk.obj)); st.markers = []; }

  /* ── hold ── */
  let gauge = null;
  function clearHold() {
    if (st.holdTimer) { clearInterval(st.holdTimer); st.holdTimer = 0; }
    st.holdAt = 0;
    if (gauge) gauge.hidden = true;
  }
  function holdTick() {
    if (!st.holdAt || st.done) return;
    const sec = num(m.seconds, 2);
    const el = (performance.now() - st.holdAt) / 1000;
    if (performance.now() - st.lastPulse >= 250) { st.lastPulse = performance.now(); haptics.holdPulse(); }
    drawGauge(Math.min(el, sec), sec);
    st.count = Math.min(el, sec);
    changed();
    if (el >= sec) win();
  }
  function drawGauge(el, sec) {
    if (!gauge) return;
    const C = 163.4;
    gauge.querySelector('.fill').setAttribute('stroke-dashoffset', String(C * (1 - el / sec)));
    gauge.querySelector('.v').textContent = fmt1(Math.max(0, sec - el));
  }

  /* ── 미션별 준비 ── */
  function setup() {
    clearEls();
    st.done = false; st.count = 0; st.quizPick = null; st.quizWrong = false; st.inside = false;
    if (type === 'drag') {
      const t = document.createElement('div');
      t.className = 'target';
      t.innerHTML = iconHtml(m.icon);
      const tx = Number(m.target && m.target.x), ty = Number(m.target && m.target.y);
      t.style.left = (Number.isFinite(tx) ? tx : DRAG_SAFE.defX) + '%';
      t.style.top = clampDragY(Number.isFinite(ty) ? ty : DRAG_SAFE.defY) + '%';
      layer.appendChild(t); st.els.push(t); st.target = t;
    }
    if (type === 'hold') {
      gauge = document.createElement('div');
      gauge.className = 'gauge'; gauge.hidden = true;
      gauge.innerHTML = '<svg width="64" height="64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--a-ov-track)" stroke-width="4"/>' +
        '<circle class="fill" cx="32" cy="32" r="26" fill="none" stroke="var(--a-main-ov)" stroke-width="4" stroke-dasharray="163.4" stroke-dashoffset="163.4"/></svg><span class="v">0.0</span>';
      layer.appendChild(gauge); st.els.push(gauge);
    }
    if (type === 'rotate') {
      const d = DIRS[m.marker] || DIRS.back;
      addMarker(new THREE.Vector3(...d), false);
    }
    if (type === 'find') {
      const n = Math.max(1, Math.min(10, Math.round(num(m.count, 3))));
      const backN = n >= 2 ? Math.max(1, Math.floor(n / 3)) : 0;
      for (let i = 0; i < n; i++) {
        const back = i >= n - backN;
        const a = (Math.random() * 1.4 - 0.7) * Math.PI / 2; // 둘레 각도
        const el = (Math.random() * 0.9 - 0.45);
        const z = back ? -(0.4 + Math.random() * 0.5) : (0.45 + Math.random() * 0.5);
        const v = new THREE.Vector3(Math.sin(a) * 1.1, el, z);
        addMarker(v, true);
      }
    }
    sync();
    changed();
  }
  function addMarker(dir, item) {
    if (!stage.g) return;
    const obj = stage.addMarker(dir, item ? 0.7 : 0.62);
    const b = document.createElement('button');
    b.className = 'marker' + (item ? ' item' : '');
    b.type = 'button';
    b.setAttribute('aria-label', item ? '숨은 아이템' : '숨은 표시');
    b.innerHTML = iconHtml(m.icon);
    const mk = { obj, el: b, item };
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (st.done) return;
      const ang = stage.markerAngle(obj);
      if (item) {
        if (ang > 100) return;
        haptics.short();
        stage.removeMarker(obj); b.remove();
        st.markers = st.markers.filter((x) => x !== mk);
        st.count++;
        changed();
        if (st.count >= num(m.count, 3)) win();
      } else if (ang <= 25) {
        win();
      }
    });
    layer.appendChild(b);
    st.markers.push(mk); st.els.push(b);
  }

  /* 화면 위치 맞추기 (그리기 주기·입력 직후) */
  function sync() {
    const vis = stage.visible();
    st.markers.forEach((mk) => {
      if (!vis) { mk.el.hidden = true; return; }
      const ang = stage.markerAngle(mk.obj);
      const c = stage.markerClient(mk.obj);
      mk.el.hidden = !c || ang > (mk.item ? 100 : 90);
      if (c) place(mk.el, c.x, c.y);
      if (!mk.item) mk.el.classList.toggle('ready', ang <= 25);
    });
  }

  /* ── 입력 ── */
  function down(e) {
    if (st.done || type === 'none' || type === 'quiz') return;
    st.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), hit: false, moved: false };
    const hit = stage.hitModel(e.clientX, e.clientY);
    st.ptr.hit = hit;
    if (type === 'drag' && hit) { stage.beginDrag(e.clientX, e.clientY); st.dragging = true; }
    if (type === 'hold' && hit) {
      st.holdAt = performance.now(); st.lastPulse = st.holdAt; haptics.holdPulse();
      if (gauge) { gauge.hidden = false; place(gauge, e.clientX - 32, e.clientY - 72 - 64); drawGauge(0, num(m.seconds, 2)); }
      st.holdTimer = setInterval(holdTick, 50);
    }
  }
  function move(e) {
    const p = st.ptr;
    if (!p || p.id !== e.pointerId || st.done) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TAP) p.moved = true;
    if (type === 'drag' && st.dragging) {
      stage.dragTo(e.clientX, e.clientY);
      const c = stage.dragCenterClient();
      const tr = st.target.getBoundingClientRect();
      const inside = !!c && Math.hypot(c.x - (tr.left + tr.width / 2), c.y - (tr.top + tr.height / 2)) <= tr.width / 2;
      if (inside && !st.inside) haptics.short();
      st.inside = inside;
      st.target.classList.toggle('hit', inside);
    }
    if ((type === 'rotate' || type === 'find') && !p.holdOnly) {
      stage.rotateBy(e.clientX - p.lx, e.clientY - p.ly);
      sync();
    }
    p.lx = e.clientX; p.ly = e.clientY;
  }
  function up(e) {
    const p = st.ptr;
    if (!p || p.id !== e.pointerId) return;
    st.ptr = null;
    if (st.done) return;
    if (type === 'tap' && !p.moved && p.hit) {
      haptics.tick();
      st.count++;
      changed();
      if (st.count >= num(m.count, 5)) win();
    }
    if (type === 'drag' && st.dragging) {
      st.dragging = false;
      if (st.inside) { stage.endDrag(true); win(); }
      else { stage.endDrag(false); st.target.classList.remove('hit'); }
      st.inside = false;
    }
    if (type === 'hold' && st.holdAt) {
      const el = (performance.now() - st.holdAt) / 1000;
      if (el >= num(m.seconds, 2)) win();
      else { clearHold(); st.count = 0; changed(); }
    }
  }
  function cancel(e) {
    const p = st.ptr;
    if (!p || p.id !== e.pointerId) return;
    st.ptr = null;
    if (type === 'hold' && !st.done) { clearHold(); st.count = 0; changed(); }
    if (type === 'drag' && st.dragging) { st.dragging = false; stage.endDrag(false); st.target.classList.remove('hit'); st.inside = false; }
  }

  /* ── 진행 표시 (카드 오른쪽 숫자 + 막대) ── */
  function progress() {
    switch (type) {
      case 'tap': { const n = num(m.count, 5); return { text: `${Math.min(st.count, n)} / ${n}`, ratio: Math.min(st.count, n) / n }; }
      case 'drag': return { text: `${st.done ? 1 : 0} / 1`, ratio: null };
      case 'hold': { const s = num(m.seconds, 2); return { text: `${fmt1(st.done ? s : st.count)} / ${s}초`, ratio: (st.done ? s : st.count) / s }; }
      case 'rotate': return { text: `${st.done ? 1 : 0} / 1`, ratio: null };
      case 'find': { const n = Math.max(1, Math.min(10, Math.round(num(m.count, 3)))); return { text: `${Math.min(st.count, n)} / ${n}`, ratio: Math.min(st.count, n) / n }; }
      default: return null;
    }
  }

  /* ── 퀴즈 (카드 안) ── */
  function renderQuiz(box) {
    box.innerHTML = '';
    if (type !== 'quiz' || st.done) return;
    const wrap = document.createElement('div');
    wrap.className = 'quiz';
    const ox = m.mode === 'ox';
    const opts = ox ? ['O', 'X'] : (Array.isArray(m.options) ? m.options : []).slice(0, 4);
    const answer = Number(m.answer) || 0;
    const list = document.createElement('div');
    list.className = ox ? 'ox' : 'opts';
    opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (ox) { b.className = 'abtn secondary'; b.textContent = o; }
      else { b.className = 'opt'; b.innerHTML = '<span class="rd"></span><span></span>'; b.lastChild.textContent = o; }
      if (st.quizPick === i) { b.classList.add(st.quizWrong ? 'wrong' : 'on'); }
      b.addEventListener('click', () => {
        if (st.done) return;
        st.quizPick = i;
        if (i === answer) { st.quizWrong = false; haptics.short(); renderQuiz(box); win(); }
        else { st.quizWrong = true; renderQuiz(box); }
      });
      list.appendChild(b);
    });
    wrap.appendChild(list);
    if (st.quizWrong) {
      const msg = document.createElement('p');
      msg.className = 'sm err qmsg';
      msg.textContent = '다시 생각해 보세요';
      wrap.appendChild(msg);
    }
    box.appendChild(wrap);
  }

  return {
    type,
    get done() { return st.done; },
    guide: () => missionGuide({ ...m, type }),
    progress, renderQuiz, sync, setup,
    pointerDown: down, pointerMove: move, pointerUp: up, pointerCancel: cancel,
    reset() { clearHold(); if (st.dragging) { st.dragging = false; stage.endDrag(false); } setup(); },
    destroy() { clearHold(); clearEls(); gauge = null; st.target = null; }
  };
}
