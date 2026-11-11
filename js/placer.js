/* 「내 공간에 놓기」 — model-viewer (lib 내장, 처음 누를 때만 불러온다)
   iOS: AR Quick Look (GLB → USDZ 자동 변환), Android: WebXR → Scene Viewer */
let loading = null;

export function loadModelViewer() {
  if (!loading) {
    // 압축 해제 도구(Draco · KTX2(Basis) · Meshopt)를 외부(gstatic·jsdelivr)에서 받지 않도록 lib/ 내장본으로 고정한다.
    const dec = new URL('../lib/three/addons/libs/', import.meta.url).href;
    self.ModelViewerElement = Object.assign(self.ModelViewerElement || {}, {
      dracoDecoderLocation: dec + 'draco/gltf/',
      ktx2TranscoderLocation: dec + 'basis/',
      meshoptDecoderLocation: dec + 'meshopt_decoder.js',
      lottieLoaderLocation: new URL('../lib/model-viewer/lottie-none.js', import.meta.url).href
    });
    loading = import('../lib/model-viewer/model-viewer.min.js');
  }
  return loading;
}

export async function openPlacer(host, src, { onUnsupported } = {}) {
  await loadModelViewer();
  host.innerHTML = '';
  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', src);
  mv.setAttribute('alt', '3D 모델');
  mv.setAttribute('ar', '');
  mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  mv.setAttribute('ar-placement', 'floor');
  mv.setAttribute('camera-controls', '');
  mv.setAttribute('touch-action', 'none');
  mv.setAttribute('interaction-prompt', 'none');
  mv.setAttribute('shadow-intensity', '1');
  const btn = document.createElement('button');
  btn.setAttribute('slot', 'ar-button');
  btn.className = 'abtn primary arbtn';
  btn.innerHTML = '<svg class="i"><use href="#i-cube"/></svg>바닥에 놓기';
  mv.appendChild(btn);
  host.appendChild(mv);

  let decided = false;
  const decide = () => {
    if (decided) return;
    decided = true;
    if (!mv.canActivateAR) { btn.hidden = true; onUnsupported && onUnsupported(); }
  };
  mv.addEventListener('load', () => setTimeout(decide, 300), { once: true });
  mv.addEventListener('error', () => { decided = true; btn.hidden = true; onUnsupported && onUnsupported(); }, { once: true });
  mv.addEventListener('ar-status', (e) => { if (e.detail && e.detail.status === 'failed') { btn.hidden = true; onUnsupported && onUnsupported(); } });
  setTimeout(decide, 4000);
  return mv;
}

export function closePlacer(host) { host.innerHTML = ''; }
