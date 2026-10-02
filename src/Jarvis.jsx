// Simão — assistente de voz e HUD do YOETZ Produtivo.
//
// O raciocínio vem da Edge Function "jarvis" (nome interno, no Supabase). As ações são
// executadas aqui, pelas funções do próprio app (ver jarvisTools.js).

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { auth, db } from "./supabase.js";
import { runTool, snapshot, greeting, buildContext, fmtBR, matchWake, saidYes, saidNo, firstName } from "./jarvisTools.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://kpgpcqjefrixzshmskls.supabase.co";
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = SUPABASE_URL + "/functions/v1/jarvis";

const MAX_ROUNDS = 8;      // rodadas de ferramenta por pedido
const MAX_HISTORY = 30;    // mensagens mantidas na conversa
const FOLLOW_UP_MS = 7000; // depois de responder, fica ouvindo esse tempo sem exigir o nome
const NEURAL_VOICES = [["ash", "Ash (grave)"], ["onyx", "Onyx (profunda)"], ["echo", "Echo (clara)"], ["sage", "Sage (suave)"], ["nova", "Nova (feminina)"], ["coral", "Coral (feminina)"]];



const CONV_TTL_MS = 12 * 3600 * 1000; // a conversa guardada no navegador vale por 12 horas
const MAX_MEMORY = 60;
// Palavras soltas que só pedem silêncio: não viram pergunta para a IA.
const STOP_ONLY = /^(para|pare|parar|chega|silencio|quieto|obrigado|obrigada|valeu|ok|nada|deixa|esquece|cancela|pode parar|ta bom|tudo bem)( por favor)?$/;
const flat = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// A conversa sobrevive à troca de abas enquanto o app estiver aberto.
const mem = { api: [], msgs: [], log: [], greeted: false };

const getPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* armazenamento indisponível */ } };
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Chamada ao servidor com tempo limite e uma nova tentativa em falha de rede ou erro 5xx.
async function callFn(body, wantBlob = false) {
  const once = async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), body.action === "search" ? 60000 : body.action === "chat" ? 45000 : 20000);
    try {
      return await fetch(FN_URL, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY, "Authorization": "Bearer " + (auth.getSession()?.access_token || ANON_KEY) },
        body: JSON.stringify(body),
      });
    } finally { clearTimeout(timer); }
  };
  let res;
  try { res = await once(); if (res.status >= 500 && res.status !== 501) throw new Error("servidor " + res.status); }
  catch (e) {
    await sleep(600);
    try { res = await once(); }
    catch { throw new Error(e?.name === "AbortError" ? "O servidor demorou demais para responder." : "Sem conexão com o servidor."); }
  }
  if (res.status === 401 && await auth.refreshSession().catch(() => null)) res = await once();
  if (wantBlob && res.ok && (res.headers.get("Content-Type") || "").includes("audio")) return wantBlob === "stream" ? res : res.blob();
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    if (res.status === 404) throw new Error("A função do assistente não está publicada no Supabase.");
    throw new Error(data?.error || `Falha de comunicação (${res.status})`);
  }
  return data;
}

// Conversa em streaming: o servidor manda uma linha JSON por evento. onDelta recebe
// o texto conforme o modelo escreve; a função devolve a resposta completa.
async function callChat(body, onDelta) {
  let delivered = false;
  const once = async () => {
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), 45000);
    const alive = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), 45000); };
    try {
      const res = await fetch(FN_URL, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "apikey": ANON_KEY, "Authorization": "Bearer " + (auth.getSession()?.access_token || ANON_KEY) },
        body: JSON.stringify({ ...body, action: "chat", stream: true }),
      });
      if (res.status === 401) return { retryAuth: true };
      const type = res.headers.get("Content-Type") || "";
      if (!type.includes("ndjson") || !res.body) {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const err = new Error(res.status === 404 ? "A função do assistente não está publicada no Supabase." : data?.error || `Falha de comunicação (${res.status})`);
          err.retry = res.status >= 500;
          throw err;
        }
        return data;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", end = null;
      const handle = line => {
        if (!line.trim()) return;
        let ev; try { ev = JSON.parse(line); } catch { return; }
        if (ev.t === "d") { delivered = true; onDelta?.(ev.x); }
        else if (ev.t === "end") end = ev;
        else if (ev.t === "err") throw new Error(ev.error || "Falha no servidor de IA.");
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        alive();
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
      handle(buf);
      if (!end) { const err = new Error("A resposta foi interrompida no meio."); err.retry = true; throw err; }
      return end;
    } finally { clearTimeout(timer); }
  };
  const attempt = async () => {
    const r = await once();
    if (r?.retryAuth) {
      if (!await auth.refreshSession().catch(() => null)) throw new Error("Sessão expirada. Entre de novo no sistema.");
      const again = await once();
      if (again?.retryAuth) throw new Error("Sessão expirada. Entre de novo no sistema.");
      return again;
    }
    return r;
  };
  try { return await attempt(); }
  catch (e) {
    // Só repete se nada foi dito ainda e a falha parece passageira (rede, tempo, 5xx).
    const transient = e?.retry || e?.name === "AbortError" || e instanceof TypeError;
    if (delivered || !transient) throw e?.name === "AbortError" ? new Error("O servidor demorou demais para responder.") : e;
    await sleep(600);
    try { return await attempt(); }
    catch (e2) { throw e2?.name === "AbortError" ? new Error("O servidor demorou demais para responder.") : e2 instanceof TypeError ? new Error("Sem conexão com o servidor.") : e2; }
  }
}

// Conversa guardada no navegador, por usuário, para sobreviver a um recarregamento.
const convKey = () => "simao_conv_" + (auth.getUserId() || "anon");
function saveConversation() {
  try {
    const data = JSON.stringify({ ts: Date.now(), api: mem.api, msgs: mem.msgs.slice(-40) });
    if (data.length < 300000) localStorage.setItem(convKey(), data);
  } catch { /* armazenamento indisponível */ }
}
function loadConversation() {
  try {
    const d = JSON.parse(localStorage.getItem(convKey()) || "null");
    if (d && Date.now() - d.ts < CONV_TTL_MS && Array.isArray(d.api) && Array.isArray(d.msgs)) return d;
  } catch { /* dado inválido */ }
  return null;
}

// Transforma a resposta de áudio do servidor em um <audio>. Onde o navegador permite
// (MediaSource), o som começa a tocar enquanto o arquivo ainda está chegando.
async function audioFromResponse(res) {
  const type = (res.headers.get("Content-Type") || "audio/mpeg").split(";")[0].trim();
  const MS = typeof window !== "undefined" ? window.MediaSource : null;
  if (MS && res.body && MS.isTypeSupported?.(type)) {
    const ms = new MS();
    const url = URL.createObjectURL(ms);
    const audio = new Audio();
    audio.src = url;
    ms.addEventListener("sourceopen", async () => {
      try {
        const sb = ms.addSourceBuffer(type);
        const reader = res.body.getReader();
        const append = chunk => new Promise((ok, no) => {
          const done = () => { sb.removeEventListener("error", fail); ok(); };
          const fail = () => { sb.removeEventListener("updateend", done); no(new Error("falha ao decodificar o áudio")); };
          sb.addEventListener("updateend", done, { once: true });
          sb.addEventListener("error", fail, { once: true });
          sb.appendBuffer(chunk);
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) await append(value);
        }
        if (ms.readyState === "open") ms.endOfStream();
      } catch (e) {
        console.warn("[simao] áudio progressivo:", e.message);
        try { if (ms.readyState === "open") ms.endOfStream("decode"); } catch { /* já encerrado */ }
      }
    }, { once: true });
    return { audio, release: () => URL.revokeObjectURL(url) };
  }
  const url = URL.createObjectURL(await res.blob());
  return { audio: new Audio(url), release: () => URL.revokeObjectURL(url) };
}

const IS_PHONE = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

// Confere no banco se uma gravação chegou (as funções do app gravam em segundo plano).
async function verifySaved(table, id, check) {
  for (let i = 0; i < 4; i++) {
    await sleep(i === 0 ? 150 : 400);
    try {
      const rows = await db.select(table, { filter: "id=eq." + encodeURIComponent(id) });
      if (check(Array.isArray(rows) ? rows[0] || null : null)) return true;
    } catch { /* tenta de novo */ }
  }
  return false;
}

let beepCtx = null;
function beep(freqs) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = beepCtx || (beepCtx = new AC());
    if (ctx.state === "suspended") ctx.resume();
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + i * 0.09;
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.14);
    });
  } catch { /* sem áudio */ }
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
.jv{--a:#4fc3ff;--a-rgb:79,195,255;--bg:#03060a;--bg2:#07111c;--ink:#e4f4ff;--dim:rgba(228,244,255,.6);--faint:rgba(228,244,255,.32);--warn:#ffb454;--bad:#ff6b5e;--ok:#63e6a8;
  color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.jv.jv-gold{--a:#f0b860;--a-rgb:240,184,96;--bg:#040706;--bg2:#0e1c15;--ink:#f6f1e6;--dim:rgba(246,241,230,.6);--faint:rgba(246,241,230,.32)}
.jv *{box-sizing:border-box}
.jv-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.jv-btn{font:inherit;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);background:rgba(var(--a-rgb),.05);border:1px solid rgba(var(--a-rgb),.22);border-radius:3px;padding:7px 11px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.jv-btn:hover{color:var(--ink);border-color:rgba(var(--a-rgb),.55)}
.jv-btn.on{color:var(--bg);background:var(--a);border-color:var(--a);font-weight:700}
.jv-btn:disabled{opacity:.4;cursor:not-allowed}
.jv-btn:focus-visible,.jv-core:focus-visible,.jv-in input:focus-visible,.jv-ro:focus-visible,.jv-orb:focus-visible{outline:2px solid var(--a);outline-offset:3px}

/* ── Tela cheia (aba do Simão) ── */
.jv-full{position:fixed;top:56px;left:0;right:0;bottom:0;z-index:10;display:flex;flex-direction:column;overflow:hidden;
  background:radial-gradient(ellipse 55% 50% at 50% 46%,var(--bg2) 0%,var(--bg) 70%)}
@media (min-width:1024px){.jv-full{left:240px}}
.jv-full.jv-max{top:0;left:0;z-index:60}
.jv-full::before{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(var(--a-rgb),.05) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--a-rgb),.05) 1px,transparent 1px);background-size:56px 56px;
  mask-image:radial-gradient(ellipse 70% 65% at 50% 42%,#000 10%,transparent 78%);-webkit-mask-image:radial-gradient(ellipse 70% 65% at 50% 42%,#000 10%,transparent 78%)}
.jv-full::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px)}
.jv-corner{position:absolute;width:26px;height:26px;border:1px solid rgba(var(--a-rgb),.55);pointer-events:none;z-index:1}
.jv-corner.tl{top:10px;left:10px;border-right:0;border-bottom:0}.jv-corner.tr{top:10px;right:10px;border-left:0;border-bottom:0}
.jv-corner.bl{bottom:10px;left:10px;border-right:0;border-top:0}.jv-corner.br{bottom:10px;right:10px;border-left:0;border-top:0}
.jv-top{position:relative;z-index:7;display:flex;align-items:center;gap:14px;padding:18px 30px 0;flex-wrap:wrap}
.jv-brand{font-size:13px;font-weight:700;letter-spacing:.42em;color:var(--a);text-shadow:0 0 14px rgba(var(--a-rgb),.6)}
.jv-state{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);display:flex;align-items:center;gap:7px}
.jv-state i{width:6px;height:6px;border-radius:50%;background:var(--a);box-shadow:0 0 8px var(--a);animation:jv-blink 2.4s ease-in-out infinite}
.jv-clock{font-size:10px;letter-spacing:.18em;color:var(--faint)}
.jv-ctl{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;position:relative}
.jv-stage{position:relative;z-index:2;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;padding:0 24px}
.jv-ro{font:inherit;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);background:none;border:0;padding:2px 0;cursor:pointer;display:inline-flex;align-items:baseline;gap:6px}
.jv-ro b{font-size:13px;font-weight:500;letter-spacing:0;color:var(--a)}
.jv-ro b.bad{color:var(--bad)}
.jv-ro:hover{color:var(--ink)}
.jv-core{--amp:0;--amp-in:0;position:relative;flex:1 1 0;min-height:140px;width:100%;max-width:min(680px,100%);border:0;background:none;padding:0;cursor:pointer;color:var(--a);display:block}
.jv-core canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.jv-talkbox{width:100%;max-width:760px;flex-shrink:0;max-height:36vh;display:flex;flex-direction:column;align-items:center;min-height:0}
.jv-mics{display:flex;align-items:center;justify-content:center;gap:11px;flex-shrink:0;margin-top:10px}
.jv-round{width:40px;height:40px;border-radius:50%;border:1px solid rgba(var(--a-rgb),.5);background:rgba(var(--a-rgb),.07);color:var(--a);cursor:pointer;display:grid;place-items:center;transition:box-shadow .2s,background .2s,transform .12s;box-shadow:0 0 14px rgba(var(--a-rgb),.18)}
.jv-round:hover{background:rgba(var(--a-rgb),.16);transform:scale(1.05)}
.jv-round.live{background:rgba(var(--a-rgb),.24);box-shadow:0 0 0 5px rgba(var(--a-rgb),.1),0 0 28px rgba(var(--a-rgb),.7);animation:jv-ring 1.6s ease-out infinite}
.jv-round.sm{width:32px;height:32px}
.jv-round:disabled{opacity:.35;cursor:not-allowed;transform:none}
.jv-round:focus-visible{outline:2px solid var(--a);outline-offset:3px}
.jv-round svg{width:17px;height:17px}.jv-round.sm svg{width:14px;height:14px}
@keyframes jv-ring{0%{box-shadow:0 0 0 0 rgba(var(--a-rgb),.45),0 0 28px rgba(var(--a-rgb),.7)}100%{box-shadow:0 0 0 16px rgba(var(--a-rgb),0),0 0 28px rgba(var(--a-rgb),.7)}}
@keyframes jv-blink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes jv-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.jv-hint{margin:10px 0 0;font-size:10px;letter-spacing:.3em;text-transform:lowercase;color:var(--dim);min-height:14px;text-align:center}
.jv-turn{min-height:0;width:100%;max-width:760px;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:9px;padding:0 6px 6px;scrollbar-width:thin;scrollbar-color:rgba(var(--a-rgb),.25) transparent}
.jv-you{font-size:12.5px;color:var(--dim);text-align:center}
.jv-you::before{content:"› ";color:var(--a)}
.jv-you.i{color:var(--a);font-style:italic}
.jv-cap{font-size:clamp(16px,2.3vh,21px);line-height:1.5;font-weight:300;text-align:center;text-wrap:balance;animation:jv-in .25s ease-out}
.jv-cap.old{font-size:14px;color:var(--dim)}
.jv-err{font-size:13px;color:var(--bad);text-align:center}
.jv-act{font-size:11px;color:var(--dim);border:1px solid rgba(var(--a-rgb),.25);border-left:2px solid var(--a);padding:4px 10px;animation:jv-in .25s ease-out}
.jv-links{display:flex;flex-direction:column;gap:3px;margin-top:5px}
.jv-links a{color:var(--a);text-decoration:none;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(520px,78vw)}
.jv-links a::before{content:"↗ ";opacity:.7}
.jv-links a:hover{text-decoration:underline}
.jv-act b{color:var(--ink);font-weight:600}.jv-act.del{border-left-color:var(--bad)}.jv-act.done{border-left-color:var(--ok)}.jv-act.warn{border-left-color:var(--warn);color:var(--warn)}
.jv-confirm{width:100%;max-width:640px;border:1px solid var(--bad);background:rgba(255,107,94,.09);padding:11px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
.jv-confirm p{margin:0;flex:1;min-width:160px}
.jv-foot{position:relative;z-index:3;padding:10px 30px 18px;min-height:18px}
.jv-in{display:flex;gap:8px;max-width:680px;margin:0 auto}
.jv-in input{flex:1;min-width:0;font:inherit;font-size:14px;color:var(--ink);background:rgba(var(--a-rgb),.05);border:1px solid rgba(var(--a-rgb),.25);border-radius:3px;padding:11px 13px}
.jv-in input::placeholder{color:var(--faint)}
.jv-in .jv-btn{padding:0 15px;font-size:10px}

/* ── Ajustes e painel de detalhes ── */
.jv-pop{position:absolute;right:0;top:100%;margin-top:8px;z-index:6;width:300px;max-height:70vh;overflow-y:auto;background:var(--bg);border:1px solid rgba(var(--a-rgb),.4);padding:14px;display:flex;flex-direction:column;gap:10px;font-size:11px;color:var(--dim);box-shadow:0 18px 50px rgba(0,0,0,.6)}
.jv-pop h4{margin:6px 0 0;font-size:9px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--a)}
.jv-pop h4:first-child{margin-top:0}
.jv-pop label{display:flex;flex-direction:column;gap:4px;letter-spacing:.1em;text-transform:uppercase;font-size:9px}
.jv-pop select,.jv-pop input[type=range]{width:100%;font:inherit;font-size:12px;color:var(--ink);background:var(--bg2);border:1px solid rgba(var(--a-rgb),.25);padding:5px;accent-color:var(--a)}
.jv-pop .row{display:flex;gap:6px;flex-wrap:wrap}
.jv-mem{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--ink);padding:6px 0;border-top:1px solid rgba(var(--a-rgb),.1);line-height:1.4}
.jv-mem span{flex:1}
.jv-mem button{font:inherit;color:var(--faint);background:none;border:0;cursor:pointer;padding:0 4px;font-size:14px}
.jv-mem button:hover{color:var(--bad)}
.jv-drawer{position:absolute;top:0;right:0;bottom:0;z-index:5;width:min(360px,100%);background:linear-gradient(90deg,rgba(0,0,0,.2),var(--bg) 14%);border-left:1px solid rgba(var(--a-rgb),.3);padding:64px 22px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:20px;animation:jv-slide .22s ease-out;scrollbar-width:thin;scrollbar-color:rgba(var(--a-rgb),.25) transparent;backdrop-filter:blur(6px)}
@keyframes jv-slide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.jv-h{font-size:9px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:var(--a);margin:0 0 8px;display:flex;justify-content:space-between;gap:8px}
.jv-h span{color:var(--faint);font-weight:500}
.jv-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-top:1px solid rgba(var(--a-rgb),.09);font-size:12px;line-height:1.35}
.jv-row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jv-row .d{font-size:10px;color:var(--faint);flex-shrink:0}
.jv-dot{width:5px;height:5px;border-radius:50%;background:var(--faint);flex-shrink:0;transform:translateY(-1px)}
.jv-dot.bad{background:var(--bad);box-shadow:0 0 6px var(--bad)}.jv-dot.warn{background:var(--warn)}.jv-dot.ok{background:var(--ok)}
.jv-bar{height:2px;background:rgba(var(--a-rgb),.14);margin-top:5px}.jv-bar i{display:block;height:100%;background:var(--a);transition:width .4s}
.jv-empty{font-size:11px;color:var(--faint);padding:4px 0;margin:0}
.jv-pair{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid rgba(var(--a-rgb),.09);font-size:12px}
.jv-pair span{color:var(--dim)}
.jv-hist{font-size:12px;line-height:1.45;padding:4px 0;color:var(--dim)}
.jv-hist.j{color:var(--ink)}.jv-hist.u::before{content:"› ";color:var(--a)}

/* ── Versão flutuante (outras telas) ── */
.jv-dock{position:fixed;right:18px;bottom:18px;z-index:45;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}
.jv-dock>*{pointer-events:auto}
.jv-orb{--amp:0;position:relative;width:62px;height:62px;border-radius:50%;border:1px solid rgba(var(--a-rgb),.5);background:radial-gradient(circle at 50% 45%,var(--bg2),var(--bg));color:var(--a);cursor:pointer;padding:0;overflow:hidden;box-shadow:0 8px 26px rgba(0,0,0,.45),0 0 18px rgba(var(--a-rgb),.25);transition:transform .15s,box-shadow .2s}
.jv-orb:hover{transform:scale(1.06)}
.jv-orb.is-listening,.jv-orb.is-speaking{box-shadow:0 8px 26px rgba(0,0,0,.45),0 0 30px rgba(var(--a-rgb),.75)}
.jv-orb canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.jv-card{width:min(360px,calc(100vw - 36px));max-height:min(60vh,460px);display:flex;flex-direction:column;background:radial-gradient(ellipse 90% 70% at 50% 0%,var(--bg2),var(--bg));border:1px solid rgba(var(--a-rgb),.4);box-shadow:0 20px 60px rgba(0,0,0,.55);animation:jv-in .2s ease-out}
.jv-card header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(var(--a-rgb),.18)}
.jv-card header .jv-state{flex:1;font-size:9px}
.jv-x{font:inherit;font-size:15px;line-height:1;color:var(--dim);background:none;border:0;cursor:pointer;padding:2px 5px}
.jv-x:hover{color:var(--ink)}
.jv-card .jv-turn{margin:0;padding:12px;align-items:stretch;gap:8px}
.jv-card .jv-cap{font-size:14.5px;text-align:left;font-weight:400}
.jv-card .jv-you,.jv-card .jv-err{text-align:left}
.jv-card .jv-act{align-self:flex-start}
.jv-card .jv-confirm{margin:0 12px 10px;width:auto}
.jv-card .jv-in{padding:0 12px 12px;margin:0}
.jv-card .jv-in input{padding:9px 11px;font-size:13px}

@media (max-width:820px){
  .jv-top{padding:14px 18px 0}
  .jv-foot{padding:0 16px 14px}.jv-in input{font-size:16px}
  .jv-corner{display:none}
}
@media (prefers-reduced-motion:reduce){.jv-state i,.jv-cap,.jv-act,.jv-drawer,.jv-card,.jv-round{animation:none!important;transition:none}}
`;

// Esfera de partículas: pontos espalhados numa esfera irregular, ligados aos
// vizinhos por linhas finas. Gira devagar, acelera ao pensar e incha com a voz.
// Lê o volume da fala em --amp do elemento pai (mesma variável usada antes).
function Sphere({ status, points = 950 }) {
  const ref = useRef(null);
  const statusRef = useRef(status); statusRef.current = status;
  useEffect(() => {
    const cv = ref.current;
    const host = cv?.parentElement;
    const ctx = cv?.getContext("2d");
    if (!cv || !host || !ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Pontos por espiral de Fibonacci, com leve desordem.
    const P = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < points; i++) {
      const y = 1 - (i / (points - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i + (rnd() - .5) * .9;
      const jx = (rnd() - .5) * .2, jy = (rnd() - .5) * .2, jz = (rnd() - .5) * .2;
      let x = Math.cos(th) * r + jx, yy = y + jy, z = Math.sin(th) * r + jz;
      const n = Math.hypot(x, yy, z) || 1;
      P.push({ x: x / n, y: yy / n, z: z / n, s: rnd() < .07 ? 1.9 + rnd() * 1.2 : .45 + rnd() * .9, ph: rnd() * 6.283 });
    }
    // Cada ponto se liga aos vizinhos mais próximos.
    const E = [], seen = new Set();
    const k = points > 200 ? 4 : 2;
    for (let i = 0; i < P.length; i++) {
      const d = [];
      for (let j = 0; j < P.length; j++) if (j !== i) d.push([(P[i].x - P[j].x) ** 2 + (P[i].y - P[j].y) ** 2 + (P[i].z - P[j].z) ** 2, j]);
      d.sort((a, b) => a[0] - b[0]);
      for (let n = 0; n < k && n < d.length; n++) {
        const j = d[n][1], key = i < j ? i * 10000 + j : j * 10000 + i;
        if (!seen.has(key)) { seen.add(key); E.push([i, j]); }
      }
    }
    const X = new Float32Array(P.length), Y = new Float32Array(P.length), Z = new Float32Array(P.length);

    const rgb = "238,245,255"; // branco levemente frio, em qualquer tema
    let w = 0, h = 0, dpr = 1;
    const size = () => {
      const b = host.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, b.width); h = Math.max(1, b.height);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    size();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(host);

    let raf = 0, last = performance.now(), rot = 0, energy = 0, t = 0;
    const frame = now => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      const st = statusRef.current;
      // Duas vozes movem a esfera: a dele (--amp) e a de quem fala (--amp-in).
      const out = parseFloat(host.style.getPropertyValue("--amp")) || 0;
      const inp = parseFloat(host.style.getPropertyValue("--amp-in")) || 0;
      const target = Math.max(st === "speaking" ? out : 0, st === "speaking" ? 0 : inp, st === "thinking" ? .22 + Math.sin(now / 180) * .08 : 0);
      // Sobe rápido com a voz e desce mais devagar, como um medidor de áudio.
      energy += (target - energy) * Math.min(1, dt * (target > energy ? 18 : 5));
      rot += dt * (st === "thinking" ? 1.1 : .16 + energy * .5);
      t += dt * (.5 + energy * 3);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * .37 * (1 + energy * .16), cx = w / 2, cy = h / 2;
      const cr = Math.cos(rot), sr = Math.sin(rot), tilt = .32, ct = Math.cos(tilt), stt = Math.sin(tilt);
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        // Relevo irregular que se move devagar: a esfera parece viva, não geométrica.
        const bump = 1 + .15 * Math.sin(p.x * 3.1 + t * .9) * Math.cos(p.y * 2.7 - t * .7) + .06 * Math.sin(p.z * 4.3 + t * 1.3) + .025 * Math.sin(p.ph + t * 2)
          + energy * (.2 * Math.sin(p.y * 7 + t * 6) * Math.sin(p.x * 5 - t * 4) + .1 * Math.sin(t * 9 + p.ph));
        const x0 = p.x * bump, y0 = p.y * bump, z0 = p.z * bump;
        const x1 = x0 * cr + z0 * sr, z1 = -x0 * sr + z0 * cr;
        const y2 = y0 * ct - z1 * stt, z2 = y0 * stt + z1 * ct;
        const persp = 1 / (1 + z2 * .28);
        X[i] = cx + x1 * R * persp; Y[i] = cy + y2 * R * persp; Z[i] = z2;
      }
      const boost = R < 60 ? 2.6 : 1; // a versão pequena precisa de traço mais forte
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = R < 60 ? .9 : .6;
      for (let e = 0; e < E.length; e++) {
        const a = E[e][0], b = E[e][1];
        const depth = 1 - (Z[a] + Z[b]) * .5; // 0 (fundo) a 2 (frente)
        ctx.strokeStyle = `rgba(${rgb},${Math.min(1, (.03 + depth * depth * .085 + energy * .16) * boost).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(X[a], Y[a]); ctx.lineTo(X[b], Y[b]); ctx.stroke();
      }
      for (let i = 0; i < P.length; i++) {
        const depth = 1 - Z[i];
        const r = Math.max(R < 60 ? .7 : .3, P[i].s * (.3 + depth * .45) * (R / 260 + .3));
        ctx.fillStyle = `rgba(${rgb},${Math.min(1, (.16 + depth * .46 + energy * .35) * boost).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(X[i], Y[i], r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [points]);
  return <canvas ref={ref} aria-hidden="true" />;
}

const MicIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>;
const StopIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /></svg>;
const KeyIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M7 11h.01M11 11h.01M15 11h.01M8 14.5h8" /></svg>;

// mode: "full" na aba do Simão; "dock" (núcleo flutuante) nas outras telas.
// É sempre a mesma instância, então a escuta e a conversa continuam ao trocar de tela.
export default function Jarvis({ app, setActiveTab, mode = "full" }) {
  const isFull = mode === "full";
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
  const [premiumVoice, setPremiumVoice] = useState(false); // voz nativa em português configurada no servidor
  const [online, setOnline] = useState(null);
  const SRok = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const [wake, setWakeState] = useState(SRok && getPref("jarvis_hands", "on") === "on"); // mãos livres
  const [voiceName, setVoiceName] = useState(getPref("jarvis_voice_name", "ash"));
  const [rate, setRate] = useState(parseFloat(getPref("jarvis_rate", "1.1")) || 1.1);
  const [showSet, setShowSet] = useState(false);     // ajustes (voz, memória, tema)
  const [showPanels, setShowPanels] = useState(false); // gaveta com os detalhes
  const [dockOpen, setDockOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const dockPinned = useRef(false);
  const [memItems, setMemItems] = useState([]);
  const [live, setLive] = useState(""); // resposta sendo escrita
  const [theme, setTheme] = useState(getPref("simao_cor", "blue")); // blue | gold
  const [showKeys, setShowKeys] = useState(false); // campo de texto (a tela é voz primeiro)
  const [full, setFull] = useState(false);
  const [hasAmp, setHasAmp] = useState(false);

  const voiceRef = useRef("browser");
  const wakeRef = useRef(wake);
  const voiceNameRef = useRef(voiceName); voiceNameRef.current = voiceName;
  const rateRef = useRef(rate); rateRef.current = rate;
  const followTimer = useRef(0);
  const memRef = useRef([]);        // memória permanente carregada do banco
  const undoStack = useRef([]);     // alterações desta sessão que podem ser desfeitas
  const turnRef = useRef(0);        // identifica o pedido em andamento
  const mutedRef = useRef(-1);      // pedido cuja fala o usuário mandou calar
  const micRef = useRef(null);      // medição do volume do microfone
  const pulseTimers = useRef({});
  const busyRef = useRef(false);
  const recRef = useRef(null);
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);
  const speakSeq = useRef(0);
  const coreRef = useRef(null); // núcleo (tela cheia) ou esfera (flutuante): recebe o volume da fala
  const talkRef = useRef(null);
  const aliveRef = useRef(true);
  const fn = useRef({}); // funções mais recentes, para os callbacks de voz

  const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const effectiveVoice = voice === "auto" ? (neuralOk ? "neural" : "browser") : voice === "neural" && !neuralOk ? "browser" : voice;
  voiceRef.current = effectiveVoice;

  const push = useCallback(m => { mem.msgs = [...mem.msgs, m].slice(-60); setMsgs(mem.msgs); }, []);
  const setPending = p => { pendingRef.current = p; setPendingState(p); };

  useEffect(() => { const el = talkRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, interim, pending, live]);

  // ── Voz: saída ───────────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    speakSeq.current++;
    cancelAnimationFrame(rafRef.current);
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* já parado */ } audioRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (coreRef.current) coreRef.current.style.setProperty("--amp", 0);
    setHasAmp(false);
  }, []);

  // Locutor incremental: recebe o texto aos poucos e começa a falar na primeira
  // frase completa, sem esperar a resposta inteira.
  const startSpeaker = useCallback(() => {
    stopSpeaking();
    const seq = speakSeq.current;
    const stale = () => seq !== speakSeq.current || !aliveRef.current;
    const mode = voiceRef.current;
    const queue = [];
    let buf = "", hold = "", first = true, ended = false, playing = false, started = false, neuralBroken = false, done = false;

    // Ao terminar de falar, volta a ouvir sozinho (confirmação pendente ou continuação da conversa).
    const finish = () => {
      if (done || stale()) return;
      done = true;
      cancelAnimationFrame(rafRef.current);
      if (coreRef.current) coreRef.current.style.setProperty("--amp", 0);
      setHasAmp(false);
      fn.current.stopRec?.();
      setStatus("idle");
      if (pendingRef.current) fn.current.listen?.();
      else if (wakeRef.current) fn.current.listen?.({ followUp: true });
    };

    const playAudio = ({ audio, release }) => new Promise((resolve, reject) => {
      audio.playbackRate = rateRef.current;
      audioRef.current = audio;
      audio.onended = () => { release(); resolve(); };
      audio.onerror = () => { release(); reject(new Error("áudio inválido")); };
      try { // a esfera reage ao volume real da fala
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = audioCtxRef.current || (audioCtxRef.current = new AC());
        if (ctx.state === "suspended") ctx.resume();
        const an = ctx.createAnalyser(); an.fftSize = 256;
        ctx.createMediaElementSource(audio).connect(an); an.connect(ctx.destination);
        const data = new Uint8Array(an.frequencyBinCount);
        cancelAnimationFrame(rafRef.current);
        const tick = () => {
          if (seq !== speakSeq.current) return;
          an.getByteTimeDomainData(data);
          let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          if (coreRef.current) coreRef.current.style.setProperty("--amp", Math.min(1, Math.sqrt(sum / data.length) * 4.5).toFixed(3));
          rafRef.current = requestAnimationFrame(tick);
        };
        setHasAmp(true); tick();
      } catch { setHasAmp(false); }
      audio.play().catch(reject);
    });

    const sayBrowser = text => new Promise(resolve => {
      if (!("speechSynthesis" in window)) return resolve();
      setHasAmp(false);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR"; u.rate = Math.min(1.6, 1.05 * rateRef.current); u.pitch = 0.9;
      const voices = window.speechSynthesis.getVoices().filter(v => /^pt[-_]BR/i.test(v.lang));
      const pick = voices.find(v => /natural|neural|online/i.test(v.name)) || voices.find(v => /google/i.test(v.name)) || voices.find(v => /daniel|felipe|ant[oô]nio/i.test(v.name)) || voices[0];
      if (pick) u.voice = pick;
      // A voz do navegador não dá acesso ao som; a esfera pulsa a cada palavra falada.
      u.onboundary = () => fn.current.pulse?.("--amp", .55 + Math.random() * .4);
      u.onend = u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });

    const pump = async () => {
      if (playing) return;
      playing = true;
      while (queue.length && !stale()) {
        const item = queue.shift();
        if (!started) { started = true; fn.current.stopRec?.(); setStatus("speaking"); fn.current.listenForInterrupt?.(); }
        else if (statusRef.current !== "speaking") setStatus("speaking");
        try {
          if (item.job && !neuralBroken) {
            const player = await item.job;
            if (stale()) { player?.release?.(); return; }
            if (!player?.audio) throw new Error("sem áudio");
            await playAudio(player);
          } else await sayBrowser(item.text);
        } catch (e) {
          if (stale()) return;
          if (!neuralBroken) { neuralBroken = true; console.warn("[simao] voz neural indisponível, usando a do navegador:", e.message); }
          await sayBrowser(item.text);
        }
      }
      playing = false;
      if (stale()) return;
      if (ended) finish(); else if (busyRef.current) setStatus("thinking");
    };

    // Cada trecho é pedido ao servidor assim que fica pronto; tocam em ordem.
    const emit = text => {
      text = text.trim();
      if (!text || mode === "off") return;
      const job = mode === "neural" && !neuralBroken ? callFn({ action: "tts", text: text.slice(0, 1200), voice: voiceNameRef.current }, "stream").then(audioFromResponse) : null;
      if (job) job.catch(() => {});
      queue.push({ text, job });
      pump();
    };
    // A primeira frase sai sozinha (o áudio começa logo); o resto vai em blocos maiores,
    // para a fala sair contínua, sem emenda a cada frase.
    const drain = () => {
      let m;
      while ((m = buf.match(/^([\s\S]*?[.!?…]+["')\]]*)\s+/))) {
        buf = buf.slice(m[0].length);
        hold = hold ? hold + " " + m[1] : m[1];
        if (first || hold.length >= 200) { emit(hold); hold = ""; first = false; }
      }
    };
    return {
      dead: stale,
      feed(t) { if (stale() || !t) return; buf += t; drain(); },
      end() {
        if (stale() || ended) return;
        ended = true;
        emit((hold + " " + buf).trim()); hold = buf = "";
        if (!playing && !queue.length) finish();
      },
    };
  }, [stopSpeaking]);

  const speak = useCallback((text) => { const sp = startSpeaker(); sp.feed(String(text || "") + " "); sp.end(); }, [startSpeaker]);

  // Interrupção pedida pelo usuário (toque, Esc ou voz): cala o resto deste pedido.
  const hush = useCallback(() => {
    mutedRef.current = turnRef.current;
    stopSpeaking();
    setStatus(busyRef.current ? "thinking" : "idle");
  }, [stopSpeaking]);

  // Pulso curto numa variável de volume da esfera (usado quando não há medição real).
  const pulse = useCallback((name, v) => {
    const el = coreRef.current;
    if (!el) return;
    el.style.setProperty(name, v.toFixed(3));
    clearTimeout(pulseTimers.current[name]);
    pulseTimers.current[name] = setTimeout(() => coreRef.current?.style.setProperty(name, 0), 170);
  }, []);

  // Mede o volume do microfone para a esfera acompanhar a voz de quem fala.
  // No celular fica de fora: abrir o microfone duas vezes derruba o reconhecimento de voz.
  const startMic = useCallback(async () => {
    if (micRef.current || IS_PHONE || !navigator.mediaDevices?.getUserMedia) return;
    micRef.current = { pending: true };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!micRef.current || !aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = audioCtxRef.current || (audioCtxRef.current = new AC());
      if (ctx.state === "suspended") ctx.resume();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an); // não liga na saída: não há retorno de som
      const data = new Uint8Array(an.fftSize);
      const m = { stream, raf: 0 };
      const loop = () => {
        an.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const level = Math.sqrt(sum / data.length);
        // Enquanto ele fala, o microfone capta a própria resposta; aí quem manda é o volume da fala.
        const shown = statusRef.current === "speaking" ? 0 : Math.min(1, Math.max(0, level - .012) * 9);
        coreRef.current?.style.setProperty("--amp-in", shown.toFixed(3));
        m.raf = requestAnimationFrame(loop);
      };
      micRef.current = m;
      loop();
    } catch (e) {
      console.warn("[simao] nível do microfone indisponível:", e.message);
      micRef.current = { failed: true };
    }
  }, []);
  const stopMic = useCallback(() => {
    const m = micRef.current;
    if (m?.failed) return;
    micRef.current = null;
    if (m?.stream) { cancelAnimationFrame(m.raf); m.stream.getTracks().forEach(t => t.stop()); }
    coreRef.current?.style.setProperty("--amp-in", 0);
  }, []);

  // ── Memória permanente ───────────────────────────────────────────────────
  const setMemory = items => { memRef.current = items; setMemItems(items); };
  const memoryApi = useMemo(() => ({
    list: () => memRef.current,
    add: async content => {
      const item = { id: newId(), content };
      try { await db.upsert("assistant_memory", { id: item.id, content }); } catch (e) { console.warn("[simao] memória:", e.message); return null; }
      setMemory([item, ...memRef.current]);
      return item;
    },
    remove: async id => {
      try { await db.delete("assistant_memory", id); } catch (e) { console.warn("[simao] memória:", e.message); return false; }
      setMemory(memRef.current.filter(m => m.id !== id));
      return true;
    },
  }), []);

  // ── Conversa ─────────────────────────────────────────────────────────────
  const confirmAction = useCallback(text => new Promise(resolve => {
    setPending({ text, resolve: v => { setPending(null); stopSpeaking(); fn.current.stopRec?.(); setStatus("thinking"); resolve(v); } });
    speak(text + " Confirma?");
  }), [speak, stopSpeaking]);

  const send = useCallback(async (raw) => {
    const text = String(raw || "").trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    const turn = ++turnRef.current;
    const current = () => turn === turnRef.current && aliveRef.current;
    stopSpeaking(); fn.current.stopRec?.();
    if (wakeRef.current) beep([740]);
    push({ k: "u", text });
    setStatus("thinking");
    const api = [...mem.api, { role: "user", content: text }];
    const env = {
      setActiveTab, confirm: confirmAction, verify: verifySaved, memory: memoryApi,
      undoLast: async () => { const u = undoStack.current.pop(); if (!u) return null; await u.run(); return u.label; },
      remote: (action, data) => callFn({ ...data, action }),
    };
    // Um locutor por pedido; se uma confirmação o interromper, cria outro para o resto.
    let sp = null;
    const speaker = () => {
      if (mutedRef.current === turn) return null;
      if (!sp || sp.dead()) sp = startSpeaker();
      return sp;
    };
    try {
      let final = "";
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let shown = "";
        const r = await callChat(
          { messages: trimHistory(api), context: { ...buildContext(appRef.current), memoria: memRef.current.slice(0, MAX_MEMORY).map(m => m.content) } },
          delta => { if (!current()) return; shown += delta; setLive(shown); speaker()?.feed(delta); },
        );
        if (!current()) return;
        setLive("");
        const content = Array.isArray(r.content) && r.content.length ? r.content : [{ type: "text", text: "…" }];
        api.push({ role: "assistant", content });
        const uses = content.filter(b => b.type === "tool_use");
        const said = content.filter(b => b.type === "text").map(b => b.text).join(" ").trim();
        if (said && !shown) speaker()?.feed(said); // resposta veio sem streaming
        if (!uses.length) { final = said; break; }
        if (said) { push({ k: "j", text: said }); speaker()?.feed(" "); }
        const results = [];
        for (const u of uses) {
          let out;
          try { out = await runTool(u.name, u.input, appRef.current, env); }
          catch (e) { out = { result: { erro: String(e?.message || e) } }; }
          if (out.log) push({ k: "a", ...out.log });
          if (out.undo) { undoStack.current.push(out.undo); if (undoStack.current.length > 15) undoStack.current.shift(); }
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out.result) });
          await sleep(25); // deixa o React aplicar a alteração antes da próxima leitura
        }
        api.push({ role: "user", content: results });
        if (!current()) return;
      }
      const silent = !final || final === "…";
      if (silent) final = "Feito.";
      mem.api = trimHistory(api);
      push({ k: "j", text: final });
      saveConversation();
      busyRef.current = false;
      const out = speaker();
      if (!out) { setStatus("idle"); if (wakeRef.current) fn.current.listen?.({ followUp: true }); }
      else { if (silent) out.feed(final); out.feed(" "); out.end(); }
    } catch (e) {
      if (!current()) return;
      setLive("");
      stopSpeaking();
      push({ k: "e", text: e.message || "Falha inesperada." });
      setStatus("idle");
    } finally {
      if (turn === turnRef.current) busyRef.current = false;
    }
  }, [push, startSpeaker, stopSpeaking, confirmAction, setActiveTab, memoryApi]);

  // Abandona o pedido em andamento (o usuário chamou de novo no meio da resposta).
  const cancelTurn = useCallback(() => {
    turnRef.current++;
    busyRef.current = false;
    setLive("");
    stopSpeaking();
  }, [stopSpeaking]);

  // ── Voz: entrada ─────────────────────────────────────────────────────────
  const stopRec = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    clearTimeout(followTimer.current);
    if (rec) { rec.onend = null; rec.onresult = null; rec.onerror = null; try { rec.abort(); } catch { /* já encerrado */ } }
    setInterim("");
  }, []);

  const micError = useCallback((e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      wakeRef.current = false; setWakeState(false);
      push({ k: "e", text: "O microfone está bloqueado para este site. Libere o acesso no cadeado da barra de endereço e ative Mãos livres de novo." });
    }
  }, [push]);

  const heard = useCallback((text) => {
    const p = pendingRef.current;
    if (p) {
      if (saidYes(text)) p.resolve(true);
      else if (saidNo(text)) p.resolve(false);
      else fn.current.listen?.();
      return;
    }
    if (STOP_ONLY.test(flat(text))) { setStatus("idle"); return; }
    send(text);
  }, [send]);

  const listen = useCallback((opts) => {
    if (!SR) return;
    const followUp = !!opts?.followUp;
    stopRec(); stopSpeaking();
    const rec = new SR();
    rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = "";
    rec.onstart = () => {
      setStatus("listening");
      // Na continuação da conversa, desiste se ninguém falar e volta a aguardar o nome.
      if (followUp) followTimer.current = setTimeout(() => { try { rec.abort(); } catch { /* já encerrado */ } }, FOLLOW_UP_MS);
    };
    rec.onspeechstart = () => clearTimeout(followTimer.current);
    rec.onresult = e => {
      clearTimeout(followTimer.current);
      if (!micRef.current?.stream) pulse("--amp-in", .5 + Math.random() * .4);
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
      clearTimeout(followTimer.current);
      const t = finalText.trim();
      if (t.length < 2) return;
      if (pendingRef.current) { heard(t); return; }
      // Se a pessoa disse o nome junto, fica só o pedido; se disse só o nome, ouve de novo.
      const afterName = matchWake(t);
      if (afterName === "") { beep([880, 1320]); fn.current.listen?.(); return; }
      heard(afterName === null ? t : afterName);
    };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [SR, stopRec, stopSpeaking, heard, micError]);

  // Mãos livres: fica ouvindo e age quando escuta o nome "Simão".
  const startWake = useCallback(() => {
    if (!SR || !wakeRef.current || recRef.current || busyRef.current || statusRef.current !== "idle" || pendingRef.current) return;
    const rec = new SR();
    rec.lang = "pt-BR"; rec.interimResults = false; rec.continuous = true;
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const t = e.results[i][0].transcript;
        const cmd = matchWake(t);
        if (cmd === null) continue;
        stopRec();
        if (cmd.length > 2) send(cmd); else { beep([880, 1320]); listen(); }
        return;
      }
    };
    rec.onerror = micError;
    rec.onend = () => { if (recRef.current === rec) recRef.current = null; setTimeout(() => fn.current.startWake?.(), 500); };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [SR, stopRec, send, listen, micError]);

  // Enquanto ele fala, continua atento ao nome: "Simão" interrompe a resposta na hora.
  const listenForInterrupt = useCallback(() => {
    if (!SR || !wakeRef.current || recRef.current || pendingRef.current) return;
    const rec = new SR();
    rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
    let interrupted = false;
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const cmd = matchWake(res[0].transcript);
        if (cmd === null) continue;
        if (!interrupted) { interrupted = true; cancelTurn(); setStatus("listening"); beep([880, 1320]); }
        if (!res.isFinal) continue;
        stopRec();
        if (cmd.length > 2 && !STOP_ONLY.test(flat(cmd))) send(cmd);
        else if (cmd.length > 2) setStatus("idle");
        else listen();
        return;
      }
    };
    rec.onerror = () => {};
    rec.onend = () => { if (recRef.current === rec) recRef.current = null; if (interrupted) listen(); };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [SR, stopRec, send, listen, cancelTurn]);

  fn.current = { listen, stopRec, startWake, listenForInterrupt, pulse };

  // O medidor do microfone fica ligado enquanto ele estiver ouvindo (mãos livres ou escuta pontual).
  useEffect(() => {
    if (wake || status === "listening") startMic(); else stopMic();
  }, [wake, status, startMic, stopMic]);

  useEffect(() => { if (status === "idle" && wake && !pending) startWake(); }, [status, wake, pending, startWake]);

  const toggleWake = () => {
    const next = !wake;
    wakeRef.current = next; setWakeState(next); setPref("jarvis_hands", next ? "on" : "off");
    if (next) beep([880, 1320]);
    if (!next && statusRef.current !== "thinking" && statusRef.current !== "speaking") { stopRec(); setStatus("idle"); }
  };

  const onCore = () => {
    if (status === "listening") { const rec = recRef.current; if (rec) try { rec.stop(); } catch { /* já encerrado */ } return; }
    if (status === "speaking") { hush(); if (!SR || busyRef.current) return; }
    if (status === "thinking") return;
    listen();
  };

  // ── Inicialização: verifica o cérebro e cumprimenta ──────────────────────
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    (async () => {
      let ok = false, neural = false, premium = false;
      try {
        const p = await Promise.race([callFn({ action: "ping" }), sleep(6000).then(() => { throw new Error("tempo esgotado"); })]);
        ok = !!(p.providers?.anthropic || p.providers?.openai); neural = !!(p.providers?.openai || p.providers?.elevenlabs); premium = !!p.providers?.elevenlabs;
      } catch (e) { console.warn("[simao] ping:", e.message); }
      if (cancelled) return;
      setOnline(ok); setNeuralOk(neural); setPremiumVoice(premium);
      const pref = getPref("jarvis_voice", "auto");
      voiceRef.current = pref === "auto" ? (neural ? "neural" : "browser") : pref === "neural" && !neural ? "browser" : pref;
      const rows = await db.select("assistant_memory").catch(() => []);
      if (cancelled) return;
      setMemory((Array.isArray(rows) ? rows : []).map(r => ({ id: r.id, content: r.content })));
      const saved = loadConversation();
      if (saved && !mem.msgs.length) { mem.api = saved.api; mem.msgs = saved.msgs; setMsgs(mem.msgs); }
      setReady(true);
    })();
    const onKey = e => { if (e.key === "Escape" && statusRef.current === "speaking") hush(); };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true; aliveRef.current = false; wakeRef.current = false;
      window.removeEventListener("keydown", onKey);
      stopRec(); stopSpeaking(); stopMic();
      if (pendingRef.current) pendingRef.current.resolve(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cumprimenta uma vez, na primeira vez que a tela do Simão é aberta.
  useEffect(() => {
    if (!ready || !isFull || mem.greeted) return;
    mem.greeted = true;
    const hello = greeting(appRef.current);
    push({ k: "j", text: hello });
    if (online === false) push({ k: "e", text: "Não consegui falar com o servidor de IA. Os números funcionam; os comandos, não." });
    speak(hello);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isFull]);

  // Flutuante: abre sozinho quando há atividade e se recolhe depois, a menos que o usuário o tenha aberto.
  useEffect(() => {
    if (isFull) return;
    if (status !== "idle" && !(status === "listening" && !interim && !pending) || pending || live) { setDockOpen(true); return; }
    if (dockPinned.current) return;
    const t = setTimeout(() => setDockOpen(false), 7000);
    return () => clearTimeout(t);
  }, [isFull, status, pending, live, interim]);

  // ── Painéis ──────────────────────────────────────────────────────────────
  const s = useMemo(() => snapshot(app), [app.tasks, app.habits, app.clients, app.onboardings, app.onboardingSteps, app.projects, app.relationships, app.currentProfile]);
  const isAdmin = !app.currentProfile || app.currentProfile.role === "admin";
  const agenda = [...s.overdue.slice(0, 4), ...s.dueToday.slice(0, 4)].slice(0, 6);
  const upcoming = agenda.length < 6 ? s.week.slice(0, 6 - agenda.length) : [];
  const stateLabel = { idle: wake ? "Aguardando" : "Em espera", listening: "Ouvindo", thinking: "Processando", speaking: "Respondendo" }[status];
  const hint = pending ? "diga sim ou não" : status === "listening" ? "escutando…" : status === "speaking" ? (wake ? "diga “Simão” para interromper" : "respondendo…") : status === "thinking" ? "processando…" : wake ? "diga “Simão” e o pedido" : SR ? "toque no microfone para falar" : "voz indisponível neste navegador";
  const voiceLabel = { neural: "Voz neural", browser: "Voz padrão", off: "Voz desligada" }[effectiveVoice];
  const pickVoiceMode = next => {
    setVoiceState(next); setPref("jarvis_voice", next);
    if (next === "off") { stopSpeaking(); if (statusRef.current === "speaking") setStatus("idle"); }
  };
  const newConversation = () => {
    cancelTurn(); stopRec();
    mem.api = []; mem.msgs = []; undoStack.current = [];
    setMsgs([]); setStatus("idle");
    try { localStorage.removeItem(convKey()); } catch { /* armazenamento indisponível */ }
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

  // A tela mostra só a troca atual: o último pedido e o que veio depois dele.
  const lastUser = msgs.map(m => m.k).lastIndexOf("u");
  const turn = lastUser >= 0 ? msgs.slice(lastUser) : msgs.slice(-2);
  const lastReply = turn.map(m => m.k).lastIndexOf("j");
  const themeClass = theme === "gold" ? " jv-gold" : "";
  const busy = status === "thinking";
  const ask = q => { if (!busy) send(q); };

  const turnView = (
    <div className="jv-turn" ref={talkRef} aria-live="polite">
      {turn.map((m, i) =>
        m.k === "u" ? <div key={i} className="jv-you">{m.text}</div>
        : m.k === "a" ? <div key={i} className={"jv-act " + (m.kind === "delete" ? "del" : m.kind === "done" ? "done" : m.kind === "warn" ? "warn" : "")}><b>{m.text}</b>{m.detail ? " · " + m.detail : ""}{m.links?.length > 0 && <span className="jv-links">{m.links.map((l, j) => <a key={j} href={l.url} target="_blank" rel="noopener noreferrer">{String(l.titulo || l.url).slice(0, 60)}</a>)}</span>}</div>
        : m.k === "e" ? <div key={i} className="jv-err">{m.text}</div>
        : <div key={i} className={"jv-cap" + (i === lastReply && !live ? "" : " old")}>{m.text}</div>)}
      {live && <div className="jv-cap">{live}</div>}
      {interim && <div className="jv-you i">{interim}</div>}
    </div>
  );
  const confirmView = pending && (
    <div className="jv-confirm" role="alertdialog" aria-label="Confirmação">
      <p>{pending.text}</p>
      <button className="jv-btn" onClick={() => pending.resolve(false)}>Cancelar</button>
      <button className="jv-btn on" style={{ background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} onClick={() => pending.resolve(true)}>Confirmar</button>
    </div>
  );
  const inputView = (
    <form className="jv-in" onSubmit={submit}>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder={pending ? "Responda sim ou não" : "Ou digite o pedido…"} aria-label="Pedido para o Simão" />
      <button className="jv-btn on" type="submit" disabled={!input.trim() || (busy && !pending)}>Enviar</button>
    </form>
  );
  const stateView = (
    <span className="jv-state"><i style={online === false ? { background: "var(--bad)", boxShadow: "0 0 8px var(--bad)" } : undefined} />{online === false ? "Offline" : stateLabel}</span>
  );

  // Botão de parar: cala a fala, abandona o pedido em andamento e encerra a escuta.
  const stopAll = () => {
    if (pendingRef.current) { pendingRef.current.resolve(false); return; }
    cancelTurn(); stopRec(); setStatus("idle");
  };

  // ── Versão flutuante ─────────────────────────────────────────────────────
  if (!isFull) {
    const onOrb = () => {
      if (!dockOpen) { dockPinned.current = true; setDockOpen(true); if (!wake && status === "idle") onCore(); return; }
      onCore();
    };
    return (
      <div className={"jv jv-dock" + themeClass}>
        <style>{CSS}</style>
        {dockOpen && (
          <div className="jv-card" role="dialog" aria-label="Simão">
            <header>
              <span className="jv-brand" style={{ fontSize: 11 }}>SIMÃO</span>
              {stateView}
              <button className={"jv-btn" + (wake ? " on" : "")} style={{ padding: "4px 7px", fontSize: 9 }} onClick={toggleWake} disabled={!SR} title="Fica ouvindo: diga “Simão” e o pedido">Mãos livres</button>
              <button className="jv-x" onClick={() => setActiveTab("jarvis")} title="Abrir a tela do Simão" aria-label="Abrir a tela do Simão">⤢</button>
              <button className="jv-x" onClick={() => { dockPinned.current = false; setDockOpen(false); }} aria-label="Recolher">×</button>
            </header>
            {turn.length || live || interim ? turnView : <div className="jv-turn"><div className="jv-you" style={{ textAlign: "left" }}>{hint}</div></div>}
            {confirmView}
            {inputView}
          </div>
        )}
        <button ref={coreRef} className={"jv-orb is-" + status + (hasAmp ? "" : " no-amp")} onClick={onOrb}
          aria-label={status === "listening" ? "Encerrar escuta" : status === "speaking" ? "Interromper o Simão" : "Falar com o Simão"} title="Simão">
          <Sphere status={status} points={110} />
        </button>
      </div>
    );
  }

  // ── Tela cheia ───────────────────────────────────────────────────────────
  const readout = (value, label, question, bad) => (
    <button className="jv-ro" onClick={() => ask(question)} title={question}>
      <b className={"jv-mono" + (bad ? " bad" : "")}>{value}</b>{label}
    </button>
  );
  return (
    <div className={"jv jv-full" + themeClass + (full ? " jv-max" : "")}>
      <style>{CSS}</style>
      <i className="jv-corner tl" /><i className="jv-corner tr" /><i className="jv-corner bl" /><i className="jv-corner br" />

      <div className="jv-top">
        <span className="jv-brand">SIMÃO</span>
        {stateView}
        {readout(s.dueToday.length, "hoje", "O que tenho para hoje?")}
        {readout(s.overdue.length, "atrasadas", "O que está atrasado?", s.overdue.length > 0)}
        <div className="jv-ctl">
          <button className={"jv-btn" + (wake ? " on" : "")} onClick={toggleWake} disabled={!SR} title="Fica ouvindo: diga “Simão” e o pedido. Depois de cada resposta, continua ouvindo por alguns segundos.">Mãos livres</button>
          <button className={"jv-btn" + (showPanels ? " on" : "")} onClick={() => { setShowPanels(v => !v); setShowSet(false); }} aria-expanded={showPanels}>Painéis</button>
          <button className={"jv-btn" + (showSet ? " on" : "")} onClick={() => setShowSet(v => !v)} aria-expanded={showSet}>Ajustes</button>
          {showSet && (
            <div className="jv-pop">
              <h4>Voz</h4>
              <label>Tipo
                <select value={effectiveVoice} onChange={e => pickVoiceMode(e.target.value)}>
                  {neuralOk && <option value="neural">Neural (mais natural)</option>}
                  <option value="browser">Do navegador (instantânea)</option>
                  <option value="off">Desligada (só texto)</option>
                </select>
              </label>
              {effectiveVoice === "neural" && premiumVoice && <p className="jv-empty">Usando a voz nativa em português configurada no servidor.</p>}
              {effectiveVoice === "neural" && !premiumVoice && (
                <label>Timbre
                  <select value={voiceName} onChange={e => { setVoiceName(e.target.value); setPref("jarvis_voice_name", e.target.value); }}>
                    {NEURAL_VOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              )}
              {effectiveVoice !== "off" && (
                <label>Velocidade · {rate.toFixed(2)}x
                  <input type="range" min="0.9" max="1.5" step="0.05" value={rate} onChange={e => { const v = parseFloat(e.target.value); setRate(v); setPref("jarvis_rate", String(v)); }} />
                </label>
              )}
              {effectiveVoice !== "off" && <button className="jv-btn" onClick={() => speak(`Às ordens, ${firstName(app)}. Esta é a voz que estou usando agora.`)}>Testar voz</button>}

              <h4>Memória · {memItems.length}</h4>
              {memItems.length === 0 && <p className="jv-empty">Nada guardado ainda. Diga, por exemplo: “Simão, lembre que a Iris cuida do departamento pessoal”.</p>}
              {memItems.map(m => (
                <div className="jv-mem" key={m.id}>
                  <span>{m.content}</span>
                  <button onClick={() => memoryApi.remove(m.id)} aria-label="Apagar esta lembrança" title="Apagar">×</button>
                </div>
              ))}

              <h4>Tela</h4>
              <div className="row">
                <button className="jv-btn" onClick={() => { const t = theme === "blue" ? "gold" : "blue"; setTheme(t); setPref("simao_cor", t); }}>Cor: {theme === "blue" ? "azul" : "dourado"}</button>
                <button className="jv-btn" onClick={() => setFull(f => !f)}>{full ? "Sair da tela cheia" : "Tela cheia"}</button>
                <button className="jv-btn" onClick={() => { newConversation(); setShowSet(false); }} disabled={busy} title="Apaga a conversa atual. A memória permanente continua.">Nova conversa</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="jv-stage">
        <button ref={coreRef} className="jv-core" onClick={onCore}
          aria-label={status === "listening" ? "Encerrar escuta" : status === "speaking" ? "Interromper fala" : "Falar com o Simão"}>
          <Sphere status={status} />
        </button>

        <div className="jv-talkbox">
          {turnView}
          {confirmView}
        </div>

        <div className="jv-mics">
          <button className="jv-round sm" onClick={() => setShowKeys(v => !v)} aria-label="Digitar o pedido" aria-pressed={showKeys} title="Digitar"><KeyIcon /></button>
          <button className={"jv-round" + (status === "listening" ? " live" : "")} onClick={onCore} disabled={!SR || busy} aria-label={status === "listening" ? "Encerrar escuta" : "Falar"} title="Falar"><MicIcon /></button>
          <button className="jv-round sm" onClick={stopAll} disabled={status === "idle" && !pending} aria-label="Parar" title="Parar"><StopIcon /></button>
        </div>
        <p className="jv-hint">{hint}</p>
      </div>

      <div className="jv-foot">
        {(showKeys || !SR) && inputView}
      </div>

      {showPanels && (
        <aside className="jv-drawer" aria-label="Painéis">
          <section>
            <h3 className="jv-h">Agenda <span className="jv-mono">{s.dueToday.length} hoje · {s.overdue.length} atrasadas</span></h3>
            {agenda.map(taskRow)}
            {upcoming.map(taskRow)}
            {!agenda.length && !upcoming.length && <p className="jv-empty">Nada pendente nos próximos sete dias.</p>}
          </section>
          <section>
            <h3 className="jv-h">Hábitos de hoje <span className="jv-mono">{s.dailyDone.length}/{s.daily.length}</span></h3>
            <div className="jv-bar" style={{ marginTop: 0, marginBottom: 6 }}><i style={{ width: (s.daily.length ? s.dailyDone.length / s.daily.length * 100 : 0) + "%" }} /></div>
            {s.daily.map(h => {
              const done = (h.completedDates || []).includes(s.today);
              return <div className="jv-row" key={h.id}><i className={"jv-dot " + (done ? "ok" : "")} /><span className="t" style={done ? { color: "var(--dim)" } : undefined}>{h.title}</span></div>;
            })}
            {!s.daily.length && <p className="jv-empty">Nenhum hábito diário cadastrado.</p>}
          </section>
          {isAdmin && (
            <section>
              <h3 className="jv-h">Carteira <span className="jv-mono">{s.clients.length} clientes</span></h3>
              <div className="jv-pair"><span>Receita mensal</span><b className="jv-mono">{money(s.mrr)}</b></div>
              <div className="jv-pair"><span>Pagamento pendente</span><b className="jv-mono" style={s.pending.length ? { color: "var(--warn)" } : undefined}>{s.pending.length}</b></div>
              <div className="jv-pair"><span>Valor em aberto</span><b className="jv-mono">{money(s.pendingValue)}</b></div>
            </section>
          )}
          <section>
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
          <section>
            <h3 className="jv-h">Radar</h3>
            <div className="jv-pair"><span>Projetos ativos</span><b className="jv-mono">{s.projects.length}</b></div>
            <div className="jv-pair"><span>Projetos atrasados</span><b className="jv-mono" style={s.lateProjects.length ? { color: "var(--bad)" } : undefined}>{s.lateProjects.length}</b></div>
            <div className="jv-pair"><span>Concluídas hoje</span><b className="jv-mono">{s.doneToday.length}</b></div>
            {s.dates.slice(0, 3).map((d, i) => (
              <div className="jv-row" key={i}><i className="jv-dot warn" /><span className="t">{d.name}</span><span className="d jv-mono">{d.days === 0 ? "hoje" : d.days === 1 ? "amanhã" : d.days + " d"}</span></div>
            ))}
          </section>
          <section>
            <h3 className="jv-h">Conversa <span className="jv-mono">{msgs.filter(m => m.k !== "a").length}</span></h3>
            {msgs.filter(m => m.k === "u" || m.k === "j").slice(-24).map((m, i) => <div key={i} className={"jv-hist " + m.k}>{m.text}</div>)}
            {!msgs.length && <p className="jv-empty">Nenhuma conversa ainda.</p>}
          </section>
        </aside>
      )}
    </div>
  );
}
