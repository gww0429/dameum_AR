/* 공통 이미지 편집기 (GrowSpace DS 12-F-11, 명세 v2 R7) — 설정 페이지 전용
   규격 비율 틀에 맞춰 끌기·확대(슬라이더·휠)·방향키로 배치하고, 배경(투명/색)을 골라 규격 픽셀로 출력한다.
   DOM 도우미(h, btn, iconBtn, icon, help, seg, colorField)는 admin.js 에서 넘겨받아 같은 컴포넌트를 쓴다. */
const KB = 1024, MB = 1024 * 1024;
export const SRC_MAX = 20 * MB; // 편집기에 넣을 수 있는 원본: JPG·PNG 20MB 이하

/* 규격 (명세 v2 7-2) */
export const IMG_SPECS = {
  home: { key: 'home', title: '홈 이미지 편집', rw: 3, rh: 4, w: 1080, h: 1440, pngOnly: false, max: 1.5 * MB, maxTxt: '1.5MB',
    desc: '3:4 · 출력 1080×1440 · 투명 PNG / 색 JPG · 최대 1.5MB', line: '3:4 · 1080×1440 · PNG·JPG' },
  gift: { key: 'gift', title: '사은품 이미지 편집', rw: 1, rh: 1, w: 800, h: 800, pngOnly: false, max: 500 * KB, maxTxt: '500KB',
    desc: '1:1 · 출력 800×800 · 투명 PNG / 색 JPG · 최대 500KB', line: '1:1 · 800×800 · PNG·JPG' },
  icon: { key: 'icon', title: '아이콘 편집', rw: 1, rh: 1, w: 256, h: 256, pngOnly: true, max: 200 * KB, maxTxt: '200KB',
    desc: '1:1 · 출력 256×256 · PNG · 최대 200KB', line: '1:1 · 256×256 · PNG · 투명 배경 권장' }
};

const WORK_W = 672, WORK_H = 400, WORK_PAD = 32;
const Z_MIN = 1, Z_MAX = 4;
const sizeTxt = (b) => (b >= MB ? (b / MB).toFixed(1) + 'MB' : Math.max(1, Math.round(b / KB)) + 'KB');
const clampZ = (z) => Math.min(Z_MAX, Math.max(Z_MIN, z));

/* Blob·URL → 디코딩된 이미지. 읽지 못하면 reject */
export function decodeImage(src) {
  return new Promise((res, rej) => {
    const isBlob = typeof Blob !== 'undefined' && src instanceof Blob;
    const url = isBlob ? URL.createObjectURL(src) : src;
    const im = new Image();
    im.onload = () => {
      if (!im.naturalWidth || !im.naturalHeight) { if (isBlob) URL.revokeObjectURL(url); rej(new Error('이미지를 읽지 못했습니다')); return; }
      im._src = url; im._own = isBlob;
      res(im);
    };
    im.onerror = () => { if (isBlob) URL.revokeObjectURL(url); rej(new Error('이미지를 읽지 못했습니다')); };
    im.src = url;
  });
}

const canvasBlob = (cv, type, q) => new Promise((res) => cv.toBlob((b) => res(b), type, q));

/* 틀(frame) 안을 규격 출력 픽셀로 그린다 */
async function render(spec, img, geo, bg) {
  const cv = document.createElement('canvas');
  cv.width = spec.w; cv.height = spec.h;
  const g = cv.getContext('2d');
  const color = bg.mode === 'c';
  if (color) { g.fillStyle = bg.color; g.fillRect(0, 0, cv.width, cv.height); }
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const k = spec.w / geo.fw;
  g.drawImage(img, (geo.x - geo.fx) * k, (geo.y - geo.fy) * k, geo.w * k, geo.h * k);
  // 아이콘(③)은 언제나 PNG, 사은품·홈(①②)은 투명 = PNG / 색 = JPG(품질 0.9 → 최저 0.6)
  if (spec.pngOnly || !color) {
    const b = await canvasBlob(cv, 'image/png');
    return { blob: b, fmt: 'png' };
  }
  let b = null;
  for (let q = 0.9; q >= 0.6 - 1e-9; q -= 0.1) {
    b = await canvasBlob(cv, 'image/jpeg', Math.round(q * 10) / 10);
    if (b && b.size <= spec.max) break;
  }
  return { blob: b, fmt: 'jpg' };
}

/* 편집기 열기. place = {z, ox, oy}(마지막 배치), bg = {mode:'t'|'c', color}.
   onApply(blob, {w, h, fmt, place, bg}) 가 끝나면 닫힌다. 취소·닫기·Esc 는 아무것도 저장하지 않는다. */
export function openImageEditor({ spec, img, place, bg, ui, onApply, onCancel }) {
  const { h, btn, iconBtn, icon, help, seg, colorField } = ui;
  const fh = WORK_H - WORK_PAD * 2;
  let fw = Math.round(fh * spec.rw / spec.rh);
  let fhh = fh;
  if (fw > WORK_W - WORK_PAD * 2) { fw = WORK_W - WORK_PAD * 2; fhh = Math.round(fw * spec.rh / spec.rw); }
  const F = { x: (WORK_W - fw) / 2, y: (WORK_H - fhh) / 2, w: fw, h: fhh };
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const base = Math.min(F.w / iw, F.h / ih); // 100% = 이미지 전체가 틀 안에 들어가는 배율(contain)
  const st = {
    z: clampZ(Number(place && place.z) || 1), ox: Number(place && place.ox) || 0, oy: Number(place && place.oy) || 0,
    bgMode: bg && bg.mode === 'c' ? 'c' : 't', bgColor: (bg && bg.color) || '#FFFFFF', busy: false, err: ''
  };
  const geo = () => {
    const s = base * st.z, w = iw * s, hh = ih * s;
    return { s, w, h: hh, x: F.x + (F.w - w) / 2 + st.ox, y: F.y + (F.h - hh) / 2 + st.oy, fx: F.x, fy: F.y, fw: F.w };
  };

  /* ── 작업 영역 ── */
  const frameBg = h('div', { class: 'ie-fbg', style: `left:${F.x}px;top:${F.y}px;width:${F.w}px;height:${F.h}px` });
  const pic = h('img', { class: 'ie-pic', alt: '', draggable: 'false', src: img._src || img.src });
  pic.style.width = iw + 'px'; pic.style.height = ih + 'px';
  const mask = (css) => h('div', { class: 'ie-mask', style: css });
  const work = h('div', { class: 'ie-work', tabindex: '0', role: 'application', 'aria-label': '이미지 위치. 끌거나 방향키로 옮기고, 휠로 확대합니다' },
    frameBg, pic,
    mask(`left:0;top:0;right:0;height:${F.y}px`), mask(`left:0;bottom:0;right:0;height:${WORK_H - F.y - F.h}px`),
    mask(`left:0;top:${F.y}px;width:${F.x}px;height:${F.h}px`), mask(`right:0;top:${F.y}px;width:${WORK_W - F.x - F.w}px;height:${F.h}px`),
    h('div', { class: 'ie-line', style: `left:${F.x}px;top:${F.y}px;width:${F.w}px;height:${F.h}px` }));

  /* ── 확대 줄 ── */
  const range = h('input', { type: 'range', min: '100', max: '400', step: '1', 'aria-label': '확대' });
  const fill = h('i'), knob = h('b');
  const pct = h('span', { class: 'ie-pct num' });
  const zOut = iconBtn('minus', () => setZ(st.z - 0.1), '축소', { size: 's24' });
  const zIn = iconBtn('plus', () => setZ(st.z + 0.1), '확대', { size: 's24' });
  const fitBtn = btn('가운데 맞춤', () => { st.z = 1; st.ox = 0; st.oy = 0; st.err = ''; draw(); }, { kind: 'ghost', size: 'sm' });
  const zoomRow = h('div', { class: 'ie-row' }, h('span', { class: 'ie-k' }, '확대'), zOut,
    h('div', { class: 'slider ie-slider' }, h('div', { class: 'track' }, fill, knob, range)), zIn, pct, fitBtn);

  /* ── 배경 줄 ── */
  const segHost = h('span');
  const colorHost = h('span', { class: 'ie-color' });
  const cf = colorField(st.bgColor, (v) => { st.bgColor = v; st.err = ''; draw(); }, { plain: true, sm: true, fallback: '#FFFFFF', label: '배경' });
  colorHost.append(cf);
  const jpgNote = h('span', { class: 'ie-note' }, 'JPG로 저장됩니다');
  const bgRow = h('div', { class: 'ie-row' }, h('span', { class: 'ie-k' }, '배경'), segHost, colorHost, jpgNote);
  const msg = h('div', { class: 'ie-msg' });

  const applyBtn = btn('적용', () => apply(), { kind: 'primary' });
  const cancelBtn = btn('취소', () => close(true));
  const foot = h('div', { class: 'mf' }, cancelBtn, applyBtn);
  const modal = h('div', { class: 'modal lg ie', role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title },
    h('div', { class: 'mh' }, h('div', null, h('h2', { class: 'f-lg' }, spec.title), h('p', { class: 'd num' }, spec.desc)),
      iconBtn('x', () => close(true), '닫기')),
    h('div', { class: 'mb' }, work, zoomRow, bgRow, msg), foot);
  const scrim = h('div', { class: 'mscrim' }, modal); // 바깥 클릭으로는 닫지 않는다

  function draw() {
    const g = geo();
    pic.style.transform = `translate(${g.x}px, ${g.y}px) scale(${g.s})`;
    const z100 = Math.round(st.z * 100);
    range.value = String(z100);
    const p = (z100 - 100) / 300 * 100;
    fill.style.width = p + '%'; knob.style.left = p + '%';
    pct.textContent = z100 + '%';
    zOut.disabled = st.busy || st.z <= Z_MIN + 1e-6; zIn.disabled = st.busy || st.z >= Z_MAX - 1e-6;
    const color = st.bgMode === 'c';
    frameBg.classList.toggle('chk', !color);
    frameBg.style.background = color ? st.bgColor : '';
    segHost.replaceChildren(seg([['t', '투명'], ['c', '색']], st.bgMode, (v) => { st.bgMode = v; st.err = ''; draw(); }, { label: '배경' }));
    segHost.firstChild.classList.add('sm');
    colorHost.hidden = !color;
    jpgNote.hidden = !(color && !spec.pngOnly);
    // 틀 안 실제 원본 픽셀이 출력보다 작으면 경고(적용은 막지 않음). 오류가 있으면 오류 한 줄만.
    const inW = Math.round(F.w / g.s), inH = Math.round(F.h / g.s);
    if (st.err) msg.replaceChildren(help(st.err, 'error'));
    else if (inW < spec.w || inH < spec.h) msg.replaceChildren(help(`작은 이미지라 흐리게 보일 수 있습니다 · 틀 안 ${inW}×${inH}px`, 'warn'));
    else msg.replaceChildren();
    [range, fitBtn].forEach((b) => { b.disabled = st.busy; });
    work.classList.toggle('busy', st.busy);
  }
  function setZ(z, cx, cy) {
    if (st.busy) return;
    const nz = clampZ(z);
    if (cx != null) { // 커서 위치 기준 확대: 커서 아래 원본 점이 그대로 남게
      const g = geo(), u = (cx - g.x) / g.s, v = (cy - g.y) / g.s;
      const s2 = base * nz, w2 = iw * s2, h2 = ih * s2;
      st.ox = cx - u * s2 - F.x - (F.w - w2) / 2;
      st.oy = cy - v * s2 - F.y - (F.h - h2) / 2;
    }
    st.z = nz; st.err = '';
    draw();
  }
  range.addEventListener('input', () => setZ(Number(range.value) / 100));
  work.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = work.getBoundingClientRect();
    setZ(st.z * Math.exp(-e.deltaY / 600), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  work.addEventListener('pointerdown', (e) => {
    if (st.busy || e.button !== 0) return;
    drag = { x: e.clientX - st.ox, y: e.clientY - st.oy };
    work.classList.add('drag');
    try { work.setPointerCapture(e.pointerId); } catch (_) {}
    work.focus({ preventScroll: true });
  });
  work.addEventListener('pointermove', (e) => { if (!drag) return; st.ox = e.clientX - drag.x; st.oy = e.clientY - drag.y; st.err = ''; draw(); });
  const endDrag = () => { drag = null; work.classList.remove('drag'); };
  work.addEventListener('pointerup', endDrag);
  work.addEventListener('pointercancel', endDrag);
  work.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || st.busy) return;
    e.preventDefault();
    const m = e.shiftKey ? 10 : 1; // 화면 픽셀 기준 1px / Shift 10px
    st.ox += d[0] * m; st.oy += d[1] * m; st.err = '';
    draw();
  });
  const onKey = (e) => { if (e.key === 'Escape' && !st.busy && !document.querySelector('.mscrim.top')) { e.preventDefault(); close(true); } };
  document.addEventListener('keydown', onKey);

  function close(cancelled) {
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    if (img._own && img._src) URL.revokeObjectURL(img._src);
    if (cancelled && onCancel) onCancel();
  }
  async function apply() {
    if (st.busy) return;
    st.busy = true; st.err = '';
    applyBtn.disabled = true; cancelBtn.disabled = true;
    applyBtn.replaceChildren(h('span', { class: 'spin14' }), '적용 중…');
    draw();
    let out = null;
    try { out = await render(spec, img, geo(), { mode: st.bgMode, color: st.bgColor }); } catch (err) { console.warn(err); }
    const fail = (m) => { st.busy = false; st.err = m; applyBtn.disabled = false; cancelBtn.disabled = false; applyBtn.replaceChildren('적용'); draw(); };
    if (!out || !out.blob) { fail('이미지를 만들지 못했습니다'); return; }
    if (out.blob.size > spec.max) {
      fail(`${sizeTxt(out.blob.size)} — 최대 ${spec.maxTxt}를 넘습니다. ${spec.pngOnly ? '' : '배경을 색으로 바꾸거나 '}더 단순한 이미지를 써 주세요`);
      return;
    }
    try {
      await onApply(out.blob, { w: spec.w, h: spec.h, fmt: out.fmt, place: { z: st.z, ox: st.ox, oy: st.oy }, bg: { mode: st.bgMode, color: st.bgColor } });
    } catch (err) { console.warn(err); fail('저장하지 못했습니다'); return; }
    close(false);
  }

  document.body.append(scrim);
  draw();
  work.focus({ preventScroll: true });
  return { close: () => close(true), state: st, frame: F };
}
