import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { INTRO_DURATION } from '../../shared/domain';
import { LeafField, type LeafData } from './leaves';
import {
  FLOOR_FS, FLOOR_VS, LINE_FS, LINE_VS, POINT_FS, POINT_VS, RING_FS, RING_VS, SWIRL_FS, SWIRL_VS, WALL_FS,
} from './shaders';
import { bookCover, floorTexture, glowSprite, panelTexture, wallTexture } from './textures';
import { buildTree, rng, type LineCloud, type PointCloud } from './treeModel';

type Mode = 'idle' | 'intro' | 'collect' | 'finaleWait' | 'finale';
const RING_R = 8.3; const RING_Y = 6.5;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// t, позиция камеры, точка взгляда
const KEYS: [number, number[], number[]][] = [
  [0, [0, 6.2, 11], [0, 5, 0]], [4, [0.6, 5, 7.6], [0, 3.6, 0]], [6, [1.6, 2.5, 8], [0, 0.2, 0]],
  [9, [4.5, 2.6, 11.5], [0, -0.7, 0]], [13, [-4.8, 3.3, 15], [0, -0.7, 0]], [16, [-3.6, 2.6, 12.5], [0, 2, 0]],
  [20, [2.4, 4.8, 14], [0, 4.5, 0]], [24, [5.2, 6.8, 17], [0, 6, 0]], [28, [3.2, 7.4, 20], [0, 6.4, 0]],
  [32, [-8.5, 8.2, 20.5], [0, 6, 0]], [36, [-4.5, 6.6, 24], [0, 5.2, 0]], [42, [0, 5.7, 24.5], [0, 4.85, 0]],
  [45, [0, 5.7, 24.5], [0, 4.85, 0]],
];
const HOME = new THREE.Vector3(0, 5.7, 24.5); const HOME_T = new THREE.Vector3(0, 4.85, 0);

function keyframe(t: number, idx: 1 | 2, out: THREE.Vector3) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const k = (j: number) => KEYS[Math.max(0, Math.min(KEYS.length - 1, j))];
  const [t0, t1] = [k(i)[0], k(i + 1)[0]]; const u = clamp01((t - t0) / (t1 - t0));
  const u2 = u * u; const u3 = u2 * u;
  for (let c = 0; c < 3; c++) {
    const p0 = k(i)[idx][c]; const p1 = k(i + 1)[idx][c];
    const m0 = i === 0 ? 0 : ((p1 - k(i - 1)[idx][c]) / (t1 - k(i - 1)[0])) * (t1 - t0);
    const m1 = i + 2 >= KEYS.length ? 0 : ((k(i + 2)[idx][c] - p0) / (k(i + 2)[0] - t0)) * (t1 - t0);
    out.setComponent(c, (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1);
  }
}

interface Holo { obj: THREE.Object3D; mats: { m: THREE.Material & { opacity: number }; o: number }[]; at: number; base: THREE.Vector3; rot: THREE.Euler; phase: number }

export interface SceneEvents {
  onLeafStart(l: LeafData, pending: number): void;
  onLeafLanded(l: LeafData): void;
  onRingPulse(): void;
  onIntroEnd(): void;
  onFinaleStart(): void;
  onTick(mode: Mode, t: number): void;
}

export class TreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private pts: { p: THREE.Points; full: number }[] = [];
  private lines: { l: THREE.LineSegments; full: number }[] = [];
  private common = { uT: { value: 0 }, uTime: { value: 0 }, uRise: { value: -20 }, uBreath: { value: 1 } };
  private ptU = { uPx: { value: 520 } };
  private floorU: Record<string, THREE.IUniform>;
  private wallU: Record<string, THREE.IUniform>;
  private swirlU: Record<string, THREE.IUniform>;
  private ringU = { uArc: { value: 0 }, uPulse: { value: 0 }, uPulseAmp: { value: 0 }, uGlow: { value: 0 }, uAlpha: { value: 1 } };
  private ring = new THREE.Group();
  private ringSpin = 0; private pulseT = 9;
  private spark: THREE.Sprite;
  private holos: Holo[] = [];
  private leaves: LeafField;
  private mode: Mode = 'idle';
  private t = 0; private time = 0; private finaleT = 0; private settle = 1;
  private paused = false; private raf = 0; private last = 0; private frozen = false;
  private tier = 2; private fpsAcc = 0; private fpsN = 0; private lockTier = false;
  private camPos = new THREE.Vector3(); private camTgt = new THREE.Vector3();
  private w = 1; private h = 1; private distK = 1; private dim = 1;

  constructor(private canvas: HTMLCanvasElement, private ev: SceneEvents, private opts: { reduced: boolean; quality?: number }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x020614, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x030a1f);
    const model = buildTree();

    // Фон и пол
    const floorMap = floorTexture();
    this.floorU = { uMap: { value: floorMap }, uRoom: { value: 0 }, uTime: this.common.uTime, uContact: { value: 0 }, uRipple: { value: 0 }, uRepeat: { value: 7 }, uBase: { value: 0 } };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.ShaderMaterial({
      vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS, uniforms: this.floorU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    floor.rotation.x = -Math.PI / 2; floor.renderOrder = 3; this.scene.add(floor);
    const tint = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.MeshBasicMaterial({ color: 0x020716, transparent: true, opacity: 0.6, depthWrite: false }));
    tint.rotation.x = -Math.PI / 2; tint.position.y = -0.005; tint.renderOrder = 2; this.scene.add(tint);

    const wallMap = wallTexture();
    this.wallU = { uMap: { value: wallMap }, uRoom: { value: 0 }, uTime: this.common.uTime };
    const wallMat = new THREE.ShaderMaterial({ vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader: WALL_FS, uniforms: this.wallU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const wall = (w: number, h: number, pos: number[], ry: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(pos[0], pos[1], pos[2]); m.rotation.y = ry; m.renderOrder = 0; this.scene.add(m); };
    wall(84, 42, [0, 15, -30], 0); wall(70, 42, [-36, 15, 2], Math.PI / 2); wall(70, 42, [36, 15, 2], -Math.PI / 2);

    // Дерево
    const pointMat = (mirror: boolean, gain: number) => new THREE.ShaderMaterial({
      vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.common, ...this.ptU, uMirror: { value: mirror ? 1 : 0 }, uGain: { value: gain } },
    });
    const addPoints = (c: PointCloud, order: number, gain: number, mirror = false) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3)); g.setAttribute('aBirth', new THREE.BufferAttribute(c.birth, 1));
      g.setAttribute('aData', new THREE.BufferAttribute(c.data, 3)); g.setAttribute('aDist', new THREE.BufferAttribute(c.dist, 1));
      const p = new THREE.Points(g, pointMat(mirror, gain)); p.frustumCulled = false; p.renderOrder = order; p.userData.gain = gain; this.scene.add(p);
      this.pts.push({ p, full: mirror ? Math.floor(c.count * 0.55) : c.count });
      return p;
    };
    const lineMat = (color: number, opacity: number, mirror: boolean) => new THREE.ShaderMaterial({
      vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...this.common, uOpacity: { value: opacity }, uColor: { value: new THREE.Color(color) }, uMirror: { value: mirror ? 1 : 0 } },
    });
    const addLines = (c: LineCloud, color: number, opacity: number, order: number, mirror = false) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3)); g.setAttribute('aBirth', new THREE.BufferAttribute(c.birth, 1));
      g.setAttribute('aDist', new THREE.BufferAttribute(c.dist, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(c.alpha, 1));
      const l = new THREE.LineSegments(g, lineMat(color, opacity, mirror)); l.frustumCulled = false; l.renderOrder = order; this.scene.add(l);
      this.lines.push({ l, full: c.birth.length });
    };
    addPoints(model.roots, 1, 0.5); addLines(model.rootVeins, 0xffbd5c, 0.5, 1);
    addPoints(model.tree, 1, 0.6, true); addLines(model.veins, 0xffbd5c, 0.4, 1, true);
    addLines(model.plexus, 0x69c6ff, 0.16, 4); addLines(model.veins, 0xffbd5c, 0.3, 5);
    addPoints(model.tree, 5, 0.24); addPoints(model.crown, 6, 0.26);

    // Искра и потоки вступления
    const glow = glowSprite();
    this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
    this.spark.renderOrder = 12; this.scene.add(this.spark);
    const R = rng(404); const n = 9000; const pos = new Float32Array(n * 3); const rnd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rnd.set([R(), R(), i % 2], i * 3);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 3));
    this.swirlU = { uTime: this.common.uTime, uSparkY: { value: 5 }, uSwirl: { value: 0 }, uRiseFlow: { value: 0 }, uFlowTop: { value: 0 }, uPx: this.ptU.uPx };
    const swirl = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: SWIRL_VS, fragmentShader: SWIRL_FS, uniforms: this.swirlU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    swirl.frustumCulled = false; swirl.renderOrder = 11; this.scene.add(swirl);

    // Кольцо
    const addRing = (tube: number, alpha: number) => {
      const tg = new THREE.TorusGeometry(RING_R, tube, 8, 360); const angles = new Float32Array(tg.attributes.position.count);
      for (let i = 0; i < angles.length; i++) { const a = Math.atan2(tg.attributes.position.getY(i), tg.attributes.position.getX(i)); angles[i] = a < 0 ? a + Math.PI * 2 : a; }
      tg.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
      const mat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: { ...this.ringU, uAlpha: { value: alpha } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(tg, mat); m.rotation.x = Math.PI / 2; m.renderOrder = 7; this.ring.add(m);
    };
    addRing(0.03, 1); addRing(0.1, 0.13);
    this.ring.position.y = RING_Y; this.ring.rotation.x = 0.17; this.scene.add(this.ring);

    this.buildHolos();
    this.leaves = new LeafField(model.slots, RING_R, RING_Y);
    this.leaves.reduced = opts.reduced;
    this.leaves.onStart = (l, p) => { this.firePulse(); this.ev.onRingPulse(); this.ev.onLeafStart(l, p); };
    this.leaves.onLanded = (l) => this.ev.onLeafLanded(l);
    this.scene.add(this.leaves.object);

    if (opts.quality !== undefined) { this.tier = opts.quality; this.lockTier = true; }
    this.applyTier();
    window.addEventListener('resize', this.resize); this.resize();
    this.applyTimeline(0); this.loop(performance.now());
  }

  private buildHolos() {
    const R = rng(88);
    const add = (obj: THREE.Object3D, at: number) => {
      const mats: Holo['mats'] = [];
      obj.traverse((o) => { const m = (o as THREE.Mesh).material as (THREE.Material & { opacity: number }) | undefined; if (m) { mats.push({ m, o: m.opacity }); m.opacity = 0; } });
      obj.visible = false; obj.renderOrder = 6; this.scene.add(obj);
      this.holos.push({ obj, mats, at, base: obj.position.clone(), rot: obj.rotation.clone(), phase: R() * 7 });
    };
    const basic = (o: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...o });
    const book = (kind: 'ring' | 'lines', p: number[], r: number[], at: number) => {
      const g = new THREE.Group(); const w = 2.7; const h = 3.6; const d = 0.62;
      const cover = bookCover(kind);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic({ map: cover, opacity: 0.95 })); front.position.z = d / 2;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic({ color: 0x1d5a92, opacity: 0.4 })); back.position.z = -d / 2;
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.96, d * 0.86), basic({ color: 0xe6a6d8, opacity: 0.85 })); pages.position.x = w / 2;
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(w * 0.97, 0.05, d * 0.86), basic({ color: 0xd8a2e0, opacity: 0.7 })); bottom.position.y = -h / 2;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), new THREE.LineBasicMaterial({ color: 0x9fe2ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(back, pages, bottom, front, edges); g.position.set(p[0], p[1], p[2]); g.rotation.set(r[0], r[1], r[2]); add(g, at);
    };
    book('ring', [-10.4, 2.3, 1], [0.12, 0.5, 0.28], 30); book('lines', [10.4, 2.3, 1], [0.12, -0.5, -0.28], 30.6);

    const geos = [new THREE.IcosahedronGeometry(0.72), new THREE.OctahedronGeometry(0.72), new THREE.BoxGeometry(0.95, 0.95, 0.95), new THREE.DodecahedronGeometry(0.62)];
    const spots = [[-5.2, 3.1, 4], [4.4, 2.5, 4.5], [-7.7, 8.4, -1], [7.1, 9.2, -1.5], [-3.4, 11, -2.5], [3.9, 11.1, -2], [-8.8, 6.3, 1], [8.8, 6, 1], [-6.1, 10.4, 1], [6.2, 7.7, 3]];
    spots.forEach((p, i) => {
      const g = new THREE.Group(); const geo = geos[i % geos.length];
      g.add(new THREE.Mesh(geo, basic({ color: 0x4faee8, opacity: 0.13 })));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: i % 3 === 2 ? 0xffc873 : 0xa6e4ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })));
      g.position.set(p[0], p[1], p[2]); g.rotation.set(R() * 3, R() * 3, R() * 3); g.scale.setScalar(0.75 + R() * 0.6); add(g, 29 + i * 0.42);
    });
    const panels = [[-8.5, 10.5, -3, 0.34], [8.2, 10.8, -3, -0.34], [-11.5, 7.2, -4, 0.5], [11.5, 7.4, -4, -0.5], [-4.8, 12.3, -6, 0.12], [4.9, 12.2, -6, -0.12]];
    panels.forEach((p, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.66), basic({ map: panelTexture(i), opacity: 0.8 }));
      m.position.set(p[0], p[1], p[2]); m.rotation.y = p[3]; add(m, 30.5 + i * 0.5);
    });
  }

  private applyTier() {
    const dpr = Math.min(window.devicePixelRatio || 1, [1, 1.25, 1.5][this.tier]);
    this.renderer.setPixelRatio(dpr);
    const frac = [0.36, 0.66, 1][this.tier];
    this.pts.forEach(({ p, full }) => {
      p.geometry.setDrawRange(0, Math.floor(full * frac));
      const u = (p.material as THREE.ShaderMaterial).uniforms.uGain; u.value = (p.userData.gain as number) * (this.tier === 0 ? 2.1 : 1) * this.dim;
    });
    if (this.tier === 0) { this.composer?.dispose(); this.composer = null; this.bloom = null; }
    else if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 288), 0.34, 0.5, 0.62);
      this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth; const h = this.canvas.clientHeight || window.innerHeight;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.distK = Math.max(1, (16 / 9) / this.camera.aspect); this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.composer?.setPixelRatio(pr); this.composer?.setSize(w, h);
    this.bloom?.setSize(Math.floor(w * pr * 0.5), Math.floor(h * pr * 0.5));
    const px = (h * pr) / 1080 * 62;
    this.ptU.uPx.value = px; this.leaves?.setPixelScale(px * 1.1);
  };

  private setDim(v: number) {
    this.dim = v;
    this.pts.forEach(({ p }) => { (p.material as THREE.ShaderMaterial).uniforms.uGain.value = (p.userData.gain as number) * (this.tier === 0 ? 2.1 : 1) * v; });
  }

  private firePulse() { this.pulseT = 0; }

  private applyTimeline(t: number) {
    this.common.uT.value = t;
    const f = this.floorU; const s = this.swirlU;
    f.uRoom.value = smooth(5.6, 14, t) * 0.92 + 0.04;
    this.wallU.uRoom.value = smooth(6, 16, t);
    f.uContact.value = smooth(5.7, 6.1, t);
    f.uRipple.value = t < 5.9 ? 0 : (t - 5.9) * 5.5;
    f.uBase.value = smooth(5.8, 6.3, t) * (0.52 + 0.9 * (1 - smooth(6.1, 8, t)));
    const sparkY = t < 2.5 ? 5 : 5 * (1 - smooth(2.5, 5.9, t));
    s.uSparkY.value = sparkY; s.uSwirl.value = smooth(0.4, 2, t) * (1 - smooth(5, 6.2, t));
    s.uRiseFlow.value = smooth(12.8, 13.8, t) * (1 - smooth(19.2, 21, t));
    s.uFlowTop.value = 0.8 + 5 * smooth(13, 19.6, t);
    const sv = smooth(0.1, 0.9, t) * (1 - smooth(6, 7, t));
    this.spark.position.set(0, sparkY + 0.04, 0); this.spark.visible = sv > 0.002;
    (this.spark.material as THREE.SpriteMaterial).opacity = sv;
    this.spark.scale.setScalar((0.8 + smooth(0, 5, t) * 0.9 + (t > 5.5 ? smooth(5.5, 6, t) * 2.2 : 0)) * (0.92 + 0.08 * Math.sin(t * 7)));

    this.ringU.uArc.value = smooth(28, 32, t);
    if (t >= 31.6 && t < 34) { this.ringU.uPulse.value = ((t - 31.6) / 2.4) * Math.PI * 2; this.ringU.uPulseAmp.value = Math.sin(clamp01((t - 31.6) / 2.4) * Math.PI); }
    this.ring.visible = t > 28;
    this.holos.forEach((h) => {
      const k = smooth(h.at, h.at + 1.7, t); h.obj.visible = k > 0.002;
      h.mats.forEach(({ m, o }) => { m.opacity = o * k; });
      h.obj.userData.k = k;
    });
  }

  private updateHolos() {
    this.holos.forEach((h) => {
      if (!h.obj.visible) return;
      const k = h.obj.userData.k as number; const reduce = this.opts.reduced ? 0 : 1;
      h.obj.position.y = h.base.y + (Math.sin(this.time * 0.42 + h.phase) * 0.2 * reduce) - (1 - k) * 0.9;
      h.obj.rotation.y = h.rot.y + Math.sin(this.time * 0.2 + h.phase) * 0.13 * reduce;
      h.obj.rotation.x = h.rot.x + Math.cos(this.time * 0.17 + h.phase) * 0.06 * reduce;
      h.obj.scale.setScalar((h.obj.userData.s0 ??= h.obj.scale.x) * (0.72 + 0.28 * k));
    });
  }

  private updateCamera(dt: number) {
    if (this.mode === 'intro' || this.mode === 'idle') {
      keyframe(this.mode === 'idle' ? 0 : this.t, 1, this.camPos); keyframe(this.mode === 'idle' ? 0 : this.t, 2, this.camTgt);
    } else {
      const orbit = this.opts.reduced ? 0 : Math.sin(this.time * 0.09) * 0.75; const bob = this.opts.reduced ? 0 : Math.sin(this.time * 0.13) * 0.12;
      const back = smooth(0, 7, this.finaleT);
      this.camPos.set(HOME.x + orbit * (1 - back) + Math.sin(back * Math.PI) * 2.2, HOME.y + bob + back * 1.15, HOME.z + back * 4.8);
      this.camTgt.copy(HOME_T); this.camTgt.y += back * 0.45;
    }
    this.camera.position.copy(this.camPos); if (this.distK > 1) this.camera.position.sub(this.camTgt).multiplyScalar(this.distK).add(this.camTgt);
    this.camera.lookAt(this.camTgt); void dt;
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.frozen) return;
    const dt = Math.min(0.1, (now - this.last) / 1000 || 0); this.last = now;
    this.step(this.paused ? 0 : dt);
    this.render();
    if (!this.lockTier && !this.paused && dt > 0) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 3.5) {
        const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
        if (fps < 29 && this.tier > 0) { this.tier--; this.applyTier(); }
      }
    }
  };

  private render() { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

  private step(dt: number) {
    this.time += dt; this.common.uTime.value = this.time;
    if (this.mode === 'intro') {
      this.t += dt; this.applyTimeline(Math.min(this.t, INTRO_DURATION));
      if (this.t >= INTRO_DURATION) this.enterCollect(false);
    }
    this.ringSpin += dt * (this.opts.reduced ? 0.02 : 0.07); this.ring.rotation.y = this.ringSpin;
    this.pulseT += dt;
    if (this.mode === 'collect' || this.mode === 'finaleWait' || this.mode === 'finale') {
      if (this.pulseT < 1.5) { this.ringU.uPulse.value = (this.pulseT / 1.5) * Math.PI * 2; this.ringU.uPulseAmp.value = Math.sin((this.pulseT / 1.5) * Math.PI); } else if (this.mode !== 'finale') this.ringU.uPulseAmp.value = 0;
      this.settle = Math.min(1, this.settle + dt / 1.8); this.leaves.uniforms.uLeafAlpha.value = this.settle;
    }
    if (this.mode === 'finaleWait' && this.leaves.pending === 0) { this.mode = 'finale'; this.finaleT = 0; this.ev.onFinaleStart(); }
    if (this.mode === 'finale') {
      this.finaleT += dt; const f = this.finaleT;
      this.ringU.uPulse.value = smooth(1, 9, f) * Math.PI * 2; this.ringU.uPulseAmp.value = smooth(1, 2, f) * (1 - smooth(8.5, 10, f));
      this.ringSpin += dt * 0.78 * Math.sin(clamp01((f - 1) / 8) * Math.PI);
      this.common.uRise.value = f < 2.5 ? -20 : -3.4 + (f - 2.5) * 2.5;
      this.ringU.uGlow.value = smooth(6, 10, f) * 0.7; this.common.uBreath.value = 1 + smooth(5, 10, f) * 0.9;
    }
    const dimTarget = this.mode === 'intro' || this.mode === 'idle' ? 1 : 0.5;
    if (Math.abs(this.dim - dimTarget) > 0.002) this.setDim(this.dim + (dimTarget - this.dim) * Math.min(1, dt * 1.6));
    this.leaves.update(dt, this.time); this.updateHolos(); this.updateCamera(dt);
    this.ev.onTick(this.mode, this.t);
  }

  private enterCollect(instantLeaves: boolean) {
    this.mode = 'collect'; this.t = INTRO_DURATION; this.applyTimeline(INTRO_DURATION);
    this.common.uRise.value = -20; this.common.uBreath.value = 1; this.ringU.uGlow.value = 0; this.finaleT = 0;
    this.settle = instantLeaves ? 1 : 0; this.leaves.held = false; this.leaves.uniforms.uLeafAlpha.value = this.settle;
    this.ev.onIntroEnd();
  }

  playIntro(from = 0) {
    if (this.opts.reduced) return this.enterCollect(true);
    this.mode = 'intro'; this.t = from; this.finaleT = 0; this.leaves.held = true; this.leaves.uniforms.uLeafAlpha.value = 0;
    this.common.uRise.value = -20; this.applyTimeline(from);
  }
  skipToCollect() { this.enterCollect(true); }
  setIdle() { this.mode = 'idle'; this.t = 0; this.leaves.held = true; this.leaves.uniforms.uLeafAlpha.value = 0; this.applyTimeline(0); }
  playFinale(instant = false) {
    if (this.mode === 'finale' || this.mode === 'finaleWait') return;
    if (this.mode !== 'collect') this.enterCollect(true);
    this.mode = 'finaleWait'; this.finaleT = instant ? 12 : 0;
  }
  setPaused(p: boolean) { this.paused = p; }
  syncLeaf(d: LeafData, animate: boolean) { this.leaves.add(d, animate); }
  removeLeaf(id: string) { this.leaves.remove(id); }
  hasLeaf(id: string) { return this.leaves.has(id); }
  leafIds() { return this.leaves.ids(); }
  get leafCount() { return this.leaves.count; }

  pick(x: number, y: number): LeafData | null {
    const v = new THREE.Vector3();
    return this.leaves.pick((p) => { v.copy(p).project(this.camera); return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h }; }, x, y, Math.max(26, this.h * 0.03));
  }

  /** Служебный режим для проверки кадров: показывает заданный момент сцены. */
  debugSeek(t: number, mode: 'intro' | 'collect' | 'finale' = 'intro', finaleT = 0) {
    this.frozen = true; this.time = t;
    this.common.uTime.value = t;
    if (mode === 'intro') { this.mode = 'intro'; this.t = t; this.applyTimeline(t); this.leaves.uniforms.uLeafAlpha.value = 0; }
    else { this.setDim(0.5); this.mode = 'collect'; this.t = INTRO_DURATION; this.applyTimeline(INTRO_DURATION); this.settle = 1; this.leaves.held = false; this.leaves.uniforms.uLeafAlpha.value = 1; }
    if (mode === 'finale') { this.mode = 'finale'; this.finaleT = finaleT - 0.001; this.step(0.001); }
    else { this.leaves.update(0, t); this.updateHolos(); this.updateCamera(0); }
    this.render();
  }
  debugAdvance(seconds: number) { this.frozen = true; const n = Math.ceil(seconds * 30); for (let i = 0; i < n; i++) this.step(1 / 30); this.render(); }

  dispose() { cancelAnimationFrame(this.raf); window.removeEventListener('resize', this.resize); this.renderer.dispose(); }
}
