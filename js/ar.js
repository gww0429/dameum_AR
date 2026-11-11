/* AR 무대: MindAR 시작, 3D 배치, 3DoF 고정(방향 센서), 재보정, 미리보기 장면
   상태 판정(맞힘·투영·위치)은 update(now) 로 시간 기준 계산하고, rAF 는 그리기만 한다. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export const deg = (d) => d * Math.PI / 180;
export const PLACEMENT_DEFAULT = { front: [0, 0, 0.35], floor: [0, -1.2, 0.6] };

/* ── 임시 모델 (v0 그대로) ── */
export function placeholderModel() {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({ color: 0xde4a28, roughness: .35, metalness: .1, flatShading: true }));
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.025, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0x1e5ac8, roughness: .4 }));
  ring.rotation.x = deg(75);
  const dots = new THREE.Group();
  const dotMat = new THREE.MeshStandardMaterial({ color: 0xf5be1e, roughness: .4 });
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), dotMat);
    const a = i / 3 * Math.PI * 2;
    d.position.set(Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52);
    dots.add(d);
  }
  dots.rotation.x = deg(75);
  g.add(gem, ring, dots);
  g.userData.tick = (t) => { gem.rotation.y = t * 0.8; gem.position.y = Math.sin(t * 2) * 0.03; dots.rotation.z = t * 1.2; };
  g.userData.placeholder = true;
  return g;
}

/* ── 모델 로딩 (가장 긴 변 = 1 로 정규화) ── */
const loader = new GLTFLoader();
/* 압축 glTF(Draco · KTX2(Basis) · Meshopt) 해제 도구는 lib/ 내장본만 쓴다(외부 요청 없음). */
const DECODERS = new URL('../lib/three/addons/libs/', import.meta.url).href;
const ktx2 = new KTX2Loader().setTranscoderPath(DECODERS + 'basis/');
loader.setDRACOLoader(new DRACOLoader().setDecoderPath(DECODERS + 'draco/gltf/'));
loader.setKTX2Loader(ktx2);
loader.setMeshoptDecoder(MeshoptDecoder);
let ktx2Ready = false;
function initKTX2() {
  // KTX2 는 기기가 지원하는 GPU 압축 형식을 먼저 알아야 한다. 잠깐 쓰는 렌더러로 한 번만 확인한다.
  if (ktx2Ready) return;
  ktx2Ready = true;
  try {
    const r = new THREE.WebGLRenderer();
    ktx2.detectSupport(r);
    r.dispose(); r.forceContextLoss();
  } catch (_) { /* WebGL 없음: KTX2 모델만 실패하고 임시 모델로 바뀐다 */ }
}
const modelCache = new Map(); // url → Promise<{wrap, clips}>
function normalized(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = 1 / (Math.max(size.x, size.y, size.z) || 1);
  root.position.sub(center).multiplyScalar(k);
  root.scale.setScalar(k);
  const wrap = new THREE.Group();
  wrap.add(root);
  return wrap;
}
export function loadModel(url) {
  if (!url) return Promise.resolve({ wrap: placeholderModel(), clips: [], placeholder: true });
  if (!modelCache.has(url)) {
    initKTX2();
    modelCache.set(url, loader.loadAsync(url).then((gltf) => ({ wrap: normalized(gltf.scene), clips: gltf.animations || [], placeholder: false }))
      .catch((err) => {
        console.warn('GLB를 읽지 못해 임시 모델로 바꿉니다:', url, err && err.message);
        modelCache.delete(url);
        return { wrap: placeholderModel(), clips: [], placeholder: true, failed: true };
      }));
  }
  return modelCache.get(url);
}

/* 방향 센서 → 카메라 자세 (three DeviceOrientationControls 와 같은 식) */
const zee = new THREE.Vector3(0, 0, 1);
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function deviceQuat(out, alpha, beta, gamma, orient) {
  const e = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
  out.setFromEuler(e);
  out.multiply(q1);
  out.multiply(new THREE.Quaternion().setFromAxisAngle(zee, -orient));
  return out;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Stage {
  constructor(container, hooks = {}) {
    this.el = container;
    this.hooks = hooks;
    this.mode = null;
    this.posters = [];
    this.resolve = (u) => u;
    this.cur = null;
    this.mixer = null;
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.sensor = { ok: false, q: new THREE.Quaternion() };
    this.captured = null; this.qAt = new THREE.Quaternion();
    this.blend = null;
    this.drag = null; this.dragOffset = new THREE.Vector3();
    this.lastDisplay = new THREE.Matrix4();
    this.noGL = false;
    this._onOrient = (e) => {
      if (e.alpha == null && e.beta == null) return;
      const orient = deg((screen.orientation && screen.orientation.angle) || window.orientation || 0);
      deviceQuat(this.sensor.q, deg(e.alpha || 0), deg(e.beta || 0), deg(e.gamma || 0), orient);
      this.sensor.ok = true;
    };
  }

  setPosters(posters, resolve) { this.posters = posters; if (resolve) this.resolve = resolve; }

  _lights(scene) {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.5, 1, 1);
    scene.add(sun);
  }

  _makeRoot() {
    const root = new THREE.Group(); root.matrixAutoUpdate = false; root.visible = false;
    const rot = new THREE.Group(), spin = new THREE.Group(), appear = new THREE.Group();
    root.add(rot); rot.add(spin); spin.add(appear);
    this.scene.add(root);
    this.g = { root, rot, spin, appear };
  }

  /* ── 미리보기: 카메라·MindAR·센서 없이 포스터 앞 장면 ── */
  initPreview() {
    this.mode = 'preview';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.domElement.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
      this.el.appendChild(this.renderer.domElement);
    } catch (err) {
      console.warn('WebGL 을 쓸 수 없어 3D 없이 미리보기합니다.');
      this.renderer = null; this.noGL = true;
    }
    this._lights(this.scene);
    this._makeRoot();
    this.posterPlane = null;
    this.previewAnchor = new THREE.Matrix4();
    this._resize = () => this.resizePreview();
    window.addEventListener('resize', this._resize);
    this.resizePreview();
    if (this.renderer) this.renderer.setAnimationLoop(() => this._frame());
  }

  resizePreview() {
    const w = this.el.clientWidth || window.innerWidth, h = this.el.clientHeight || window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.renderer) this.renderer.setSize(w, h, false);
    // 포스터 가로폭이 앱 폭의 64% 가 되는 거리, 포스터 가운데는 화면 위쪽 42% 근처
    const colW = Math.min(w, 430);
    const hfov = 2 * Math.atan(Math.tan(deg(this.camera.fov / 2)) * this.camera.aspect);
    const visW = 1 / (0.64 * colW / w);
    const d = visW / (2 * Math.tan(hfov / 2));
    const visH = 2 * d * Math.tan(deg(this.camera.fov / 2));
    this.previewAnchor.makeTranslation(0, visH * 0.08, -d);
    if (this.posterPlane) this.posterPlane.matrix.copy(this.previewAnchor);
    this.renderNow();
  }

  setPreviewPoster(url) {
    if (this.posterPlane) { this.scene.remove(this.posterPlane); this.posterPlane = null; }
    if (!url || this.noGL) return;
    const tl = new THREE.TextureLoader();
    tl.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const ar = tex.image ? tex.image.height / tex.image.width : 1.4;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, ar), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.45, depthWrite: false }));
      const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(this.previewAnchor);
      holder.add(plane);
      holder.renderOrder = -1;
      this.posterPlane = holder;
      this.scene.add(holder);
      this.renderNow();
    }, undefined, () => {});
  }

  /* ── 실제 AR: MindAR ── */
  async startAR(mindUrl) {
    this.mode = 'ar';
    const { MindARThree } = await import('../lib/mindar/mindar-image-three.prod.js');
    this.el.innerHTML = '';
    this.mindar = new MindARThree({
      container: this.el, imageTargetSrc: mindUrl, maxTrack: 1,
      uiLoading: 'no', uiScanning: 'no', uiError: 'no',
      filterMinCF: 0.0001, filterBeta: 0.001, warmupTolerance: 5, missTolerance: 5
    });
    const { renderer, scene, camera } = this.mindar;
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._lights(scene);
    this._makeRoot();
    this.anchors = this.posters.map((p, i) => {
      const a = this.mindar.addAnchor(i);
      a.onTargetFound = () => this.hooks.found && this.hooks.found(i);
      a.onTargetLost = () => this.hooks.lost && this.hooks.lost(i);
      return a;
    });
    window.addEventListener('deviceorientation', this._onOrient);
    await this.mindar.start();
    this.running = true;
    renderer.setAnimationLoop(() => this._frame());
  }
  async pauseAR() {
    if (!this.mindar || !this.running) return;
    this.running = false;
    try { this.renderer.setAnimationLoop(null); this.mindar.stop(); } catch (_) {}
  }
  async resumeAR() {
    if (!this.mindar || this.running) return;
    this.captured = null; this.blend = null;
    await this.mindar.start();
    this.running = true;
    this.renderer.setAnimationLoop(() => this._frame());
  }
  destroy() {
    try { if (this.renderer) this.renderer.setAnimationLoop(null); } catch (_) {}
    if (this.mindar && this.running) { try { this.mindar.stop(); } catch (_) {} }
    this.running = false;
    window.removeEventListener('deviceorientation', this._onOrient);
    if (this._resize) window.removeEventListener('resize', this._resize);
    try { if (this.renderer && this.mode === 'preview') this.renderer.dispose(); } catch (_) {}
    this.el.innerHTML = '';
    this.mindar = null; this.renderer = null; this.cur = null;
  }

  /* ── 포스터 바꾸기 (인식된 포스터의 모델만 지연 로딩) ── */
  async setPoster(i) {
    const p = this.posters[i];
    const token = {};
    this._token = token;
    this.cur = { index: i, poster: p, ready: false, appearAt: 0 };
    this.captured = null; this.blend = null; this.dragOffset.set(0, 0, 0); this.drag = null;
    const { appear, rot, spin } = this.g;
    appear.clear(); rot.quaternion.identity(); spin.rotation.set(0, 0, 0);
    spin.children.filter((c) => c.userData.marker).forEach((c) => spin.remove(c));
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null; }
    this.g.root.visible = false;
    const m = await loadModel(p.model ? this.resolve(p.model) : null);
    if (this._token !== token) return;
    appear.add(m.wrap);
    m.wrap.position.set(0, 0, 0);
    this.cur.model = m;
    if (p.animation && m.clips.length) {
      this.mixer = new THREE.AnimationMixer(m.wrap);
      m.clips.forEach((c) => this.mixer.clipAction(c).play());
    }
    this.cur.ready = true;
    this.cur.appearAt = performance.now();
    this.update();
    this.renderNow();
    if (this.hooks.ready) this.hooks.ready(i, m);
  }
  clearPoster() {
    this._token = {};
    this.cur = null;
    if (this.g) { this.g.appear.clear(); this.g.root.visible = false; }
    this.captured = null;
    this.renderNow();
  }
  refound() { // 같은 포스터를 다시 인식: 0.3초 보간으로 보정
    if (!this.cur || !this.captured) return;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.lastDisplay.decompose(p, q, s);
    this.blend = { at: performance.now(), p, q, s };
  }

  _placeLocal(p) {
    const pos = p.position || PLACEMENT_DEFAULT[p.placement] || PLACEMENT_DEFAULT.front;
    const r = (p.rotation || [0, 0, 0]).map(deg);
    return { pos: new THREE.Vector3(pos[0], pos[1], pos[2]), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])) };
  }

  _trackedPose() {
    if (this.mode === 'preview') return this.previewAnchor;
    const a = this.anchors && this.anchors[this.cur.index];
    return a && a.visible ? a.group.matrix : null;
  }

  /* 시간 기준 상태 계산 — rAF 와 입력 처리 양쪽에서 부른다 */
  update(now = performance.now()) {
    const g = this.g;
    if (!g) return;
    if (!this.cur || !this.cur.ready) { g.root.visible = false; return; }
    const p = this.cur.poster;
    const anchorM = this._trackedPose();
    let pose = null;
    if (anchorM) {
      const ap = new THREE.Vector3(), aq = new THREE.Quaternion(), as = new THREE.Vector3();
      anchorM.decompose(ap, aq, as);
      const L = this._placeLocal(p);
      const pos = L.pos.clone().applyMatrix4(anchorM);
      let q = aq.clone().multiply(L.q);
      if (p.placement === 'floor' && this.sensor.ok && this.mode === 'ar') {
        // 바닥 쪽: 모델 위쪽을 하늘 방향으로 세운다
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.sensor.q.clone().invert());
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(aq);
        n.sub(up.clone().multiplyScalar(n.dot(up)));
        if (n.lengthSq() > 1e-6) {
          n.normalize();
          const x = new THREE.Vector3().crossVectors(up, n);
          const basis = new THREE.Matrix4().makeBasis(x, up, n);
          q = new THREE.Quaternion().setFromRotationMatrix(basis).multiply(L.q);
        }
      }
      pose = new THREE.Matrix4().compose(pos, q, as);
      this.captured = pose.clone();
      this.qAt.copy(this.sensor.q);
      if (this.blend) {
        const t = Math.min(1, (now - this.blend.at) / 300);
        if (t >= 1) this.blend = null;
        else {
          const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
          pose.decompose(tp, tq, ts);
          pose = new THREE.Matrix4().compose(this.blend.p.clone().lerp(tp, t), this.blend.q.clone().slerp(tq, t), this.blend.s.clone().lerp(ts, t));
        }
      }
    } else if (this.captured && this.sensor.ok) {
      // 포스터를 놓침: 카메라 회전만 반영해 그 자리에 둔다 (3DoF)
      const dq = this.sensor.q.clone().invert().multiply(this.qAt);
      pose = new THREE.Matrix4().makeRotationFromQuaternion(dq).multiply(this.captured);
    }
    if (!pose) { g.root.visible = false; return; }
    if (this.dragOffset.lengthSq()) pose = new THREE.Matrix4().makeTranslation(this.dragOffset.x, this.dragOffset.y, this.dragOffset.z).multiply(pose);
    g.root.matrix.copy(pose);
    this.lastDisplay.copy(pose);
    g.root.visible = true;
    const k = Math.min(1, (now - this.cur.appearAt) / 400);
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const e = reduce ? 1 : 1 - Math.pow(1 - k, 3);
    g.appear.scale.setScalar((p.scale ?? 0.6) * (0.001 + e * 0.999));
    g.root.updateMatrixWorld(true);
  }

  _frame() {
    const dt = this.clock.getDelta(), t = this.clock.elapsedTime;
    if (this.mixer) this.mixer.update(dt);
    if (this.cur && this.cur.ready) {
      const p = this.cur.poster;
      const spin = p.spin && !(p.mission && p.mission.type === 'rotate');
      if (spin) this.g.spin.rotation.y += dt * 0.5;
      const w = this.cur.model && this.cur.model.wrap;
      if (w && w.userData.tick) w.userData.tick(t);
    }
    this.update();
    if (this.hooks.frame) this.hooks.frame();
    if (this.renderer) this.renderer.render(this.scene, this.camera);
  }
  renderNow() {
    this.update();
    if (this.hooks.frame) this.hooks.frame();
    if (this.renderer && this.scene) { try { this.renderer.render(this.scene, this.camera); } catch (_) {} }
  }

  /* ── 화면 좌표 ── */
  _rect() { return (this.renderer ? this.renderer.domElement : this.el).getBoundingClientRect(); }
  toClient(world) {
    if (this.noGL) { const r = this.el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.42, front: true }; }
    const r = this._rect();
    const v = world.clone().project(this.camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, front: v.z < 1 };
  }
  centerClient() {
    this.update();
    if (!this.g || !this.g.root.visible) return null;
    return this.toClient(this.g.root.getWorldPosition(_v));
  }
  posterClient() { // 모델 로딩 표시 자리
    const m = this._trackedPose() || this.captured;
    if (!m && this.mode !== 'preview') return null;
    const M = m || this.previewAnchor;
    return this.toClient(new THREE.Vector3().setFromMatrixPosition(M));
  }
  hitModel(x, y) {
    this.update();
    if (!this.cur || !this.cur.ready || !this.g.root.visible) return false;
    if (this.noGL) { const c = this.centerClient(); return !!c && Math.hypot(x - c.x, y - c.y) < 80; }
    const r = this._rect();
    const ndc = new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(this.g.appear, true).length > 0;
  }

  /* ── 드래그: 손가락을 따라 화면과 평행하게 옮긴다 ── */
  _rayPoint(x, y, depthZ) {
    const r = this._rect();
    const ndc = new THREE.Vector3((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const camPos = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const dir = ndc.sub(camPos).normalize();
    const t = (depthZ - camPos.z) / dir.z;
    return camPos.add(dir.multiplyScalar(t));
  }
  beginDrag(x, y) {
    this.update();
    if (this.noGL) { this.drag = { x0: x, y0: y }; return; }
    const c = this.g.root.getWorldPosition(new THREE.Vector3());
    this.drag = { z: c.z, grab: this._rayPoint(x, y, c.z), base: this.dragOffset.clone() };
  }
  dragTo(x, y) {
    if (!this.drag) return;
    if (this.noGL) { this.drag.dx = x - this.drag.x0; this.drag.dy = y - this.drag.y0; return; }
    const pnt = this._rayPoint(x, y, this.drag.z);
    this.dragOffset.copy(this.drag.base).add(pnt.sub(this.drag.grab));
    this.renderNow();
  }
  dragCenterClient() {
    if (this.noGL && this.drag) { const c = this.centerClient(); return { x: c.x + (this.drag.dx || 0), y: c.y + (this.drag.dy || 0) }; }
    return this.centerClient();
  }
  endDrag(keep) {
    this.drag = null;
    if (!keep) this.dragOffset.set(0, 0, 0);
    this.renderNow();
  }

  /* ── 돌려 보기: 화면 축 기준으로 회전 ── */
  rotateBy(dx, dy) {
    if (!this.g) return;
    this.update();
    const rootQ = new THREE.Quaternion(); this.g.root.matrixWorld.decompose(_v, rootQ, _s);
    const qc = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.01)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.01));
    const local = rootQ.clone().invert().multiply(qc).multiply(rootQ);
    this.g.rot.quaternion.premultiply(local);
    this.g.rot.updateMatrixWorld(true);
    this.renderNow();
  }

  /* 모델 둘레의 표시(돌려 보기 표시·숨은 아이템) */
  addMarker(dir, radiusK = 0.6) {
    const o = new THREE.Object3D();
    const s = (this.cur && this.cur.poster.scale) ?? 0.6;
    o.position.copy(dir).normalize().multiplyScalar(s * radiusK);
    o.userData.marker = true;
    this.g.spin.add(o);
    o.updateMatrixWorld(true);
    return o;
  }
  removeMarker(o) { if (o && o.parent) o.parent.remove(o); }
  /* 표시가 카메라 쪽을 보는 각도(도). 0 = 정면 */
  markerAngle(o) {
    if (this.noGL) return 0;
    this.update();
    const c = this.g.root.getWorldPosition(new THREE.Vector3());
    const m = o.getWorldPosition(new THREE.Vector3());
    const d = m.sub(c).normalize();
    const camPos = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const v = camPos.sub(c).normalize();
    return Math.acos(Math.max(-1, Math.min(1, d.dot(v)))) * 180 / Math.PI;
  }
  markerClient(o) {
    if (this.noGL) { const c = this.centerClient(); const p = o.position; return { x: c.x + p.x * 160, y: c.y - p.y * 160, front: true }; }
    return this.toClient(o.getWorldPosition(new THREE.Vector3()));
  }
  visible() { this.update(); return !!(this.g && this.g.root.visible); }
}
