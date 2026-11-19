import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { INTRO_DURATION, SAMPLE_IDEAS, SAMPLE_LABEL, TEXT, type FeedLeaf, type ResponseDoc, type SceneState } from '../../shared/domain';
import { buildCloud, cloudSize, cloudSlot, type CloudWord } from '../../shared/wordCloud';
import { ApiError, getConfig, getFeed, screenCall } from '../api';
import type { LeafData } from '../three/leaves';
import { SceneMusic } from '../three/music';
import { TreeScene } from '../three/TreeScene';
import { exportXlsx } from '../ui/exporters';
import { Fallback2D } from '../ui/Fallback2D';

type Ui = 'idle' | 'intro' | 'collect' | 'finale';
interface Card extends LeafData { key: number }

function webgl() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } }
const params = new URLSearchParams(location.search);
const OPENED = 'tree-display-opened';
const key = location.pathname.replace(/\/+$/, '').slice('/ekran-'.length);
const stored = (s: Storage, k: string) => { try { return s.getItem(k); } catch { return null; } };
const store = (s: Storage, k: string, v: string) => { try { s.setItem(k, v); } catch { /* хранилище недоступно */ } };

/** Значок с подтверждением: первое нажатие подсвечивает его, второе выполняет действие. */
function ConfirmIcon({ label, onConfirm, children }: { label: string; onConfirm(): void; children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <button className={`tool${armed ? ' armed' : ''}`} title={armed ? `${label}: нажмите ещё раз` : label} aria-label={label}
    onClick={(e) => { e.stopPropagation(); if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{children}</button>;
}
const Svg = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export default function Display() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<TreeScene | null>(null);
  const music = useRef(new SceneMusic(() => fetch('/audio/music.mp3').then((r) => { if (!r.ok) throw new Error('music'); return r.arrayBuffer(); })));
  const musicEnd = useRef(0);
  const [use3d] = useState(() => webgl() && !params.has('no3d'));
  const [ui, setUi] = useState<Ui>('idle'); const uiRef = useRef<Ui>('idle');
  const [showTitle, setShowTitle] = useState(false); const [motto, setMotto] = useState(false);
  const [state, setState] = useState<SceneState | null>(null); const prev = useRef<SceneState | null>(null);
  const [online, setOnline] = useState(true);
  const [qr, setQr] = useState(''); const [shortUrl, setShortUrl] = useState('');
  const [cards, setCards] = useState<Card[]>([]); const waiting = useRef<LeafData[]>([]); const cardId = useRef(0);
  const [picked, setPicked] = useState<LeafData | null>(null);
  const [cloud, setCloud] = useState<CloudWord[]>([]); const revealTimer = useRef(0);
  const [flat, setFlat] = useState<LeafData[]>([]); const known = useRef(new Map<string, LeafData>());
  const [musicOn, setMusicOn] = useState(false); const musicWanted = useRef(false); const [bar, setBar] = useState(false);
  const reduced = useRef(matchMedia('(prefers-reduced-motion: reduce)').matches);

  const go = useCallback((u: Ui) => { uiRef.current = u; setUi(u); }, []);

  // Итог финала: сначала общие слова из ответов, затем девиз
  const revealFinale = useCallback((delay: number) => {
    clearTimeout(revealTimer.current);
    const words = buildCloud([...known.current.values()].filter((l) => !l.id.startsWith('sample-')).map((l) => l.idea));
    const useCloud = words.length >= 5;
    revealTimer.current = window.setTimeout(() => {
      if (useCloud) setCloud(words);
      revealTimer.current = window.setTimeout(() => setMotto(true), useCloud ? words.length * 450 + 1800 : 0);
    }, delay);
  }, []);
  const hideFinale = useCallback(() => { clearTimeout(revealTimer.current); setMotto(false); setCloud([]); }, []);

  const pumpCards = useCallback(() => {
    setCards((c) => {
      if (c.length >= 2 || !waiting.current.length) return c;
      const d = waiting.current.shift()!; const k = ++cardId.current;
      const ms = waiting.current.length > 4 ? 3200 : waiting.current.length > 1 ? 5000 : 8000;
      setTimeout(() => { setCards((x) => x.filter((v) => v.key !== k)); setTimeout(pumpCards, 450); }, ms);
      return [...c, { ...d, key: k }];
    });
  }, []);
  const pushCard = useCallback((d: LeafData) => { waiting.current.push(d); pumpCards(); }, [pumpCards]);

  // Сцена
  useEffect(() => {
    if (!use3d || !canvas.current) return;
    let s: TreeScene;
    try {
      s = new TreeScene(canvas.current, {
        onLeafStart: () => {}, onLeafLanded: (l) => pushCard(l), onRingPulse: () => {},
        onIntroEnd: () => { go('collect'); setShowTitle(false); },
        onFinaleStart: () => { clearTimeout(musicEnd.current); musicEnd.current = window.setTimeout(() => { music.current.stop(10); musicWanted.current = false; setMusicOn(false); }, 22000); revealFinale(reduced.current ? 300 : 7000); },
        onTick: (mode, t) => { const v = mode === 'intro' && t > 36.4 && t < 44.2; setShowTitle((p) => (p === v ? p : v)); },
      }, { reduced: reduced.current, quality: params.has('quality') ? Number(params.get('quality')) : undefined });
    } catch { return; }
    scene.current = s;
    if (params.has('debug')) (window as unknown as { __tree: TreeScene }).__tree = s;
    return () => { s.dispose(); scene.current = null; };
  }, [use3d, go, pushCard, revealFinale]);

  // QR-код из действительного адреса
  useEffect(() => {
    getConfig().catch(() => null).then((c) => {
      const base = (c?.publicUrl ?? location.origin).replace(/\/$/, ''); const url = `${base}/join`;
      setShortUrl(url.replace(/^https?:\/\//, ''));
      return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 3, width: 720, color: { dark: '#000000', light: '#ffffff' } });
    }).then(setQr).catch(() => setQr(''));
  }, []);

  const applyLeaf = useCallback((l: FeedLeaf, animate: boolean) => {
    if (l.visible && l.name && l.idea) {
      const d: LeafData = { id: l.id, leafIndex: l.leafIndex + SAMPLE_IDEAS.length, seed: l.seed, name: l.name, idea: l.idea };
      const isNew = !known.current.has(l.id); known.current.set(l.id, d);
      scene.current?.syncLeaf(d, animate);
      if (!scene.current && isNew && animate) pushCard(d);
    } else { known.current.delete(l.id); scene.current?.removeLeaf(l.id); }
  }, [pushCard]);

  const applyState = useCallback((s: SceneState, serverNow: number) => {
    const p = prev.current; prev.current = s; setState(s);
    const sc = scene.current; const m = { play: () => { if (musicWanted.current) music.current.play(); }, restart: () => { if (musicWanted.current) music.current.restart(); }, setPaused: (v: boolean) => music.current.setPaused(v) };
    if (s.phase !== 'finale') clearTimeout(musicEnd.current);
    if (!p) {
      if (s.phase === 'intro') {
        const el = (serverNow - s.phaseStartedAt) / 1000;
        if (el < INTRO_DURATION && sc && !reduced.current) { go('intro'); sc.playIntro(el); m.play(); } else { sc?.skipToCollect(); go('collect'); m.play(); }
      } else if (s.phase === 'collect') { sc?.skipToCollect(); go('collect'); m.play(); }
      else if (s.phase === 'finale') { sc?.skipToCollect(); sc?.playFinale(); go('finale'); if (!sc) revealFinale(300); }
      else sc?.setIdle();
    } else {
      if (s.phase === 'intro' && s.introRun !== p.introRun) {
        hideFinale(); go('intro'); m.restart();
        if (sc && !reduced.current) sc.playIntro(0); else { sc?.skipToCollect(); go('collect'); }
      } else if (s.phase === 'collect' && p.phase === 'intro' && s.skipRun === p.skipRun && uiRef.current === 'intro') { /* вступление доигрывает само */ }
      else if (s.phase === 'collect' && p.phase !== 'collect') { hideFinale(); sc?.skipToCollect(); go('collect'); m.play(); }
      else if (s.phase === 'finale' && p.phase !== 'finale') { go('finale'); sc?.playFinale(); if (!sc) revealFinale(300); }
    }
    sc?.setPaused(s.paused); if (!p || p.paused !== s.paused) m.setPaused(s.paused);
  }, [go, revealFinale, hideFinale]);

  // Опрос сервера
  useEffect(() => {
    let stop = false; let cursor = 0; let first = true; let epoch = -1; let timer = 0;
    const tick = async () => {
      try {
        const fresh = first && !stored(sessionStorage, OPENED);
        const f = await getFeed(key, cursor, fresh);
        store(sessionStorage, OPENED, '1');
        if (stop) return;
        setOnline(true);
        if (epoch !== -1 && epoch !== f.state.dataEpoch) {
          waiting.current = []; setCards([]);
          const full = await getFeed(key, 0); const ids = new Set(full.leaves.filter((l) => l.visible).map((l) => l.id));
          [...known.current.keys()].forEach((id) => { if (!ids.has(id) && !id.startsWith('sample-')) { known.current.delete(id); scene.current?.removeLeaf(id); } });
          full.leaves.forEach((l) => applyLeaf(l, true));
        }
        epoch = f.state.dataEpoch;
        f.leaves.forEach((l) => applyLeaf(l, !first));
        applyState(f.state, f.serverNow);
        if (first) SAMPLE_IDEAS.forEach((idea, i) => {
          const d: LeafData = { id: `sample-${i}`, leafIndex: i, seed: Math.imul(i + 1, 2654435761) >>> 0, name: SAMPLE_LABEL, idea };
          known.current.set(d.id, d); scene.current?.syncLeaf(d, f.state.phase === 'intro');
        });
        first = false; cursor = f.cursor;
        setFlat([...known.current.values()]);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { location.replace('/join'); return; }
        setOnline(false);
      }
      if (!stop) timer = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [applyLeaf, applyState]);

  const toggleMusic = useCallback(() => {
    const on = !musicWanted.current; musicWanted.current = on; setMusicOn(on);
    if (on) { clearTimeout(musicEnd.current); void music.current.unlock().catch(() => {}); music.current.play(); } else music.current.stop(1);
  }, []);

  useEffect(() => {
    let t = 0;
    const move = () => { setBar(true); clearTimeout(t); t = window.setTimeout(() => setBar(false), 2600); };
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'а') void document.documentElement.requestFullscreen?.();
      if (e.key === 'm' || e.key === 'ь') toggleMusic();
      if (e.key === 'Escape') setPicked(null);
    };
    addEventListener('mousemove', move); addEventListener('keydown', keyDown);
    return () => { removeEventListener('mousemove', move); removeEventListener('keydown', keyDown); };
  }, [toggleMusic]);
  useEffect(() => { if (!picked) return; const t = setTimeout(() => setPicked(null), 20000); return () => clearTimeout(t); }, [picked]);

  const finish = () => { void screenCall(key, 'finish').catch(() => setOnline(false)); };
  const clearAll = () => { void screenCall(key, 'clear').catch(() => setOnline(false)); };
  const download = () => { void screenCall<{ responses: ResponseDoc[] }>(key, 'list').then((r) => exportXlsx(r.responses)).catch(() => setOnline(false)); };
  const hidePicked = () => {
    if (!picked) return; const id = picked.id; setPicked(null);
    if (id.startsWith('sample-')) { known.current.delete(id); scene.current?.removeLeaf(id); setFlat([...known.current.values()]); }
    else void screenCall(key, 'hide', { id }).catch(() => setOnline(false));
  };

  return (
    <main className={`stage${bar ? ' show-cursor' : ''}`}>
      {use3d ? <canvas ref={canvas} className="gl" onClick={(e) => { const l = scene.current?.pick(e.clientX, e.clientY); if (l) setPicked(l); }} />
        : <Fallback2D leaves={flat} onPick={(id) => setPicked(known.current.get(id) ?? null)} />}
      {!online && <div className="net" role="status">Нет связи с сервером. Повторяем подключение…</div>}

      <div className={`seminar-title${showTitle ? ' on' : ''}`} aria-hidden={!showTitle}><h1>{TEXT.seminar}</h1></div>

      <aside className={`left${ui === 'collect' ? ' on' : ''}`}>
        <h1>{TEXT.title}</h1><p className="q">{TEXT.question}</p>
        <div className="cards">{cards.map((c) => <article key={c.key} className="card"><b>{c.name}</b><p>{c.idea}</p></article>)}</div>
      </aside>

      <aside className={`qr${ui === 'collect' && state?.qrVisible ? ' on' : ''}`}>
        {qr && <img src={qr} alt="QR-код для отправки идеи" />}
        <p className="how">{TEXT.instruction}</p><p className="url">{shortUrl}</p>
      </aside>

      {cloud.length > 0 && <div className="cloud" aria-label="Общие слова из идей участников">{cloud.map((w, i) => {
        const p = cloudSlot(i); const top3 = i < 3;
        return <span key={w.text} className={top3 ? 'top' : ''} style={{ [p.side]: `${p.edge}vw`, top: `${p.top}%`, fontSize: `${cloudSize(w.count, cloud[0].count, w.text.length)}vw`, animationDelay: `${i * 0.45}s` }}>{w.text}</span>;
      })}</div>}

      <div className={`motto${motto ? ' on' : ''}`} aria-hidden={!motto}><p>{TEXT.motto}</p></div>

      {picked && <div className="pick" role="dialog" onClick={() => setPicked(null)}><article><b>{picked.name}</b><p>{picked.idea}</p>
        <ConfirmIcon label="Убрать этот ответ с экрана" onConfirm={hidePicked}><Svg><path d="M3 3l18 18M10.6 5.2A9.8 9.8 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.4-2.3 3.6M6.4 6.6C4.4 8 3 10.100 2.500 12c1 2.800 4.500 7 9.500 7 1.800 0 3.400-.5 4.800-1.400" /></Svg></ConfirmIcon>
      </article></div>}

      <div className={`tools${bar ? ' on' : ''}`}>
        <button className="tool" title="Во весь экран" aria-label="Во весь экран" onClick={() => void document.documentElement.requestFullscreen?.()}><Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg></button>
        <button className="tool" title="Скачать ответы в Excel" aria-label="Скачать ответы в Excel" onClick={download}><Svg><path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 20h14" /></Svg></button>
        <ConfirmIcon label="Показать итог" onConfirm={finish}><Svg><path d="M5 21V4M5 5h12l-2.500 4 2.500 4H5" /></Svg></ConfirmIcon>
        <ConfirmIcon label="Очистить все ответы и начать заново" onConfirm={clearAll}><Svg><path d="M4 7h16M9 7V4h6v3M6.500 7l1 13h9l1-13M10 11v5M14 11v5" /></Svg></ConfirmIcon>
      </div>

      <button className={`music${musicOn ? ' on' : ''}`} onClick={toggleMusic} aria-label={musicOn ? 'Выключить музыку' : 'Включить музыку'} aria-pressed={musicOn}>
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M9 18.5V5.8l10-2v12.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="6.5" cy="18.5" r="2.5" fill="currentColor" /><circle cx="16.5" cy="16.2" r="2.5" fill="currentColor" /></svg>
      </button>
    </main>
  );
}
