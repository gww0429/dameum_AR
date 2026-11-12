/* 메인 색 파생값 (관람객 웹앱 디자인 규칙 AR1.4 3-3 함수 (A)~(E) + 경계선 규칙)
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

/* v3: 버튼·글자 기준 색(rep)은 배경 그림이 있으면 그 그림의 아래 띠 색(프리셋 대표색 / 홈 이미지 블러 평균색), 없으면 배경색.
   --a-home-bg 는 언제나 운영자 배경색(그림을 읽기 전·실패 때 바탕). */
export function applyHomeTheme(bgHex, mainHex, el = document.documentElement, repHex = null) {
  const bg = validHex(bgHex) ? bgHex.trim().toUpperCase() : DEFAULT_HOME_BG;
  const t = deriveHome(validHex(repHex) ? repHex : bg, mainHex), r = el.style;
  r.setProperty('--a-home-bg', bg);
  r.setProperty('--a-home-text', t.text);
  r.setProperty('--a-home-solid', t.solid);
  r.setProperty('--a-home-on', t.on);
  r.setProperty('--a-home-press', t.press);
  return t;
}

/* 프리셋 대표색 = 각 그림의 아래 띠 색(바탕색), 디자인 지침 D3-1 */
export const PRESET_REP = {
  aurora: '#0D1628', 'aurora-light': '#F6F7FA', pollen: '#FBF7EE', stage: '#121417', rings: '#F4F5F7', light: '#0F1115', dots: '#F6F7F9'
};

/* 홈 이미지 블러 기준 색: 27×48 캔버스에 배경색을 칠하고 이미지를 cover 로 그린 뒤 아래 12줄 평균(D3-1). 실패하면 null */
export function avgBottom(url, bg) {
  return new Promise((res) => {
    if (!url) { res(null); return; }
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 27; c.height = 48;
        const x = c.getContext('2d');
        x.fillStyle = validHex(bg) ? bg : DEFAULT_HOME_BG; x.fillRect(0, 0, 27, 48);
        const sc = Math.max(27 / im.naturalWidth, 48 / im.naturalHeight), w = im.naturalWidth * sc, h = im.naturalHeight * sc;
        x.drawImage(im, (27 - w) / 2, (48 - h) / 2, w, h);
        const d = x.getImageData(0, 36, 27, 12).data;
        const s = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
        const n = d.length / 4;
        res(X(s.map((v) => Math.round(v / n))));
      } catch (_) { res(null); }
    };
    im.onerror = () => res(null);
    im.src = url;
  });
}

/* 성공 연출 색 4톤(D3-4): 메인 색 원값 · 흰색 45% 섞음 · 검정 25% 섞음 · 흰색 */
export function fxPalette(main) {
  const c = H(validHex(main) ? main.trim().toUpperCase() : DEFAULT_MAIN);
  return { main: X(c), tint: X(MIX(c, W, 0.45)), shade: X(MIX(c, K, 0.25)), white: '#FFFFFF' };
}
