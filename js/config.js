/* config.json 형식 변환 (명세 v2 §9.2 + v3 §9.2) — 관람객 앱(index)과 설정 페이지(admin)가 같은 함수를 쓴다.
   v1(schema 없음·1) → v2(schema 2) → v3(schema 3). 알려진 필드만 골라 새 객체를 만든다(알 수 없는 필드·옛 필드는 버림).
   몇 번 넣어도 결과가 같다(schema 3을 다시 넣어도 그대로). 원본 객체는 바꾸지 않는다. */
export const SCHEMA = 3;
export const HOME_BG_DEFAULT = '#FFFFFF';
export const MAIN_DEFAULT = '#DE4A28';
export const GUIDE_MAX = 40;
export const SUCCESS_NOTE_MAX = 60;
export const BUILTIN_TAG = 'v=3.1';
/* 홈 배경 프리셋 7종 (명세 C1, 순서 = 설정 칩 순서) */
export const BG_PRESETS = [['aurora', '오로라'], ['aurora-light', '밝은 오로라'], ['pollen', '꽃가루'], ['stage', '무대 조명'], ['rings', '고리'], ['light', '빛'], ['dots', '점']];
export const BG_TYPES = ['color', 'preset', 'blur'];
/* 미션 성공 연출 3종 (명세 C3) */
export const EFFECTS = [['burst', '터짐'], ['confetti', '축포'], ['sparkle', '반짝임']];
/* 기본 3D 모델 5종 (명세 C7) */
export const BUILTIN_MODELS = [['star', '별'], ['heart', '하트'], ['balloon', '풍선'], ['gem', '보석'], ['planet', '행성']];
export const builtinModelPath = (id) => `builtin/models/${id}.glb`;
export const GIFT_BOX_PATH = 'builtin/gift-box.png';
/* 움직임 속도 (명세 C4·C5): 0 고정 · 1 느림 · 2 보통 · 3 빠름 — 초당, 화면 폭 대비 */
export const SPEED_TYPES = ['tap', 'hold', 'drag'];
export const SPEED_PCT = [0, 0.12, 0.24, 0.40];
const GUIDE_TYPES = ['tap', 'drag', 'hold', 'rotate', 'find'];
const MISSION_KEYS = {
  tap: ['count'], drag: ['target', 'icon'], hold: ['seconds'], rotate: ['marker', 'icon'], find: ['count', 'icon'],
  quiz: ['mode', 'question', 'options', 'answer'], none: []
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v.trim()) ? v.trim().toUpperCase() : d);
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const pick = (src, keys) => {
  const o = {};
  keys.forEach((k) => { if (src[k] !== undefined) o[k] = copy(src[k]); });
  return o;
};

/* builtin/ 파일은 코드와 함께 배포되므로 코드와 같은 꼬리표(?v=3.1)를 붙여 읽는다. 다른 경로·이미 꼬리표가 있으면 그대로. */
export function builtinUrl(p) {
  return typeof p === 'string' && p.startsWith('builtin/') && !p.includes('?') ? `${p}?${BUILTIN_TAG}` : p;
}
export const isBuiltin = (p) => typeof p === 'string' && p.startsWith('builtin/');

function gift(g, enabledDefault) {
  const s = isObj(g) ? g : {};
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : enabledDefault,
    image: str(s.image), title: str(s.title), description: str(s.description), claimNote: str(s.claimNote)
  };
}
function stampGift(g) {
  const s = isObj(g) ? g : {};
  return { image: str(s.image), title: str(s.title), description: str(s.description), claimNote: str(s.claimNote) };
}

export function normalizeMission(m) {
  if (!isObj(m)) return m === undefined ? undefined : { type: 'none' };
  const type = Object.prototype.hasOwnProperty.call(MISSION_KEYS, m.type) ? m.type : 'none';
  const o = { type, ...pick(m, MISSION_KEYS[type]) };
  if (GUIDE_TYPES.includes(type)) o.guide = str(m.guide).slice(0, GUIDE_MAX);
  if (SPEED_TYPES.includes(type)) { const s = Number(m.speed); o.speed = [0, 1, 2, 3].includes(s) ? s : 0; } // v2 미션 = 고정(0)
  return o;
}

function poster(p) {
  const s = isObj(p) ? p : {};
  const o = pick(s, ['id', 'name', 'image', 'model', 'placement', 'scale', 'position', 'rotation', 'animation', 'spin']);
  if (s.mission !== undefined) o.mission = normalizeMission(s.mission);
  const hasMission = !!(o.mission && o.mission.type !== 'none');
  // v2는 미션 포스터마다 사은품을 줬으므로 「사은품 있음」을 유지한다. 미션 없음은 사은품 없음.
  if (s.gift !== undefined || hasMission) o.gift = gift(s.gift, hasMission);
  o.effect = EFFECTS.some(([k]) => k === s.effect) ? s.effect : 'burst';
  o.successNote = str(s.successNote).slice(0, SUCCESS_NOTE_MAX);
  return o;
}

export function normalizeConfig(input) {
  const c = isObj(input) ? input : {};
  const h = isObj(c.home) ? c.home : {};
  const st = isObj(c.stampTour) ? c.stampTour : {};
  let bgType = BG_TYPES.includes(h.bgType) ? h.bgType : 'color';
  let bgPreset = str(h.bgPreset);
  if (bgType !== 'preset' || !BG_PRESETS.some(([k]) => k === bgPreset)) { if (bgType === 'preset') bgType = 'color'; bgPreset = ''; }
  const out = {
    schema: SCHEMA,
    projectId: str(c.projectId),
    projectName: str(c.projectName),
    home: {
      background: hex(h.background, HOME_BG_DEFAULT),
      bgType,
      bgPreset,
      image: str(h.image),
      mainColor: hex(h.mainColor, MAIN_DEFAULT),
      startLabel: str(h.startLabel)
    },
    mindFile: str(c.mindFile, 'assets/targets.mind') || 'assets/targets.mind',
    posters: Array.isArray(c.posters) ? c.posters.map(poster) : [],
    stampTour: { enabled: !!st.enabled, gift: stampGift(st.gift) },
    staff: { codeHash: str(isObj(c.staff) ? c.staff.codeHash : '') },
    updatedAt: str(c.updatedAt)
  };
  return out;
}
