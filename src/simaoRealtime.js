// Conversa em tempo real do Simão.
//
// Liga o microfone direto ao modelo de voz por WebRTC: ele ouve e responde em
// áudio, sem as etapas de transcrever, pensar e sintetizar. O servidor (função
// "jarvis") só emite uma chave temporária; as ferramentas continuam rodando
// aqui no navegador, pelas funções do app.

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export const realtimeSupported = () =>
  typeof window !== "undefined" && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia;

const rms = (an, data) => {
  an.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
  return Math.sqrt(sum / data.length);
};

// Trata os eventos que chegam do modelo. Fica separado da conexão para poder
// ser testado sem rede: recebe `send` (envia um evento) e devolve `handle`.
//   on.state(s)              "listening" | "thinking" | "speaking"
//   on.speechStop(id)        o usuário terminou uma fala (a transcrição vem depois)
//   on.userPartial(id, txt)  transcrição parcial da fala do usuário
//   on.userText(id, txt)     transcrição final ("" se não houve)
//   on.replyDelta(txt)       resposta acumulada até agora
//   on.replyDone(txt)        resposta (ou trecho antes de uma ferramenta) concluída
//   on.turnEnd()             o modelo terminou de responder
export function createRealtimeBrain({ send, runTool, on = {}, isClosed = () => false }) {
  let reply = "", state = "", responding = false, audioPlaying = false, sawBuffer = false, tools = 0;
  const partial = {};
  const setState = s => { if (s !== state) { state = s; on.state?.(s); } };
  const settle = () => { if (!responding && !audioPlaying && !tools && !isClosed()) setState("listening"); };

  const done = async response => {
    responding = false;
    const calls = (response?.output || []).filter(i => i?.type === "function_call" && i.name);
    const text = reply.trim();
    reply = "";
    if (text) on.replyDone?.(text);
    if (!calls.length) {
      if (!sawBuffer) audioPlaying = false;
      on.turnEnd?.();
      settle();
      return;
    }
    tools++;
    setState("thinking");
    try {
      for (const c of calls) {
        let args = {}, out;
        try { args = JSON.parse(c.arguments || "{}"); } catch { /* argumentos inválidos viram objeto vazio */ }
        try { out = await runTool(c.name, args); } catch (e) { out = { erro: String(e?.message || e) }; }
        if (isClosed()) return;
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: JSON.stringify(out ?? {}) } });
      }
      send({ type: "response.create" });
    } finally { tools--; }
  };

  const handle = ev => {
    switch (ev?.type) {
      case "input_audio_buffer.speech_started":
        setState("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        on.speechStop?.(ev.item_id);
        setState("thinking");
        break;
      case "conversation.item.input_audio_transcription.delta":
        partial[ev.item_id] = (partial[ev.item_id] || "") + (ev.delta || "");
        on.userPartial?.(ev.item_id, partial[ev.item_id]);
        break;
      case "conversation.item.input_audio_transcription.completed":
        delete partial[ev.item_id];
        on.userText?.(ev.item_id, String(ev.transcript || "").trim());
        break;
      case "conversation.item.input_audio_transcription.failed":
        delete partial[ev.item_id];
        on.userText?.(ev.item_id, "");
        break;
      case "response.created":
        responding = true;
        if (state !== "speaking") setState("thinking");
        break;
      // Nomes atuais e os da versão anterior da API.
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
      case "response.output_text.delta":
      case "response.text.delta":
        reply += ev.delta || "";
        on.replyDelta?.(reply);
        if (!sawBuffer) { audioPlaying = true; setState("speaking"); }
        break;
      case "output_audio_buffer.started":
        sawBuffer = true; audioPlaying = true;
        setState("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        audioPlaying = false;
        settle();
        break;
      case "response.done":
        return done(ev.response);
      case "error":
        console.warn("[simao] tempo real:", ev.error?.message || ev.error?.code || "erro");
        on.warn?.(ev.error?.message || "");
        break;
      default:
    }
  };

  return {
    handle,
    start: () => setState("listening"),
    // Cala a resposta em andamento (botão, Esc).
    interrupt() {
      if (responding) send({ type: "response.cancel" });
      if (audioPlaying || responding) send({ type: "output_audio_buffer.clear" });
    },
    sendText(text) {
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      send({ type: "response.create" });
      setState("thinking");
    },
  };
}

// Abre a conversa. `mint()` busca a chave temporária no servidor; `level(out, in)`
// recebe o volume da voz dele e do microfone, de 0 a 1, a cada quadro.
export async function openRealtime({ mint, runTool, on = {}, audioCtx, level }) {
  let closed = false, pc = null, dc = null, mic = null, raf = 0;
  const audio = new Audio();
  audio.autoplay = true;

  const close = (reason = "encerrada") => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    try { dc?.close(); } catch { /* já fechado */ }
    try { pc?.close(); } catch { /* já fechado */ }
    mic?.getTracks().forEach(t => t.stop());
    try { audio.pause(); audio.srcObject = null; } catch { /* sem áudio */ }
    level?.(0, 0);
    on.closed?.(reason);
  };
  const send = o => { if (!closed && dc?.readyState === "open") dc.send(JSON.stringify(o)); };
  const brain = createRealtimeBrain({ send, runTool, on, isClosed: () => closed });

  try {
    const [secret, stream] = await Promise.allSettled([
      mint(),
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    ]);
    if (stream.status === "fulfilled") mic = stream.value;
    if (stream.status === "rejected") {
      const denied = /NotAllowed|Permission|denied/i.test(String(stream.reason?.name) + String(stream.reason?.message));
      const e = new Error(denied ? "O microfone está bloqueado para este site. Libere o acesso no cadeado da barra de endereço." : "Não consegui abrir o microfone.");
      e.mic = true;
      throw e;
    }
    if (secret.status === "rejected") throw secret.reason;
    if (closed) throw new Error("cancelada");

    pc = new RTCPeerConnection();
    const meters = {};
    const meter = (name, src) => {
      if (!audioCtx) return;
      try {
        const an = audioCtx.createAnalyser();
        an.fftSize = 512;
        audioCtx.createMediaStreamSource(src).connect(an); // só mede; quem toca é o <audio>
        meters[name] = { an, data: new Uint8Array(an.fftSize) };
      } catch (e) { console.warn("[simao] medidor de áudio:", e.message); }
    };
    pc.ontrack = e => {
      audio.srcObject = e.streams[0];
      audio.play?.().catch(() => {});
      meter("out", e.streams[0]);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") close("conexão perdida"); };
    mic.getTracks().forEach(t => pc.addTrack(t, mic));
    meter("in", mic);
    if (level && audioCtx) {
      const loop = () => {
        const o = meters.out ? Math.min(1, rms(meters.out.an, meters.out.data) * 4.5) : 0;
        const i = meters.in ? Math.min(1, Math.max(0, rms(meters.in.an, meters.in.data) - .012) * 9) : 0;
        level(o, i);
        raf = requestAnimationFrame(loop);
      };
      loop();
    }

    dc = pc.createDataChannel("oai-events");
    dc.onmessage = e => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      Promise.resolve(brain.handle(ev)).catch(err => console.warn("[simao] tempo real:", err?.message));
    };
    dc.onclose = () => close("conexão encerrada");
    const opened = new Promise((ok, no) => {
      dc.onopen = ok;
      setTimeout(() => no(new Error("A conexão de voz demorou demais.")), 15000);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { "Authorization": "Bearer " + secret.value.key, "Content-Type": "application/sdp" },
    });
    if (!res.ok) throw new Error(`O servidor de voz recusou a conexão (${res.status}).`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await opened;
    if (closed) throw new Error("cancelada");
    brain.start();
    return { close, sendText: brain.sendText, interrupt: brain.interrupt, info: secret.value };
  } catch (e) {
    const quiet = on.closed;
    on.closed = null; // quem chamou recebe o erro; não precisa do aviso de fechamento
    close("falha");
    on.closed = quiet;
    throw e;
  }
}
