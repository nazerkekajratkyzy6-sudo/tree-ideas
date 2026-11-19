import * as THREE from 'three';
import { FX_FS, FX_VS, LEAF_FS, LEAF_VS } from './shaders';
import { rng, type Slot } from './treeModel';

export interface LeafData { id: string; leafIndex: number; seed: number; name: string; idea: string }

type Stage = 'waiting' | 'assemble' | 'fly' | 'attach' | 'rest' | 'fading' | 'gone';
interface Leaf {
  data: LeafData; inst: number; stage: Stage; t: number; flight: number;
  p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; p3: THREE.Vector3;
  rest: THREE.Quaternion; spin: THREE.Vector3; scale: number; pos: THREE.Vector3; emit: number;
}

const CAPACITY = 1500;
// Красный канал задаёт сдвиг перелива для каждого листа
const TINTS = [new THREE.Color(0.08, 0, 0), new THREE.Color(0.31, 0, 0), new THREE.Color(0.57, 0, 0), new THREE.Color(0.83, 0, 0)];
const FX = 5200;

export class LeafField {
  readonly object = new THREE.Group();
  readonly uniforms = { uTime: { value: 0 }, uLeafAlpha: { value: 1 } };
  private fxUniforms = { uClock: { value: 0 }, uPx: { value: 500 } };
  private mesh: THREE.InstancedMesh;
  private tint: THREE.InstancedBufferAttribute;
  private state: THREE.InstancedBufferAttribute;
  private leaves = new Map<string, Leaf>();
  private queue: Leaf[] = [];
  private free: number[] = [];
  private cooldown = 0;
  private clock = 0;
  private fxHead = 0;
  private fxGeo: THREE.BufferGeometry;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3();
  held = true;
  reduced = false;
  onStart: (l: LeafData, pendingCount: number) => void = () => {};
  onLanded: (l: LeafData) => void = () => {};

  constructor(private slots: Slot[], private ringRadius: number, private ringY: number) {
    const g = new THREE.BufferGeometry();
    const P: number[] = []; const I: number[] = []; const rows = 10; const cols = 4;
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) P.push((c / cols) * 2 - 1, r / rows, 0);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c; const b = a + cols + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.state.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aTint', this.tint); g.setAttribute('aLeaf', this.state);
    const mat = new THREE.ShaderMaterial({ vertexShader: LEAF_VS, fragmentShader: LEAF_FS, uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending });
    this.mesh = new THREE.InstancedMesh(g, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < CAPACITY; i++) { this.mesh.setMatrixAt(i, this.m); this.free.push(CAPACITY - 1 - i); }
    this.object.add(this.mesh);

    this.fxGeo = new THREE.BufferGeometry();
    this.fxGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FX * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.fxGeo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(FX * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.fxGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(FX * 2).fill(-99), 2).setUsage(THREE.DynamicDrawUsage));
    this.fxGeo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(FX * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const fx = new THREE.Points(this.fxGeo, new THREE.ShaderMaterial({ vertexShader: FX_VS, fragmentShader: FX_FS, uniforms: this.fxUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    fx.frustumCulled = false; fx.renderOrder = 9; this.object.add(fx);
  }

  setPixelScale(px: number) { this.fxUniforms.uPx.value = px; }
  get count() { return [...this.leaves.values()].filter((l) => l.stage !== 'gone' && l.stage !== 'fading').length; }
  get pending() { return this.queue.length + [...this.leaves.values()].filter((l) => ['assemble', 'fly', 'attach'].includes(l.stage)).length; }
  has(id: string) { const l = this.leaves.get(id); return !!l && l.stage !== 'fading' && l.stage !== 'gone'; }

  private slotFor(d: LeafData) {
    const slot = this.slots[d.leafIndex % this.slots.length];
    const lap = Math.floor(d.leafIndex / this.slots.length);
    if (!lap) return { pos: slot.pos.clone(), normal: slot.normal };
    const R = rng(d.seed);
    return { pos: slot.pos.clone().add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.55)), normal: slot.normal };
  }

  add(d: LeafData, animate: boolean) {
    if (this.leaves.has(d.id)) {
      const old = this.leaves.get(d.id)!;
      if (old.stage !== 'fading' && old.stage !== 'gone') return;
      this.release(old);
    }
    const inst = this.free.pop(); if (inst === undefined) return;
    const R = rng(d.seed); const { pos, normal } = this.slotFor(d);
    const up = new THREE.Vector3((R() - 0.5) * 1.6, 0.35 + R() * 0.65, 0).normalize();
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3((R() - 0.5) * 0.5, (R() - 0.5) * 0.4 + 0.08, 1), new THREE.Vector3(), up);
    const rest = new THREE.Quaternion().setFromRotationMatrix(look);
    const c = TINTS[d.seed % TINTS.length]; this.tint.setXYZ(inst, c.r, c.g, c.b); this.tint.needsUpdate = true;
    const a = R() * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a) * this.ringRadius, this.ringY + Math.sin(a) * 0.9, Math.sin(a) * this.ringRadius);
    const p1 = p0.clone().lerp(pos, 0.3).add(new THREE.Vector3((R() - 0.5) * 5, 2 + R() * 2.5, 2 + R() * 3));
    const p2 = pos.clone().add(normal.clone().multiplyScalar(2.2)).add(new THREE.Vector3((R() - 0.5) * 2, 1 + R(), 1 + R()));
    const leaf: Leaf = {
      data: d, inst, stage: animate && !this.reduced ? 'waiting' : 'rest', t: 0, flight: 2.5, p0, p1, p2, p3: pos, rest,
      spin: new THREE.Vector3((R() - 0.5) * 5, (R() - 0.5) * 7, (R() - 0.5) * 4), scale: 0.8 + R() * 0.12, pos: pos.clone(), emit: 0,
    };
    this.leaves.set(d.id, leaf);
    if (leaf.stage === 'waiting') { this.state.setXYZ(inst, 0, 0, 0); this.queue.push(leaf); }
    else { this.place(leaf, pos, rest, leaf.scale); this.state.setXYZ(inst, 1, animate ? 0.8 : 0, 1); if (animate) this.onLanded(d); }
    this.state.needsUpdate = true;
  }

  remove(id: string) {
    const l = this.leaves.get(id); if (!l) return;
    const qi = this.queue.indexOf(l); if (qi >= 0) this.queue.splice(qi, 1);
    l.stage = 'fading'; l.t = 0;
  }
  ids() { return [...this.leaves.keys()]; }

  private release(l: Leaf) {
    this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(l.inst, this.m); this.mesh.instanceMatrix.needsUpdate = true;
    this.state.setXYZ(l.inst, 0, 0, 0); this.free.push(l.inst); this.leaves.delete(l.data.id);
  }
  private place(l: Leaf, pos: THREE.Vector3, q: THREE.Quaternion, sc: number) {
    this.s.setScalar(sc); this.m.compose(pos, q, this.s); this.mesh.setMatrixAt(l.inst, this.m); this.mesh.instanceMatrix.needsUpdate = true; l.pos.copy(pos);
  }
  private spawnFx(p: THREE.Vector3, v: THREE.Vector3, life: number, gold: boolean, delay = 0) {
    const i = this.fxHead; this.fxHead = (this.fxHead + 1) % FX;
    (this.fxGeo.attributes.position as THREE.BufferAttribute).setXYZ(i, p.x, p.y, p.z);
    (this.fxGeo.attributes.aVel as THREE.BufferAttribute).setXYZ(i, v.x, v.y, v.z);
    (this.fxGeo.attributes.aLife as THREE.BufferAttribute).setXY(i, this.clock + delay, life);
    const c = gold ? [1, 0.3, 0.86] : [0.62, 0.42, 1];
    (this.fxGeo.attributes.aCol as THREE.BufferAttribute).setXYZ(i, c[0], c[1], c[2]);
    Object.values(this.fxGeo.attributes).forEach((a) => { (a as THREE.BufferAttribute).needsUpdate = true; });
  }
  private burstIn(p: THREE.Vector3) {
    for (let i = 0; i < 46; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.8 + Math.random() * 1.3);
      const life = 0.45 + Math.random() * 0.2;
      this.spawnFx(p.clone().add(d), d.clone().multiplyScalar(-1 / life), life, i % 2 === 0, Math.random() * 0.1);
    }
  }
  private burstOut(p: THREE.Vector3) {
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.5 + Math.random() * 0.8);
      this.spawnFx(p, d, 0.6 + Math.random() * 0.4, i % 3 !== 0);
    }
  }

  update(dt: number, time: number) {
    this.clock += dt; this.fxUniforms.uClock.value = this.clock; this.uniforms.uTime.value = time;
    this.cooldown -= dt;
    if (!this.held && this.queue.length && this.cooldown <= 0) {
      const n = this.queue.length;
      const l = this.queue.shift()!;
      l.flight = n > 12 ? 1.05 : n > 3 ? 1.7 : 2.6;
      this.cooldown = n > 12 ? 0.26 : n > 3 ? 0.9 : 2.3;
      l.stage = 'assemble'; l.t = 0; this.burstIn(l.p0); this.onStart(l.data, n - 1);
    }
    let dirtyState = false;
    const v = new THREE.Vector3();
    for (const l of this.leaves.values()) {
      l.t += dt;
      if (l.stage === 'assemble') {
        const k = Math.min(1, l.t / 0.55);
        this.place(l, l.p0, l.rest, l.scale * 0.72 * k); this.state.setXYZ(l.inst, 0.25, 1.2 * (1 - k * 0.5), k); dirtyState = true;
        if (k >= 1) { l.stage = 'fly'; l.t = 0; }
      } else if (l.stage === 'fly') {
        const raw = Math.min(1, l.t / l.flight); const k = raw * raw * (3 - 2 * raw); const i = 1 - k;
        v.set(0, 0, 0).addScaledVector(l.p0, i * i * i).addScaledVector(l.p1, 3 * i * i * k).addScaledVector(l.p2, 3 * i * k * k).addScaledVector(l.p3, k * k * k);
        const tumble = (1 - k) * (1 - k) * 2.2;
        this.e.set(l.spin.x * tumble, l.spin.y * tumble, l.spin.z * tumble);
        this.q.setFromEuler(this.e).premultiply(l.rest);
        this.place(l, v, this.q, l.scale * (0.72 + 0.28 * k)); this.state.setXYZ(l.inst, 0.25 + k * 0.2, 0.6, 1); dirtyState = true;
        l.emit += dt;
        while (l.emit > 0.012) { l.emit -= 0.012; this.spawnFx(v, new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35), 0.5 + Math.random() * 0.35, Math.random() < 0.55); }
        if (raw >= 1) { l.stage = 'attach'; l.t = 0; this.burstOut(l.p3); this.onLanded(l.data); }
      } else if (l.stage === 'attach') {
        const k = Math.min(1, l.t / 1.25); const open = 1 - Math.pow(1 - Math.min(1, k * 1.6), 3);
        const pop = 1 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.26;
        this.place(l, l.p3, l.rest, l.scale * pop); this.state.setXYZ(l.inst, 0.45 + open * 0.55, 1.5 * (1 - k) * (1 - k), 1); dirtyState = true;
        if (k >= 1) { l.stage = 'rest'; this.state.setXYZ(l.inst, 1, 0, 1); }
      } else if (l.stage === 'fading') {
        const k = Math.min(1, l.t / 1.4);
        this.place(l, l.pos, l.rest, l.scale * (1 - k * 0.45)); this.state.setXYZ(l.inst, 1 - k * 0.6, 0.1, 1 - k); dirtyState = true;
        if (k >= 1) { l.stage = 'gone'; this.release(l); }
      } else if (l.stage === 'rest' && this.state.getY(l.inst) > 0) {
        this.state.setY(l.inst, Math.max(0, this.state.getY(l.inst) - dt)); dirtyState = true;
      }
    }
    if (dirtyState) this.state.needsUpdate = true;
  }

  pick(project: (p: THREE.Vector3) => { x: number; y: number }, x: number, y: number, radius: number): LeafData | null {
    let best: LeafData | null = null; let bd = radius * radius;
    for (const l of this.leaves.values()) {
      if (l.stage !== 'rest') continue;
      const s = project(l.pos); const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = l.data; }
    }
    return best;
  }
}
