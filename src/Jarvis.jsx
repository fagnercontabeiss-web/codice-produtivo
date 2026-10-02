// Simão — assistente de voz e HUD do YOETZ Produtivo.
//
// O raciocínio vem da Edge Function "jarvis" (nome interno, no Supabase). As ações são
// executadas aqui, pelas funções do próprio app (ver jarvisTools.js).

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { auth, db } from "./supabase.js";
import { runTool, snapshot, greeting, buildContext, fmtBR, matchWake, saidYes, saidNo } from "./jarvisTools.js";

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
    const timer = setTimeout(() => ctl.abort(), body.action === "chat" ? 45000 : 20000);
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
  if (wantBlob && res.ok && (res.headers.get("Content-Type") || "").includes("audio")) return res.blob();
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
.jv{--a:#f0b860;--a-rgb:240,184,96;--bg:#040706;--bg2:#0e1c15;--ink:#f6f1e6;--dim:rgba(246,241,230,.6);--faint:rgba(246,241,230,.32);--warn:#ffb454;--bad:#ff6b5e;--ok:#63e6a8;
  color:var(--ink);font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.jv.jv-blue{--a:#5fd4ff;--a-rgb:95,212,255;--bg:#04080d;--bg2:#0b1826;--ink:#e6f6ff;--dim:rgba(230,246,255,.58);--faint:rgba(230,246,255,.3)}
.jv *{box-sizing:border-box}
.jv-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.jv-btn{font:inherit;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);background:rgba(var(--a-rgb),.05);border:1px solid rgba(var(--a-rgb),.22);border-radius:3px;padding:7px 11px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.jv-btn:hover{color:var(--ink);border-color:rgba(var(--a-rgb),.55)}
.jv-btn.on{color:var(--bg);background:var(--a);border-color:var(--a);font-weight:700}
.jv-btn:disabled{opacity:.4;cursor:not-allowed}
.jv-btn:focus-visible,.jv-core:focus-visible,.jv-in input:focus-visible,.jv-ro:focus-visible,.jv-orb:focus-visible{outline:2px solid var(--a);outline-offset:3px}

/* ── Tela cheia (aba do Simão) ── */
.jv-full{position:fixed;top:56px;left:0;right:0;bottom:0;z-index:10;display:flex;flex-direction:column;overflow:hidden;
  background:radial-gradient(ellipse 60% 55% at 50% 40%,var(--bg2) 0%,var(--bg) 72%)}
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
.jv-stage{position:relative;z-index:2;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;padding:6px 24px 0}
.jv-ring{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:clamp(14px,3vw,46px);width:100%;max-width:1040px;flex-shrink:0}
.jv-side{display:flex;flex-direction:column;gap:clamp(18px,5vh,48px)}
.jv-side.l{align-items:flex-end}.jv-side.r{align-items:flex-start}
.jv-ro{position:relative;font:inherit;color:inherit;background:none;border:0;padding:0 0 6px;cursor:pointer;text-align:right;min-width:112px;border-bottom:1px solid rgba(var(--a-rgb),.35);transition:border-color .15s}
.jv-side.r .jv-ro{text-align:left}
.jv-ro:hover{border-color:var(--a)}
.jv-ro::after{content:"";position:absolute;bottom:-1px;width:clamp(10px,2.4vw,36px);height:1px;background:linear-gradient(90deg,rgba(var(--a-rgb),.35),transparent)}
.jv-side.l .jv-ro::after{left:100%}.jv-side.r .jv-ro::after{right:100%;transform:scaleX(-1)}
.jv-ro b{display:block;font-size:clamp(30px,4.6vh,46px);font-weight:200;line-height:1;text-shadow:0 0 18px rgba(var(--a-rgb),.45)}
.jv-ro b.bad{color:var(--bad);text-shadow:0 0 18px rgba(255,107,94,.5)}
.jv-ro small{display:block;margin-top:6px;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:var(--a)}
.jv-core{--amp:0;position:relative;width:min(46vh,380px,62vw);aspect-ratio:1;flex-shrink:0;border:0;background:none;padding:0;cursor:pointer;color:var(--a);border-radius:50%}
.jv-core svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 18px rgba(var(--a-rgb),.4))}
.jv-core .r{fill:none;stroke:currentColor;transform-origin:200px 200px}
.jv-core .r1{animation:jv-spin 60s linear infinite}
.jv-core .r2{animation:jv-spin 26s linear infinite reverse}
.jv-core .r3{animation:jv-spin 16s linear infinite}
.jv-core .r4{animation:jv-spin 38s linear infinite reverse}
.jv-core .r5{animation:jv-spin 9s linear infinite}
.jv-core .sweep{transform-origin:200px 200px;animation:jv-spin 7s linear infinite}
.jv-core .heart{transform-origin:200px 200px;transform:scale(calc(1 + var(--amp) * .4));transition:transform .08s linear}
.jv-core.is-listening .heart{animation:jv-pulse 1.1s ease-in-out infinite}
.jv-core.is-thinking .r2{animation-duration:3s}.jv-core.is-thinking .r3{animation-duration:1.8s}.jv-core.is-thinking .r4{animation-duration:5s}.jv-core.is-thinking .sweep{animation-duration:1.6s}
.jv-core.is-speaking.no-amp .heart{animation:jv-pulse .55s ease-in-out infinite}
.jv-core.is-listening svg,.jv-core.is-speaking svg{filter:drop-shadow(0 0 34px rgba(var(--a-rgb),.8))}
@keyframes jv-spin{to{transform:rotate(360deg)}}
@keyframes jv-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.24)}}
@keyframes jv-blink{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes jv-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.jv-hint{margin:6px 0 0;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--faint);min-height:14px;text-align:center}
.jv-turn{flex:1;min-height:0;width:100%;max-width:760px;margin-top:10px;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:9px;padding:0 6px 6px;scrollbar-width:thin;scrollbar-color:rgba(var(--a-rgb),.25) transparent}
.jv-you{font-size:12.5px;color:var(--dim);text-align:center}
.jv-you::before{content:"› ";color:var(--a)}
.jv-you.i{color:var(--a);font-style:italic}
.jv-cap{font-size:clamp(17px,2.5vh,23px);line-height:1.5;font-weight:300;text-align:center;text-wrap:balance;animation:jv-in .25s ease-out}
.jv-cap.old{font-size:14px;color:var(--dim)}
.jv-err{font-size:13px;color:var(--bad);text-align:center}
.jv-act{font-size:11px;color:var(--dim);border:1px solid rgba(var(--a-rgb),.25);border-left:2px solid var(--a);padding:4px 10px;animation:jv-in .25s ease-out}
.jv-act b{color:var(--ink);font-weight:600}.jv-act.del{border-left-color:var(--bad)}.jv-act.done{border-left-color:var(--ok)}.jv-act.warn{border-left-color:var(--warn);color:var(--warn)}
.jv-confirm{width:100%;max-width:640px;border:1px solid var(--bad);background:rgba(255,107,94,.09);padding:11px 13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
.jv-confirm p{margin:0;flex:1;min-width:160px}
.jv-foot{position:relative;z-index:3;padding:10px 30px 22px}
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
.jv-orb{--amp:0;width:58px;height:58px;border-radius:50%;border:1px solid rgba(var(--a-rgb),.5);background:radial-gradient(circle at 50% 45%,var(--bg2),var(--bg));color:var(--a);cursor:pointer;padding:5px;box-shadow:0 8px 26px rgba(0,0,0,.45),0 0 18px rgba(var(--a-rgb),.25);transition:transform .15s,box-shadow .2s}
.jv-orb:hover{transform:scale(1.06)}
.jv-orb.is-listening,.jv-orb.is-speaking{box-shadow:0 8px 26px rgba(0,0,0,.45),0 0 30px rgba(var(--a-rgb),.75)}
.jv-orb svg{width:100%;height:100%;overflow:visible}
.jv-orb .r{fill:none;stroke:currentColor;transform-origin:200px 200px}
.jv-orb .r1,.jv-orb .r4,.jv-orb .r5,.jv-orb .sweep,.jv-orb .thin{display:none}
.jv-orb .r2{animation:jv-spin 14s linear infinite reverse;stroke-width:16}
.jv-orb .r3{animation:jv-spin 9s linear infinite;stroke-width:8}
.jv-orb.is-thinking .r2{animation-duration:2s}.jv-orb.is-thinking .r3{animation-duration:1.2s}
.jv-orb .heart{transform-origin:200px 200px;transform:scale(calc(1.5 + var(--amp) * .5))}
.jv-orb.is-listening .heart,.jv-orb.is-speaking.no-amp .heart{animation:jv-pulse2 .9s ease-in-out infinite}
@keyframes jv-pulse2{0%,100%{transform:scale(1.5)}50%{transform:scale(1.9)}}
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
  .jv-top{padding:14px 18px 0}.jv-clock{display:none}
  .jv-ring{grid-template-columns:1fr;justify-items:center;gap:12px}
  .jv-core{order:-1;width:min(34vh,240px,60vw)}
  .jv-side{flex-direction:row;gap:26px}.jv-side.l,.jv-side.r{align-items:flex-end}
  .jv-ro,.jv-side.r .jv-ro{text-align:center;min-width:84px}.jv-ro::after{display:none}
  .jv-ro b{font-size:26px}
  .jv-foot{padding:8px 16px 16px}.jv-in input{font-size:16px}
  .jv-corner{display:none}
}
@media (prefers-reduced-motion:reduce){.jv .r,.jv .heart,.jv .sweep,.jv-state i,.jv-cap,.jv-act,.jv-drawer,.jv-card{animation:none!important;transition:none}}
`;

function Reactor() {
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true">
      <path className="sweep" d="M200 200 L200 14 A186 186 0 0 1 331.5 68.5 Z" fill="currentColor" opacity=".07" />
      <circle className="r thin" cx="200" cy="200" r="192" strokeWidth="1" opacity=".2" />
      <circle className="r r1" cx="200" cy="200" r="180" strokeWidth="7" strokeDasharray="1.5 14.2" opacity=".75" />
      <circle className="r r4" cx="200" cy="200" r="164" strokeWidth="1.5" strokeDasharray="3 9" opacity=".5" />
      <circle className="r r2" cx="200" cy="200" r="146" strokeWidth="6" strokeDasharray="190 58 80 58 30 58" opacity=".9" />
      <circle className="r thin" cx="200" cy="200" r="130" strokeWidth="1" opacity=".4" />
      <circle className="r r4" cx="200" cy="200" r="114" strokeWidth="13" strokeDasharray="46 17" opacity=".22" />
      <circle className="r r3" cx="200" cy="200" r="96" strokeWidth="2.5" strokeDasharray="110 91" opacity=".85" />
      <circle className="r r5" cx="200" cy="200" r="78" strokeWidth="1.5" strokeDasharray="2 8" opacity=".6" />
      <g className="heart">
        <circle cx="200" cy="200" r="58" fill="currentColor" opacity=".1" />
        <circle cx="200" cy="200" r="40" fill="currentColor" opacity=".28" />
        <circle cx="200" cy="200" r="21" fill="currentColor" opacity=".96" />
      </g>
    </svg>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="jv-clock jv-mono">{now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "")} · {now.toLocaleTimeString("pt-BR")}</span>;
}

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
  const [theme, setTheme] = useState(getPref("jarvis_theme", "gold")); // gold | blue
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

    const playBlob = blob => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = rateRef.current;
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("áudio inválido")); };
      try { // núcleo reagindo ao volume real da fala
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
          if (coreRef.current) coreRef.current.style.setProperty("--amp", Math.min(1, Math.sqrt(sum / data.length) * 4).toFixed(3));
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
            const blob = await item.job;
            if (stale()) return;
            if (!(blob instanceof Blob)) throw new Error("sem áudio");
            await playBlob(blob);
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
      const job = mode === "neural" && !neuralBroken ? callFn({ action: "tts", text: text.slice(0, 1200), voice: voiceNameRef.current }, true) : null;
      if (job) job.catch(() => {});
      queue.push({ text, job });
      pump();
    };
    // A primeira frase sai sozinha (áudio começa logo); as seguintes se agrupam.
    const drain = () => {
      let m;
      while ((m = buf.match(/^([\s\S]*?[.!?…]+["')\]]*)\s+/))) {
        buf = buf.slice(m[0].length);
        hold = hold ? hold + " " + m[1] : m[1];
        if (first || hold.length >= 60) { emit(hold); hold = ""; first = false; }
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
      if (silent) final = "Feito, senhor.";
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

  fn.current = { listen, stopRec, startWake, listenForInterrupt };

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
      let ok = false, neural = false;
      try {
        const p = await Promise.race([callFn({ action: "ping" }), sleep(6000).then(() => { throw new Error("tempo esgotado"); })]);
        ok = !!(p.providers?.anthropic || p.providers?.openai); neural = !!p.providers?.openai;
      } catch (e) { console.warn("[simao] ping:", e.message); }
      if (cancelled) return;
      setOnline(ok); setNeuralOk(neural);
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
      stopRec(); stopSpeaking();
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
  const stateLabel = { idle: wake ? "Ouvindo — diga “Simão”" : "Em espera", listening: "Ouvindo", thinking: "Processando", speaking: "Respondendo" }[status];
  const hint = pending ? "Diga sim ou não" : status === "listening" ? (wake ? "Pode falar" : "Toque para encerrar") : status === "speaking" ? (wake ? "Diga “Simão” ou toque para interromper" : "Toque para interromper") : status === "thinking" ? "" : wake ? "Diga “Simão” e o pedido" : SR ? "Toque no núcleo para falar" : "Voz indisponível neste navegador — digite abaixo";
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
  const turn = lastUser >= 0 ? msgs.slice(lastUser) : msgs.slice(-1);
  const lastReply = turn.map(m => m.k).lastIndexOf("j");
  const themeClass = theme === "blue" ? " jv-blue" : "";
  const busy = status === "thinking";
  const ask = q => { if (!busy) send(q); };

  const turnView = (
    <div className="jv-turn" ref={talkRef} aria-live="polite">
      {turn.map((m, i) =>
        m.k === "u" ? <div key={i} className="jv-you">{m.text}</div>
        : m.k === "a" ? <div key={i} className={"jv-act " + (m.kind === "delete" ? "del" : m.kind === "done" ? "done" : m.kind === "warn" ? "warn" : "")}><b>{m.text}</b>{m.detail ? " · " + m.detail : ""}</div>
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
          <Reactor />
        </button>
      </div>
    );
  }

  // ── Tela cheia ───────────────────────────────────────────────────────────
  const readout = (value, label, question, bad) => (
    <button className="jv-ro" onClick={() => ask(question)} title={question}>
      <b className={"jv-mono" + (bad ? " bad" : "")}>{value}</b><small>{label}</small>
    </button>
  );
  return (
    <div className={"jv jv-full" + themeClass + (full ? " jv-max" : "")}>
      <style>{CSS}</style>
      <i className="jv-corner tl" /><i className="jv-corner tr" /><i className="jv-corner bl" /><i className="jv-corner br" />

      <div className="jv-top">
        <span className="jv-brand">SIMÃO</span>
        {stateView}
        <Clock />
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
              {effectiveVoice === "neural" && (
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
              {effectiveVoice !== "off" && <button className="jv-btn" onClick={() => speak("Às suas ordens, senhor. Esta é a voz que estou usando agora.")}>Testar voz</button>}

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
                <button className="jv-btn" onClick={() => { const t = theme === "blue" ? "gold" : "blue"; setTheme(t); setPref("jarvis_theme", t); }}>Cor: {theme === "blue" ? "azul" : "dourado"}</button>
                <button className="jv-btn" onClick={() => setFull(f => !f)}>{full ? "Sair da tela cheia" : "Tela cheia"}</button>
                <button className="jv-btn" onClick={() => { newConversation(); setShowSet(false); }} disabled={busy} title="Apaga a conversa atual. A memória permanente continua.">Nova conversa</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="jv-stage">
        <div className="jv-ring">
          <div className="jv-side l">
            {readout(s.dueToday.length, "Para hoje", "O que tenho para hoje?")}
            {readout(s.week.length, "Próximos 7 dias", "O que vence nos próximos sete dias?")}
          </div>
          <button ref={coreRef} className={"jv-core is-" + status + (hasAmp ? "" : " no-amp")} onClick={onCore}
            aria-label={status === "listening" ? "Encerrar escuta" : status === "speaking" ? "Interromper fala" : "Falar com o Simão"}>
            <Reactor />
          </button>
          <div className="jv-side r">
            {readout(s.overdue.length, "Atrasadas", "O que está atrasado?", s.overdue.length > 0)}
            {isAdmin
              ? readout(s.pending.length, "Pagamentos pendentes", "Quem está com pagamento pendente?")
              : readout(`${s.dailyDone.length}/${s.daily.length}`, "Hábitos de hoje", "Como estão meus hábitos?")}
          </div>
        </div>
        <p className="jv-hint">{hint}</p>
        {turnView}
        {confirmView}
      </div>

      <div className="jv-foot">
        <div className="jv-in" style={{ marginBottom: 0 }}>
          <button className="jv-btn" type="button" onClick={() => ask("Briefing do dia")} disabled={busy}>Briefing</button>
          <form style={{ display: "contents" }} onSubmit={submit}>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder={pending ? "Responda sim ou não" : "Ou digite o pedido…"} aria-label="Pedido para o Simão" />
            <button className="jv-btn on" type="submit" disabled={!input.trim() || (busy && !pending)}>Enviar</button>
          </form>
        </div>
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
