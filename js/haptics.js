/* 진동(햅틱)
   Android: navigator.vibrate(패턴)
   iOS 18+: 화면 밖에 둔 <label><input type="checkbox" switch></label> 라벨을 프로그램으로 눌러 짧은 "톡"
   둘 다 안 되면 아무것도 하지 않는다. 호출 기록은 window.__haptics (테스트용). */
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let label = null;

function ensureSwitch() {
  if (label || !isIOS) return label;
  try {
    label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
  } catch (_) { label = null; }
  return label;
}

const log = (window.__haptics = window.__haptics || []);

function fire(name, pattern) {
  log.push({ name, at: Math.round(performance.now()) });
  if (log.length > 200) log.shift();
  try {
    if (!isIOS && typeof navigator.vibrate === 'function') {
      // 사용자 탭 전 호출은 브라우저가 막으므로 시도하지 않는다
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      navigator.vibrate(pattern);
      return;
    }
    const l = ensureSwitch();
    if (l) l.click();
  } catch (_) { /* 조용히 무시 */ }
}

export const tick = () => fire('tick', 10);          // 터치 1회
export const short = () => fire('short', 30);        // 포스터 인식, 드래그 목표 닿음, 아이템 획득, 퀴즈 정답
export const holdPulse = () => fire('holdPulse', 15); // 길게 누르기 0.25초마다
export const success = () => fire('success', [30, 60, 120]); // 미션 성공
