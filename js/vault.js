/* v3.7 발행 설정 잠금 + 접근 키 공유 (설정 페이지 전용)
   - 발행 설정은 비밀번호를 넣어야 열린다. 비밀번호 원문은 코드에 없고, PBKDF2 해시만 있다.
   - GitHub 접근 키·저장소·브랜치는 같은 비밀번호로 AES-GCM 암호화해 저장소의 VAULT_PATH 에 둔다.
     다른 PC에서는 비밀번호만 넣으면 그 파일을 받아 풀어 쓴다. 키 원문은 어디에도 공개되지 않는다.
   - 보안은 비밀번호 강도에 달려 있다(공개 파일을 대입해 볼 수 있음). 그래서 PBKDF2 를 60만 회 돌려 대입을 느리게 한다.
     접근 키는 이 저장소 Contents 읽기·쓰기만 되게, 만료일을 두고 발급할 것. */
export const VAULT_PATH = 'publish-key.json';
const ITER = 600000;
// 비밀번호 확인용: PBKDF2-SHA256(canonPassword(비밀번호), PW_SALT, ITER) 32바이트 (v3.8 변경)
const PW_SALT = 'dameum_ar:8d553f77d63432abd522b67345053e34';
const PW_HASH = 'd45d36864e782eeac71aa6590bef55e6d0e334df8ba9e295e3614666f9632b04';

/* v3.8 한글 비밀번호: 한글로 치든, 한/영이 영문으로 된 채 같은 자리를 치든 같은 비밀번호로 본다.
   한글 글자를 두벌식 자판의 영문 키 순서로 바꿔 비교한다(예: 「가」 → "rk"). */
const CHO = 'rRseEfaqQtTdwWczxvg';
const JUNG = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
const JONG = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
const JAMO = { 'ㄱ': 'r', 'ㄲ': 'R', 'ㄳ': 'rt', 'ㄴ': 's', 'ㄵ': 'sw', 'ㄶ': 'sg', 'ㄷ': 'e', 'ㄸ': 'E', 'ㄹ': 'f', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq', 'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg',
  'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅄ': 'qt', 'ㅅ': 't', 'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
  'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅘ': 'hk', 'ㅙ': 'ho', 'ㅚ': 'hl', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj', 'ㅞ': 'np', 'ㅟ': 'nl', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅢ': 'ml', 'ㅣ': 'l' };
export function canonPassword(pw) {
  let out = '';
  for (const ch of String(pw || '').normalize('NFC')) {
    const c = ch.charCodeAt(0);
    if (c >= 0xAC00 && c <= 0xD7A3) { const s = c - 0xAC00; out += CHO[Math.floor(s / 588)] + JUNG[Math.floor((s % 588) / 28)] + JONG[s % 28]; }
    else out += JAMO[ch] || ch;
  }
  return out;
}

const te = new TextEncoder(), td = new TextDecoder();
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function baseKey(pw) { return crypto.subtle.importKey('raw', te.encode(canonPassword(pw)), 'PBKDF2', false, ['deriveBits', 'deriveKey']); }

export async function verifyPassword(pw) {
  if (!pw) return false;
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(PW_SALT), iterations: ITER }, await baseKey(pw), 256);
  return hex(new Uint8Array(bits)) === PW_HASH;
}

async function aesKey(pw, salt, iter) {
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, await baseKey(pw), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/* 접근 설정 {token, repo, branch} → 공개해도 되는 암호문 JSON */
export async function seal(pw, settings) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(pw, salt, ITER);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify({ token: settings.token, repo: settings.repo, branch: settings.branch || 'main' }))));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data), savedAt: new Date().toISOString() };
}

/* 암호문 JSON → {token, repo, branch}. 비밀번호가 틀리면 throw */
export async function unseal(pw, vault) {
  const key = await aesKey(pw, unb64(vault.salt), vault.iter || ITER);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.data));
  const s = JSON.parse(td.decode(plain));
  return { token: s.token || '', repo: s.repo || '', branch: s.branch || 'main' };
}

/* 사이트에 올라간 암호문 받기(없으면 null) */
export async function fetchVault() {
  try {
    const r = await fetch(VAULT_PATH + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json();
    return v && v.data && v.salt && v.iv ? v : null;
  } catch (_) { return null; }
}
