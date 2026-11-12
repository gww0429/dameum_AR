/* 미션 성공 연출 3종 (명세 C3, 디자인 지침 D3-4) — 카메라 위 2D 캔버스 1장에 코드로 그린다(외부 이미지·라이브러리 없음).
   3D 자체의 크기·투명도는 onModel(k, a) 로 넘겨 AR 무대가 그린다.
   끝나는 시점은 그리기(rAF)와 별개로 타이머로도 보장한다(앱 전환·화면 꺼짐 = 연출을 끝낸 것으로 봄). */
import { fxPalette } from './theme.js?v=3.10';

export const FX_DUR = { burst: 800, confetti: 1400, sparkle: 900 };
const REDUCED_DUR = 150;
const HALO = 'rgba(17,19,22,.56)'; // --a-halo: 흰 조각에만 1px 테두리

function rng() { let seed = (Math.random() * 2 ** 31) | 0; return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function setup(type, W, H, o, r, main) {
  const R = rng(), s = W / 390, P = fxPalette(main), parts = [];
  const pick = (w) => { const x = R(); let acc = 0; for (const [k, v] of w) { acc += v; if (x < acc) return P[k]; } return P.main; };
  if (type === 'burst') {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n + (R() - 0.5) * 0.24, v = (240 + R() * 400) * s, sz = (8 + R() * 8) * s;
      parts.push({ t0: 120, life: 600, a, v, sz, rot: R() * 6.28, spin: (R() < 0.5 ? -1 : 1) * (3 + R() * 6),
        x0: o.x + Math.cos(a) * r * 0.3, y0: o.y + Math.sin(a) * r * 0.3, c: pick([['main', 0.4], ['shade', 0.2], ['tint', 0.2], ['white', 0.2]]) });
    }
  }
  if (type === 'confetti') {
    for (let i = 0; i < 60; i++) {
      const left = i < 30, k = i % 30, ang = (6 + R() * 12) * Math.PI / 180, v = (2.2 + R() * 0.4) * H;
      parts.push({ t0: k / 30 * 120, left, vx: (left ? 1 : -1) * Math.sin(ang) * v, vy: -Math.cos(ang) * v, w: (6 + R() * 3) * s, h: (10 + R() * 4) * s,
        rot: R() * 6.28, spin: (R() < 0.5 ? -1 : 1) * (2 + R() * 4), ph: R() * 6.28, f: 1.5 + R() * 1.5,
        c: pick([['main', 0.35], ['tint', 0.25], ['shade', 0.15], ['white', 0.25]]) });
    }
  }
  if (type === 'sparkle') {
    const n = 20;
    for (let i = 0; i < n; i++) {
      const ang = R() * 6.28, d = Math.sqrt(R()) * r * 0.8;
      parts.push({ t0: i / n * 300, x0: o.x + Math.cos(ang) * d, y0: o.y + Math.sin(ang) * d, rise: (40 + R() * 50) * s, dx: (R() - 0.5) * 20 * s,
        sz: (10 + R() * 8) * s, c: R() < 0.5 ? P.white : P.tint });
    }
  }
  return { type, W, H, o, r, s, parts };
}

/* 3D 크기(k)·투명도(a) — D3-4 표 「3D」 줄 */
export function modelState(type, t, reduced) {
  if (reduced) return t < REDUCED_DUR ? { k: 1, a: 1 - t / REDUCED_DUR } : { k: 1, a: 0 };
  if (type === 'burst') {
    if (t < 120) return { k: 1 + 0.15 * (1 - Math.pow(1 - t / 120, 2)), a: 1 };
    if (t < 200) { const u = (t - 120) / 80; return { k: 1.15 * (1 - u * u), a: 1 - u }; }
    return { k: 0, a: 0 };
  }
  if (type === 'confetti') { if (t < 200) { const u = t / 200; return { k: 1 - 0.4 * u * u, a: 1 - u }; } return { k: 0, a: 0 }; }
  if (t < 400) { const u = t / 400; return { k: 1 - 0.1 * u, a: 1 - u }; }
  return { k: 0, a: 0 };
}

function frame(ctx, S, t) {
  ctx.clearRect(0, 0, S.W, S.H);
  for (const p of S.parts) {
    const u = t - p.t0;
    if (S.type === 'burst') {
      if (u < 0 || u > p.life) continue;
      const tau = 0.22, ts = u / 1000, d = p.v * tau * (1 - Math.exp(-ts / tau)), g = 380 * S.s;
      const x = p.x0 + Math.cos(p.a) * d, y = p.y0 + Math.sin(p.a) * d + 0.5 * g * ts * ts, q = u / p.life, al = q < 0.4 ? 1 : 1 - (q - 0.4) / 0.6, sz = p.sz * (1 - 0.4 * q);
      ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(p.rot + p.spin * ts); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.moveTo(0, -sz / 2); ctx.lineTo(sz / 2, sz / 2); ctx.lineTo(-sz / 2, sz / 3); ctx.closePath(); ctx.fill();
      if (p.c === '#FFFFFF') { ctx.strokeStyle = HALO; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();
    } else if (S.type === 'confetti') {
      if (u < 0 || t > 1400) continue;
      const ts = u / 1000, kx = 3, ky = 1.2, g = 2.8 * S.H;
      const x = (p.left ? 0 : S.W) + p.vx / kx * (1 - Math.exp(-kx * ts));
      const y = S.H + g / ky * ts + (p.vy - g / ky) / ky * (1 - Math.exp(-ky * ts));
      const al = t < 1000 ? 1 : 1 - (t - 1000) / 400;
      ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(p.rot + p.spin * ts); ctx.scale(1, Math.cos(p.ph + 2 * Math.PI * p.f * ts));
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      if (p.c === '#FFFFFF') { ctx.strokeStyle = HALO; ctx.lineWidth = 1; ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h); }
      ctx.restore();
    } else {
      if (u < 0 || u > 600) continue;
      const q = u / 600, e = 1 - Math.pow(1 - q, 3), x = p.x0 + p.dx * e, y = p.y0 - p.rise * e;
      const al = u < 120 ? u / 120 : (u > 300 ? 1 - (u - 300) / 300 : 1), k = u < 200 ? 0.6 + 0.4 * u / 200 : 1, R1 = p.sz / 2 * k, R2 = R1 * 0.28;
      ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? R2 : R1; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fillStyle = p.c; ctx.fill();
      if (p.c === '#FFFFFF') { ctx.strokeStyle = HALO; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.restore();
    }
  }
}

/* 연출 1회 재생. canvas = 앱 화면(카메라 위 UI 칸) 전체를 덮는 캔버스, o·r = 캔버스 좌표의 3D 중심·테두리 반지름.
   반환값: 멈춤 함수(끝난 것으로 처리). done 은 한 번만 불린다. */
export function playEffect({ canvas, type, main, o, r, reduced = false, onModel = () => {}, done = () => {} }) {
  const kind = FX_DUR[type] ? type : 'burst';
  const W = canvas.clientWidth || canvas.parentNode.clientWidth, H = canvas.clientHeight || canvas.parentNode.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const S = reduced ? null : setup(kind, W, H, o, r, main);
  const dur = reduced ? REDUCED_DUR : FX_DUR[kind];
  const t0 = performance.now();
  let over = false, timer = 0;
  canvas.hidden = false;
  const finish = () => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    ctx.clearRect(0, 0, W, H);
    canvas.hidden = true;
    onModel(0, 0);
    done();
  };
  const step = () => {
    if (over) return;
    const t = performance.now() - t0;
    if (t >= dur) { finish(); return; }
    const m = modelState(kind, t, reduced);
    onModel(m.k, m.a);
    if (S) frame(ctx, S, t);
    window.requestAnimationFrame(step);
  };
  onModel(1, 1);
  window.requestAnimationFrame(step);
  timer = setTimeout(finish, dur + 120); // 그리기가 멈춘 창(앱 전환·숨은 탭)에서도 끝난다
  return finish;
}
