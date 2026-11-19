import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS, TEXT } from '../../shared/domain';
import { ApiError, getConfig, submitIdea, uuid } from '../api';

function deviceId() {
  try {
    const k = 'tree-device'; let v = localStorage.getItem(k);
    if (!v) { v = uuid(); localStorage.setItem(k, v); }
    return v;
  } catch { return uuid(); }
}

export default function Join() {
  const [name, setName] = useState(''); const [idea, setIdea] = useState(''); const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [err, setErr] = useState(''); const [closed, setClosed] = useState(false);
  const submission = useRef(uuid()); const opened = useRef(Date.now());

  useEffect(() => { getConfig().then((c) => setClosed(!c.accepting)).catch(() => {}); }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setErr('');
    try {
      await submitIdea({ name, idea, website, submissionId: submission.current, deviceId: deviceId(), elapsedMs: Date.now() - opened.current });
      setDone(true);
    } catch (x) {
      const a = x as ApiError;
      if (a.code === 'closed') setClosed(true); else setErr(a.message);
    } finally { setBusy(false); }
  };
  const again = () => { submission.current = uuid(); opened.current = Date.now(); setIdea(''); setDone(false); };

  return (
    <main className="paper join">
      <header className="join-head">
        <svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true"><ellipse cx="32" cy="25" rx="27" ry="7" fill="none" stroke="#b8862f" strokeWidth="2" /><path d="M32 58V14M32 34 20 21M32 29l12-13M32 43l-9-8" stroke="#1d4f86" strokeWidth="3.4" strokeLinecap="round" fill="none" /></svg>
        <h1>{TEXT.title}</h1>
        <p>{TEXT.question}</p>
      </header>
      {done ? (
        <section className="sheet done" role="status">
          <div className="tick" aria-hidden="true">✓</div>
          <h2>{TEXT.success}</h2>
          {!closed && <button className="btn" onClick={again}>Отправить ещё одну идею</button>}
        </section>
      ) : closed ? (
        <section className="sheet done" role="status"><h2>Приём идей завершён. Спасибо за участие!</h2></section>
      ) : (
        <form className="sheet" onSubmit={send}>
          <label>Имя и фамилия
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={LIMITS.nameMin} maxLength={LIMITS.nameMax} autoComplete="name" enterKeyHint="next" />
          </label>
          <label>Моя идея
            <textarea value={idea} onChange={(e) => setIdea(e.target.value)} required minLength={LIMITS.ideaMin} maxLength={LIMITS.ideaMax} rows={6} />
            <span className={`count${idea.length > LIMITS.ideaMax - 30 ? ' warn' : ''}`}>{idea.length} / {LIMITS.ideaMax}</span>
          </label>
          <label className="trap" aria-hidden="true">Сайт<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
          <p className="note">Имя и идея могут отображаться на общем экране и сохраняются у организаторов семинара.</p>
          {err && <p className="alert" role="alert">{err}</p>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить идею'}</button>
        </form>
      )}
    </main>
  );
}
