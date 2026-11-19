import * as THREE from 'three';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Seg {
  a: THREE.Vector3; b: THREE.Vector3; ra: number; rb: number; depth: number;
  kind: 'root' | 'trunk' | 'branch'; birthA: number; birthB: number; distA: number; distB: number;
}
export interface Slot { pos: THREE.Vector3; normal: THREE.Vector3; seed: number }

export interface PointCloud { positions: Float32Array; birth: Float32Array; data: Float32Array; dist: Float32Array; count: number }
export interface LineCloud { positions: Float32Array; birth: Float32Array; dist: Float32Array; alpha: Float32Array }

export interface TreeModel {
  segs: Seg[]; roots: PointCloud; tree: PointCloud; crown: PointCloud;
  veins: LineCloud; rootVeins: LineCloud; plexus: LineCloud; slots: Slot[];
}

const TRUNK_TOP = 4.5;
const INTRO = { rootA: 6.4, rootB: 12.8, trunkA: 13.2, trunkB: 19.6, branchA: 20, branchB: 26.8, crownB: 28 };

export function buildTree(seed = 20112026): TreeModel {
  const R = rng(seed);
  const rand = (a: number, b: number) => a + (b - a) * R();
  const segs: Seg[] = [];

  // ── Ствол: расширение у основания и лёгкий изгиб
  const trunkPts: THREE.Vector3[] = [];
  const trunkR = (t: number) => 0.44 + 0.24 * (1 - t) + 0.66 * Math.pow(1 - t, 7);
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    trunkPts.push(new THREE.Vector3(Math.sin(t * 2.4) * 0.07, t * TRUNK_TOP, Math.cos(t * 1.8) * 0.05 - 0.05));
  }
  for (let i = 0; i < N; i++) {
    const t0 = i / N; const t1 = (i + 1) / N;
    segs.push({
      a: trunkPts[i], b: trunkPts[i + 1], ra: trunkR(t0), rb: trunkR(t1), depth: 0, kind: 'trunk',
      birthA: INTRO.trunkA + (INTRO.trunkB - INTRO.trunkA) * t0, birthB: INTRO.trunkA + (INTRO.trunkB - INTRO.trunkA) * t1,
      distA: t0 * TRUNK_TOP, distB: t1 * TRUNK_TOP,
    });
  }

  // ── Ветви
  const MAX_DEPTH = 6;
  const branchSegs: Seg[] = [];
  const grow = (start: THREE.Vector3, dir0: THREE.Vector3, len: number, r0: number, depth: number, dist0: number) => {
    const steps = Math.max(4, Math.round(len / 0.32));
    const dir = dir0.clone().normalize();
    let p = start.clone(); let dist = dist0;
    const stepLen = len / steps;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      dir.add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.8), rand(-1, 1)).multiplyScalar(0.11)).normalize();
      // Крона раскрывается шире вверху и не опускается к полу
      dir.y += 0.02 - Math.max(0, p.y - 10.8) * 0.24; dir.x -= Math.max(0, Math.hypot(p.x, p.z) - 6.6) * 0.09 * Math.sign(p.x); dir.z -= Math.max(0, Math.hypot(p.x, p.z) - 6.6) * 0.09 * Math.sign(p.z); dir.normalize();
      const q = p.clone().addScaledVector(dir, stepLen);
      const ra = r0 * (1 - t * 0.55); const rb = r0 * (1 - ((i + 1) / steps) * 0.55);
      branchSegs.push({ a: p, b: q, ra, rb, depth, kind: 'branch', birthA: 0, birthB: 0, distA: dist, distB: dist + stepLen });
      dist += stepLen; p = q;
      if (depth < MAX_DEPTH - 1 && i > 0 && i < steps - 1 && R() < 0.2) {
        const side = dir.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.7), rand(-1, 1)).multiplyScalar(0.95));
        grow(p, side, len * rand(0.42, 0.62), r0 * 0.46, depth + 1, dist);
      }
    }
    if (depth < MAX_DEPTH) {
      const kids = depth < 2 ? 3 : R() < 0.55 ? 3 : 2;
      for (let k = 0; k < kids; k++) {
        const az = (k / kids) * Math.PI * 2 + rand(-0.5, 0.5);
        const axis = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const d = dir.clone().addScaledVector(axis, rand(0.55, 0.95)); d.y += rand(-0.06, 0.2);
        grow(p, d, len * rand(0.66, 0.84), r0 * 0.62, depth + 1, dist);
      }
    }
  };
  const top = trunkPts[N];
  const mains = 6;
  for (let i = 0; i < mains; i++) {
    const az = (i / mains) * Math.PI * 2 + 0.35 + rand(-0.14, 0.14);
    const startT = 0.74 + (i % 3) * 0.09;
    const start = trunkPts[Math.round(startT * N)].clone();
    const d = new THREE.Vector3(Math.cos(az), rand(0.62, 0.95), Math.sin(az) * 0.82);
    grow(start, d, rand(2.25, 2.65), 0.22, 1, startT * TRUNK_TOP);
  }
  grow(top, new THREE.Vector3(0.04, 1, 0.02), 1.9, 0.24, 1, TRUNK_TOP);

  const maxDist = branchSegs.reduce((m, s) => Math.max(m, s.distB), 0);
  const bBirth = (d: number) => INTRO.branchA + (INTRO.branchB - INTRO.branchA) * Math.pow(Math.max(0, d - 3) / (maxDist - 3), 0.82);
  branchSegs.forEach((s) => { s.birthA = bBirth(s.distA); s.birthB = bBirth(s.distB); });
  segs.push(...branchSegs);

  // ── Корни под прозрачным полом
  const rootSegs: Seg[] = [];
  const growRoot = (start: THREE.Vector3, dir0: THREE.Vector3, len: number, r0: number, depth: number, dist0: number) => {
    const steps = Math.max(4, Math.round(len / 0.3));
    const dir = dir0.clone().normalize();
    let p = start.clone(); let dist = dist0;
    for (let i = 0; i < steps; i++) {
      dir.add(new THREE.Vector3(rand(-1, 1), rand(-0.24, 0.2), rand(-1, 1)).multiplyScalar(0.17)).normalize();
      const q = p.clone().addScaledVector(dir, len / steps);
      q.y = Math.min(q.y, -0.05); q.y = Math.max(q.y, -1.5); q.z = Math.min(q.z, 3.6);
      rootSegs.push({ a: p, b: q, ra: r0 * (1 - (i / steps) * 0.6), rb: r0 * (1 - ((i + 1) / steps) * 0.6), depth, kind: 'root', birthA: 0, birthB: 0, distA: dist, distB: dist + len / steps });
      dist += len / steps; p = q;
    }
    if (depth < 5) {
      const kids = depth < 2 ? 3 : 2;
      for (let k = 0; k < kids; k++) {
        const d = dir.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.34, 0.2), rand(-1, 1)).multiplyScalar(0.9));
        growRoot(p, d, len * rand(0.62, 0.82), r0 * 0.62, depth + 1, dist);
      }
    }
  };
  for (let i = 0; i < 8; i++) {
    const az = (i / 8) * Math.PI * 2 + rand(-0.2, 0.2);
    growRoot(new THREE.Vector3(Math.cos(az) * 0.4, -0.04, Math.sin(az) * 0.4), new THREE.Vector3(Math.cos(az), -0.18, Math.sin(az)), rand(1.5, 2), 0.15, 1, 0);
  }
  const maxRoot = rootSegs.reduce((m, s) => Math.max(m, s.distB), 0);
  rootSegs.forEach((s) => {
    s.birthA = INTRO.rootA + (INTRO.rootB - INTRO.rootA) * Math.pow(s.distA / maxRoot, 0.85);
    s.birthB = INTRO.rootA + (INTRO.rootB - INTRO.rootA) * Math.pow(s.distB / maxRoot, 0.85);
    s.distA = -s.distA; s.distB = -s.distB;
  });
  segs.push(...rootSegs);

  // ── Частицы на поверхности
  const sampleSegs = (list: Seg[], budget: number, weight: (s: Seg) => number, goldChance: (s: Seg) => number): PointCloud => {
    const weights = list.map(weight); const total = weights.reduce((a, b) => a + b, 0);
    const P: number[] = []; const B: number[] = []; const D: number[] = []; const W: number[] = [];
    const axis = new THREE.Vector3(); const u = new THREE.Vector3(); const v = new THREE.Vector3(); const pt = new THREE.Vector3();
    list.forEach((s, idx) => {
      const n = Math.max(2, Math.round((weights[idx] / total) * budget));
      axis.subVectors(s.b, s.a).normalize();
      u.set(0.31, 0.87, 0.38).cross(axis).normalize(); v.crossVectors(axis, u);
      for (let i = 0; i < n; i++) {
        const t = R(); const ang = R() * Math.PI * 2;
        const rad = (s.ra + (s.rb - s.ra) * t) * Math.pow(R(), 0.28);
        pt.lerpVectors(s.a, s.b, t).addScaledVector(u, Math.cos(ang) * rad).addScaledVector(v, Math.sin(ang) * rad);
        P.push(pt.x, pt.y, pt.z); B.push(s.birthA + (s.birthB - s.birthA) * t + R() * 0.28);
        D.push(R(), R() < goldChance(s) ? 1 : R() * 0.22, 0.45 + Math.pow(R(), 3) * 1.5); W.push(s.distA + (s.distB - s.distA) * t);
      }
    });
    return shuffled(P, B, D, W, R);
  };
  const roots = sampleSegs(rootSegs, 15000, (s) => s.a.distanceTo(s.b) * (s.ra + 0.04), () => 0.3);
  const tree = sampleSegs(segs.filter((s) => s.kind !== 'root'), 54000, (s) => s.a.distanceTo(s.b) * (s.ra + 0.018) * (s.kind === 'trunk' ? 4.5 : 1), (s) => (s.kind === 'trunk' ? 0.07 : 0.2));

  // ── Мерцающая крона
  const tips = branchSegs.filter((s) => s.depth >= 4);
  const cP: number[] = []; const cB: number[] = []; const cD: number[] = []; const cW: number[] = [];
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  for (let i = 0; i < 26000; i++) {
    const s = tips[Math.floor(R() * tips.length)]; const spread = 0.5 + R() * R() * 1.7;
    const x = s.b.x + gauss() * spread; const y = s.b.y + gauss() * spread; const z = s.b.z + gauss() * spread;
    cP.push(x, y, z); cB.push(Math.min(INTRO.crownB - 0.2, s.birthB + 0.5 + R() * 2.4));
    cD.push(R(), R() < 0.2 ? 1 : R() * 0.2, 0.3 + Math.pow(R(), 4) * 1.9); cW.push(s.distB);
  }
  const crown = shuffled(cP, cB, cD, cW, R);

  // ── Золотые жилы
  const line = () => ({ p: [] as number[], b: [] as number[], d: [] as number[], a: [] as number[] });
  const v = line(); const rv = line();
  const pushLine = (L: ReturnType<typeof line>, a: THREE.Vector3, b: THREE.Vector3, ba: number, bb: number, da: number, db: number, al: number) => {
    L.p.push(a.x, a.y, a.z, b.x, b.y, b.z); L.b.push(ba, bb); L.d.push(da, db); L.a.push(al, al);
  };
  segs.forEach((s) => {
    const strands = s.kind === 'trunk' ? 6 : s.depth <= 2 && s.kind === 'branch' ? 4 : 1;
    const alpha = s.kind === 'trunk' ? 0.85 : Math.max(0.2, 1 - s.depth * 0.14);
    for (let k = 0; k < strands; k++) {
      const off = (p: THREE.Vector3, r: number, tw: number) => strands === 1 ? p : p.clone().add(new THREE.Vector3(Math.cos(k * 2.399 + tw) * r * 0.82, 0, Math.sin(k * 2.399 + tw) * r * 0.82));
      const a = off(s.a, s.ra, s.distA * 0.32); const b = off(s.b, s.rb, s.distB * 0.32);
      pushLine(s.kind === 'root' ? rv : v, a, b, s.birthA, s.birthB, s.distA, s.distB, alpha);
    }
  });

  // ── Соединительные линии кроны
  const nodes: THREE.Vector3[] = []; const nodeBirth: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const s = tips[Math.floor(R() * tips.length)];
    nodes.push(new THREE.Vector3(s.b.x + gauss() * 0.8, s.b.y + gauss() * 0.8, s.b.z + gauss() * 0.8));
    nodeBirth.push(Math.min(INTRO.crownB - 0.2, s.birthB + 1 + R() * 1.6));
  }
  const pl = line();
  nodes.forEach((n, i) => {
    let made = 0;
    for (let j = i + 1; j < nodes.length && made < 3; j++) {
      if (n.distanceToSquared(nodes[j]) < 0.72) { pushLine(pl, n, nodes[j], nodeBirth[i], nodeBirth[j], 0, 0, 0.5); made++; }
    }
  });

  // ── Места для листьев: распределение с учётом плотности и глубины
  const candidates: Slot[] = [];
  const crownC = new THREE.Vector3(0, 7.2, 0);
  branchSegs.filter((s) => s.depth >= 3 && s.b.y > 4.9).forEach((s) => {
    const n = s.b.clone().sub(crownC).normalize();
    const side = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(0.16);
    candidates.push({ pos: s.b.clone().add(side), normal: n, seed: Math.floor(R() * 1e9) });
  });
  const pool = candidates.slice(); const slots: Slot[] = [];
  const pick = (i: number) => { slots.push(pool[i]); pool[i] = pool[pool.length - 1]; pool.pop(); };
  pick(Math.floor(R() * pool.length));
  while (pool.length && slots.length < 1400) {
    let best = 0; let bestScore = -1;
    for (let c = 0; c < 18; c++) {
      const i = Math.floor(R() * pool.length); let minD = Infinity;
      for (let k = Math.max(0, slots.length - 260); k < slots.length; k++) minD = Math.min(minD, pool[i].pos.distanceToSquared(slots[k].pos));
      const score = minD * (1 + 0.28 * (pool[i].normal.z + 1));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    pick(best);
  }

  const toLine = (L: ReturnType<typeof line>): LineCloud => ({
    positions: new Float32Array(L.p), birth: new Float32Array(L.b), dist: new Float32Array(L.d), alpha: new Float32Array(L.a),
  });
  return { segs, roots, tree, crown, veins: toLine(v), rootVeins: toLine(rv), plexus: toLine(pl), slots };
}

function shuffled(P: number[], B: number[], D: number[], W: number[], R: () => number): PointCloud {
  const n = B.length;
  const positions = new Float32Array(n * 3); const birth = new Float32Array(n); const data = new Float32Array(n * 3); const dist = new Float32Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((o, i) => {
    positions.set([P[o * 3], P[o * 3 + 1], P[o * 3 + 2]], i * 3); birth[i] = B[o];
    data.set([D[o * 3], D[o * 3 + 1], D[o * 3 + 2]], i * 3); dist[i] = W[o];
  });
  return { positions, birth, data, dist, count: n };
}
