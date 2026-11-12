/* v3.5 GLB 도형 압축 (설정 페이지 전용, 브라우저 안에서만 · 외부 요청 없음)
   - 메시 도형을 Draco(KHR_draco_mesh_compression)로 압축해 GLB 용량을 줄인다. 텍스처·애니메이션·재질은 그대로 둔다.
   - 관람객 앱은 이미 Draco 해제 도구(lib/three/addons/libs/draco/gltf)를 내장하고 있어 따로 바꿀 것이 없다.
   - 이미 압축된 GLB, 외부 버퍼를 쓰는 GLB, 모프 타깃·sparse 가 있는 프리미티브는 건드리지 않는다.
   - 압축 결과가 원본의 90% 보다 크거나 다시 읽지 못하면 원본을 그대로 쓴다. */
const ENCODER_URL = new URL('../lib/three/addons/libs/draco/draco_encoder.js', import.meta.url).href;
const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ARR = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

// setTimeout 은 백그라운드 탭에서 크게 늦춰지므로 MessageChannel 로 한 번 쉬어 간다
const yieldNow = () => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });

let encoderP = null;
function loadEncoder() {
  if (!encoderP) {
    encoderP = new Promise((res, rej) => {
      // 이 emscripten 빌드는 모듈에 then 이 붙어 있어 Promise 로 넘기면 끝없이 resolve 를 되풀이한다(화면 멈춤).
      // asm.js 라 생성 즉시 준비가 끝나므로 then 을 지우고 넘긴다.
      const make = () => { const m = window.DracoEncoderModule(); delete m.then; return m; };
      if (window.DracoEncoderModule) { res(make()); return; }
      const s = document.createElement('script');
      s.src = ENCODER_URL;
      s.onload = () => { try { res(make()); } catch (e) { rej(e); } };
      s.onerror = () => { encoderP = null; rej(new Error('압축 도구를 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
  }
  return encoderP;
}

function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) return null;
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(buf, off + 8, len);
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === 0x004E4942) bin = body;
    off += 8 + len;
  }
  return json ? { json, bin } : null;
}
function buildGlb(json, bin) {
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.byteLength % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.byteLength + jpad); t.set(js); t.fill(0x20, js.byteLength); js = t; }
  const total = 12 + 8 + js.byteLength + (bin.byteLength ? 8 + bin.byteLength : 0);
  const out = new ArrayBuffer(total); const dv = new DataView(out); const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.byteLength, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(js, 20);
  if (bin.byteLength) { const o = 20 + js.byteLength; dv.setUint32(o, bin.byteLength, true); dv.setUint32(o + 4, 0x004E4942, true); u8.set(bin, o + 8); }
  return new Blob([out], { type: 'model/gltf-binary' });
}

/* 접근자 → 촘촘한 typed array (interleaved·byteStride 지원) */
function readAccessor(json, bin, ai) {
  const a = json.accessors[ai];
  const n = TYPE_N[a.type], cs = COMP_SIZE[a.componentType], A = ARR[a.componentType];
  const out = new A(a.count * n);
  if (a.bufferView == null) return out; // 모두 0
  const bv = json.bufferViews[a.bufferView];
  const stride = bv.byteStride || n * cs;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv[get](base + i * stride + k * cs, true);
  return out;
}

function encodePrimitive(D, json, bin, prim) {
  const builder = new D.MeshBuilder(), mesh = new D.Mesh(), enc = new D.Encoder();
  try {
    const pos = json.accessors[prim.attributes.POSITION];
    const nv = pos.count;
    let idx;
    if (prim.indices != null) { const raw = readAccessor(json, bin, prim.indices); idx = raw instanceof Uint32Array ? raw : Uint32Array.from(raw); }
    else { idx = new Uint32Array(nv); for (let i = 0; i < nv; i++) idx[i] = i; }
    if (idx.length % 3 || !idx.length) return null;
    builder.AddFacesToMesh(mesh, idx.length / 3, idx);
    const map = {};
    for (const [name, ai] of Object.entries(prim.attributes)) {
      const a = json.accessors[ai];
      if (a.count !== nv) return null;
      const n = TYPE_N[a.type], data = readAccessor(json, bin, ai);
      const kind = name === 'POSITION' ? D.POSITION : name === 'NORMAL' ? D.NORMAL : /^TEXCOORD_/.test(name) ? D.TEX_COORD : /^COLOR_/.test(name) ? D.COLOR : D.GENERIC;
      let id;
      switch (a.componentType) {
        case 5126: id = builder.AddFloatAttribute(mesh, kind, nv, n, data); break;
        case 5121: id = builder.AddUInt8Attribute(mesh, kind, nv, n, data); break;
        case 5123: id = builder.AddUInt16Attribute(mesh, kind, nv, n, data); break;
        case 5120: id = builder.AddInt8Attribute(mesh, kind, nv, n, data); break;
        case 5122: id = builder.AddInt16Attribute(mesh, kind, nv, n, data); break;
        case 5125: id = builder.AddUInt32Attribute(mesh, kind, nv, n, data); break;
        default: return null;
      }
      if (id < 0) return null;
      map[name] = id;
    }
    enc.SetSpeedOptions(5, 5);
    enc.SetAttributeQuantization(D.POSITION, 14);
    enc.SetAttributeQuantization(D.NORMAL, 10);
    enc.SetAttributeQuantization(D.TEX_COORD, 12);
    enc.SetAttributeQuantization(D.COLOR, 8);
    // edgebreaker 는 Sketchfab 같은 비다양체 메시에서 멈출 수 있어 순차 방식만 쓴다(빠르고 안정적, 압축률은 약간 낮음)
    enc.SetEncodingMethod(D.MESH_SEQUENTIAL_ENCODING);
    const arr = new D.DracoInt8Array();
    const len = enc.EncodeMeshToDracoBuffer(mesh, arr);
    if (!len) { D.destroy(arr); return null; }
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = arr.GetValue(i);
    D.destroy(arr);
    return { bytes, map };
  } finally { D.destroy(enc); D.destroy(mesh); D.destroy(builder); }
}

/* 결과: { blob, compressed, before, after, reason } */
export async function compressGlb(blob, { onProgress } = {}) {
  const before = blob.size;
  const keep = (reason) => ({ blob, compressed: false, before, after: before, reason });
  let g;
  try { g = parseGlb(await blob.arrayBuffer()); } catch (_) { return keep('읽지 못함'); }
  if (!g || !g.bin) return keep('도형 데이터 없음');
  const { json, bin } = g;
  const used = json.extensionsUsed || [];
  if (used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression')) return keep('이미 압축됨');
  if ((json.buffers || []).length !== 1 || json.buffers[0].uri != null) return keep('외부 버퍼');
  // v3.6: GLB 밖 파일을 가리키는 텍스처(uri 참조)는 업로드에 포함되지 않아 항상 404 가 난다.
  // 재질에서 그 텍스처 참조만 지워 헛된 요청을 막는다(재질 색값은 그대로라 모양·색은 같다).
  const badImg = new Set();
  (json.images || []).forEach((im, i) => { if (im.uri && !/^data:/i.test(im.uri)) badImg.add(i); });
  let stripped = 0;
  if (badImg.size) {
    const badTex = new Set();
    (json.textures || []).forEach((t, i) => {
      const ext = t.extensions ? Object.values(t.extensions).find((e) => e && e.source != null) : null;
      if (badImg.has(t.source) || (ext && badImg.has(ext.source))) badTex.add(i);
    });
    const strip = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v && typeof v === 'object' && /Texture$/.test(k) && typeof v.index === 'number' && badTex.has(v.index)) { delete o[k]; stripped++; }
        else strip(v);
      }
    };
    (json.materials || []).forEach(strip);
  }
  const prims = [];
  (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => prims.push(p)));
  const ok = (p) => (p.mode == null || p.mode === 4) && !p.targets && !p.extensions && p.attributes && p.attributes.POSITION != null
    && Object.values(p.attributes).concat(p.indices != null ? [p.indices] : []).every((ai) => json.accessors[ai] && !json.accessors[ai].sparse);
  const targets = prims.filter(ok);
  if (!targets.length) return keep('압축할 메시 없음');

  let D;
  try { D = await loadEncoder(); } catch (_) { return keep('압축 도구 없음'); }

  const extra = []; // 새로 붙일 draco 바이트
  let done = 0;
  for (const p of targets) {
    let r = null;
    try { r = encodePrimitive(D, json, bin, p); } catch (e) { console.warn('Draco 압축 실패(그 메시는 원본 유지):', e); }
    done++;
    if (onProgress) onProgress(done / targets.length);
    if (!r) continue;
    // 압축된 프리미티브는 새 접근자(버퍼 없음)를 쓴다. 다른 곳과 함께 쓰던 원래 접근자는 건드리지 않는다.
    const clone = (ai) => { const a = { ...json.accessors[ai] }; delete a.bufferView; delete a.byteOffset; return json.accessors.push(a) - 1; };
    const attrs = {};
    for (const name of Object.keys(p.attributes)) attrs[name] = clone(p.attributes[name]);
    p.attributes = attrs;
    if (p.indices != null) p.indices = clone(p.indices);
    p.extensions = { KHR_draco_mesh_compression: { bufferView: -1 - extra.length, attributes: r.map } };
    extra.push(r.bytes);
    if (done % 8 === 0) await yieldNow(); // 화면이 멈추지 않게(탭을 옮겨도 느려지지 않는 방식)
  }
  if (!extra.length) return keep('압축 실패');

  // 쓰이는 접근자만 남긴다
  const accUsed = new Set();
  const markA = (ai) => { if (ai != null) accUsed.add(ai); };
  (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => {
    Object.values(p.attributes || {}).forEach(markA); markA(p.indices);
    (p.targets || []).forEach((t) => Object.values(t).forEach(markA));
  }));
  (json.skins || []).forEach((s) => markA(s.inverseBindMatrices));
  (json.animations || []).forEach((an) => (an.samplers || []).forEach((s) => { markA(s.input); markA(s.output); }));
  const accMap = new Map(); const accs = [];
  json.accessors.forEach((a, i) => { if (accUsed.has(i)) { accMap.set(i, accs.length); accs.push(a); } });
  const ra = (ai) => (ai == null ? ai : accMap.get(ai));
  (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => {
    for (const k of Object.keys(p.attributes || {})) p.attributes[k] = ra(p.attributes[k]);
    if (p.indices != null) p.indices = ra(p.indices);
    (p.targets || []).forEach((t) => { for (const k of Object.keys(t)) t[k] = ra(t[k]); });
  }));
  (json.skins || []).forEach((s) => { if (s.inverseBindMatrices != null) s.inverseBindMatrices = ra(s.inverseBindMatrices); });
  (json.animations || []).forEach((an) => (an.samplers || []).forEach((s) => { s.input = ra(s.input); s.output = ra(s.output); }));
  json.accessors = accs;

  // 쓰이는 bufferView 만 새 BIN 으로 옮긴다
  const chunks = []; let len = 0;
  const push = (u8) => { const off = len; chunks.push(u8); len += u8.byteLength; const pad = (4 - (len % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); len += pad; } return off; };
  const views = []; const viewMap = new Map();
  const keepView = (vi) => {
    if (vi == null) return vi;
    if (viewMap.has(vi)) return viewMap.get(vi);
    const v = { ...json.bufferViews[vi] };
    const src = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    v.byteOffset = push(src); v.buffer = 0;
    viewMap.set(vi, views.length); views.push(v);
    return viewMap.get(vi);
  };
  // 남은 접근자는 각자 촘촘한 새 bufferView 로 다시 담는다. 여러 메시가 한 덩어리 view 를 함께 쓰는 모델(Sketchfab 등)에서
  // 압축한 메시의 원본 데이터가 그 덩어리째 남아 용량이 줄지 않던 문제를 막는다.
  const vertexAcc = new Set();
  (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => {
    Object.values(p.attributes || {}).forEach((ai) => vertexAcc.add(ai));
    (p.targets || []).forEach((t) => Object.values(t).forEach((ai) => vertexAcc.add(ai)));
  }));
  const origViews = json.bufferViews;
  json.accessors.forEach((a, ai) => {
    if (a.bufferView == null) return;
    const elem = TYPE_N[a.type] * COMP_SIZE[a.componentType];
    const tightOk = !a.sparse && (!vertexAcc.has(ai) || elem % 4 === 0);
    if (!tightOk) { a.bufferView = keepView(a.bufferView); return; } // 그대로 복사(정렬 규칙·sparse)
    json.bufferViews = origViews; // readAccessor 는 원래 view 를 읽는다
    const data = readAccessor(json, bin, ai);
    const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const v = { buffer: 0, byteOffset: push(u8), byteLength: u8.byteLength };
    const orig = origViews[a.bufferView];
    if (orig.target != null) v.target = orig.target;
    a.bufferView = views.push(v) - 1; a.byteOffset = 0;
  });
  json.accessors.forEach((a) => { if (a.sparse) { a.sparse.indices.bufferView = keepView(a.sparse.indices.bufferView); a.sparse.values.bufferView = keepView(a.sparse.values.bufferView); } });
  (json.images || []).forEach((im) => { if (im.bufferView != null) im.bufferView = keepView(im.bufferView); });
  (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => {
    const ext = p.extensions && p.extensions.KHR_draco_mesh_compression;
    if (ext && ext.bufferView < 0) {
      const bytes = extra[-1 - ext.bufferView];
      ext.bufferView = views.push({ buffer: 0, byteOffset: push(bytes), byteLength: bytes.byteLength }) - 1;
    }
  }));
  json.bufferViews = views;
  json.buffers = [{ byteLength: len }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_draco_mesh_compression'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'KHR_draco_mesh_compression'])];
  const out = new Uint8Array(len); let o = 0; for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  const res = buildGlb(json, out);
  if (res.size > before * 0.9) return keep('효과 작음');
  return { blob: res, compressed: true, before, after: res.size, reason: '', stripped };
}
