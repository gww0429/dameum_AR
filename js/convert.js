/* 설정 페이지 3D 모델 업로드: 여러 형식을 GLB 한 파일로 바꾼다 (브라우저 안에서만, 외부 요청 없음)
   - .glb            : 그대로 쓴다 (Draco · KTX2 · Meshopt 압축 유지)
   - .gltf (+ .bin · 텍스처) : 파일을 그대로 GLB 컨테이너로 묶는다 (압축·애니메이션 손실 없음)
   - .fbx .obj(+.mtl) .stl .dae .3ds .ply : three 로더로 읽어 GLTFExporter(binary)로 내보낸다
   - .zip            : 풀어서 위 규칙대로 처리한다 (fflate)
   - .usdz           : 받지 않는다 (아이폰 전용 형식, 웹에서 안정적으로 읽을 수 없음) */
import * as THREE from 'three';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

export const MODEL_ACCEPT = '.glb,.gltf,.bin,.fbx,.obj,.mtl,.stl,.dae,.3ds,.ply,.zip,.png,.jpg,.jpeg,.webp,.tga,.bmp,.ktx2,.usdz';
export const MODEL_FMT_LABEL = 'GLB·glTF·FBX·OBJ·STL·DAE·3DS·PLY·ZIP';

const MAIN = ['glb', 'gltf', 'fbx', 'obj', 'dae', '3ds', 'stl', 'ply'];
const FMT = { glb: 'GLB', gltf: 'glTF', fbx: 'FBX', obj: 'OBJ', dae: 'DAE(Collada)', '3ds': '3DS', stl: 'STL', ply: 'PLY' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2', bmp: 'image/bmp' };
// 빠진 텍스처 자리: 불투명 흰색 1×1 (재질 색을 그대로 살림)
const EMPTY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY/j///9/AAn7A/0FQ0XKAAAAAElFTkSuQmCC';

const extOfName = (n) => (/\.([a-z0-9]+)$/i.exec(n) || [])[1]?.toLowerCase() || '';
const base = (n) => String(n).replace(/\\/g, '/').split('/').pop();
const keyOf = (n) => { try { n = decodeURIComponent(n); } catch (_) {} return base(n.split(/[?#]/)[0]).toLowerCase(); };

export class ConvertError extends Error {}

/* 선택한 파일들(zip 포함)을 이름 → Blob 표로 편다 */
function collect(files) {
  const map = new Map();
  const add = (name, blob) => { if (!/(^|\/)(__MACOSX|\.DS_Store)/.test(name) && !name.endsWith('/')) map.set(keyOf(name), { name: base(name), blob }); };
  return Promise.all(files.map(async (f) => {
    if (extOfName(f.name) === 'zip') {
      let entries;
      try { entries = unzipSync(new Uint8Array(await f.arrayBuffer())); } catch (_) { throw new ConvertError('zip 파일을 풀지 못했습니다'); }
      for (const [n, data] of Object.entries(entries)) add(n, new Blob([data]));
    } else add(f.name, f);
  })).then(() => map);
}

/* 결과: { blob, from, name, converted, missing[] }  실패하면 ConvertError */
export async function toGlb(fileList) {
  const files = [...fileList];
  if (!files.length) throw new ConvertError('파일이 없습니다');
  const map = await collect(files);
  const all = [...map.values()];
  const mains = all.filter((x) => MAIN.includes(extOfName(x.name)));
  if (!mains.length) {
    if (all.some((x) => /^(usdz|usd|usda|usdc|reality)$/.test(extOfName(x.name)))) {
      throw new ConvertError('USDZ는 받지 않습니다. 아이폰 전용 형식이라 웹에서 안정적으로 읽을 수 없습니다. 제작 업체에 GLB로 요청해 주세요');
    }
    if (all.some((x) => /^(bin|mtl|png|jpe?g|webp|tga|bmp|ktx2)$/.test(extOfName(x.name)))) {
      throw new ConvertError('모델 파일(.gltf·.obj 등)이 없습니다. 모델 파일과 텍스처를 함께 선택하거나 zip으로 올려 주세요');
    }
    throw new ConvertError(`지원하지 않는 형식입니다. ${MODEL_FMT_LABEL} 파일을 올려 주세요`);
  }
  mains.sort((a, b) => MAIN.indexOf(extOfName(a.name)) - MAIN.indexOf(extOfName(b.name)));
  const main = mains[0];
  const ext = extOfName(main.name);
  const from = FMT[ext];
  const outName = main.name.replace(/\.[^.]+$/, '') + '.glb';
  if (ext === 'glb') return { blob: main.blob, from, name: main.name, converted: false, missing: [] };
  try {
    if (ext === 'gltf') return { ...(await packGltf(main, map)), from, name: outName, converted: true };
    return { ...(await convertWithThree(ext, main, map)), from, name: outName, converted: true };
  } catch (err) {
    if (err instanceof ConvertError) throw err;
    console.warn('3D 모델 변환 실패:', err);
    throw new ConvertError(`${from} 파일을 GLB로 바꾸지 못했습니다(${(err && err.message) || '알 수 없는 오류'}). 제작 업체에 GLB로 요청해 주세요`);
  }
}

/* ── .gltf → GLB: JSON·버퍼·이미지를 그대로 GLB 컨테이너에 담는다 ── */
async function packGltf(main, map) {
  let json;
  try { json = JSON.parse(await main.blob.text()); } catch (_) { throw new ConvertError('glTF 파일을 읽지 못했습니다(JSON 오류)'); }
  const missing = [];
  const chunks = []; let len = 0;
  const push = (u8) => { const off = len; chunks.push(u8); len += u8.byteLength; const pad = (4 - (len % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); len += pad; } return off; };
  const fetchUri = async (uri) => {
    if (/^data:/i.test(uri)) return new Uint8Array(await (await fetch(uri)).arrayBuffer());
    const hit = map.get(keyOf(uri));
    if (!hit) { missing.push(base(decodeURIComponentSafe(uri))); return null; }
    return new Uint8Array(await hit.blob.arrayBuffer());
  };
  // 버퍼: uri 가 있는 것은 하나로 합치고, uri 없는 것(meshopt 대체 버퍼)은 뒤에 둔다
  const buffers = json.buffers || [];
  const newIndex = []; const offsets = []; const keep = [];
  for (let i = 0; i < buffers.length; i++) {
    const b = buffers[i];
    if (b.uri == null) { newIndex[i] = -1; keep.push(i); continue; }
    const data = await fetchUri(b.uri);
    if (!data) throw new ConvertError(`glTF에 필요한 파일이 없습니다: ${missing.join(', ')}. 함께 선택하거나 zip으로 올려 주세요`);
    newIndex[i] = 0; offsets[i] = push(data);
  }
  keep.forEach((i, k) => { newIndex[i] = k + 1; offsets[i] = 0; });
  const remap = (o) => { if (o && o.buffer != null) { const i = o.buffer; o.byteOffset = (o.byteOffset || 0) + (offsets[i] || 0); o.buffer = newIndex[i]; } };
  (json.bufferViews || []).forEach((bv) => { remap(bv); if (bv.extensions) Object.values(bv.extensions).forEach(remap); });
  // 이미지: 파일 참조를 버퍼 안으로 넣는다
  for (const img of json.images || []) {
    if (img.uri == null || /^data:/i.test(img.uri)) continue;
    const data = await fetchUri(img.uri);
    if (!data) continue;
    const off = push(data);
    if (!json.bufferViews) json.bufferViews = [];
    img.bufferView = json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: data.byteLength }) - 1;
    img.mimeType = img.mimeType || MIME[extOfName(img.uri)] || 'image/png';
    delete img.uri;
  }
  const merged = { byteLength: len };
  json.buffers = [merged, ...keep.map((i) => { const b = { ...buffers[i] }; delete b.uri; return b; })];
  if (!len && !keep.length) delete json.buffers;
  const bin = new Uint8Array(len); let p = 0; for (const c of chunks) { bin.set(c, p); p += c.byteLength; }
  return { blob: glbContainer(json, bin), missing };
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }
function glbContainer(json, bin) {
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (js.byteLength % 4)) % 4;
  if (jpad) { const t = new Uint8Array(js.byteLength + jpad); t.set(js); t.fill(0x20, js.byteLength); js = t; }
  const hasBin = bin.byteLength > 0;
  const total = 12 + 8 + js.byteLength + (hasBin ? 8 + bin.byteLength : 0);
  const out = new ArrayBuffer(total); const dv = new DataView(out); const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.byteLength, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(js, 20);
  if (hasBin) { const o = 20 + js.byteLength; dv.setUint32(o, bin.byteLength, true); dv.setUint32(o + 4, 0x004E4942, true); u8.set(bin, o + 8); }
  return new Blob([out], { type: 'model/gltf-binary' });
}

/* ── 그 밖의 형식 → three 로 읽고 GLTFExporter 로 내보낸다 ── */
function makeManager(map, missing) {
  const manager = new THREE.LoadingManager();
  const urls = [];
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    const hit = map.get(keyOf(url));
    if (!hit) { const n = base(decodeURIComponentSafe(url.split(/[?#]/)[0])); if (n && !missing.includes(n)) missing.push(n); return EMPTY_PNG; }
    const u = URL.createObjectURL(hit.blob); urls.push(u); return u;
  });
  let pending = 0; let waiters = [];
  const start = manager.itemStart.bind(manager), end = manager.itemEnd.bind(manager);
  manager.itemStart = (u) => { pending++; start(u); };
  manager.itemEnd = (u) => { pending = Math.max(0, pending - 1); end(u); if (!pending) { const w = waiters; waiters = []; w.forEach((f) => f()); } };
  manager.idle = async () => { await new Promise((r) => setTimeout(r, 0)); if (pending) await new Promise((r) => waiters.push(r)); };
  manager.release = () => urls.forEach((u) => URL.revokeObjectURL(u));
  return manager;
}

async function convertWithThree(ext, main, map) {
  const missing = [];
  const manager = makeManager(map, missing);
  let root, clips = [];
  try {
    const buf = () => main.blob.arrayBuffer();
    const txt = () => main.blob.text();
    if (ext === 'fbx') {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const { TGALoader } = await import('three/addons/loaders/TGALoader.js');
      manager.addHandler(/\.tga$/i, new TGALoader(manager));
      root = new FBXLoader(manager).parse(await buf(), '');
      clips = root.animations || [];
    } else if (ext === 'obj') {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
      const text = await txt();
      const loader = new OBJLoader(manager);
      const libs = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
      const mtlHit = libs.map((n) => map.get(keyOf(n))).find(Boolean) || [...map.values()].find((x) => extOfName(x.name) === 'mtl');
      if (mtlHit) {
        const mtl = new MTLLoader(manager).parse(await mtlHit.blob.text(), '');
        mtl.preload();
        loader.setMaterials(mtl);
      } else if (libs.length) libs.forEach((n) => missing.push(base(n)));
      root = loader.parse(text);
    } else if (ext === 'stl' || ext === 'ply') {
      const mod = ext === 'stl' ? await import('three/addons/loaders/STLLoader.js') : await import('three/addons/loaders/PLYLoader.js');
      const L = ext === 'stl' ? mod.STLLoader : mod.PLYLoader;
      const geo = new L(manager).parse(await buf());
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const vc = !!geo.attributes.color;
      root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: vc ? 0xffffff : 0xb4b4b4, vertexColors: vc, roughness: 0.7, metalness: 0 }));
      root.name = main.name.replace(/\.[^.]+$/, '');
    } else if (ext === 'dae') {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      const res = new ColladaLoader(manager).parse(await txt(), '');
      if (!res || !res.scene) throw new Error('장면을 찾지 못했습니다');
      root = res.scene;
      clips = res.scene.animations || [];
    } else if (ext === '3ds') {
      const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js');
      root = new TDSLoader(manager).parse(await buf(), '');
    }
    if (!root) throw new Error('장면을 찾지 못했습니다');
    await manager.idle();
    toStandardMaterials(root);
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const scene = new THREE.Scene();
    scene.add(root);
    scene.updateMatrixWorld(true);
    // 트랙이 없는 빈 애니메이션(FBX 「Take 001」 등)은 빼고, 나머지는 그대로 담는다
    const anims = clips.filter((c) => c && c.tracks && c.tracks.length && c.duration > 0);
    const out = await new GLTFExporter().parseAsync(scene, { binary: true, animations: anims, onlyVisible: true, maxTextureSize: 4096 });
    return { blob: new Blob([out], { type: 'model/gltf-binary' }), missing };
  } finally {
    manager.release();
  }
}

/* glTF 는 PBR 재질만 담으므로 Phong·Lambert 등은 같은 색·텍스처의 Standard 재질로 옮긴다 */
function toStandardMaterials(root) {
  const conv = new Map();
  const one = (m) => {
    if (!m || m.isMeshStandardMaterial || m.isMeshBasicMaterial) return m;
    if (conv.has(m)) return conv.get(m);
    const s = new THREE.MeshStandardMaterial({
      name: m.name, color: m.color ? m.color.clone() : new THREE.Color(0xffffff), map: m.map || null,
      normalMap: m.normalMap || null, emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0), emissiveMap: m.emissiveMap || null,
      alphaMap: m.alphaMap || null, aoMap: m.aoMap || null, opacity: m.opacity, transparent: m.transparent, side: m.side,
      vertexColors: m.vertexColors, alphaTest: m.alphaTest || 0, metalness: 0,
      roughness: m.shininess != null ? Math.min(1, Math.max(0.15, 1 - Math.sqrt(Math.min(m.shininess, 100) / 100) * 0.85)) : 0.8
    });
    conv.set(m, s);
    return s;
  };
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
}
