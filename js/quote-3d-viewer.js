/**
 * Quote 3D Viewer — self-contained Three.js module for STEP preview.
 *
 * Usage:
 *   const mod = await import('./quote-3d-viewer.js');
 *   await mod.mount(container, { apiBase, fileId, partName });
 *   mod.resize(container);        // after tab switch / window resize
 *   mod.dispose(container);       // cleanup
 *
 * Dependencies: Three.js via importmap, STLLoader, OrbitControls.
 */

let state = null;

/* ── Internal helpers ────────────────────────── */

const DEFAULT_OPTIONS = {
  apiBase: 'http://127.0.0.1:5000',
  fileId: '',
  partName: 'Part',
};

function lerp(a, b, t) { return a + (b - a) * t; }

async function loadThree() {
  const [THREE, { OrbitControls }, { STLLoader }] = await Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/loaders/STLLoader.js'),
  ]);
  return { THREE, OrbitControls, STLLoader };
}

function createCamera(container) {
  const { THREE } = state;
  const w = container.clientWidth || 400;
  const h = container.clientHeight || 300;
  const cam = new THREE.PerspectiveCamera(40, w / h, 0.5, 3000);
  cam.position.set(8, 5, 10);
  return cam;
}

function createRenderer(container, THREE) {
  const w = container.clientWidth || 400;
  const h = container.clientHeight || 300;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(w, h);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  r.domElement.style.display = 'block';
  r.domElement.style.width = '100%';
  r.domElement.style.height = '100%';
  container.appendChild(r.domElement);
  return r;
}

function setupLighting(scene, THREE) {
  scene.add(new THREE.AmbientLight('#c8cdd3', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 3.2);
  key.position.set(15, 20, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 200;
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  state.keyLight = key;

  const fill = new THREE.DirectionalLight('#b8c4d4', 1.2);
  fill.position.set(-10, 5, -5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#ffffff', 1.0);
  rim.position.set(0, -2, -15);
  scene.add(rim);
}

function createGround(modelGroup, THREE) {
  const box = new THREE.Box3().setFromObject(modelGroup);
  const groundY = box.min.y - 0.8;

  if (state.ground) { state.ground.removeFromParent(); state.ground.geometry?.dispose(); state.ground.material?.dispose(); }

  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: '#e0e0e5', roughness: 0.9, metalness: 0 }),
  );
  g.rotation.x = -Math.PI / 2;
  g.position.y = groundY;
  g.receiveShadow = true;
  state.scene.add(g);
  state.ground = g;
}

function fitCameraOnObject(modelGroup, container) {
  const { THREE, camera, controls } = state;
  const box = new THREE.Box3().setFromObject(modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);

  const fovRad = camera.fov * Math.PI / 360;
  const fill = 1.6; /* ~55% viewport */
  const dist = fill * maxDim / (2 * Math.tan(fovRad));

  camera.position.set(center.x + dist * 0.65, center.y + dist * 0.45, center.z + dist * 0.85);
  controls.target.copy(center);
  controls.update();
}

function addEdgeOverlay(mesh, THREE) {
  if (state.edges) { state.edges.removeFromParent(); state.edges.geometry?.dispose(); state.edges.material?.dispose(); }

  const edgeGeo = new THREE.EdgesGeometry(mesh.geometry, 35);
  const edgeMat = new THREE.LineBasicMaterial({ color: '#2f3945', transparent: true, opacity: 0.28 });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  mesh.add(edges);
  state.edges = edges;
}

/* ── View controls ───────────────────────────── */

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

function updateViewPresets(modelGroup, container) {
  const { THREE, camera } = state;
  const box = new THREE.Box3().setFromObject(modelGroup);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(s.x, s.y, s.z, 0.5);
  const fovRad = camera.fov * Math.PI / 360;
  const dist = 1.6 * maxDim / (2 * Math.tan(fovRad));

  views.iso   = { pos: [c.x + dist*.65, c.y + dist*.45, c.z + dist*.85], target: [c.x, c.y, c.z] };
  views.front = { pos: [c.x, c.y, c.z + dist], target: [c.x, c.y, c.z] };
  views.top   = { pos: [c.x, c.y + dist, c.z + .01], target: [c.x, c.y, c.z] };
  views.right = { pos: [c.x + dist, c.y, c.z], target: [c.x, c.y, c.z] };
}
const views = {};

function animateToView(posArr, targetArr) {
  const { camera, controls } = state;
  const s = { px: camera.position.x, py: camera.position.y, pz: camera.position.z, tx: controls.target.x, ty: controls.target.y, tz: controls.target.z };
  const e = { px: posArr[0], py: posArr[1], pz: posArr[2], tx: targetArr[0], ty: targetArr[1], tz: targetArr[2] };
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / 500, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.set(lerp(s.px, e.px, ease), lerp(s.py, e.py, ease), lerp(s.pz, e.pz, ease));
    controls.target.set(lerp(s.tx, e.tx, ease), lerp(s.ty, e.ty, ease), lerp(s.tz, e.tz, ease));
    controls.update();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ── Public API ──────────────────────────────── */

export async function mount(container, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { THREE, OrbitControls, STLLoader } = await loadThree();

  if (state) dispose(container);

  state = { THREE, OrbitControls, STLLoader, container, opts, scene: new THREE.Scene(), animFrameId: null };

  state.camera = createCamera(container);
  state.renderer = createRenderer(container, THREE);
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;
  state.controls.minDistance = 2;
  state.controls.maxDistance = 200;
  state.controls.maxPolarAngle = Math.PI * 0.75;
  state.controls.update();

  setupLighting(state.scene, THREE);

  /* Loading indicator */
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
    const material = new THREE.MeshStandardMaterial({ color: '#8f98a3', roughness: 0.42, metalness: 0.45 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    modelGroup.add(mesh);
    state.scene.add(modelGroup);
    state.modelGroup = modelGroup;

    addEdgeOverlay(mesh, THREE);
    createGround(modelGroup, THREE);
    fitCameraOnObject(modelGroup, container);
    updateViewPresets(modelGroup, container);

    status.remove();
    buildViewToolbar(container, opts.partName);

    const tris = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    console.log(`3D Viewer: ${Math.round(tris).toLocaleString()} faces loaded`);

  } catch (err) {
    status.textContent = '3D preview is unavailable. Static preview remains available.';
    console.error('3D viewer load failed:', err);
    return;
  }

  /* Render loop */
  function loop() {
    state.animFrameId = requestAnimationFrame(loop);
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
  }
  loop();
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
  if (state?.animFrameId) {
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
  }
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
  if (state.renderer) {
    state.renderer.domElement.remove();
    state.renderer.dispose();
  }
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
