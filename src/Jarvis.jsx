// J.A.R.V.I.S. — interface de voz e HUD do YOETZ Produtivo.
//
// O raciocínio vem da Edge Function "jarvis" (Supabase). As ações são
// executadas aqui, pelas funções do próprio app (ver jarvisTools.js).

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { auth } from "./supabase.js";
import { runTool, snapshot, greeting, buildContext, fmtBR } from "./jarvisTools.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://kpgpcqjefrixzshmskls.supabase.co";
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = SUPABASE_URL + "/functions/v1/jarvis";

const MAX_ROUNDS = 8;      // rodadas de ferramenta por pedido
const MAX_HISTORY = 30;    // mensagens mantidas na conversa
const WAKE_RE = /(^|\s)(jarvis|járvis|jarves|jarbas|jarvas|jarviz|jar vis)[\s,.!?:;-]*/i;
const YES_RE = /^\s*(sim|confirm|pode|isso|exclu|apag|manda|claro|positivo|ok)/i;
const NO_RE = /^\s*(n[aã]o|cancel|deixa|esquece|negativo|para)/i;

// A conversa sobrevive à troca de abas enquanto o app estiver aberto.
const mem = { api: [], msgs: [], log: [], greeted: false };

const getPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* armazenamento indisponível */ } };
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callFn(body, wantBlob = false) {
  const doFetch = () => fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": ANON_KEY, "Authorization": "Bearer " + (auth.getSession()?.access_token || ANON_KEY) },
    body: JSON.stringify(body),
  });
  let res = await doFetch();
  if (res.status === 401 && await auth.refreshSession().catch(() => null)) res = await doFetch();
  if (wantBlob && res.ok && (res.headers.get("Content-Type") || "").includes("audio")) return res.blob();
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    if (res.status === 404) throw new Error("A função 'jarvis' não está publicada no Supabase.");
    throw new Error(data?.error || `Falha de comunicação (${res.status})`);
  }
  return data;
}

// Corta o histórico sem separar uma chamada de ferramenta do seu resultado.
function trimHistory(api) {
  if (api.length <= MAX_HISTORY) return api;
  for (let i = api.length - MAX_HISTORY; i < api.length; i++) {
    if (api[i].role === "user" && typeof api[i].content === "string") return api.slice(i);
  }
  return api.slice(-1);
}

const CSS = `
.jv{--a:#5fd4ff;--a-rgb:95,212,255;--bg:#060a0f;--bg2:#0b1620;--ink:#e6f6ff;--dim:rgba(230,246,255,.55);--faint:rgba(230,246,255,.28);--warn:#ffb454;--bad:#ff6b6b;--ok:#5be3a4;
  position:relative;flex:1;min-height:0;display:flex;flex-direction:column;color:var(--ink);overflow:hidden;
  background:radial-gradient(ellipse 70% 55% at 50% 38%,var(--bg2) 0%,var(--bg) 70%);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.jv.jv-yoetz{--a:#cfb27a;--a-rgb:207,178,122;--bg:#070d0a;--bg2:#10231a;--ink:#f3efe6;--dim:rgba(243,239,230,.58);--faint:rgba(243,239,230,.3)}
.jv.jv-full{position:fixed;inset:0;z-index:60}
.jv *{box-sizing:border-box}
.jv::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(rgba(var(--a-rgb),.045) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--a-rgb),.045) 1px,transparent 1px);background-size:44px 44px;
  mask-image:radial-gradient(ellipse 75% 70% at 50% 40%,#000 20%,transparent 85%);-webkit-mask-image:radial-gradient(ellipse 75% 70% at 50% 40%,#000 20%,transparent 85%)}
.jv-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.jv-top{position:relative;display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid rgba(var(--a-rgb),.14);flex-wrap:wrap}
.jv-brand{font-size:13px;font-weight:700;letter-spacing:.34em;color:var(--a)}
.jv-state{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);display:flex;align-items:center;gap:7px}
.jv-state i{width:6px;height:6px;border-radius:50%;background:var(--a);box-shadow:0 0 8px var(--a)}
.jv-ctl{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.jv-btn{font:inherit;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);background:rgba(var(--a-rgb),.05);border:1px solid rgba(var(--a-rgb),.2);border-radius:4px;padding:6px 10px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.jv-btn:hover{color:var(--ink);border-color:rgba(var(--a-rgb),.5)}
.jv-btn.on{color:var(--bg);background:var(--a);border-color:var(--a);font-weight:700}
.jv-btn:disabled{opacity:.4;cursor:not-allowed}
.jv-btn:focus-visible,.jv-core:focus-visible,.jv-in input:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.jv-body{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr) minmax(220px,280px);gap:18px;padding:18px;overflow:hidden}
.jv-col{display:flex;flex-direction:column;gap:14px;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(var(--a-rgb),.25) transparent}
.jv-panel{position:relative;border:1px solid rgba(var(--a-rgb),.16);background:rgba(var(--a-rgb),.03);padding:13px 14px}
.jv-panel::before,.jv-panel::after{content:"";position:absolute;width:9px;height:9px;border:1px solid var(--a)}
.jv-panel::before{top:-1px;left:-1px;border-right:0;border-bottom:0}
.jv-panel::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.jv-h{font-size:9px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:var(--a);margin:0 0 10px;display:flex;justify-content:space-between;gap:8px}
.jv-h span{color:var(--faint);font-weight:500}
.jv-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.jv-kpi b{display:block;font-size:24px;font-weight:300;line-height:1}
.jv-kpi small{display:block;margin-top:4px;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.jv-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-top:1px solid rgba(var(--a-rgb),.08);font-size:12px;line-height:1.35}
.jv-row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.jv-row .d{font-size:10px;color:var(--faint);flex-shrink:0}
.jv-dot{width:5px;height:5px;border-radius:50%;background:var(--faint);flex-shrink:0;transform:translateY(-1px)}
.jv-dot.bad{background:var(--bad);box-shadow:0 0 6px var(--bad)}.jv-dot.warn{background:var(--warn)}.jv-dot.ok{background:var(--ok)}
.jv-bar{height:3px;background:rgba(var(--a-rgb),.12);margin-top:5px}.jv-bar i{display:block;height:100%;background:var(--a);transition:width .4s}
.jv-empty{font-size:11px;color:var(--faint);padding:4px 0}
.jv-pair{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(var(--a-rgb),.08);font-size:12px}
.jv-pair:first-of-type{border-top:0}.jv-pair span{color:var(--dim)}
.jv-mid{display:flex;flex-direction:column;align-items:center;min-height:0;min-width:0}
.jv-core{--amp:0;position:relative;width:min(300px,34vh,70vw);aspect-ratio:1;flex-shrink:0;border:0;background:none;padding:0;cursor:pointer;color:var(--a);border-radius:50%}
.jv-core svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 14px rgba(var(--a-rgb),.35))}
.jv-core .r{fill:none;stroke:currentColor;transform-origin:150px 150px}
.jv-core .r1{animation:jv-spin 46s linear infinite}
.jv-core .r2{animation:jv-spin 22s linear infinite reverse}
.jv-core .r3{animation:jv-spin 14s linear infinite}
.jv-core .r4{animation:jv-spin 30s linear infinite reverse}
.jv-core .heart{transform-origin:150px 150px;transform:scale(calc(1 + var(--amp) * .35));transition:transform .08s linear}
.jv-core.is-listening .heart{animation:jv-pulse 1.1s ease-in-out infinite}
.jv-core.is-thinking .r2{animation-duration:3s}.jv-core.is-thinking .r3{animation-duration:2s}.jv-core.is-thinking .r4{animation-duration:5s}
.jv-core.is-speaking.no-amp .heart{animation:jv-pulse .55s ease-in-out infinite}
.jv-core.is-listening svg,.jv-core.is-speaking svg{filter:drop-shadow(0 0 26px rgba(var(--a-rgb),.7))}
@keyframes jv-spin{to{transform:rotate(360deg)}}
@keyframes jv-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
.jv-hint{margin-top:10px;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--faint);min-height:14px;text-align:center}
.jv-talk{flex:1;min-height:0;width:100%;max-width:640px;margin-top:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:0 4px;scrollbar-width:thin;scrollbar-color:rgba(var(--a-rgb),.25) transparent}
.jv-m{font-size:14px;line-height:1.55;max-width:100%}
.jv-m.u{align-self:flex-end;color:var(--dim);font-size:12.5px;text-align:right;max-width:85%}
.jv-m.u::before{content:"› ";color:var(--a)}
.jv-m.j{color:var(--ink)}
.jv-m.j:last-of-type{font-size:16px}
.jv-m.e{color:var(--bad);font-size:12.5px}
.jv-m.i{color:var(--a);font-style:italic;align-self:flex-end;font-size:12.5px}
.jv-act{align-self:flex-start;font-size:11px;color:var(--dim);border-left:2px solid var(--a);padding:2px 0 2px 9px}
.jv-act b{color:var(--ink);font-weight:600}.jv-act.del{border-color:var(--bad)}.jv-act.done{border-color:var(--ok)}
.jv-confirm{width:100%;max-width:640px;margin-top:10px;border:1px solid var(--bad);background:rgba(255,107,107,.08);padding:11px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
.jv-confirm p{margin:0;flex:1;min-width:180px}
.jv-foot{position:relative;padding:12px 18px 16px;border-top:1px solid rgba(var(--a-rgb),.14)}
.jv-chips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:10px}
.jv-chip{font:inherit;font-size:11px;color:var(--dim);background:none;border:1px solid rgba(var(--a-rgb),.2);border-radius:999px;padding:5px 11px;cursor:pointer}
.jv-chip:hover{color:var(--ink);border-color:var(--a)}
.jv-in{display:flex;gap:8px;max-width:720px;margin:0 auto}
.jv-in input{flex:1;min-width:0;font:inherit;font-size:14px;color:var(--ink);background:rgba(var(--a-rgb),.05);border:1px solid rgba(var(--a-rgb),.25);border-radius:4px;padding:11px 13px}
.jv-in input::placeholder{color:var(--faint)}
.jv-in .jv-btn{padding:0 16px;font-size:11px}
@media (max-width:1000px){.jv-body{display:flex;flex-direction:column;overflow-y:auto;gap:14px;padding:14px}.jv-col{overflow:visible;flex:none}.jv-mid{order:-1;flex:none;width:100%}.jv-talk{max-height:36vh;flex:none}.jv-core{width:min(200px,54vw)}.jv-chips{flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;scrollbar-width:none}.jv-chip{flex-shrink:0}.jv-in input{font-size:16px}}
@media (prefers-reduced-motion:reduce){.jv-core .r,.jv-core .heart{animation:none!important;transition:none}}
`;

function Reactor() {
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <circle className="r" cx="150" cy="150" r="144" strokeWidth="1" opacity=".22" />
      <circle className="r r1" cx="150" cy="150" r="132" strokeWidth="2" strokeDasharray="2 11" opacity=".7" />
      <circle className="r r2" cx="150" cy="150" r="116" strokeWidth="5" strokeDasharray="150 46 60 46 22 46" opacity=".85" strokeLinecap="butt" />
      <circle className="r r3" cx="150" cy="150" r="98" strokeWidth="1.5" strokeDasharray="1 7" opacity=".6" />
      <circle className="r r4" cx="150" cy="150" r="80" strokeWidth="9" strokeDasharray="36 14" opacity=".32" />
      <circle className="r" cx="150" cy="150" r="62" strokeWidth="1" opacity=".5" />
      <g className="heart">
        <circle cx="150" cy="150" r="44" fill="currentColor" opacity=".12" />
        <circle cx="150" cy="150" r="30" fill="currentColor" opacity=".3" />
        <circle cx="150" cy="150" r="16" fill="currentColor" opacity=".95" />
      </g>
    </svg>
  );
}

export default function Jarvis({ app, setActiveTab }) {
  const appRef = useRef(app); appRef.current = app;
  const [status, setStatusState] = useState("idle"); // idle | listening | thinking | speaking
  const statusRef = useRef("idle");
  const setStatus = s => { statusRef.current = s; setStatusState(s); };
  const [msgs, setMsgs] = useState(mem.msgs);
  const [interim, setInterim] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPendingState] = useState(null);
  const pendingRef = useRef(null);
  const [voice, setVoiceState] = useState(getPref("jarvis_voice", "auto")); // auto | neural | browser | off
  const [neuralOk, setNeuralOk] = useState(false);
  const [online, setOnline] = useState(null);
  const [wake, setWakeState] = useState(false);
  const [theme, setTheme] = useState(getPref("jarvis_theme", "stark"));
  const [full, setFull] = useState(false);
  const [hasAmp, setHasAmp] = useState(false);

  const voiceRef = useRef("browser");
  const wakeRef = useRef(false);
  const busyRef = useRef(false);
  const recRef = useRef(null);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);
  const speakSeq = useRef(0);
  const coreRef = useRef(null);
  const talkRef = useRef(null);
  const aliveRef = useRef(true);
  const fn = useRef({}); // funções mais recentes, para os callbacks de voz

  const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const effectiveVoice = voice === "auto" ? (neuralOk ? "neural" : "browser") : voice === "neural" && !neuralOk ? "browser" : voice;
  voiceRef.current = effectiveVoice;

  const push = useCallback(m => { mem.msgs = [...mem.msgs, m].slice(-60); setMsgs(mem.msgs); }, []);
  const setPending = p => { pendingRef.current = p; setPendingState(p); };

  useEffect(() => { const el = talkRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, interim, pending]);

  // ── Voz: saída ───────────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    speakSeq.current++;
    cancelAnimationFrame(rafRef.current);
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* já parado */ } audioRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (coreRef.current) coreRef.current.style.setProperty("--amp", 0);
    setHasAmp(false);
  }, []);

  const speak = useCallback(async (text) => {
    stopSpeaking();
    const seq = speakSeq.current;
    const finish = () => {
      if (seq !== speakSeq.current || !aliveRef.current) return;
      cancelAnimationFrame(rafRef.current);
      if (coreRef.current) coreRef.current.style.setProperty("--amp", 0);
      setHasAmp(false);
      setStatus("idle");
      if (pendingRef.current) fn.current.listen?.();
    };
    if (voiceRef.current === "off" || !text) { setStatus("idle"); return; }
    fn.current.stopRec?.();
    setStatus("speaking");

    if (voiceRef.current === "neural") {
      try {
        const blob = await callFn({ action: "tts", text: text.slice(0, 1200) }, true);
        if (seq !== speakSeq.current || !aliveRef.current) return;
        if (!(blob instanceof Blob)) throw new Error("sem áudio");
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); finish(); };
        try { // núcleo reagindo ao volume real da fala
          const AC = window.AudioContext || window.webkitAudioContext;
          const ctx = audioCtxRef.current || (audioCtxRef.current = new AC());
          if (ctx.state === "suspended") await ctx.resume();
          const an = ctx.createAnalyser(); an.fftSize = 256;
          ctx.createMediaElementSource(audio).connect(an); an.connect(ctx.destination);
          const buf = new Uint8Array(an.frequencyBinCount);
          const tick = () => {
            if (seq !== speakSeq.current) return;
            an.getByteTimeDomainData(buf);
            let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
            if (coreRef.current) coreRef.current.style.setProperty("--amp", Math.min(1, Math.sqrt(sum / buf.length) * 4).toFixed(3));
            rafRef.current = requestAnimationFrame(tick);
          };
          setHasAmp(true); tick();
        } catch { setHasAmp(false); }
        await audio.play();
        return;
      } catch (e) {
        console.warn("[jarvis] voz neural indisponível, usando a do navegador:", e.message);
        if (seq !== speakSeq.current) return;
      }
    }
    if (!("speechSynthesis" in window)) { finish(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR"; u.rate = 1.08; u.pitch = 0.82;
    const voices = window.speechSynthesis.getVoices().filter(v => /^pt[-_]BR/i.test(v.lang));
    const pick = voices.find(v => /daniel|felipe|antonio|ant[oô]nio|male|masc/i.test(v.name)) || voices.find(v => /google|natural|neural/i.test(v.name)) || voices[0];
    if (pick) u.voice = pick;
    u.onend = u.onerror = finish;
    window.speechSynthesis.speak(u);
  }, [stopSpeaking]);

  // ── Conversa ─────────────────────────────────────────────────────────────
  const confirmAction = useCallback(text => new Promise(resolve => {
    setPending({ text, resolve: v => { setPending(null); stopSpeaking(); fn.current.stopRec?.(); setStatus("thinking"); resolve(v); } });
    speak(text + " Confirma, senhor?");
  }), [speak, stopSpeaking]);

  const send = useCallback(async (raw) => {
    const text = String(raw || "").trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    stopSpeaking(); fn.current.stopRec?.();
    push({ k: "u", text });
    setStatus("thinking");
    const api = [...mem.api, { role: "user", content: text }];
    const env = { setActiveTab, confirm: confirmAction };
    try {
      let final = "";
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const r = await callFn({ action: "chat", messages: trimHistory(api), context: buildContext(appRef.current) });
        const content = Array.isArray(r.content) && r.content.length ? r.content : [{ type: "text", text: "…" }];
        api.push({ role: "assistant", content });
        const uses = content.filter(b => b.type === "tool_use");
        const said = content.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
        if (!uses.length) { final = said; break; }
        const results = [];
        for (const u of uses) {
          let out;
          try { out = await runTool(u.name, u.input, appRef.current, env); }
          catch (e) { out = { result: { erro: String(e?.message || e) } }; }
          if (out.log) push({ k: "a", ...out.log });
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out.result) });
          await sleep(25); // deixa o React aplicar a alteração antes da próxima leitura
        }
        api.push({ role: "user", content: results });
        if (!aliveRef.current) return;
      }
      if (!final || final === "…") final = "Feito, senhor.";
      mem.api = trimHistory(api);
      push({ k: "j", text: final });
      busyRef.current = false;
      if (aliveRef.current) speak(final);
    } catch (e) {
      push({ k: "e", text: e.message || "Falha inesperada." });
      setStatus("idle");
    } finally {
      busyRef.current = false;
    }
  }, [push, speak, stopSpeaking, confirmAction, setActiveTab]);

  // ── Voz: entrada ─────────────────────────────────────────────────────────
  const stopRec = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) { rec.onend = null; rec.onresult = null; rec.onerror = null; try { rec.abort(); } catch { /* já encerrado */ } }
    setInterim("");
  }, []);

  const micError = useCallback((e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wakeRef.current = false; setWakeState(false);
      push({ k: "e", text: "O microfone está bloqueado para este site. Libere o acesso no cadeado da barra de endereço." });
    }
  }, [push]);

  const heard = useCallback((text) => {
    const p = pendingRef.current;
    if (p) {
      if (YES_RE.test(text)) p.resolve(true);
      else if (NO_RE.test(text)) p.resolve(false);
      else fn.current.listen?.();
      return;
    }
    send(text);
  }, [send]);

  const listen = useCallback(() => {
    if (!SR) return;
    stopRec(); stopSpeaking();
    const rec = new SR();
    rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = "";
    rec.onstart = () => setStatus("listening");
    rec.onresult = e => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else live += e.results[i][0].transcript;
      }
      setInterim((finalText + " " + live).trim());
    };
    rec.onerror = micError;
    rec.onend = () => {
      if (recRef.current === rec) recRef.current = null;
      setInterim("");
      if (statusRef.current === "listening") setStatus("idle");
      const t = finalText.trim();
      if (t) heard(t);
    };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [SR, stopRec, stopSpeaking, heard, micError]);

  // Escuta contínua: aguarda a palavra "Jarvis".
  const startWake = useCallback(() => {
    if (!SR || !wakeRef.current || recRef.current || busyRef.current || statusRef.current !== "idle" || pendingRef.current) return;
    const rec = new SR();
    rec.lang = "pt-BR"; rec.interimResults = false; rec.continuous = true;
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const t = e.results[i][0].transcript;
        const m = t.match(WAKE_RE);
        if (!m) continue;
        const cmd = t.slice(m.index + m[0].length).trim();
        stopRec();
        if (cmd.length > 2) send(cmd); else listen();
        return;
      }
    };
    rec.onerror = micError;
    rec.onend = () => { if (recRef.current === rec) recRef.current = null; setTimeout(() => fn.current.startWake?.(), 500); };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [SR, stopRec, send, listen, micError]);

  fn.current = { listen, stopRec, startWake };

  useEffect(() => { if (status === "idle" && wake && !pending) startWake(); }, [status, wake, pending, startWake]);

  const toggleWake = () => {
    const next = !wake;
    wakeRef.current = next; setWakeState(next);
    if (!next && statusRef.current === "idle") stopRec();
  };

  const onCore = () => {
    if (status === "listening") { const rec = recRef.current; if (rec) try { rec.stop(); } catch { /* já encerrado */ } return; }
    if (status === "speaking") { stopSpeaking(); setStatus("idle"); if (!SR) return; }
    if (status === "thinking") return;
    listen();
  };

  // ── Inicialização: verifica o cérebro e cumprimenta ──────────────────────
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    (async () => {
      let ok = false, neural = false;
      try {
        const p = await Promise.race([callFn({ action: "ping" }), sleep(6000).then(() => { throw new Error("tempo esgotado"); })]);
        ok = !!(p.providers?.anthropic || p.providers?.openai); neural = !!p.providers?.openai;
      } catch (e) { console.warn("[jarvis] ping:", e.message); }
      if (cancelled) return;
      setOnline(ok); setNeuralOk(neural);
      const pref = getPref("jarvis_voice", "auto");
      voiceRef.current = pref === "auto" ? (neural ? "neural" : "browser") : pref === "neural" && !neural ? "browser" : pref;
      if (!mem.greeted) {
        mem.greeted = true;
        const hello = greeting(appRef.current);
        push({ k: "j", text: hello });
        if (!ok) push({ k: "e", text: "Não consegui falar com o servidor de IA. Os painéis funcionam; os comandos, não." });
        speak(hello);
      }
    })();
    const onKey = e => { if (e.key === "Escape") { stopSpeaking(); if (statusRef.current === "speaking") setStatus("idle"); } };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true; aliveRef.current = false; wakeRef.current = false;
      window.removeEventListener("keydown", onKey);
      stopRec(); stopSpeaking();
      if (pendingRef.current) pendingRef.current.resolve(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Painéis ──────────────────────────────────────────────────────────────
  const s = useMemo(() => snapshot(app), [app.tasks, app.habits, app.clients, app.onboardings, app.onboardingSteps, app.projects, app.relationships, app.currentProfile]);
  const isAdmin = !app.currentProfile || app.currentProfile.role === "admin";
  const agenda = [...s.overdue.slice(0, 4), ...s.dueToday.slice(0, 4)].slice(0, 6);
  const upcoming = agenda.length < 6 ? s.week.slice(0, 6 - agenda.length) : [];
  const stateLabel = { idle: wake ? "Aguardando — diga “Jarvis”" : "Em espera", listening: "Ouvindo", thinking: "Processando", speaking: "Respondendo" }[status];
  const hint = pending ? "Diga sim ou não" : status === "listening" ? "Toque para encerrar" : status === "speaking" ? "Toque para interromper" : status === "thinking" ? "" : SR ? "Toque no núcleo para falar" : "Voz indisponível neste navegador — digite abaixo";
  const voiceLabel = { neural: "Voz neural", browser: "Voz padrão", off: "Voz desligada" }[effectiveVoice];
  const cycleVoice = () => {
    const order = neuralOk ? ["neural", "browser", "off"] : ["browser", "off"];
    const next = order[(order.indexOf(effectiveVoice) + 1) % order.length];
    setVoiceState(next); setPref("jarvis_voice", next);
    if (next === "off") { stopSpeaking(); if (statusRef.current === "speaking") setStatus("idle"); }
  };
  const submit = e => { e.preventDefault(); const t = input; setInput(""); if (pendingRef.current) heard(t); else send(t); };
  const taskRow = t => {
    const late = t.dueDate && t.dueDate < s.today;
    return (
      <div className="jv-row" key={t.id}>
        <i className={"jv-dot " + (late || t.priority === "urgente" ? "bad" : t.priority === "alta" ? "warn" : "")} />
        <span className="t" title={t.title}>{t.title}</span>
        <span className="d jv-mono">{t.dueDate === s.today ? "hoje" : fmtBR(t.dueDate)}</span>
      </div>
    );
  };

  return (
    <div className={"jv" + (theme === "yoetz" ? " jv-yoetz" : "") + (full ? " jv-full" : "")}>
      <style>{CSS}</style>

      <div className="jv-top">
        <span className="jv-brand">J.A.R.V.I.S.</span>
        <span className="jv-state"><i style={online === false ? { background: "var(--bad)", boxShadow: "0 0 8px var(--bad)" } : undefined} />{online === false ? "Offline" : stateLabel}</span>
        <div className="jv-ctl">
          <button className={"jv-btn" + (wake ? " on" : "")} onClick={toggleWake} disabled={!SR} title="Fica ouvindo e responde quando você diz “Jarvis”">Escuta contínua</button>
          <button className="jv-btn" onClick={cycleVoice}>{voiceLabel}</button>
          <button className="jv-btn" onClick={() => { const t = theme === "stark" ? "yoetz" : "stark"; setTheme(t); setPref("jarvis_theme", t); }}>Tema {theme === "stark" ? "Stark" : "YOETZ"}</button>
          <button className="jv-btn" onClick={() => setFull(f => !f)}>{full ? "Sair da tela cheia" : "Tela cheia"}</button>
        </div>
      </div>

      <div className="jv-body">
        <div className="jv-col">
          <section className="jv-panel">
            <h3 className="jv-h">Agenda <span className="jv-mono">{fmtBR(s.today)} · {s.weekday.split("-")[0]}</span></h3>
            <div className="jv-kpis jv-mono">
              <div className="jv-kpi"><b>{s.dueToday.length}</b><small>Hoje</small></div>
              <div className="jv-kpi"><b style={s.overdue.length ? { color: "var(--bad)" } : undefined}>{s.overdue.length}</b><small>Atrasadas</small></div>
              <div className="jv-kpi"><b>{s.week.length}</b><small>7 dias</small></div>
            </div>
            {agenda.map(taskRow)}
            {upcoming.map(taskRow)}
            {!agenda.length && !upcoming.length && <p className="jv-empty">Nada pendente nos próximos sete dias.</p>}
          </section>

          <section className="jv-panel">
            <h3 className="jv-h">Hábitos de hoje <span className="jv-mono">{s.dailyDone.length}/{s.daily.length}</span></h3>
            <div className="jv-bar" style={{ marginTop: 0, marginBottom: 8 }}><i style={{ width: (s.daily.length ? s.dailyDone.length / s.daily.length * 100 : 0) + "%" }} /></div>
            {s.daily.map(h => {
              const done = (h.completedDates || []).includes(s.today);
              return <div className="jv-row" key={h.id}><i className={"jv-dot " + (done ? "ok" : "")} /><span className="t" style={done ? { color: "var(--dim)" } : undefined}>{h.title}</span></div>;
            })}
            {!s.daily.length && <p className="jv-empty">Nenhum hábito diário cadastrado.</p>}
          </section>
        </div>

        <div className="jv-mid">
          <button ref={coreRef} className={"jv-core is-" + status + (hasAmp ? "" : " no-amp")} onClick={onCore}
            aria-label={status === "listening" ? "Encerrar escuta" : status === "speaking" ? "Interromper fala" : "Falar com o Jarvis"}>
            <Reactor />
          </button>
          <p className="jv-hint">{hint}</p>

          <div className="jv-talk" ref={talkRef} aria-live="polite">
            {msgs.map((m, i) => m.k === "a"
              ? <div key={i} className={"jv-act " + (m.kind === "delete" ? "del" : m.kind === "done" ? "done" : "")}><b>{m.text}</b>{m.detail ? " · " + m.detail : ""}</div>
              : <div key={i} className={"jv-m " + m.k}>{m.text}</div>)}
            {interim && <div className="jv-m i">{interim}</div>}
          </div>

          {pending && (
            <div className="jv-confirm" role="alertdialog" aria-label="Confirmação">
              <p>{pending.text}</p>
              <button className="jv-btn" onClick={() => pending.resolve(false)}>Cancelar</button>
              <button className="jv-btn on" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={() => pending.resolve(true)}>Excluir</button>
            </div>
          )}
        </div>

        <div className="jv-col">
          {isAdmin && (
            <section className="jv-panel">
              <h3 className="jv-h">Carteira <span className="jv-mono">{s.clients.length} clientes</span></h3>
              <div className="jv-pair"><span>Receita mensal</span><b className="jv-mono">{money(s.mrr)}</b></div>
              <div className="jv-pair"><span>Pagamento pendente</span><b className="jv-mono" style={s.pending.length ? { color: "var(--warn)" } : undefined}>{s.pending.length}</b></div>
              <div className="jv-pair"><span>Valor em aberto</span><b className="jv-mono">{money(s.pendingValue)}</b></div>
            </section>
          )}

          <section className="jv-panel">
            <h3 className="jv-h">Onboardings <span className="jv-mono">{s.onbs.length} em curso</span></h3>
            {s.onbs.slice(0, 5).map(o => (
              <div key={o.id} style={{ padding: "5px 0" }}>
                <div className="jv-row" style={{ border: 0, padding: 0 }}>
                  <span className="t" title={o.title}>{o.title}</span>
                  <span className="d jv-mono" style={o.late ? { color: "var(--bad)" } : undefined}>{o.done}/{o.total}</span>
                </div>
                <div className="jv-bar"><i style={{ width: (o.total ? o.done / o.total * 100 : 0) + "%" }} /></div>
              </div>
            ))}
            {!s.onbs.length && <p className="jv-empty">Nenhum onboarding em andamento.</p>}
          </section>

          <section className="jv-panel">
            <h3 className="jv-h">Radar</h3>
            <div className="jv-pair"><span>Projetos ativos</span><b className="jv-mono">{s.projects.length}</b></div>
            <div className="jv-pair"><span>Projetos atrasados</span><b className="jv-mono" style={s.lateProjects.length ? { color: "var(--bad)" } : undefined}>{s.lateProjects.length}</b></div>
            <div className="jv-pair"><span>Concluídas hoje</span><b className="jv-mono">{s.doneToday.length}</b></div>
            {s.dates.slice(0, 3).map((d, i) => (
              <div className="jv-row" key={i}><i className="jv-dot warn" /><span className="t">{d.name}</span><span className="d jv-mono">{d.days === 0 ? "hoje" : d.days === 1 ? "amanhã" : d.days + " d"}</span></div>
            ))}
          </section>
        </div>
      </div>

      <div className="jv-foot">
        <div className="jv-chips">
          {["Briefing do dia", "O que está atrasado?", "O que tenho para amanhã?", ...(isAdmin ? ["Quem está com pagamento pendente?"] : []), "Como estão meus hábitos?"].map(q => (
            <button key={q} className="jv-chip" onClick={() => send(q)} disabled={status === "thinking"}>{q}</button>
          ))}
        </div>
        <form className="jv-in" onSubmit={submit}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder={pending ? "Responda sim ou não" : "Digite um comando, senhor…"} aria-label="Comando para o Jarvis" />
          <button className="jv-btn on" type="submit" disabled={!input.trim() || (status === "thinking" && !pending)}>Enviar</button>
        </form>
      </div>
    </div>
  );
}
