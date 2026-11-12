/* 메인 색 파생값 (관람객 웹앱 디자인 규칙 AR1.3 3-3 함수 (A)~(E) + 경계선 규칙)
   index.html 과 admin.html 이 함께 쓴다. */
export const DEFAULT_MAIN = '#DE4A28';
export const DEFAULT_HOME_BG = '#FFFFFF';

const H = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const X = (a) => '#' + a.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const LUM = (a) => {
  const c = a.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const CR = (a, b) => { const p = LUM(a), q = LUM(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
const MIX = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const W = [255, 255, 255], K = [0, 0, 0], DK = H('#191F28'), OV = H('#3D3E40'), DKBG = H('#111316');

function toward(c, tg, ref, th) {
  if (CR(c, ref) >= th) return c;
  for (let i = 1; i <= 100; i++) { const m = MIX(c, tg, i / 100); if (CR(m, ref) >= th) return m; }
  return tg;
}

export function validHex(v) { return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v.trim()); }

export function derive(input) {
  const hex = validHex(input) ? input.trim().toUpperCase() : DEFAULT_MAIN;
  const c = H(hex), cW = CR(c, W), cD = CR(c, DK);
  let solid, on;
  if (Math.max(cW, cD) >= 4.5) { solid = c; on = cW >= cD ? '#FFFFFF' : '#191F28'; }
  else { on = '#FFFFFF'; solid = toward(c, K, W, 4.5); }
  const text = toward(c, K, W, 4.5), line = toward(c, K, W, 3), ov = toward(c, W, OV, 3);
  return {
    main: hex, solid: X(solid), on, text: X(text), line: X(line), ov: X(ov), subtle: X(MIX(line, W, 0.9)),
    bdLight: CR(solid, W) < 1.5 ? '#D1D6DB' : 'transparent',
    bdDark: CR(solid, DKBG) < 1.5 ? '#454B53' : 'transparent',
    adjusted: X(solid) !== hex
  };
}

export function applyTheme(hex, el = document.documentElement) {
  const t = derive(hex), r = el.style;
  r.setProperty('--a-main', t.main);
  r.setProperty('--a-main-solid', t.solid);
  r.setProperty('--a-main-on', t.on);
  r.setProperty('--a-main-text', t.text);
  r.setProperty('--a-main-line', t.line);
  r.setProperty('--a-main-ov', t.ov);
  r.setProperty('--a-main-subtle', t.subtle);
  r.setProperty('--a-solid-bd-light', t.bdLight);
  r.setProperty('--a-solid-bd-dark', t.bdDark);
  return t;
}

/* (E) 홈 바탕 파생값: 배경색 + 메인 색 → 홈 글자색, 홈 시작 버튼 바탕·글자(배경에 묻히면 흑/백 대체) */
export function deriveHome(bgInput, mainInput) {
  const bg = validHex(bgInput) ? bgInput.trim().toUpperCase() : DEFAULT_HOME_BG;
  const t = derive(mainInput), b = H(bg);
  const text = CR(b, K) >= CR(b, W) ? '#000000' : '#FFFFFF';
  const swap = CR(H(t.solid), b) < 1.5;
  const solid = swap ? text : t.solid;
  const on = swap ? (text === '#000000' ? '#FFFFFF' : '#000000') : t.on;
  const press = X(solid === '#000000' ? MIX(K, W, 0.2) : MIX(H(solid), K, 0.12));
  return { bg, text, solid, on, press, swap };
}

export function applyHomeTheme(bgHex, mainHex, el = document.documentElement) {
  const t = deriveHome(bgHex, mainHex), r = el.style;
  r.setProperty('--a-home-bg', t.bg);
  r.setProperty('--a-home-text', t.text);
  r.setProperty('--a-home-solid', t.solid);
  r.setProperty('--a-home-on', t.on);
  r.setProperty('--a-home-press', t.press);
  return t;
}
