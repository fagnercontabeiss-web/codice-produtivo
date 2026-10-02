// Ferramentas do J.A.R.V.I.S. — executadas no navegador.
//
// Leem o estado que o app já tem em memória e gravam pelas mesmas funções que
// as telas usam (addTask, updateTask, toggleTaskCompletion...). Assim a
// interface atualiza na hora, a recorrência de tarefas continua funcionando e
// as permissões do banco (RLS) seguem valendo.

const pad = n => String(n).padStart(2, "0");
export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dateStr(new Date());
export const addDays = (str, n) => { const d = new Date(str + "T12:00:00"); d.setDate(d.getDate() + n); return dateStr(d); };
export const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const isDate = s => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + "T12:00:00"); return !isNaN(d) && dateStr(d) === s; };
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; };

// Distância de edição, para tolerar erros do reconhecimento de voz.
export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return a.length || b.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const STOP = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "para", "pra", "com", "em", "no", "na", "tarefa", "cliente", "ltda", "me", "eireli"]);
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
// Todas as palavras relevantes da busca aparecem no texto (trecho ou com 1 letra de diferença).
export function fuzzyHas(text, query) {
  const tw = words(text);
  const qw = words(query).filter(w => !STOP.has(w));
  if (!qw.length) return norm(text).includes(norm(query));
  return qw.every(q => tw.some(t => t.includes(q) || (q.length >= 4 && lev(t.slice(0, q.length + 1), q) <= 1) || (q.length >= 4 && lev(t, q) <= 1) || (q.length === 3 && t.length === 3 && t[0] === q[0] && lev(t, q) <= 1)));
}

const WD = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
// Aceita YYYY-MM-DD, DD/MM, DD/MM/AAAA, "hoje", "amanhã", "sexta", "próxima segunda", "dia 20", "em 3 dias".
export function parseDate(v, today = todayStr()) {
  if (v === undefined || v === null || v === "") return null;
  if (isDate(v)) return v;
  const t = norm(v).replace(/-feira/g, "").replace(/\s+/g, " ");
  if (t === "hoje") return today;
  if (t === "amanha") return addDays(today, 1);
  if (t === "depois de amanha") return addDays(today, 2);
  if (t === "ontem") return addDays(today, -1);
  let m = t.match(/^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : Number(today.slice(0, 4));
    let d = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    if (!m[3] && d < today) d = `${y + 1}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return isDate(d) ? d : null;
  }
  m = t.match(/^(?:dia )?(\d{1,2})$/);
  if (m) {
    const day = Number(m[1]); if (day < 1 || day > 31) return null;
    const base = new Date(today + "T12:00:00");
    for (let i = 0; i < 3; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, day, 12);
      if (d.getDate() === day && dateStr(d) >= today) return dateStr(d);
    }
    return null;
  }
  m = t.match(/^(?:em|daqui a?) ?(\d{1,3}) (dia|dias|semana|semanas)$/);
  if (m) return addDays(today, Number(m[1]) * (m[2].startsWith("semana") ? 7 : 1));
  if (t === "semana que vem" || t === "proxima semana") return addDays(today, 7);
  m = t.match(/^(?:(?:na |no |nessa |nesta |essa |esta )?(proxim[ao] )?)(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?: que vem)?$/);
  if (m) {
    const cur = new Date(today + "T12:00:00").getDay();
    let diff = (WD[m[2]] - cur + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }
  return null;
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const PRIORITIES = ["normal", "alta", "urgente"];
const RECURRENCES = ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];
const SCREENS = {
  dashboard: "Dashboard", tasks: "Tarefas", habits: "Hábitos", clients: "Clientes", relationship: "Relacionamento",
  onboarding: "Onboarding", obligations: "Obrigações", severance: "Simulação Rescisória", projects: "Projetos",
  codiceai: "YOETZ IA", sops: "SOPs", reports: "Relatórios", workload: "Workload", settings: "Configurações", team: "Equipe",
};

// Procura por id exato, depois nome exato, depois trecho do nome.
function find(list, q, key = "name") {
  const n = norm(q);
  if (!n) return { none: true };
  const byId = list.find(x => x.id === q);
  if (byId) return { item: byId };
  const exact = list.filter(x => norm(x[key]) === n);
  if (exact.length === 1) return { item: exact[0] };
  const part = list.filter(x => norm(x[key]).includes(n));
  if (part.length === 1) return { item: part[0] };
  if (part.length > 1) return { ambiguous: part.slice(0, 6).map(x => ({ id: x.id, nome: x[key] })) };
  const fuzzy = list.filter(x => fuzzyHas(x[key], q));
  if (fuzzy.length === 1) return { item: fuzzy[0] };
  if (fuzzy.length > 1) return { ambiguous: fuzzy.slice(0, 6).map(x => ({ id: x.id, nome: x[key] })) };
  return { none: true };
}

const role = app => app.currentProfile?.role || "admin";
const isAdmin = app => role(app) === "admin";
const myId = app => app.currentProfile?.id || null;

// Mesma regra da tela de Tarefas: colaborador mexe no que é dele ou sem dono.
function canEditTask(app, task) {
  if (isAdmin(app)) return true;
  if (role(app) === "visualizador") return false;
  return !task.assignedTo || task.assignedTo === myId(app);
}
const canSeeTask = (app, task) => isAdmin(app) || !task.assignedTo || task.assignedTo === myId(app);

function taskView(app, t, today) {
  const cat = (app.categories || []).find(c => c.id === t.categoryId);
  const cli = t.clientId ? (app.clients || []).find(c => c.id === t.clientId) : null;
  const who = t.assignedTo ? (app.teamUsers || []).find(u => u.id === t.assignedTo) : null;
  const v = { id: t.id, titulo: t.title, data: t.dueDate || null, prioridade: t.priority || "normal" };
  if (cat) v.categoria = cat.name;
  if (cli) v.cliente = cli.name;
  if (who) v.responsavel = who.name;
  if (t.completed) v.concluida = true;
  if (!t.completed && t.dueDate && t.dueDate < today) v.dias_de_atraso = daysBetween(t.dueDate, today);
  if (t.isRecurring) v.recorrencia = t.recurrenceType;
  if (t.parentId) v.subtarefa = true;
  if (t.notes) v.notas = clip(t.notes, 140);
  return v;
}

const prioRank = { urgente: 0, alta: 1, normal: 2 };
const byUrgency = (a, b) => (a.dueDate || "9").localeCompare(b.dueDate || "9") || (prioRank[a.priority] ?? 2) - (prioRank[b.priority] ?? 2);

// ── Hábitos ────────────────────────────────────────────────────────────────
function habitExpectedToday(h, today) {
  if (h.freq === "weekly_days") return (h.freqDays || []).includes(new Date(today + "T12:00:00").getDay());
  return h.freq === "daily";
}
function habitStreak(h, today) {
  const done = new Set(h.completedDates || []);
  let n = 0, cur = done.has(today) ? today : addDays(today, -1);
  while (done.has(cur)) { n++; cur = addDays(cur, -1); }
  return n;
}
function habitView(h, today) {
  const from = addDays(today, -29);
  const d30 = (h.completedDates || []).filter(d => d >= from && d <= today).length;
  const v = { id: h.id, titulo: h.title, frequencia: h.freq, feito_hoje: (h.completedDates || []).includes(today), feitos_30d: d30 };
  if (h.freq === "daily") { v.sequencia_dias = habitStreak(h, today); v.consistencia_30d = Math.round(d30 / 30 * 100) + "%"; }
  return v;
}

// ── Relacionamento ─────────────────────────────────────────────────────────
function daysUntil(rel, today) {
  const d = rel.date || "";
  const md = d.length === 10 ? d.slice(5) : d.length === 5 ? d : "";
  const [m, day] = md.split("-").map(Number);
  if (!m || !day) return null;
  const y = Number(today.slice(0, 4));
  let next = `${y}-${pad(m)}-${pad(day)}`;
  if (rel.isAnnual === false && d.length === 10) next = d;
  else if (next < today) next = `${y + 1}-${pad(m)}-${pad(day)}`;
  const n = daysBetween(today, next);
  return n < 0 ? null : n;
}

// ── Painel (usado pela tela e pelo resumo_do_dia) ──────────────────────────
export function snapshot(app) {
  const today = todayStr();
  const tasks = (app.tasks || []).filter(t => canSeeTask(app, t));
  const top = tasks.filter(t => !t.parentId);
  const open = top.filter(t => !t.completed);
  const overdue = open.filter(t => t.dueDate && t.dueDate < today).sort(byUrgency);
  const dueToday = open.filter(t => t.dueDate === today).sort(byUrgency);
  const week = open.filter(t => t.dueDate > today && t.dueDate <= addDays(today, 7)).sort(byUrgency);
  const urgent = open.filter(t => t.priority === "urgente" || t.priority === "alta").sort(byUrgency);
  const doneToday = top.filter(t => t.completed && t.dueDate === today);

  const habits = (app.habits || []).filter(h => !h.archived);
  const daily = habits.filter(h => habitExpectedToday(h, today));
  const dailyDone = daily.filter(h => (h.completedDates || []).includes(today));

  const clients = (app.clients || []).filter(c => (c.status || "active") === "active");
  const pending = clients.filter(c => c.paymentStatus === "pending");
  const fee = c => parseFloat(c.monthlyFee) || 0;

  const steps = app.onboardingSteps || [];
  const onbs = (app.onboardings || []).filter(o => o.status === "em_andamento").map(o => {
    const s = steps.filter(x => x.onboardingId === o.id);
    const done = s.filter(x => x.status === "concluido").length;
    return { id: o.id, title: o.title || o.clientName, clientName: o.clientName, done, total: s.length, targetDate: o.targetDate, late: !!o.targetDate && o.targetDate < today };
  });

  const projects = (app.projects || []).filter(p => p.status !== "done");
  const dates = (app.relationships || [])
    .map(r => ({ name: r.name, type: r.type, days: daysUntil(r, today) }))
    .filter(r => r.days !== null && r.days <= 14).sort((a, b) => a.days - b.days);

  return {
    today, weekday: WEEKDAYS[new Date(today + "T12:00:00").getDay()],
    open, overdue, dueToday, week, urgent, doneToday,
    habits, daily, dailyDone,
    clients, pending, mrr: clients.reduce((s, c) => s + fee(c), 0), pendingValue: pending.reduce((s, c) => s + fee(c), 0),
    onbs, projects, lateProjects: projects.filter(p => p.dueDate && p.dueDate < today), dates,
  };
}

// Saudação local, sem custo de IA, dita ao abrir a tela.
export function greeting(app) {
  const s = snapshot(app);
  const h = new Date().getHours();
  const hello = h < 5 ? "Boa madrugada" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (s.dueToday.length) parts.push(`${pl(s.dueToday.length, "tarefa vence", "tarefas vencem")} hoje`);
  if (s.overdue.length) parts.push(`${pl(s.overdue.length, "está atrasada", "estão atrasadas")}`);
  if (!parts.length) parts.push(s.week.length ? `nada vence hoje e há ${pl(s.week.length, "tarefa", "tarefas")} para os próximos sete dias` : "a agenda está limpa");
  let text = `${hello}, senhor. ${parts.join(" e ")[0].toUpperCase()}${parts.join(" e ").slice(1)}.`;
  const lead = s.overdue[0] || s.dueToday[0];
  if (lead) text += ` A mais sensível é ${lead.title}.`;
  if (s.daily.length && s.dailyDone.length < s.daily.length) text += ` Dos hábitos diários, ${s.dailyDone.length} de ${s.daily.length} feitos.`;
  return text;
}

// Retrato compacto do momento. Vai junto em toda rodada para o modelo responder
// e agir sem precisar de uma consulta extra (uma ida ao servidor a menos).
function panel(app) {
  const s = snapshot(app);
  const row = t => {
    const r = { id: t.id, t: clip(t.title, 70), d: t.dueDate || null };
    if (t.priority && t.priority !== "normal") r.p = t.priority;
    const c = t.clientId && (app.clients || []).find(x => x.id === t.clientId);
    if (c) r.cli = clip(c.name, 30);
    return r;
  };
  const p = {
    contagem: { hoje: s.dueToday.length, atrasadas: s.overdue.length, proximos_7_dias: s.week.length, abertas: s.open.length, concluidas_hoje: s.doneToday.length },
    tarefas_atrasadas: s.overdue.slice(0, 15).map(row),
    tarefas_hoje: s.dueToday.slice(0, 15).map(row),
    tarefas_proximos_7_dias: s.week.slice(0, 15).map(row),
    habitos: s.habits.slice(0, 20).map(h => ({ id: h.id, t: h.title, freq: h.freq, feito_hoje: (h.completedDates || []).includes(s.today) })),
    onboardings_em_andamento: s.onbs.length,
    projetos_ativos: s.projects.length,
  };
  if (isAdmin(app)) p.clientes = { ativos: s.clients.length, pagamento_pendente: s.pending.length, valor_pendente: s.pendingValue, receita_mensal: s.mrr };
  return p;
}

// Contexto enviado ao modelo a cada rodada.
export function buildContext(app) {
  const now = new Date();
  return {
    agora: `${dateStr(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    hoje: dateStr(now),
    dia_semana: WEEKDAYS[now.getDay()],
    usuario: app.currentProfile?.name || "",
    papel: role(app),
    categorias: (app.categories || []).map(c => ({ id: c.id, nome: c.name })),
    contextos: (app.contexts || []).map(c => ({ id: c.id, nome: c.name })),
    equipe: (app.teamUsers || []).filter(u => u.active !== false).map(u => ({ id: u.id, nome: u.name })),
    painel: panel(app),
  };
}

// ── Execução ───────────────────────────────────────────────────────────────
// env: { setActiveTab(tab), confirm(texto) -> Promise<boolean>,
//        verify?(tabela, id, linha => boolean) -> Promise<boolean>,   confere a gravação no banco
//        memory?: { list(), add(texto), remove(id) },                 memória permanente
//        undoLast?() -> Promise<string|null>,                         desfaz a última alteração
//        remote?(acao, dados) -> Promise<objeto> }                    pesquisa e cotações, no servidor
// Devolve { result, log?, undo? } — result vai para o modelo, log aparece na tela e
// undo ({ label, run }) entra na pilha do "desfazer".
export async function runTool(name, input, app, env) {
  const today = todayStr();
  const a = input || {};
  const err = msg => ({ result: { erro: msg } });
  const writeBlocked = () => role(app) === "visualizador" ? err("Seu perfil é somente leitura; não posso alterar dados.") : null;

  const getTask = (ref, { includeDone = false } = {}) => {
    const visible = (app.tasks || []).filter(x => canSeeTask(app, x));
    let t = visible.find(x => x.id === ref);
    if (!t && ref) {
      const pool = visible.filter(x => includeDone || !x.completed);
      const q = norm(ref);
      let hits = pool.filter(x => norm(x.title) === q);
      if (!hits.length) hits = pool.filter(x => norm(x.title).includes(q));
      if (!hits.length) hits = pool.filter(x => fuzzyHas(x.title, ref));
      if (hits.length > 1) return { e: err(`Mais de uma tarefa combina com "${ref}". Pergunte qual: ` + JSON.stringify(hits.slice(0, 6).map(x => ({ id: x.id, titulo: x.title, data: x.dueDate })))) };
      t = hits[0];
    }
    if (!t) return { e: err(`Não encontrei tarefa "${ref || ""}". Use listar_tarefas com busca.`) };
    if (!canEditTask(app, t)) return { e: err("Sem permissão: a tarefa pertence a outro responsável.") };
    return { t };
  };
  const date = v => parseDate(v, today);
  const BAD_DATE = "Não entendi a data. Use YYYY-MM-DD.";
  // Confere no banco se a gravação chegou; a tela atualiza antes do servidor responder.
  const saved = async (table, id, check) => {
    if (!env.verify) return true;
    try { return await env.verify(table, id, check); } catch { return false; }
  };
  const NOT_SAVED = "A alteração apareceu na tela, mas não consegui confirmar a gravação no servidor. Pode ser a conexão; peça ao usuário para conferir antes de seguir.";
  const unsaved = text => ({ result: { erro: NOT_SAVED }, log: { kind: "warn", text: "Gravação não confirmada", detail: text } });
  const resolveCategory = q => {
    if (!q) return { id: null };
    const r = find(app.categories || [], q);
    return r.item ? { id: r.item.id } : { unknown: true };
  };
  const resolveUser = q => {
    if (!q) return { id: null };
    const r = find((app.teamUsers || []).filter(u => u.active !== false), q);
    if (r.item) return { id: r.item.id };
    return { e: err(r.ambiguous ? `Mais de uma pessoa combina com "${q}": ${r.ambiguous.map(x => x.nome).join(", ")}.` : `Não há ninguém chamado "${q}" na equipe.`) };
  };

  switch (name) {
    case "resumo_do_dia": {
      const s = snapshot(app);
      const tv = t => taskView(app, t, today);
      const result = {
        hoje: s.today, dia_semana: s.weekday,
        tarefas: {
          vencem_hoje: s.dueToday.length, atrasadas: s.overdue.length, proximos_7_dias: s.week.length,
          abertas_total: s.open.length, concluidas_hoje: s.doneToday.length,
          destaque_hoje: s.dueToday.slice(0, 6).map(tv),
          mais_atrasadas: s.overdue.slice(0, 6).map(tv),
          urgentes_ou_alta: s.urgent.slice(0, 5).map(tv),
        },
        habitos_diarios: { feitos: s.dailyDone.length, total: s.daily.length, faltam: s.daily.filter(h => !s.dailyDone.includes(h)).map(h => h.title) },
        onboardings_em_andamento: s.onbs.map(o => ({ titulo: o.title, etapas: `${o.done}/${o.total}`, atrasado: o.late })),
        projetos: { ativos: s.projects.length, atrasados: s.lateProjects.map(p => p.title) },
        datas_proximas: s.dates.slice(0, 5).map(d => ({ nome: d.name, tipo: d.type, em_dias: d.days })),
      };
      if (isAdmin(app)) result.clientes = { ativos: s.clients.length, pagamento_pendente: s.pending.length, valor_pendente: s.pendingValue, receita_mensal: s.mrr };
      return { result };
    }

    case "listar_tarefas": {
      let list = (app.tasks || []).filter(t => canSeeTask(app, t));
      const p = a.periodo || (a.busca ? "abertas" : "hoje");
      const onDate = date(a.data);
      if (p === "data" && !onDate) return err("Informe data no formato YYYY-MM-DD.");
      const filters = {
        hoje: t => !t.completed && t.dueDate === today,
        amanha: t => !t.completed && t.dueDate === addDays(today, 1),
        atrasadas: t => !t.completed && t.dueDate && t.dueDate < today,
        semana: t => !t.completed && t.dueDate >= today && t.dueDate <= addDays(today, 7),
        abertas: t => !t.completed,
        concluidas_hoje: t => t.completed && t.dueDate === today,
        data: t => t.dueDate === onDate,
      };
      list = list.filter(filters[p] || filters.abertas);
      if (a.busca) {
        const q = norm(a.busca);
        const cliIds = new Set((app.clients || []).filter(c => norm(c.name).includes(q) || fuzzyHas(c.name, a.busca)).map(c => c.id));
        list = list.filter(t => norm(t.title).includes(q) || fuzzyHas(t.title, a.busca) || (t.clientId && cliIds.has(t.clientId)) || norm(t.notes).includes(q));
      }
      if (a.categoria) {
        const c = resolveCategory(a.categoria);
        if (c.unknown) return err(`Categoria "${a.categoria}" não existe.`);
        list = list.filter(t => t.categoryId === c.id);
      }
      if (a.responsavel) {
        const u = resolveUser(a.responsavel);
        if (u.e) return u.e;
        list = list.filter(t => t.assignedTo === u.id);
      }
      list.sort(byUrgency);
      const limit = Math.min(Math.max(parseInt(a.limite) || 15, 1), 40);
      return { result: { periodo: p, total: list.length, mostrando: Math.min(limit, list.length), tarefas: list.slice(0, limit).map(t => taskView(app, t, today)) } };
    }

    case "criar_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      if (!isAdmin(app) && app.currentProfile?.canCreateTasks === false) return err("Seu perfil não tem permissão para criar tarefas.");
      const title = String(a.titulo || "").trim();
      if (!title) return err("Faltou o título da tarefa.");
      const due = a.data ? date(a.data) : today;
      if (!due) return err(BAD_DATE);
      const dup = (app.tasks || []).find(t => !t.completed && t.dueDate === due && norm(t.title) === norm(title));
      if (dup) return { result: { ok: true, ja_existia: true, tarefa: taskView(app, dup, today), observacao: "Já havia uma tarefa aberta com esse título nessa data; não criei outra." } };
      const cat = resolveCategory(a.categoria);
      const cats = app.categories || [];
      const categoryId = cat.id || (cats.find(c => c.id === "administrativo") || cats[0] || {}).id || "administrativo";
      const ctx = a.contexto ? find(app.contexts || [], a.contexto).item : null;
      let clientId = null, clientName = null;
      if (a.cliente) {
        const r = find(app.clients || [], a.cliente);
        if (r.ambiguous) return err(`Mais de um cliente combina com "${a.cliente}": ${r.ambiguous.map(x => x.nome).join(", ")}. Pergunte qual.`);
        if (r.item) { clientId = r.item.id; clientName = r.item.name; }
      }
      const who = resolveUser(a.responsavel);
      if (who.e) return who.e;
      const rec = RECURRENCES.includes(a.recorrencia) ? a.recorrencia : null;
      const task = {
        id: uid(), title, description: "", categoryId, contextId: ctx?.id || "codice-contabilidade", clientId,
        dueDate: due, completed: false, isRecurring: !!rec, recurrenceType: rec, recurrenceEndDate: null,
        checklist: [], assignedTo: who.id || myId(app), visibility: "all", parentId: null,
        priority: PRIORITIES.includes(a.prioridade) ? a.prioridade : "normal", notes: String(a.notas || ""),
      };
      await app.addTask(task);
      if (!await saved("tasks", task.id, r => !!r)) return unsaved(title);
      const out = { ok: true, tarefa: taskView({ ...app, tasks: [task] }, task, today) };
      if (cat.unknown) out.aviso = `Categoria "${a.categoria}" não existe; usei a padrão.`;
      if (a.cliente && !clientId) out.aviso_cliente = `Cliente "${a.cliente}" não encontrado; a tarefa ficou sem cliente.`;
      return { result: out, log: { kind: "create", text: `Tarefa criada: ${title}`, detail: fmtBR(task.dueDate) + (clientName ? " · " + clientName : "") } , undo: { label: `criação da tarefa "${title}"`, run: () => app.deleteTask(task.id) } };
    }

    case "atualizar_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const { t, e } = getTask(a.id); if (e) return e;
      const patch = { id: t.id };
      const before = { id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, categoryId: t.categoryId, assignedTo: t.assignedTo, notes: t.notes || "" };
      const changes = [];
      if (a.titulo && String(a.titulo).trim() !== t.title) { patch.title = String(a.titulo).trim(); changes.push("título"); }
      if (a.data !== undefined && a.data !== "") {
        const d = date(a.data);
        if (!d) return err(BAD_DATE);
        if (d !== t.dueDate) { patch.dueDate = d; changes.push(`data → ${fmtBR(d)}`); }
      }
      if (a.prioridade) {
        if (!PRIORITIES.includes(a.prioridade)) return err("Prioridade deve ser normal, alta ou urgente.");
        if (a.prioridade !== t.priority) { patch.priority = a.prioridade; changes.push(`prioridade → ${a.prioridade}`); }
      }
      if (a.categoria) {
        const c = resolveCategory(a.categoria);
        if (c.unknown) return err(`Categoria "${a.categoria}" não existe.`);
        if (c.id !== t.categoryId) { patch.categoryId = c.id; changes.push("categoria"); }
      }
      if (a.responsavel) {
        const u = resolveUser(a.responsavel); if (u.e) return u.e;
        if (u.id !== t.assignedTo) { patch.assignedTo = u.id; changes.push("responsável"); }
      }
      if (a.notas !== undefined && String(a.notas) !== (t.notes || "")) { patch.notes = String(a.notas); changes.push("notas"); }
      if (!changes.length) return { result: { ok: true, sem_alteracao: true, tarefa: taskView(app, t, today) } };
      await app.updateTask(patch);
      const col = { title: "title", dueDate: "due_date", priority: "priority", categoryId: "category_id", assignedTo: "assigned_to", notes: "notes" };
      if (!await saved("tasks", t.id, r => !!r && Object.keys(col).every(k => patch[k] === undefined || r[col[k]] === patch[k]))) return unsaved(t.title);
      return { result: { ok: true, alterado: changes, tarefa: taskView(app, { ...t, ...patch }, today) }, log: { kind: "update", text: `Tarefa atualizada: ${patch.title || t.title}`, detail: changes.join(" · ") } , undo: { label: `alteração da tarefa "${t.title}"`, run: () => app.updateTask(before) } };
    }

    case "concluir_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const want = a.concluida !== false;
      const { t, e } = getTask(a.id, { includeDone: !want }); if (e) return e;
      if (t.completed === want) return { result: { ok: true, sem_alteracao: true, ja_estava: want ? "concluída" : "aberta" } };
      await app.toggleTaskCompletion(t.id);
      if (!await saved("tasks", t.id, r => !!r && r.completed === want)) return unsaved(t.title);
      const out = { ok: true, tarefa: t.title, concluida: want };
      if (want && t.isRecurring && t.recurrenceType) out.observacao = "Recorrente: a próxima ocorrência foi criada.";
      return { result: out, log: { kind: want ? "done" : "update", text: `${want ? "Concluída" : "Reaberta"}: ${t.title}` } , undo: { label: `${want ? "conclusão" : "reabertura"} da tarefa "${t.title}"`, run: () => app.toggleTaskCompletion(t.id) } };
    }

    case "excluir_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const { t, e } = getTask(a.id); if (e) return e;
      const ok = await env.confirm(`Excluir em definitivo a tarefa "${t.title}"?`);
      if (!ok) return { result: { ok: false, cancelado_pelo_usuario: true } };
      await app.deleteTask(t.id);
      if (!await saved("tasks", t.id, r => !r)) return unsaved(t.title);
      return { result: { ok: true, excluida: t.title }, log: { kind: "delete", text: `Tarefa excluída: ${t.title}` } , undo: { label: `exclusão da tarefa "${t.title}"`, run: () => app.addTask({ ...t }) } };
    }

    case "tarefas_em_lote": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const ids = Array.isArray(a.ids) ? [...new Set(a.ids.map(String))] : [];
      if (!ids.length) return err("Informe a lista de ids das tarefas.");
      if (ids.length > 60) return err("Máximo de 60 tarefas por vez.");
      const acao = a.acao;
      let patch = null, label = "";
      if (acao === "adiar") { const d = date(a.data); if (!d) return err(BAD_DATE); patch = { dueDate: d }; label = `adiadas para ${fmtBR(d)}`; }
      else if (acao === "prioridade") { if (!PRIORITIES.includes(a.prioridade)) return err("Prioridade deve ser normal, alta ou urgente."); patch = { priority: a.prioridade }; label = `com prioridade ${a.prioridade}`; }
      else if (acao === "reatribuir") { const u = resolveUser(a.responsavel); if (u.e || !u.id) return u.e || err("Informe o responsável."); patch = { assignedTo: u.id }; label = `reatribuídas`; }
      else if (acao === "concluir") label = "concluídas";
      else return err("acao deve ser adiar, concluir, prioridade ou reatribuir.");
      const targets = [], skipped = [];
      for (const id of ids) {
        const t = (app.tasks || []).find(x => x.id === id);
        if (!t || !canSeeTask(app, t)) skipped.push({ id, motivo: "não encontrada" });
        else if (!canEditTask(app, t)) skipped.push({ id, motivo: "sem permissão" });
        else if (acao === "concluir" && t.completed) skipped.push({ id, motivo: "já concluída" });
        else targets.push(t);
      }
      if (!targets.length) return err("Nenhuma das tarefas informadas pode ser alterada: " + JSON.stringify(skipped.slice(0, 8)));
      if (targets.length > 5 && !await env.confirm(`Alterar ${targets.length} tarefas de uma vez (${label})?`)) return { result: { ok: false, cancelado_pelo_usuario: true } };
      const col = { dueDate: "due_date", priority: "priority", assignedTo: "assigned_to" };
      const prev = targets.map(t => ({ id: t.id, dueDate: t.dueDate, priority: t.priority, assignedTo: t.assignedTo }));
      const undoBatch = async () => { for (const b of prev) { if (acao === "concluir") await app.toggleTaskCompletion(b.id); else await app.updateTask(b); } };
      for (const t of targets) {
        if (acao === "concluir") await app.toggleTaskCompletion(t.id); else await app.updateTask({ id: t.id, ...patch });
      }
      const checks = await Promise.all(targets.map(t => saved("tasks", t.id, r => !!r && (acao === "concluir" ? r.completed === true : Object.keys(patch).every(k => r[col[k]] === patch[k])))));
      const failed = targets.filter((_, i) => !checks[i]);
      const result = { ok: failed.length === 0, alteradas: targets.length - failed.length, titulos: targets.filter((_, i) => checks[i]).slice(0, 8).map(t => t.title) };
      if (skipped.length) result.ignoradas = skipped.slice(0, 8);
      if (failed.length) result.erro = `${failed.length} tarefa(s) não tiveram a gravação confirmada no servidor: ${failed.slice(0, 5).map(t => t.title).join("; ")}`;
      return { result, log: { kind: failed.length ? "warn" : acao === "concluir" ? "done" : "update", text: `${targets.length - failed.length} tarefas ${label}`, detail: failed.length ? `${failed.length} sem confirmação` : "" } , undo: { label: `alteração em lote de ${targets.length} tarefas`, run: undoBatch } };
    }

    case "metas_semana": {
      const acao = a.acao || "listar";
      const goals = app.weeklyGoals || [];
      if (acao === "listar") return { result: { total: goals.length, concluidas: goals.filter(g => g.completed).length, metas: goals.slice(0, 20).map(g => ({ id: g.id, titulo: g.title, concluida: !!g.completed })) } };
      const blocked = writeBlocked(); if (blocked) return blocked;
      if (acao === "criar") {
        const title = String(a.titulo || "").trim();
        if (!title) return err("Faltou o título da meta.");
        const g = { id: uid(), title, completed: false, createdAt: new Date().toISOString() };
        await app.addWeeklyGoal(g);
        if (!await saved("weekly_goals", g.id, r => !!r)) return unsaved(title);
        return { result: { ok: true, meta: title }, log: { kind: "create", text: `Meta da semana: ${title}` } , undo: { label: `criação da meta "${title}"`, run: () => app.deleteWeeklyGoal(g.id) } };
      }
      if (acao === "concluir") {
        const r = find(goals, a.id || a.titulo, "title");
        if (!r.item) return err(r.ambiguous ? `Mais de uma meta combina: ${r.ambiguous.map(x => x.nome).join(", ")}.` : "Meta não encontrada.");
        if (r.item.completed) return { result: { ok: true, sem_alteracao: true } };
        await app.toggleWeeklyGoalCompletion(r.item.id);
        if (!await saved("weekly_goals", r.item.id, row => !!row && row.completed === true)) return unsaved(r.item.title);
        return { result: { ok: true, meta: r.item.title, concluida: true }, log: { kind: "done", text: `Meta concluída: ${r.item.title}` } , undo: { label: `conclusão da meta "${r.item.title}"`, run: () => app.toggleWeeklyGoalCompletion(r.item.id) } };
      }
      return err("acao deve ser listar, criar ou concluir.");
    }

    case "concluir_etapa_onboarding": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const open = (app.onboardings || []).filter(o => o.status === "em_andamento").map(o => ({ ...o, label: `${o.title || ""} ${o.clientName || ""}` }));
      const r = find(open, a.onboarding, "label");
      if (!r.item) return err(r.ambiguous ? `Mais de um onboarding combina: ${r.ambiguous.map(x => x.nome.trim()).join("; ")}.` : "Onboarding em andamento não encontrado. Use listar_onboardings.");
      const steps = (app.onboardingSteps || []).filter(x => x.onboardingId === r.item.id && x.status !== "concluido").sort((x, y) => (x.orderIndex || 0) - (y.orderIndex || 0));
      if (!steps.length) return err("Esse onboarding não tem etapas pendentes.");
      let step = steps[0];
      if (a.etapa) {
        const f = find(steps, a.etapa, "title");
        if (!f.item) return err(f.ambiguous ? `Mais de uma etapa combina: ${f.ambiguous.map(x => x.nome).join("; ")}.` : `Etapa não encontrada. Pendentes: ${steps.slice(0, 6).map(x => x.title).join("; ")}.`);
        step = f.item;
      }
      await app.updateStep({ ...step, status: "concluido", completedAt: today });
      if (!await saved("onboarding_steps", step.id, row => !!row && row.status === "concluido")) return unsaved(step.title);
      const left = steps.filter(x => x.id !== step.id);
      return { result: { ok: true, onboarding: r.item.title, etapa_concluida: step.title, etapas_pendentes: left.length, proxima_etapa: left[0]?.title || null }, log: { kind: "done", text: `Etapa concluída: ${step.title}`, detail: r.item.title } , undo: { label: `conclusão da etapa "${step.title}"`, run: () => app.updateStep({ ...step }) } };
    }

    case "listar_habitos": {
      const hs = (app.habits || []).filter(h => !h.archived);
      return { result: { hoje: today, total: hs.length, habitos: hs.map(h => habitView(h, today)) } };
    }

    case "marcar_habito": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const r = find((app.habits || []).filter(h => !h.archived), a.id, "title");
      if (!r.item) return err(r.ambiguous ? `Mais de um hábito combina: ${r.ambiguous.map(x => x.nome).join(", ")}.` : "Hábito não encontrado. Use listar_habitos.");
      const day = a.data ? date(a.data) : today;
      if (!day) return err(BAD_DATE);
      if (day > today) return err("Não é possível marcar um hábito em data futura.");
      const want = a.feito !== false;
      const has = (r.item.completedDates || []).includes(day);
      if (has === want) return { result: { ok: true, sem_alteracao: true } };
      await app.toggleHabitCompletion(r.item.id, day);
      if (!await saved("habits", r.item.id, row => !!row && (row.completed_dates || []).includes(day) === want)) return unsaved(r.item.title);
      return { result: { ok: true, habito: r.item.title, data: day, feito: want }, log: { kind: want ? "done" : "update", text: `Hábito ${want ? "feito" : "desmarcado"}: ${r.item.title}`, detail: day === today ? "hoje" : fmtBR(day) } , undo: { label: `marcação do hábito "${r.item.title}"`, run: () => app.toggleHabitCompletion(r.item.id, day) } };
    }

    case "buscar_clientes": {
      let list = app.clients || [];
      const admin = isAdmin(app);
      const totals = { clientes: list.length, pagamento_pendente: list.filter(c => c.paymentStatus === "pending").length };
      if (admin) {
        totals.receita_mensal = list.reduce((s, c) => s + (parseFloat(c.monthlyFee) || 0), 0);
        totals.valor_pendente = list.filter(c => c.paymentStatus === "pending").reduce((s, c) => s + (parseFloat(c.monthlyFee) || 0), 0);
      }
      if (a.busca) { const q = norm(a.busca); const digits = q.replace(/\D/g, ""); list = list.filter(c => norm(c.name).includes(q) || fuzzyHas(c.name, a.busca) || (digits.length >= 4 && String(c.document || "").replace(/\D/g, "").includes(digits))); }
      if (a.pagamento) list = list.filter(c => c.paymentStatus === a.pagamento);
      if (!a.busca && !a.pagamento) return { result: { carteira: totals } };
      const limit = Math.min(Math.max(parseInt(a.limite) || 12, 1), 40);
      const view = c => {
        const ts = (app.tasks || []).filter(t => t.clientId === c.id && !t.completed);
        const v = { id: c.id, nome: c.name, documento: c.document || null, pagamento: c.paymentStatus, tarefas_abertas: ts.length, tarefas_atrasadas: ts.filter(t => t.dueDate && t.dueDate < today).length };
        if (admin) v.honorario = parseFloat(c.monthlyFee) || 0;
        if (c.notes) v.notas = clip(c.notes, 140);
        return v;
      };
      list = [...list].sort((x, y) => (parseFloat(y.monthlyFee) || 0) - (parseFloat(x.monthlyFee) || 0));
      return { result: { carteira: totals, total: list.length, mostrando: Math.min(limit, list.length), clientes: list.slice(0, limit).map(view) } };
    }

    case "atualizar_pagamento_cliente": {
      if (!isAdmin(app)) return err("Apenas o administrador altera a situação de pagamento.");
      if (!["paid", "pending"].includes(a.status)) return err("Status deve ser paid ou pending.");
      const r = find(app.clients || [], a.id);
      if (!r.item) return err(r.ambiguous ? `Mais de um cliente combina: ${r.ambiguous.map(x => x.nome).join(", ")}.` : "Cliente não encontrado. Use buscar_clientes.");
      if (r.item.paymentStatus === a.status) return { result: { ok: true, sem_alteracao: true } };
      const prevPay = r.item.paymentStatus;
      await app.updateClient({ id: r.item.id, paymentStatus: a.status });
      if (!await saved("clients", r.item.id, row => !!row && row.payment_status === a.status)) return unsaved(r.item.name);
      return { result: { ok: true, cliente: r.item.name, pagamento: a.status }, log: { kind: "update", text: `Pagamento ${a.status === "paid" ? "confirmado" : "marcado como pendente"}: ${r.item.name}` } , undo: { label: `pagamento de ${r.item.name}`, run: () => app.updateClient({ id: r.item.id, paymentStatus: prevPay }) } };
    }

    case "registrar_evento_cliente": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const r = find(app.clients || [], a.cliente_id);
      if (!r.item) return err(r.ambiguous ? `Mais de um cliente combina: ${r.ambiguous.map(x => x.nome).join(", ")}.` : "Cliente não encontrado. Use buscar_clientes.");
      const title = String(a.titulo || "").trim();
      if (!title) return err("Faltou o título do registro.");
      const types = ["note", "meeting", "pending", "email", "call", "document", "payment"];
      const evId = uid();
      await app.addClientEvent({ id: evId, clientId: r.item.id, type: types.includes(a.tipo) ? a.tipo : "note", title, content: String(a.conteudo || ""), date: today, resolved: false });
      if (!await saved("client_events", evId, row => !!row)) return unsaved(title);
      return { result: { ok: true, cliente: r.item.name, registro: title }, log: { kind: "create", text: `Registro em ${r.item.name}`, detail: title } , undo: { label: `registro em ${r.item.name}`, run: () => app.deleteClientEvent(evId) } };
    }

    case "listar_onboardings": {
      const st = a.status || "em_andamento";
      const steps = app.onboardingSteps || [];
      const list = (app.onboardings || []).filter(o => st === "todos" || o.status === st).map(o => {
        const s = steps.filter(x => x.onboardingId === o.id).sort((x, y) => (x.orderIndex || 0) - (y.orderIndex || 0));
        const next = s.find(x => x.status !== "concluido");
        const v = { titulo: o.title, cliente: o.clientName || null, status: o.status, etapas_concluidas: s.filter(x => x.status === "concluido").length, etapas_total: s.length };
        if (o.targetDate) { v.prazo = o.targetDate; if (o.status === "em_andamento" && o.targetDate < today) v.atrasado = true; }
        if (next) v.proxima_etapa = next.title;
        return v;
      });
      return { result: { total: list.length, onboardings: list.slice(0, 25) } };
    }

    case "listar_projetos": {
      const st = a.status || "ativos";
      const list = (app.projects || []).filter(p => st === "todos" || (st === "ativos" ? p.status !== "done" : p.status === st)).map(p => {
        const ck = p.checklist || [];
        const v = { titulo: p.title, status: p.status, prioridade: p.priority };
        if (p.clientName) v.cliente = p.clientName;
        if (p.dueDate) { v.prazo = p.dueDate; if (p.status !== "done" && p.dueDate < today) v.atrasado = true; }
        if (ck.length) v.checklist = `${ck.filter(i => i.done || i.completed).length}/${ck.length}`;
        return v;
      });
      return { result: { total: list.length, projetos: list.slice(0, 25) } };
    }

    case "proximas_datas": {
      const win = Math.min(Math.max(parseInt(a.dias) || 14, 1), 120);
      const list = (app.relationships || []).map(r => ({ nome: r.name, tipo: r.type, em_dias: daysUntil(r, today) }))
        .filter(r => r.em_dias !== null && r.em_dias <= win).sort((x, y) => x.em_dias - y.em_dias);
      return { result: { janela_dias: win, total: list.length, datas: list.slice(0, 25) } };
    }

    case "pesquisar_web": {
      if (!env.remote) return err("A pesquisa na web não está disponível agora.");
      const query = String(a.consulta || "").replace(/\s+/g, " ").trim();
      if (query.length < 3) return err("Faltou o que pesquisar.");
      const tipo = a.tipo === "noticias" ? "noticias" : "geral";
      let r;
      try { r = await env.remote("search", { query, tipo }); }
      catch (e) { return { result: { erro: "A pesquisa falhou: " + (e?.message || "sem resposta") + " Diga isso ao usuário; não responda de memória como se fosse informação atual." }, log: { kind: "warn", text: "Pesquisa não concluída", detail: query } }; }
      const fontes = (r.fontes || []).slice(0, 5);
      return {
        result: { consulta: query, pesquisado_em: `${today}`, resumo: r.texto, fontes: fontes.map(f => f.titulo) },
        log: { kind: "nav", text: tipo === "noticias" ? "Notícias" : "Pesquisa na web", detail: query, links: fontes },
      };
    }

    case "cotacoes": {
      if (!env.remote) return err("As cotações não estão disponíveis agora.");
      const ativos = Array.isArray(a.ativos) ? a.ativos.map(String).filter(Boolean).slice(0, 12) : [];
      let r;
      try { r = await env.remote("market", { ativos }); }
      catch (e) { return { result: { erro: "Não consegui consultar as cotações: " + (e?.message || "sem resposta") }, log: { kind: "warn", text: "Cotações indisponíveis" } }; }
      const { ok: _ok, ...data } = r;
      if (!(data.cotacoes || []).length && !data.juros) return { result: { erro: "Nenhuma cotação encontrada. " + (data.falhas || []).join("; ") } };
      return { result: data, log: { kind: "nav", text: "Cotações", detail: (data.cotacoes || []).map(c => c.ativo).slice(0, 7).join(", ") } };
    }

    case "lembrar": {
      if (!env.memory) return err("A memória permanente não está disponível agora.");
      const fact = String(a.fato || "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (fact.length < 4) return err("Faltou o que devo lembrar.");
      if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|senha|password/i.test(fact)) return err("Não guardo senhas nem números de documentos na memória.");
      const items = env.memory.list();
      if (items.some(m => norm(m.content) === norm(fact))) return { result: { ok: true, ja_sabia: true } };
      if (items.length >= 60) return err("A memória está cheia (60 itens). Peça ao usuário para esquecer algo antes.");
      const item = await env.memory.add(fact);
      if (!item) return unsaved(fact);
      return { result: { ok: true, guardado: fact }, log: { kind: "create", text: "Memória guardada", detail: fact }, undo: { label: `lembrança "${clip(fact, 50)}"`, run: () => env.memory.remove(item.id) } };
    }

    case "esquecer": {
      if (!env.memory) return err("A memória permanente não está disponível agora.");
      const items = env.memory.list();
      const r = find(items, a.trecho, "content");
      if (!r.item) return err(r.ambiguous ? "Mais de um item combina. Pergunte qual: " + JSON.stringify(r.ambiguous.map(x => ({ id: x.id, texto: x.nome }))) : "Não encontrei isso na memória.");
      if (!await env.memory.remove(r.item.id)) return unsaved(r.item.content);
      return { result: { ok: true, esquecido: r.item.content }, log: { kind: "delete", text: "Memória apagada", detail: r.item.content }, undo: { label: `esquecimento de "${clip(r.item.content, 50)}"`, run: () => env.memory.add(r.item.content) } };
    }

    case "desfazer": {
      const label = env.undoLast ? await env.undoLast() : null;
      if (!label) return err("Não há nenhuma alteração minha para desfazer nesta sessão.");
      return { result: { ok: true, desfeito: label }, log: { kind: "update", text: "Desfeito", detail: label } };
    }

    case "abrir_tela": {
      if (!SCREENS[a.tela]) return err("Tela desconhecida.");
      const p = app.currentProfile;
      const adminOnly = ["settings", "team", "reports", "severance"];
      if (!isAdmin(app) && (adminOnly.includes(a.tela) || (p?.allowedTabs && !p.allowedTabs.includes(a.tela)))) return err("Seu perfil não tem acesso a essa tela.");
      env.setActiveTab(a.tela);
      return { result: { ok: true, tela: SCREENS[a.tela] }, log: { kind: "nav", text: `Abrindo ${SCREENS[a.tela]}` } };
    }

    default:
      return err(`Ferramenta desconhecida: ${name}`);
  }
}

export function fmtBR(d) {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

// ── Voz ────────────────────────────────────────────────────────────────────
// Nome de ativação: "Simão". É uma palavra comum do português, então o
// reconhecimento de voz acerta quase sempre; aceitamos também grafias vizinhas.
const WAKE_TARGETS = ["simao", "simon", "cimao", "simaum", "simau", "simaom"];
const plain = w => String(w).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function matchWake(text) {
  const raw = String(text || "").trim().split(/\s+/);
  const w = raw.map(plain);
  for (let i = 0; i < w.length; i++) {
    for (const span of [1]) {
      if (i + span > w.length) continue;
      const cand = w.slice(i, i + span).join("");
      // Só vale se começar com o som de "si": "limão" e "sermão" ficam de fora.
      const hit = WAKE_TARGETS.includes(cand) || (span === 1 && /^[sc]i/.test(cand) && cand.length >= 5 && cand.length <= 6 && lev(cand, "simao") <= 1);
      if (hit) return raw.slice(i + span).join(" ").replace(/^[\s,.!?:;-]+/, "");
    }
  }
  return null;
}

// Divide a fala em frases: a primeira sai sozinha para o áudio começar logo.
export function splitSpeech(text) {
  const bits = String(text || "").split(/([.!?…]+["')\]]*\s+)/);
  const sentences = [];
  for (let i = 0; i < bits.length; i += 2) { const x = (bits[i] + (bits[i + 1] || "")).trim(); if (x) sentences.push(x); }
  const out = []; let buf = "";
  sentences.forEach((x, i) => {
    if (i === 0) { out.push(x); return; }
    if (buf && (buf + " " + x).length > 240) { out.push(buf); buf = x; } else buf = buf ? buf + " " + x : x;
  });
  if (buf) out.push(buf);
  return out.slice(0, 8);
}

// Respostas de confirmação faladas ("sim", "pode", "não", "cancela").
const answer = t => plain(String(t || "").trim().split(/\s+/).filter(w => !WAKE_TARGETS.includes(plain(w))).join(" ").split(/\s+/)[0] || "");
export const saidYes = t => /^(sim|confirmo?|confirma|confirmar|pode|isso|exclui|excluir|apaga|apagar|manda|claro|positivo|ok|certo|faz|faca)$/.test(answer(t));
export const saidNo = t => /^(nao|cancela|cancelar|cancele|deixa|esquece|negativo|para|pare)$/.test(answer(t));
