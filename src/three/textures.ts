import * as THREE from 'three';
import { rng } from './treeModel';

const CYAN = '#6fd0ff'; const GOLD = '#f2bd62'; const PALE = '#bfe9ff';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}
function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function traces(g: CanvasRenderingContext2D, w: number, h: number, n: number, R: () => number, cell: number) {
  for (let i = 0; i < n; i++) {
    let x = Math.round(R() * w / cell) * cell; let y = Math.round(R() * h / cell) * cell;
    const gold = R() < 0.36;
    g.strokeStyle = gold ? GOLD : CYAN; g.fillStyle = g.strokeStyle;
    g.globalAlpha = 0.16 + R() * R() * 0.8; g.lineWidth = R() < 0.14 ? 3 : 1.25;
    g.beginPath(); g.moveTo(x, y);
    const legs = 2 + Math.floor(R() * 5);
    for (let k = 0; k < legs; k++) {
      const len = cell * (1 + Math.floor(R() * 9));
      const m = Math.floor(R() * 3);
      if (m === 0) x += R() < 0.5 ? len : -len; else if (m === 1) y += R() < 0.5 ? len : -len;
      else { const s = R() < 0.5 ? 1 : -1; x += len * s; y += len * (R() < 0.5 ? 1 : -1); }
      g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}

export function floorTexture() {
  const R = rng(71); const { c, g } = canvas(2048, 2048);
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 2048);
  g.strokeStyle = '#3c78b8'; g.globalAlpha = 0.2; g.lineWidth = 1;
  for (let i = 0; i <= 2048; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 2048); g.moveTo(0, i); g.lineTo(2048, i); g.stroke(); }
  traces(g, 2048, 2048, 260, R, 32);
  for (let i = 0; i < 90; i++) {
    g.globalAlpha = 0.1 + R() * 0.3; g.fillStyle = R() < 0.4 ? GOLD : CYAN;
    g.fillRect(Math.floor(R() * 64) * 32, Math.floor(R() * 64) * 32, 32 * (1 + Math.floor(R() * 3)), 6);
  }
  const t = tex(c, true); t.repeat.set(5, 5); return t;
}

export function wallTexture() {
  const R = rng(19); const { c, g } = canvas(2048, 1024);
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 120; i++) {
    const w = 30 + R() * 180; const h = 24 + R() * 130; const x = R() * 2048; const y = R() * 1024;
    g.globalAlpha = 0.05 + R() * 0.16; g.fillStyle = R() < 0.25 ? '#c58a35' : '#2a6da8'; g.fillRect(x, y, w, h);
    g.globalAlpha = 0.25 + R() * 0.3; g.strokeStyle = R() < 0.3 ? GOLD : CYAN; g.lineWidth = 1; g.strokeRect(x, y, w, h);
  }
  traces(g, 2048, 1024, 170, R, 24);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(R() * 40) * 52; g.globalAlpha = 0.28 + R() * 0.5; g.strokeStyle = R() < 0.6 ? GOLD : CYAN; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke();
  }
  return tex(c, true);
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, R: () => number) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = 0.25 + R() * 0.75; g.fillStyle = R() < 0.12 ? '#fff' : R() < 0.5 ? PALE : CYAN;
    const s = R() < 0.1 ? 3 : 1.6; g.fillRect(R() * w, R() * h, s, s);
  }
  g.globalAlpha = 1;
}

export function bookCover(kind: 'ring' | 'lines') {
  const R = rng(kind === 'ring' ? 5 : 8); const { c, g } = canvas(512, 680);
  g.fillStyle = '#10365f'; g.fillRect(0, 0, 512, 680);
  speckle(g, 512, 680, 15000, R);
  g.strokeStyle = PALE; g.lineWidth = 5; g.strokeRect(20, 20, 472, 640);
  g.shadowColor = CYAN; g.shadowBlur = 16; g.strokeStyle = '#e8f8ff';
  if (kind === 'ring') {
    g.lineWidth = 34; g.beginPath(); g.arc(256, 320, 112, 0, 7); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(256, 320, 160, 0, 7); g.stroke();
  } else {
    g.lineWidth = 15; g.lineCap = 'round';
    [190, 250, 310, 370, 430].forEach((y, i) => { g.beginPath(); g.moveTo(112, y); g.lineTo(i % 2 ? 330 : 400, y); g.stroke(); });
  }
  return tex(c);
}

export function panelTexture(kind: number) {
  const R = rng(300 + kind); const { c, g } = canvas(512, 340);
  g.fillStyle = '#0c315a'; g.fillRect(0, 0, 512, 340);
  g.strokeStyle = CYAN; g.lineWidth = 4; g.strokeRect(5, 5, 502, 330);
  g.fillStyle = PALE; g.fillRect(28, 28, 170, 12); g.globalAlpha = 0.5; g.fillRect(28, 50, 110, 7); g.globalAlpha = 1;
  if (kind % 3 === 0) {
    for (let i = 0; i < 8; i++) { const h = 40 + R() * 180; g.fillStyle = i % 3 === 1 ? GOLD : CYAN; g.fillRect(44 + i * 54, 305 - h, 34, h); }
  } else if (kind % 3 === 1) {
    g.strokeStyle = GOLD; g.lineWidth = 6; g.beginPath();
    for (let i = 0; i <= 12; i++) { const x = 34 + i * 37; const y = 245 - i * 10 - R() * 62; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    g.strokeStyle = CYAN; g.globalAlpha = 0.45; g.lineWidth = 1;
    for (let y = 100; y < 320; y += 44) { g.beginPath(); g.moveTo(30, y); g.lineTo(482, y); g.stroke(); }
    g.globalAlpha = 1;
  } else {
    g.lineWidth = 30; [[0, 2.5, CYAN], [2.5, 4.4, GOLD], [4.4, 6.28, PALE]].forEach(([a, b, col]) => {
      g.strokeStyle = col as string; g.beginPath(); g.arc(150, 200, 78, a as number, b as number); g.stroke();
    });
    g.fillStyle = PALE; for (let i = 0; i < 6; i++) { g.globalAlpha = 0.85 - i * 0.1; g.fillRect(286, 120 + i * 32, 110 + R() * 90, 10); }
    g.globalAlpha = 1;
  }
  return tex(c);
}

export function glowSprite() {
  const { c, g } = canvas(256, 256);
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, 'rgba(255,250,225,1)'); r.addColorStop(0.14, 'rgba(255,214,130,.85)');
  r.addColorStop(0.42, 'rgba(240,160,60,.16)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  return tex(c);
}
