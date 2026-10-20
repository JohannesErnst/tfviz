import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ---------- Data model ---------- */
// Angles are stored in radians. Convention (ROS / REP-103): R = Rz(yaw) * Ry(pitch) * Rx(roll), z up.
const DEG = Math.PI / 180;
const FIELDS = [
  { key: 'x', angle: false }, { key: 'y', angle: false }, { key: 'z', angle: false },
  { key: 'roll', angle: true }, { key: 'pitch', angle: true }, { key: 'yaw', angle: true },
];
const DEFAULTS = {
  f1: { x: 1, y: 0.5, z: 0.3, roll: 0, pitch: 0, yaw: 45 * DEG },
  f2: { x: 1.2, y: 0, z: 0.6, roll: 30 * DEG, pitch: 0, yaw: 0 },
};
const POS_LIMIT = 5;
const POSITION_SNAP_STEP = 0.25;
const ANGLE_SNAP_STEP = Math.PI / 4;
const DEFAULT_FRAME_SIZE = 0.8;
const snapState = { f1: false, f2: false };
let state = structuredClone(DEFAULTS);
let unit = 'rad';
let frameSize = DEFAULT_FRAME_SIZE;
const coordinateHistory = [];
const coordinateRedoHistory = [];
let coordinateEdit = null;

function sameState(a, b) {
  return ['f1', 'f2'].every((key) => FIELDS.every((field) => a[key][field.key] === b[key][field.key]));
}

function pushCoordinateHistory(snapshot) {
  coordinateHistory.push(snapshot);
  if (coordinateHistory.length > 100) coordinateHistory.shift();
  coordinateRedoHistory.length = 0;
}

function pushCoordinateRedoHistory(snapshot) {
  coordinateRedoHistory.push(snapshot);
  if (coordinateRedoHistory.length > 100) coordinateRedoHistory.shift();
}

function beginCoordinateEdit(element, mode) {
  if (coordinateEdit?.element === element) return;
  coordinateEdit = { element, mode, snapshot: structuredClone(state), recorded: false };
}

function recordCoordinateEdit(key, field, value) {
  if (state[key][field] === value) return;
  if (!coordinateEdit) coordinateEdit = { snapshot: structuredClone(state), recorded: false };
  if (!coordinateEdit.recorded) {
    pushCoordinateHistory(coordinateEdit.snapshot);
    coordinateEdit.recorded = true;
  }
}

function endCoordinateEdit(element, mode) {
  if (!coordinateEdit) return;
  if (element && coordinateEdit.element !== element) return;
  if (mode && coordinateEdit.mode !== mode) return;
  coordinateEdit = null;
}

function recordCoordinateChange(change) {
  const snapshot = structuredClone(state);
  change();
  if (!sameState(snapshot, state)) pushCoordinateHistory(snapshot);
}

function undoCoordinateChange() {
  const previous = coordinateHistory.pop();
  if (!previous) return;
  pushCoordinateRedoHistory(structuredClone(state));
  state = previous;
  coordinateEdit = null;
  refreshInputs();
  update();
}

function redoCoordinateChange() {
  const next = coordinateRedoHistory.pop();
  if (!next) return;
  coordinateHistory.push(structuredClone(state));
  state = next;
  coordinateEdit = null;
  refreshInputs();
  update();
}

/* --------------- Three.js scene --------------- */
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2e33);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
camera.up.set(0, 0, 1);
camera.position.set(4.5, -4.5, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1, 0.5, 0.5);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.7));
const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.6);
sun.position.set(3, -2, 6);
scene.add(sun);

const grid = new THREE.GridHelper(20, 20, 0x666b73, 0x44484f);
grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ by default; move it to XY
scene.add(grid);

function makeAxes(len, radius) {
  const g = new THREE.Group();
  const axes = [
    [0xff3b3b, new THREE.Euler(0, 0, -Math.PI / 2), [len / 2, 0, 0]], // x
    [0x3bdc3b, new THREE.Euler(0, 0, 0),            [0, len / 2, 0]], // y
    [0x4a7dff, new THREE.Euler(Math.PI / 2, 0, 0),  [0, 0, len / 2]], // z
  ];
  for (const [color, rot, pos] of axes) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, len, 16),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.rotation.copy(rot);
    mesh.position.set(...pos);
    g.add(mesh);
  }
  return g;
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2f2f2';
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(0.8, 0.3, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function makeLink() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xf5c542, dashSize: 0.08, gapSize: 0.05 }));
  line.frustumCulled = false;
  scene.add(line);
  return line;
}

const frames = {
  world: { obj: makeAxes(1.0, 0.012), label: makeLabel('world') },
  f1:    { obj: makeAxes(0.8, 0.03),  label: makeLabel('frame 1') },
  f2:    { obj: makeAxes(0.8, 0.03),  label: makeLabel('frame 2') },
};
for (const f of Object.values(frames)) scene.add(f.obj, f.label);
const links = { f1: makeLink(), f2: makeLink() }; // child -> parent

function setLink(line, a, b) {
  const p = line.geometry.attributes.position;
  p.set([a.x, a.y, a.z, b.x, b.y, b.z]);
  p.needsUpdate = true;
  line.computeLineDistances();
}

function poseMatrix(p) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.roll, p.pitch, p.yaw, 'ZYX')), // = Rz*Ry*Rx
    new THREE.Vector3(1, 1, 1)
  );
}

const labelOffset = new THREE.Vector3(0.1, 0.1, 0.1);
const fmt = (n, w = 8, d = 3) => (Math.abs(n) < 5e-4 ? 0 : n).toFixed(d).padStart(w);

function update() {
  const m1 = poseMatrix(state.f1);
  const m2 = m1.clone().multiply(poseMatrix(state.f2)); // T_world_frame2 = T_world_frame1 * T_frame1_frame2

  const origin = new THREE.Vector3();
  const p1 = new THREE.Vector3().setFromMatrixPosition(m1);
  const p2 = new THREE.Vector3().setFromMatrixPosition(m2);
  m1.decompose(frames.f1.obj.position, frames.f1.obj.quaternion, frames.f1.obj.scale);
  m2.decompose(frames.f2.obj.position, frames.f2.obj.quaternion, frames.f2.obj.scale);
  frames.f1.obj.scale.setScalar(frameSize);
  frames.f2.obj.scale.setScalar(frameSize);
  frames.world.label.position.copy(origin).add(labelOffset);
  frames.f1.label.position.copy(p1).add(labelOffset);
  frames.f2.label.position.copy(p2).add(labelOffset);
  setLink(links.f1, p1, origin);
  setLink(links.f2, p2, p1);

  const e = new THREE.Euler().setFromRotationMatrix(m2, 'ZYX'); // x=roll, y=pitch, z=yaw
  const k = unit === 'deg' ? 1 / DEG : 1;
  const u = unit === 'deg' ? 'deg' : 'rad';
  const d = unit === 'deg' ? 2 : 4;
  const r = m2.elements;
  const row = (i) => [r[i], r[i + 4], r[i + 8], r[i + 12]].map((v) => fmt(v)).join(' ');
  document.getElementById('result').textContent =
    `x ${fmt(p2.x)}   y ${fmt(p2.y)}   z ${fmt(p2.z)}\n` +
    `roll ${fmt(e.x * k, 8, d)}  pitch ${fmt(e.y * k, 8, d)}  yaw ${fmt(e.z * k, 8, d)}  (${u})\n\n` +
    `[${row(0)}]\n[${row(1)}]\n[${row(2)}]\n[${fmt(0)} ${fmt(0)} ${fmt(0)} ${fmt(1)}]`;

  saveHash();
}

/* ---------- Input panel ---------- */
const inputs = { f1: {}, f2: {} };
const toUI = (v, f) => (f.angle && unit === 'deg' ? v / DEG : v);
const fromUI = (v, f) => (f.angle && unit === 'deg' ? v * DEG : v);
const rounded = (v, f) => Number(v.toFixed(4));

function snapValueInUI(value, field) {
  if (field.angle) {
    if (unit === 'deg') {
      const snapped = Math.round(value / 45) * 45;
      return Math.min(180, Math.max(-180, snapped));
    }
    const snapped = Math.round(value / ANGLE_SNAP_STEP) * ANGLE_SNAP_STEP;
    return Math.min(Math.PI, Math.max(-Math.PI, snapped));
  }

  const snapped = Math.round((value + POS_LIMIT) / POSITION_SNAP_STEP) * POSITION_SNAP_STEP - POS_LIMIT;
  return Math.min(POS_LIMIT, Math.max(-POS_LIMIT, snapped));
}

function buildPanel(key, title) {
  const el = document.getElementById(key);
  const header = document.createElement('div');
  header.className = 'panel-header';

  const heading = document.createElement('h2');
  heading.textContent = title;

  const zeroButton = document.createElement('button');
  zeroButton.type = 'button';
  zeroButton.textContent = 'Zero';
  zeroButton.addEventListener('click', () => {
    recordCoordinateChange(() => {
      for (const f of FIELDS) state[key][f.key] = 0;
      refreshInputs();
      update();
    });
  });

  const snapButton = document.createElement('button');
  snapButton.type = 'button';
  snapButton.className = 'toggle-button';
  snapButton.textContent = 'Snap';
  snapButton.setAttribute('aria-pressed', String(false));
  snapButton.addEventListener('click', () => {
    snapState[key] = !snapState[key];
    snapButton.classList.toggle('active', snapState[key]);
    snapButton.setAttribute('aria-pressed', String(snapState[key]));
    refreshInputs();
    update();
  });

  header.append(heading, zeroButton, snapButton);
  el.appendChild(header);

  for (const f of FIELDS) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label for="${key}-${f.key}-n">${f.key}</label><input type="range" aria-label="${title} ${f.key}"><input type="number" id="${key}-${f.key}-n">`;
    const [, range, num] = row.children;
    const onInput = (src, other) => () => {
      const v = parseFloat(src.value);
      if (!Number.isFinite(v)) return;
      let value = v;
      if (snapState[key] && src === range) value = snapValueInUI(value, f);
      const coordinateValue = fromUI(value, f);
      recordCoordinateEdit(key, f.key, coordinateValue);
      state[key][f.key] = coordinateValue;
      const display = rounded(toUI(state[key][f.key], f), f);
      if (src === range) src.value = String(display); // slider needs the snapped value; the number box must not be rewritten while typing
      other.value = String(display);
      update();
    };
    if (range) {
      range.addEventListener('pointerdown', () => beginCoordinateEdit(range, 'pointer'));
      range.addEventListener('keydown', (event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey) beginCoordinateEdit(range, 'keyboard');
      });
      range.addEventListener('blur', () => endCoordinateEdit(range));
    }
    num.addEventListener('focus', () => beginCoordinateEdit(num, 'text'));
    num.addEventListener('blur', () => endCoordinateEdit(num));
    range.addEventListener('input', onInput(range, num));
    num.addEventListener('input', onInput(num, range));
    inputs[key][f.key] = { range, num, f };
    el.appendChild(row);
  }

  const poseInput = document.createElement('input');
  poseInput.type = 'text';
  poseInput.className = 'pose-input';
  poseInput.placeholder = 'x=, y=, z=, roll=, pitch=, yaw= (or x: )';
  poseInput.setAttribute('aria-label', `${title} pose string`);
  poseInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    recordCoordinateChange(() => {
      const assignments = /\b(x|y|z|roll|pitch|yaw)\s*[=:]\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)/gi;
      for (const match of poseInput.value.matchAll(assignments)) {
        const field = FIELDS.find((candidate) => candidate.key === match[1].toLowerCase());
        const value = Number(match[2]);
        if (field && Number.isFinite(value)) state[key][field.key] = fromUI(value, field);
      }
      refreshInputs();
      update();
    });
  });
  el.appendChild(poseInput);
}

function refreshInputs() {
  for (const key of ['f1', 'f2']) {
    for (const { range, num, f } of Object.values(inputs[key])) {
      const lim = f.angle ? (unit === 'deg' ? 180 : Math.PI) : POS_LIMIT;
      const step = f.angle ? (unit === 'deg' ? 1 : 0.01) : 0.01;
      Object.assign(range, { min: -lim, max: lim, step });
      num.step = step;
      const display = rounded(toUI(state[key][f.key], f), f);
      range.value = String(display);
      num.value = String(display);
    }
  }
}

/* ---------- Share state via the URL hash ---------- */
function saveHash() {
  const p = new URLSearchParams();
  for (const key of ['f1', 'f2']) p.set(key, FIELDS.map((f) => +state[key][f.key].toFixed(4)).join(','));
  p.set('unit', unit);
  p.set('frameSize', frameSize.toFixed(1));
  history.replaceState(null, '', '#' + p);
}
function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const key of ['f1', 'f2']) {
    const vals = (p.get(key) || '').split(',').map(parseFloat);
    if (vals.length === FIELDS.length && vals.every(Number.isFinite)) FIELDS.forEach((f, i) => (state[key][f.key] = vals[i]));
  }
  const u = p.get('unit');
  if (u === 'deg' || u === 'rad') unit = u;
  const size = Number(p.get('frameSize'));
  if (Number.isFinite(size) && size >= 0.1 && size <= 1 && Math.round(size * 10) === size * 10) frameSize = size;
}

/* ---------- Wiring ---------- */
const unitSelect = document.getElementById('unit');
unitSelect.addEventListener('change', () => { unit = unitSelect.value; refreshInputs(); update(); });
window.addEventListener('pointerup', () => endCoordinateEdit(undefined, 'pointer'));
window.addEventListener('keyup', () => endCoordinateEdit(undefined, 'keyboard'));
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
    if (coordinateHistory.length) {
      event.preventDefault();
      undoCoordinateChange();
    }
  } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'y') {
    if (coordinateRedoHistory.length) {
      event.preventDefault();
      redoCoordinateChange();
    }
  }
});
const frameSizeInput = document.getElementById('frame-size');
const frameSizeValue = document.getElementById('frame-size-value');
frameSizeInput.addEventListener('input', () => {
  frameSize = Number(frameSizeInput.value);
  frameSizeValue.value = frameSize.toFixed(1);
  update();
});
document.getElementById('reset').addEventListener('click', () => {
  recordCoordinateChange(() => {
    state = structuredClone(DEFAULTS);
    refreshInputs();
    update();
  });
  frameSize = DEFAULT_FRAME_SIZE;
  frameSizeInput.value = String(frameSize);
  frameSizeValue.value = frameSize.toFixed(1);
  update();
});

loadHash();
unitSelect.value = unit;
frameSizeInput.value = String(frameSize);
frameSizeValue.value = frameSize.toFixed(1);
buildPanel('f1', 'Frame 1 (relative to world)');
buildPanel('f2', 'Frame 2 (relative to frame 1)');
refreshInputs();
update();

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
