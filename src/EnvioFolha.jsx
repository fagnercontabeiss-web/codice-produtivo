// YOETZ · Central de Envio de Folha
// Lê Departamento Pessoal / {Competência} / {Cliente} no Google Drive e envia os arquivos pelo WhatsApp,
// com controle de envio/entrega/leitura (substitui o envio um a um e o controle no caderno).
import { useCallback, useEffect, useMemo, useState } from "react";
import { rest, callFunction } from "./supabase.js";

const VERDE = "#2B5E46";
const DOURADO = "#B8965A";
const BORDA = "#E8E6E0";
const CINZA = "#6E6F69";

const TIPO = {
  FOLHA:     { label: "Folha",      bg: "#E9F1EC", fg: "#234D39" },
  RECIBO:    { label: "Recibos",    bg: "#E9F1EC", fg: "#234D39" },
  FGTS:      { label: "FGTS",       bg: "#E6EEF6", fg: "#274B6D" },
  INSS_DARF: { label: "INSS/DARF",  bg: "#ECEAF6", fg: "#453F7A" },
  GUIA:      { label: "Guia",       bg: "#E6EEF6", fg: "#274B6D" },
  PROLABORE: { label: "Pró-labore", bg: "#F5EEDF", fg: "#7A5E26" },
  FERIAS:    { label: "Férias",     bg: "#E4F2F0", fg: "#1F5A54" },
  RESCISAO:  { label: "Rescisão",   bg: "#F8E9E7", fg: "#8C3B33" },
  OUTROS:    { label: "Outros",     bg: "#EFEEEA", fg: "#55564F" },
};

const STATUS = {
  pronto:   { label: "Pronto",   cor: "#B7791F" },
  enviando: { label: "Enviando", cor: "#2F6F9F" },
  enviado:  { label: "Enviado",  cor: "#2F6F9F" },
  lido:     { label: "Lido",     cor: VERDE },
  falhou:   { label: "Falhou",   cor: "#C2554B" },
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const fmtComp = (iso) => { const [a, m] = iso.split("-"); return MESES[Number(m) - 1] + "/" + a; };
const fmtDataHora = (iso) => iso
  ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "—";
const fmtFone = (w) => {
  const d = String(w || "").replace(/^55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
};
const normalizarFone = (v) => {
  let d = String(v || "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
};
const pendente = (d) => d.status === "pronto" || d.status === "falhou";
const entregue = (d) => d.status === "enviado" || d.status === "lido";
const enc = encodeURIComponent;

const btn = "rounded-lg px-3 h-8 text-[12.5px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
const btnPrimario = { background: VERDE, color: "#fff" };
const btnSecundario = { background: "#fff", color: "#1C1F1D", border: "1px solid " + BORDA };

export default function EnvioFolha() {
  const [competencias, setCompetencias] = useState([]);
  const [comp, setComp] = useState("");
  const [docs, setDocs] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [contatos, setContatos] = useState([]);
  const [vinculos, setVinculos] = useState([]);
  const [config, setConfig] = useState(null); // { google, whatsapp, conta_servico }
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [sincronizando, setSincronizando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [modalContatos, setModalContatos] = useState(null);
  const [modalHistorico, setModalHistorico] = useState(null);

  const mostrar = useCallback((tipo, msg) => {
    setAviso({ tipo, msg });
    window.setTimeout(() => setAviso((a) => (a && a.msg === msg ? null : a)), 7000);
  }, []);

  const carregarCompetencias = useCallback(async () => {
    const data = await rest("dp_competencias?select=competencia,sincronizado_em&order=competencia.desc");
    setCompetencias(data || []);
    setComp((c) => c || (data && data[0] ? data[0].competencia : ""));
  }, []);

  const carregarDados = useCallback(async () => {
    const [c, k, v] = await Promise.all([
      rest("clients?select=id,name,document&order=name"),
      rest("dp_contatos?select=*&ativo=is.true&order=nome"),
      rest("dp_vinculos?select=pasta_norm,pasta_nome,client_id,confirmado,origem"),
    ]);
    setClientes(c || []); setContatos(k || []); setVinculos(v || []);
    if (comp) {
      const d = await rest("dp_documentos?select=*&competencia=eq." + comp + "&status=neq.ignorado&order=nome_arquivo&limit=5000");
      setDocs(d || []);
    } else setDocs([]);
  }, [comp]);

  // Carga inicial
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await carregarCompetencias();
        const st = await callFunction("dp-folha", { action: "status" }).catch(() => null);
        if (vivo) setConfig(st);
      } catch (e) { if (vivo) mostrar("erro", e.message); }
      if (vivo) setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [carregarCompetencias, mostrar]);

  // Dados da competência + atualização periódica (status de entrega/leitura chegam pelo webhook)
  useEffect(() => {
    carregarDados().catch((e) => mostrar("erro", e.message));
    setSelecionados(new Set());
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") carregarDados().catch(() => {});
    }, 30000);
    return () => window.clearInterval(t);
  }, [carregarDados, mostrar]);

  const grupos = useMemo(() => {
    const porId = new Map(clientes.map((c) => [c.id, c]));
    const vinc = new Map(vinculos.map((v) => [v.pasta_norm, v]));
    const mapa = new Map();
    for (const d of docs) {
      if (!mapa.has(d.pasta_cliente_norm)) {
        const v = vinc.get(d.pasta_cliente_norm) || null;
        const cliente = v ? porId.get(v.client_id) || null : null;
        mapa.set(d.pasta_cliente_norm, {
          chave: d.pasta_cliente_norm, pasta: d.pasta_cliente_nome, vinculo: v, cliente,
          contatos: cliente ? contatos.filter((k) => k.client_id === cliente.id && k.recebe_folha) : [],
          docs: [],
        });
      }
      mapa.get(d.pasta_cliente_norm).docs.push(d);
    }
    return [...mapa.values()].sort((a, b) => a.pasta.localeCompare(b.pasta, "pt-BR"));
  }, [docs, clientes, contatos, vinculos]);

  const confirmado = (g) => !!(g.cliente && g.vinculo && g.vinculo.confirmado);
  const podeEnviarWa = (g) => confirmado(g) && g.contatos.length > 0 && !!(config && config.whatsapp);

  const gruposFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return grupos.filter((g) => {
      const alvo = (g.pasta + " " + (g.cliente ? g.cliente.name + " " + (g.cliente.document || "") : "")).toLowerCase();
      if (q && !alvo.includes(q)) return false;
      if (filtro === "pendentes") return g.docs.some(pendente);
      if (filtro === "enviados") return g.docs.every(entregue);
      if (filtro === "falhas") return g.docs.some((d) => d.status === "falhou");
      if (filtro === "sem_contato") return confirmado(g) && g.contatos.length === 0;
      if (filtro === "sem_vinculo") return !confirmado(g);
      return true;
    });
  }, [grupos, filtro, busca]);

  const kpi = useMemo(() => ({
    clientes: grupos.length,
    concluidos: grupos.filter((g) => g.docs.every(entregue)).length,
    pendentes: docs.filter(pendente).length,
    enviados: docs.filter(entregue).length,
    lidos: docs.filter((d) => d.status === "lido").length,
    falhas: docs.filter((d) => d.status === "falhou").length,
    ajustar: grupos.filter((g) => !confirmado(g) || g.contatos.length === 0).length,
  }), [grupos, docs]);

  // ------------------------------------------------------------ ações
  async function sincronizar() {
    setSincronizando(true);
    try {
      const data = await callFunction("dp-folha", { action: "sync", ...(comp ? { competencia: comp.slice(0, 7) } : {}) });
      await carregarCompetencias();
      await carregarDados();
      const r = data.resumo && data.resumo[0];
      mostrar("ok", r
        ? `Drive lido: ${r.documentos} arquivos em ${r.clientes} pastas · ${r.novos} novos` +
          (r.alterados_apos_envio ? ` · ${r.alterados_apos_envio} alterados após envio` : "") +
          (r.pastas_sem_vinculo ? ` · ${r.pastas_sem_vinculo} pastas sem cliente` : "")
        : "Drive lido.");
    } catch (e) { mostrar("erro", e.message); }
    setSincronizando(false);
  }

  async function enviarWhatsapp(ids, reenviar) {
    if (!ids.length) return;
    const nPastas = new Set(docs.filter((d) => ids.includes(d.id)).map((d) => d.pasta_cliente_norm)).size;
    if (!window.confirm(`${reenviar ? "Reenviar" : "Enviar"} ${ids.length} documento(s) de ${nPastas} cliente(s) pelo WhatsApp?`)) return;
    setProgresso({ feito: 0, total: ids.length });
    let ok = 0, falhas = 0;
    const erros = new Set();
    const LOTE = 4;
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = ids.slice(i, i + LOTE);
      try {
        const data = await callFunction("dp-folha", { action: "enviar", documento_ids: lote, reenviar: !!reenviar });
        for (const r of data.resultados || []) { if (r.ok) ok++; else { falhas++; if (r.erro) erros.add(r.erro); } }
      } catch (e) { falhas += lote.length; erros.add(e.message); }
      setProgresso({ feito: Math.min(i + LOTE, ids.length), total: ids.length });
    }
    setProgresso(null);
    setSelecionados(new Set());
    await carregarDados().catch(() => {});
    mostrar(falhas ? "erro" : "ok", `${ok} enviado(s)` + (falhas ? ` · ${falhas} com falha: ${[...erros].slice(0, 2).join(" · ")}` : ""));
  }

  async function marcarEnviado(ids) {
    if (!ids.length) return;
    try {
      const agora = new Date().toISOString();
      await rest("dp_envios", {
        method: "POST", prefer: "return=minimal",
        body: ids.map((id) => ({ documento_id: id, canal: "manual", status: "enviado", enviado_em: agora })),
      });
      setSelecionados(new Set());
      await carregarDados();
      mostrar("ok", `${ids.length} documento(s) marcados como enviados.`);
    } catch (e) { mostrar("erro", e.message); }
  }

  async function desfazerEnvio(doc) {
    if (!window.confirm("Voltar este documento para “Pronto”? O histórico de envios é mantido.")) return;
    try {
      await rest("dp_documentos?id=eq." + doc.id, {
        method: "PATCH", prefer: "return=minimal",
        body: { status: "pronto", enviado_manual: false, rodada_em: new Date().toISOString() },
      });
      await carregarDados();
    } catch (e) { mostrar("erro", e.message); }
  }

  async function vincular(g, clientId) {
    try {
      await rest("dp_vinculos?on_conflict=pasta_norm", {
        method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
        body: { pasta_norm: g.chave, pasta_nome: g.pasta, client_id: clientId, confirmado: true, origem: "manual" },
      });
      await carregarDados();
      mostrar("ok", `Pasta “${g.pasta}” vinculada. Nos próximos meses o vínculo é automático.`);
    } catch (e) { mostrar("erro", e.message); }
  }

  async function confirmarVinculo(g) {
    try {
      await rest("dp_vinculos?pasta_norm=eq." + enc(g.chave), { method: "PATCH", prefer: "return=minimal", body: { confirmado: true } });
      await carregarDados();
    } catch (e) { mostrar("erro", e.message); }
  }

  async function desfazerVinculo(g) {
    if (!window.confirm(`Desvincular a pasta “${g.pasta}” de ${g.cliente ? g.cliente.name : "seu cliente"}?`)) return;
    try {
      await rest("dp_vinculos?pasta_norm=eq." + enc(g.chave), { method: "DELETE", prefer: "return=minimal" });
      await carregarDados();
    } catch (e) { mostrar("erro", e.message); }
  }

  async function mudarTipo(doc, tipo) {
    try {
      await rest("dp_documentos?id=eq." + doc.id, { method: "PATCH", prefer: "return=minimal", body: { tipo, tipo_manual: true } });
      setDocs((ds) => ds.map((d) => (d.id === doc.id ? { ...d, tipo, tipo_manual: true } : d)));
    } catch (e) { mostrar("erro", e.message); }
  }

  const toggle = (id) => setSelecionados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGrupo = (g) => setSelecionados((s) => {
    const ids = g.docs.filter(pendente).map((d) => d.id);
    const todos = ids.every((id) => s.has(id));
    const n = new Set(s);
    ids.forEach((id) => (todos ? n.delete(id) : n.add(id)));
    return n;
  });

  const idsSelecionados = [...selecionados];
  const selecionadosWa = idsSelecionados.filter((id) => {
    const d = docs.find((x) => x.id === id);
    const g = d && grupos.find((x) => x.chave === d.pasta_cliente_norm);
    return g && podeEnviarWa(g);
  });
  const prontosWa = gruposFiltrados.filter(podeEnviarWa).flatMap((g) => g.docs.filter(pendente).map((d) => d.id));
  const compAtual = competencias.find((c) => c.competencia === comp);
  const pct = kpi.clientes ? Math.round((kpi.concluidos / kpi.clientes) * 100) : 0;
  const waAtivo = !!(config && config.whatsapp);

  if (carregando) return <p className="text-[13px]" style={{ color: CINZA }}>Carregando…</p>;

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-[12px] font-medium" style={{ color: DOURADO }}>Departamento Pessoal</p>
          <p className="text-[13px]" style={{ color: CINZA }}>
            {compAtual && compAtual.sincronizado_em ? "Drive lido em " + fmtDataHora(compAtual.sincronizado_em) : "Leia o Drive para carregar os arquivos da competência."}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: CINZA }}>
          Competência
          <select value={comp} onChange={(e) => setComp(e.target.value)} className="rounded-lg border bg-white px-3 h-9 text-[13px] font-medium" style={{ color: "#1C1F1D" }}>
            {competencias.length === 0 && <option value="">—</option>}
            {competencias.map((c) => <option key={c.competencia} value={c.competencia}>{fmtComp(c.competencia)}</option>)}
          </select>
        </label>
        <button onClick={sincronizar} disabled={sincronizando || !(config && config.google)} className={btn + " h-9"} style={btnSecundario}>
          {sincronizando ? "Lendo o Drive…" : "Sincronizar Drive"}
        </button>
      </div>

      {/* Pendências de configuração */}
      {config && (!config.google || !config.whatsapp) && (
        <div className="rounded-2xl p-4 text-[13px] space-y-1" style={{ background: "#FBF6EA", border: "1px solid #EADDBD", color: "#5F4A1C" }}>
          <p className="font-semibold">Configuração pendente</p>
          {!config.google && <p>• Google Drive: falta o acesso de leitura à pasta “Departamento Pessoal” (segredo GOOGLE_SA_JSON). Sem ele a sincronização fica desativada.</p>}
          {!config.whatsapp && <p>• WhatsApp: número oficial ainda não conectado. Enquanto isso, use “Marcar como enviado” para controlar aqui os envios feitos manualmente.</p>}
        </div>
      )}
      {!config && (
        <div className="rounded-2xl p-4 text-[13px]" style={{ background: "#F8E9E7", border: "1px solid #EBC9C5", color: "#8C3B33" }}>
          Não foi possível consultar o serviço de envio. Recarregue a página; se persistir, verifique a função “dp-folha”.
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi titulo="Clientes" valor={kpi.clientes} />
        <Kpi titulo="A enviar" valor={kpi.pendentes} cor={kpi.pendentes ? "#B7791F" : undefined} />
        <Kpi titulo="Enviados" valor={kpi.enviados} />
        <Kpi titulo="Lidos" valor={kpi.lidos} cor={VERDE} />
        <Kpi titulo="Falhas" valor={kpi.falhas} cor={kpi.falhas ? "#C2554B" : undefined} />
        <Kpi titulo="Pastas a ajustar" valor={kpi.ajustar} cor={kpi.ajustar ? "#B7791F" : undefined} />
      </div>

      <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid " + BORDA }}>
        <div className="flex items-center justify-between text-[13px] mb-2">
          <span className="font-medium">Clientes com tudo entregue</span>
          <span style={{ color: CINZA }}>{kpi.concluidos} de {kpi.clientes} · {pct}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "#EFEEEA" }}>
          <div className="h-full rounded-full" style={{ width: pct + "%", background: VERDE, transition: "width .3s ease" }} />
        </div>
      </div>

      {/* Filtros e ações em lote */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, pasta ou CNPJ"
          className="rounded-lg border bg-white px-3 h-9 text-[13px] w-full sm:w-64" />
        <div className="flex flex-wrap gap-1">
          {[["todos", "Todos"], ["pendentes", "A enviar"], ["enviados", "Entregues"], ["falhas", "Falhas"], ["sem_contato", "Sem contato"], ["sem_vinculo", "Sem cliente"]].map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className="rounded-full px-3 h-8 text-[12.5px] font-medium"
              style={filtro === k ? { background: VERDE, color: "#fff" } : { background: "#fff", color: CINZA, border: "1px solid " + BORDA }}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => marcarEnviado(idsSelecionados)} disabled={!idsSelecionados.length || !!progresso} className={btn + " h-9"} style={btnSecundario}>
            Marcar como enviado ({idsSelecionados.length})
          </button>
          {waAtivo && (
            <>
              <button onClick={() => enviarWhatsapp(selecionadosWa)} disabled={!selecionadosWa.length || !!progresso} className={btn + " h-9"} style={btnSecundario}>
                Enviar selecionados ({selecionadosWa.length})
              </button>
              <button onClick={() => enviarWhatsapp(prontosWa)} disabled={!prontosWa.length || !!progresso} className={btn + " h-9"} style={btnPrimario}>
                Enviar todos prontos ({prontosWa.length})
              </button>
            </>
          )}
        </div>
      </div>

      {progresso && (
        <div className="rounded-2xl p-4 text-[13px]" style={{ background: "#E9F1EC", border: "1px solid #CFE0D6", color: "#234D39" }}>
          <div className="flex justify-between mb-2"><span>Enviando pelo WhatsApp…</span><span>{progresso.feito}/{progresso.total}</span></div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#CFE0D6" }}>
            <div className="h-full" style={{ width: (progresso.feito / progresso.total) * 100 + "%", background: VERDE }} />
          </div>
        </div>
      )}

      {/* Clientes */}
      <div className="space-y-3">
        {gruposFiltrados.length === 0 && (
          <div className="rounded-2xl bg-white p-10 text-center text-[13px]" style={{ border: "1px dashed #D9D6CE", color: CINZA }}>
            {docs.length === 0 ? "Nenhum arquivo nesta competência ainda. Clique em “Sincronizar Drive”." : "Nenhum cliente neste filtro."}
          </div>
        )}

        {gruposFiltrados.map((g) => {
          const pend = g.docs.filter(pendente);
          const concluido = g.docs.every(entregue);
          const todosSel = pend.length > 0 && pend.every((d) => selecionados.has(d.id));
          return (
            <div key={g.chave} className="rounded-2xl bg-white" style={{ border: "1px solid " + (concluido ? "#CFE0D6" : BORDA) }}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #F1EFEA" }}>
                <input type="checkbox" checked={todosSel} disabled={!pend.length} onChange={() => toggleGrupo(g)}
                  aria-label={"Selecionar documentos de " + g.pasta} style={{ accentColor: VERDE, width: 16, height: 16 }} />
                <div className="mr-auto min-w-0">
                  <p className="text-[14px] font-semibold truncate">{g.cliente ? g.cliente.name : g.pasta}</p>
                  <p className="text-[12px] truncate" style={{ color: CINZA }}>
                    Pasta: {g.pasta}{g.docs[0] && g.docs[0].em_enviadas ? " (em Enviadas)" : ""}{g.cliente && g.cliente.document ? " · " + g.cliente.document : ""}
                  </p>
                </div>

                <VinculoPasta g={g} clientes={clientes} confirmado={confirmado(g)}
                  onVincular={vincular} onConfirmar={confirmarVinculo} onDesfazer={desfazerVinculo} />

                {confirmado(g) && (
                  <button onClick={() => setModalContatos(g)} className={btn}
                    style={g.contatos.length ? btnSecundario : { background: "#FBF6EA", color: "#5F4A1C", border: "1px solid #EADDBD" }}>
                    {g.contatos.length ? g.contatos.map((c) => c.nome.split(" ")[0]).join(", ") : "+ WhatsApp do cliente"}
                  </button>
                )}

                {concluido ? (
                  <span className="rounded-lg px-3 h-8 inline-flex items-center text-[12.5px] font-semibold" style={{ background: "#E9F1EC", color: "#234D39" }}>Entregue</span>
                ) : podeEnviarWa(g) ? (
                  <button onClick={() => enviarWhatsapp(pend.map((d) => d.id))} disabled={!pend.length || !!progresso} className={btn} style={btnPrimario}>
                    Enviar ({pend.length})
                  </button>
                ) : (
                  <button onClick={() => marcarEnviado(pend.map((d) => d.id))} disabled={!pend.length} className={btn} style={btnSecundario}>
                    Marcar enviado ({pend.length})
                  </button>
                )}
              </div>

              <ul>
                {g.docs.map((d) => {
                  const st = STATUS[d.status] || STATUS.pronto;
                  const t = TIPO[d.tipo] || TIPO.OUTROS;
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-[13px]" style={{ borderTop: "1px solid #F6F5F2" }}>
                      <input type="checkbox" checked={selecionados.has(d.id)} disabled={!pendente(d)} onChange={() => toggle(d.id)}
                        aria-label={"Selecionar " + d.nome_arquivo} style={{ accentColor: VERDE, width: 15, height: 15 }} />
                      <select value={d.tipo} onChange={(e) => mudarTipo(d, e.target.value)} title="Tipo do documento (usado no texto da mensagem)"
                        className="rounded-md text-[11.5px] font-semibold px-1.5 h-6 cursor-pointer" style={{ background: t.bg, color: t.fg, border: "none" }}>
                        {Object.keys(TIPO).map((k) => <option key={k} value={k}>{TIPO[k].label}</option>)}
                      </select>
                      <a href={"https://drive.google.com/file/d/" + d.drive_file_id + "/view"} target="_blank" rel="noreferrer"
                        className="mr-auto min-w-0 truncate hover:underline" style={{ color: "#1C1F1D" }} title="Abrir no Google Drive">{d.nome_arquivo}</a>
                      {d.alterado_apos_envio && (
                        <span className="rounded-md px-2 h-6 inline-flex items-center text-[11.5px] font-medium" style={{ background: "#FBF6EA", color: "#5F4A1C" }}
                          title="O arquivo mudou no Drive depois do último envio">Alterado após envio</span>
                      )}
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: st.cor }}>
                        <span style={{ width: 7, height: 7, borderRadius: 99, background: st.cor, display: "inline-block" }} />
                        {st.label}{d.enviado_manual && d.status === "enviado" ? " (manual)" : ""}
                        {d.ultimo_envio_em && <span className="font-normal" style={{ color: "#A3A39C" }}>· {fmtDataHora(d.ultimo_envio_em)}</span>}
                      </span>
                      <button onClick={() => setModalHistorico(d)} className="text-[12.5px] hover:underline" style={{ color: CINZA }}>Histórico</button>
                      {entregue(d) && podeEnviarWa(g) && (
                        <button onClick={() => enviarWhatsapp([d.id], true)} disabled={!!progresso} className="text-[12.5px] font-medium hover:underline" style={{ color: VERDE }}>Reenviar</button>
                      )}
                      {entregue(d) && (
                        <button onClick={() => desfazerEnvio(d)} className="text-[12.5px] hover:underline" style={{ color: CINZA }}>Desfazer</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {aviso && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 rounded-xl px-4 py-3 text-[13px] text-white"
          style={{ transform: "translateX(-50%)", width: "calc(100% - 2rem)", maxWidth: 560, background: aviso.tipo === "ok" ? "#13241B" : "#C2554B", boxShadow: "0 8px 30px rgba(0,0,0,.18)" }}>
          {aviso.msg}
        </div>
      )}

      {modalContatos && modalContatos.cliente && (
        <ModalContatos cliente={modalContatos.cliente} onFechar={() => setModalContatos(null)} onAlterado={() => carregarDados().catch(() => {})} />
      )}
      {modalHistorico && <ModalHistorico doc={modalHistorico} onFechar={() => setModalHistorico(null)} />}
    </div>
  );
}

function Kpi({ titulo, valor, cor }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3" style={{ border: "1px solid " + BORDA }}>
      <p className="text-[12px]" style={{ color: CINZA }}>{titulo}</p>
      <p className="text-[22px] font-semibold mt-0.5" style={{ color: cor || "#1C1F1D" }}>{valor}</p>
    </div>
  );
}

function VinculoPasta({ g, clientes, confirmado, onVincular, onConfirmar, onDesfazer }) {
  const [id, setId] = useState("");
  const [editando, setEditando] = useState(false);

  if (confirmado && !editando) {
    return <button onClick={() => setEditando(true)} className="text-[12px] hover:underline" style={{ color: "#A3A39C" }} title="Trocar o cliente desta pasta">Trocar cliente</button>;
  }
  if (g.cliente && g.vinculo && !g.vinculo.confirmado && !editando) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 h-8 text-[12.5px]" style={{ background: "#FBF6EA", border: "1px solid #EADDBD", color: "#5F4A1C" }}>
        <span>É este cliente?</span>
        <button onClick={() => onConfirmar(g)} className="font-semibold hover:underline" style={{ color: VERDE }}>Confirmar</button>
        <button onClick={() => setEditando(true)} className="hover:underline">Trocar</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 h-8" style={{ background: "#FBF6EA", border: "1px solid #EADDBD" }}>
      <select value={id} onChange={(e) => setId(e.target.value)} className="rounded-md bg-white text-[12.5px] px-1.5 h-6" style={{ maxWidth: 220 }} aria-label="Cliente desta pasta">
        <option value="">Qual cliente é esta pasta?</option>
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button disabled={!id} onClick={() => { onVincular(g, id); setEditando(false); setId(""); }}
        className="rounded-md px-2 h-6 text-[12px] font-semibold text-white disabled:opacity-40" style={{ background: VERDE }}>Vincular</button>
      {editando && g.vinculo && <button onClick={() => { onDesfazer(g); setEditando(false); }} className="text-[12px] hover:underline" style={{ color: "#8C3B33" }}>Desvincular</button>}
      {editando && <button onClick={() => setEditando(false)} className="text-[12px] hover:underline" style={{ color: CINZA }}>Cancelar</button>}
    </div>
  );
}

function Janela({ titulo, subtitulo, onFechar, children }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(0,0,0,.4)" }} onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="w-full bg-white p-5 overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ maxWidth: 520, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold" style={{ color: VERDE }}>{titulo}</p>
            {subtitulo && <p className="text-[12.5px] truncate" style={{ color: CINZA }}>{subtitulo}</p>}
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="rounded-md px-2 h-7 text-[13px]" style={{ color: CINZA }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalContatos({ cliente, onFechar, onAlterado }) {
  const [lista, setLista] = useState([]);
  const [nome, setNome] = useState("");
  const [fone, setFone] = useState("");
  const [papel, setPapel] = useState("financeiro");
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const data = await rest("dp_contatos?select=*&client_id=eq." + enc(cliente.id) + "&ativo=is.true&order=nome");
    setLista(data || []);
  }, [cliente.id]);
  useEffect(() => { carregar().catch((e) => setErro(e.message)); }, [carregar]);

  const depois = async () => { await carregar(); onAlterado(); };

  async function adicionar(e) {
    e.preventDefault();
    const whatsapp = normalizarFone(fone);
    if (!nome.trim()) return setErro("Informe o nome.");
    if (!whatsapp) return setErro("WhatsApp inválido. Use DDD + número, ex.: 81 99999-9999.");
    try {
      await rest("dp_contatos", { method: "POST", prefer: "return=minimal", body: { client_id: cliente.id, nome: nome.trim(), whatsapp, papel } });
      setNome(""); setFone(""); setErro("");
      await depois();
    } catch (err) { setErro(err.message); }
  }
  async function alternar(c) {
    try { await rest("dp_contatos?id=eq." + c.id, { method: "PATCH", prefer: "return=minimal", body: { recebe_folha: !c.recebe_folha } }); await depois(); }
    catch (err) { setErro(err.message); }
  }
  async function remover(c) {
    if (!window.confirm("Remover " + c.nome + "?")) return;
    try { await rest("dp_contatos?id=eq." + c.id, { method: "PATCH", prefer: "return=minimal", body: { ativo: false } }); await depois(); }
    catch (err) { setErro(err.message); }
  }

  return (
    <Janela titulo="Quem recebe a folha" subtitulo={cliente.name} onFechar={onFechar}>
      <ul className="rounded-lg mb-4" style={{ border: "1px solid " + BORDA }}>
        {lista.length === 0 && <li className="p-4 text-center text-[13px]" style={{ color: CINZA }}>Nenhum contato cadastrado.</li>}
        {lista.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]" style={i ? { borderTop: "1px solid #F1EFEA" } : undefined}>
            <div className="mr-auto min-w-0">
              <p className="font-medium truncate">{c.nome} <span className="font-normal text-[12px]" style={{ color: "#A3A39C" }}>· {c.papel}</span></p>
              <p className="text-[12px]" style={{ color: CINZA }}>{fmtFone(c.whatsapp)}</p>
            </div>
            <label className="flex items-center gap-1.5 text-[12.5px]" style={{ color: CINZA }}>
              <input type="checkbox" checked={c.recebe_folha} onChange={() => alternar(c)} style={{ accentColor: VERDE }} /> Recebe
            </label>
            <button onClick={() => remover(c)} className="text-[12.5px] hover:underline" style={{ color: "#C2554B" }}>Remover</button>
          </li>
        ))}
      </ul>
      <form onSubmit={adicionar} className="grid gap-2 sm:grid-cols-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" className="rounded-lg border px-3 h-9 text-[13px]" />
        <input value={fone} onChange={(e) => setFone(e.target.value)} placeholder="WhatsApp (81) 99999-9999" inputMode="tel" className="rounded-lg border px-3 h-9 text-[13px]" />
        <select value={papel} onChange={(e) => setPapel(e.target.value)} className="rounded-lg border px-2 h-9 text-[13px] bg-white">
          <option value="financeiro">Financeiro</option>
          <option value="socio">Sócio</option>
          <option value="rh">RH</option>
        </select>
        <button type="submit" className="rounded-lg h-9 text-[13px] font-semibold text-white" style={{ background: VERDE }}>Adicionar contato</button>
        {erro && <p className="text-[12.5px] sm:col-span-2" style={{ color: "#C2554B" }}>{erro}</p>}
      </form>
    </Janela>
  );
}

function ModalHistorico({ doc, onFechar }) {
  const [envios, setEnvios] = useState(null);
  useEffect(() => {
    rest("dp_envios?select=id,canal,whatsapp,status,erro,enviado_em,entregue_em,lido_em,created_at,dp_contatos(nome)&documento_id=eq." + doc.id + "&order=created_at.desc")
      .then((d) => setEnvios(d || []))
      .catch(() => setEnvios([]));
  }, [doc.id]);
  const cor = { lido: VERDE, entregue: "#2F6F9F", enviado: "#2F6F9F", falhou: "#C2554B", fila: CINZA };
  return (
    <Janela titulo="Histórico de envios" subtitulo={doc.nome_arquivo} onFechar={onFechar}>
      {envios === null ? <p className="text-[13px]" style={{ color: CINZA }}>Carregando…</p>
        : envios.length === 0 ? (
          <p className="text-[13px]" style={{ color: CINZA }}>
            {doc.enviado_manual ? "Sem registro no sistema: a pasta já estava em “Enviadas” no Drive quando foi lida." : "Este documento ainda não foi enviado."}
          </p>
        ) : (
          <ol className="space-y-2">
            {envios.map((e) => (
              <li key={e.id} className="rounded-lg p-3 text-[13px]" style={{ border: "1px solid " + BORDA }}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium truncate">
                    {e.canal === "manual" ? "Marcado manualmente" : (e.dp_contatos && e.dp_contatos.nome) || "—"}
                    {e.whatsapp ? <span className="font-normal text-[12px]" style={{ color: "#A3A39C" }}> {fmtFone(e.whatsapp)}</span> : null}
                  </span>
                  <span className="text-[12px] font-semibold" style={{ color: cor[e.status] || CINZA }}>{e.status}</span>
                </div>
                <p className="text-[12px] mt-1" style={{ color: CINZA }}>
                  Enviado {fmtDataHora(e.enviado_em || e.created_at)}{e.canal === "whatsapp" ? ` · Entregue ${fmtDataHora(e.entregue_em)} · Lido ${fmtDataHora(e.lido_em)}` : ""}
                </p>
                {e.erro && <p className="text-[12px] mt-1" style={{ color: "#C2554B" }}>{e.erro}</p>}
              </li>
            ))}
          </ol>
        )}
    </Janela>
  );
}
