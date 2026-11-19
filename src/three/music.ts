/** Фоновая музыка: плавный бесшовный повтор по часам звуковой карты, поэтому нагрузка 3D-сцены её не прерывает. */
const CROSSFADE = 3.5;
const curve = (fadeIn: boolean) => Float32Array.from({ length: 64 }, (_, i) => {
  const t = i / 63; return Math.sin((fadeIn ? t : 1 - t) * Math.PI * 0.5);
});

export class SceneMusic {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  private loopEnd = 0; private nextAt = 0; private timer = 0;
  private wanted = false; private volume = 0.55; private muted = false; private userPaused = false;
  private voices = new Set<{ src: AudioBufferSourceNode; out: GainNode }>();
  private silent: HTMLAudioElement | null = null;

  constructor(private load: () => Promise<ArrayBuffer>) {}

  /** Вызывать только из нажатия пользователя. */
  async unlock() {
    this.keepSessionAlive();
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor(); this.ctx = ctx;
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume; this.master.connect(ctx.destination);
      const wake = () => { if (!this.userPaused && this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {}); };
      ['pointerdown', 'touchend', 'keydown'].forEach((e) => addEventListener(e, wake, { passive: true }));
      document.addEventListener('visibilitychange', wake);
    }
    const tick = this.ctx.createBufferSource(); tick.buffer = this.ctx.createBuffer(1, 1, 22050); tick.connect(this.ctx.destination); tick.start(0);
    void this.prepare();
    if (this.ctx.state !== 'running') await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1200))]);
  }

  private prepare() {
    if (this.buffer || !this.ctx) return Promise.resolve();
    this.loading ??= this.load().then((d) => this.ctx!.decodeAudioData(d)).then((b) => {
      this.buffer = b; this.loopEnd = findMusicEnd(b);
      if (this.wanted && !this.voices.size) this.startVoice(this.ctx!.currentTime + 0.05, 1.2);
    }).catch(() => { this.loading = null; });
    return this.loading;
  }

  private startVoice(at: number, fadeIn: number) {
    const c = this.ctx!; const when = Math.max(at, c.currentTime + 0.05);
    const src = c.createBufferSource(); src.buffer = this.buffer;
    const fade = c.createGain(); const out = c.createGain();
    src.connect(fade); fade.connect(out); out.connect(this.master);
    const fadeOutAt = when + this.loopEnd - CROSSFADE;
    fade.gain.setValueAtTime(0, when); fade.gain.setValueCurveAtTime(curve(true), when, fadeIn);
    fade.gain.setValueCurveAtTime(curve(false), fadeOutAt, CROSSFADE);
    src.start(when, 0); src.stop(fadeOutAt + CROSSFADE + 0.05);
    const voice = { src, out }; this.voices.add(voice); src.onended = () => { this.voices.delete(voice); out.disconnect(); };
    this.nextAt = fadeOutAt;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (this.wanted && this.buffer && this.ctx && this.ctx.currentTime > this.nextAt - 8) this.startVoice(this.nextAt, CROSSFADE);
    }, 1000);
  }

  private fadeVoices(seconds: number) {
    const c = this.ctx; if (!c) return; const now = c.currentTime;
    this.voices.forEach(({ src, out }) => {
      out.gain.setValueAtTime(out.gain.value, now); out.gain.linearRampToValueAtTime(0, now + seconds);
      try { src.stop(now + seconds + 0.05); } catch { /* уже остановлен */ }
    });
    this.voices.clear();
  }

  /** Продолжает играть, если музыка уже идёт. */
  play() {
    this.wanted = true; if (!this.ctx || this.voices.size) return;
    if (this.buffer) this.startVoice(this.ctx.currentTime + 0.05, 1.2); else void this.prepare();
  }
  /** Запускает трек с начала. */
  restart() {
    this.wanted = true; if (!this.ctx) return; this.fadeVoices(0.7);
    if (this.buffer) this.startVoice(this.ctx.currentTime + 0.05, 1); else void this.prepare();
  }
  stop(seconds = 2) { this.wanted = false; clearInterval(this.timer); this.fadeVoices(seconds); }
  setVolume(v: number) { this.volume = v; this.applyLevel(); }
  setMuted(m: boolean) { this.muted = m; this.applyLevel(); }
  private applyLevel() { if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05); }
  setPaused(p: boolean) { this.userPaused = p; if (this.ctx) void (p ? this.ctx.suspend() : this.ctx.resume()); }

  /** На iPhone беззвучный режим глушит Web Audio; тихая дорожка переводит страницу в режим воспроизведения. */
  private keepSessionAlive() {
    if (this.silent) { void this.silent.play().catch(() => {}); return; }
    const rate = 8000; const buf = new ArrayBuffer(44 + rate); const v = new DataView(buf);
    const w = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + rate, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, rate, true);
    new Uint8Array(buf, 44).fill(128);
    const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))); el.loop = true; el.setAttribute('playsinline', '');
    this.silent = el; void el.play().catch(() => {});
  }
}

/** Конец звучащей части трека: затихающий хвост в повтор не попадает. */
function findMusicEnd(b: AudioBuffer) {
  const d = b.getChannelData(0); const win = Math.floor(b.sampleRate / 4); const rms: number[] = [];
  for (let i = 0; i + win <= d.length; i += win) { let s = 0; for (let k = i; k < i + win; k += 8) s += d[k] * d[k]; rms.push(Math.sqrt(s / (win / 8))); }
  const peak = Math.max(...rms); let last = rms.length - 1;
  while (last > 0 && rms[last] < peak * 0.1) last--;
  return Math.max(CROSSFADE * 2, ((last + 1) * win) / b.sampleRate);
}
