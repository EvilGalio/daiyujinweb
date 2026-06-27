/**
 * Quote 3D Viewer — Precision Studio Viewer.
 *
 * Usage:
 *   const mod = await import('./quote-3d-viewer.js');
 *   await mod.mount(container, { apiBase, fileId, partName });
 *   mod.resize(container);
 *   mod.dispose();
 *
 * Dependencies: Three.js via importmap.
 */

let state = null;
const views = {};

const DEFAULT_OPTIONS = { apiBase: 'http://127.0.0.1:5000', fileId: '', partName: 'Part' };

function lerp(a, b, t) { return a + (b - a) * t; }

async function loadThree() {
  const [THREE, { OrbitControls }, { STLLoader }, { RoomEnvironment }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/loaders/STLLoader.js'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]);
  return { THREE, OrbitControls, STLLoader, RoomEnvironment };
}

/* ── Camera (narrower FOV for less distortion) ─ */

function createCamera(container) {
  const { THREE } = state;
  const w = container.clientWidth || 400;
  const h = container.clientHeight || 300;
  return new THREE.PerspectiveCamera(32, w / h, 0.5, 3000);
}

/* ── Renderer ─────────────────────────────────── */

function createRenderer(container, THREE) {
  const w = container.clientWidth || 400;
  const h = container.clientHeight || 300;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(w, h);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  container.appendChild(r.domElement);
  return r;
}

/* ── Studio lighting ──────────────────────────── */

function setupLighting(scene, renderer, THREE, RoomEnvironment) {
  // Soft hemisphere light for ambient fill — no flat AmbientLight
  scene.add(new THREE.HemisphereLight('#f8f9fb', '#d9e0e8', 0.55));

  // Key — soft directional, main shadow caster
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(18, 24, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 300;
  key.shadow.camera.left = -40; key.shadow.camera.right = 40;
  key.shadow.camera.top = 40; key.shadow.camera.bottom = -40;
  key.shadow.bias = -0.00008;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  state.keyLight = key;

  // Fill — cool blue-gray, opposite side
  const fill = new THREE.DirectionalLight('#dbe7f5', 0.55);
  fill.position.set(-16, 8, -12);
  scene.add(fill);

  // Rim — gentle backlight for edge separation
  const rim = new THREE.DirectionalLight('#ffffff', 0.7);
  rim.position.set(-8, 12, -20);
  scene.add(rim);

  // Studio environment for metal reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
}

/* ── Shadow catcher (invisible floor, shadow only) ─ */

function createShadowCatcher(modelGroup, THREE) {
  if (state.ground) { state.ground.removeFromParent(); if (state.ground.geometry) state.ground.geometry.dispose(); if (state.ground.material) state.ground.material.dispose(); }

  const box = new THREE.Box3().setFromObject(modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);

  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(maxDim * 2.8, maxDim * 2.8),
    new THREE.ShadowMaterial({ color: 0x7b8794, opacity: 0.10, transparent: true }),
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.set(center.x, box.min.y - maxDim * 0.035, center.z);
  catcher.receiveShadow = true;
  state.scene.add(catcher);
  state.ground = catcher;
}

/* ── Camera fit (~65% fill, breathing room) ──── */

function fitCameraOnObject(modelGroup) {
  const { THREE, camera, controls } = state;
  const box = new THREE.Box3().setFromObject(modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);

  const fovRad = camera.fov * Math.PI / 360;
  const fill = 1.3; // ~65% viewport
  const dist = fill * maxDim / (2 * Math.tan(fovRad));

  camera.position.set(center.x + dist * 0.65, center.y + dist * 0.45, center.z + dist * 0.85);
  controls.target.copy(center);
  controls.update();
}

/* ── Subtle edge lines ────────────────────────── */

function addEdgeOverlay(mesh, THREE) {
  if (state.edges) { state.edges.removeFromParent(); state.edges.geometry?.dispose(); state.edges.material?.dispose(); }

  const edgeGeo = new THREE.EdgesGeometry(mesh.geometry, 35);
  const edgeMat = new THREE.LineBasicMaterial({ color: '#2f3945', transparent: true, opacity: 0.14 });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  mesh.add(edges);
  state.edges = edges;
}

/* ── View presets ─────────────────────────────── */

function updateViewPresets(modelGroup) {
  const { THREE, camera } = state;
  const box = new THREE.Box3().setFromObject(modelGroup);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(s.x, s.y, s.z, 0.5);
  const fovRad = camera.fov * Math.PI / 360;
  const fill = 1.3;
  const dist = fill * maxDim / (2 * Math.tan(fovRad));

  views.iso   = { pos: [c.x + dist*.65, c.y + dist*.45, c.z + dist*.85], target: [c.x, c.y, c.z] };
  views.front = { pos: [c.x, c.y, c.z + dist], target: [c.x, c.y, c.z] };
  views.top   = { pos: [c.x, c.y + dist, c.z + .001], target: [c.x, c.y, c.z] };
  views.right = { pos: [c.x + dist, c.y, c.z], target: [c.x, c.y, c.z] };
}

function animateToView(posArr, targetArr) {
  const { camera, controls } = state;
  const s = { px: camera.position.x, py: camera.position.y, pz: camera.position.z, tx: controls.target.x, ty: controls.target.y, tz: controls.target.z };
  const e = { px: posArr[0], py: posArr[1], pz: posArr[2], tx: targetArr[0], ty: targetArr[1], tz: targetArr[2] };
  const start = performance.now();
  const duration = 560;
  (function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.set(lerp(s.px, e.px, ease), lerp(s.py, e.py, ease), lerp(s.pz, e.pz, ease));
    controls.target.set(lerp(s.tx, e.tx, ease), lerp(s.ty, e.ty, ease), lerp(s.tz, e.tz, ease));
    controls.update();
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

/* ── Glass toolbar (overlay, not under) ────────── */

function buildViewToolbar(container, partName) {
  const bar = document.createElement('div');
  bar.className = 'quote-3d-toolbar';
  bar.innerHTML = `
    <span class="quote-3d-part-name">${escape(partName)}</span>
    <div class="quote-3d-views">
      <button data-view="iso" class="active">Iso</button>
      <button data-view="front">Front</button>
      <button data-view="top">Top</button>
      <button data-view="right">Right</button>
    </div>`;

  container.appendChild(bar);
  bar.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const v = views[btn.dataset.view];
      if (v) animateToView(v.pos, v.target);
    });
  });
  state.toolbar = bar;
}

/* ══════════════════════════════════════════════════
   Public API
   ══════════════════════════════════════════════════ */

export async function mount(container, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { THREE, OrbitControls, STLLoader, RoomEnvironment } = await loadThree();

  if (state) dispose();

  state = { THREE, OrbitControls, STLLoader, container, opts, scene: new THREE.Scene(), animFrameId: null };

  state.camera = createCamera(container);
  state.renderer = createRenderer(container, THREE);
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;
  state.controls.minDistance = 1.5;
  state.controls.maxDistance = 200;
  state.controls.maxPolarAngle = Math.PI * 0.75;
  state.controls.update();

  setupLighting(state.scene, state.renderer, THREE, RoomEnvironment);

  /* Loading */
  const status = document.createElement('div');
  status.className = 'quote-3d-status';
  status.textContent = 'Loading 3D preview...';
  container.appendChild(status);
  state.statusEl = status;

  try {
    const url = `${opts.apiBase}/api/public/quote/model/${opts.fileId}`;
    const loader = new STLLoader();
    const geometry = await loader.loadAsync(url);
    geometry.computeVertexNormals();
    geometry.center();

    const modelGroup = new THREE.Group();
    const material = new THREE.MeshPhysicalMaterial({
      color: '#9aa3ad',
      metalness: 0.78,
      roughness: 0.34,
      clearcoat: 0.16,
      clearcoatRoughness: 0.72,
      envMapIntensity: 0.65,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    modelGroup.add(mesh);
    state.scene.add(modelGroup);
    state.modelGroup = modelGroup;

    addEdgeOverlay(mesh, THREE);
    createShadowCatcher(modelGroup, THREE);
    fitCameraOnObject(modelGroup);
    updateViewPresets(modelGroup);

    status.remove();
    buildViewToolbar(container, opts.partName);

  } catch (err) {
    status.textContent = '3D preview is unavailable. Static preview remains available.';
    console.error('3D viewer load failed:', err);
    return;
  }

  /* Render loop */
  state.animFrameId = requestAnimationFrame(function loop() {
    state.animFrameId = requestAnimationFrame(loop);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
  });
}

export function resize(container) {
  if (!state) return;
  const w = container.clientWidth || 400;
  const h = container.clientHeight || 300;
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h);
}

export function pause() {
  if (state?.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
}

export function resume(container) {
  if (!state) return;
  resize(container);
  state.animFrameId = requestAnimationFrame(function loop() {
    state.animFrameId = requestAnimationFrame(loop);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
  });
}

export function dispose() {
  if (!state) return;
  pause();
  if (state.renderer) { state.renderer.domElement.remove(); state.renderer.dispose(); }
  if (state.toolbar) state.toolbar.remove();
  if (state.statusEl) state.statusEl.remove();
  if (state.modelGroup) {
    state.modelGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
    state.modelGroup.removeFromParent();
  }
  if (state.ground) { state.ground.geometry?.dispose(); state.ground.material?.dispose(); }
  if (state.edges) { state.edges.geometry?.dispose(); state.edges.material?.dispose(); }
  if (state.controls) state.controls.dispose();
  state = null;
}

function escape(s) { return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]); }
