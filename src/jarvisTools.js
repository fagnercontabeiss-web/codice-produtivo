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
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T12:00:00"));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; };

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
  };
}

// ── Execução ───────────────────────────────────────────────────────────────
// env: { setActiveTab(tab), confirm(texto) -> Promise<boolean> }
// Devolve { result, log? } — result vai para o modelo, log aparece na tela.
export async function runTool(name, input, app, env) {
  const today = todayStr();
  const a = input || {};
  const err = msg => ({ result: { erro: msg } });
  const writeBlocked = () => role(app) === "visualizador" ? err("Seu perfil é somente leitura; não posso alterar dados.") : null;

  const getTask = id => {
    const t = (app.tasks || []).find(x => x.id === id);
    if (!t || !canSeeTask(app, t)) return { e: err("Tarefa não encontrada. Use listar_tarefas com busca para obter o id.") };
    if (!canEditTask(app, t)) return { e: err("Sem permissão: a tarefa pertence a outro responsável.") };
    return { t };
  };
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
      if (p === "data" && !isDate(a.data)) return err("Informe data no formato YYYY-MM-DD.");
      const filters = {
        hoje: t => !t.completed && t.dueDate === today,
        amanha: t => !t.completed && t.dueDate === addDays(today, 1),
        atrasadas: t => !t.completed && t.dueDate && t.dueDate < today,
        semana: t => !t.completed && t.dueDate >= today && t.dueDate <= addDays(today, 7),
        abertas: t => !t.completed,
        concluidas_hoje: t => t.completed && t.dueDate === today,
        data: t => t.dueDate === a.data,
      };
      list = list.filter(filters[p] || filters.abertas);
      if (a.busca) {
        const q = norm(a.busca);
        const cliIds = new Set((app.clients || []).filter(c => norm(c.name).includes(q)).map(c => c.id));
        list = list.filter(t => norm(t.title).includes(q) || (t.clientId && cliIds.has(t.clientId)) || norm(t.notes).includes(q));
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
      if (a.data && !isDate(a.data)) return err("Data inválida; use YYYY-MM-DD.");
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
        dueDate: a.data || today, completed: false, isRecurring: !!rec, recurrenceType: rec, recurrenceEndDate: null,
        checklist: [], assignedTo: who.id || myId(app), visibility: "all", parentId: null,
        priority: PRIORITIES.includes(a.prioridade) ? a.prioridade : "normal", notes: String(a.notas || ""),
      };
      await app.addTask(task);
      const out = { ok: true, tarefa: taskView({ ...app, tasks: [task] }, task, today) };
      if (cat.unknown) out.aviso = `Categoria "${a.categoria}" não existe; usei a padrão.`;
      if (a.cliente && !clientId) out.aviso_cliente = `Cliente "${a.cliente}" não encontrado; a tarefa ficou sem cliente.`;
      return { result: out, log: { kind: "create", text: `Tarefa criada: ${title}`, detail: fmtBR(task.dueDate) + (clientName ? " · " + clientName : "") } };
    }

    case "atualizar_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const { t, e } = getTask(a.id); if (e) return e;
      const patch = { id: t.id };
      const changes = [];
      if (a.titulo && String(a.titulo).trim() !== t.title) { patch.title = String(a.titulo).trim(); changes.push("título"); }
      if (a.data !== undefined) {
        if (!isDate(a.data)) return err("Data inválida; use YYYY-MM-DD.");
        if (a.data !== t.dueDate) { patch.dueDate = a.data; changes.push(`data → ${fmtBR(a.data)}`); }
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
      return { result: { ok: true, alterado: changes, tarefa: taskView(app, { ...t, ...patch }, today) }, log: { kind: "update", text: `Tarefa atualizada: ${patch.title || t.title}`, detail: changes.join(" · ") } };
    }

    case "concluir_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const { t, e } = getTask(a.id); if (e) return e;
      const want = a.concluida !== false;
      if (t.completed === want) return { result: { ok: true, sem_alteracao: true, ja_estava: want ? "concluída" : "aberta" } };
      await app.toggleTaskCompletion(t.id);
      const out = { ok: true, tarefa: t.title, concluida: want };
      if (want && t.isRecurring && t.recurrenceType) out.observacao = "Recorrente: a próxima ocorrência foi criada.";
      return { result: out, log: { kind: want ? "done" : "update", text: `${want ? "Concluída" : "Reaberta"}: ${t.title}` } };
    }

    case "excluir_tarefa": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const { t, e } = getTask(a.id); if (e) return e;
      const ok = await env.confirm(`Excluir em definitivo a tarefa "${t.title}"?`);
      if (!ok) return { result: { ok: false, cancelado_pelo_usuario: true } };
      await app.deleteTask(t.id);
      return { result: { ok: true, excluida: t.title }, log: { kind: "delete", text: `Tarefa excluída: ${t.title}` } };
    }

    case "listar_habitos": {
      const hs = (app.habits || []).filter(h => !h.archived);
      return { result: { hoje: today, total: hs.length, habitos: hs.map(h => habitView(h, today)) } };
    }

    case "marcar_habito": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const r = find((app.habits || []).filter(h => !h.archived), a.id, "title");
      if (!r.item) return err(r.ambiguous ? `Mais de um hábito combina: ${r.ambiguous.map(x => x.nome).join(", ")}.` : "Hábito não encontrado. Use listar_habitos.");
      const day = a.data || today;
      if (!isDate(day)) return err("Data inválida; use YYYY-MM-DD.");
      if (day > today) return err("Não é possível marcar um hábito em data futura.");
      const want = a.feito !== false;
      const has = (r.item.completedDates || []).includes(day);
      if (has === want) return { result: { ok: true, sem_alteracao: true } };
      await app.toggleHabitCompletion(r.item.id, day);
      return { result: { ok: true, habito: r.item.title, data: day, feito: want }, log: { kind: want ? "done" : "update", text: `Hábito ${want ? "feito" : "desmarcado"}: ${r.item.title}`, detail: day === today ? "hoje" : fmtBR(day) } };
    }

    case "buscar_clientes": {
      let list = app.clients || [];
      const admin = isAdmin(app);
      const totals = { clientes: list.length, pagamento_pendente: list.filter(c => c.paymentStatus === "pending").length };
      if (admin) {
        totals.receita_mensal = list.reduce((s, c) => s + (parseFloat(c.monthlyFee) || 0), 0);
        totals.valor_pendente = list.filter(c => c.paymentStatus === "pending").reduce((s, c) => s + (parseFloat(c.monthlyFee) || 0), 0);
      }
      if (a.busca) { const q = norm(a.busca); const digits = q.replace(/\D/g, ""); list = list.filter(c => norm(c.name).includes(q) || (digits.length >= 4 && String(c.document || "").replace(/\D/g, "").includes(digits))); }
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
      await app.updateClient({ id: r.item.id, paymentStatus: a.status });
      return { result: { ok: true, cliente: r.item.name, pagamento: a.status }, log: { kind: "update", text: `Pagamento ${a.status === "paid" ? "confirmado" : "marcado como pendente"}: ${r.item.name}` } };
    }

    case "registrar_evento_cliente": {
      const blocked = writeBlocked(); if (blocked) return blocked;
      const r = find(app.clients || [], a.cliente_id);
      if (!r.item) return err(r.ambiguous ? `Mais de um cliente combina: ${r.ambiguous.map(x => x.nome).join(", ")}.` : "Cliente não encontrado. Use buscar_clientes.");
      const title = String(a.titulo || "").trim();
      if (!title) return err("Faltou o título do registro.");
      const types = ["note", "meeting", "pending", "email", "call", "document", "payment"];
      await app.addClientEvent({ id: uid(), clientId: r.item.id, type: types.includes(a.tipo) ? a.tipo : "note", title, content: String(a.conteudo || ""), date: today, resolved: false });
      return { result: { ok: true, cliente: r.item.name, registro: title }, log: { kind: "create", text: `Registro em ${r.item.name}`, detail: title } };
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
