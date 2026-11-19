import { useMemo } from 'react';
import { rng } from '../three/treeModel';

interface L { id: string; seed: number; leafIndex: number }
type B = [number, number, number, number, number];

/** Упрощённая сцена для компьютеров без WebGL. */
export function Fallback2D({ leaves, onPick }: { leaves: L[]; onPick(id: string): void }) {
  const branches = useMemo(() => {
    const R = rng(7); const out: B[] = [];
    const go = (x: number, y: number, a: number, l: number, w: number, d: number) => {
      const x2 = x + Math.cos(a) * l; const y2 = y + Math.sin(a) * l; out.push([x, y, x2, y2, w]);
      if (d > 0) for (let i = 0; i < 3; i++) go(x2, y2, a + (i - 1) * (0.42 + R() * 0.25), l * (0.68 + R() * 0.12), w * 0.62, d - 1);
    };
    go(800, 800, -Math.PI / 2, 210, 22, 6); return out;
  }, []);
  const tips = useMemo(() => branches.slice(-500), [branches]);
  return (
    <svg className="fallback" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Дерево идей">
      <ellipse cx="800" cy="300" rx="560" ry="82" fill="none" stroke="#f2bd62" strokeWidth="3" />
      {branches.map((b, i) => <line key={i} x1={b[0]} y1={b[1]} x2={b[2]} y2={b[3]} stroke={i % 3 ? '#79c9ff' : '#f2bd62'} strokeWidth={b[4]} strokeLinecap="round" opacity=".82" />)}
      {leaves.map((l) => { const t = tips[(l.leafIndex * 37) % tips.length]; return <ellipse key={l.id} cx={t[2]} cy={t[3]} rx="17" ry="9" fill={['#bfe9ff', '#e4ebf5', '#f6cf85'][l.seed % 3]} transform={`rotate(${l.seed % 180} ${t[2]} ${t[3]})`} onClick={() => onPick(l.id)} style={{ cursor: 'pointer' }} />; })}
    </svg>
  );
}
