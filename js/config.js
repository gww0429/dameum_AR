/* config.json 형식 변환 (명세 v2 §9.2) — 관람객 앱(index)과 설정 페이지(admin)가 같은 함수를 쓴다.
   v1(schema 없음·1) → v2(schema 2). 알려진 필드만 골라 새 객체를 만든다(알 수 없는 필드·옛 필드는 버림).
   몇 번 넣어도 결과가 같다(schema 2를 다시 넣어도 그대로). 원본 객체는 바꾸지 않는다. */
export const SCHEMA = 2;
export const HOME_BG_DEFAULT = '#FFFFFF';
export const MAIN_DEFAULT = '#DE4A28';
export const GUIDE_MAX = 40;
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

function gift(g) {
  const s = isObj(g) ? g : {};
  return { image: str(s.image), title: str(s.title), description: str(s.description), claimNote: str(s.claimNote) };
}

export function normalizeMission(m) {
  if (!isObj(m)) return m === undefined ? undefined : { type: 'none' };
  const type = Object.prototype.hasOwnProperty.call(MISSION_KEYS, m.type) ? m.type : 'none';
  const o = { type, ...pick(m, MISSION_KEYS[type]) };
  if (GUIDE_TYPES.includes(type)) o.guide = str(m.guide).slice(0, GUIDE_MAX);
  return o;
}

function poster(p) {
  const s = isObj(p) ? p : {};
  const o = pick(s, ['id', 'name', 'image', 'model', 'placement', 'scale', 'position', 'rotation', 'animation', 'spin']);
  if (s.mission !== undefined) o.mission = normalizeMission(s.mission);
  if (s.gift !== undefined) o.gift = gift(s.gift);
  return o;
}

export function normalizeConfig(input) {
  const c = isObj(input) ? input : {};
  const h = isObj(c.home) ? c.home : {};
  const st = isObj(c.stampTour) ? c.stampTour : {};
  const out = {
    schema: SCHEMA,
    projectId: str(c.projectId),
    projectName: str(c.projectName),
    home: {
      background: hex(h.background, HOME_BG_DEFAULT),
      image: str(h.image),
      mainColor: hex(h.mainColor, MAIN_DEFAULT),
      startLabel: str(h.startLabel)
    },
    mindFile: str(c.mindFile, 'assets/targets.mind') || 'assets/targets.mind',
    posters: Array.isArray(c.posters) ? c.posters.map(poster) : [],
    stampTour: { enabled: !!st.enabled, gift: gift(st.gift) },
    staff: { codeHash: str(isObj(c.staff) ? c.staff.codeHash : '') },
    updatedAt: str(c.updatedAt)
  };
  return out;
}
