import { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from "react";
import { createPortal } from "react-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { db, auth } from "./supabase.js";

// ============================================================
// TYPES & DEFAULTS
// ============================================================
const defaultCategories = [
  { id: "fiscal", name: "Fiscal", color: "#ef4444" },
  { id: "contabil", name: "Contábil", color: "#3b82f6" },
  { id: "dp", name: "DP", color: "#10b981" },
  { id: "societario", name: "Societário", color: "#f59e0b" },
  { id: "administrativo", name: "Administrativo", color: "#6366f1" },
  { id: "pessoal", name: "Pessoal", color: "#ec4899" },
  { id: "outro", name: "Outro", color: "#64748b" },
];
const defaultContexts = [
  { id: "pessoal", name: "Pessoal", color: "#ec4899" },
  { id: "codice-contabilidade", name: "Códice Contabilidade", color: "#3b82f6" },
  { id: "codice-start", name: "Códice Start", color: "#10b981" },
  { id: "iabv", name: "IABV", color: "#f59e0b" },
  { id: "direito", name: "Direito (Faculdade)", color: "#6366f1" },
];
const defaultState = {
  tasks: [], habits: [], clients: [], weeklyGoals: [],
  categories: defaultCategories, contexts: defaultContexts,
  relationships: [],
  onboardings: [],
  onboardingSteps: [],
  projects: [],
  clientEvents: [],
  severanceSimulations: [],
  aiAnalyses: [],
  teamUsers: [], // perfis da equipe
  currentProfile: null, // perfil do usuário logado
  settings: { appName: "Códice Produtivo", loginEmail: "Fagner", loginPassword: "Codice" }
};

// ============================================================
// CONTEXT
// ============================================================
const AppContext = createContext(null);
// Helper: calcula próxima data de recorrência
function getNextRecurrenceDate(dateStr, type) {
  if (!dateStr || !type) return null;
  const d = new Date(dateStr + "T12:00:00");
  switch(type) {
    case "daily":    d.setDate(d.getDate() + 1); break;
    case "weekdays": {
      d.setDate(d.getDate() + 1);
      while ([0,6].includes(d.getDay())) d.setDate(d.getDate() + 1);
      break;
    }
    case "weekly":   d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly":  d.setMonth(d.getMonth() + 1); break;
    case "yearly":   d.setFullYear(d.getFullYear() + 1); break;
    default: return null;
  }
  return d.toISOString().split("T")[0];
}


function AppProvider({ children }) {
  const [state, setState] = useState(defaultState);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const taskFromDb = r => ({ id:r.id, title:r.title, description:r.description||"", categoryId:r.category_id, contextId:r.context_id, clientId:r.client_id, dueDate:r.due_date, completed:r.completed, isRecurring:r.is_recurring, recurrenceType:r.recurrence_type||null, recurrenceEndDate:r.recurrence_end_date||null, checklist:r.checklist||[], assignedTo:r.assigned_to||null, visibility:r.visibility||"all", parentId:r.parent_id||null });
  const taskToDb   = t => ({ id:t.id, title:t.title, description:t.description||"", category_id:t.categoryId, context_id:t.contextId, client_id:t.clientId, due_date:t.dueDate, completed:t.completed, is_recurring:t.isRecurring||false, recurrence_type:t.recurrenceType||null, recurrence_end_date:t.recurrenceEndDate||null, checklist:t.checklist||[], assigned_to:t.assignedTo||null, visibility:t.visibility||"all", parent_id:t.parentId||null });
  const habitFromDb = r => ({ id:r.id, title:r.title||r.name||"", freq:r.frequency||"daily", freqDays:r.freq_days||[1,2,3,4,5,6,7], completedDates:r.completed_dates||[], categoryId:r.category_id||"", identity:r.identity||"", difficulty:r.difficulty||2, emoji:r.emoji||"⭐", color:r.color||"#2b8be8", isFavorite:r.is_favorite||false, timeOfDay:r.time_of_day||"morning", description:r.description||"", targetStreak:r.target_streak||21, archived:r.archived||false });
  const habitToDb   = h => ({ id:h.id, title:h.title, frequency:h.freq||"daily", freq_days:h.freqDays||[1,2,3,4,5,6,7], completed_dates:h.completedDates||[], category_id:h.categoryId||null, identity:h.identity||"", difficulty:h.difficulty||2, emoji:h.emoji||"⭐", color:h.color||"#2b8be8", is_favorite:h.isFavorite||false, time_of_day:h.timeOfDay||"morning", description:h.description||"", target_streak:h.targetStreak||21, archived:h.archived||false });
  const clientFromDb = r => ({ id:r.id, name:r.name, document:r.document, type:r.type, monthlyFee:r.monthly_fee, paymentStatus:r.payment_status, paymentMethod:r.payment_method, notes:r.notes, dueDates:r.due_dates||[], obligations:r.obligations||[], obligationStatuses:r.obligation_statuses||[], status:r.status, createdAt:r.created_at });
  const clientToDb   = c => ({ id:c.id, name:c.name||"", document:c.document||"", type:c.type||"pj", monthly_fee:parseFloat(c.monthlyFee)||0, payment_status:c.paymentStatus||"pending", payment_method:c.paymentMethod||"pix", notes:c.notes||"", due_dates:c.dueDates||[], obligations:c.obligations||[], obligation_statuses:c.obligationStatuses||[], status:c.status||"active", billing_sent:c.billingSent||false });
  const goalFromDb = r => ({ id:r.id, title:r.title, completed:r.completed, createdAt:r.created_at });
  const goalToDb   = g => ({ id:g.id, title:g.title, completed:g.completed });

  useEffect(() => {
    const load = async () => {
      try {
        await auth.restoreSession(); // AWAIT obrigatório — senão as chamadas seguintes ficam sem token
        const [tasks, habits, clients, goals, cats, ctxs, settingsRows, relsRaw] = await Promise.all([
          db.select("tasks"), db.select("habits"), db.select("clients"),
          db.select("weekly_goals"), db.select("categories"), db.select("contexts"), db.select("settings"), db.select("relationships"),
        ]);
        // user_profiles separado — tabela pode não existir em instâncias antigas
        const profilesRaw  = await db.select("user_profiles").catch(() => []);
        const onboardRaw   = await db.select("onboardings").catch(() => []);
        const projectsRaw  = await db.select("projects").catch(() => []);
        const severanceRaw  = await db.select("severance_simulations").catch(() => []);
        const aiRaw         = await db.select("ai_analyses").catch(() => []);
        const clientEvRaw  = await db.select("client_events").catch(() => []);
        const stepsRaw     = await db.select("onboarding_steps").catch(() => []);
        const currentUserId = auth.getUserId();
        const myProfile = (profilesRaw||[]).find(p => p.id === currentUserId) || null;
        const settings = settingsRows?.[0]
          ? { appName:settingsRows[0].app_name, loginEmail:settingsRows[0].login_email, loginPassword:settingsRows[0].login_password }
          : defaultState.settings;
        setState({
          tasks: tasks.map(taskFromDb), habits: habits.map(habitFromDb),
          clients: clients.map(clientFromDb), weeklyGoals: goals.map(goalFromDb),
          categories: cats.length > 0 ? cats.map(r => ({ id:r.id, name:r.name, color:r.color })) : defaultCategories,
          contexts:   ctxs.length > 0 ? ctxs.map(r => ({ id:r.id, name:r.name, color:r.color })) : defaultContexts,
          settings,
          relationships: (relsRaw || []).map(r => ({
            id:r.id, name:r.name, type:r.type, date:r.date, isAnnual:r.is_annual,
            message:r.message||"", notes:r.notes||"", clientId:r.client_id||"",
            whatsapp:r.whatsapp||"", email:r.email||"", notifiedAt:r.notified_at||"",
          })),
          teamUsers: (profilesRaw||[]).map(p => ({ id:p.id, name:p.name, role:p.role, ownerId:p.owner_id, avatarColor:p.avatar_color, active:p.active, allowedTabs:p.allowed_tabs||null, canCreateTasks:p.can_create_tasks!==false })),
          currentProfile: myProfile ? { id:myProfile.id, name:myProfile.name, role:myProfile.role, ownerId:myProfile.owner_id, avatarColor:myProfile.avatar_color, allowedTabs:myProfile.allowed_tabs||null, canCreateTasks:myProfile.can_create_tasks!==false } : null,
          clientEvents: (clientEvRaw||[]).map(e => ({ id:e.id, clientId:e.client_id, type:e.type, title:e.title, content:e.content||"", date:e.date, resolved:e.resolved||false })),
          severanceSimulations: (severanceRaw||[]).map(s => ({ id:s.id, date:s.created_at, employeeName:s.employee_name, clientName:s.client_name||"", clientId:s.client_id||null, reason:s.reason, dismissalDate:s.dismissal_date, netAmount:parseFloat(s.net_amount)||0, reportData:s.report_data, verbas:s.verbas, formData:s.form_data })),
          aiAnalyses: (aiRaw||[]).map(a => ({ id:a.id, type:a.type, result:a.result, createdAt:a.created_at })),
          projects: (projectsRaw||[]).map(p => ({
            id:p.id, title:p.title, description:p.description||"", status:p.status||"todo",
            priority:p.priority||"medium", category:p.category||"", clientId:p.client_id||"",
            clientName:p.client_name||"", responsibleId:p.responsible_id||null,
            teamIds:p.team_ids||[], dueDate:p.due_date||"", startDate:p.start_date||"",
            completedAt:p.completed_at||"", checklist:p.checklist||[], tags:p.tags||[],
            notes:p.notes||"", color:p.color||"#2b8be8", orderIndex:p.order_index||0,
            createdAt:p.created_at||new Date().toISOString()
          })),
          onboardings: (onboardRaw||[]).map(o => ({ id:o.id, title:o.title, type:o.type, status:o.status, clientId:o.client_id||"", clientName:o.client_name||"", responsibleId:o.responsible_id||null, notes:o.notes||"", startDate:o.start_date||"", targetDate:o.target_date||"", completedAt:o.completed_at||"" })),
          onboardingSteps: (stepsRaw||[]).map(s => ({ id:s.id, onboardingId:s.onboarding_id, title:s.title, description:s.description||"", status:s.status, responsibleId:s.responsible_id||null, orderIndex:s.order_index||0, dueDate:s.due_date||"", completedAt:s.completed_at||"", notes:s.notes||"" })),
        });
        // Só criar categorias/contextos padrão se for admin e não tiver nenhum ainda
        // Colaboradores/Visualizadores usam as categorias que o Supabase retorna
        const isAdminUser = myProfile?.role === "admin" || !myProfile;
        if (cats.length === 0 && isAdminUser) {
          await db.upsert("categories", defaultCategories).catch(() => {});
        }
        if (ctxs.length === 0 && isAdminUser) {
          await db.upsert("contexts", defaultContexts).catch(() => {});
        }
      } catch (e) {
        console.error("Supabase load error:", e);
        setDbError(true);
        try {
          const saved = localStorage.getItem("contaTaskState");
          if (saved) { const p = JSON.parse(saved); if (!p.categories) p.categories = defaultCategories; if (!p.contexts) p.contexts = defaultContexts; if (!p.settings) p.settings = defaultState.settings; setState(p); }
        } catch {}
      } finally { setLoading(false); }
    };
    load();
  }, []);

  useEffect(() => { if (dbError) localStorage.setItem("contaTaskState", JSON.stringify(state)); }, [state, dbError]);

  const addTask = useCallback(async t => { setState(s => ({ ...s, tasks:[...s.tasks,t] })); await db.upsert("tasks", taskToDb(t)).catch(console.error); }, []);
  const updateTask = useCallback(async t => {
    // Merge com estado atual para nunca sobrescrever com dados stale
    setState(s => {
      const current = s.tasks.find(x => x.id === t.id) || {};
      const merged = { ...current, ...t };
      db.upsert("tasks", taskToDb(merged)).catch(console.error);
      return { ...s, tasks: s.tasks.map(x => x.id === t.id ? merged : x) };
    });
  }, []);
  const deleteTask = useCallback(async id => { setState(s => ({ ...s, tasks:s.tasks.filter(t => t.id!==id) })); await db.delete("tasks", id).catch(console.error); }, []);
  const toggleTaskCompletion = useCallback(async id => {
    let updated;
    setState(s => {
      const tasks = s.tasks.map(t => t.id===id ? {...t, completed:!t.completed} : t);
      updated = tasks.find(t => t.id===id);
      return {...s, tasks};
    });
    setTimeout(() => {
      if (!updated) return;
      db.upsert("tasks", taskToDb(updated)).catch(console.error);
      // Se completou e é recorrente, criar próxima ocorrência automaticamente
      if (updated.completed && updated.isRecurring && updated.recurrenceType && updated.dueDate) {
        const nextDate = getNextRecurrenceDate(updated.dueDate, updated.recurrenceType);
        if (nextDate && (!updated.recurrenceEndDate || nextDate <= updated.recurrenceEndDate)) {
          setState(s => {
            const alreadyExists = s.tasks.some(t =>
              t.title === updated.title && t.dueDate === nextDate && !t.completed
            );
            if (alreadyExists) return s;
            const next = { ...updated, id: uid(), completed: false, dueDate: nextDate };
            db.upsert("tasks", taskToDb(next)).catch(console.error);
            return { ...s, tasks: [...s.tasks, next] };
          });
        }
      }
    }, 0);
  }, []);

  const addHabit = useCallback(async h => { setState(s => ({ ...s, habits:[...s.habits,h] })); await db.upsert("habits", habitToDb(h)).catch(console.error); }, []);
  const updateHabit = useCallback(async h => {
    // Atualizar estado imediatamente (síncrono) antes do banco
    setState(s => ({ ...s, habits: s.habits.map(x => x.id === h.id ? h : x) }));
    // Salvar no banco em paralelo
    db.upsert("habits", habitToDb(h)).catch(e => {
      console.error("Erro ao salvar hábito:", e);
      // Não reverter — o estado local está correto
    });
  }, []);
  const deleteHabit = useCallback(async id => { setState(s => ({ ...s, habits:s.habits.filter(h => h.id!==id) })); await db.delete("habits", id).catch(console.error); }, []);
  const toggleHabitCompletion = useCallback(async (id, date) => {
    let updated;
    setState(s => { const habits = s.habits.map(h => { if (h.id!==id) return h; const d = h.completedDates.includes(date) ? h.completedDates.filter(x => x!==date) : [...h.completedDates,date]; return {...h,completedDates:d}; }); updated = habits.find(h => h.id===id); return {...s,habits}; });
    setTimeout(() => { if (updated) db.upsert("habits", habitToDb(updated)).catch(console.error); }, 0);
  }, []);

  const addClient = useCallback(async c => { setState(s => ({ ...s, clients:[...s.clients,c] })); await db.upsert("clients", clientToDb(c)).catch(console.error); }, []);
  const updateClient = useCallback(async c => {
    setState(s => {
      const current = s.clients.find(x => x.id === c.id) || {};
      const merged = { ...current, ...c };
      db.upsert("clients", clientToDb(merged)).catch(console.error);
      return { ...s, clients: s.clients.map(x => x.id === c.id ? merged : x) };
    });
  }, []);
  const deleteClient = useCallback(async id => { setState(s => ({ ...s, clients:s.clients.filter(c => c.id!==id) })); await db.delete("clients", id).catch(console.error); }, []);

  const addWeeklyGoal = useCallback(async g => { setState(s => ({ ...s, weeklyGoals:[...s.weeklyGoals,g] })); await db.upsert("weekly_goals", goalToDb(g)).catch(console.error); }, []);
  const updateWeeklyGoal = useCallback(async g => { setState(s => ({ ...s, weeklyGoals:s.weeklyGoals.map(x => x.id===g.id?g:x) })); await db.upsert("weekly_goals", goalToDb(g)).catch(console.error); }, []);
  const deleteWeeklyGoal = useCallback(async id => { setState(s => ({ ...s, weeklyGoals:s.weeklyGoals.filter(g => g.id!==id) })); await db.delete("weekly_goals", id).catch(console.error); }, []);
  const toggleWeeklyGoalCompletion = useCallback(async id => {
    let updated;
    setState(s => { const weeklyGoals = s.weeklyGoals.map(g => g.id===id ? {...g,completed:!g.completed} : g); updated = weeklyGoals.find(g => g.id===id); return {...s,weeklyGoals}; });
    setTimeout(() => { if (updated) db.upsert("weekly_goals", goalToDb(updated)).catch(console.error); }, 0);
  }, []);

  const addCategory = useCallback(async c => { setState(s => ({ ...s, categories:[...s.categories,c] })); await db.upsert("categories", c).catch(console.error); }, []);
  const updateCategory = useCallback(async c => { setState(s => ({ ...s, categories:s.categories.map(x => x.id===c.id?c:x) })); await db.upsert("categories", c).catch(console.error); }, []);
  const deleteCategory = useCallback(async id => { setState(s => ({ ...s, categories:s.categories.filter(c => c.id!==id) })); await db.delete("categories", id).catch(console.error); }, []);

  const addContext = useCallback(async c => { setState(s => ({ ...s, contexts:[...s.contexts,c] })); await db.upsert("contexts", c).catch(console.error); }, []);
  const updateContext = useCallback(async c => { setState(s => ({ ...s, contexts:s.contexts.map(x => x.id===c.id?c:x) })); await db.upsert("contexts", c).catch(console.error); }, []);
  const deleteContext = useCallback(async id => { setState(s => ({ ...s, contexts:s.contexts.filter(c => c.id!==id) })); await db.delete("contexts", id).catch(console.error); }, []);

  const updateSettings = useCallback(async s => {
    setState(prev => ({ ...prev, settings:s }));
    await db.upsert("settings", { id:"default", app_name:s.appName, login_email:s.loginEmail, login_password:s.loginPassword }).catch(console.error);
  }, []);

  const addRelationship = useCallback(async r => {
    setState(s => ({ ...s, relationships:[...s.relationships, r] }));
    await db.upsert("relationships", { id:r.id, name:r.name, type:r.type, date:r.date, is_annual:r.isAnnual, message:r.message, notes:r.notes, client_id:r.clientId||null, whatsapp:r.whatsapp||null, email:r.email||null, notified_at:r.notifiedAt||null }).catch(console.error);
  }, []);
  const updateRelationship = useCallback(async r => {
    setState(s => ({ ...s, relationships:s.relationships.map(x => x.id===r.id?r:x) }));
    await db.upsert("relationships", { id:r.id, name:r.name, type:r.type, date:r.date, is_annual:r.isAnnual, message:r.message, notes:r.notes, client_id:r.clientId||null, whatsapp:r.whatsapp||null, email:r.email||null, notified_at:r.notifiedAt||null }).catch(console.error);
  }, []);
  const deleteRelationship = useCallback(async id => {
    setState(s => ({ ...s, relationships:s.relationships.filter(r => r.id!==id) }));
    await db.delete("relationships", id).catch(console.error);
  }, []);

  // Team user management — DEVE ficar antes do if(loading) return
  const addTeamUser = useCallback(async (profile) => {
    setState(s => ({ ...s, teamUsers: [...s.teamUsers, profile] }));
    await db.upsert("user_profiles", { id:profile.id, name:profile.name, role:profile.role, owner_id:profile.ownerId, avatar_color:profile.avatarColor||"#2b8be8", active:true, allowed_tabs:profile.allowedTabs||null, can_create_tasks:profile.canCreateTasks!==false }).catch(console.error);
  }, []);
  const updateTeamUser = useCallback(async (profile) => {
    setState(s => ({ ...s, teamUsers: s.teamUsers.map(u => u.id===profile.id ? profile : u) }));
    await db.upsert("user_profiles", { id:profile.id, name:profile.name, role:profile.role, owner_id:profile.ownerId, avatar_color:profile.avatarColor||"#2b8be8", active:profile.active, allowed_tabs:profile.allowedTabs||null, can_create_tasks:profile.canCreateTasks!==false }).catch(console.error);
  }, []);
  const removeTeamUser = useCallback(async (id) => {
    setState(s => ({ ...s, teamUsers: s.teamUsers.filter(u => u.id !== id) }));
    await db.delete("user_profiles", id).catch(console.error);
  }, []);

  // Project actions
  const addProject = useCallback(async p => {
    setState(s => ({ ...s, projects:[...s.projects, p] }));
    await db.upsert("projects", { id:p.id, title:p.title, description:p.description||"", status:p.status, priority:p.priority, category:p.category||"", client_id:p.clientId||null, client_name:p.clientName||"", responsible_id:p.responsibleId||null, team_ids:p.teamIds||[], due_date:p.dueDate||null, start_date:p.startDate||null, checklist:p.checklist||[], tags:p.tags||[], notes:p.notes||"", color:p.color||"#2b8be8", order_index:p.orderIndex||0 }).catch(console.error);
  }, []);
  const updateProject = useCallback(async p => {
    setState(s => ({ ...s, projects:s.projects.map(x => x.id===p.id?p:x) }));
    await db.upsert("projects", { id:p.id, title:p.title, description:p.description||"", status:p.status, priority:p.priority, category:p.category||"", client_id:p.clientId||null, client_name:p.clientName||"", responsible_id:p.responsibleId||null, team_ids:p.teamIds||[], due_date:p.dueDate||null, start_date:p.startDate||null, completed_at:p.completedAt||null, checklist:p.checklist||[], tags:p.tags||[], notes:p.notes||"", color:p.color||"#2b8be8", order_index:p.orderIndex||0 }).catch(console.error);
  }, []);
  const deleteProject = useCallback(async id => {
    setState(s => ({ ...s, projects:s.projects.filter(p => p.id!==id) }));
    await db.delete("projects", id).catch(console.error);
  }, []);

  // AI actions
  const saveAiAnalysis = useCallback(async (type, result) => {
    const entry = { id:uid(), type, result, createdAt:new Date().toISOString() };
    setState(s => ({ ...s, aiAnalyses:[entry, ...s.aiAnalyses.slice(0,9)] }));
    await db.upsert("ai_analyses", { id:entry.id, type, result, user_id:auth.getUserId() }).catch(console.error);
  }, []);

  // Client Events actions
  const addClientEvent = useCallback(async ev => {
    setState(s => ({ ...s, clientEvents:[...s.clientEvents, ev] }));
    await db.upsert("client_events", { id:ev.id, client_id:ev.clientId, type:ev.type, title:ev.title, content:ev.content||"", date:ev.date, resolved:ev.resolved||false }).catch(console.error);
  }, []);
  const updateClientEvent = useCallback(async ev => {
    setState(s => ({ ...s, clientEvents:s.clientEvents.map(x => x.id===ev.id?ev:x) }));
    await db.upsert("client_events", { id:ev.id, client_id:ev.clientId, type:ev.type, title:ev.title, content:ev.content||"", date:ev.date, resolved:ev.resolved||false }).catch(console.error);
  }, []);
  const deleteClientEvent = useCallback(async id => {
    setState(s => ({ ...s, clientEvents:s.clientEvents.filter(x => x.id!==id) }));
    await db.delete("client_events", id).catch(console.error);
  }, []);

  // Onboarding actions — DEVE ficar antes do if(loading) return
  const addOnboarding = useCallback(async o => {
    setState(s => ({ ...s, onboardings:[...s.onboardings, o] }));
    await db.upsert("onboardings", { id:o.id, title:o.title, type:o.type, status:o.status, client_id:o.clientId||null, client_name:o.clientName||"", responsible_id:o.responsibleId||null, notes:o.notes||"", start_date:o.startDate||null, target_date:o.targetDate||null }).catch(console.error);
  }, []);
  const updateOnboarding = useCallback(async o => {
    setState(s => ({ ...s, onboardings:s.onboardings.map(x => x.id===o.id?o:x) }));
    await db.upsert("onboardings", { id:o.id, title:o.title, type:o.type, status:o.status, client_id:o.clientId||null, client_name:o.clientName||"", responsible_id:o.responsibleId||null, notes:o.notes||"", start_date:o.startDate||null, target_date:o.targetDate||null, completed_at:o.completedAt||null }).catch(console.error);
  }, []);
  const deleteOnboarding = useCallback(async id => {
    setState(s => ({ ...s, onboardings:s.onboardings.filter(o => o.id!==id), onboardingSteps:s.onboardingSteps.filter(s2 => s2.onboardingId!==id) }));
    await db.delete("onboardings", id).catch(console.error);
  }, []);
  const addStep = useCallback(async s => {
    setState(st => ({ ...st, onboardingSteps:[...st.onboardingSteps, s] }));
    await db.upsert("onboarding_steps", { id:s.id, onboarding_id:s.onboardingId, title:s.title, description:s.description||"", status:s.status, responsible_id:s.responsibleId||null, order_index:s.orderIndex||0, due_date:s.dueDate||null, notes:s.notes||"" }).catch(console.error);
  }, []);
  const updateStep = useCallback(async s => {
    setState(st => ({ ...st, onboardingSteps:st.onboardingSteps.map(x => x.id===s.id?s:x) }));
    await db.upsert("onboarding_steps", { id:s.id, onboarding_id:s.onboardingId, title:s.title, description:s.description||"", status:s.status, responsible_id:s.responsibleId||null, order_index:s.orderIndex||0, due_date:s.dueDate||null, notes:s.notes||"", completed_at:s.completedAt||null }).catch(console.error);
  }, []);
  const deleteStep = useCallback(async id => {
    setState(s => ({ ...s, onboardingSteps:s.onboardingSteps.filter(x => x.id!==id) }));
    await db.delete("onboarding_steps", id).catch(console.error);
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#eef1f7", flexDirection:"column", gap:16 }}>
      <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#5aaff5" strokeWidth="2" style={{ width:24, height:24 }}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <p style={{ color:"#64748b", fontSize:14, fontWeight:600 }}>Carregando Códice Produtivo...</p>
      {dbError && <p style={{ color:"#ef4444", fontSize:12 }}>Erro ao conectar — usando dados locais</p>}
    </div>
  );

  const v = { ...state, addTask, updateTask, deleteTask, toggleTaskCompletion, addHabit, updateHabit, deleteHabit, toggleHabitCompletion, addClient, updateClient, deleteClient, addWeeklyGoal, updateWeeklyGoal, deleteWeeklyGoal, toggleWeeklyGoalCompletion, addCategory, updateCategory, deleteCategory, addContext, updateContext, deleteContext, updateSettings, addRelationship, updateRelationship, deleteRelationship, addTeamUser, updateTeamUser, removeTeamUser, addOnboarding, updateOnboarding, deleteOnboarding, addStep, updateStep, deleteStep, addClientEvent, updateClientEvent, deleteClientEvent, addProject, updateProject, deleteProject, saveAiAnalysis };
  return <AppContext.Provider value={v}>{children}</AppContext.Provider>;
}
const useApp = () => useContext(AppContext);

// ============================================================
// HELPERS
// ============================================================
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const today = () => new Date().toISOString().split("T")[0];
const fmt = (d) => { if (!d) return ""; const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };
const fmtCurrency = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const isOverdue = (dueDate, completed) => {
  if (completed || !dueDate) return false;
  return dueDate < today();
};

async function callClaude(prompt, systemPrompt = "") {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt || "Você é um assistente especializado em produtividade e contabilidade. Responda sempre em português do Brasil.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ============================================================
// NAV ICONS (SVG inline)
// ============================================================
const Icon = {
  Dashboard: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
  Tasks: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  Habits: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Goals: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Clients: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  Finance: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/></svg>,
  Obligations: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  Reports: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Calculator: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/></svg>,
  Settings: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  Logout: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  Menu: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  X: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Plus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  Edit: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Check: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>,
  Alert: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  Sparkles: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z"/></svg>,
  Refresh: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
  Save: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13"/><polyline points="7 3 7 8 15 8"/></svg>,
  Send: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Eye: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Download: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  ArrowLeft: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>,
  ChevronRight: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="9 18 15 12 9 6"/></svg>,
  ChevronLeft: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>,
  Filter: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
  List: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  Calendar: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Heart: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  Bell: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  Whatsapp: () => <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.121 1.532 5.859L.057 23.57a.75.75 0 0 0 .918.932l5.919-1.55A11.955 11.955 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.955 9.955 0 0 1-5.193-1.453l-.371-.221-3.853 1.009 1.026-3.742-.242-.385A9.956 9.956 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>,
  Lock: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  User: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Loader: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 animate-spin"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>,
};

// ============================================================
// MODAL
// ============================================================
function Modal({ title, onClose, children, maxWidth = "max-w-md" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(26,29,35,0.6)", backdropFilter: "blur(6px)" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} overflow-hidden`} style={{ maxHeight: "90vh", overflowY: "auto", border: "1px solid #e2eaf3" }}>
        <div className="px-6 py-4 flex justify-between items-center sticky top-0 bg-white z-10" style={{ borderBottom: "1px solid #dde3ed" }}>
          <h3 className="text-base font-bold" style={{ color: "#1a1d23" }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors" style={{ color: "#94a3b8" }}
            onMouseEnter={e => { e.currentTarget.style.background="#f0f4f8"; e.currentTarget.style.color="#0f2644"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#94a3b8"; }}
          ><Icon.X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================
// LOGIN
// ============================================================
function Login({ onLogin, settings }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (u === settings.loginEmail && p === settings.loginPassword) onLogin();
    else setErr("Login ou senha incorretos.");
  };
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">C</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight uppercase">{settings.appName}</h1>
          <p className="mt-2 text-sm text-slate-500">Faça login para acessar sua conta</p>
        </div>
        <div className="bg-white py-8 px-8 shadow-sm rounded-xl border border-slate-200">
          <div className="space-y-5">
            {err && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm text-center">{err}</div>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Login</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Icon.User /></div>
                <input type="text" required value={u} onChange={e => setU(e.target.value)} className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400" placeholder="Seu usuário" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Senha</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><Icon.Lock /></div>
                <input type="password" required value={p} onChange={e => setP(e.target.value)} className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400" placeholder="Sua senha" />
              </div>
            </div>
            <button type="button" onClick={() => { if (u === settings.loginEmail && p === settings.loginPassword) onLogin(); else setErr('Login ou senha incorretos.'); }} className="w-full py-2.5 px-4 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px #2b8be840" }}>Entrar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LAYOUT
// ============================================================

// ============================================================
// GLOBAL SEARCH RESULTS (Item 9)
// ============================================================
function GlobalSearchResults({ query, onSelect, setActiveTab }) {
  const { tasks, clients, relationships } = useApp();
  const q = (query||"").toLowerCase();

  const matchTasks    = (tasks||[]).filter(t => t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)).slice(0,4);
  const matchClients  = (clients||[]).filter(c => c.name?.toLowerCase().includes(q) || c.document?.toLowerCase().includes(q)).slice(0,3);
  const matchRels     = (relationships||[]).filter(r => r.name?.toLowerCase().includes(q)).slice(0,2);

  const total = matchTasks.length + matchClients.length + matchRels.length;
  if (total === 0) return (
    <div className="absolute top-full mt-1 left-0 w-72 rounded-xl shadow-xl z-50 p-3 text-center text-xs" style={{ background:"#fff", border:"1px solid #e2e8f0" }}>
      <span style={{ color:"#94a3b8" }}>Nenhum resultado para "{query}"</span>
    </div>
  );

  return (
    <div className="absolute top-full mt-1 left-0 w-80 rounded-xl shadow-xl z-50 overflow-hidden" style={{ background:"#fff", border:"1px solid #e2e8f0" }}>
      {matchTasks.length > 0 && (
        <div>
          <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Tarefas</p>
          {matchTasks.map(t => (
            <button key={t.id} onClick={() => { setActiveTab("tasks"); onSelect(); }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition-colors">
              <div className={"w-2 h-2 rounded-full flex-shrink-0"} style={{ background: t.completed ? "#10b981" : "#f59e0b" }} />
              <span className="text-xs font-medium truncate" style={{ color:"#1a1d23" }}>{t.title}</span>
              {t.dueDate && <span className="text-[10px] ml-auto flex-shrink-0" style={{ color:"#94a3b8" }}>{new Date(t.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
            </button>
          ))}
        </div>
      )}
      {matchClients.length > 0 && (
        <div>
          <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Clientes</p>
          {matchClients.map(c => (
            <button key={c.id} onClick={() => { setActiveTab("clients"); onSelect(); }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition-colors">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0" style={{ background:"#eff6ff", color:"#2b8be8" }}>{c.name.charAt(0)}</div>
              <span className="text-xs font-medium truncate" style={{ color:"#1a1d23" }}>{c.name}</span>
              <span className="text-[10px] ml-auto flex-shrink-0" style={{ color:"#94a3b8" }}>{fmtCurrency(c.monthlyFee||0)}</span>
            </button>
          ))}
        </div>
      )}
      {matchRels.length > 0 && (
        <div>
          <p className="px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Relacionamentos</p>
          {matchRels.map(r => (
            <button key={r.id} onClick={() => { setActiveTab("relationship"); onSelect(); }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition-colors">
              <span className="text-base flex-shrink-0">💝</span>
              <span className="text-xs font-medium truncate" style={{ color:"#1a1d23" }}>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Layout({ children, activeTab, setActiveTab, onLogout }) {
  const { settings, currentProfile } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const isAdmin = currentProfile?.role === "admin";
  const isColab = currentProfile?.role === "colaborador";
  const isViewer = currentProfile?.role === "visualizador";
  // Se allowedTabs está definido, usá-lo como filtro; null = sem restrição
  const allowedTabs = currentProfile?.allowedTabs || null;
  const canTab = (id) => isAdmin || !allowedTabs || allowedTabs.includes(id);

  // Todas as abas possíveis por grupo — o filtro canTab decide quem vê cada uma
  const allNavDefs = [
    {
      label: "Principal",
      items: [
        { id: "dashboard", label: "Dashboard", icon: Icon.Dashboard },
        { id: "tasks",     label: "Tarefas",         icon: Icon.Tasks },
        { id: "habits",    label: "Hábitos e Rotina", icon: Icon.Habits },
      ]
    },
    {
      label: "Escritório",
      items: [
        { id: "clients",      label: "Clientes",              icon: Icon.Clients },
        { id: "relationship", label: "Relacionamento",         icon: Icon.Heart },
        { id: "onboarding",   label: "Onboarding",             icon: Icon.Clients },
        { id: "obligations",  label: "Obrigações",             icon: Icon.Obligations },
        { id: "severance",    label: "Simulação Rescisória",   icon: Icon.Calculator },
      ]
    },
    {
      label: "Análise",
      items: [
        { id: "projects",  label: "Projetos",     icon: Icon.Tasks },
        { id: "codiceai",  label: "Códice IA",    icon: Icon.Sparkles },
        { id: "reports",   label: "Relatórios",   icon: Icon.Reports },
        { id: "workload", label: "Workload",       icon: Icon.Tasks },
        { id: "settings", label: "Configurações", icon: Icon.Settings },
        { id: "team",     label: "Equipe",         icon: Icon.Clients },
      ]
    },
  ];

  // Abas exclusivas do admin (nunca aparecem para outros)
  const adminOnlyTabs = ["settings", "team", "severance", "reports"];

  const navGroups = allNavDefs.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (adminOnlyTabs.includes(item.id) && !isAdmin) return false;
      return canTab(item.id);
    })
  })).filter(g => g.items.length > 0);
  const allItems = navGroups.flatMap(g => g.items);
  const currentLabel = allItems.find(i => i.id === activeTab)?.label || "";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#eef1f7", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-60 flex flex-col transform transition-transform duration-300 lg:translate-x-0 lg:static lg:inset-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "linear-gradient(180deg, #1c1f26 0%, #1e2330 60%, #1a2038 100%)" }}>

        {/* Logo */}
        <div className="flex flex-col items-center justify-center py-7 px-4 relative" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {settings.logoUrl
            ? <img src={settings.logoUrl} alt="Logo" className="h-10 w-auto mb-2 object-contain" />
            : <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center text-white font-black text-lg shadow-lg"
                style={{ background: "linear-gradient(135deg, #5aaff5 0%, #2b8be8 100%)" }}>
                {settings.appName?.[0] || "C"}
              </div>
          }
          <h1 className="text-xs font-bold text-center tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.85)" }}>{settings.appName}</h1>
          <button className="lg:hidden absolute top-4 right-4" style={{ color: "rgba(255,255,255,0.5)" }} onClick={() => setSidebarOpen(false)}><Icon.X /></button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {navGroups.map(group => (
            <div key={group.label}>
              <p className="text-[9px] font-bold uppercase tracking-widest px-3 mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const I = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button key={item.id} onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                      className="flex items-center w-full px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-150"
                      style={active
                        ? { background: "linear-gradient(90deg, #2b8be822 0%, #2b8be808 100%)", color: "#7ec8f8", borderLeft: "2px solid #2b8be8" }
                        : { color: "rgba(255,255,255,0.55)", borderLeft: "2px solid transparent" }
                      }
                      onMouseEnter={e => { if (!active) e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
                    >
                      <span className="mr-3 flex-shrink-0" style={active ? { color: "#5aaff5" } : {}}><I /></span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #5aaff5, #2b8be8)", color: "#fff" }}>
              {(currentProfile?.name?.[0] || auth.getUserEmail()?.[0] || "U").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>{currentProfile?.name || auth.getUserEmail() || "Usuário"}</p>
              <p className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{currentProfile?.role === "admin" ? "Administrador" : currentProfile?.role === "colaborador" ? "Colaborador" : currentProfile?.role === "visualizador" ? "Visualizador" : ""}</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Administrador</p>
            </div>
            <button onClick={onLogout} title="Sair"
              className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
              style={{ color: "rgba(255,255,255,0.35)" }}
              onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
              onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.35)"}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:16,height:16}}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center h-14 px-4 sm:px-6 flex-shrink-0" style={{ background: "#fff", borderBottom: "1px solid #dde3ed" }}>
          <button className="mr-4 lg:hidden" style={{ color: "#64748b" }} onClick={() => setSidebarOpen(true)}><Icon.Menu /></button>
          <div>
            <h1 className="text-base font-bold" style={{ color: "#1a1d23" }}>{currentLabel}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* ITEM 9 — Busca Global */}
            <div className="relative hidden sm:block">
              <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{width:15,height:15,position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={globalSearch} onChange={e=>{ setGlobalSearch(e.target.value); setSearchOpen(e.target.value.length > 0); }}
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
                placeholder="Buscar..." className="border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs w-44 focus:w-56 transition-all focus:ring-2 focus:ring-blue-300" />
              {searchOpen && globalSearch.length > 0 && (
                <GlobalSearchResults query={globalSearch} onSelect={() => { setGlobalSearch(""); setSearchOpen(false); }} setActiveTab={setActiveTab} />
              )}
            </div>
            <div className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: "#dbeafe", color: "#2b8be8" }}>
              {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================
function StatCard({ title, value, icon, trend, trendColor, accent = "#3b82f6" }) {
  return (
    <div className="rounded-2xl p-5 hover:shadow-lg transition-all duration-200 cursor-default relative overflow-hidden"
      style={{ background: "#fff", border: "1px solid #dde3ed", boxShadow: "0 2px 8px rgba(26,29,35,0.07)" }}>
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-5" style={{ background: accent, transform: "translate(30%, -30%)" }} />
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>{title}</p>
        <div className="p-2 rounded-xl" style={{ background: `${accent}15` }}>{icon}</div>
      </div>
      <p className="text-3xl font-black mb-1" style={{ color: "#1c1917", letterSpacing: "-0.5px" }}>{value}</p>
      <p className="text-xs font-medium" style={{ color: trendColor?.includes("red") ? "#ef4444" : trendColor?.includes("emerald") ? "#10b981" : trendColor?.includes("amber") ? "#f59e0b" : "#64748b" }}>{trend}</p>
    </div>
  );
}

function Dashboard() {
  const { tasks, habits, clients, weeklyGoals, categories, teamUsers, currentProfile, onboardings, relationships } = useApp();
  const t = today();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (currentProfile?.name || "Fagner").split(" ")[0];

  // ── Métricas core ──────────────────────────────────────────
  const overdue      = tasks.filter(x => !x.completed && x.dueDate && x.dueDate < t);
  const dueToday     = tasks.filter(x => !x.completed && x.dueDate === t);
  const completed7d  = tasks.filter(x => x.completed && x.dueDate >= (() => { const d=new Date(); d.setDate(d.getDate()-7); return d.toISOString().split("T")[0]; })());
  const pending      = tasks.filter(x => !x.completed);
  const totalDone    = tasks.filter(x => x.completed).length;
  const rate         = tasks.length > 0 ? Math.round(totalDone / tasks.length * 100) : 0;
  const mrr          = clients.reduce((s,c) => s + (parseFloat(c.monthlyFee)||0), 0);
  const activeOnb    = onboardings.filter(o => o.status === "em_andamento").length;

  // ── Sparkline 7 dias ──────────────────────────────────────
  const spark7 = useMemo(() => Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    const ds = d.toISOString().split("T")[0];
    return {
      day: d.toLocaleDateString("pt-BR",{weekday:"short"}).slice(0,3),
      done: tasks.filter(x => x.completed && x.dueDate === ds).length,
      pending: tasks.filter(x => !x.completed && x.dueDate === ds).length,
      date: ds,
    };
  }), [tasks]);

  // ── Produtividade últimas 4 semanas ───────────────────────
  const prod4w = useMemo(() => Array.from({length:4}, (_,i) => {
    const wEnd = new Date(); wEnd.setDate(wEnd.getDate() - i*7);
    const wStart = new Date(wEnd); wStart.setDate(wStart.getDate() - 6);
    const s = wStart.toISOString().split("T")[0], e = wEnd.toISOString().split("T")[0];
    const wTasks = tasks.filter(x => x.dueDate >= s && x.dueDate <= e);
    return {
      label: i===0 ? "Esta sem." : `${i}sem atrás`,
      total: wTasks.length,
      done: wTasks.filter(x=>x.completed).length,
      rate: wTasks.length > 0 ? Math.round(wTasks.filter(x=>x.completed).length/wTasks.length*100) : 0,
    };
  }).reverse(), [tasks]);

  // ── Resumo equipe ─────────────────────────────────────────
  const teamSummary = useMemo(() => (teamUsers||[]).map(u => {
    const mine = tasks.filter(x => x.assignedTo === u.id);
    return { ...u, total:mine.length, done:mine.filter(x=>x.completed).length, overdue:mine.filter(x=>!x.completed&&x.dueDate<t).length, pending:mine.filter(x=>!x.completed).length };
  }).filter(u => u.total > 0), [tasks, teamUsers, t]);

  // ── Insights inteligentes ─────────────────────────────────
  const insights = useMemo(() => {
    const list = [];
    if (overdue.length > 0) list.push({ type:"danger", icon:"🚨", title:`${overdue.length} tarefa${overdue.length>1?"s":""} em atraso`, sub:"Requer atenção imediata", action:"tasks" });
    if (dueToday.length > 0) list.push({ type:"warning", icon:"⏰", title:`${dueToday.length} tarefa${dueToday.length>1?"s":""} vencem hoje`, sub:"Priorize agora", action:"tasks" });
    if (rate >= 80) list.push({ type:"success", icon:"🏆", title:`Taxa de conclusão: ${rate}%`, sub:"Produtividade excelente esta semana!" });
    else if (rate < 40 && tasks.length > 0) list.push({ type:"info", icon:"💡", title:`Taxa de conclusão: ${rate}%`, sub:"Considere revisar as prioridades" });
    if (activeOnb > 0) list.push({ type:"info", icon:"🚀", title:`${activeOnb} onboarding${activeOnb>1?"s":""} em andamento`, sub:"Acompanhe o progresso", action:"onboarding" });
    const todayRels = (relationships||[]).filter(r => {
      const md = (r.date||"").length===10 ? r.date.slice(5) : r.date;
      return md === `${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    });
    if (todayRels.length > 0) list.push({ type:"special", icon:"🎂", title:`Aniversário hoje: ${todayRels.map(r=>r.name).join(", ")}`, sub:"Envie uma mensagem!", action:"relationship" });
    if (spark7.slice(-3).every(d=>d.done===0) && tasks.length>0) list.push({ type:"warning", icon:"📊", title:"Nenhuma tarefa concluída nos últimos 3 dias", sub:"Revise o ritmo de trabalho" });
    if (mrr > 0) list.push({ type:"success", icon:"💰", title:`MRR: ${fmtCurrency(mrr)}/mês`, sub:`${clients.filter(c=>c.paymentStatus==="paid").length} cliente${clients.filter(c=>c.paymentStatus==="paid").length!==1?"s":""} com pagamento confirmado` });
    return list.slice(0, 4);
  }, [overdue, dueToday, rate, tasks, activeOnb, relationships, spark7, mrr, clients]);

  // ── Sparkline SVG helper ───────────────────────────────────
  const Sparkline = ({ data, color="#2b8be8", height=32 }) => {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data, 1);
    const w = 80, h = height;
    const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h - (v/max)*h*0.85 - 2}`).join(" ");
    const area = `M0,${h} L${pts.split(" ").map((p,i,arr) => (i===0?p:p)).join(" L")} L${w},${h} Z`;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{overflow:"visible"}}>
        <defs>
          <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#sg-${color.replace("#","")})`}/>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        {/* Ponto atual */}
        {(() => { const last = pts.split(" ").pop(); const [lx,ly] = last.split(","); return (
          <circle cx={lx} cy={ly} r="2.5" fill={color} stroke="#fff" strokeWidth="1.5"/>
        );})()}
      </svg>
    );
  };

  // ── KPI Card ──────────────────────────────────────────────
  const KPICard = ({ label, value, sub, spark, sparkColor, accent, icon, urgent }) => (
    <div className="relative rounded-2xl p-5 overflow-hidden transition-all duration-300 group"
      style={{
        background: urgent
          ? "linear-gradient(135deg,rgba(239,68,68,0.06) 0%,rgba(255,255,255,0.98) 100%)"
          : "rgba(255,255,255,0.98)",
        border: urgent ? "1.5px solid rgba(239,68,68,0.25)" : "1px solid rgba(221,227,237,0.8)",
        boxShadow: urgent
          ? "0 4px 24px rgba(239,68,68,0.08), 0 1px 4px rgba(0,0,0,0.04)"
          : "0 4px 24px rgba(26,29,35,0.05), 0 1px 4px rgba(0,0,0,0.03)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=urgent?"0 8px 32px rgba(239,68,68,0.14)":"0 8px 32px rgba(26,29,35,0.1)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow=urgent?"0 4px 24px rgba(239,68,68,0.08)":"0 4px 24px rgba(26,29,35,0.05)";}}>
      {/* Glow de fundo sutil */}
      <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse at top right, ${accent}08 0%, transparent 60%)`, pointerEvents:"none" }}/>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8", letterSpacing:"0.1em" }}>{label}</p>
          <p className="text-2xl font-black leading-none mb-1" style={{ color: urgent ? "#ef4444" : "#1a1d23", fontVariantNumeric:"tabular-nums" }}>{value}</p>
          {sub && <p className="text-xs mt-1" style={{ color: urgent ? "#f87171" : "#94a3b8" }}>{sub}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
            style={{ background:`${accent}14`, border:`1px solid ${accent}22` }}>
            {icon}
          </div>
          {spark && <Sparkline data={spark} color={sparkColor||accent} height={28}/>}
        </div>
      </div>
    </div>
  );

  // ── Ticker de tarefas atrasadas ───────────────────────────
  const TickerItem = ({ task }) => {
    const days = Math.floor((new Date(t) - new Date(task.dueDate+"T12:00:00"))/(1000*60*60*24));
    return (
      <span className="inline-flex items-center gap-2 px-3 font-mono text-[11px]" style={{ color:"#fbbf24", whiteSpace:"nowrap" }}>
        <span style={{ color:"#ef4444", fontWeight:900 }}>●</span>
        <span style={{ color:"#fff", fontWeight:700 }}>{task.title}</span>
        <span style={{ color:"#f87171" }}>{days}d atraso</span>
        <span style={{ color:"rgba(255,255,255,0.2)" }}>│</span>
      </span>
    );
  };

  const tickerTasks = overdue.length > 0 ? overdue : dueToday;

  return (
    <div className="space-y-6 pb-8">

      {/* ═══ TICKER CENTRAL OPERACIONAL ══════════════════════ */}
      <div className="rounded-2xl overflow-hidden" style={{
        background:"linear-gradient(135deg,#0f1117 0%,#1a1d26 50%,#0f1723 100%)",
        border:"1px solid rgba(91,170,255,0.15)",
        boxShadow:"0 4px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background:"#10b981", boxShadow:"0 0 6px #10b981" }}/>
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color:"#10b981" }}>LIVE</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color:"rgba(255,255,255,0.3)" }}>Central Operacional · Códice Contabilidade</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono" style={{ color:"rgba(255,255,255,0.4)" }}>
            <span>{now.toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"})}</span>
            <span style={{ color:"#5aaff5" }}>{now.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
          </div>
        </div>

        {/* Saudação */}
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-black" style={{ color:"#fff", letterSpacing:"-0.02em" }}>
              {greeting}, {firstName} 👋
            </h1>
            <p className="text-xs mt-0.5" style={{ color:"rgba(255,255,255,0.45)" }}>
              {totalDone} tarefas concluídas · {pending.length} pendentes · taxa {rate}% esta semana
            </p>
          </div>
          {/* Mini status pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {overdue.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background:"rgba(239,68,68,0.15)", border:"1px solid rgba(239,68,68,0.3)" }}>
                <span className="text-sm">🚨</span>
                <span className="text-xs font-black" style={{ color:"#f87171" }}>{overdue.length} atrasada{overdue.length>1?"s":""}</span>
              </div>
            )}
            {dueToday.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background:"rgba(245,158,11,0.15)", border:"1px solid rgba(245,158,11,0.3)" }}>
                <span className="text-sm">⏰</span>
                <span className="text-xs font-black" style={{ color:"#fbbf24" }}>{dueToday.length} hoje</span>
              </div>
            )}
            {activeOnb > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background:"rgba(43,139,232,0.15)", border:"1px solid rgba(43,139,232,0.3)" }}>
                <span className="text-sm">🚀</span>
                <span className="text-xs font-black" style={{ color:"#5aaff5" }}>{activeOnb} onboarding</span>
              </div>
            )}
          </div>
        </div>

        {/* Ticker de tarefas — estilo mercado financeiro */}
        {tickerTasks.length > 0 && (
          <div className="relative overflow-hidden" style={{ borderTop:"1px solid rgba(255,255,255,0.05)", background:"rgba(0,0,0,0.3)" }}>
            <div className="flex items-center">
              {/* Label fixo */}
              <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 z-10"
                style={{ background:"linear-gradient(90deg,rgba(239,68,68,0.2),rgba(239,68,68,0.1))", borderRight:"1px solid rgba(239,68,68,0.2)" }}>
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color:"#ef4444" }}>⚠ ATRASADAS</span>
              </div>
              {/* Ticker animado */}
              <div className="flex-1 overflow-hidden py-2">
                <div style={{ display:"inline-flex", animation:"ticker 50s linear infinite", willChange:"transform" }}>
                  {[...tickerTasks,...tickerTasks,...tickerTasks].map((task,i) => <TickerItem key={i} task={task}/>)}
                </div>
              </div>
            </div>
          </div>
        )}
        <style>{`
          @keyframes ticker { from{transform:translateX(0)} to{transform:translateX(-33.333%)} }
        `}</style>
      </div>

      {/* ═══ KPI CARDS COM SPARKLINE ════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Tarefas Atrasadas"
          value={overdue.length}
          sub={overdue.length===0 ? "✓ Tudo em dia" : `+${overdue.length} aguardando`}
          spark={spark7.map(d=>d.pending)}
          sparkColor="#ef4444"
          accent="#ef4444"
          icon="🚨"
          urgent={overdue.length>0}
        />
        <KPICard
          label="Produtividade"
          value={`${rate}%`}
          sub={`${totalDone} de ${tasks.length} concluídas`}
          spark={prod4w.map(w=>w.rate)}
          sparkColor="#10b981"
          accent="#10b981"
          icon="📈"
        />
        <KPICard
          label="MRR"
          value={mrr > 0 ? fmtCurrency(mrr) : "—"}
          sub={`${clients.length} cliente${clients.length!==1?"s":""} ativo${clients.length!==1?"s":""}`}
          spark={[mrr*0.7, mrr*0.8, mrr*0.75, mrr*0.9, mrr*0.85, mrr*0.95, mrr].map(v=>v||0)}
          sparkColor="#2b8be8"
          accent="#2b8be8"
          icon="💰"
        />
        <KPICard
          label="Conclusões / Semana"
          value={completed7d.length}
          sub="últimos 7 dias"
          spark={spark7.map(d=>d.done)}
          sparkColor="#a855f7"
          accent="#a855f7"
          icon="✅"
        />
      </div>

      {/* ═══ GRÁFICO + INSIGHTS ══════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Gráfico principal aprimorado */}
        <div className="lg:col-span-2 rounded-2xl p-6" style={{
          background:"rgba(255,255,255,0.98)",
          border:"1px solid rgba(221,227,237,0.7)",
          boxShadow:"0 4px 24px rgba(26,29,35,0.06)",
          backdropFilter:"blur(8px)",
        }}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-black" style={{ color:"#1a1d23", letterSpacing:"-0.01em" }}>Produtividade Semanal</h3>
              <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Tarefas concluídas vs pendentes — últimos 7 dias</p>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider">
              <span className="flex items-center gap-1.5" style={{ color:"#2b8be8" }}>
                <span style={{ width:8,height:8,borderRadius:2,background:"#2b8be8",display:"inline-block" }}/>Concluídas
              </span>
              <span className="flex items-center gap-1.5" style={{ color:"#e2e8f0" }}>
                <span style={{ width:8,height:8,borderRadius:2,background:"#cbd5e1",display:"inline-block" }}/>Pendentes
              </span>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spark7} barGap={2} barCategoryGap="35%">
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2b8be8" stopOpacity="1"/>
                    <stop offset="100%" stopColor="#1d6fd4" stopOpacity="0.85"/>
                  </linearGradient>
                  <linearGradient id="barGradP" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.9"/>
                    <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.7"/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="rgba(226,232,240,0.5)" />
                <XAxis dataKey="day" axisLine={false} tickLine={false}
                  tick={({ x,y,payload,index }) => (
                    <text x={x} y={y+12} textAnchor="middle" fontSize={11} fontWeight={spark7[index]?.date===t?700:400}
                      fill={spark7[index]?.date===t?"#2b8be8":"#94a3b8"}>
                      {spark7[index]?.date===t?"Hoje":payload.value}
                    </text>
                  )}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill:"#cbd5e1", fontSize:10 }} allowDecimals={false} width={20}/>
                <Tooltip
                  cursor={{ fill:"rgba(43,139,232,0.04)", radius:8 }}
                  contentStyle={{ borderRadius:14, border:"1px solid rgba(221,227,237,0.8)", boxShadow:"0 8px 32px rgba(26,29,35,0.12)", padding:"10px 14px", fontSize:12, background:"rgba(255,255,255,0.98)", backdropFilter:"blur(8px)" }}
                  labelStyle={{ fontWeight:700, color:"#1a1d23", marginBottom:4 }}
                  formatter={(val,name) => [`${val} tarefa${val!==1?"s":""}`, name]}
                />
                <Bar dataKey="done" name="Concluídas" fill="url(#barGrad)" radius={[6,6,0,0]} stackId="a" maxBarSize={36}/>
                <Bar dataKey="pending" name="Pendentes" fill="url(#barGradP)" radius={[6,6,0,0]} stackId="a" maxBarSize={36}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Mini KPIs internos */}
          <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop:"1px solid rgba(226,232,240,0.6)" }}>
            {[
              { label:"Concluídas semana", value:spark7.reduce((s,d)=>s+d.done,0), color:"#2b8be8" },
              { label:"Pendentes semana",  value:spark7.reduce((s,d)=>s+d.pending,0), color:"#94a3b8" },
              { label:"Taxa da semana",    value:`${spark7.reduce((s,d)=>s+d.done,0)+spark7.reduce((s,d)=>s+d.pending,0)>0?Math.round(spark7.reduce((s,d)=>s+d.done,0)/(spark7.reduce((s,d)=>s+d.done,0)+spark7.reduce((s,d)=>s+d.pending,0))*100):0}%`, color:"#10b981" },
            ].map(k => (
              <div key={k.label} className="text-center">
                <p className="text-lg font-black leading-none" style={{ color:k.color, fontVariantNumeric:"tabular-nums" }}>{k.value}</p>
                <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>{k.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Alertas inteligentes */}
        <div className="rounded-2xl p-5 flex flex-col gap-3" style={{
          background:"rgba(255,255,255,0.98)",
          border:"1px solid rgba(221,227,237,0.7)",
          boxShadow:"0 4px 24px rgba(26,29,35,0.06)",
        }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-4 rounded-full" style={{ background:"linear-gradient(180deg,#5aaff5,#2b8be8)" }}/>
            <h3 className="text-sm font-black" style={{ color:"#1a1d23" }}>Insights do Escritório</h3>
          </div>
          {insights.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 gap-3">
              <div className="text-4xl">🎯</div>
              <p className="text-sm font-semibold" style={{ color:"#1a1d23" }}>Tudo sob controle!</p>
              <p className="text-xs" style={{ color:"#94a3b8" }}>Nenhum alerta no momento</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {insights.map((ins,i) => {
                const colors = { danger:"#ef4444",warning:"#f59e0b",success:"#10b981",info:"#2b8be8",special:"#a855f7" };
                const bgs    = { danger:"rgba(239,68,68,0.06)",warning:"rgba(245,158,11,0.06)",success:"rgba(16,185,129,0.06)",info:"rgba(43,139,232,0.06)",special:"rgba(168,85,247,0.06)" };
                const c = colors[ins.type]||"#64748b";
                const bg = bgs[ins.type]||"#f8fafc";
                return (
                  <div key={i} className="p-3 rounded-xl transition-all cursor-default"
                    style={{ background:bg, border:`1px solid ${c}18` }}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateX(3px)";e.currentTarget.style.borderColor=c+"40";}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="translateX(0)";e.currentTarget.style.borderColor=c+"18";}}>
                    <div className="flex items-start gap-2.5">
                      <span className="text-lg flex-shrink-0 mt-0.5">{ins.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-black leading-snug" style={{ color:c }}>{ins.title}</p>
                        <p className="text-[10px] mt-0.5 leading-snug" style={{ color:"#94a3b8" }}>{ins.sub}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ EQUIPE + PRÓXIMAS TAREFAS ═══════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Resumo da equipe */}
        {teamSummary.length > 0 && (
          <div className="rounded-2xl p-5" style={{
            background:"rgba(255,255,255,0.98)",
            border:"1px solid rgba(221,227,237,0.7)",
            boxShadow:"0 4px 24px rgba(26,29,35,0.06)",
          }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1.5 h-4 rounded-full" style={{ background:"linear-gradient(180deg,#10b981,#059669)" }}/>
              <h3 className="text-sm font-black" style={{ color:"#1a1d23" }}>Resumo da Equipe</h3>
              <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"#f0fdf4", color:"#10b981" }}>{teamSummary.length} membro{teamSummary.length!==1?"s":""}</span>
            </div>
            <div className="space-y-3">
              {teamSummary.map(u => {
                const pct = u.total>0?Math.round(u.done/u.total*100):0;
                const pctColor = pct>=70?"#10b981":pct>=40?"#f59e0b":"#ef4444";
                return (
                  <div key={u.id} className="p-3 rounded-xl transition-all"
                    style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="#dde3ed";e.currentTarget.style.background="#f0f4f8";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8edf5";e.currentTarget.style.background="#f8fafc";}}>
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black text-white flex-shrink-0"
                        style={{ background:u.avatarColor||"#2b8be8", boxShadow:`0 2px 8px ${u.avatarColor||"#2b8be8"}44` }}>
                        {u.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-black" style={{ color:"#1a1d23" }}>{u.name.split(" ")[0]}</p>
                          <p className="text-xs font-black" style={{ color:pctColor }}>{pct}%</p>
                        </div>
                        <p className="text-[10px]" style={{ color:"#94a3b8" }}>{u.done} feitas · {u.pending} pendentes{u.overdue>0?` · ${u.overdue} atrasadas`:""}</p>
                      </div>
                    </div>
                    <div className="w-full rounded-full h-1" style={{ background:"#e2e8f0" }}>
                      <div className="h-1 rounded-full transition-all duration-700"
                        style={{ width:pct+"%", background:`linear-gradient(90deg,${pctColor},${pctColor}cc)` }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Próximas tarefas urgentes */}
        <div className="rounded-2xl p-5" style={{
          background:"rgba(255,255,255,0.98)",
          border:"1px solid rgba(221,227,237,0.7)",
          boxShadow:"0 4px 24px rgba(26,29,35,0.06)",
        }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1.5 h-4 rounded-full" style={{ background:"linear-gradient(180deg,#f59e0b,#d97706)" }}/>
            <h3 className="text-sm font-black" style={{ color:"#1a1d23" }}>Foco Imediato</h3>
          </div>
          {[...overdue, ...dueToday].length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <div className="text-3xl">✅</div>
              <p className="text-sm font-semibold" style={{ color:"#1a1d23" }}>Sem urgências!</p>
              <p className="text-xs" style={{ color:"#94a3b8" }}>Nenhuma tarefa atrasada ou vencendo hoje</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...overdue.slice(0,3), ...dueToday.slice(0,3)].map(task => {
                const isOv = overdue.includes(task);
                const days = isOv ? Math.floor((new Date(t)-new Date(task.dueDate+"T12:00:00"))/(1000*60*60*24)) : 0;
                const assignedUser = (teamUsers||[]).find(u=>u.id===task.assignedTo);
                return (
                  <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl transition-all"
                    style={{ background: isOv?"rgba(239,68,68,0.04)":"rgba(245,158,11,0.04)", border:`1px solid ${isOv?"rgba(239,68,68,0.15)":"rgba(245,158,11,0.15)"}` }}>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isOv?"#ef4444":"#f59e0b" }}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color:"#1a1d23" }}>{task.title}</p>
                      {assignedUser && <p className="text-[10px]" style={{ color:"#94a3b8" }}>👤 {assignedUser.name.split(" ")[0]}</p>}
                    </div>
                    <span className="text-[10px] font-black flex-shrink-0 px-2 py-0.5 rounded-full"
                      style={{ background: isOv?"rgba(239,68,68,0.1)":"rgba(245,158,11,0.1)", color: isOv?"#ef4444":"#f59e0b" }}>
                      {isOv ? `${days}d atraso` : "Hoje"}
                    </span>
                  </div>
                );
              })}
              {([...overdue,...dueToday].length > 6) && (
                <p className="text-center text-xs" style={{ color:"#94a3b8" }}>+{[...overdue,...dueToday].length-6} mais tarefas</p>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}


// ============================================================
// TASKS
// ============================================================
function Tasks() {
  const { tasks, addTask, updateTask, deleteTask, toggleTaskCompletion, clients, categories, contexts, currentProfile, teamUsers } = useApp();
  const isAdmin  = currentProfile?.role === "admin" || !currentProfile;
  const isColab  = currentProfile?.role === "colaborador";
  const isViewer = currentProfile?.role === "visualizador";
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split("T")[0]; });
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 2); return d.toISOString().split("T")[0]; });
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [filterCtx, setFilterCtx] = useState("all");
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState("");
  const [hideCompleted, setHideCompleted] = useState(true);
  const [viewMode, setViewMode] = useState("list");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [isMultiOpen, setIsMultiOpen] = useState(false);
  const [showDonePanel, setShowDonePanel] = useState(false);
  const [doneFilterDate, setDoneFilterDate] = useState(today());
  const [calMonth, setCalMonth] = useState(new Date());

  const overdue = tasks.filter(t => !t.completed && t.dueDate < today());
  // ID do usuário logado (fallback quando currentProfile ainda não carregou)
  const sessionUserId = auth.getUserId ? auth.getUserId() : null;
  const myUserId = currentProfile?.id || sessionUserId;

  // Filtro de visibilidade:
  // - Admin (ou sem perfil carregado ainda): vê tudo
  // - Colaborador/Visualizador: vê tarefas atribuídas a ele OU sem responsável com visibility="all"
  const visibleTasks = tasks.filter(t => {
    if (!currentProfile || currentProfile.role === "admin") return true;
    // Tarefa atribuída ao próprio usuário — sempre visível
    if (t.assignedTo && t.assignedTo === myUserId) return true;
    // Tarefa sem responsável e visível para todos — visível
    if (!t.assignedTo && t.visibility !== "assigned") return true;
    // Qualquer outro caso — não visível
    return false;
  });

  const filtered = visibleTasks.filter(t => {
    if (t.parentId) return false; // Subtarefas não aparecem na lista principal
    if (filterStatus === "completed" && !t.completed) return false;
    if (filterStatus === "pending" && t.completed) return false;
    if (hideCompleted && t.completed) return false;
    if (filterCat !== "all" && t.categoryId !== filterCat) return false;
    if (filterCtx !== "all" && t.contextId !== filterCtx) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (t.dueDate < startDate || t.dueDate > endDate) return false;
    return true;
  });

  const calYear = calMonth.getFullYear(), calMon = calMonth.getMonth();
  const firstDay = new Date(calYear, calMon, 1).getDay();
  const daysInMonth = new Date(calYear, calMon + 1, 0).getDate();
  const calDays = [];
  for (let i = 0; i < firstDay; i++) calDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calDays.push(i);

  const [tf, setTf] = useState({ title:"", description:"", categoryId:"", contextId:"", dueDate:"", clientId:"", isRecurring:false, recurrenceType:null, recurrenceEndDate:null, assignedTo:"", visibility:"all" });
  const [multiText, setMultiText] = useState("");
  const canEditTask = (task) => {
    if (!currentProfile || currentProfile.role === "admin") return true;
    if (currentProfile.role === "visualizador") return false;
    // colaborador só edita tarefas atribuídas a ele ou sem responsável
    if (task.assignedTo && task.assignedTo !== currentProfile.id) return false;
    return true;
  };
  const [isListening, setIsListening] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState("single"); // "single" | "multi"
  const recognitionRef = useRef(null);

  const startVoice = (target = "single") => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Seu navegador não suporta reconhecimento de voz. Use Chrome ou Safari."); return; }
    setVoiceTarget(target);
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);
    rec.onerror = () => { setIsListening(false); };
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      if (target === "multi") {
        setMultiText(prev => prev ? prev + "\n" + transcript : transcript);
        if (!isMultiOpen) setIsMultiOpen(true);
      } else {
        setTf(prev => ({ ...prev, title: prev.title ? prev.title + " " + transcript : transcript }));
        if (!isFormOpen) setIsFormOpen(true);
      }
    };
    recognitionRef.current = rec;
    rec.start();
  };

  const stopVoice = () => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {} }
    setIsListening(false);
  };

  const openTaskForm = (task) => {
    // Bloquear edição para visualizador
    if (currentProfile?.role === "visualizador") return;
    // Colaborador: nova tarefa só se canCreateTasks=true
    if (!task && currentProfile?.role === "colaborador" && !currentProfile?.canCreateTasks) return;
    // Colaborador: só edita tarefas atribuídas a ele ou sem responsável
    if (task && currentProfile?.role === "colaborador") {
      if (task.assignedTo && task.assignedTo !== currentProfile.id) return;
    }
    setEditing(task || null);
    setTf(task ? { title:task.title||"", description:task.description||"", categoryId:task.categoryId||categories[0]?.id||"", contextId:task.contextId||contexts[0]?.id||"", dueDate:task.dueDate||new Date().toISOString().split("T")[0], clientId:task.clientId||"", isRecurring:!!task.isRecurring, recurrenceType:task.recurrenceType||null, recurrenceEndDate:task.recurrenceEndDate||null, assignedTo:task.assignedTo||"", visibility:task.visibility||"all" } : { title:"", description:"", categoryId:categories[0]?.id||"", contextId:contexts[0]?.id||"", dueDate:new Date().toISOString().split("T")[0], clientId:"", isRecurring:false, recurrenceType:null, recurrenceEndDate:null, assignedTo:"", visibility:"all" });
    setIsFormOpen(true);
  };

  const saveTask = () => {
    if (!tf.title.trim()) return;
    const data = { id: editing?.id || uid(), ...tf, completed: editing?.completed || false, checklist: editing?.checklist || [], clientId: tf.clientId || undefined };
    editing ? updateTask(data) : addTask(data);
    setIsFormOpen(false); setEditing(null);
  };

  const saveMulti = () => {
    const lines = multiText.split("\n").map(l => l.trim()).filter(Boolean);
    lines.forEach(line => addTask({ id: uid(), title: line, categoryId: categories[0]?.id || "outro", contextId: (contexts.find(c => c.name === "Códice Contabilidade") || contexts[0])?.id, dueDate: new Date().toISOString().split("T")[0], completed: false, isRecurring: false, checklist: [] }));
    setMultiText(""); setIsMultiOpen(false);
  };

  return (
    <div className="space-y-6">
      {overdue.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background:"#fff8f6", border:"1px solid #fca5a5", borderLeft:"4px solid #ef4444" }}>
          <div className="flex items-center mb-3 gap-2" style={{ color:"#dc2626" }}><Icon.Alert /><h2 className="text-base font-bold">Tarefas Atrasadas ({overdue.length})</h2></div>
          <div className="space-y-2">
            {overdue.map(task => <TaskItem key={task.id} task={task} onToggle={() => toggleTaskCompletion(task.id)} onEdit={() => openTaskForm(task)} onDelete={() => deleteTask(task.id)} onUpdate={updateTask} categories={categories} contexts={contexts} teamUsers={teamUsers} currentProfile={currentProfile} compact={compactMode} onDuplicate={t => { const nt={...t,id:uid(),completed:false}; addTask(nt); }} />)}
          </div>
        </div>
      )}
      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom:"1px solid #dde3ed" }}>
          {viewMode === "list" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-700">Período:</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400" />
              <span className="text-slate-500 text-sm">até</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400" />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => { const d = new Date(calMonth); d.setMonth(d.getMonth() - 1); setCalMonth(d); }} className="p-1 hover:bg-slate-100 rounded transition-colors"><Icon.ChevronLeft /></button>
              <span className="font-semibold text-slate-800 capitalize">{calMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
              <button onClick={() => { const d = new Date(calMonth); d.setMonth(d.getMonth() + 1); setCalMonth(d); }} className="p-1 hover:bg-slate-100 rounded transition-colors"><Icon.ChevronRight /></button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex p-1 rounded-xl" style={{ background:"#e8edf5" }}>
              <button onClick={() => setViewMode("list")} className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md gap-1.5 transition-colors ${viewMode === "list" ? "bg-white shadow-sm" : "text-stone-500"}`} style={viewMode==="list"?{color:"#2b8be8"}:{}}><Icon.List />Lista</button>
              <button onClick={() => setViewMode("calendar")} className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md gap-1.5 transition-colors ${viewMode === "calendar" ? "bg-white shadow-sm" : "text-stone-500"}`} style={viewMode==="calendar"?{color:"#2b8be8"}:{}}><Icon.Calendar />Calendário</button>
            </div>
            {/* Modo Compacto */}
            <button onClick={() => setCompactMode(v=>!v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ background: compactMode ? "linear-gradient(135deg,#1a1d26,#1e2e4a)" : "#f0f4f8", color: compactMode ? "#5aaff5" : "#64748b", border: compactMode ? "1px solid rgba(91,170,255,0.2)" : "1px solid #e2e8f0" }}
              title="Alternar modo compacto">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:13,height:13}}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              {compactMode ? "Compacto" : "Compacto"}
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} className="rounded border-slate-300 text-indigo-600" />Ocultar concluídas
            </label>
            <button onClick={() => setShowDonePanel(true)} className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold gap-1.5 transition-all relative" style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Concluídos
              {tasks.filter(t => t.completed && t.dueDate === today()).length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-black flex items-center justify-center text-white" style={{ background:"#16a34a" }}>
                  {tasks.filter(t => t.completed && t.dueDate === today()).length}
                </span>
              )}
            </button>
            {(isAdmin || (isColab && currentProfile?.canCreateTasks)) && (
              <button onClick={() => setIsMultiOpen(true)} className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold gap-1.5 transition-colors" style={{ background:"#f0f4f8", color:"#1a1d23" }}><Icon.List />Em Lote</button>
            )}
            <button onClick={isListening ? stopVoice : startVoice}
              className="flex items-center px-4 py-2 rounded-xl text-sm font-bold gap-1.5 transition-all"
              style={{ background: isListening ? "linear-gradient(135deg,#ef4444,#dc2626)" : "#f0f4f8", color: isListening ? "#fff" : "#1a1d23", boxShadow: isListening ? "0 0 0 4px rgba(239,68,68,0.2)" : "none", animation: isListening ? "pulse 1.5s infinite" : "none" }}
              title={isListening ? "Parar gravação" : "Criar tarefa por voz"}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:16,height:16}}>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              {isListening ? "Gravando..." : "Voz"}
            </button>
            {(isAdmin || (isColab && currentProfile?.canCreateTasks)) && (
              <button onClick={() => openTaskForm(null)} className="flex items-center px-4 py-2 text-white rounded-xl text-sm font-bold gap-1.5 transition-all" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px #2b8be840" }}><Icon.Plus />Nova Tarefa</button>
            )}
          </div>
        </div>

        {viewMode === "list" && (
          <div className="px-4 py-3 flex flex-wrap gap-2 items-center" style={{ borderBottom:"1px solid rgba(221,227,237,0.7)", background:"rgba(248,250,252,0.8)" }}>
            {/* ── Botões HOJE e TODAS ── */}
            <button
              onClick={() => { setFilterStatus("pending"); setStartDate(today()); setEndDate(today()); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black transition-all"
              style={{
                background: filterStatus==="pending" && startDate===today() && endDate===today() ? "linear-gradient(135deg,#f97316,#ea580c)" : "rgba(249,115,22,0.09)",
                color: filterStatus==="pending" && startDate===today() && endDate===today() ? "#fff" : "#f97316",
                border: "1.5px solid rgba(249,115,22,0.25)",
                boxShadow: filterStatus==="pending" && startDate===today() && endDate===today() ? "0 2px 8px rgba(249,115,22,0.3)" : "none",
              }}>
              ☀️ Hoje
            </button>
            <button
              onClick={() => {
                setFilterStatus("pending");
                setStartDate(today());
                const far = new Date(); far.setFullYear(far.getFullYear()+2);
                setEndDate(far.toISOString().split("T")[0]);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-black transition-all"
              style={{
                background: filterStatus==="pending" && startDate===today() && endDate > today() && endDate !== today() ? "linear-gradient(135deg,#5aaff5,#2b8be8)" : "rgba(43,139,232,0.09)",
                color: filterStatus==="pending" && startDate===today() && endDate > today() && endDate !== today() ? "#fff" : "#2b8be8",
                border: "1.5px solid rgba(43,139,232,0.25)",
                boxShadow: filterStatus==="pending" && startDate===today() && endDate > today() && endDate !== today() ? "0 2px 8px rgba(43,139,232,0.25)" : "none",
              }}>
              📋 Todas
            </button>
            <div className="w-px h-5 self-center" style={{ background:"rgba(203,213,225,0.6)" }}/>
            <input placeholder="🔍 Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-300 w-40" style={{ background:"rgba(255,255,255,0.9)" }}/>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-300" style={{ background:"rgba(255,255,255,0.9)" }}>
              <option value="all">Todos</option><option value="pending">Pendentes</option><option value="completed">Concluídos</option>
            </select>
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400">
              <option value="all">Todas Categorias</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterCtx} onChange={e => setFilterCtx(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400">
              <option value="all">Todos Contextos</option>
              {contexts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="p-4">
          {viewMode === "calendar" ? (
            <div>
              <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden border border-slate-200">
                {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map(d => <div key={d} className="bg-slate-50 py-2 text-center text-xs font-semibold text-slate-500">{d}</div>)}
                {calDays.map((day, i) => {
                  if (!day) return <div key={`e${i}`} className="bg-white min-h-[80px]" />;
                  const ds = `${calYear}-${String(calMon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayTasks = tasks.filter(t => t.dueDate === ds);
                  const isToday = ds === today();
                  return (
                    <div key={day} className="min-h-[80px] bg-white p-1.5 hover:bg-slate-50 cursor-pointer" onClick={() => { setStartDate(ds); setEndDate(ds); setViewMode("list"); }}>
                      <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? "bg-blue-500 text-white" : "text-slate-700"}`}>{day}</span>
                      {dayTasks.slice(0, 3).map(t => <div key={t.id} className={`text-[10px] truncate px-1 py-0.5 rounded mb-0.5 ${t.completed ? "bg-slate-100 text-slate-500 line-through" : "bg-indigo-50 text-indigo-700"}`}>{t.title}</div>)}
                      {dayTasks.length > 3 && <div className="text-[10px] text-slate-500 text-center">+{dayTasks.length - 3}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12 mx-auto text-slate-300 mb-3"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              <p>Nenhuma tarefa para este período.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(task => <TaskItem key={task.id} task={task} onToggle={() => toggleTaskCompletion(task.id)} onEdit={() => openTaskForm(task)} onDelete={() => deleteTask(task.id)} onUpdate={updateTask} categories={categories} contexts={contexts} teamUsers={teamUsers} currentProfile={currentProfile} compact={compactMode} onDuplicate={t => { const nt={...t,id:uid(),completed:false}; addTask(nt); }} />)}
            </div>
          )}
        </div>
      </div>

      {isFormOpen && (
        <Modal title={editing ? "Editar Tarefa" : "Nova Tarefa"} onClose={() => { setIsFormOpen(false); setEditing(null); }}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
              <div className="flex gap-2">
                <input value={tf.title} onChange={e=>setTf(p=>({...p,title:e.target.value}))} placeholder="Nome da tarefa..." className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
                <button type="button" onClick={isListening ? stopVoice : startVoice} title={isListening ? "Parar" : "Falar o título"}
                  className="flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{ background: isListening ? "linear-gradient(135deg,#ef4444,#dc2626)" : "#f0f4f8", color: isListening ? "#fff" : "#475569", minWidth:42, boxShadow: isListening ? "0 0 0 3px rgba(239,68,68,0.25)" : "none" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:16,height:16}}>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>
              </div>
              {isListening && <p className="text-xs text-red-500 mt-1 animate-pulse">🎙️ Ouvindo... fale o título da tarefa</p>}
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Descrição</label><textarea value={tf.description} onChange={e=>setTf(p=>({...p,description:e.target.value}))} rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Contexto</label>
                <select value={tf.contextId} onChange={e=>setTf(p=>({...p,contextId:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                  {contexts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                <select value={tf.categoryId} onChange={e=>setTf(p=>({...p,categoryId:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Data de Vencimento</label><input type="date" value={tf.dueDate} onChange={e=>setTf(p=>({...p,dueDate:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Cliente (Opcional)</label>
                <select value={tf.clientId} onChange={e=>setTf(p=>({...p,clientId:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                  <option value="">Nenhum</option>
                  {(clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {/* ── RECORRÊNCIA ── */}
            <div className="rounded-2xl overflow-hidden" style={{ border:"1px solid rgba(221,227,237,0.7)", background:"rgba(248,250,252,0.5)" }}>
              <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                <button type="button" onClick={()=>setTf(p=>({...p,isRecurring:!p.isRecurring,recurrenceType:!p.isRecurring?"weekly":null}))}
                  className="relative w-9 h-5 rounded-full transition-all flex-shrink-0"
                  style={{ background:tf.isRecurring?"linear-gradient(135deg,#5aaff5,#2b8be8)":"rgba(226,232,240,0.8)" }}>
                  <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                    style={{ left:tf.isRecurring?"calc(100% - 18px)":"2px" }}/>
                </button>
                <span className="text-sm font-semibold" style={{ color:"#374151" }}>↻ Tarefa Recorrente</span>
              </label>
              {tf.isRecurring && (
                <div className="px-4 pb-4 space-y-3 pt-0">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Frequência</label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        ["daily","📅 Diário"],["weekdays","💼 Dias úteis"],["weekly","📆 Semanal"],
                        ["biweekly","🗓 Quinzenal"],["monthly","📅 Mensal"],["yearly","🎯 Anual"],
                      ].map(([v,l]) => (
                        <button key={v} type="button" onClick={()=>setTf(p=>({...p,recurrenceType:v}))}
                          className="py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all"
                          style={{
                            background:tf.recurrenceType===v?"linear-gradient(135deg,#5aaff5,#2b8be8)":"rgba(255,255,255,0.8)",
                            color:tf.recurrenceType===v?"#fff":"#64748b",
                            border:tf.recurrenceType===v?"none":"1px solid rgba(226,232,240,0.7)"
                          }}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Repetir até (opcional)</label>
                    <input type="date" value={tf.recurrenceEndDate||""} onChange={e=>setTf(p=>({...p,recurrenceEndDate:e.target.value||null}))}
                      className="border rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-300"
                      style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.9)" }}/>
                  </div>
                  <p className="text-[10px]" style={{ color:"#94a3b8" }}>
                    ✓ Ao concluir, a próxima ocorrência é criada automaticamente
                  </p>
                </div>
              )}
            </div>

            {/* Responsável e visibilidade — só admin vê */}
            {currentProfile?.role === "admin" && teamUsers.length > 1 && (
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">👤 Responsável</label>
                  <select value={tf.assignedTo} onChange={e=>setTf(p=>({...p,assignedTo:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                    <option value="">Todos / Sem responsável</option>
                    {teamUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">👁️ Visibilidade</label>
                  <select value={tf.visibility} onChange={e=>setTf(p=>({...p,visibility:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                    <option value="all">Todos veem</option>
                    <option value="assigned">Somente responsável</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setIsFormOpen(false); setEditing(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button><button type="button" onClick={saveTask} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar</button></div>
          </div>
        </Modal>
      )}
      {isMultiOpen && (
        <Modal title="Adicionar Tarefas em Lote" onClose={() => { setIsMultiOpen(false); stopVoice(); }}>
          <div className="p-6 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-700">Tarefas (uma por linha)</label>
                <button type="button"
                  onClick={() => isListening ? stopVoice() : startVoice("multi")}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: isListening && voiceTarget==="multi" ? "linear-gradient(135deg,#ef4444,#dc2626)" : "linear-gradient(135deg,#5aaff5,#2b8be8)", color:"#fff", boxShadow: isListening && voiceTarget==="multi" ? "0 0 0 3px rgba(239,68,68,0.3)" : "0 2px 8px #2b8be840" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:13,height:13}}>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                  {isListening && voiceTarget==="multi" ? "Parar" : "Falar tarefa"}
                </button>
              </div>
              {isListening && voiceTarget==="multi" && (
                <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg" style={{background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:"#ef4444",display:"inline-block",animation:"pulse 1s infinite"}}></span>
                  <span className="text-xs text-red-500 font-medium">Ouvindo... fale o nome da tarefa e ela será adicionada à lista</span>
                </div>
              )}
              <textarea value={multiText} onChange={e=>setMultiText(e.target.value)} rows={6}
                placeholder={"Enviar e-mail para cliente\nRevisar folha de pagamento\nLigar para fornecedor"}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
              <p className="text-xs text-slate-500 mt-1">
                {multiText.split("\n").filter(l=>l.trim()).length > 0
                  ? `${multiText.split("\n").filter(l=>l.trim()).length} tarefa(s) para adicionar`
                  : "Digite ou fale as tarefas — uma por linha"}
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => { setIsMultiOpen(false); stopVoice(); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button type="button" onClick={saveMulti} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Adicionar</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── PAINEL CONCLUÍDOS ── */}
      {showDonePanel && (() => {
        const doneTasks = tasks.filter(t => t.completed && t.dueDate === doneFilterDate);
        const byCategory = categories.map(c => ({ ...c, count: doneTasks.filter(t => t.categoryId === c.id).length })).filter(c => c.count > 0);
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background:"rgba(26,29,35,0.6)", backdropFilter:"blur(6px)" }} onClick={e => e.target === e.currentTarget && setShowDonePanel(false)}>
            <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl" style={{ background:"#fff", border:"1px solid #dde3ed", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>

              {/* Header */}
              <div className="px-6 py-5 flex items-center justify-between flex-shrink-0" style={{ background:"linear-gradient(135deg,#f0fdf4,#dcfce7)", borderBottom:"1px solid #bbf7d0" }}>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" className="w-5 h-5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <h2 className="text-base font-black" style={{ color:"#14532d" }}>Tarefas Concluídas</h2>
                  </div>
                  <p className="text-xs" style={{ color:"#16a34a" }}>
                    <span className="font-black text-2xl" style={{ color:"#15803d" }}>{doneTasks.length}</span> tarefa{doneTasks.length !== 1 ? "s" : ""} concluída{doneTasks.length !== 1 ? "s" : ""} em {fmt(doneFilterDate)}
                  </p>
                </div>
                <button onClick={() => setShowDonePanel(false)} className="p-2 rounded-xl transition-colors" style={{ color:"#16a34a" }}
                  onMouseEnter={e => e.currentTarget.style.background="#bbf7d0"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  <Icon.X />
                </button>
              </div>

              {/* Date filter */}
              <div className="px-6 py-3 flex items-center gap-3 flex-shrink-0" style={{ borderBottom:"1px solid #f0f4f8", background:"#fafcff" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <input type="date" value={doneFilterDate} onChange={e => setDoneFilterDate(e.target.value)}
                  className="border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-green-400 outline-none"
                  style={{ borderColor:"#dde3ed", color:"#374151" }} />
                <button onClick={() => setDoneFilterDate(today())} className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors" style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" }}>Hoje</button>
                {doneTasks.length > 0 && (
                  <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full" style={{ background:"#dcfce7", color:"#15803d" }}>
                    {doneTasks.length} {doneTasks.length === 1 ? "tarefa" : "tarefas"}
                  </span>
                )}
              </div>

              {/* Category summary chips */}
              {byCategory.length > 0 && (
                <div className="px-6 py-2.5 flex flex-wrap gap-1.5 flex-shrink-0" style={{ borderBottom:"1px solid #f0f4f8" }}>
                  {byCategory.map(c => (
                    <span key={c.id} className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background:`${c.color}15`, color:c.color, border:`1px solid ${c.color}30` }}>
                      {c.name} · {c.count}
                    </span>
                  ))}
                </div>
              )}

              {/* Task list */}
              <div className="overflow-y-auto flex-1 p-4">
                {doneTasks.length === 0 ? (
                  <div className="text-center py-12">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                    <p className="text-sm font-medium" style={{ color:"#9ca3af" }}>Nenhuma tarefa concluída neste dia.</p>
                    <p className="text-xs mt-1" style={{ color:"#d1d5db" }}>Selecione outra data acima.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {doneTasks.map((task, idx) => {
                      const cat = categories.find(c => c.id === task.categoryId);
                      const ctx = contexts.find(c => c.id === task.contextId);
                      return (
                        <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background:"#f8fafc", border:"1px solid #e8f5e9", borderLeft:"3px solid #10b981" }}>
                          <svg viewBox="0 0 24 24" fill="#10b981" stroke="none" className="w-5 h-5 flex-shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" strokeWidth="2.5" fill="none"/></svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color:"#374151", textDecoration:"line-through", textDecorationColor:"#10b98180" }}>{task.title}</p>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {ctx && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background:`${ctx.color}15`, color:ctx.color }}>{ctx.name}</span>}
                              {cat && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background:`${cat.color}15`, color:cat.color }}>{cat.name}</span>}
                              {task.checklist?.length > 0 && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background:"#f0fdf4", color:"#16a34a" }}>
                                  ✓ {task.checklist.filter(i=>i.done).length}/{task.checklist.length}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] font-bold tabular-nums flex-shrink-0" style={{ color:"#9ca3af" }}>#{idx+1}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              {doneTasks.length > 0 && (
                <div className="px-6 py-4 flex-shrink-0" style={{ borderTop:"1px solid #f0f4f8", background:"#fafcff" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs" style={{ color:"#6b7280" }}>
                      {doneTasks.filter(t => t.checklist?.length > 0).length > 0 && `${doneTasks.filter(t => t.checklist?.length > 0).length} com checklist · `}
                      {doneTasks.filter(t => t.isRecurring).length > 0 && `${doneTasks.filter(t => t.isRecurring).length} recorrente(s)`}
                    </p>
                    <p className="text-xs font-bold" style={{ color:"#16a34a" }}>🎯 Ótimo trabalho!</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function QuickDropdown({ label, color, items, selectedId, onSelect, menuTitle }) {
  const [open, setOpen] = useState(false);
  const [portalPos, setPortalPos] = useState({ top:0, left:0, dropUp:false });
  const btnRef = useRef(null);
  const portalRef = useRef(null);

  // Fechar ao clicar FORA — usando mousedown mas ignorando cliques dentro do portal
  useEffect(() => {
    if (!open) return;
    const h = e => {
      const insideBtn = btnRef.current && btnRef.current.contains(e.target);
      const insidePortal = portalRef.current && portalRef.current.contains(e.target);
      if (!insideBtn && !insidePortal) setOpen(false);
    };
    // Usar mousedown com capture para pegar antes de tudo
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setPortalPos({
        left: rect.left,
        top: spaceBelow < 240 ? rect.top - 4 : rect.bottom + 4,
        dropUp: spaceBelow < 240,
      });
    }
    setOpen(v => !v);
  };

  const handleSelect = (id) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={e => e.stopPropagation()}
        onClick={handleOpen}
        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
        style={{
          color: color || "#64748b",
          background: color ? color + "18" : "#f1f5f9",
          border: "1px solid " + (color ? color + "30" : "#e2e8f0")
        }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color || "#64748b" }} />
        {label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5 opacity-50"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={portalRef}
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: "fixed",
            zIndex: 9999,
            left: portalPos.left,
            ...(portalPos.dropUp
              ? { bottom: window.innerHeight - portalPos.top }
              : { top: portalPos.top }),
            minWidth: 190,
            maxHeight: 260,
            overflowY: "auto",
            background: "rgba(255,255,255,0.99)",
            border: "1px solid rgba(221,227,237,0.9)",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(26,29,35,0.18)",
          }}>
          <div style={{ padding:"8px 12px 6px", borderBottom:"1px solid rgba(226,232,240,0.7)", position:"sticky", top:0, background:"rgba(255,255,255,0.99)" }}>
            <p style={{ fontSize:9, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.12em", color:"#94a3b8" }}>{menuTitle}</p>
          </div>
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
              onClick={() => handleSelect(item.id)}
              style={{
                width:"100%", textAlign:"left", padding:"9px 12px",
                fontSize:12, display:"flex", alignItems:"center", gap:10,
                cursor:"pointer", border:"none", outline:"none",
                background: selectedId===item.id ? (item.color||"#2b8be8")+"18" : "transparent",
                color: selectedId===item.id ? (item.color||"#2b8be8") : "#374151",
                fontWeight: selectedId===item.id ? 700 : 400,
              }}
              onMouseEnter={e=>{ if(selectedId!==item.id) e.currentTarget.style.background="#f8fafc"; }}
              onMouseLeave={e=>{ if(selectedId!==item.id) e.currentTarget.style.background="transparent"; }}>
              <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:item.color||"#64748b" }}/>
              <span style={{ flex:1 }}>{item.name}</span>
              {selectedId===item.id && (
                <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" style={{width:12,height:12}}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
function TaskItem({ task: taskProp, onToggle, onEdit, onDelete, onUpdate, categories, contexts, teamUsers, currentProfile, compact, onDuplicate }) {
  const { tasks, addTask } = useApp();
  // Sempre ler do estado global para evitar stale closure
  const task = tasks.find(t => t.id === taskProp.id) || taskProp;

  const subtasks = tasks.filter(t => t.parentId === task.id);
  const subtasksDone = subtasks.filter(t => t.completed).length;

  const cat = categories.find(c => c.id === task.categoryId);
  const ctx = contexts.find(c => c.id === task.contextId);
  const od = isOverdue(task.dueDate, task.completed);
  const assignedUser = (teamUsers||[]).find(u => u.id === task.assignedTo);
  const isAdmin = currentProfile?.role === "admin" || !currentProfile;
  const isColab = currentProfile?.role === "colaborador";
  const canAssign = isAdmin || (isColab && currentProfile?.canCreateTasks);

  const [showAssign, setShowAssign] = useState(false);
  const [assignPos, setAssignPos] = useState({ top:0, left:0, dropUp:false });
  const [showDetail, setShowDetail] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [datePos, setDatePos] = useState({ top:0, left:0 });
  const [showSubForm, setShowSubForm] = useState(false);
  const [subTitle, setSubTitle] = useState("");
  const assignRef = useRef(null);
  const dateRef = useRef(null);

  useEffect(() => { setCommentText(task.description||""); }, [task.id]);

  // Fechar assign ao clicar fora
  useEffect(() => {
    if (!showAssign) return;
    const h = e => {
      const inBtn = assignRef.current?.contains(e.target);
      const inPortal = document.getElementById("assign-portal-"+task.id)?.contains(e.target);
      if (!inBtn && !inPortal) setShowAssign(false);
    };
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, [showAssign]);

  // Fechar date ao clicar fora
  useEffect(() => {
    if (!editingDate) return;
    const h = e => {
      const inBtn = dateRef.current?.contains(e.target);
      const inPortal = document.getElementById("date-portal-"+task.id)?.contains(e.target);
      if (!inBtn && !inPortal) setEditingDate(false);
    };
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, [editingDate]);

  // Atualização segura — sempre parte do estado mais fresco
  const safeUpdate = (patch) => {
    const fresh = tasks.find(t => t.id === taskProp.id) || task;
    onUpdate({ ...fresh, ...patch });
  };

  const handleAssignOpen = () => {
    if (!canAssign || !assignRef.current) return;
    const rect = assignRef.current.getBoundingClientRect();
    const dropUp = window.innerHeight - rect.bottom < 240;
    setAssignPos({ left:rect.left, top:dropUp ? rect.top-8 : rect.bottom+6, dropUp });
    setShowAssign(v => !v);
  };

  const handleDateOpen = () => {
    if (!dateRef.current) return;
    const rect = dateRef.current.getBoundingClientRect();
    const dropUp = window.innerHeight - rect.bottom < 180;
    setDatePos({ left:rect.left, top:dropUp ? rect.top-8 : rect.bottom+6 });
    setEditingDate(v => !v);
  };

  const addSubtask = async () => {
    if (!subTitle.trim()) return;
    const sub = {
      id: uid(), title: subTitle.trim(), description:"",
      categoryId: task.categoryId, contextId: task.contextId,
      clientId: task.clientId, dueDate: task.dueDate,
      completed: false, isRecurring: false, recurrenceType: null,
      recurrenceEndDate: null, checklist:[], assignedTo: task.assignedTo,
      visibility: task.visibility, parentId: task.id
    };
    await addTask(sub);
    setSubTitle(""); setShowSubForm(false);
  };

  const borderColor = od && !task.completed ? "rgba(254,202,202,0.9)" : task.completed ? "rgba(226,232,240,0.5)" : "rgba(221,227,237,0.7)";
  const bg = od && !task.completed ? "rgba(255,245,245,0.95)" : task.completed ? "rgba(248,250,252,0.7)" : "rgba(255,255,255,0.98)";

  // ── MODO COMPACTO ──────────────────────────────────────
  if (compact) {
    return (
      <div className="group flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150"
        style={{ background:bg, border:`1px solid ${borderColor}`, boxShadow:"0 1px 3px rgba(26,29,35,0.04)" }}>
        <button onClick={()=>onToggle(task.id)} className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          style={{ borderColor:task.completed?"#10b981":od?"#ef4444":"#d1d5db", background:task.completed?"#10b981":"transparent" }}>
          {task.completed && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" style={{width:7,height:7}}><polyline points="20 6 9 17 4 12"/></svg>}
        </button>
        {cat && <div className="w-1 h-3 rounded-full flex-shrink-0" style={{ background:cat.color, opacity:0.8 }}/>}
        <p className={"flex-1 text-xs font-medium truncate "+(task.completed?"line-through opacity-40":"")} style={{ color:od&&!task.completed?"#dc2626":"#1a1d23" }}>{task.title}</p>
        {subtasks.length > 0 && <span className="text-[10px]" style={{ color:"#94a3b8" }}>{subtasksDone}/{subtasks.length}</span>}
        {task.dueDate && <span className="text-[10px] font-medium flex-shrink-0" style={{ color:od&&!task.completed?"#ef4444":"#94a3b8" }}>{new Date(task.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
        {assignedUser && <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black text-white flex-shrink-0" style={{ background:assignedUser.avatarColor||"#2b8be8" }}>{assignedUser.name.charAt(0)}</div>}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
          {!task.completed && <button onClick={()=>onToggle(task.id)} className="p-1 rounded" style={{ color:"#94a3b8" }} onMouseEnter={e=>e.currentTarget.style.color="#10b981"} onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width:11,height:11}}><polyline points="20 6 9 17 4 12"/></svg></button>}
          <button onClick={onEdit} className="p-1 rounded" style={{ color:"#94a3b8" }} onMouseEnter={e=>e.currentTarget.style.color="#2b8be8"} onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}><Icon.Edit /></button>
          <button onClick={onDelete} className="p-1 rounded" style={{ color:"#94a3b8" }} onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}><Icon.Trash /></button>
        </div>
      </div>
    );
  }

  // ── MODO NORMAL ────────────────────────────────────────
  return (
    <div className="group rounded-2xl transition-all duration-200"
      style={{ background:bg, border:`1px solid ${borderColor}`, boxShadow:od&&!task.completed?"0 2px 12px rgba(239,68,68,0.06)":"0 2px 12px rgba(26,29,35,0.04)", backdropFilter:"blur(8px)" }}
      onMouseEnter={e=>{e.currentTarget.style.boxShadow=od&&!task.completed?"0 4px 20px rgba(239,68,68,0.1)":"0 4px 20px rgba(26,29,35,0.08)";e.currentTarget.style.transform="translateY(-1px)";}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow=od&&!task.completed?"0 2px 12px rgba(239,68,68,0.06)":"0 2px 12px rgba(26,29,35,0.04)";e.currentTarget.style.transform="translateY(0)";}}>

      <div className="flex">
        {cat && <div className="w-1 rounded-l-2xl flex-shrink-0" style={{ background:cat.color, opacity:task.completed?0.25:0.75 }}/>}
        <div className="flex-1 px-4 py-3">

          {/* ── ROW PRINCIPAL ── */}
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Checkbox */}
            <button onClick={()=>onToggle(task.id)} className="rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
              style={{ width:18,height:18, borderColor:task.completed?"#10b981":od?"#ef4444":"#d1d5db", background:task.completed?"#10b981":"transparent" }}>
              {task.completed && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" style={{width:9,height:9}}><polyline points="20 6 9 17 4 12"/></svg>}
            </button>

            {/* Título */}
            <p className={"text-sm font-semibold flex-shrink-0 max-w-xs truncate "+(task.completed?"line-through opacity-40":"")}
              style={{ color:od&&!task.completed?"#dc2626":"#1a1d23" }}>{task.title}</p>

            {/* Badge subtarefas */}
            {subtasks.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background:subtasksDone===subtasks.length?"rgba(16,185,129,0.12)":"rgba(226,232,240,0.6)", color:subtasksDone===subtasks.length?"#10b981":"#94a3b8" }}>
                {subtasksDone}/{subtasks.length}
              </span>
            )}

            {/* Categoria */}
            <QuickDropdown label={cat?.name||"Categoria"} color={cat?.color||"#94a3b8"} items={categories} selectedId={task.categoryId}
              onSelect={v=>safeUpdate({categoryId:v})} menuTitle="Categoria"/>

            {/* Contexto */}
            <QuickDropdown label={ctx?.name||"Contexto"} color={ctx?.color||"#94a3b8"} items={contexts} selectedId={task.contextId}
              onSelect={v=>safeUpdate({contextId:v})} menuTitle="Contexto"/>

            {/* ── DATA — portal com id único ── */}
            <div ref={dateRef} className="relative flex-shrink-0">
              <button onMouseDown={e=>e.stopPropagation()} onClick={handleDateOpen}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full transition-all"
                style={{ background:"rgba(226,232,240,0.5)", color:od&&!task.completed?"#dc2626":"#64748b", border:"1px solid rgba(203,213,225,0.4)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:10,height:10}}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                {task.dueDate ? new Date(task.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}) : "Prazo"}
              </button>
              {editingDate && createPortal(
                <div id={"date-portal-"+task.id} onMouseDown={e=>e.stopPropagation()}
                  style={{ position:"fixed", zIndex:9999, left:datePos.left, top:datePos.top, background:"rgba(255,255,255,0.99)", border:"1px solid rgba(221,227,237,0.9)", borderRadius:12, boxShadow:"0 8px 32px rgba(26,29,35,0.16)", padding:14, minWidth:210 }}>
                  <p style={{ fontSize:9, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.1em", color:"#94a3b8", marginBottom:8 }}>Alterar prazo</p>
                  <input type="date" defaultValue={task.dueDate||""}
                    autoFocus
                    onChange={e=>{ safeUpdate({dueDate:e.target.value}); setEditingDate(false); }}
                    style={{ width:"100%", border:"1px solid rgba(221,227,237,0.8)", borderRadius:8, padding:"6px 10px", fontSize:13, outline:"none" }}/>
                  <button onMouseDown={e=>{e.stopPropagation(); safeUpdate({dueDate:""}); setEditingDate(false);}}
                    style={{ marginTop:8, width:"100%", fontSize:11, color:"#ef4444", background:"transparent", border:"none", cursor:"pointer" }}>
                    Remover prazo
                  </button>
                </div>, document.body
              )}
            </div>

            {/* ── RESPONSÁVEL — portal com id único ── */}
            {(teamUsers||[]).length > 0 && (
              <div ref={assignRef} className="relative flex-shrink-0">
                <button type="button" onMouseDown={e=>e.stopPropagation()} onClick={handleAssignOpen}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full transition-all"
                  style={assignedUser
                    ? { background:assignedUser.avatarColor+"18", color:assignedUser.avatarColor, border:"1px solid "+assignedUser.avatarColor+"30", cursor:canAssign?"pointer":"default" }
                    : { background:"rgba(241,245,249,0.7)", color:"#94a3b8", border:"1px solid rgba(226,232,240,0.6)", cursor:canAssign?"pointer":"default" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:10,height:10}}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  {assignedUser ? assignedUser.name.split(" ")[0] : "Atribuir"}
                  {canAssign && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width:7,height:7,opacity:0.4}}><polyline points="6 9 12 15 18 9"/></svg>}
                </button>
                {showAssign && canAssign && createPortal(
                  <div id={"assign-portal-"+task.id} onMouseDown={e=>e.stopPropagation()}
                    style={{ position:"fixed", zIndex:9999, left:assignPos.left, top:assignPos.top, background:"rgba(255,255,255,0.99)", border:"1px solid rgba(221,227,237,0.9)", borderRadius:12, boxShadow:"0 8px 32px rgba(26,29,35,0.16)", minWidth:200, overflow:"hidden" }}>
                    <p style={{ fontSize:9, fontWeight:900, textTransform:"uppercase", letterSpacing:"0.12em", color:"#94a3b8", padding:"10px 14px 6px" }}>Atribuir responsável</p>
                    <button type="button" onMouseDown={e=>e.stopPropagation()}
                      onClick={()=>{ safeUpdate({assignedTo:null}); setShowAssign(false); }}
                      style={{ width:"100%", textAlign:"left", padding:"9px 14px", fontSize:12, display:"flex", alignItems:"center", gap:10, cursor:"pointer", background:"transparent", border:"none", color:"#94a3b8" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{ width:22, height:22, borderRadius:"50%", border:"2px dashed #cbd5e1", flexShrink:0 }}/>
                      Sem responsável
                    </button>
                    {(teamUsers||[]).filter(u=>u.active!==false).map(u=>(
                      <button key={u.id} type="button" onMouseDown={e=>e.stopPropagation()}
                        onClick={()=>{ safeUpdate({assignedTo:u.id}); setShowAssign(false); }}
                        style={{ width:"100%", textAlign:"left", padding:"9px 14px", fontSize:12, display:"flex", alignItems:"center", gap:10, cursor:"pointer", background:u.id===task.assignedTo?(u.avatarColor||"#2b8be8")+"15":"transparent", border:"none" }}
                        onMouseEnter={e=>{ if(u.id!==task.assignedTo) e.currentTarget.style.background="#f8fafc"; }}
                        onMouseLeave={e=>{ if(u.id!==task.assignedTo) e.currentTarget.style.background="transparent"; }}>
                        <div style={{ width:22, height:22, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900, color:"#fff", background:u.avatarColor||"#2b8be8", flexShrink:0 }}>{u.name.charAt(0)}</div>
                        <span style={{ color:"#374151", fontWeight:u.id===task.assignedTo?700:400, flex:1 }}>{u.name}</span>
                        {u.id===task.assignedTo && <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" style={{width:12,height:12}}><polyline points="20 6 9 17 4 12"/></svg>}
                      </button>
                    ))}
                  </div>, document.body
                )}
              </div>
            )}

            {task.isRecurring && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background:"rgba(219,234,254,0.6)", color:"#2b8be8" }}>↻</span>}
            <div className="flex-1"/>

            {/* Quick actions */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
              {!task.completed && (
                <button onClick={()=>onToggle(task.id)} title="Concluir" className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(16,185,129,0.1)";e.currentTarget.style.color="#10b981";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width:13,height:13}}><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              )}
              {/* Subtarefa */}
              <button onClick={()=>setShowSubForm(v=>!v)} title="Adicionar subtarefa"
                className="p-1.5 rounded-lg transition-all" style={{ color:showSubForm?"#a855f7":"#94a3b8", background:showSubForm?"rgba(168,85,247,0.1)":"transparent" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(168,85,247,0.1)";e.currentTarget.style.color="#a855f7";}}
                onMouseLeave={e=>{ if(!showSubForm){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:13,height:13}}>
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
              <button onClick={()=>{setShowDetail(v=>!v);setShowComment(false);}} title="Detalhes"
                className="p-1.5 rounded-lg transition-all"
                style={{ color:showDetail?"#2b8be8":"#94a3b8", background:showDetail?"rgba(43,139,232,0.08)":"transparent" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
                onMouseLeave={e=>{ if(!showDetail){e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:13,height:13}}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
              {onDuplicate && (
                <button onClick={()=>onDuplicate(task)} title="Duplicar" className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                  onMouseEnter={e=>{e.currentTarget.style.background="rgba(100,116,139,0.08)";e.currentTarget.style.color="#64748b";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:13,height:13}}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
              )}
              <button onClick={onEdit} title="Editar" className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
                onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                <Icon.Edit />
              </button>
              <button onClick={onDelete} title="Excluir" className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.07)";e.currentTarget.style.color="#ef4444";}}
                onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                <Icon.Trash />
              </button>
            </div>
          </div>

          {/* ── FORM SUBTAREFA ── */}
          {showSubForm && (
            <div className="mt-2.5 flex items-center gap-2 pl-6">
              <div className="w-4 h-4 flex-shrink-0 flex items-end pb-1">
                <svg viewBox="0 0 16 16" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{width:12,height:12}}>
                  <path d="M2 2v8h10"/>
                </svg>
              </div>
              <input
                value={subTitle}
                onChange={e=>setSubTitle(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") addSubtask(); if(e.key==="Escape") setShowSubForm(false); }}
                placeholder="Nome da subtarefa... (Enter para salvar)"
                autoFocus
                className="flex-1 text-xs border rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-purple-300"
                style={{ borderColor:"rgba(168,85,247,0.3)", background:"rgba(168,85,247,0.04)" }}/>
              <button onClick={addSubtask} className="text-xs font-bold px-2.5 py-1.5 text-white rounded-xl"
                style={{ background:"linear-gradient(135deg,#c084fc,#a855f7)" }}>+ Sub</button>
              <button onClick={()=>setShowSubForm(false)} className="text-xs text-slate-400 hover:text-slate-600 px-1">✕</button>
            </div>
          )}

          {/* ── SUBTAREFAS ── */}
          {subtasks.length > 0 && (
            <div className="mt-2 space-y-1 pl-6">
              {subtasks.map(sub => (
                <div key={sub.id} className="flex items-center gap-2 group/sub py-1 px-2 rounded-lg transition-all"
                  style={{ background:"rgba(248,250,252,0.7)" }}>
                  <div className="w-3 flex-shrink-0">
                    <svg viewBox="0 0 10 10" fill="none" stroke="#cbd5e1" strokeWidth="1.5" style={{width:10,height:10}}>
                      <path d="M1 1v5h7"/>
                    </svg>
                  </div>
                  <button onClick={()=>{ const fresh=tasks.find(t=>t.id===sub.id)||sub; onUpdate({...fresh,completed:!fresh.completed}); }}
                    className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{ borderColor:sub.completed?"#10b981":"#d1d5db", background:sub.completed?"#10b981":"transparent" }}>
                    {sub.completed && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" style={{width:7,height:7}}><polyline points="20 6 9 17 4 12"/></svg>}
                  </button>
                  <span className={"flex-1 text-xs "+(sub.completed?"line-through opacity-40":"")} style={{ color:"#374151" }}>{sub.title}</span>
                  <button onClick={()=>onDelete(sub.id)} className="opacity-0 group-hover/sub:opacity-100 p-0.5 rounded transition-all" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:11,height:11}}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  </button>
                </div>
              ))}
              {/* Progresso das subtarefas */}
              <div className="flex items-center gap-2 pl-5 pt-0.5">
                <div className="flex-1 h-1 rounded-full" style={{ background:"rgba(226,232,240,0.5)" }}>
                  <div className="h-1 rounded-full transition-all" style={{ width:`${subtasks.length>0?Math.round(subtasksDone/subtasks.length*100):0}%`, background:"#10b981" }}/>
                </div>
                <span className="text-[9px] font-bold" style={{ color:"#94a3b8" }}>{subtasksDone}/{subtasks.length}</span>
              </div>
            </div>
          )}

          {/* ── ÁREA EXPANDÍVEL ── */}
          {showDetail && (
            <div className="mt-2.5 pt-2.5 space-y-2" style={{ borderTop:"1px solid rgba(226,232,240,0.5)" }}>
              {showComment ? (
                <div className="space-y-2">
                  <textarea value={commentText} onChange={e=>setCommentText(e.target.value)} rows={2} autoFocus
                    placeholder="Descrição ou anotação..."
                    className="w-full border rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(248,250,252,0.8)" }}/>
                  <div className="flex gap-2">
                    <button onClick={()=>{ safeUpdate({description:commentText}); setShowComment(false); }} className="px-3 py-1.5 text-white rounded-lg text-xs font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar</button>
                    <button onClick={()=>setShowComment(false)} className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg text-xs">Cancelar</button>
                  </div>
                </div>
              ) : (
                <div onClick={()=>setShowComment(true)} className="cursor-text rounded-xl px-3 py-2 transition-all"
                  style={{ background:"rgba(248,250,252,0.7)", border:"1px dashed rgba(203,213,225,0.6)", minHeight:36 }}>
                  {task.description
                    ? <p className="text-xs" style={{ color:"#374151" }}>{task.description}</p>
                    : <p className="text-xs" style={{ color:"#cbd5e1" }}>Clique para adicionar descrição...</p>}
                </div>
              )}
              {task.checklist && task.checklist.length > 0 && (
                <div className="space-y-1">
                  {task.checklist.map((item,i)=>(
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={item.done}
                        onChange={()=>{ const cl=[...task.checklist]; cl[i]={...cl[i],done:!cl[i].done}; safeUpdate({checklist:cl}); }}
                        className="rounded w-3 h-3 flex-shrink-0"/>
                      <span style={{ color:item.done?"#94a3b8":"#374151", textDecoration:item.done?"line-through":"none" }}>{item.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}





// ============================================================
// HABITS
// ============================================================

// Calcula streak atual (dias consecutivos até hoje)
function calcStreak(completedDates, freq, freqDays) {
  if (!completedDates?.length) return 0;
  const sorted = [...completedDates].sort().reverse();
  const t = today();
  let streak = 0;
  let cursor = new Date(t);
  // Para hábitos diários: verifica dias consecutivos
  // Para outros: verifica semanas
  if (freq === "daily") {
    while (true) {
      const ds = cursor.toISOString().split("T")[0];
      if (completedDates.includes(ds)) { streak++; cursor.setDate(cursor.getDate() - 1); }
      else if (ds === t) { cursor.setDate(cursor.getDate() - 1); } // hoje ainda não marcado, tudo bem
      else break;
    }
  } else {
    // conta apenas dias marcados dos últimos 90 dias
    streak = completedDates.filter(d => d >= new Date(Date.now() - 90*864e5).toISOString().split("T")[0]).length;
  }
  return streak;
}

// Verifica se o hábito é esperado num dado date baseado na frequência
function isExpectedDay(date, freq, freqDays) {
  if (freq === "daily") return true;
  if (freq === "weekly_days") {
    const dow = new Date(date + "T12:00:00").getDay(); // 0=dom
    return (freqDays || []).includes(dow);
  }
  return true;
}

function HabitCalendarModal({ habit, onClose, onToggle, categories }) {
  const [month, setMonth] = useState(new Date());
  const cat = categories.find(c => c.id === habit.categoryId);
  const y = month.getFullYear(), m = month.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  const t = today();
  const streak = calcStreak(habit.completedDates, habit.freq, habit.freqDays);
  const monthDone = (habit.completedDates || []).filter(d => d.startsWith(`${y}-${String(m+1).padStart(2,"0")}`)).length;
  const expectedInMonth = cells.filter(d => d && isExpectedDay(`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`, habit.freq, habit.freqDays) && `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}` <= t).length;
  const rate = expectedInMonth > 0 ? Math.round((monthDone / expectedInMonth) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:"rgba(26,29,35,0.6)", backdropFilter:"blur(6px)" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{ background:"#fff", border:"1px solid #dde3ed" }}>
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ background:"linear-gradient(135deg,#eff6ff,#dbeafe)", borderBottom:"1px solid #bfdbfe" }}>
          <div>
            <p className="text-base font-black" style={{ color:"#1a1d23" }}>{habit.title}</p>
            {cat && <p className="text-xs font-semibold mt-0.5" style={{ color: cat.color }}>{cat.name}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color:"#64748b" }}><Icon.X /></button>
        </div>
        {/* Stats row */}
        <div className="grid grid-cols-3 divide-x" style={{ borderBottom:"1px solid #e8edf5" }}>
          <div className="py-3 text-center">
            <p className="text-xl font-black" style={{ color: streak >= 7 ? "#f59e0b" : "#1a1d23" }}>{streak >= 1 ? "🔥" : ""} {streak}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color:"#94a3b8" }}>Streak</p>
          </div>
          <div className="py-3 text-center">
            <p className="text-xl font-black" style={{ color:"#2b8be8" }}>{monthDone}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color:"#94a3b8" }}>Este mês</p>
          </div>
          <div className="py-3 text-center">
            <p className="text-xl font-black" style={{ color: rate >= 80 ? "#10b981" : rate >= 50 ? "#f59e0b" : "#ef4444" }}>{rate}%</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color:"#94a3b8" }}>Taxa</p>
          </div>
        </div>
        {/* Month nav */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom:"1px solid #f0f4f8" }}>
          <button onClick={() => { const d = new Date(month); d.setMonth(d.getMonth()-1); setMonth(d); }} className="p-1.5 rounded-lg hover:bg-slate-100"><Icon.ChevronLeft /></button>
          <span className="text-sm font-bold capitalize" style={{ color:"#1a1d23" }}>{month.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</span>
          <button onClick={() => { const d = new Date(month); d.setMonth(d.getMonth()+1); setMonth(d); }} className="p-1.5 rounded-lg hover:bg-slate-100"><Icon.ChevronRight /></button>
        </div>
        {/* Calendar grid */}
        <div className="p-4">
          <div className="grid grid-cols-7 mb-1">
            {["D","S","T","Q","Q","S","S"].map((d,i) => <div key={i} className="text-center text-[10px] font-bold py-1" style={{ color:"#94a3b8" }}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} />;
              const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const done = (habit.completedDates||[]).includes(ds);
              const isToday = ds === t;
              const isFuture = ds > t;
              const expected = isExpectedDay(ds, habit.freq, habit.freqDays);
              return (
                <button key={day} type="button" disabled={isFuture} onClick={() => onToggle(habit.id, ds)}
                  className="aspect-square rounded-lg flex items-center justify-center text-xs font-semibold transition-all"
                  style={{
                    background: done ? "#2b8be8" : isToday ? "#dbeafe" : expected && !isFuture ? "#f5f7fb" : "transparent",
                    color: done ? "#fff" : isToday ? "#2b8be8" : isFuture ? "#d1d5db" : expected ? "#374151" : "#cbd5e1",
                    border: isToday && !done ? "2px solid #2b8be8" : "2px solid transparent",
                    opacity: isFuture ? 0.4 : 1,
                    cursor: isFuture ? "default" : "pointer",
                  }}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>
        {/* Legend */}
        <div className="px-4 pb-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded" style={{ background:"#2b8be8" }} /><span className="text-[10px]" style={{ color:"#64748b" }}>Feito</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded" style={{ background:"#f5f7fb", border:"1px solid #dde3ed" }} /><span className="text-[10px]" style={{ color:"#64748b" }}>Esperado</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded" style={{ background:"#dbeafe", border:"2px solid #2b8be8" }} /><span className="text-[10px]" style={{ color:"#64748b" }}>Hoje</span></div>
        </div>
      </div>
    </div>
  );
}

// ── HabitCard standalone (fora do Habits para evitar recriação) ──────────
function HabitCard({ habitId, onToggle, onEdit, onDelete }) {
  const { habits } = useApp();
  const h = (habits||[]).find(x => x.id === habitId);
  if (!h) return null;

  const t = today();

  const getStreak = () => {
    const dates = [...(h.completedDates||[])].sort();
    if (!dates.length) return 0;
    let streak = 0;
    let check = new Date(); check.setHours(0,0,0,0);
    for (let i = 0; i < 400; i++) {
      const ds = check.toISOString().split("T")[0];
      if (dates.includes(ds)) { streak++; check.setDate(check.getDate()-1); }
      else { if (ds === t && streak === 0) { check.setDate(check.getDate()-1); continue; } break; }
    }
    return streak;
  };

  const getBestStreak = () => {
    const dates = [...(h.completedDates||[])].sort();
    if (!dates.length) return 0;
    let best = 0, cur = 1;
    for (let i=1; i<dates.length; i++) {
      const d1 = new Date(dates[i-1]+"T12:00:00"), d2 = new Date(dates[i]+"T12:00:00");
      if ((d2-d1)/(1000*60*60*24) === 1) { cur++; best = Math.max(best,cur); } else cur = 1;
    }
    return Math.max(best, cur);
  };

  const getConsistency = () => {
    const dates = h.completedDates||[];
    if (!dates.length) return 0;
    const d30 = new Date(); d30.setDate(d30.getDate()-30);
    const d30s = d30.toISOString().split("T")[0];
    let expected = 0;
    for (let i=0; i<30; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const dow = d.getDay();
      const ds = d.toISOString().split("T")[0];
      if (ds <= t) {
        if (h.freq === "weekly" && h.freqDays?.length) { if (h.freqDays.includes(dow)) expected++; }
        else expected++;
      }
    }
    if (expected === 0) return 0;
    return Math.round(dates.filter(d => d >= d30s).length / expected * 100);
  };

  const streak = getStreak();
  const best = getBestStreak();
  const consistency = getConsistency();
  const done = (h.completedDates||[]).includes(t);
  const diffColors = { 1:"#10b981", 2:"#f59e0b", 3:"#ef4444" };

  const last7 = Array.from({length:7}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-6+i);
    const ds = d.toISOString().split("T")[0];
    return { date:ds, done:(h.completedDates||[]).includes(ds), isToday:ds===t, day:d.toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","") };
  });

  const heatmap = Array.from({length:84}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-(83-i));
    const ds = d.toISOString().split("T")[0];
    return { date:ds, done:(h.completedDates||[]).includes(ds) };
  });

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl overflow-hidden transition-all duration-300 group"
      style={{
        background: done ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.95)",
        border: done ? `1.5px solid ${h.color||"#2b8be8"}30` : "1px solid rgba(221,227,237,0.7)",
        boxShadow: done ? `0 4px 24px ${h.color||"#2b8be8"}12` : "0 4px 16px rgba(26,29,35,0.04)",
        backdropFilter: "blur(8px)",
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=done?`0 8px 32px ${h.color||"#2b8be8"}18`:"0 8px 28px rgba(26,29,35,0.08)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow=done?`0 4px 24px ${h.color||"#2b8be8"}12`:"0 4px 16px rgba(26,29,35,0.04)";}}>

      {/* Barra de progresso streak */}
      <div className="h-0.5" style={{ background:`linear-gradient(90deg,${h.color||"#2b8be8"},${h.color||"#2b8be8"}66)`, width:`${Math.min(streak/Math.max(h.targetStreak||21,1)*100,100)}%`, transition:"width 0.6s ease" }}/>

      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Botão check — chama onToggle com o id */}
          <button
            onClick={() => onToggle(h.id)}
            className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all duration-200"
            style={{
              background: done ? `linear-gradient(135deg,${h.color||"#2b8be8"},${h.color||"#2b8be8"}cc)` : `${h.color||"#2b8be8"}12`,
              border: done ? "none" : `1.5px solid ${h.color||"#2b8be8"}30`,
              boxShadow: done ? `0 4px 12px ${h.color||"#2b8be8"}40` : "none",
              transform: done ? "scale(1.08)" : "scale(1)",
            }}>
            {done
              ? <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" style={{width:20,height:20}}><polyline points="20 6 9 17 4 12"/></svg>
              : <span>{h.emoji||"⭐"}</span>}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{h.title}</p>
              {h.isFavorite && <span style={{ color:"#f59e0b" }}>★</span>}
              {h.identity && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background:`${h.color||"#2b8be8"}15`, color:h.color||"#2b8be8", border:`1px solid ${h.color||"#2b8be8"}25` }}>
                  {h.identity}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              {streak > 0 && <span className="flex items-center gap-1 font-bold" style={{ color:streak>=7?"#f59e0b":"#94a3b8" }}>🔥 {streak} {streak===1?"dia":"dias"}</span>}
              <span className="flex items-center gap-1" style={{ color:"#94a3b8" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:10,height:10}}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                {consistency}%
              </span>
              {best > 0 && <span style={{ color:"#94a3b8" }}>🏆 {best}</span>}
              {h.freq === "weekly" && h.freqDays && h.freqDays.length < 7 ? (
                <span className="flex items-center gap-0.5 text-[10px]" style={{ color:"#94a3b8" }}>
                  {["D","S","T","Q","Q","S","S"].map((d,i) => (
                    <span key={i} className="w-3.5 h-3.5 rounded-sm flex items-center justify-center font-bold"
                      style={{ background:h.freqDays.includes(i)?(h.color||"#2b8be8")+"22":"transparent", color:h.freqDays.includes(i)?(h.color||"#2b8be8"):"#d1d5db", fontSize:8 }}>
                      {d}
                    </span>
                  ))}
                </span>
              ) : <span className="text-[10px] font-medium" style={{ color:"#94a3b8" }}>📅 Diário</span>}
              <span style={{ color:diffColors[h.difficulty||2], fontSize:9, fontWeight:700, textTransform:"uppercase" }}>
                {h.difficulty===1?"Fácil":h.difficulty===3?"Difícil":"Médio"}
              </span>
            </div>
            {/* Mini dots 7 dias — clicáveis para marcar dias anteriores */}
            <div className="flex items-center gap-1 mt-2">
              {last7.map((d,i) => (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    title={d.done ? `Desmarcar ${d.date}` : `Marcar ${d.date}`}
                    onClick={() => onToggle(h.id, d.date)}
                    className="w-5 h-5 rounded-md transition-all"
                    style={{
                      background: d.done
                        ? (d.isToday ? `linear-gradient(135deg,${h.color||"#2b8be8"},${h.color||"#2b8be8"}cc)` : h.color||"#2b8be8")
                        : d.isToday ? `${h.color||"#2b8be8"}18` : "rgba(226,232,240,0.5)",
                      border: d.isToday ? `1.5px solid ${h.color||"#2b8be8"}60` : "1px solid transparent",
                      cursor: "pointer",
                      boxShadow: d.done ? `0 1px 4px ${h.color||"#2b8be8"}40` : "none",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform="scale(1.2)"; e.currentTarget.style.borderColor=h.color||"#2b8be8"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.borderColor=d.isToday?`${h.color||"#2b8be8"}60`:"transparent"; }}
                  />
                  <span className="text-[8px]" style={{ color:d.isToday?"#1a1d23":"#cbd5e1", fontWeight:d.isToday?700:400 }}>
                    {d.day}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
            <button onClick={()=>setExpanded(v=>!v)} className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:14,height:14}}><polyline points={expanded?"18 15 12 9 6 15":"6 9 12 15 18 9"}/></svg>
            </button>
            <button onClick={()=>onEdit(h)} className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
              <Icon.Edit />
            </button>
            <button onClick={()=>onDelete(h.id)} className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)";e.currentTarget.style.color="#ef4444";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
              <Icon.Trash />
            </button>
          </div>
        </div>

        {/* Expandido: heatmap */}
        {expanded && (
          <div className="mt-4 pt-4" style={{ borderTop:"1px solid rgba(226,232,240,0.5)" }}>
            {h.description && <p className="text-xs mb-3" style={{ color:"#64748b" }}>{h.description}</p>}
            <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Mapa de calor — 12 semanas</p>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {Array.from({length:12}, (_,w) => (
                <div key={w} className="flex flex-col gap-1">
                  {Array.from({length:7}, (_,d) => {
                    const cell = heatmap[w*7+d];
                    return cell ? (
                      <div key={d} className="w-3 h-3 rounded-sm"
                        style={{ background:cell.done?h.color||"#2b8be8":"rgba(226,232,240,0.5)", opacity:cell.done?1:0.6 }}
                        title={cell.date}/>
                    ) : null;
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 text-[10px]" style={{ color:"#94a3b8" }}>
              <span>{(h.completedDates||[]).length} execuções totais</span>
              <span>Alvo: {h.targetStreak||21} dias</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function Habits() {
  const { habits, addHabit, updateHabit, deleteHabit, toggleHabitCompletion, categories, currentProfile } = useApp();
  const [view, setView] = useState("dashboard"); // dashboard | list | identity | insights
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);
  const [aiInsight, setAiInsight] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [filterIdentity, setFilterIdentity] = useState("all");
  const [filterTime, setFilterTime] = useState("all");

  const t = today();
  const now = new Date();

  // ── Helpers ───────────────────────────────────────────────
  const isCompletedToday = h => (h.completedDates||[]).includes(t);

  const getStreak = h => {
    const dates = [...(h.completedDates||[])].sort();
    if (!dates.length) return 0;
    let streak = 0;
    let check = new Date();
    check.setHours(0,0,0,0);
    while (true) {
      const ds = check.toISOString().split("T")[0];
      if (dates.includes(ds)) { streak++; check.setDate(check.getDate()-1); }
      else { if (ds === t && streak === 0) { check.setDate(check.getDate()-1); continue; } break; }
      if (streak > 365) break;
    }
    return streak;
  };

  const getBestStreak = h => {
    const dates = [...(h.completedDates||[])].sort();
    if (!dates.length) return 0;
    let best = 0, cur = 1;
    for (let i=1; i<dates.length; i++) {
      const d1 = new Date(dates[i-1]+"T12:00:00"), d2 = new Date(dates[i]+"T12:00:00");
      const diff = (d2-d1)/(1000*60*60*24);
      if (diff === 1) { cur++; best = Math.max(best,cur); }
      else cur = 1;
    }
    return Math.max(best, cur);
  };

  const getConsistency = h => {
    const dates = h.completedDates||[];
    if (!dates.length) return 0;
    const d30 = new Date(); d30.setDate(d30.getDate()-30);
    const d30s = d30.toISOString().split("T")[0];
    // Calcular dias esperados nos últimos 30 dias
    let expectedDays = 0;
    for (let i=0; i<30; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const dow = d.getDay(); // 0=Dom, 1=Seg...
      const ds = d.toISOString().split("T")[0];
      if (ds <= today()) {
        if (h.freq === "weekly" && h.freqDays?.length) {
          if (h.freqDays.includes(dow)) expectedDays++;
        } else {
          expectedDays++; // diário
        }
      }
    }
    if (expectedDays === 0) return 0;
    const last30 = dates.filter(d => d >= d30s);
    return Math.round(last30.length / expectedDays * 100);
  };

  const getLast7 = h => {
    return Array.from({length:7}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate()-6+i);
      const ds = d.toISOString().split("T")[0];
      return { date:ds, done:(h.completedDates||[]).includes(ds), isToday:ds===t, day:d.toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","") };
    });
  };

  const getHeatmap = h => {
    const weeks = 12;
    const days = weeks * 7;
    return Array.from({length:days}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate() - (days-1-i));
      const ds = d.toISOString().split("T")[0];
      return { date:ds, done:(h.completedDates||[]).includes(ds), dow:d.getDay(), week:Math.floor(i/7) };
    });
  };

  // ── Identidades únicas ────────────────────────────────────
  const identities = useMemo(() => {
    const ids = [...new Set((habits||[]).map(h=>h.identity).filter(Boolean))];
    return ids.map(id => {
      const related = habits.filter(h=>h.identity===id);
      const avgConsistency = related.length > 0 ? Math.round(related.reduce((s,h)=>s+getConsistency(h),0)/related.length) : 0;
      return { name:id, habits:related, consistency:avgConsistency };
    });
  }, [habits]);

  // ── Stats globais ────────────────────────────────────────
  const stats = useMemo(() => {
    const total = habits.length;
    const doneToday = habits.filter(isCompletedToday).length;
    const totalStreak = habits.reduce((s,h)=>s+getStreak(h),0);
    const avgConsistency = total > 0 ? Math.round(habits.reduce((s,h)=>s+getConsistency(h),0)/total) : 0;
    const bestOverall = Math.max(...habits.map(getBestStreak), 0);
    return { total, doneToday, totalStreak, avgConsistency, bestOverall };
  }, [habits]);

  // ── Formulário ────────────────────────────────────────────
  const EMOJIS = ["⭐","📚","💪","🧘","💧","🏃","✍️","🎯","🧠","🌱","💊","🎵","🍎","😴","🧹","📝","💰","🤝","🎨","⚡"];
  const IDENTITIES_PRESETS = ["Tornar-me leitor","Tornar-me disciplinado","Tornar-me saudável","Tornar-me produtivo","Tornar-me atleta","Tornar-me calmo","Tornar-me criativo","Tornar-me organizado"];
  const TIME_OPTIONS = [{ v:"morning", l:"☀️ Manhã", sub:"6h–12h" },{ v:"afternoon", l:"🌤 Tarde", sub:"12h–18h" },{ v:"evening", l:"🌙 Noite", sub:"18h–22h" },{ v:"anytime", l:"🔄 Qualquer hora", sub:"" }];
  const DIFF_OPTIONS = [{ v:1,l:"Fácil",c:"#10b981" },{ v:2,l:"Médio",c:"#f59e0b" },{ v:3,l:"Difícil",c:"#ef4444" }];

  const emptyForm = { title:"", emoji:"⭐", color:"#2b8be8", freq:"daily", identity:"", difficulty:2, timeOfDay:"morning", description:"", targetStreak:21, isFavorite:false, completedDates:[] };
  const [hf, setHf] = useState(emptyForm);

  const openForm = (h=null) => {
    setEditingHabit(h);
    setHf(h ? { title:h.title, emoji:h.emoji||"⭐", color:h.color||"#2b8be8", freq:h.freq||"daily", identity:h.identity||"", difficulty:h.difficulty||2, timeOfDay:h.timeOfDay||"morning", description:h.description||"", targetStreak:h.targetStreak||21, isFavorite:h.isFavorite||false, completedDates:h.completedDates||[] } : emptyForm);
    setIsFormOpen(true);
  };

  const saveHabit = async () => {
    if (!hf.title.trim()) return;
    const habit = { ...hf, id: editingHabit ? editingHabit.id : uid(), freqDays:[1,2,3,4,5,6,7] };
    if (editingHabit) await updateHabit(habit);
    else await addHabit(habit);
    setIsFormOpen(false); setEditingHabit(null);
  };

  // toggle aceita id + data opcional (para marcar dias passados)
  const toggle = async (id, date) => {
    const targetDate = date || t;
    const current = (habits||[]).find(x => x.id === id);
    if (!current) return;
    const dates = [...(current.completedDates||[])];
    const newDates = dates.includes(targetDate)
      ? dates.filter(d => d !== targetDate)
      : [...dates, targetDate].sort();
    await updateHabit({ ...current, completedDates: newDates });
  };

  const COLORS = ["#2b8be8","#10b981","#a855f7","#f97316","#ef4444","#f59e0b","#ec4899","#06b6d4","#64748b","#1a1d23"];

  // ── Análise IA ────────────────────────────────────────────
  const generateInsight = async () => {
    setAiLoading(true); setAiInsight(null);
    try {
      const habitData = habits.map(h => ({
        nome: h.title, streak: getStreak(h), melhorStreak: getBestStreak(h),
        consistencia: getConsistency(h), concluido_hoje: isCompletedToday(h),
        identidade: h.identity||"sem identidade", dificuldade: h.difficulty,
        horario: h.timeOfDay, dias_completados: (h.completedDates||[]).length
      }));
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1200,
          messages:[{ role:"user", content:
            `Você é um coach de produtividade especialista em neurociência comportamental e no livro Hábitos Atômicos de James Clear.

Analise esses hábitos de um contador profissional:
${JSON.stringify(habitData, null, 2)}

Total hoje: ${stats.doneToday}/${stats.total} | Consistência média: ${stats.avgConsistency}% | Melhor streak: ${stats.bestOverall} dias

Responda APENAS com JSON puro (sem markdown), com esta estrutura:
{
  "manchete": "Uma frase de impacto sobre o momento atual",
  "diagnostico": "Análise comportamental em 2-3 frases, mencionando padrões específicos",
  "habito_mais_forte": "Nome e por quê",
  "habito_em_risco": "Nome e sinal de risco detectado",
  "insight_atomico": "Um insight do livro Hábitos Atômicos aplicado aos dados",
  "acao_hoje": "Uma ação específica e pequena para hoje",
  "previsao": "Previsão comportamental para os próximos 7 dias",
  "sugestao_identidade": "Sugestão de identidade baseada nos hábitos"
}` }]
        })
      });
      const data = await resp.json();
      const text = data.content?.[0]?.text||"";
      setAiInsight(JSON.parse(text.replace(/```json|```/g,"").trim()));
    } catch(e) { setAiInsight({ manchete:"Erro ao gerar análise.", diagnostico:"Tente novamente.", habito_mais_forte:"—", habito_em_risco:"—", insight_atomico:"—", acao_hoje:"—", previsao:"—", sugestao_identidade:"—" }); }
    finally { setAiLoading(false); }
  };

  // ── Componente HabitCard ──────────────────────────────────

  // ── Frase motivacional ────────────────────────────────────
  const PHRASES = [
    "Cada check é um voto na identidade que você quer construir.",
    "Pequenas ações diárias superam grandes esforços esporádicos.",
    "Você não sobe ao nível de seus objetivos. Você cai ao nível de seus sistemas.",
    "A consistência é mais poderosa que a intensidade.",
    "Hábitos são os juros compostos da auto-melhoria.",
    "A mudança real vem de mudança de identidade, não de metas.",
    "O segredo é fazer do próximo passo algo impossível de não fazer.",
    "Reduzir o atrito é mais eficaz do que aumentar a motivação.",
  ];
  const dailyPhrase = PHRASES[new Date().getDate() % PHRASES.length];

  const visibleHabits = (habits||[])
    .filter(h => !h.archived)
    .filter(h => filterIdentity==="all" || h.identity===filterIdentity)
    .filter(h => filterTime==="all" || h.timeOfDay===filterTime);

  const TABS = [["dashboard","📊 Dashboard"],["list","📋 Hábitos"],["identity","🧠 Identidade"],["insights","✨ Insights IA"]];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23", letterSpacing:"-0.01em" }}>Hábitos & Rotina</h2>
          <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Sistema inteligente de construção de identidade</p>
        </div>
        <button onClick={()=>openForm()} className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold"
          style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", boxShadow:"0 2px 8px rgba(26,29,35,0.25)" }}>
          <Icon.Plus />Novo Hábito
        </button>
      </div>

      {/* Frase do dia */}
      <div className="rounded-2xl px-5 py-3 flex items-center gap-3"
        style={{ background:"linear-gradient(135deg,rgba(26,29,35,0.97),rgba(30,46,74,0.97))", border:"1px solid rgba(91,170,255,0.1)" }}>
        <span className="text-lg flex-shrink-0">💡</span>
        <p className="text-xs italic" style={{ color:"rgba(255,255,255,0.7)", fontStyle:"italic" }}>{dailyPhrase}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background:"rgba(241,245,249,0.7)", width:"fit-content" }}>
        {TABS.map(([id,label]) => (
          <button key={id} onClick={()=>setView(id)}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background:view===id?"rgba(255,255,255,0.98)":"transparent", color:view===id?"#1a1d23":"#94a3b8",
              boxShadow:view===id?"0 2px 8px rgba(26,29,35,0.08)":"none" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {view === "dashboard" && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label:"Hoje", value:`${stats.doneToday}/${stats.total}`, sub:"concluídos", color:"#2b8be8", icon:"📋" },
              { label:"Streak combinado", value:stats.totalStreak, sub:"dias totais", color:"#f59e0b", icon:"🔥" },
              { label:"Consistência", value:`${stats.avgConsistency}%`, sub:"últimos 30 dias", color:stats.avgConsistency>=70?"#10b981":stats.avgConsistency>=40?"#f59e0b":"#ef4444", icon:"📈" },
              { label:"Melhor sequência", value:stats.bestOverall, sub:"dias consecutivos", color:"#a855f7", icon:"🏆" },
            ].map(k => (
              <div key={k.label} className="rounded-2xl p-4 transition-all"
                style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)", backdropFilter:"blur(8px)" }}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(26,29,35,0.08)";}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.04)";}}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>{k.label}</p>
                    <p className="text-2xl font-black" style={{ color:k.color, fontVariantNumeric:"tabular-nums" }}>{k.value}</p>
                    <p className="text-[10px] mt-0.5" style={{ color:"#94a3b8" }}>{k.sub}</p>
                  </div>
                  <span className="text-xl">{k.icon}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Lista rápida hoje */}
          {visibleHabits.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
              <p className="text-5xl mb-4">🌱</p>
              <p className="font-bold text-lg" style={{ color:"#1a1d23" }}>Nenhum hábito ainda</p>
              <p className="text-sm mt-1" style={{ color:"#94a3b8" }}>Crie seu primeiro hábito para começar a construir sua identidade</p>
              <button onClick={()=>openForm()} className="mt-4 px-5 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)" }}>Criar primeiro hábito</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleHabits.sort((a,b)=>(isCompletedToday(a)?1:0)-(isCompletedToday(b)?1:0)).map(h => <HabitCard key={h.id} habitId={h.id} onToggle={(id, date) => toggle(id, date)} onEdit={openForm} onDelete={hid => deleteHabit(hid)}/>)}
            </div>
          )}
        </div>
      )}

      {/* ── LISTA ── */}
      {view === "list" && (
        <div className="space-y-4">
          {/* Filtros */}
          <div className="flex gap-2 flex-wrap">
            <select value={filterIdentity} onChange={e=>setFilterIdentity(e.target.value)}
              className="border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
              <option value="all">Todas identidades</option>
              {identities.map(id => <option key={id.name} value={id.name}>{id.name}</option>)}
            </select>
            <select value={filterTime} onChange={e=>setFilterTime(e.target.value)}
              className="border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
              <option value="all">Todos horários</option>
              {TIME_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          {visibleHabits.length === 0 ? (
            <div className="rounded-2xl p-10 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
              <p className="text-3xl mb-2">🔍</p>
              <p className="font-bold" style={{ color:"#1a1d23" }}>Nenhum hábito encontrado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleHabits.map(h => <HabitCard key={h.id} habitId={h.id} onToggle={(id, date) => toggle(id, date)} onEdit={openForm} onDelete={hid => deleteHabit(hid)}/>)}
            </div>
          )}
        </div>
      )}

      {/* ── IDENTIDADE ── */}
      {view === "identity" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,rgba(26,29,35,0.97),rgba(30,46,74,0.97))", border:"1px solid rgba(91,170,255,0.1)" }}>
            <h3 className="text-sm font-black mb-1" style={{ color:"#fff" }}>Sistema de Identidade</h3>
            <p className="text-xs" style={{ color:"rgba(255,255,255,0.5)" }}>
              "Cada ação é um voto para o tipo de pessoa que você deseja se tornar." — James Clear
            </p>
          </div>
          {identities.length === 0 ? (
            <div className="rounded-2xl p-10 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
              <p className="text-4xl mb-3">🧠</p>
              <p className="font-bold" style={{ color:"#1a1d23" }}>Nenhuma identidade definida</p>
              <p className="text-xs mt-1" style={{ color:"#94a3b8" }}>Ao criar hábitos, defina uma identidade para agrupá-los</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {identities.map(id => {
                const pct = id.consistency;
                const color = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={id.name} className="rounded-2xl p-5 transition-all"
                    style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)" }}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 24px ${color}15`;}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.04)";}}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{id.name}</p>
                        <p className="text-[10px]" style={{ color:"#94a3b8" }}>{id.habits.length} hábito{id.habits.length!==1?"s":""} vinculado{id.habits.length!==1?"s":""}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black" style={{ color }}>{pct}%</p>
                        <p className="text-[9px]" style={{ color:"#94a3b8" }}>consistência</p>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full mb-3" style={{ background:"rgba(226,232,240,0.5)" }}>
                      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width:pct+"%", background:`linear-gradient(90deg,${color},${color}cc)` }}/>
                    </div>
                    <div className="space-y-1.5">
                      {id.habits.map(h => (
                        <div key={h.id} className="flex items-center gap-2 p-2 rounded-xl" style={{ background:"rgba(248,250,252,0.7)", border:"1px solid rgba(226,232,240,0.5)" }}>
                          <span className="text-base flex-shrink-0">{h.emoji||"⭐"}</span>
                          <span className="text-xs font-medium flex-1 truncate" style={{ color:"#374151" }}>{h.title}</span>
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:isCompletedToday(h)?"#10b981":"rgba(203,213,225,0.7)" }}/>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── INSIGHTS IA ── */}
      {view === "insights" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black" style={{ color:"#1a1d23" }}>Análise Comportamental com IA</h3>
              <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Baseada em neurociência e Hábitos Atômicos</p>
            </div>
            <button onClick={generateInsight} disabled={aiLoading || habits.length===0}
              className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px rgba(43,139,232,0.25)" }}>
              {aiLoading ? <><Icon.Loader />Analisando...</> : <><Icon.Sparkles />Gerar Análise</>}
            </button>
          </div>

          {!aiInsight && !aiLoading && (
            <div className="rounded-2xl p-12 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
              <div className="text-5xl mb-4">🧠</div>
              <p className="font-bold" style={{ color:"#1a1d23" }}>Análise Inteligente de Hábitos</p>
              <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color:"#94a3b8" }}>
                A IA analisa seus padrões comportamentais e gera insights personalizados baseados em neurociência e Hábitos Atômicos.
              </p>
              <button onClick={generateInsight} disabled={habits.length===0}
                className="mt-4 px-6 py-2.5 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)" }}>
                {habits.length===0?"Crie hábitos primeiro":"Iniciar análise →"}
              </button>
            </div>
          )}

          {aiInsight && (
            <div className="space-y-4">
              {/* Manchete */}
              <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,rgba(26,29,35,0.97),rgba(30,46,74,0.97))", border:"1px solid rgba(91,170,255,0.12)" }}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"rgba(91,170,255,0.7)" }}>Diagnóstico atual</p>
                <p className="text-lg font-black leading-tight" style={{ color:"#fff" }}>{aiInsight.manchete}</p>
                <p className="text-xs mt-2" style={{ color:"rgba(255,255,255,0.5)" }}>{aiInsight.diagnostico}</p>
              </div>

              {/* Cards de insight */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { icon:"💪", title:"Hábito mais forte", content:aiInsight.habito_mais_forte, color:"#10b981" },
                  { icon:"⚠️", title:"Em risco", content:aiInsight.habito_em_risco, color:"#f59e0b" },
                  { icon:"⚡", title:"Insight Atômico", content:aiInsight.insight_atomico, color:"#2b8be8" },
                  { icon:"🎯", title:"Ação para hoje", content:aiInsight.acao_hoje, color:"#a855f7" },
                ].map(c => (
                  <div key={c.title} className="rounded-2xl p-4 transition-all"
                    style={{ background:"rgba(255,255,255,0.98)", border:`1px solid ${c.color}20`, boxShadow:`0 4px 16px ${c.color}08` }}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateX(3px)";e.currentTarget.style.borderColor=c.color+"40";}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="translateX(0)";e.currentTarget.style.borderColor=c.color+"20";}}>
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0">{c.icon}</span>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color:c.color }}>{c.title}</p>
                        <p className="text-xs" style={{ color:"#374151" }}>{c.content}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Previsão + Identidade */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl p-4" style={{ background:"rgba(168,85,247,0.06)", border:"1px solid rgba(168,85,247,0.15)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#a855f7" }}>📅 Previsão 7 dias</p>
                  <p className="text-xs" style={{ color:"#374151" }}>{aiInsight.previsao}</p>
                </div>
                <div className="rounded-2xl p-4" style={{ background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.15)" }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#10b981" }}>🧠 Identidade sugerida</p>
                  <p className="text-xs" style={{ color:"#374151" }}>{aiInsight.sugestao_identidade}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL DE CRIAÇÃO/EDIÇÃO ── */}
      {isFormOpen && (
        <Modal title={editingHabit ? "Editar Hábito" : "Novo Hábito"} onClose={()=>{setIsFormOpen(false);setEditingHabit(null);}} maxWidth="max-w-lg">
          <div className="p-6 space-y-5">
            {/* Emoji picker */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Ícone</label>
              <div className="flex flex-wrap gap-2">
                {EMOJIS.map(e => (
                  <button key={e} type="button" onClick={()=>setHf(p=>({...p,emoji:e}))}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-all"
                    style={{ background:hf.emoji===e?"rgba(43,139,232,0.15)":"rgba(248,250,252,0.8)", border:hf.emoji===e?"1.5px solid rgba(43,139,232,0.4)":"1px solid rgba(226,232,240,0.6)", transform:hf.emoji===e?"scale(1.15)":"scale(1)" }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Nome */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Nome do hábito *</label>
              <input value={hf.title} onChange={e=>setHf(p=>({...p,title:e.target.value}))} placeholder="Ex: Leitura de 20 minutos..."
                className="w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-300"
                style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }} />
            </div>

            {/* Identidade */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Identidade vinculada</label>
              <input value={hf.identity} onChange={e=>setHf(p=>({...p,identity:e.target.value}))} list="identities-list"
                placeholder="Ex: Tornar-me leitor"
                className="w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-300"
                style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }} />
              <datalist id="identities-list">
                {IDENTITIES_PRESETS.map(i => <option key={i} value={i}/>)}
                {identities.map(i => <option key={i.name} value={i.name}/>)}
              </datalist>
            </div>

            {/* Cor + Dificuldade + Horário */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Cor</label>
                <div className="flex gap-1.5 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={()=>setHf(p=>({...p,color:c}))}
                      className="w-6 h-6 rounded-lg transition-all"
                      style={{ background:c, border:hf.color===c?"2.5px solid #1a1d23":"2px solid transparent", transform:hf.color===c?"scale(1.2)":"scale(1)" }}/>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Dificuldade</label>
                <div className="flex gap-2">
                  {DIFF_OPTIONS.map(d => (
                    <button key={d.v} type="button" onClick={()=>setHf(p=>({...p,difficulty:d.v}))}
                      className="flex-1 py-1.5 rounded-xl text-xs font-bold transition-all"
                      style={{ background:hf.difficulty===d.v?d.c+"20":"rgba(248,250,252,0.8)", color:hf.difficulty===d.v?d.c:"#94a3b8", border:hf.difficulty===d.v?`1.5px solid ${d.c}50`:"1px solid rgba(226,232,240,0.6)" }}>
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Frequência */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Frequência</label>
              <div className="flex gap-2 mb-3">
                {[["daily","Todos os dias"],["weekly","Dias específicos"]].map(([v,l]) => (
                  <button key={v} type="button" onClick={()=>setHf(p=>({...p,freq:v,freqDays:v==="daily"?[1,2,3,4,5,6,7]:p.freqDays?.length?p.freqDays:[1,2,3,4,5]}))}
                    className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                    style={{ background:hf.freq===v?"linear-gradient(135deg,#1c1f26,#1e2e4a)":"rgba(248,250,252,0.7)", color:hf.freq===v?"#5aaff5":"#64748b", border:hf.freq===v?"1px solid rgba(91,170,255,0.2)":"1px solid rgba(226,232,240,0.6)" }}>
                    {l}
                  </button>
                ))}
              </div>
              {hf.freq === "weekly" && (
                <div>
                  <p className="text-[10px] mb-2" style={{ color:"#94a3b8" }}>Selecione os dias da semana:</p>
                  <div className="flex gap-1.5">
                    {[["Dom",0],["Seg",1],["Ter",2],["Qua",3],["Qui",4],["Sex",5],["Sáb",6]].map(([label,val]) => {
                      const sel = (hf.freqDays||[]).includes(val);
                      return (
                        <button key={val} type="button"
                          onClick={()=>setHf(p=>({ ...p, freqDays: sel ? (p.freqDays||[]).filter(d=>d!==val) : [...(p.freqDays||[]),val].sort() }))}
                          className="flex-1 py-2 rounded-xl text-xs font-black transition-all"
                          style={{ background:sel?(hf.color||"#2b8be8"):"rgba(248,250,252,0.7)", color:sel?"#fff":"#94a3b8", border:sel?"none":"1px solid rgba(226,232,240,0.6)", boxShadow:sel?`0 2px 8px ${hf.color||"#2b8be8"}40`:"none" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {(hf.freqDays||[]).length === 0 && (
                    <p className="text-[10px] mt-1.5" style={{ color:"#ef4444" }}>Selecione pelo menos um dia</p>
                  )}
                  <p className="text-[10px] mt-1.5" style={{ color:"#94a3b8" }}>
                    {(hf.freqDays||[]).length} dia{(hf.freqDays||[]).length!==1?"s":""} por semana selecionado{(hf.freqDays||[]).length!==1?"s":""}
                  </p>
                </div>
              )}
            </div>

            {/* Horário */}
            <div>
              <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Horário preferido</label>
              <div className="grid grid-cols-2 gap-2">
                {TIME_OPTIONS.map(o => (
                  <button key={o.v} type="button" onClick={()=>setHf(p=>({...p,timeOfDay:o.v}))}
                    className="p-2.5 rounded-xl text-left transition-all"
                    style={{ background:hf.timeOfDay===o.v?"rgba(43,139,232,0.08)":"rgba(248,250,252,0.7)", border:hf.timeOfDay===o.v?"1.5px solid rgba(43,139,232,0.3)":"1px solid rgba(226,232,240,0.6)" }}>
                    <p className="text-sm font-semibold" style={{ color:hf.timeOfDay===o.v?"#2b8be8":"#374151" }}>{o.l}</p>
                    {o.sub && <p className="text-[10px]" style={{ color:"#94a3b8" }}>{o.sub}</p>}
                  </button>
                ))}
              </div>
            </div>

            {/* Descrição + Meta */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Descrição (opcional)</label>
                <textarea value={hf.description} onChange={e=>setHf(p=>({...p,description:e.target.value}))}
                  placeholder="Por que este hábito importa..." rows={2}
                  className="w-full border rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-blue-300"
                  style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Meta de streak</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={365} value={hf.targetStreak} onChange={e=>setHf(p=>({...p,targetStreak:Number(e.target.value)}))}
                    className="flex-1 border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
                    style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
                  <span className="text-xs" style={{ color:"#94a3b8" }}>dias</span>
                </div>
                <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>21 dias = formação básica</p>
              </div>
            </div>

            {/* Favorito */}
            <label className="flex items-center gap-3 cursor-pointer">
              <button type="button" onClick={()=>setHf(p=>({...p,isFavorite:!p.isFavorite}))}
                className="relative w-10 h-5 rounded-full transition-all"
                style={{ background:hf.isFavorite?"linear-gradient(135deg,#f59e0b,#d97706)":"rgba(226,232,240,0.8)" }}>
                <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left:hf.isFavorite?"calc(100% - 18px)":"2px" }}/>
              </button>
              <span className="text-sm font-medium" style={{ color:"#374151" }}>★ Hábito favorito</span>
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={()=>{setIsFormOpen(false);setEditingHabit(null);}} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button onClick={saveHabit} disabled={!hf.title.trim()}
                className="flex items-center gap-2 px-5 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)" }}>
                {editingHabit ? "Salvar" : "Criar Hábito"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ============================================================
// IMPORT CLIENTS MODAL
// ============================================================
// Carrega SheetJS dinamicamente
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Tenta mapear automaticamente colunas do arquivo para campos do sistema
const COL_ALIASES = {
  name:          ["nome","razao social","razão social","empresa","cliente","name","company"],
  document:      ["cnpj","cpf","documento","doc","document","cpf/cnpj","cnpj/cpf"],
  type:          ["tipo","type","regime","perfil"],
  monthlyFee:    ["honorario","honorários","honorarios","valor","fee","mensalidade","monthly fee","honorário"],
  paymentMethod: ["forma pagamento","forma de pagamento","pagamento","metodo","método","payment","method"],
  paymentStatus: ["status","situacao","situação","status pagamento","payment status"],
  notes:         ["obs","observacao","observações","observacoes","notas","notes","anotacoes","anotações"],
};

function guessColumn(headers, field) {
  const aliases = COL_ALIASES[field] || [];
  for (const h of headers) {
    const hn = h.toLowerCase().trim().replace(/[_\-]/g," ");
    if (aliases.some(a => hn.includes(a))) return h;
  }
  return null;
}

function normalizeType(v) {
  if (!v) return "pj";
  const s = String(v).toLowerCase().trim();
  if (s.includes("mei")) return "mei";
  if (s.includes("pf") || s.includes("fisica") || s.includes("físic")) return "pf";
  return "pj";
}
function normalizeMethod(v) {
  if (!v) return "pix";
  const s = String(v).toLowerCase();
  if (s.includes("boleto")) return "boleto";
  if (s.includes("transfer") || s.includes("ted") || s.includes("doc")) return "transfer";
  return "pix";
}
function normalizeStatus(v) {
  if (!v) return "pending";
  const s = String(v).toLowerCase();
  if (s.includes("dia") || s.includes("pago") || s.includes("paid") || s.includes("ok")) return "paid";
  if (s.includes("atras") || s.includes("overdue") || s.includes("inadim")) return "overdue";
  return "pending";
}
function normalizeFee(v) {
  if (!v && v !== 0) return 0;
  const n = parseFloat(String(v).replace(/[^\d,.-]/g,"").replace(",","."));
  return isNaN(n) ? 0 : n;
}

function ImportClientsModal({ onClose, existingClients, onImport }) {
  const [step, setStep] = useState("upload"); // upload | mapping | preview | conflicts | done
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rawRows, setRawRows] = useState([]);   // rows from file (objects)
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});   // field -> column name
  const [parsed, setParsed] = useState([]);     // normalized client objects
  const [conflicts, setConflicts] = useState([]); // {incoming, existing, resolution}
  const [resolutions, setResolutions] = useState({}); // idx -> "keep"|"replace"
  const fileRef = useRef();

  const FIELDS = [
    { key:"name",          label:"Nome / Razão Social", required:true },
    { key:"document",      label:"CNPJ / CPF",          required:false },
    { key:"type",          label:"Tipo (PJ/PF/MEI)",    required:false },
    { key:"monthlyFee",    label:"Honorários (R$)",      required:false },
    { key:"paymentMethod", label:"Forma de Pagamento",   required:false },
    { key:"paymentStatus", label:"Status Pagamento",     required:false },
    { key:"notes",         label:"Observações",          required:false },
  ];

  // ── STEP 1: parse file ────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setError(""); setLoading(true);
    try {
      const XLSX = await loadSheetJS();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
      if (!rows.length) { setError("Arquivo vazio ou sem dados reconhecíveis."); setLoading(false); return; }
      const hdrs = Object.keys(rows[0]);
      setHeaders(hdrs);
      setRawRows(rows);
      // Auto-map columns
      const autoMap = {};
      FIELDS.forEach(f => {
        const col = guessColumn(hdrs, f.key);
        if (col) autoMap[f.key] = col;
      });
      setMapping(autoMap);
      setStep("mapping");
    } catch(e) {
      setError("Erro ao ler arquivo. Verifique se é um CSV ou Excel válido.");
    }
    setLoading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── STEP 2: apply mapping → parse rows ───────────────────
  const applyMapping = () => {
    if (!mapping.name) { setError("Campo Nome é obrigatório."); return; }
    setError("");
    const rows = rawRows.map((r, i) => ({
      id: uid(),
      name:          String(r[mapping.name] || "").trim(),
      document:      String(r[mapping.document] || "").trim(),
      type:          normalizeType(r[mapping.type]),
      monthlyFee:    normalizeFee(r[mapping.monthlyFee]),
      paymentMethod: normalizeMethod(r[mapping.paymentMethod]),
      paymentStatus: normalizeStatus(r[mapping.paymentStatus]),
      notes:         String(r[mapping.notes] || "").trim(),
      dueDates: [], obligations: [], obligationStatuses: [],
      status: "active", createdAt: new Date().toISOString(),
      _rowIdx: i,
    })).filter(r => r.name);
    if (!rows.length) { setError("Nenhuma linha com nome preenchido encontrada."); return; }
    setParsed(rows);

    // Detect conflicts by document or name
    const cfls = [];
    rows.forEach(inc => {
      const match = existingClients.find(ex =>
        (inc.document && ex.document && inc.document === ex.document) ||
        ex.name.toLowerCase().trim() === inc.name.toLowerCase().trim()
      );
      if (match) cfls.push({ incoming: inc, existing: match });
    });
    setConflicts(cfls);
    const initRes = {};
    cfls.forEach((_, i) => { initRes[i] = "replace"; });
    setResolutions(initRes);
    setStep("preview");
  };

  // ── STEP 3: confirm import ────────────────────────────────
  const confirmImport = () => {
    if (conflicts.length > 0) { setStep("conflicts"); return; }
    doImport();
  };

  const doImport = () => {
    const conflictIncomingIds = new Set(conflicts.map(c => c.incoming.id));
    const toAdd = [];
    const toUpdate = [];

    parsed.forEach(inc => {
      const cflIdx = conflicts.findIndex(c => c.incoming.id === inc.id);
      if (cflIdx >= 0) {
        const res = resolutions[cflIdx];
        if (res === "replace") toUpdate.push({ ...conflicts[cflIdx].existing, ...inc, id: conflicts[cflIdx].existing.id });
        // "keep" → skip
      } else {
        toAdd.push(inc);
      }
    });
    onImport(toAdd, toUpdate);
    setStep("done");
  };

  const conflictResolved = conflicts.length > 0 && Object.keys(resolutions).length === conflicts.length;
  const newCount = parsed.filter(inc => !conflicts.find(c => c.incoming.id === inc.id)).length;
  const replaceCount = conflicts.filter((_, i) => resolutions[i] === "replace").length;
  const skipCount = conflicts.filter((_, i) => resolutions[i] === "keep").length;

  const stepLabels = ["Upload", "Mapeamento", "Revisão", "Conflitos", "Concluído"];
  const stepIdx = ["upload","mapping","preview","conflicts","done"].indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:"rgba(26,29,35,0.65)", backdropFilter:"blur(8px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ background:"#fff", border:"1px solid #dde3ed", maxWidth:680, maxHeight:"90vh" }}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#fff" }}>
          <div>
            <p className="font-black text-base">Importar Clientes</p>
            <p className="text-xs mt-0.5" style={{ color:"rgba(255,255,255,0.45)" }}>CSV ou Excel (.xlsx)</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color:"rgba(255,255,255,0.5)" }}
            onMouseEnter={e=>e.currentTarget.style.color="#fff"} onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.5)"}>
            <Icon.X />
          </button>
        </div>

        {/* Steps indicator */}
        {step !== "done" && (
          <div className="px-6 py-3 flex items-center gap-1 flex-shrink-0" style={{ borderBottom:"1px solid #e8edf5", background:"#f8fafc" }}>
            {["Upload","Mapeamento","Revisão","Conflitos"].map((l, i) => (
              <div key={l} className="flex items-center gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black transition-all"
                    style={i < stepIdx ? { background:"#10b981", color:"#fff" } : i === stepIdx ? { background:"#2b8be8", color:"#fff" } : { background:"#e8edf5", color:"#94a3b8" }}>
                    {i < stepIdx ? "✓" : i+1}
                  </div>
                  <span className="text-xs font-semibold" style={{ color: i === stepIdx ? "#2b8be8" : i < stepIdx ? "#10b981" : "#94a3b8" }}>{l}</span>
                </div>
                {i < 3 && <div className="w-6 h-px mx-1" style={{ background:"#e8edf5" }} />}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── UPLOAD ── */}
          {step === "upload" && (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all"
                style={{ borderColor:"#bfdbfe", background:"#f0f7ff" }}
                onDragOver={e=>e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                onMouseEnter={e=>{e.currentTarget.style.background="#dbeafe";e.currentTarget.style.borderColor="#2b8be8";}}
                onMouseLeave={e=>{e.currentTarget.style.background="#f0f7ff";e.currentTarget.style.borderColor="#bfdbfe";}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#2b8be8" strokeWidth="1.5" className="w-12 h-12 mx-auto mb-3">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p className="font-bold text-sm" style={{ color:"#1a1d23" }}>Arraste o arquivo aqui</p>
                <p className="text-xs mt-1" style={{ color:"#64748b" }}>ou clique para selecionar — CSV ou Excel (.xlsx, .xls)</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              </div>
              {loading && <p className="text-center text-sm" style={{ color:"#2b8be8" }}>Lendo arquivo...</p>}
              {error && <p className="text-center text-sm px-4 py-2 rounded-xl" style={{ color:"#dc2626", background:"#fff5f5", border:"1px solid #fca5a5" }}>{error}</p>}
              {/* Template hint */}
              <div className="rounded-xl p-4" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
                <p className="text-xs font-bold mb-2" style={{ color:"#374151" }}>📋 Colunas reconhecidas automaticamente:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["Nome","CNPJ/CPF","Tipo","Honorários","Forma de Pagamento","Status","Obs"].map(c => (
                    <span key={c} className="text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background:"#dbeafe", color:"#2b8be8" }}>{c}</span>
                  ))}
                </div>
                <p className="text-[10px] mt-2" style={{ color:"#94a3b8" }}>Nomes de coluna flexíveis — o sistema tenta identificar automaticamente.</p>
              </div>
            </div>
          )}

          {/* ── MAPPING ── */}
          {step === "mapping" && (
            <div className="space-y-4">
              <div className="rounded-xl p-3 text-sm" style={{ background:"#eff6ff", border:"1px solid #bfdbfe", color:"#1e40af" }}>
                <strong>{rawRows.length} linhas</strong> encontradas · <strong>{headers.length} colunas</strong> detectadas. Confirme o mapeamento abaixo.
              </div>
              <div className="space-y-3">
                {FIELDS.map(f => (
                  <div key={f.key} className="flex items-center gap-3">
                    <div className="w-44 flex-shrink-0">
                      <p className="text-xs font-bold" style={{ color:"#374151" }}>{f.label}</p>
                      {f.required && <span className="text-[10px] font-semibold" style={{ color:"#ef4444" }}>obrigatório</span>}
                    </div>
                    <select value={mapping[f.key] || ""} onChange={e => setMapping(p => ({ ...p, [f.key]: e.target.value || undefined }))}
                      className="flex-1 border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
                      style={{ borderColor: !mapping[f.key] && f.required ? "#fca5a5" : "#dde3ed", color:"#374151" }}>
                      <option value="">— não importar —</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <div className="w-5 flex-shrink-0">
                      {mapping[f.key]
                        ? <svg viewBox="0 0 24 24" fill="#10b981" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" strokeWidth="2.5" fill="none"/></svg>
                        : <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/></svg>
                      }
                    </div>
                  </div>
                ))}
              </div>
              {/* Preview first 2 rows */}
              <div className="mt-4">
                <p className="text-xs font-bold mb-2" style={{ color:"#94a3b8" }}>PRÉVIA (primeiras 2 linhas)</p>
                <div className="overflow-x-auto rounded-xl" style={{ border:"1px solid #e8edf5" }}>
                  <table className="w-full text-left text-xs" style={{ minWidth: 400 }}>
                    <thead style={{ background:"#f8fafc", borderBottom:"1px solid #e8edf5" }}>
                      <tr>{headers.map(h => <th key={h} className="px-3 py-2 font-semibold truncate max-w-[120px]" style={{ color:"#64748b" }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rawRows.slice(0,2).map((r,i) => (
                        <tr key={i} style={{ borderTop:"1px solid #f0f4f8" }}>
                          {headers.map(h => <td key={h} className="px-3 py-2 truncate max-w-[120px]" style={{ color:"#374151" }}>{String(r[h] || "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {error && <p className="text-sm px-4 py-2 rounded-xl" style={{ color:"#dc2626", background:"#fff5f5", border:"1px solid #fca5a5" }}>{error}</p>}
            </div>
          )}

          {/* ── PREVIEW ── */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3 text-center" style={{ background:"#eff6ff", border:"1px solid #bfdbfe" }}>
                  <p className="text-xl font-black" style={{ color:"#2b8be8" }}>{parsed.length}</p>
                  <p className="text-[10px] font-bold uppercase" style={{ color:"#64748b" }}>Total</p>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background:"#f0fdf4", border:"1px solid #bbf7d0" }}>
                  <p className="text-xl font-black" style={{ color:"#16a34a" }}>{parsed.length - conflicts.length}</p>
                  <p className="text-[10px] font-bold uppercase" style={{ color:"#64748b" }}>Novos</p>
                </div>
                <div className="rounded-xl p-3 text-center" style={{ background: conflicts.length > 0 ? "#fffbeb":"#f8fafc", border:`1px solid ${conflicts.length > 0 ? "#fde68a":"#e8edf5"}` }}>
                  <p className="text-xl font-black" style={{ color: conflicts.length > 0 ? "#d97706":"#94a3b8" }}>{conflicts.length}</p>
                  <p className="text-[10px] font-bold uppercase" style={{ color:"#64748b" }}>Conflitos</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl" style={{ border:"1px solid #e8edf5" }}>
                <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
                  <table className="w-full text-left text-xs">
                    <thead style={{ background:"#f8fafc", borderBottom:"1px solid #e8edf5", position:"sticky", top:0 }}>
                      <tr>
                        <th className="px-3 py-2 font-bold" style={{ color:"#94a3b8" }}>Nome</th>
                        <th className="px-3 py-2 font-bold" style={{ color:"#94a3b8" }}>CNPJ/CPF</th>
                        <th className="px-3 py-2 font-bold" style={{ color:"#94a3b8" }}>Tipo</th>
                        <th className="px-3 py-2 font-bold" style={{ color:"#94a3b8" }}>Honorários</th>
                        <th className="px-3 py-2 font-bold" style={{ color:"#94a3b8" }}>Status</th>
                        <th className="px-3 py-2 font-bold" style={{ color:"#94a3b8" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((r, i) => {
                        const isCfl = conflicts.find(c => c.incoming.id === r.id);
                        const typeCfgMap = { pj:{label:"PJ",color:"#2b8be8",bg:"#eff6ff"}, pf:{label:"PF",color:"#16a34a",bg:"#f0fdf4"}, mei:{label:"MEI",color:"#d97706",bg:"#fffbeb"} };
                        const tp = typeCfgMap[r.type] || typeCfgMap.pj;
                        return (
                          <tr key={r.id} style={{ borderTop:"1px solid #f0f4f8", background: isCfl ? "#fffbeb" : "transparent" }}>
                            <td className="px-3 py-2 font-semibold" style={{ color:"#1a1d23" }}>{r.name}</td>
                            <td className="px-3 py-2" style={{ color:"#64748b" }}>{r.document || "—"}</td>
                            <td className="px-3 py-2"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:tp.bg, color:tp.color }}>{tp.label}</span></td>
                            <td className="px-3 py-2 font-semibold" style={{ color:"#1a1d23" }}>{fmtCurrency(r.monthlyFee)}</td>
                            <td className="px-3 py-2" style={{ color:"#64748b" }}>{r.paymentStatus}</td>
                            <td className="px-3 py-2">{isCfl && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"#fef3c7", color:"#d97706" }}>⚠ conflito</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── CONFLICTS ── */}
          {step === "conflicts" && (
            <div className="space-y-4">
              <div className="rounded-xl p-3 text-sm" style={{ background:"#fffbeb", border:"1px solid #fde68a", color:"#92400e" }}>
                <strong>{conflicts.length} conflito(s)</strong> encontrado(s). Escolha o que fazer com cada um.
              </div>
              <div className="space-y-4">
                {conflicts.map((cfl, i) => (
                  <div key={i} className="rounded-2xl overflow-hidden" style={{ border:"1px solid #e8edf5" }}>
                    <div className="px-4 py-2 text-xs font-black uppercase tracking-wide" style={{ background:"#f8fafc", color:"#94a3b8", borderBottom:"1px solid #e8edf5" }}>
                      Conflito {i+1}
                    </div>
                    <div className="p-4 grid grid-cols-2 gap-4">
                      {/* Existente */}
                      <div className="rounded-xl p-3" style={{ background: resolutions[i]==="keep" ? "#f0fdf4":"#f8fafc", border:`2px solid ${resolutions[i]==="keep"?"#10b981":"#e8edf5"}` }}>
                        <p className="text-[10px] font-black uppercase mb-2" style={{ color:"#94a3b8" }}>📁 Cadastrado</p>
                        <p className="font-bold text-sm" style={{ color:"#1a1d23" }}>{cfl.existing.name}</p>
                        <p className="text-xs mt-0.5" style={{ color:"#64748b" }}>{cfl.existing.document || "—"}</p>
                        <p className="text-xs mt-1 font-semibold" style={{ color:"#374151" }}>{fmtCurrency(cfl.existing.monthlyFee)}</p>
                        <button onClick={() => setResolutions(p => ({...p,[i]:"keep"}))}
                          className="mt-3 w-full py-1.5 rounded-xl text-xs font-bold transition-all"
                          style={resolutions[i]==="keep" ? {background:"#10b981",color:"#fff"} : {background:"#e8edf5",color:"#64748b"}}>
                          ✓ Manter este
                        </button>
                      </div>
                      {/* Novo */}
                      <div className="rounded-xl p-3" style={{ background: resolutions[i]==="replace" ? "#eff6ff":"#f8fafc", border:`2px solid ${resolutions[i]==="replace"?"#2b8be8":"#e8edf5"}` }}>
                        <p className="text-[10px] font-black uppercase mb-2" style={{ color:"#94a3b8" }}>📥 Importando</p>
                        <p className="font-bold text-sm" style={{ color:"#1a1d23" }}>{cfl.incoming.name}</p>
                        <p className="text-xs mt-0.5" style={{ color:"#64748b" }}>{cfl.incoming.document || "—"}</p>
                        <p className="text-xs mt-1 font-semibold" style={{ color:"#374151" }}>{fmtCurrency(cfl.incoming.monthlyFee)}</p>
                        <button onClick={() => setResolutions(p => ({...p,[i]:"replace"}))}
                          className="mt-3 w-full py-1.5 rounded-xl text-xs font-bold transition-all"
                          style={resolutions[i]==="replace" ? {background:"#2b8be8",color:"#fff"} : {background:"#e8edf5",color:"#64748b"}}>
                          ↑ Substituir
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === "done" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background:"#f0fdf4", border:"2px solid #bbf7d0" }}>
                <svg viewBox="0 0 24 24" fill="#10b981" className="w-8 h-8"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" strokeWidth="2.5" fill="none"/></svg>
              </div>
              <p className="text-xl font-black mb-1" style={{ color:"#1a1d23" }}>Importação concluída!</p>
              <p className="text-sm" style={{ color:"#64748b" }}>
                {newCount > 0 && <span><strong style={{ color:"#16a34a" }}>{newCount}</strong> cliente(s) adicionado(s). </span>}
                {replaceCount > 0 && <span><strong style={{ color:"#2b8be8" }}>{replaceCount}</strong> atualizado(s). </span>}
                {skipCount > 0 && <span><strong style={{ color:"#94a3b8" }}>{skipCount}</strong> ignorado(s).</span>}
              </p>
              <button onClick={onClose} className="mt-6 px-6 py-2.5 text-white rounded-xl font-bold text-sm"
                style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                Ver clientes
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step !== "done" && step !== "upload" && (
          <div className="px-6 py-4 flex justify-between flex-shrink-0" style={{ borderTop:"1px solid #e8edf5", background:"#f8fafc" }}>
            <button onClick={() => {
              if (step==="mapping") setStep("upload");
              else if (step==="preview") setStep("mapping");
              else if (step==="conflicts") setStep("preview");
            }} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ color:"#64748b", background:"#e8edf5" }}>
              ← Voltar
            </button>
            {step === "mapping" && (
              <button onClick={applyMapping} className="px-5 py-2 text-white rounded-xl text-sm font-bold"
                style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                Pré-visualizar →
              </button>
            )}
            {step === "preview" && (
              <button onClick={confirmImport} className="px-5 py-2 text-white rounded-xl text-sm font-bold"
                style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                {conflicts.length > 0 ? `Resolver ${conflicts.length} conflito(s) →` : "Importar agora →"}
              </button>
            )}
            {step === "conflicts" && (
              <button onClick={doImport} disabled={!conflictResolved} className="px-5 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                Confirmar importação →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// CLIENTS
// ============================================================

// ============================================================
// CLIENT DETAIL MODAL (Item 5)
// ============================================================
function ClientDetailModal({ client: c, onClose, onEdit }) {
  const { tasks, severanceSimulations } = useApp() || {};
  const clientTasks = (tasks||[]).filter(t => t.clientId === c.id);
  const clientSims  = (severanceSimulations||[]).filter(s => s.clientId === c.id);
  const done = clientTasks.filter(t => t.completed).length;
  const pending = clientTasks.filter(t => !t.completed).length;
  const overdue = clientTasks.filter(t => !t.completed && t.dueDate < today()).length;

  const statusColors = { paid:"#10b981", pending:"#f59e0b", overdue:"#ef4444" };
  const statusLabels = { paid:"Pago", pending:"Pendente", overdue:"Atrasado" };

  return (
    <Modal title={"Ficha — " + c.name} onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#5aaff5" }}>
              {c.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-black" style={{ color:"#1a1d23" }}>{c.name}</p>
              <p className="text-xs" style={{ color:"#94a3b8" }}>{c.document || "Sem documento"} · {c.type === "pj" ? "Pessoa Jurídica" : "Pessoa Física"}</p>
            </div>
          </div>
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background:"#eff6ff", color:"#2b8be8" }}>
            <Icon.Edit />Editar
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label:"Mensalidade", value: fmtCurrency(c.monthlyFee||0), color:"#10b981" },
            { label:"Status Pgto", value: statusLabels[c.paymentStatus]||"—", color: statusColors[c.paymentStatus]||"#94a3b8" },
            { label:"Tarefas", value: clientTasks.length + " total", color:"#2b8be8" },
            { label:"Atrasadas", value: overdue > 0 ? overdue + " ⚠️" : "Nenhuma ✅", color: overdue > 0 ? "#ef4444" : "#10b981" },
          ].map(k => (
            <div key={k.label} className="rounded-xl p-3 text-center" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
              <p className="text-[10px] font-black uppercase tracking-wide mb-1" style={{ color:"#94a3b8" }}>{k.label}</p>
              <p className="text-sm font-black" style={{ color:k.color }}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Tarefas */}
        <div>
          <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Tarefas vinculadas</p>
          {clientTasks.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color:"#94a3b8" }}>Nenhuma tarefa vinculada a este cliente.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {clientTasks.sort((a,b) => (a.dueDate||"") > (b.dueDate||"") ? 1 : -1).map(t => (
                <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={"w-2 h-2 rounded-full flex-shrink-0"} style={{ background: t.completed ? "#10b981" : (!t.completed && t.dueDate < today()) ? "#ef4444" : "#f59e0b" }} />
                    <span className={"text-xs font-medium truncate " + (t.completed ? "line-through" : "")} style={{ color: t.completed ? "#94a3b8" : "#1a1d23" }}>{t.title}</span>
                  </div>
                  {t.dueDate && <span className="text-[10px] flex-shrink-0 ml-2" style={{ color:"#94a3b8" }}>{new Date(t.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Simulações */}
        {clientSims && clientSims.length > 0 && (
          <div>
            <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Simulações rescisórias</p>
            <div className="space-y-1.5">
              {clientSims.map(s => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
                  <span className="text-xs font-medium" style={{ color:"#1a1d23" }}>{s.employeeName}</span>
                  <span className="text-xs font-black" style={{ color:"#10b981" }}>{fmtCurrency(s.netAmount||0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notas */}
        {c.notes && (
          <div>
            <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Notas</p>
            <p className="text-sm rounded-xl p-3" style={{ background:"#f8fafc", border:"1px solid #e8edf5", color:"#374151" }}>{c.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}


// ============================================================
// CLIENT TIMELINE
// ============================================================
function ClientTimeline({ client, onClose }) {
  const { clientEvents, addClientEvent, updateClientEvent, deleteClientEvent, tasks, teamUsers, currentProfile } = useApp();
  const events = (clientEvents||[]).filter(e => e.clientId === client.id).sort((a,b) => b.date.localeCompare(a.date));
  const clientTasks = (tasks||[]).filter(t => t.clientId === client.id).sort((a,b)=>(b.dueDate||"").localeCompare(a.dueDate||""));
  const [form, setForm] = useState({ type:"note", title:"", content:"", date:new Date().toISOString().split("T")[0] });
  const [showAdd, setShowAdd] = useState(false);

  const EVENT_TYPES = {
    note:     { label:"Anotação",   emoji:"📝", color:"#64748b", bg:"rgba(100,116,139,0.1)" },
    meeting:  { label:"Reunião",    emoji:"🤝", color:"#2b8be8", bg:"rgba(43,139,232,0.1)" },
    pending:  { label:"Pendência",  emoji:"⚠️", color:"#f59e0b", bg:"rgba(245,158,11,0.1)" },
    email:    { label:"E-mail",     emoji:"📧", color:"#8b5cf6", bg:"rgba(139,92,246,0.1)" },
    call:     { label:"Ligação",    emoji:"📞", color:"#10b981", bg:"rgba(16,185,129,0.1)" },
    document: { label:"Documento",  emoji:"📄", color:"#06b6d4", bg:"rgba(6,182,212,0.1)" },
    payment:  { label:"Pagamento",  emoji:"💰", color:"#10b981", bg:"rgba(16,185,129,0.1)" },
  };

  const save = async () => {
    if (!form.title.trim()) return;
    await addClientEvent({ id:uid(), clientId:client.id, ...form });
    setForm({ type:"note", title:"", content:"", date:new Date().toISOString().split("T")[0] });
    setShowAdd(false);
  };

  const toggleResolved = async (ev) => {
    await updateClientEvent({ ...ev, resolved: !ev.resolved });
  };

  // Merge events + tasks into one timeline
  const allItems = [
    ...events.map(e => ({ ...e, _kind:"event" })),
    ...clientTasks.map(t => ({ id:t.id, _kind:"task", title:t.title, date:t.dueDate||"", completed:t.completed, dueDate:t.dueDate })),
  ].sort((a,b) => (b.date||"").localeCompare(a.date||""));

  return (
    <Modal title="" onClose={onClose} maxWidth="max-w-xl">
      <div style={{ maxHeight:"88vh", display:"flex", flexDirection:"column" }}>
        {/* Header */}
        <div className="p-5 pb-4" style={{ borderBottom:"1px solid rgba(226,232,240,0.6)", background:"linear-gradient(135deg,rgba(43,139,232,0.04),rgba(255,255,255,0.98))" }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-black text-white"
              style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", boxShadow:"0 4px 12px rgba(26,29,35,0.2)" }}>
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-base font-black" style={{ color:"#1a1d23" }}>{client.name}</h2>
              <p className="text-xs" style={{ color:"#94a3b8" }}>{allItems.length} registros · {clientTasks.filter(t=>!t.completed).length} tarefas pendentes</p>
            </div>
            <button onClick={()=>setShowAdd(v=>!v)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-white rounded-xl text-xs font-bold"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px rgba(43,139,232,0.25)" }}>
              <Icon.Plus />Registrar
            </button>
          </div>
          {/* Form de novo evento */}
          {showAdd && (
            <div className="mt-4 p-4 rounded-2xl space-y-3" style={{ background:"rgba(248,250,252,0.9)", border:"1px solid rgba(221,227,237,0.7)" }}>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(EVENT_TYPES).map(([k,v]) => (
                  <button key={k} type="button" onClick={()=>setForm(p=>({...p,type:k}))}
                    className="p-2 rounded-xl text-center transition-all"
                    style={{ background:form.type===k?v.bg:"transparent", border:form.type===k?`1.5px solid ${v.color}40`:"1px solid rgba(226,232,240,0.7)", fontSize:18 }}
                    title={v.label}>{v.emoji}
                  </button>
                ))}
              </div>
              <input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))}
                placeholder={`Título do ${EVENT_TYPES[form.type]?.label.toLowerCase()}...`}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
                style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.9)" }} />
              <textarea value={form.content} onChange={e=>setForm(p=>({...p,content:e.target.value}))}
                placeholder="Detalhes (opcional)..." rows={2} className="w-full border rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.9)" }} />
              <div className="flex items-center gap-2">
                <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}
                  className="border rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
                  style={{ borderColor:"rgba(221,227,237,0.8)" }} />
                <button onClick={save} disabled={!form.title.trim()} className="flex-1 py-1.5 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                  style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar registro</button>
                <button onClick={()=>setShowAdd(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-100 rounded-xl">✕</button>
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-5">
          {allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="text-5xl">📋</div>
              <p className="font-bold" style={{ color:"#1a1d23" }}>Nenhum registro ainda</p>
              <p className="text-sm" style={{ color:"#94a3b8" }}>Registre reuniões, anotações, e-mails e pendências</p>
            </div>
          ) : (
            <div className="relative">
              {/* Linha vertical */}
              <div className="absolute left-5 top-0 bottom-0 w-0.5" style={{ background:"linear-gradient(180deg,rgba(43,139,232,0.2),rgba(226,232,240,0.3))" }}/>
              <div className="space-y-3 pl-12">
                {allItems.map((item, idx) => {
                  if (item._kind === "task") {
                    return (
                      <div key={item.id} className="relative -ml-12 pl-12">
                        {/* Dot */}
                        <div className="absolute left-3.5 top-3.5 w-3 h-3 rounded-full border-2 flex-shrink-0"
                          style={{ background:item.completed?"#10b981":"rgba(245,158,11,0.3)", borderColor:item.completed?"#10b981":"#f59e0b", zIndex:1 }}/>
                        <div className="p-3 rounded-xl transition-all"
                          style={{ background: item.completed?"rgba(240,253,244,0.7)":"rgba(255,251,235,0.8)", border:`1px solid ${item.completed?"rgba(187,247,208,0.6)":"rgba(253,230,138,0.6)"}` }}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm">{item.completed?"✅":"📌"}</span>
                              <p className={"text-xs font-semibold truncate "+(item.completed?"line-through opacity-50":"")} style={{ color:"#1a1d23" }}>{item.title}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(245,158,11,0.15)", color:"#d97706" }}>Tarefa</span>
                              {item.dueDate && <span className="text-[10px]" style={{ color:"#94a3b8" }}>{new Date(item.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  const et = EVENT_TYPES[item.type] || EVENT_TYPES.note;
                  return (
                    <div key={item.id} className="relative -ml-12 pl-12 group">
                      {/* Dot */}
                      <div className="absolute left-3 top-3.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px]"
                        style={{ background:item.resolved?"rgba(226,232,240,0.8)":et.bg, border:`1.5px solid ${item.resolved?"rgba(203,213,225,0.7)":et.color+"40"}`, zIndex:1 }}>
                        {et.emoji}
                      </div>
                      <div className="p-3 rounded-xl transition-all"
                        style={{ background: item.resolved?"rgba(248,250,252,0.7)":"rgba(255,255,255,0.95)", border:`1px solid ${item.resolved?"rgba(226,232,240,0.5)":et.color+"20"}`, boxShadow:item.resolved?"none":"0 2px 8px rgba(26,29,35,0.04)" }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={"text-xs font-bold "+(item.resolved?"line-through opacity-50":"")} style={{ color:item.resolved?"#94a3b8":et.color }}>{item.title}</p>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:et.bg, color:et.color }}>{et.label}</span>
                            </div>
                            {item.content && <p className="text-[11px] mt-1 leading-relaxed" style={{ color:"#64748b" }}>{item.content}</p>}
                            <p className="text-[10px] mt-1.5" style={{ color:"#94a3b8" }}>
                              {item.date ? new Date(item.date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"}) : "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                            {item.type === "pending" && (
                              <button onClick={()=>toggleResolved(item)} className="p-1 rounded-lg transition-all text-[10px] font-bold px-2"
                                style={{ background:item.resolved?"rgba(16,185,129,0.1)":"rgba(245,158,11,0.1)", color:item.resolved?"#10b981":"#f59e0b" }}>
                                {item.resolved?"✓ Ok":"Pendente"}
                              </button>
                            )}
                            <button onClick={()=>deleteClientEvent(item.id)} className="p-1 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                              onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)";e.currentTarget.style.color="#ef4444";}}
                              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                              <Icon.Trash />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Clients() {
  const { clients, addClient, updateClient, deleteClient } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dueDates, setDueDates] = useState([]);
  const [ddDesc, setDdDesc] = useState(""); const [ddDate, setDdDate] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [viewMode, setViewMode] = useState("cards"); // "cards" | "list"
  const [importOpen, setImportOpen] = useState(false);
  const [clientDetail, setClientDetail] = useState(null);
  const [clientTimeline, setClientTimeline] = useState(null);

  const handleImport = (toAdd, toUpdate) => {
    toAdd.forEach(c => addClient(c));
    toUpdate.forEach(c => updateClient(c));
  };

  const emptyForm = { name:"", document:"", type:"pj", monthlyFee:"", paymentStatus:"pending", paymentMethod:"pix", notes:"" };
  const [cf, setCf] = useState(emptyForm);

  const open = (c) => {
    setEditing(c || null);
    setDueDates(c?.dueDates || []);
    setCf(c ? { name:c.name||"", document:c.document||"", type:c.type||"pj", monthlyFee:c.monthlyFee||"", paymentStatus:c.paymentStatus||"pending", paymentMethod:c.paymentMethod||"pix", notes:c.notes||"" } : emptyForm);
    setIsOpen(true);
  };
  const save = () => {
    if (!cf.name.trim()) return;
    const fee = parseFloat(String(cf.monthlyFee).replace(/[^\d,.-]/g,"").replace(",","."));
    const data = { id: editing?.id || uid(), name:cf.name, document:cf.document, type:cf.type, monthlyFee:isNaN(fee)?0:fee, paymentStatus:cf.paymentStatus, paymentMethod:cf.paymentMethod, notes:cf.notes, dueDates, obligations: editing?.obligations || [], obligationStatuses: editing?.obligationStatuses || [], status:"active", createdAt: editing?.createdAt || new Date().toISOString() };
    editing ? updateClient(data) : addClient(data);
    setIsOpen(false); setEditing(null);
  };

  // ── Stats ──────────────────────────────────────────────────
  const totalMRR    = clients.reduce((s, c) => s + (c.monthlyFee || 0), 0);
  const countPaid   = clients.filter(c => c.paymentStatus === "paid").length;
  const countPend   = clients.filter(c => c.paymentStatus === "pending").length;
  const countOver   = clients.filter(c => c.paymentStatus === "overdue").length;
  const valueOver   = clients.filter(c => c.paymentStatus === "overdue").reduce((s,c) => s+(c.monthlyFee||0),0);
  const ticketMedio = clients.length > 0 ? totalMRR / clients.length : 0;

  // ── Filtering ─────────────────────────────────────────────
  const filtered = clients.filter(c => {
    if (filterStatus !== "all" && c.paymentStatus !== filterStatus) return false;
    if (filterType !== "all" && (c.type || "pj") !== filterType) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.document?.includes(search)) return false;
    return true;
  });

  // ── Config ────────────────────────────────────────────────
  const statusCfg = {
    paid:    { label:"Em dia",   dot:"#10b981", bg:"#f0fdf4", color:"#16a34a", border:"#bbf7d0" },
    pending: { label:"Pendente", dot:"#f59e0b", bg:"#fffbeb", color:"#d97706", border:"#fde68a" },
    overdue: { label:"Atrasado", dot:"#ef4444", bg:"#fff5f5", color:"#dc2626", border:"#fca5a5" },
  };
  const typeCfg = {
    pj:  { label:"PJ",  bg:"#eff6ff", color:"#2b8be8" },
    pf:  { label:"PF",  bg:"#f0fdf4", color:"#16a34a" },
    mei: { label:"MEI", bg:"#fffbeb", color:"#d97706" },
  };
  const methodLabel = { boleto:"Boleto", pix:"Pix", transfer:"Transferência" };

  return (
    <div className="space-y-5">

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* MRR */}
        <div className="rounded-2xl p-5 col-span-2 lg:col-span-1" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#fff" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.45)" }}>Receita Mensal (MRR)</p>
          <p className="text-2xl font-black" style={{ letterSpacing:"-0.5px" }}>{fmtCurrency(totalMRR)}</p>
          <p className="text-xs mt-1" style={{ color:"rgba(255,255,255,0.4)" }}>Ticket médio {fmtCurrency(ticketMedio)}</p>
        </div>
        {/* Status breakdown */}
        <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Em dia</p>
          <p className="text-2xl font-black" style={{ color:"#16a34a" }}>{countPaid}</p>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background:"#e8edf5" }}>
            <div className="h-full rounded-full" style={{ width:`${clients.length ? (countPaid/clients.length*100) : 0}%`, background:"#10b981" }} />
          </div>
          <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>{clients.length ? Math.round(countPaid/clients.length*100) : 0}% da base</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Pendente</p>
          <p className="text-2xl font-black" style={{ color:"#d97706" }}>{countPend}</p>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background:"#e8edf5" }}>
            <div className="h-full rounded-full" style={{ width:`${clients.length ? (countPend/clients.length*100) : 0}%`, background:"#f59e0b" }} />
          </div>
          <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>{clients.length ? Math.round(countPend/clients.length*100) : 0}% da base</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background: countOver > 0 ? "#fff5f5" : "#fff", border:`1px solid ${countOver > 0 ? "#fca5a5" : "#dde3ed"}`, boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Inadimplente</p>
          <p className="text-2xl font-black" style={{ color: countOver > 0 ? "#dc2626" : "#94a3b8" }}>{countOver}</p>
          <p className="text-xs font-semibold mt-2" style={{ color: countOver > 0 ? "#dc2626" : "#cbd5e1" }}>{fmtCurrency(valueOver)}</p>
          <p className="text-[10px] mt-0.5" style={{ color:"#94a3b8" }}>{clients.length ? Math.round(countOver/clients.length*100) : 0}% da base</p>
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom:"1px solid #e8edf5" }}>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente..."
                className="pl-9 pr-3 py-1.5 text-sm rounded-xl outline-none focus:ring-2 focus:ring-blue-400"
                style={{ border:"1px solid #dde3ed", width:180, color:"#374151" }} />
            </div>
            {/* Status filter */}
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
              className="text-sm rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-400"
              style={{ border:"1px solid #dde3ed", color:"#374151" }}>
              <option value="all">Todos status</option>
              <option value="paid">Em dia</option>
              <option value="pending">Pendente</option>
              <option value="overdue">Atrasado</option>
            </select>
            {/* Type filter */}
            <select value={filterType} onChange={e=>setFilterType(e.target.value)}
              className="text-sm rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-400"
              style={{ border:"1px solid #dde3ed", color:"#374151" }}>
              <option value="all">Todos tipos</option>
              <option value="pj">PJ</option>
              <option value="pf">PF</option>
              <option value="mei">MEI</option>
            </select>
            {filtered.length !== clients.length && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background:"#dbeafe", color:"#2b8be8" }}>
                {filtered.length} de {clients.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex p-1 rounded-xl" style={{ background:"#e8edf5" }}>
              <button onClick={()=>setViewMode("cards")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={viewMode==="cards" ? {background:"#fff",color:"#2b8be8",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"} : {color:"#64748b"}}>
                ⊞ Cards
              </button>
              <button onClick={()=>setViewMode("list")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={viewMode==="list" ? {background:"#fff",color:"#2b8be8",boxShadow:"0 1px 3px rgba(0,0,0,0.08)"} : {color:"#64748b"}}>
                ≡ Lista
              </button>
            </div>
            <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all"
              style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" }}
              onMouseEnter={e=>{e.currentTarget.style.background="#dcfce7";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#f0fdf4";}}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Importar
            </button>
            <button onClick={() => open()} className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}>
              <Icon.Plus />Novo Cliente
            </button>
          </div>
        </div>

        {/* ── CARDS VIEW ── */}
        {viewMode === "cards" && (
          <div className="p-4">
            {filtered.length === 0 ? (
              <div className="text-center py-12" style={{ color:"#94a3b8" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mx-auto mb-2 opacity-30"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                <p className="text-sm">Nenhum cliente encontrado.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(c => {
                  const st = statusCfg[c.paymentStatus || "pending"];
                  const tp = typeCfg[c.type || "pj"];
                  return (
                    <div key={c.id} className="rounded-2xl p-5 group transition-all hover:shadow-md"
                      style={{ background:"#fff", border:`1px solid ${st.border}`, borderTop:`3px solid ${st.dot}`, boxShadow:"0 2px 6px rgba(26,29,35,0.05)" }}>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-bold text-sm truncate" style={{ color:"#1a1d23" }}>{c.name}</h3>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background:tp.bg, color:tp.color }}>{tp.label}</span>
                          </div>
                          <p className="text-xs" style={{ color:"#94a3b8" }}>{c.document || "—"}</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => setClientTimeline(c)} className="p-1.5 rounded-lg transition-colors" style={{ color:"#94a3b8" }} title="Timeline do cliente"
                            onMouseEnter={e=>{e.currentTarget.style.background="#f0fdf4";e.currentTarget.style.color="#10b981";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                          </button>
                          <button onClick={() => setClientDetail(c)} className="p-1.5 rounded-lg transition-colors" style={{ color:"#94a3b8" }} title="Ver ficha"
                            onMouseEnter={e=>{e.currentTarget.style.background="#fdf4ff";e.currentTarget.style.color="#a855f7";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}><Icon.Eye /></button>
                          <button onClick={() => open(c)} className="p-1.5 rounded-lg transition-colors" style={{ color:"#94a3b8" }}
                            onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.color="#2b8be8";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}><Icon.Edit /></button>
                          <button onClick={() => deleteClient(c.id)} className="p-1.5 rounded-lg transition-colors" style={{ color:"#94a3b8" }}
                            onMouseEnter={e=>{e.currentTarget.style.background="#fef2f2";e.currentTarget.style.color="#ef4444";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}><Icon.Trash /></button>
                        </div>
                      </div>

                      {/* Fee + method */}
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="p-2.5 rounded-xl" style={{ background:"#f5f7fb" }}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color:"#94a3b8" }}>Honorários</p>
                          <p className="font-bold text-sm" style={{ color:"#1a1d23" }}>{fmtCurrency(c.monthlyFee)}</p>
                        </div>
                        <div className="p-2.5 rounded-xl" style={{ background:"#f5f7fb" }}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color:"#94a3b8" }}>Pagamento</p>
                          <p className="font-medium text-sm" style={{ color:"#374151" }}>{methodLabel[c.paymentMethod] || "—"}</p>
                        </div>
                      </div>

                      {/* Status buttons */}
                      <div className="flex gap-1.5">
                        {Object.entries(statusCfg).map(([k, v]) => {
                          const active = (c.paymentStatus || "pending") === k;
                          return (
                            <button key={k} onClick={() => updateClient({ ...c, paymentStatus: k })}
                              className="flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all"
                              style={active
                                ? { background:v.bg, color:v.color, border:`1px solid ${v.border}` }
                                : { background:"#f5f7fb", color:"#94a3b8", border:"1px solid #e8edf5" }}>
                              {v.label}
                            </button>
                          );
                        })}
                      </div>

                      {c.notes && <p className="text-xs mt-3 px-2.5 py-2 rounded-xl" style={{ color:"#64748b", background:"#f8fafc", border:"1px solid #e8edf5" }}>{c.notes}</p>}
                      {c.dueDates?.length > 0 && (
                        <div className="mt-3 pt-3" style={{ borderTop:"1px solid #f0f4f8" }}>
                          <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color:"#94a3b8" }}>Vencimentos</p>
                          {c.dueDates.map(d => (
                            <div key={d.id} className="flex justify-between text-xs mb-1">
                              <span style={{ color:"#374151" }}>{d.description}</span>
                              <span className="font-medium px-1.5 py-0.5 rounded" style={{ background:"#f0f4f8", color:"#64748b" }}>{fmt(d.date)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {viewMode === "list" && (
          <div className="overflow-x-auto">
            {filtered.length === 0 ? (
              <div className="text-center py-12" style={{ color:"#94a3b8" }}>
                <p className="text-sm">Nenhum cliente encontrado.</p>
              </div>
            ) : (
              <table className="w-full text-left min-w-[640px]">
                <thead>
                  <tr style={{ borderBottom:"2px solid #e8edf5", background:"#f8fafc" }}>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Cliente</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Tipo</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Honorários</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Pagamento</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Status</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-right" style={{ color:"#94a3b8" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const st = statusCfg[c.paymentStatus || "pending"];
                    const tp = typeCfg[c.type || "pj"];
                    return (
                      <tr key={c.id} className="group" style={{ borderBottom:"1px solid #f0f4f8" }}
                        onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold" style={{ color:"#1a1d23" }}>{c.name}</p>
                          <p className="text-xs" style={{ color:"#94a3b8" }}>{c.document || "—"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background:tp.bg, color:tp.color }}>{tp.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-bold" style={{ color:"#1a1d23" }}>{fmtCurrency(c.monthlyFee)}</p>
                          <p className="text-xs" style={{ color:"#94a3b8" }}>{methodLabel[c.paymentMethod] || "—"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs" style={{ color:"#64748b" }}>{methodLabel[c.paymentMethod] || "—"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {Object.entries(statusCfg).map(([k, v]) => {
                              const active = (c.paymentStatus || "pending") === k;
                              return (
                                <button key={k} onClick={() => updateClient({ ...c, paymentStatus: k })}
                                  className="px-2 py-1 text-[10px] font-bold rounded-lg transition-all"
                                  style={active
                                    ? { background:v.bg, color:v.color, border:`1px solid ${v.border}` }
                                    : { background:"transparent", color:"#cbd5e1", border:"1px solid #e8edf5" }}>
                                  {v.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => open(c)} className="p-1.5 rounded-lg transition-colors" style={{ color:"#94a3b8" }}
                              onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.color="#2b8be8";}}
                              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}><Icon.Edit /></button>
                            <button onClick={() => deleteClient(c.id)} className="p-1.5 rounded-lg transition-colors" style={{ color:"#94a3b8" }}
                              onMouseEnter={e=>{e.currentTarget.style.background="#fef2f2";e.currentTarget.style.color="#ef4444";}}
                              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}><Icon.Trash /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:"2px solid #e8edf5", background:"#f8fafc" }}>
                    <td className="px-4 py-3 text-xs font-bold" style={{ color:"#64748b" }}>{filtered.length} cliente(s)</td>
                    <td /><td />
                    <td className="px-4 py-3">
                      <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{fmtCurrency(filtered.reduce((s,c)=>s+(c.monthlyFee||0),0))}</p>
                      <p className="text-[10px]" style={{ color:"#94a3b8" }}>total filtrado</p>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── MODAL ── */}
      {isOpen && (
        <Modal title={editing ? "Editar Cliente" : "Novo Cliente"} onClose={() => { setIsOpen(false); setEditing(null); }} maxWidth="max-w-2xl">
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: dados básicos */}
              <div className="space-y-4">
                <p className="text-xs font-black uppercase tracking-widest pb-2" style={{ color:"#94a3b8", borderBottom:"1px solid #e8edf5" }}>Dados Básicos</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Razão Social / Nome *</label>
                  <input value={cf.name} onChange={e=>setCf(p=>({...p,name:e.target.value}))} className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }} />
                </div>
                {/* Tipo PF/PJ/MEI */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">Tipo</label>
                  <div className="flex gap-2">
                    {Object.entries(typeCfg).map(([k, v]) => (
                      <button key={k} type="button" onClick={() => setCf(p=>({...p,type:k}))}
                        className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                        style={cf.type===k ? { background:v.bg, color:v.color, border:`2px solid ${v.color}40` } : { background:"#f5f7fb", color:"#64748b", border:"1px solid #dde3ed" }}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">CNPJ / CPF</label>
                  <input value={cf.document} onChange={e=>setCf(p=>({...p,document:e.target.value}))} className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Honorários (R$)</label>
                    <input value={cf.monthlyFee} onChange={e=>setCf(p=>({...p,monthlyFee:e.target.value}))} placeholder="1500.00" className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Forma de Pagamento</label>
                    <select value={cf.paymentMethod} onChange={e=>setCf(p=>({...p,paymentMethod:e.target.value}))} className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }}>
                      <option value="pix">Pix</option><option value="boleto">Boleto</option><option value="transfer">Transferência</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">Status de Pagamento</label>
                  <div className="flex gap-2">
                    {Object.entries(statusCfg).map(([k, v]) => (
                      <button key={k} type="button" onClick={() => setCf(p=>({...p,paymentStatus:k}))}
                        className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                        style={cf.paymentStatus===k ? { background:v.bg, color:v.color, border:`2px solid ${v.border}` } : { background:"#f5f7fb", color:"#64748b", border:"1px solid #dde3ed" }}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Observações</label>
                  <textarea value={cf.notes} onChange={e=>setCf(p=>({...p,notes:e.target.value}))} rows={2} className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none resize-none" style={{ borderColor:"#dde3ed" }} />
                </div>
              </div>
              {/* Right: vencimentos */}
              <div className="space-y-4">
                <p className="text-xs font-black uppercase tracking-widest pb-2" style={{ color:"#94a3b8", borderBottom:"1px solid #e8edf5" }}>Vencimentos / Obrigações</p>
                <div className="space-y-2 p-3 rounded-xl" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
                  <input type="text" value={ddDesc} onChange={e=>setDdDesc(e.target.value)} placeholder="Descrição (ex: DAS, Folha de Pagamento)"
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }} />
                  <div className="flex gap-2">
                    <input type="date" value={ddDate} onChange={e=>setDdDate(e.target.value)}
                      className="flex-1 border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }} />
                    <button type="button"
                      onClick={() => { if(ddDesc && ddDate){ setDueDates([...dueDates,{id:uid(),description:ddDesc,date:ddDate}]); setDdDesc(""); setDdDate(""); }}}
                      className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                      + Add
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {dueDates.length === 0 && <p className="text-xs text-center py-4" style={{ color:"#cbd5e1" }}>Nenhum vencimento adicionado.</p>}
                  {dueDates.map(d => (
                    <div key={d.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl group/dd"
                      style={{ background:"#fff", border:"1px solid #dde3ed" }}>
                      <div>
                        <p className="text-xs font-semibold" style={{ color:"#1a1d23" }}>{d.description}</p>
                        <p className="text-xs" style={{ color:"#94a3b8" }}>{fmt(d.date)}</p>
                      </div>
                      <button type="button" onClick={()=>setDueDates(dueDates.filter(x=>x.id!==d.id))}
                        className="p-1 rounded opacity-0 group-hover/dd:opacity-100 transition-opacity" style={{ color:"#94a3b8" }}
                        onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}>
                        <Icon.Trash />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-3" style={{ borderTop:"1px solid #e8edf5" }}>
              <button type="button" onClick={()=>{setIsOpen(false);setEditing(null);}} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ color:"#64748b", background:"#f5f7fb" }}>Cancelar</button>
              <button type="button" onClick={save} className="px-5 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}>Salvar Cliente</button>
            </div>
          </div>
        </Modal>
      )}
      {importOpen && (
        <ImportClientsModal
          onClose={() => setImportOpen(false)}
          existingClients={clients}
          onImport={handleImport}
        />
      )}

      {/* ITEM 5 — Ficha completa do cliente */}
      {clientDetail && (
        <ClientDetailModal client={clientDetail} onClose={() => setClientDetail(null)} onEdit={() => { open(clientDetail); setClientDetail(null); }} />
      )}
      {clientTimeline && (
        <ClientTimeline client={clientTimeline} onClose={() => setClientTimeline(null)} />
      )}
    </div>
  );
}

// ============================================================
// FINANCES
// ============================================================

// ============================================================
// OBLIGATIONS
// ============================================================
function Obligations() {
  const { clients, updateClient } = useApp();
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear]   = useState(new Date().getFullYear());
  const [tab, setTab]                   = useState("overview");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [isAddOpen, setIsAddOpen]       = useState(false);
  const [isGlobalAddOpen, setIsGlobalAddOpen] = useState(false);
  const [newOb, setNewOb]               = useState({ name:"", type:"fiscal", dueDate:15, repeatMonthly:true });
  const [newGlobal, setNewGlobal]       = useState({ name:"", type:"fiscal", dueDate:15 });
  const [search, setSearch]             = useState("");
  const [filterType, setFilterType]     = useState("all");

  // Global obligations stored separately in localStorage
  const [globalObs, setGlobalObs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("globalObligations") || "[]"); } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("globalObligations", JSON.stringify(globalObs)); }, [globalObs]);

  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const obTypes = ["fiscal","trabalhista","contabil","societario","outro"];
  const typeCfg = {
    fiscal:      { label:"Fiscal",      bg:"#fff5f5", color:"#dc2626", border:"#fca5a5" },
    trabalhista: { label:"Trabalhista", bg:"#fffbeb", color:"#d97706", border:"#fde68a" },
    contabil:    { label:"Contábil",    bg:"#eff6ff", color:"#2b8be8", border:"#bfdbfe" },
    societario:  { label:"Societário",  bg:"#f5f3ff", color:"#7c3aed", border:"#ddd6fe" },
    outro:       { label:"Outro",       bg:"#f8fafc", color:"#64748b", border:"#e2e8f0" },
  };

  const selectedClient = clients.find(c => c.id === selectedClientId);

  // Today's day-of-month for urgency detection
  const todayDay = new Date().getDate();
  const isCurrentMonthYear = currentMonth === new Date().getMonth() && currentYear === new Date().getFullYear();

  const getUrgency = (dueDay) => {
    if (!isCurrentMonthYear) return "normal";
    const diff = dueDay - todayDay;
    if (diff < 0) return "overdue";
    if (diff <= 2) return "urgent";
    if (diff <= 5) return "soon";
    return "normal";
  };

  const urgencyCfg = {
    overdue: { label:"Vencida",  bg:"#fff5f5", border:"#fca5a5", dot:"#ef4444", text:"#dc2626" },
    urgent:  { label:"Hoje/Amanhã", bg:"#fffbeb", border:"#fde68a", dot:"#f59e0b", text:"#d97706" },
    soon:    { label:"Em breve", bg:"#fffbeb", border:"#fef3c7", dot:"#fbbf24", text:"#92400e" },
    normal:  { label:"",         bg:"transparent", border:"#f0f4f8", dot:"#94a3b8", text:"#374151" },
  };

  const getEff = (ob, statuses, m, y) => {
    const st = statuses?.find(s => s.obligationId === ob.id && s.month === m && s.year === y);
    return { ...ob, name: st?.customName || ob.name, dueDate: st?.customDueDate || ob.dueDate, isCompleted: !!st?.completed, isIgnored: !!st?.ignored };
  };

  // Build full list: client obligations + global obligations expanded per client
  const allForMonth = useMemo(() => {
    const list = [];
    // Client-specific obligations
    clients.forEach(c => {
      (c.obligations || []).forEach(ob => {
        if (ob.repeatMonthly === false && (ob.month !== currentMonth || ob.year !== currentYear)) return;
        const eff = getEff(ob, c.obligationStatuses, currentMonth, currentYear);
        if (!eff.isIgnored) list.push({ client: c, ob, eff, isGlobal: false });
      });
    });
    // Global obligations — expand per client
    globalObs.forEach(gob => {
      clients.forEach(c => {
        const fakeId = `global_${gob.id}_${c.id}`;
        const st = (c.obligationStatuses || []).find(s => s.obligationId === fakeId && s.month === currentMonth && s.year === currentYear);
        const eff = { ...gob, id: fakeId, isCompleted: !!st?.completed, isIgnored: false };
        list.push({ client: c, ob: { ...gob, id: fakeId }, eff, isGlobal: true, globalObId: gob.id });
      });
    });
    return list.sort((a, b) => a.eff.dueDate - b.eff.dueDate);
  }, [clients, currentMonth, currentYear, globalObs]);

  // Filtered list for overview
  const filtered = useMemo(() => allForMonth.filter(item => {
    if (filterType !== "all" && item.ob.type !== filterType) return false;
    if (search && !item.client.name.toLowerCase().includes(search.toLowerCase()) && !item.eff.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [allForMonth, filterType, search]);

  // KPI counts
  const totalCount     = allForMonth.length;
  const doneCount      = allForMonth.filter(i => i.eff.isCompleted).length;
  const pendingCount   = totalCount - doneCount;
  const urgentCount    = allForMonth.filter(i => !i.eff.isCompleted && getUrgency(i.eff.dueDate) !== "normal").length;
  const completionPct  = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Client progress for sidebar
  const clientProgress = useMemo(() => {
    return clients.map(c => {
      const clientItems = allForMonth.filter(i => i.client.id === c.id);
      const done = clientItems.filter(i => i.eff.isCompleted).length;
      const urgent = clientItems.filter(i => !i.eff.isCompleted && getUrgency(i.eff.dueDate) !== "normal").length;
      return { ...c, total: clientItems.length, done, urgent };
    });
  }, [allForMonth, clients]);

  const toggle = (client, obId) => {
    const st = client.obligationStatuses || [];
    const idx = st.findIndex(s => s.obligationId === obId && s.month === currentMonth && s.year === currentYear);
    const ns = idx >= 0
      ? st.map((s, i) => i === idx ? { ...s, completed: !s.completed } : s)
      : [...st, { obligationId: obId, month: currentMonth, year: currentYear, completed: true }];
    updateClient({ ...client, obligationStatuses: ns });
  };

  const completeAll = (client) => {
    const items = allForMonth.filter(i => i.client.id === client.id && !i.eff.isCompleted);
    let statuses = [...(client.obligationStatuses || [])];
    items.forEach(item => {
      const idx = statuses.findIndex(s => s.obligationId === item.ob.id && s.month === currentMonth && s.year === currentYear);
      if (idx >= 0) statuses[idx] = { ...statuses[idx], completed: true };
      else statuses.push({ obligationId: item.ob.id, month: currentMonth, year: currentYear, completed: true });
    });
    updateClient({ ...client, obligationStatuses: statuses });
  };

  const addObligation = () => {
    if (!selectedClient || !newOb.name) return;
    const ob = { id: uid(), name: newOb.name, type: newOb.type, dueDate: Number(newOb.dueDate), repeatMonthly: newOb.repeatMonthly };
    updateClient({ ...selectedClient, obligations: [...(selectedClient.obligations || []), ob] });
    setIsAddOpen(false); setNewOb({ name:"", type:"fiscal", dueDate:15, repeatMonthly:true });
  };

  const addGlobalObligation = () => {
    if (!newGlobal.name) return;
    setGlobalObs(p => [...p, { id: uid(), name: newGlobal.name, type: newGlobal.type, dueDate: Number(newGlobal.dueDate) }]);
    setIsGlobalAddOpen(false); setNewGlobal({ name:"", type:"fiscal", dueDate:15 });
  };

  // Export CSV
  const exportCSV = () => {
    const header = ["Cliente","Obrigação","Tipo","Vencimento (Dia)","Status","Global"];
    const rows = filtered.map(i => [
      i.client.name, i.eff.name, i.ob.type, i.eff.dueDate,
      i.eff.isCompleted ? "Concluída" : "Pendente",
      i.isGlobal ? "Sim" : "Não",
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type:"text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `obrigacoes-${months[currentMonth]}-${currentYear}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const OblCheckbox = ({ done, onClick }) => (
    <button onClick={onClick}
      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
      style={done
        ? { background:"#10b981", border:"2px solid #10b981" }
        : { background:"#fff", border:"2px solid #dde3ed" }}
      onMouseEnter={e => { if(!done) e.currentTarget.style.borderColor="#2b8be8"; }}
      onMouseLeave={e => { if(!done) e.currentTarget.style.borderColor="#dde3ed"; }}>
      {done && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
    </button>
  );

  return (
    <div className="space-y-5">

      {/* ── HEADER + MONTH NAV ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Tabs */}
        <div className="flex p-1 rounded-xl" style={{ background:"#e8edf5" }}>
          {[["overview","📋 Visão Geral"],["by-client","👤 Por Cliente"]].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={tab===v ? {background:"#fff",color:"#2b8be8",boxShadow:"0 1px 4px rgba(0,0,0,0.08)"} : {color:"#64748b"}}>
              {l}
            </button>
          ))}
        </div>
        {/* Month selector */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background:"#fff", border:"1px solid #dde3ed" }}>
          <button onClick={() => { let m = currentMonth-1, y = currentYear; if(m<0){m=11;y--;} setCurrentMonth(m); setCurrentYear(y); }}
            className="p-0.5 rounded hover:bg-slate-100"><Icon.ChevronLeft /></button>
          <span className="text-sm font-bold w-32 text-center" style={{ color:"#1a1d23" }}>
            {months[currentMonth]} {currentYear}
          </span>
          <button onClick={() => { let m = currentMonth+1, y = currentYear; if(m>11){m=0;y++;} setCurrentMonth(m); setCurrentYear(y); }}
            className="p-0.5 rounded hover:bg-slate-100"><Icon.ChevronRight /></button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl p-5 col-span-2 lg:col-span-1" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#fff" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.45)" }}>Taxa de Conclusão</p>
          <p className="text-3xl font-black" style={{ color: completionPct===100?"#10b981": completionPct>=60?"#5aaff5":"#f59e0b" }}>{completionPct}%</p>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background:"rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width:`${completionPct}%`, background: completionPct===100?"#10b981":"#5aaff5" }} />
          </div>
          <p className="text-[10px] mt-1.5" style={{ color:"rgba(255,255,255,0.4)" }}>{doneCount} de {totalCount} concluídas</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Pendentes</p>
          <p className="text-2xl font-black" style={{ color:"#d97706" }}>{pendingCount}</p>
          <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>obrigações em aberto</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background: urgentCount > 0 ? "#fffbeb":"#fff", border:`1px solid ${urgentCount>0?"#fde68a":"#dde3ed"}`, boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Urgentes</p>
          <p className="text-2xl font-black" style={{ color: urgentCount > 0 ? "#d97706":"#94a3b8" }}>{urgentCount}</p>
          <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>vencem em ≤ 2 dias</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Globais</p>
          <p className="text-2xl font-black" style={{ color:"#7c3aed" }}>{globalObs.length}</p>
          <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>para todos os clientes</p>
        </div>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          {/* Toolbar */}
          <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom:"1px solid #e8edf5" }}>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente ou obrigação..."
                  className="pl-9 pr-3 py-1.5 text-sm rounded-xl outline-none focus:ring-2 focus:ring-blue-400"
                  style={{ border:"1px solid #dde3ed", width:220, color:"#374151" }} />
              </div>
              {/* Type filter */}
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                className="text-sm rounded-xl px-3 py-1.5 outline-none" style={{ border:"1px solid #dde3ed", color:"#374151" }}>
                <option value="all">Todos os tipos</option>
                {obTypes.map(t => <option key={t} value={t}>{typeCfg[t]?.label || t}</option>)}
              </select>
              {filtered.length !== allForMonth.length && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background:"#dbeafe", color:"#2b8be8" }}>
                  {filtered.length} de {allForMonth.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsGlobalAddOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-xl transition-all"
                style={{ color:"#7c3aed", background:"#f5f3ff", border:"1px solid #ddd6fe" }}
                onMouseEnter={e=>e.currentTarget.style.background="#ede9fe"} onMouseLeave={e=>e.currentTarget.style.background="#f5f3ff"}>
                <Icon.Plus />Global
              </button>
              <button onClick={exportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-xl transition-all"
                style={{ color:"#16a34a", background:"#f0fdf4", border:"1px solid #bbf7d0" }}
                onMouseEnter={e=>e.currentTarget.style.background="#dcfce7"} onMouseLeave={e=>e.currentTarget.style.background="#f0fdf4"}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[580px]">
              <thead style={{ background:"#f8fafc", borderBottom:"2px solid #e8edf5" }}>
                <tr>
                  {["","Dia","Cliente","Obrigação","Tipo","Status"].map((h,i) => (
                    <th key={i} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color:"#94a3b8" }}>
                    Nenhuma obrigação encontrada.
                  </td></tr>
                ) : filtered.map((item, i) => {
                  const urg = getUrgency(item.eff.dueDate);
                  const urgStyle = urgencyCfg[urg];
                  const tp = typeCfg[item.ob.type] || typeCfg.outro;
                  return (
                    <tr key={i} className="group" style={{ borderBottom:"1px solid #f0f4f8", background: item.eff.isCompleted ? "#fafafa" : urg !== "normal" ? urgStyle.bg : "transparent", opacity: item.eff.isCompleted ? 0.65 : 1 }}
                      onMouseEnter={e=>{ if(!item.eff.isCompleted) e.currentTarget.style.background="#f8fafc"; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background = item.eff.isCompleted ? "#fafafa" : urg!=="normal" ? urgStyle.bg : "transparent"; }}>
                      <td className="px-4 py-3">
                        <OblCheckbox done={item.eff.isCompleted} onClick={() => toggle(item.client, item.ob.id)} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {urg !== "normal" && !item.eff.isCompleted && (
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: urgStyle.dot }} />
                          )}
                          <span className="text-sm font-bold" style={{ color: urg!=="normal" && !item.eff.isCompleted ? urgStyle.text : "#1a1d23" }}>
                            {item.eff.dueDate}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold" style={{ color:"#1a1d23", textDecoration: item.eff.isCompleted?"line-through":"none" }}>{item.client.name}</p>
                          {item.isGlobal && <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background:"#f5f3ff", color:"#7c3aed" }}>G</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color:"#64748b", textDecoration: item.eff.isCompleted?"line-through":"none" }}>{item.eff.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background:tp.bg, color:tp.color, border:`1px solid ${tp.border}` }}>{tp.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {item.eff.isCompleted
                          ? <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" }}>✓ Concluída</span>
                          : urg !== "normal"
                            ? <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background:urgStyle.bg, color:urgStyle.text, border:`1px solid ${urgStyle.border}` }}>{urgStyle.label}</span>
                            : <span className="text-[10px]" style={{ color:"#cbd5e1" }}>Pendente</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Global obligations manager */}
          {globalObs.length > 0 && (
            <div className="p-4" style={{ borderTop:"1px solid #e8edf5" }}>
              <p className="text-xs font-black uppercase tracking-wide mb-3" style={{ color:"#94a3b8" }}>Obrigações Globais do Escritório</p>
              <div className="flex flex-wrap gap-2">
                {globalObs.map(g => (
                  <div key={g.id} className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background:"#f5f3ff", border:"1px solid #ddd6fe" }}>
                    <span className="text-xs font-semibold" style={{ color:"#7c3aed" }}>{g.name}</span>
                    <span className="text-[10px]" style={{ color:"#a78bfa" }}>· Dia {g.dueDate}</span>
                    <button onClick={() => setGlobalObs(p => p.filter(x => x.id !== g.id))}
                      className="p-0.5 rounded" style={{ color:"#c4b5fd" }}
                      onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#c4b5fd"}>
                      <Icon.X />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BY-CLIENT TAB ── */}
      {tab === "by-client" && (
        <div className="flex flex-col lg:flex-row gap-5" style={{ minHeight:560 }}>
          {/* Client list with progress */}
          <div className="w-full lg:w-80 flex-shrink-0 rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
            <div className="p-4" style={{ borderBottom:"1px solid #e8edf5", background:"#f8fafc" }}>
              <p className="text-xs font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Clientes</p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight:520 }}>
              {clientProgress.length === 0 && (
                <p className="p-4 text-sm text-center" style={{ color:"#94a3b8" }}>Nenhum cliente cadastrado.</p>
              )}
              {clientProgress.map(c => {
                const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
                const active = selectedClientId === c.id;
                return (
                  <button key={c.id} onClick={() => setSelectedClientId(c.id)}
                    className="w-full text-left px-4 py-3 transition-all group/btn"
                    style={{ borderBottom:"1px solid #f0f4f8", background: active ? "#eff6ff" : "transparent" }}
                    onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="#f8fafc"; }}
                    onMouseLeave={e=>{ e.currentTarget.style.background = active ? "#eff6ff" : "transparent"; }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold truncate pr-2" style={{ color: active ? "#2b8be8" : "#1a1d23" }}>{c.name}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {c.urgent > 0 && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background:"#fffbeb", color:"#d97706", border:"1px solid #fde68a" }}>⚠ {c.urgent}</span>
                        )}
                        <span className="text-[10px] font-semibold" style={{ color:"#94a3b8" }}>{c.done}/{c.total}</span>
                      </div>
                    </div>
                    {c.total > 0 && (
                      <div className="h-1 rounded-full overflow-hidden" style={{ background:"#e8edf5" }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width:`${pct}%`, background: pct===100?"#10b981":"#2b8be8" }} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Client detail panel */}
          <div className="flex-1 rounded-2xl overflow-hidden flex flex-col" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
            {!selectedClient ? (
              <div className="flex-1 flex flex-col items-center justify-center py-16" style={{ color:"#94a3b8" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mb-3 opacity-30"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                <p className="text-sm">Selecione um cliente para ver as obrigações.</p>
              </div>
            ) : (
              <>
                {/* Client header */}
                <div className="p-4 flex items-center justify-between" style={{ borderBottom:"1px solid #e8edf5", background:"#f8fafc" }}>
                  <div>
                    <p className="font-black text-sm" style={{ color:"#1a1d23" }}>{selectedClient.name}</p>
                    <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>
                      {allForMonth.filter(i=>i.client.id===selectedClient.id && i.eff.isCompleted).length} de {allForMonth.filter(i=>i.client.id===selectedClient.id).length} obrigações concluídas
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => completeAll(selectedClient)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all"
                      style={{ color:"#16a34a", background:"#f0fdf4", border:"1px solid #bbf7d0" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#dcfce7"} onMouseLeave={e=>e.currentTarget.style.background="#f0fdf4"}>
                      ✓ Marcar todas
                    </button>
                    <button onClick={() => setIsAddOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white rounded-xl"
                      style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                      <Icon.Plus />Nova
                    </button>
                  </div>
                </div>

                {/* Obligations list */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {allForMonth.filter(i => i.client.id === selectedClient.id).length === 0 ? (
                    <div className="text-center py-10 text-sm" style={{ color:"#94a3b8" }}>Nenhuma obrigação para este cliente.</div>
                  ) : allForMonth.filter(i => i.client.id === selectedClient.id).map((item, idx) => {
                    const urg = getUrgency(item.eff.dueDate);
                    const urgStyle = urgencyCfg[urg];
                    const tp = typeCfg[item.ob.type] || typeCfg.outro;
                    return (
                      <div key={idx} className="flex items-center gap-3 px-4 py-3 rounded-xl group/ob transition-all"
                        style={{
                          background: item.eff.isCompleted ? "#f8fafc" : urg!=="normal" ? urgStyle.bg : "#fff",
                          border: `1px solid ${item.eff.isCompleted ? "#e8edf5" : urg!=="normal" ? urgStyle.border : "#e8edf5"}`,
                          borderLeft: `3px solid ${item.eff.isCompleted ? "#e8edf5" : urg!=="normal" ? urgStyle.dot : tp.color}`,
                          opacity: item.eff.isCompleted ? 0.7 : 1,
                        }}>
                        <OblCheckbox done={item.eff.isCompleted} onClick={() => toggle(selectedClient, item.ob.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold" style={{ color:"#1a1d23", textDecoration: item.eff.isCompleted?"line-through":"none" }}>{item.eff.name}</p>
                            {item.isGlobal && <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background:"#f5f3ff", color:"#7c3aed" }}>Global</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background:tp.bg, color:tp.color }}>{tp.label}</span>
                            <span className="text-[10px]" style={{ color: urg!=="normal" && !item.eff.isCompleted ? urgStyle.text : "#94a3b8" }}>
                              Vence dia {item.eff.dueDate}
                              {urg !== "normal" && !item.eff.isCompleted && ` · ${urgStyle.label}`}
                            </span>
                          </div>
                        </div>
                        {!item.isGlobal && (
                          <button onClick={() => updateClient({ ...selectedClient, obligations: (selectedClient.obligations||[]).filter(o => o.id !== item.ob.id) })}
                            className="p-1.5 rounded-lg opacity-0 group-hover/ob:opacity-100 transition-opacity flex-shrink-0"
                            style={{ color:"#94a3b8" }}
                            onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}>
                            <Icon.Trash />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: Nova Obrigação (cliente) ── */}
      {isAddOpen && (
        <Modal title={`Nova Obrigação · ${selectedClient?.name}`} onClose={() => setIsAddOpen(false)}>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nome da Obrigação</label>
              <input value={newOb.name} onChange={e => setNewOb({...newOb, name:e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }}
                placeholder="Ex: Simples Nacional, FGTS, SPED..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo</label>
                <div className="flex flex-wrap gap-1.5">
                  {obTypes.map(t => {
                    const tc = typeCfg[t];
                    return (
                      <button key={t} type="button" onClick={() => setNewOb({...newOb, type:t})}
                        className="px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all"
                        style={newOb.type===t ? {background:tc.bg,color:tc.color,border:`2px solid ${tc.border}`} : {background:"#f5f7fb",color:"#64748b",border:"1px solid #dde3ed"}}>
                        {tc.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Dia do Vencimento</label>
                <input type="number" min="1" max="31" value={newOb.dueDate} onChange={e => setNewOb({...newOb, dueDate:e.target.value})}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" style={{ borderColor:"#dde3ed" }} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color:"#374151" }}>
              <input type="checkbox" checked={newOb.repeatMonthly} onChange={e => setNewOb({...newOb, repeatMonthly:e.target.checked})} className="rounded" />
              Repetir todo mês
            </label>
            <div className="flex justify-end gap-3 pt-2" style={{ borderTop:"1px solid #e8edf5" }}>
              <button type="button" onClick={() => setIsAddOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ color:"#64748b", background:"#f5f7fb" }}>Cancelar</button>
              <button type="button" onClick={addObligation} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: Obrigação Global ── */}
      {isGlobalAddOpen && (
        <Modal title="Nova Obrigação Global" onClose={() => setIsGlobalAddOpen(false)}>
          <div className="p-5 space-y-4">
            <div className="rounded-xl p-3 text-sm" style={{ background:"#f5f3ff", border:"1px solid #ddd6fe", color:"#6d28d9" }}>
              Obrigações globais aparecem automaticamente para <strong>todos os clientes</strong> cadastrados.
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nome</label>
              <input value={newGlobal.name} onChange={e => setNewGlobal({...newGlobal,name:e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 outline-none" style={{ borderColor:"#ddd6fe" }}
                placeholder="Ex: EFD-REINF, DEFIS, e-Social..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tipo</label>
                <div className="flex flex-wrap gap-1.5">
                  {obTypes.map(t => {
                    const tc = typeCfg[t];
                    return (
                      <button key={t} type="button" onClick={() => setNewGlobal({...newGlobal,type:t})}
                        className="px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all"
                        style={newGlobal.type===t ? {background:tc.bg,color:tc.color,border:`2px solid ${tc.border}`} : {background:"#f5f7fb",color:"#64748b",border:"1px solid #dde3ed"}}>
                        {tc.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Dia do Vencimento</label>
                <input type="number" min="1" max="31" value={newGlobal.dueDate} onChange={e => setNewGlobal({...newGlobal,dueDate:e.target.value})}
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 outline-none" style={{ borderColor:"#ddd6fe" }} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2" style={{ borderTop:"1px solid #e8edf5" }}>
              <button type="button" onClick={() => setIsGlobalAddOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ color:"#64748b", background:"#f5f7fb" }}>Cancelar</button>
              <button type="button" onClick={addGlobalObligation} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#a78bfa,#7c3aed)" }}>Criar Global</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================
// REPORTS
// ============================================================
function Reports() {
  const { tasks, categories, contexts, clients, teamUsers, currentProfile, habits } = useApp();
  const [period, setPeriod] = useState(30);
  const [aiFeedback, setAiFeedback] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [activeTab, setActiveTabR] = useState("overview"); // overview | burnout | team | export

  const t = today();
  const periodStart = useMemo(() => { const d = new Date(); d.setDate(d.getDate()-period); return d.toISOString().split("T")[0]; }, [period]);

  const filtered = tasks.filter(x => x.dueDate >= periodStart && x.dueDate <= t || (x.completed && x.dueDate >= periodStart));
  const done = filtered.filter(x => x.completed).length;
  const pending = filtered.filter(x => !x.completed).length;
  const overdue = tasks.filter(x => !x.completed && x.dueDate < t).length;
  const rate = filtered.length > 0 ? Math.round(done/filtered.length*100) : 0;

  // ── Dados por semana para tendência ───────────────────────
  const weeks = useMemo(() => Array.from({length:Math.ceil(period/7)}, (_,i) => {
    const wEnd = new Date(); wEnd.setDate(wEnd.getDate() - i*7);
    const wStart = new Date(wEnd); wStart.setDate(wStart.getDate()-6);
    const s = wStart.toISOString().split("T")[0], e = wEnd.toISOString().split("T")[0];
    const wt = tasks.filter(x => x.dueDate >= s && x.dueDate <= e);
    return { label:`Sem ${Math.ceil(period/7)-i}`, done:wt.filter(x=>x.completed).length, total:wt.length, rate:wt.length>0?Math.round(wt.filter(x=>x.completed).length/wt.length*100):0 };
  }).reverse(), [tasks, period]);

  // ── Análise de burnout ────────────────────────────────────
  const burnoutAnalysis = useMemo(() => {
    const avgPerWeek = weeks.reduce((s,w)=>s+w.total,0) / Math.max(weeks.length,1);
    const lastWeek = weeks[weeks.length-1]?.total || 0;
    const overloadFactor = avgPerWeek > 0 ? lastWeek/avgPerWeek : 1;
    const completionTrend = weeks.length >= 3 ? weeks.slice(-3).map(w=>w.rate) : [rate];
    const trendDown = completionTrend.length >= 2 && completionTrend[completionTrend.length-1] < completionTrend[0] - 15;

    let risk = "baixo";
    let riskColor = "#10b981";
    let riskBg = "rgba(16,185,129,0.08)";
    let signals = [];

    if (overloadFactor > 1.5) { signals.push(`Carga ${Math.round((overloadFactor-1)*100)}% acima da média`); }
    if (overdue > 5) { signals.push(`${overdue} tarefas acumuladas em atraso`); }
    if (trendDown) { signals.push("Taxa de conclusão caindo nas últimas 3 semanas"); }
    if (rate < 40 && filtered.length > 5) { signals.push(`Produtividade baixa (${rate}%)`); }
    if (pending > avgPerWeek * 2) { signals.push(`${pending} tarefas pendentes acumuladas`); }

    if (signals.length >= 3) { risk="alto"; riskColor="#ef4444"; riskBg="rgba(239,68,68,0.08)"; }
    else if (signals.length >= 1) { risk="médio"; riskColor="#f59e0b"; riskBg="rgba(245,158,11,0.08)"; }

    const suggestions = risk === "alto" ? [
      "Redistribuir tarefas para outros membros da equipe",
      "Priorizar somente as 3 tarefas mais críticas do dia",
      "Revisar prazos e negociar extensões onde possível",
      "Considerar um sprint de organização antes de novas demandas",
    ] : risk === "médio" ? [
      "Revisar e eliminar tarefas de baixa prioridade",
      "Definir blocos de foco sem interrupções",
      "Checar se há tarefas que podem ser delegadas",
    ] : [
      "Ritmo saudável — mantenha a consistência!",
      "Boa oportunidade para antecipar demandas futuras",
    ];

    return { risk, riskColor, riskBg, signals, suggestions, overloadFactor, avgPerWeek };
  }, [weeks, overdue, rate, filtered, pending]);

  // ── Análise por categoria ────────────────────────────────
  const catStats = useMemo(() => categories.map(c => {
    const ct = filtered.filter(x=>x.categoryId===c.id);
    return { ...c, total:ct.length, done:ct.filter(x=>x.completed).length, rate:ct.length>0?Math.round(ct.filter(x=>x.completed).length/ct.length*100):0 };
  }).filter(c=>c.total>0).sort((a,b)=>b.total-a.total), [filtered, categories]);

  // ── Previsão de conclusão ────────────────────────────────
  const forecast = useMemo(() => {
    const avgDonePerDay = done / Math.max(period, 1);
    if (avgDonePerDay <= 0 || pending <= 0) return null;
    const daysNeeded = Math.ceil(pending / avgDonePerDay);
    return { daysNeeded, eta: new Date(Date.now() + daysNeeded*24*60*60*1000).toLocaleDateString("pt-BR",{day:"2-digit",month:"long"}) };
  }, [done, period, pending]);

  const generateAI = async () => {
    setAiLoading(true); setAiFeedback(null);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          messages:[{ role:"user", content:
            `Você é um consultor de produtividade para escritório de contabilidade. Analise:
- Período: ${period} dias | Tarefas: ${filtered.length} | Concluídas: ${done} (${rate}%) | Atrasadas: ${overdue}
- Risco de burnout: ${burnoutAnalysis.risk} | Sinais: ${burnoutAnalysis.signals.join("; ")||"nenhum"}
- Categorias mais pesadas: ${catStats.slice(0,3).map(c=>`${c.name}(${c.total})`).join(", ")}
- Média semanal: ${burnoutAnalysis.avgPerWeek.toFixed(1)} tarefas | Previsão conclusão pendentes: ${forecast?.eta||"N/A"}

Responda em JSON puro (sem markdown):
{"resumo":"2 frases diretas","pontos_fortes":["x","y"],"alertas":["x","y"],"acoes_imediatas":["x","y","z"],"previsao":"1 frase sobre tendência"}` }]
        })
      });
      const data = await resp.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g,"").trim();
      setAiFeedback(JSON.parse(clean));
    } catch(e) { setAiFeedback({ resumo:"Erro ao gerar análise.", pontos_fortes:[], alertas:[], acoes_imediatas:[], previsao:"" }); }
    finally { setAiLoading(false); }
  };

  const exportPDF = () => {
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>Relatório — Códice</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1d23;padding:32px;background:#fff}
    h1{font-size:20px;font-weight:900;color:#1a1d23}h2{font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.08em;margin:20px 0 10px}
    .kpi{display:inline-flex;flex-direction:column;padding:12px 18px;border:1px solid #e2e8f0;border-radius:10px;min-width:120px;margin:0 8px 8px 0}
    .kv{font-size:22px;font-weight:900}.kl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
    table{width:100%;border-collapse:collapse}th{font-size:11px;font-weight:700;padding:8px;text-align:left;border-bottom:2px solid #1a1d23}
    td{font-size:11px;padding:7px 8px;border-bottom:1px solid #f0f4f8}
    .risk-${burnoutAnalysis.risk}{color:${burnoutAnalysis.riskColor};font-weight:700}
    </style></head><body>
    <div style="text-align:center;border-bottom:2px solid #1a1d23;padding-bottom:16px;margin-bottom:24px">
      <h1>Códice Contabilidade</h1><p style="font-size:12px;color:#94a3b8;margin-top:4px">Relatório de Produtividade — Últimos ${period} dias — ${new Date().toLocaleDateString("pt-BR")}</p>
    </div>
    <h2>Resumo executivo</h2>
    <div style="margin-bottom:20px">
      <div class="kpi"><div class="kl">Tarefas</div><div class="kv" style="color:#2b8be8">${filtered.length}</div></div>
      <div class="kpi"><div class="kl">Concluídas</div><div class="kv" style="color:#10b981">${done}</div></div>
      <div class="kpi"><div class="kl">Taxa</div><div class="kv" style="color:${rate>=70?'#10b981':rate>=40?'#f59e0b':'#ef4444'}">${rate}%</div></div>
      <div class="kpi"><div class="kl">Atrasadas</div><div class="kv" style="color:#ef4444">${overdue}</div></div>
      <div class="kpi"><div class="kl">Risco Burnout</div><div class="kv class-risk-${burnoutAnalysis.risk}" style="color:${burnoutAnalysis.riskColor}">${burnoutAnalysis.risk.toUpperCase()}</div></div>
    </div>
    <h2>Por categoria</h2>
    <table><thead><tr><th>Categoria</th><th>Total</th><th>Concluídas</th><th>Taxa</th></tr></thead><tbody>
    ${catStats.map(c=>`<tr><td>${c.name}</td><td>${c.total}</td><td>${c.done}</td><td style="font-weight:700;color:${c.rate>=70?'#10b981':'#f59e0b'}">${c.rate}%</td></tr>`).join("")}
    </tbody></table>
    ${burnoutAnalysis.signals.length > 0 ? `<h2 style="margin-top:20px;color:${burnoutAnalysis.riskColor}">⚠ Alertas de burnout</h2><ul style="padding-left:16px">${burnoutAnalysis.signals.map(s=>`<li style="font-size:12px;margin-bottom:4px">${s}</li>`).join("")}</ul>` : ""}
    <div style="padding-top:20px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;text-align:center;margin-top:24px">Códice Contabilidade · Relatório gerado pelo Códice Produtivo</div>
    </body></html>`;
    const w = window.open("","_blank","width=900,height=700");
    w.document.write(html); w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  };

  const TABS = [["overview","📊 Visão Geral"],["burnout","🔥 Burnout & Previsão"],["team","👥 Equipe"]];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23", letterSpacing:"-0.01em" }}>Relatórios & Análise Inteligente</h2>
          <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Insights automáticos com detecção de sobrecarga e previsões</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={e=>setPeriod(Number(e.target.value))}
            className="border rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
            <option value={7}>7 dias</option>
            <option value={14}>14 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
          </select>
          <button onClick={exportPDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={{ background:"rgba(248,250,252,0.9)", color:"#374151", border:"1px solid rgba(221,227,237,0.7)" }}>
            <Icon.Download />PDF
          </button>
          <button onClick={generateAI} disabled={aiLoading} className="flex items-center gap-1.5 px-4 py-1.5 text-white rounded-xl text-xs font-bold disabled:opacity-60"
            style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px rgba(43,139,232,0.25)" }}>
            {aiLoading ? <><Icon.Loader />Analisando...</> : <><Icon.Sparkles />Análise IA</>}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background:"rgba(241,245,249,0.7)", width:"fit-content" }}>
        {TABS.map(([id,label]) => (
          <button key={id} onClick={()=>setActiveTabR(id)}
            className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background:activeTab===id?"rgba(255,255,255,0.98)":"transparent", color:activeTab===id?"#1a1d23":"#94a3b8",
              boxShadow:activeTab===id?"0 2px 8px rgba(26,29,35,0.08)":"none" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: VISÃO GERAL ── */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label:"Total no período", value:filtered.length, color:"#2b8be8", bg:"rgba(43,139,232,0.06)" },
              { label:"Concluídas", value:done, color:"#10b981", bg:"rgba(16,185,129,0.06)" },
              { label:"Taxa de conclusão", value:`${rate}%`, color:rate>=70?"#10b981":rate>=40?"#f59e0b":"#ef4444", bg:rate>=70?"rgba(16,185,129,0.06)":"rgba(245,158,11,0.06)" },
              { label:"Em atraso agora", value:overdue, color:overdue>0?"#ef4444":"#10b981", bg:overdue>0?"rgba(239,68,68,0.06)":"rgba(16,185,129,0.06)", sub:overdue===0?"✓ Tudo em dia":undefined },
            ].map(k => (
              <div key={k.label} className="rounded-2xl p-4 transition-all"
                style={{ background:`rgba(255,255,255,0.98)`, border:`1px solid rgba(221,227,237,0.7)`, boxShadow:"0 4px 16px rgba(26,29,35,0.04)", backdropFilter:"blur(8px)" }}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(26,29,35,0.08)";}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.04)";}}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>{k.label}</div>
                <div className="text-2xl font-black" style={{ color:k.color, fontVariantNumeric:"tabular-nums" }}>{k.value}</div>
                {k.sub && <div className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Gráfico tendência semanal */}
          <div className="rounded-2xl p-6" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)", backdropFilter:"blur(8px)" }}>
            <h3 className="text-sm font-black mb-1" style={{ color:"#1a1d23" }}>Tendência Semanal</h3>
            <p className="text-xs mb-4" style={{ color:"#94a3b8" }}>Evolução da taxa de conclusão</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} barGap={2} barCategoryGap="35%">
                  <defs>
                    <linearGradient id="rg1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2b8be8" stopOpacity="1"/>
                      <stop offset="100%" stopColor="#1d6fd4" stopOpacity="0.8"/>
                    </linearGradient>
                    <linearGradient id="rg2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.9"/>
                      <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.6"/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="0" vertical={false} stroke="rgba(226,232,240,0.4)"/>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:10 }}/>
                  <YAxis axisLine={false} tickLine={false} tick={{ fill:"#cbd5e1", fontSize:10 }} allowDecimals={false} width={20}/>
                  <Tooltip contentStyle={{ borderRadius:12, border:"1px solid rgba(221,227,237,0.8)", boxShadow:"0 8px 24px rgba(26,29,35,0.12)", fontSize:11, background:"rgba(255,255,255,0.98)", backdropFilter:"blur(8px)" }}
                    formatter={(val,name)=>[val,name]} labelStyle={{ fontWeight:700, color:"#1a1d23" }}/>
                  <Bar dataKey="done" name="Concluídas" fill="url(#rg1)" radius={[5,5,0,0]} maxBarSize={32}/>
                  <Bar dataKey="total" name="Total" fill="url(#rg2)" radius={[5,5,0,0]} maxBarSize={32}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por categoria */}
          {catStats.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)" }}>
              <h3 className="text-sm font-black mb-4" style={{ color:"#1a1d23" }}>Desempenho por Categoria</h3>
              <div className="space-y-3">
                {catStats.map(c => (
                  <div key={c.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background:c.color }}/>
                        <span className="text-xs font-semibold" style={{ color:"#374151" }}>{c.name}</span>
                        <span className="text-[10px]" style={{ color:"#94a3b8" }}>{c.done}/{c.total}</span>
                      </div>
                      <span className="text-xs font-black" style={{ color:c.rate>=70?"#10b981":c.rate>=40?"#f59e0b":"#ef4444" }}>{c.rate}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full" style={{ background:"rgba(226,232,240,0.6)" }}>
                      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width:c.rate+"%", background:`linear-gradient(90deg,${c.color},${c.color}cc)` }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Análise IA */}
          {aiFeedback && (
            <div className="rounded-2xl p-5 space-y-4" style={{ background:"linear-gradient(135deg,rgba(43,139,232,0.04),rgba(255,255,255,0.98))", border:"1px solid rgba(43,139,232,0.15)", boxShadow:"0 4px 16px rgba(43,139,232,0.08)" }}>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl flex items-center justify-center text-sm" style={{ background:"rgba(43,139,232,0.1)" }}>✨</div>
                <h3 className="text-sm font-black" style={{ color:"#2b8be8" }}>Análise Inteligente</h3>
              </div>
              <p className="text-sm" style={{ color:"#374151" }}>{aiFeedback.resumo}</p>
              {aiFeedback.pontos_fortes?.length > 0 && (
                <div><p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#10b981" }}>✓ Pontos Fortes</p>
                  <div className="space-y-1">{aiFeedback.pontos_fortes.map((p,i) => <div key={i} className="flex gap-2 text-xs" style={{ color:"#374151" }}><span style={{ color:"#10b981", flexShrink:0 }}>•</span>{p}</div>)}</div></div>
              )}
              {aiFeedback.alertas?.length > 0 && (
                <div><p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#f59e0b" }}>⚠ Atenção</p>
                  <div className="space-y-1">{aiFeedback.alertas.map((a,i) => <div key={i} className="flex gap-2 text-xs" style={{ color:"#374151" }}><span style={{ color:"#f59e0b", flexShrink:0 }}>•</span>{a}</div>)}</div></div>
              )}
              {aiFeedback.acoes_imediatas?.length > 0 && (
                <div><p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#2b8be8" }}>🎯 Ações Imediatas</p>
                  <div className="space-y-1">{aiFeedback.acoes_imediatas.map((a,i) => <div key={i} className="flex gap-2 text-xs" style={{ color:"#374151" }}><span className="font-bold" style={{ color:"#2b8be8", flexShrink:0 }}>{i+1}.</span>{a}</div>)}</div></div>
              )}
              {aiFeedback.previsao && <p className="text-xs italic p-3 rounded-xl" style={{ background:"rgba(43,139,232,0.06)", color:"#2b8be8", border:"1px solid rgba(43,139,232,0.12)" }}>📈 {aiFeedback.previsao}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: BURNOUT & PREVISÃO ── */}
      {activeTab === "burnout" && (
        <div className="space-y-5">
          {/* Medidor de risco */}
          <div className="rounded-2xl p-6" style={{ background:`rgba(255,255,255,0.98)`, border:`1.5px solid ${burnoutAnalysis.riskColor}30`, boxShadow:`0 4px 24px ${burnoutAnalysis.riskColor}0a`, backdropFilter:"blur(8px)" }}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color:"#94a3b8" }}>Risco de Sobrecarga / Burnout</p>
                <div className="flex items-center gap-3">
                  <div className="text-4xl font-black uppercase" style={{ color:burnoutAnalysis.riskColor }}>{burnoutAnalysis.risk}</div>
                  <div className="flex flex-col gap-1">
                    <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background:"rgba(226,232,240,0.5)" }}>
                      <div className="h-2 rounded-full transition-all"
                        style={{ width:burnoutAnalysis.risk==="baixo"?"25%":burnoutAnalysis.risk==="médio"?"60%":"90%", background:`linear-gradient(90deg,#10b981,${burnoutAnalysis.riskColor})` }}/>
                    </div>
                    <p className="text-[10px]" style={{ color:"#94a3b8" }}>
                      {burnoutAnalysis.risk==="baixo"?"Tudo equilibrado":burnoutAnalysis.risk==="médio"?"Atenção recomendada":"Intervenção necessária"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color:"#94a3b8" }}>Média semanal</p>
                <p className="text-2xl font-black" style={{ color:"#1a1d23" }}>{burnoutAnalysis.avgPerWeek.toFixed(1)}</p>
                <p className="text-[10px]" style={{ color:"#94a3b8" }}>tarefas/semana</p>
              </div>
            </div>
            {burnoutAnalysis.signals.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color:burnoutAnalysis.riskColor }}>Sinais detectados</p>
                {burnoutAnalysis.signals.map((s,i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background:burnoutAnalysis.riskBg, border:`1px solid ${burnoutAnalysis.riskColor}20` }}>
                    <span style={{ color:burnoutAnalysis.riskColor }}>⚡</span>
                    <span className="text-xs" style={{ color:"#374151" }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sugestões */}
          <div className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)" }}>
            <p className="text-sm font-black mb-3" style={{ color:"#1a1d23" }}>💡 Sugestões de Ação</p>
            <div className="space-y-2">
              {burnoutAnalysis.suggestions.map((s,i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl transition-all"
                  style={{ background:"rgba(248,250,252,0.7)", border:"1px solid rgba(226,232,240,0.6)" }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=burnoutAnalysis.riskColor+"40";e.currentTarget.style.transform="translateX(3px)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(226,232,240,0.6)";e.currentTarget.style.transform="translateX(0)";}}>
                  <span className="font-black text-sm flex-shrink-0" style={{ color:burnoutAnalysis.riskColor }}>{i+1}</span>
                  <span className="text-xs" style={{ color:"#374151" }}>{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Previsão */}
          {forecast && (
            <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,rgba(168,85,247,0.06),rgba(255,255,255,0.98))", border:"1px solid rgba(168,85,247,0.15)", boxShadow:"0 4px 16px rgba(168,85,247,0.06)" }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color:"#a855f7" }}>📅 Previsão de Conclusão</p>
              <p className="text-sm" style={{ color:"#374151" }}>
                No ritmo atual, as <strong>{pending} tarefas pendentes</strong> serão concluídas em aproximadamente{" "}
                <strong style={{ color:"#a855f7" }}>{forecast.daysNeeded} dias</strong> — estimativa para <strong>{forecast.eta}</strong>.
              </p>
              <p className="text-xs mt-2" style={{ color:"#94a3b8" }}>Baseado na média de {(done/period).toFixed(1)} tarefas/dia no período selecionado.</p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: EQUIPE ── */}
      {activeTab === "team" && (
        <div className="space-y-4">
          {(teamUsers||[]).length <= 1 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
              <p className="text-3xl mb-3">👥</p>
              <p className="font-bold" style={{ color:"#1a1d23" }}>Sem equipe para analisar</p>
              <p className="text-xs mt-1" style={{ color:"#94a3b8" }}>Adicione colaboradores na aba Equipe</p>
            </div>
          ) : (
            (teamUsers||[]).map(u => {
              const uTasks = tasks.filter(x => x.assignedTo === u.id);
              const uDone = uTasks.filter(x=>x.completed).length;
              const uOverdue = uTasks.filter(x=>!x.completed&&x.dueDate<t).length;
              const uRate = uTasks.length>0?Math.round(uDone/uTasks.length*100):0;
              const uWeeks = Array.from({length:4},(_,i)=>{
                const we=new Date(); we.setDate(we.getDate()-i*7);
                const ws=new Date(we); ws.setDate(ws.getDate()-6);
                const s2=ws.toISOString().split("T")[0],e2=we.toISOString().split("T")[0];
                const wt=uTasks.filter(x=>x.dueDate>=s2&&x.dueDate<=e2);
                return wt.filter(x=>x.completed).length;
              }).reverse();
              const riskU = uOverdue > 3 || uRate < 30 ? "alto" : uOverdue > 1 || uRate < 50 ? "médio" : "baixo";
              const riskCU = { alto:"#ef4444", médio:"#f59e0b", baixo:"#10b981" }[riskU];
              return (
                <div key={u.id} className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)" }}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-black text-white" style={{ background:u.avatarColor||"#2b8be8", boxShadow:`0 3px 10px ${u.avatarColor||"#2b8be8"}44` }}>{u.name.charAt(0)}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{u.name}</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:riskCU+"15", color:riskCU }}>Burnout: {riskU}</span>
                      </div>
                      <p className="text-[10px]" style={{ color:"#94a3b8" }}>{u.role}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      {[{l:"Tarefas",v:uTasks.length,c:"#2b8be8"},{l:"Concluídas",v:uDone,c:"#10b981"},{l:"Atrasadas",v:uOverdue,c:uOverdue>0?"#ef4444":"#10b981"}].map(k=>(
                        <div key={k.l}><p className="text-lg font-black" style={{ color:k.c }}>{k.v}</p><p className="text-[9px]" style={{ color:"#94a3b8" }}>{k.l}</p></div>
                      ))}
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full mb-1" style={{ background:"rgba(226,232,240,0.5)" }}>
                    <div className="h-1.5 rounded-full" style={{ width:uRate+"%", background:`linear-gradient(90deg,${u.avatarColor||"#2b8be8"},${u.avatarColor||"#2b8be8"}cc)` }}/>
                  </div>
                  <p className="text-[10px]" style={{ color:"#94a3b8" }}>{uRate}% de conclusão</p>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


// ============================================================
// SEVERANCE SIMULATION
// ============================================================

// Tabela INSS 2024
function calcINSS(salario) {
  const faixas = [
    { ate: 1412.00, aliq: 0.075 },
    { ate: 2666.68, aliq: 0.09 },
    { ate: 4000.03, aliq: 0.12 },
    { ate: 7786.02, aliq: 0.14 },
  ];
  let inss = 0;
  let base = salario;
  let anterior = 0;
  for (const f of faixas) {
    if (base <= 0) break;
    const faixaVal = f.ate - anterior;
    const tributavel = Math.min(base, faixaVal);
    inss += tributavel * f.aliq;
    base -= tributavel;
    anterior = f.ate;
  }
  return Math.min(inss, 908.86);
}

// Tabela IRRF 2024
function calcIRRF(base) {
  if (base <= 2259.20) return 0;
  if (base <= 2826.65) return base * 0.075 - 169.44;
  if (base <= 3751.05) return base * 0.15 - 381.44;
  if (base <= 4664.68) return base * 0.225 - 662.77;
  return base * 0.275 - 896.00;
}

function diffMonths(admissao, demissao) {
  const a = new Date(admissao), d = new Date(demissao);
  return (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth()) + (d.getDate() >= a.getDate() ? 0 : -1);
}

function calcularRescisao(data) {
  const { name, cpf, cargo, admissionDate, dismissalDate, salary, noticeType,
    hasOverdueVacations, vacationPeriods, reason, calculateFGTS, dependentes } = data;
  const sal = parseFloat(salary) || 0;
  const meses = diffMonths(admissionDate, dismissalDate);
  const demissao = new Date(dismissalDate + "T12:00:00");
  const diaDemo = demissao.getDate();
  const diasNoMes = new Date(demissao.getFullYear(), demissao.getMonth() + 1, 0).getDate();
  const mesesCompletos = Math.floor(meses);
  const semJustaCausa = reason === "Dispensa sem justa causa";
  const comJustaCausa = reason === "Dispensa com justa causa";
  const acordo = reason.includes("acordo");

  // Aviso prévio proporcional (Lei 12.506/2011): 30 dias + 3 por ano completo
  const anos = Math.floor(mesesCompletos / 12);
  const diasAviso = Math.min(30 + anos * 3, 90);

  const verbas = [];
  const memoriaLinhas = [];

  // 1. Saldo de salário
  const saldoDias = noticeType === "Trabalhado" ? diasNoMes : diaDemo;
  const saldoSalario = (sal / diasNoMes) * saldoDias;
  verbas.push({ id: uid(), description: `Saldo de Salário (${saldoDias} dias)`, provento: +saldoSalario.toFixed(2), desconto: 0 });
  memoriaLinhas.push(`**Saldo de Salário:** R$ ${sal.toFixed(2)} ÷ ${diasNoMes} dias × ${saldoDias} dias = **R$ ${saldoSalario.toFixed(2)}**`);

  // 2. Aviso prévio (só para sem justa causa e acordo)
  const temAviso = !comJustaCausa && noticeType !== "Não se aplica" && (semJustaCausa || acordo);
  if (temAviso) {
    const aviso = sal * (diasAviso / 30);
    const label = noticeType === "Trabalhado" ? "Trabalhado" : "Indenizado";
    verbas.push({ id: uid(), description: `Aviso Prévio ${label} (${diasAviso} dias)`, provento: +aviso.toFixed(2), desconto: 0 });
    memoriaLinhas.push(`**Aviso Prévio ${label} (Lei 12.506/2011):** ${diasAviso} dias (30 + ${anos}×3) = R$ ${sal.toFixed(2)} × ${(diasAviso/30).toFixed(4)} = **R$ ${aviso.toFixed(2)}**`);
  }

  // 3. 13º proporcional (aviso indenizado conta como mês trabalhado)
  if (!comJustaCausa) {
    const meses13 = (noticeType === "Indenizado" && temAviso)
      ? Math.min((mesesCompletos % 12) + 1, 12)
      : (mesesCompletos % 12);
    if (meses13 > 0) {
      const deci = (sal / 12) * meses13;
      verbas.push({ id: uid(), description: `13º Salário Proporcional (${meses13}/12 avos)`, provento: +deci.toFixed(2), desconto: 0 });
      memoriaLinhas.push(`**13º Proporcional:** R$ ${sal.toFixed(2)} ÷ 12 × ${meses13} = **R$ ${deci.toFixed(2)}**`);
    }
  }

  // 4. Férias proporcionais + 1/3 (exceto justa causa)
  if (!comJustaCausa) {
    const mesesFerias = (noticeType === "Indenizado" && temAviso)
      ? Math.min((mesesCompletos % 12) + 1, 12)
      : (mesesCompletos % 12);
    if (mesesFerias > 0) {
      const feriasProp = (sal / 12) * mesesFerias;
      const umTerco = feriasProp / 3;
      verbas.push({ id: uid(), description: `Férias Proporcionais (${mesesFerias}/12) + 1/3`, provento: +(feriasProp + umTerco).toFixed(2), desconto: 0 });
      memoriaLinhas.push(`**Férias Proporcionais:** R$ ${sal.toFixed(2)} ÷ 12 × ${mesesFerias} = R$ ${feriasProp.toFixed(2)} + 1/3 (R$ ${umTerco.toFixed(2)}) = **R$ ${(feriasProp + umTerco).toFixed(2)}**`);
    }
  }

  // 5. Férias vencidas + 1/3 (exceto justa causa)
  if (hasOverdueVacations && !comJustaCausa) {
    const numPeriodos = parseInt(vacationPeriods) || 1;
    for (let i = 0; i < numPeriodos; i++) {
      const fv = sal + sal / 3;
      verbas.push({ id: uid(), description: `Férias Vencidas ${numPeriodos > 1 ? `(${i+1}º período) ` : ""}+ 1/3`, provento: +fv.toFixed(2), desconto: 0 });
      memoriaLinhas.push(`**Férias Vencidas${numPeriodos > 1 ? ` (período ${i+1})` : ""}:** R$ ${sal.toFixed(2)} + 1/3 (R$ ${(sal/3).toFixed(2)}) = **R$ ${fv.toFixed(2)}**`);
    }
  }

  // 6. FGTS do mês rescindido (8% sobre saldo + aviso trabalhado)
  if (calculateFGTS) {
    const baseFGTSmes = saldoSalario + (noticeType === "Trabalhado" && temAviso ? sal * (diasAviso/30) : 0);
    const totalFGTSMes = baseFGTSmes * 0.08;
    verbas.push({ id: uid(), description: "FGTS (8% - competência rescisão)", provento: +totalFGTSMes.toFixed(2), desconto: 0 });
    memoriaLinhas.push(`**FGTS (mês rescisório, 8%):** R$ ${baseFGTSmes.toFixed(2)} × 8% = **R$ ${totalFGTSMes.toFixed(2)}**`);

    if (semJustaCausa || acordo) {
      const saldoFGTSacumulado = sal * 0.08 * mesesCompletos;
      const baseMulta = saldoFGTSacumulado + totalFGTSMes;
      const multa = baseMulta * 0.40;
      verbas.push({ id: uid(), description: "Multa Rescisória FGTS (40%)", provento: +multa.toFixed(2), desconto: 0 });
      memoriaLinhas.push(`**Multa FGTS 40%:** saldo estimado R$ ${baseMulta.toFixed(2)} × 40% = **R$ ${multa.toFixed(2)}** *(estimativa — conferir saldo real na CEF)*`);
      if (acordo) {
        const multaAcordo = baseMulta * 0.20;
        verbas.push({ id: uid(), description: "Multa FGTS Adicional - Acordo (20%)", provento: +multaAcordo.toFixed(2), desconto: 0 });
        memoriaLinhas.push(`**Multa Adicional Acordo 20% (art. 484-A CLT):** R$ ${baseMulta.toFixed(2)} × 20% = **R$ ${multaAcordo.toFixed(2)}**`);
      }
    }
  }

  // 7. INSS (sobre salário base, tabela progressiva 2024)
  const inss = calcINSS(sal);
  verbas.push({ id: uid(), description: "INSS (tabela progressiva 2024)", provento: 0, desconto: +inss.toFixed(2) });
  memoriaLinhas.push(`**INSS (tabela progressiva 2024):** sobre R$ ${sal.toFixed(2)} = **R$ ${inss.toFixed(2)}**`);

  // 8. IRRF (base = salário - INSS - dedução dependentes R$189,59 cada)
  const deducaoDep = (parseInt(dependentes) || 0) * 189.59;
  const baseIRRF = Math.max(0, sal - inss - deducaoDep);
  const irrf = calcIRRF(baseIRRF);
  if (irrf > 0) {
    verbas.push({ id: uid(), description: `IRRF${deducaoDep > 0 ? ` (${dependentes} dep.)` : ""}`, provento: 0, desconto: +irrf.toFixed(2) });
    memoriaLinhas.push(`**IRRF:** base R$ ${sal.toFixed(2)} − INSS R$ ${inss.toFixed(2)}${deducaoDep>0?` − dep. R$ ${deducaoDep.toFixed(2)}`:""}  = R$ ${baseIRRF.toFixed(2)} → tabela = **R$ ${irrf.toFixed(2)}**`);
  } else {
    memoriaLinhas.push(`**IRRF:** base R$ ${baseIRRF.toFixed(2)} → abaixo do limite de isenção (**R$ 0,00**)`);
  }

  const admFmt = new Date(admissionDate + "T12:00:00").toLocaleDateString("pt-BR");
  const demFmt = new Date(dismissalDate + "T12:00:00").toLocaleDateString("pt-BR");

  return {
    employeeInfo: { name, cpf, cargo, admissionDate: admFmt, dismissalDate: demFmt, reason, baseSalary: sal, dependentes, diasAviso, mesesCompletos, anos },
    verbas,
    memoriaCalculo: memoriaLinhas.join("\n\n"),
    observacoes: `Este cálculo é uma **simulação estimada** baseada nas informações fornecidas. Os valores de INSS e IRRF seguem as tabelas vigentes na data do cálculo, devendo ser conferidos caso haja atualização posterior. O FGTS e a multa rescisória incidem apenas quando aplicável ao tipo de contrato e motivo da rescisão. Os valores de IRRF podem variar conforme deduções específicas (previdência privada, pensão alimentícia, dependentes, etc.). **Recomenda-se conferir os valores no sistema oficial de folha de pagamento antes de efetuar o pagamento.**`
  };
}

function SeveranceSimulation() {
  const { clients } = useApp();

  const [view, setView]           = useState("list");
  const [saved, setSaved] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [verbas, setVerbas]         = useState([]);
  const [formData, setFormData]     = useState(null);
  const [erroCalc, setErroCalc]     = useState("");
  const [sigLeft, setSigLeft]       = useState("Códice Contabilidade");
  const [sigRight, setSigRight]     = useState("");
  const [editObs, setEditObs]           = useState("");
  const [editingObs, setEditingObs]     = useState(false);
  const [editMemoria, setEditMemoria]   = useState("");
  const [editingMemoria, setEditingMemoria] = useState(false);

  // Carregar simulações do banco (compartilhado entre todos os usuários da equipe)
  const { severanceSimulations } = useApp();
  useEffect(() => {
    if (severanceSimulations?.length > 0) {
      setSaved(severanceSimulations);
    }
  }, [severanceSimulations]);

  const [f, setF] = useState({
    clientId: "", name: "", cpf: "", cargo: "",
    admissionDate: "", dismissalDate: "", salary: "", dependentes: "0",
    noticeType: "Indenizado", hasOverdueVacations: false,
    vacationPeriods: "1", reason: "Dispensa sem justa causa", calculateFGTS: true
  });
  const setFld = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const handleClientSelect = (clientId) => {
    const c = clients.find(x => x.id === clientId);
    setFld("clientId", clientId);
    if (c) setFld("name", c.name);
  };

  const tempoEmpresa = useMemo(() => {
    if (!f.admissionDate || !f.dismissalDate) return null;
    const meses = diffMonths(f.admissionDate, f.dismissalDate);
    if (isNaN(meses) || meses < 0) return null;
    const anos = Math.floor(meses / 12);
    const m = Math.floor(meses % 12);
    const diasAviso = Math.min(30 + Math.floor(meses / 12) * 3, 90);
    return { anos, meses: m, total: meses, diasAviso };
  }, [f.admissionDate, f.dismissalDate]);

  const semJustaCausa = f.reason === "Dispensa sem justa causa";
  const comJustaCausa = f.reason === "Dispensa com justa causa";
  const acordo = f.reason.includes("acordo");
  const mostraAviso  = !comJustaCausa && f.reason !== "Pedido de demissão";
  const mostraFGTS   = !comJustaCausa;
  const mostraFerias = !comJustaCausa;

  const totalProv = verbas.reduce((s, v) => s + (Number(v.provento) || 0), 0);
  const totalDesc = verbas.reduce((s, v) => s + (Number(v.desconto) || 0), 0);
  const totalLiq  = totalProv - totalDesc;

  const handlePrint = () => {
    if (!reportData) return;
    const rc = reasonColors[reportData.employeeInfo.reason] || {};

    const rows = verbas.map(v => {
      const hasProv = v.provento > 0;
      const hasDesc = v.desconto > 0;
      return "<tr style='border-bottom:1px solid #e8edf5'>" +
        "<td style='padding:8px 4px;color:#374151;font-size:13px'>" + v.description + "</td>" +
        "<td style='padding:8px 4px;text-align:right;font-size:13px;font-weight:600;color:" + (hasProv ? "#2b8be8" : "#cbd5e1") + "'>" + (hasProv ? fmtCurrency(v.provento) : "—") + "</td>" +
        "<td style='padding:8px 4px;text-align:right;font-size:13px;font-weight:600;color:" + (hasDesc ? "#ef4444" : "#cbd5e1") + "'>" + (hasDesc ? fmtCurrency(v.desconto) : "—") + "</td>" +
        "</tr>";
    }).join("");

    const infoRows = [
      ["Colaborador", reportData.employeeInfo.name],
      ["CPF", reportData.employeeInfo.cpf || "—"],
      ["Cargo", reportData.employeeInfo.cargo || "—"],
      ["Admissão", reportData.employeeInfo.admissionDate],
      ["Demissão", reportData.employeeInfo.dismissalDate],
      ["Tempo de Empresa", reportData.employeeInfo.anos + " ano(s) e " + (reportData.employeeInfo.mesesCompletos % 12) + " mês(es)"],
      ["Dias de Aviso Prévio", reportData.employeeInfo.diasAviso + " dias"],
      ["Motivo da Saída", reportData.employeeInfo.reason],
      ["Salário Base", fmtCurrency(reportData.employeeInfo.baseSalary)],
      ["Dependentes", reportData.employeeInfo.dependentes || "0"],
    ].map(([k, v]) =>
      "<div style='display:flex;gap:4px;padding:3px 0;font-size:13px;color:#374151'><strong style='color:#1a1d23;min-width:180px'>" + k + ":</strong><span>" + v + "</span></div>"
    ).join("");

    const memoriaHtml = reportData.memoriaCalculo
      .split("\n\n")
      .map(p => "<p style='margin:0 0 8px;color:#374151;font-size:12px;line-height:1.6'>" + p.replace(/\*\*(.*?)\*\*/g, "<strong style='color:#1a1d23'>$1</strong>") + "</p>")
      .join("");

    const obsHtml = reportData.observacoes.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    const html = "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'/><title>Rescisão — " + reportData.employeeInfo.name + "</title>" +
      "<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1a1d23;background:#fff;padding:30px 40px;font-size:13px}" +
      "h1{font-size:22px;font-weight:900;color:#1a1d23;margin-bottom:4px}" +
      "h2{font-size:14px;font-weight:700;color:#374151;margin-bottom:2px}" +
      "h3{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;margin-bottom:12px}" +
      ".section{margin-bottom:28px}" +
      "table{width:100%;border-collapse:collapse}" +
      "th{font-size:12px;font-weight:700;padding:8px 4px;border-bottom:2px solid #1a1d23;color:#1a1d23}" +
      ".kpi-row{display:flex;gap:16px;margin-bottom:28px}" +
      ".kpi{flex:1;border:1px solid #dde3ed;border-radius:10px;padding:14px}" +
      ".kpi-label{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:4px}" +
      ".kpi-value{font-size:20px;font-weight:900}" +
      ".kpi-dark{background:linear-gradient(135deg,#1c1f26,#1e2e4a);color:#fff;border-color:transparent}" +
      ".memo-box{background:#f8fafc;border:1px solid #e8edf5;border-radius:8px;padding:14px}" +
      ".obs-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;color:#78350f}" +
      ".assinatura{display:flex;justify-content:space-between;padding-top:24px;margin-top:32px;border-top:1px solid #dde3ed}" +
      ".assinatura-col{width:200px;text-align:center}" +
      ".linha-assinatura{border-top:2px solid #1a1d23;padding-top:8px;margin-top:48px;font-size:12px;font-weight:600}" +
      "@media print{body{padding:15px 20px}}" +
      "</style></head><body>" +

      "<div style='text-align:center;padding-bottom:20px;border-bottom:2px solid #1a1d23;margin-bottom:28px'>" +
        "<h1>Códice Contabilidade</h1>" +
        "<h2>Relatório de Liquidação de Contrato de Trabalho</h2>" +
        "<p style='font-size:12px;color:#94a3b8;font-style:italic;margin-top:4px'>Acerto de Vínculo — Cálculo Rescisório</p>" +
      "</div>" +

      "<div class='kpi-row'>" +
        "<div class='kpi kpi-dark'><div class='kpi-label' style='color:rgba(255,255,255,.45)'>Total Líquido</div><div class='kpi-value' style='color:#10b981'>" + fmtCurrency(totalLiq) + "</div><div style='font-size:10px;color:rgba(255,255,255,.35);margin-top:4px'>a pagar ao colaborador</div></div>" +
        "<div class='kpi'><div class='kpi-label'>Proventos</div><div class='kpi-value' style='color:#2b8be8'>" + fmtCurrency(totalProv) + "</div></div>" +
        "<div class='kpi'><div class='kpi-label'>Descontos</div><div class='kpi-value' style='color:#ef4444'>" + fmtCurrency(totalDesc) + "</div></div>" +
        "<div class='kpi' style='background:" + (rc.bg||"#f8fafc") + ";border-color:" + (rc.border||"#e8edf5") + "'><div class='kpi-label'>Motivo</div><div style='font-size:12px;font-weight:900;color:" + (rc.color||"#1a1d23") + ";line-height:1.3'>" + reportData.employeeInfo.reason + "</div></div>" +
      "</div>" +

      "<div class='section'><h3>1. Dados de Identificação</h3><div style='padding-left:16px'>" + infoRows + "</div></div>" +

      "<div class='section'><h3>2. Resumo Financeiro</h3>" +
        "<table><thead><tr>" +
          "<th style='text-align:left'>Descrição</th>" +
          "<th style='text-align:right'>Proventos</th>" +
          "<th style='text-align:right'>Descontos</th>" +
        "</tr></thead><tbody>" + rows + "</tbody>" +
        "<tfoot>" +
          "<tr style='border-top:2px solid #1a1d23'>" +
            "<td style='padding:10px 4px;font-weight:900;font-size:13px'>Subtotais</td>" +
            "<td style='padding:10px 4px;text-align:right;font-weight:900;color:#2b8be8;font-size:13px'>" + fmtCurrency(totalProv) + "</td>" +
            "<td style='padding:10px 4px;text-align:right;font-weight:900;color:#ef4444;font-size:13px'>" + fmtCurrency(totalDesc) + "</td>" +
          "</tr>" +
          "<tr style='border-top:1px solid #e8edf5'>" +
            "<td style='padding:10px 4px;font-weight:900;font-size:15px;color:#1a1d23'>TOTAL LÍQUIDO A PAGAR</td>" +
            "<td colspan='2' style='padding:10px 4px;text-align:right;font-weight:900;font-size:15px;color:#10b981'>" + fmtCurrency(totalLiq) + "</td>" +
          "</tr>" +
        "</tfoot></table>" +
      "</div>" +

      "<div class='section'><h3>3. Memória de Cálculo</h3><div class='memo-box'>" +
        editMemoria.split("\n\n").filter(l=>l.trim()).map(l =>
          "<p style='margin-bottom:8px;line-height:1.7'>" + l.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") + "</p>"
        ).join("") +
      "</div></div>" +

      "<div class='section'><h3>4. Observações</h3><div class='obs-box'>" + editObs.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") + "</div></div>" +

      "<div class='assinatura'>" +
        "<div class='assinatura-col'><div class='linha-assinatura'>" + (sigLeft||"Códice Contabilidade") + "</div></div>" +
        "<div class='assinatura-col'><div class='linha-assinatura'>" + (sigRight||reportData.employeeInfo.name) + (reportData.employeeInfo.cpf ? "<br/><span style='font-size:11px;color:#94a3b8;font-weight:400'>CPF: " + reportData.employeeInfo.cpf + "</span>" : "") + "</div></div>" +
      "</div>" +

      "</body></html>";

    const win = window.open("", "_blank", "width=900,height=700");
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  const saveSimulation = async () => {
    const entry = {
      id: uid(),
      date: new Date().toISOString(),
      clientId: formData.clientId||null,
      employeeName: reportData.employeeInfo.name,
      cargo: reportData.employeeInfo.cargo,
      reason: reportData.employeeInfo.reason,
      dismissalDate: reportData.employeeInfo.dismissalDate,
      netAmount: totalLiq,
      reportData, verbas, formData
    };
    setSaved(p => [entry, ...p]);
    // Salvar no banco
    await db.upsert("severance_simulations", {
      id: entry.id,
      employee_name: entry.employeeName,
      client_name: formData.clientName||"",
      client_id: entry.clientId,
      reason: entry.reason,
      dismissal_date: entry.dismissalDate,
      net_amount: entry.netAmount,
      report_data: entry.reportData,
      verbas: entry.verbas,
      form_data: entry.formData,
    }).catch(console.error);
    setView("list");
    // Recarregar lista do banco para garantir sincronia
    setSaved(p => [entry, ...p.filter(x => x.id !== entry.id)]);
  };

  const handleGerar = () => {
    setErroCalc("");
    if (!f.name.trim())   { setErroCalc("Informe o nome do colaborador."); return; }
    if (!f.admissionDate) { setErroCalc("Informe a data de admissão."); return; }
    if (!f.dismissalDate) { setErroCalc("Informe a data de demissão."); return; }
    if (!f.salary || isNaN(parseFloat(f.salary))) { setErroCalc("Informe o salário."); return; }
    if (new Date(f.dismissalDate) <= new Date(f.admissionDate)) { setErroCalc("Data de demissão deve ser posterior à admissão."); return; }
    try {
      const res = calcularRescisao(f);
      setFormData(f); setReportData(res); setVerbas(res.verbas);
      setSigRight(f.name || "");
      setEditObs(res.observacoes || "");
      setEditMemoria(res.memoriaCalculo || "");
      setView("result");
    } catch (err) { setErroCalc("Erro ao calcular: " + err.message); }
  };

  const reasonColors = {
    "Dispensa sem justa causa":                  { bg:"#fff5f5", color:"#dc2626", border:"#fca5a5" },
    "Pedido de demissão":                        { bg:"#fffbeb", color:"#d97706", border:"#fde68a" },
    "Dispensa com justa causa":                  { bg:"#f0fdf4", color:"#16a34a", border:"#bbf7d0" },
    "Término de contrato de experiência":        { bg:"#eff6ff", color:"#2b8be8", border:"#bfdbfe" },
    "Rescisão por acordo (Reforma Trabalhista)": { bg:"#f5f3ff", color:"#7c3aed", border:"#ddd6fe" },
  };

  // ── LIST VIEW ──
  if (view === "list") return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black" style={{ color:"#1a1d23" }}>Simulações Rescisórias</h2>
          <p className="text-sm mt-1" style={{ color:"#94a3b8" }}>Cálculos de rescisão de contrato CLT</p>
        </div>
        <button onClick={() => { setReportData(null); setVerbas([]); setFormData(null); setErroCalc(""); setF({ clientId:"", name:"", cpf:"", cargo:"", admissionDate:"", dismissalDate:"", salary:"", dependentes:"0", noticeType:"Indenizado", hasOverdueVacations:false, vacationPeriods:"1", reason:"Dispensa sem justa causa", calculateFGTS:true }); setView("form"); }}
          className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-bold"
          style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}>
          <Icon.Plus />Nova Simulação
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        {saved.length === 0 ? (
          <div className="p-16 text-center">
            <Icon.Calculator />
            <p className="text-sm mt-3" style={{ color:"#94a3b8" }}>Nenhuma simulação salva. Clique em "Nova Simulação" para começar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead style={{ background:"#f8fafc", borderBottom:"2px solid #e8edf5" }}>
                <tr>{["Data","Colaborador","Cargo","Motivo","Demissão","Líquido",""].map(h => (
                  <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {saved.map(s => {
                  const rc = reasonColors[s.reason] || reasonColors["Dispensa sem justa causa"];
                  return (
                    <tr key={s.id} style={{ borderBottom:"1px solid #f0f4f8" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td className="px-4 py-3 text-xs" style={{ color:"#94a3b8" }}>{new Date(s.date).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-3 text-sm font-bold" style={{ color:"#1a1d23" }}>{s.employeeName}</td>
                      <td className="px-4 py-3 text-xs" style={{ color:"#64748b" }}>{s.cargo || "—"}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background:rc.bg, color:rc.color, border:`1px solid ${rc.border}` }}>
                          {(s.reason||"").split(" ").slice(0,2).join(" ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color:"#64748b" }}>{s.dismissalDate}</td>
                      <td className="px-4 py-3 text-sm font-black" style={{ color:"#10b981" }}>{fmtCurrency(s.netAmount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => { setReportData(s.reportData); setVerbas(s.verbas); setFormData(s.formData);
              setSigRight(s.reportData?.employeeInfo?.name || "");
              setEditObs(s.reportData?.observacoes || "");
              setEditMemoria(s.reportData?.memoriaCalculo || "");
              setView("result"); }}
                            className="p-1.5 rounded-lg transition-all" style={{ color:"#2b8be8" }}
                            onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <Icon.Eye />
                          </button>
                          <button onClick={() => { setSaved(p => p.filter(x => x.id !== s.id)); db.delete("severance_simulations", s.id).catch(console.error); }}
                            className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                            onMouseEnter={e=>{ e.currentTarget.style.color="#ef4444"; e.currentTarget.style.background="#fff5f5"; }} onMouseLeave={e=>{ e.currentTarget.style.color="#94a3b8"; e.currentTarget.style.background="transparent"; }}>
                            <Icon.Trash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // ── RESULT VIEW ──
  if (view === "result" && reportData) {
    const rc = reasonColors[reportData.employeeInfo.reason] || {};
    return (
      <div className="space-y-5 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <button onClick={() => setView("list")} className="flex items-center gap-2 text-sm font-semibold" style={{ color:"#64748b" }}
            onMouseEnter={e=>e.currentTarget.style.color="#2b8be8"} onMouseLeave={e=>e.currentTarget.style.color="#64748b"}>
            <Icon.ArrowLeft />Voltar
          </button>
          <div className="flex gap-2">
            <button onClick={saveSimulation}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl transition-all"
              style={{ color:"#2b8be8", background:"#eff6ff", border:"1px solid #bfdbfe" }}
              onMouseEnter={e=>e.currentTarget.style.background="#dbeafe"} onMouseLeave={e=>e.currentTarget.style.background="#eff6ff"}>
              <Icon.Save />Salvar
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white rounded-xl"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}>
              <Icon.Download />Imprimir
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl p-5 col-span-2 lg:col-span-1" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#fff" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.45)" }}>Total Líquido</p>
            <p className="text-2xl font-black" style={{ color:"#10b981" }}>{fmtCurrency(totalLiq)}</p>
            <p className="text-[10px] mt-1" style={{ color:"rgba(255,255,255,0.35)" }}>a pagar ao colaborador</p>
          </div>
          <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Proventos</p>
            <p className="text-2xl font-black" style={{ color:"#2b8be8" }}>{fmtCurrency(totalProv)}</p>
          </div>
          <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Descontos</p>
            <p className="text-2xl font-black" style={{ color:"#ef4444" }}>{fmtCurrency(totalDesc)}</p>
          </div>
          <div className="rounded-2xl p-5" style={{ background: rc.bg || "#f8fafc", border:`1px solid ${rc.border || "#e8edf5"}` }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Motivo</p>
            <p className="text-xs font-black leading-tight" style={{ color: rc.color || "#1a1d23" }}>{reportData.employeeInfo.reason}</p>
          </div>
        </div>

        {/* Relatório formal */}
        <div className="rounded-2xl p-8" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <div className="text-center mb-8 pb-6" style={{ borderBottom:"2px solid #1a1d23" }}>
            <h1 className="text-2xl font-black" style={{ color:"#1a1d23" }}>Códice Contabilidade</h1>
            <h2 className="text-base font-bold mt-1" style={{ color:"#374151" }}>Relatório de Liquidação de Contrato de Trabalho</h2>
            <p className="text-sm italic mt-0.5" style={{ color:"#94a3b8" }}>Acerto de Vínculo — Cálculo Rescisório</p>
          </div>

          <div className="mb-7">
            <h3 className="text-sm font-black uppercase tracking-widest mb-4" style={{ color:"#94a3b8" }}>1. Dados de Identificação</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm ml-4" style={{ color:"#374151" }}>
              {[
                ["Colaborador", reportData.employeeInfo.name],
                ["CPF", reportData.employeeInfo.cpf || "—"],
                ["Cargo", reportData.employeeInfo.cargo || "—"],
                ["Admissão", reportData.employeeInfo.admissionDate],
                ["Demissão", reportData.employeeInfo.dismissalDate],
                ["Tempo de Empresa", `${reportData.employeeInfo.anos} ano(s) e ${reportData.employeeInfo.mesesCompletos % 12} mês(es)`],
                ["Dias de Aviso Prévio", `${reportData.employeeInfo.diasAviso} dias`],
                ["Motivo da Saída", reportData.employeeInfo.reason],
                ["Salário Base", fmtCurrency(reportData.employeeInfo.baseSalary)],
                ["Dependentes", reportData.employeeInfo.dependentes || "0"],
              ].map(([k,v]) => (
                <p key={k}><strong style={{ color:"#1a1d23" }}>{k}:</strong> {v}</p>
              ))}
            </div>
          </div>

          <div className="mb-7">
            <h3 className="text-sm font-black uppercase tracking-widest mb-4" style={{ color:"#94a3b8" }}>2. Resumo Financeiro</h3>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr style={{ borderBottom:"2px solid #1a1d23" }}>
                  <th className="py-2 font-bold" style={{ color:"#1a1d23" }}>Descrição</th>
                  <th className="py-2 text-right font-bold" style={{ color:"#1a1d23" }}>Proventos</th>
                  <th className="py-2 text-right font-bold" style={{ color:"#1a1d23" }}>Descontos</th>
                  <th className="py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {verbas.map(v => (
                  <tr key={v.id} style={{ borderBottom:"1px solid #e8edf5" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td className="py-2">
                      <input type="text" value={v.description} onChange={e => setVerbas(vs => vs.map(x => x.id===v.id ? {...x,description:e.target.value} : x))}
                        className="bg-transparent border-none focus:ring-0 p-0 w-full text-sm" style={{ color:"#374151" }} />
                    </td>
                    <td className="py-2 text-right">
                      <input type="number" value={v.provento} onChange={e => setVerbas(vs => vs.map(x => x.id===v.id ? {...x,provento:parseFloat(e.target.value)||0} : x))}
                        className="bg-transparent border-none focus:ring-0 p-0 w-28 text-right text-sm font-semibold" style={{ color: v.provento>0?"#2b8be8":"#cbd5e1" }} />
                    </td>
                    <td className="py-2 text-right">
                      <input type="number" value={v.desconto} onChange={e => setVerbas(vs => vs.map(x => x.id===v.id ? {...x,desconto:parseFloat(e.target.value)||0} : x))}
                        className="bg-transparent border-none focus:ring-0 p-0 w-28 text-right text-sm font-semibold" style={{ color: v.desconto>0?"#ef4444":"#cbd5e1" }} />
                    </td>
                    <td className="py-2 text-center">
                      <button onClick={() => setVerbas(vs => vs.filter(x => x.id !== v.id))}
                        className="p-1 rounded" style={{ color:"#e2e8f0" }}
                        onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#e2e8f0"}>
                        <Icon.Trash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:"2px solid #1a1d23" }}>
                  <td className="py-3 font-black text-sm" style={{ color:"#1a1d23" }}>Subtotais</td>
                  <td className="py-3 text-right font-black text-sm" style={{ color:"#2b8be8" }}>{fmtCurrency(totalProv)}</td>
                  <td className="py-3 text-right font-black text-sm" style={{ color:"#ef4444" }}>{fmtCurrency(totalDesc)}</td>
                  <td></td>
                </tr>
                <tr style={{ borderTop:"1px solid #e8edf5" }}>
                  <td className="py-3 font-black" style={{ color:"#1a1d23", fontSize:15 }}>TOTAL LÍQUIDO A PAGAR</td>
                  <td colSpan={2} className="py-3 text-right font-black" style={{ color:"#10b981", fontSize:15 }}>{fmtCurrency(totalLiq)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            <button onClick={() => setVerbas(vs => [...vs, { id:uid(), description:"Nova Verba", provento:0, desconto:0 }])}
              className="mt-3 flex items-center gap-1 text-sm font-semibold" style={{ color:"#2b8be8" }}>
              <Icon.Plus />Adicionar Verba
            </button>
          </div>

          <div className="mb-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>3. Memória de Cálculo</h3>
              <button onClick={()=>setEditingMemoria(v=>!v)}
                className="text-xs font-bold px-2.5 py-1 rounded-lg transition-all"
                style={{ background:editingMemoria?"rgba(43,139,232,0.1)":"rgba(241,245,249,0.8)", color:editingMemoria?"#2b8be8":"#64748b", border:"1px solid rgba(226,232,240,0.7)" }}>
                {editingMemoria ? "✓ Fechar" : "✏️ Editar"}
              </button>
            </div>
            {editingMemoria ? (
              <div className="ml-4 space-y-2">
                <p className="text-[10px]" style={{ color:"#94a3b8" }}>
                  Cada parágrafo é uma linha separada. Use <strong>**texto**</strong> para negrito.
                </p>
                <textarea
                  value={editMemoria}
                  onChange={e=>setEditMemoria(e.target.value)}
                  rows={Math.max(8, (editMemoria.match(/\n/g)||[]).length + 4)}
                  className="w-full border rounded-xl px-4 py-3 text-xs font-mono resize-y focus:ring-2 focus:ring-blue-300"
                  style={{ borderColor:"rgba(221,227,237,0.8)", background:"#f8fafc", color:"#374151", lineHeight:1.7 }}/>
                <div className="flex gap-2">
                  <button onClick={()=>setEditMemoria(reportData.memoriaCalculo||"")}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ background:"rgba(239,68,68,0.08)", color:"#ef4444", border:"1px solid rgba(239,68,68,0.2)" }}>
                    ↺ Restaurar original
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-4 space-y-2 text-sm ml-4" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
                {editMemoria.split("\n\n").filter(l=>l.trim()).map((linha, i) => (
                  <p key={i} style={{ color:"#374151", lineHeight:1.6 }} dangerouslySetInnerHTML={{ __html: linha.replace(/\*\*(.*?)\*\*/g, "<strong style='color:#1a1d23'>$1</strong>") }} />
                ))}
              </div>
            )}
          </div>

          <div className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>4. Observações</h3>
              <button onClick={()=>setEditingObs(v=>!v)}
                className="text-xs font-bold px-2.5 py-1 rounded-lg transition-all"
                style={{ background:editingObs?"rgba(43,139,232,0.1)":"rgba(241,245,249,0.8)", color:editingObs?"#2b8be8":"#64748b", border:"1px solid rgba(226,232,240,0.7)" }}>
                {editingObs ? "✓ Fechar" : "✏️ Editar"}
              </button>
            </div>
            {editingObs ? (
              <textarea value={editObs} onChange={e=>setEditObs(e.target.value)} rows={5}
                className="w-full border rounded-xl px-4 py-3 text-sm ml-4 resize-none focus:ring-2 focus:ring-blue-300"
                style={{ borderColor:"#fde68a", background:"#fffbeb", color:"#78350f", width:"calc(100% - 1rem)" }}/>
            ) : (
              <div className="rounded-xl p-4 text-sm ml-4" style={{ background:"#fffbeb", border:"1px solid #fde68a", color:"#78350f" }}
                dangerouslySetInnerHTML={{ __html: editObs.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
            )}
          </div>

          <div className="pt-8 px-4" style={{ borderTop:"1px solid #dde3ed" }}>
            <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color:"#94a3b8" }}>Assinaturas</p>
            <div className="flex justify-between">
              <div className="w-56 text-center">
                <div className="mt-12 pt-2" style={{ borderTop:"2px solid #1a1d23" }}>
                  <input value={sigLeft} onChange={e=>setSigLeft(e.target.value)}
                    className="text-sm font-semibold text-center bg-transparent border-none outline-none w-full"
                    style={{ color:"#1a1d23" }} placeholder="Nome do responsável"/>
                </div>
              </div>
              <div className="w-56 text-center">
                <div className="mt-12 pt-2" style={{ borderTop:"2px solid #1a1d23" }}>
                  <input value={sigRight} onChange={e=>setSigRight(e.target.value)}
                    className="text-sm font-semibold text-center bg-transparent border-none outline-none w-full"
                    style={{ color:"#1a1d23" }} placeholder="Nome do colaborador"/>
                  {reportData.employeeInfo.cpf && <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>CPF: {reportData.employeeInfo.cpf}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── FORM VIEW ──
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => setView("list")} className="p-2 rounded-xl transition-all" style={{ color:"#64748b", background:"#f5f7fb" }}
          onMouseEnter={e=>e.currentTarget.style.background="#e8edf5"} onMouseLeave={e=>e.currentTarget.style.background="#f5f7fb"}>
          <Icon.ArrowLeft />
        </button>
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23" }}>Nova Simulação Rescisória</h2>
          <p className="text-sm" style={{ color:"#94a3b8" }}>Cálculo de rescisão CLT</p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        <div className="p-4" style={{ background:"#f8fafc", borderBottom:"1px solid #e8edf5" }}>
          <p className="text-xs font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>Dados do Colaborador</p>
        </div>
        <div className="p-5 space-y-4">
          {erroCalc && <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ background:"#fff5f5", border:"1px solid #fca5a5", color:"#dc2626" }}>{erroCalc}</div>}

          {clients.length > 0 && (
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Vincular a Cliente Cadastrado <span style={{ color:"#94a3b8" }}>(opcional)</span></label>
              <select value={f.clientId} onChange={e => handleClientSelect(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }}>
                <option value="">— Selecione um cliente —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Nome do Colaborador *</label>
              <input type="text" value={f.name} onChange={e => setFld("name", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }}
                placeholder="João da Silva" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>CPF</label>
              <input type="text" value={f.cpf} onChange={e => setFld("cpf", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }}
                placeholder="000.000.000-00" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Cargo</label>
              <input type="text" value={f.cargo} onChange={e => setFld("cargo", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }}
                placeholder="Ex: Analista, Auxiliar..." />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Salário Base (R$) *</label>
              <input type="number" step="0.01" min="0" value={f.salary} onChange={e => setFld("salary", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }}
                placeholder="0,00" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Data de Admissão *</label>
              <input type="date" value={f.admissionDate} onChange={e => setFld("admissionDate", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Data de Demissão *</label>
              <input type="date" value={f.dismissalDate} onChange={e => setFld("dismissalDate", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }} />
            </div>
          </div>

          {tempoEmpresa && (
            <div className="rounded-xl p-3 flex flex-wrap items-center gap-4" style={{ background:"#eff6ff", border:"1px solid #bfdbfe" }}>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color:"#2b8be8" }}>Tempo de Empresa</p>
                <p className="text-sm font-black" style={{ color:"#1a1d23" }}>
                  {tempoEmpresa.anos > 0 ? `${tempoEmpresa.anos} ano${tempoEmpresa.anos>1?"s":""} e ` : ""}{tempoEmpresa.meses} mês(es)
                </p>
              </div>
              <div style={{ width:1, height:28, background:"#bfdbfe" }} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color:"#2b8be8" }}>Aviso Prévio</p>
                <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{tempoEmpresa.diasAviso} dias</p>
              </div>
              <div style={{ width:1, height:28, background:"#bfdbfe" }} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide" style={{ color:"#2b8be8" }}>Total em Meses</p>
                <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{Math.floor(tempoEmpresa.total)} meses</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color:"#374151" }}>Motivo da Saída</label>
            <div className="flex flex-wrap gap-2">
              {[
                "Dispensa sem justa causa",
                "Pedido de demissão",
                "Dispensa com justa causa",
                "Término de contrato de experiência",
                "Rescisão por acordo (Reforma Trabalhista)",
              ].map(r => {
                const rc2 = reasonColors[r] || {};
                const active = f.reason === r;
                return (
                  <button key={r} type="button" onClick={() => {
                    setFld("reason", r);
                    if (r === "Dispensa com justa causa" || r === "Pedido de demissão") setFld("noticeType", "Não se aplica");
                    else setFld("noticeType", "Indenizado");
                  }}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl transition-all"
                    style={active ? {background:rc2.bg,color:rc2.color,border:`2px solid ${rc2.border}`} : {background:"#f5f7fb",color:"#64748b",border:"1px solid #dde3ed"}}>
                    {r.split(" ").slice(0,3).join(" ")}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs font-semibold" style={{ color: (reasonColors[f.reason]||{}).color || "#64748b" }}>{f.reason}</p>
          </div>

          {mostraAviso && (
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Aviso Prévio</label>
              <div className="flex gap-2">
                {["Indenizado","Trabalhado","Não se aplica"].map(v => (
                  <button key={v} type="button" onClick={() => setFld("noticeType", v)}
                    className="px-3 py-2 text-xs font-bold rounded-xl transition-all flex-1"
                    style={f.noticeType===v ? {background:"#eff6ff",color:"#2b8be8",border:"2px solid #bfdbfe"} : {background:"#f5f7fb",color:"#64748b",border:"1px solid #dde3ed"}}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Dependentes (IRRF)</label>
              <input type="number" min="0" max="20" value={f.dependentes} onChange={e => setFld("dependentes", e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }} />
              <p className="text-[10px] mt-1" style={{ color:"#94a3b8" }}>R$ 189,59 de dedução por dependente</p>
            </div>
            {mostraFerias && (
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Férias Vencidas?</label>
                <div className="flex gap-2 mt-1">
                  {[["Não",false],["Sim",true]].map(([l,v]) => (
                    <button key={l} type="button" onClick={() => setFld("hasOverdueVacations", v)}
                      className="flex-1 py-2 text-xs font-bold rounded-xl transition-all"
                      style={f.hasOverdueVacations===v ? {background:"#eff6ff",color:"#2b8be8",border:"2px solid #bfdbfe"} : {background:"#f5f7fb",color:"#64748b",border:"1px solid #dde3ed"}}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {f.hasOverdueVacations && mostraFerias && (
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color:"#374151" }}>Quantos períodos de férias vencidas?</label>
              <input type="number" min="1" max="5" value={f.vacationPeriods} onChange={e => setFld("vacationPeriods", e.target.value)}
                className="w-32 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400" style={{ border:"1px solid #dde3ed", color:"#374151" }} />
            </div>
          )}

          {mostraFGTS && (
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color:"#374151" }}>
              <input type="checkbox" checked={f.calculateFGTS} onChange={e => setFld("calculateFGTS", e.target.checked)} className="rounded" />
              Calcular FGTS e Multa Rescisória
              {(semJustaCausa || acordo) && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"#fff5f5", color:"#dc2626", border:"1px solid #fca5a5" }}>inclui multa 40%</span>
              )}
            </label>
          )}

          <div className="flex justify-end pt-4" style={{ borderTop:"1px solid #e8edf5" }}>
            <button type="button" onClick={handleGerar}
              className="flex items-center gap-2 px-6 py-2.5 text-white rounded-xl font-bold text-sm"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px #2b8be840" }}>
              <Icon.Calculator />Gerar Simulação
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS
// ============================================================
function SettingsPage() {
  const { settings, updateSettings, categories, contexts, addCategory, updateCategory, deleteCategory, addContext, updateContext, deleteContext, currentProfile } = useApp();
  const isAdmin = !currentProfile || currentProfile.role === "admin";

  // Carregar tema salvo
  const [theme, setTheme] = useState(() => {
    try { return JSON.parse(localStorage.getItem("cp_theme") || "{}"); } catch { return {}; }
  });

  // Aplicar tema ao montar
  useEffect(() => {
    applyThemeToDOM(theme);
  }, []);

  const applyThemeToDOM = (t) => {
    const root = document.documentElement;
    if (t.accent) {
      root.style.setProperty("--accent", t.accent);
      root.style.setProperty("--accent-light", t.accent + "18");
      // Atualizar todos os elementos com cor de destaque
      document.querySelectorAll("[data-accent]").forEach(el => {
        el.style.background = t.accent;
      });
    }
    if (t.font) {
      root.style.setProperty("--font-family", t.font);
      document.body.style.fontFamily = t.font;
    }
    if (t.radius !== undefined) {
      root.style.setProperty("--radius", t.radius + "px");
    }
    if (t.darkMode) {
      document.documentElement.setAttribute("data-theme", "dark");
      document.body.style.background = "#0f1117";
      document.body.style.color = "#e2e8f0";
      // Aplicar dark mode ao app wrapper
      const appRoot = document.getElementById("root");
      if (appRoot) appRoot.style.background = "#0f1117";
    } else {
      document.documentElement.removeAttribute("data-theme");
      document.body.style.background = "";
      document.body.style.color = "";
      const appRoot = document.getElementById("root");
      if (appRoot) appRoot.style.background = "";
    }
    if (t.density) {
      root.style.setProperty("--density-factor", t.density === "compact" ? "0.75" : t.density === "relaxed" ? "1.25" : "1");
    }
  };

  const applyTheme = (key, value) => {
    const next = { ...theme, [key]: value };
    setTheme(next);
    localStorage.setItem("cp_theme", JSON.stringify(next));
    applyThemeToDOM(next);
  };

  const resetTheme = () => {
    const reset = {};
    setTheme(reset);
    localStorage.setItem("cp_theme", JSON.stringify(reset));
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme");
    const appRoot = document.getElementById("root");
    if (appRoot) appRoot.style.background = "";
  };

  const ACCENTS = [
    { label:"Azul (padrão)", color:"#2b8be8" },
    { label:"Índigo",        color:"#6366f1" },
    { label:"Roxo",          color:"#8b5cf6" },
    { label:"Rosa",          color:"#ec4899" },
    { label:"Vermelho",      color:"#ef4444" },
    { label:"Laranja",       color:"#f97316" },
    { label:"Âmbar",         color:"#f59e0b" },
    { label:"Verde",         color:"#10b981" },
    { label:"Ciano",         color:"#06b6d4" },
    { label:"Cinza",         color:"#64748b" },
  ];

  const FONTS = [
    { label:"Sistema (padrão)", value:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" },
    { label:"Inter",            value:"'Inter',sans-serif" },
    { label:"DM Sans",          value:"'DM Sans',sans-serif" },
    { label:"Roboto",           value:"'Roboto',sans-serif" },
    { label:"Poppins",          value:"'Poppins',sans-serif" },
    { label:"Nunito",           value:"'Nunito',sans-serif" },
  ];

  const [catForm, setCatForm] = useState({ name:"", color:"#2b8be8" });
  const [ctxForm, setCtxForm] = useState({ name:"", color:"#64748b" });
  const [editCat, setEditCat] = useState(null);
  const [editCtx, setEditCtx] = useState(null);

  const saveCat = async () => {
    if (!catForm.name.trim()) return;
    if (editCat) { await updateCategory({ ...editCat, ...catForm }); setEditCat(null); }
    else { await addCategory({ id:uid(), ...catForm }); }
    setCatForm({ name:"", color:"#2b8be8" });
  };

  const saveCtx = async () => {
    if (!ctxForm.name.trim()) return;
    if (editCtx) { await updateContext({ ...editCtx, ...ctxForm }); setEditCtx(null); }
    else { await addContext({ id:uid(), ...ctxForm }); }
    setCtxForm({ name:"", color:"#64748b" });
  };

  const Section = ({ title, icon, children }) => (
    <div className="rounded-2xl overflow-hidden"
      style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)" }}>
      <div className="px-5 py-3.5 flex items-center gap-2.5"
        style={{ borderBottom:"1px solid rgba(226,232,240,0.5)", background:"rgba(248,250,252,0.6)" }}>
        <span className="text-base">{icon}</span>
        <p className="text-xs font-black uppercase tracking-widest" style={{ color:"#374151" }}>{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );

  const Row = ({ label, sub, children, last }) => (
    <div className="flex items-center justify-between py-3.5" style={{ borderBottom: last ? "none" : "1px solid rgba(226,232,240,0.4)" }}>
      <div><p className="text-sm font-semibold" style={{ color:"#1a1d23" }}>{label}</p>{sub && <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>{sub}</p>}</div>
      <div className="flex-shrink-0 ml-4">{children}</div>
    </div>
  );

  const Toggle = ({ value, onChange }) => (
    <button type="button" onClick={() => onChange(!value)}
      className="relative flex-shrink-0 transition-all duration-300"
      style={{ width:44, height:24, borderRadius:12, background: value ? "linear-gradient(135deg,#5aaff5,#2b8be8)" : "rgba(203,213,225,0.7)", boxShadow: value ? "0 2px 8px rgba(43,139,232,0.35)" : "none" }}>
      <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300"
        style={{ left: value ? "calc(100% - 20px)" : 4, boxShadow:"0 1px 4px rgba(0,0,0,0.15)" }}/>
    </button>
  );

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23" }}>Configurações</h2>
          <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Personalize o Códice Produtivo ao seu gosto</p>
        </div>
        <button onClick={resetTheme} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
          style={{ background:"rgba(241,245,249,0.8)", color:"#64748b", border:"1px solid rgba(226,232,240,0.7)" }}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)";e.currentTarget.style.color="#ef4444";}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(241,245,249,0.8)";e.currentTarget.style.color="#64748b";}}>
          ↺ Restaurar padrão
        </button>
      </div>

      {/* APARÊNCIA */}
      <Section title="Aparência & Tema" icon="🎨">
        {/* Cor de destaque */}
        <div className="pb-5 mb-2" style={{ borderBottom:"1px solid rgba(226,232,240,0.4)" }}>
          <p className="text-xs font-bold mb-3" style={{ color:"#374151" }}>Cor de destaque</p>
          <div className="flex gap-2 flex-wrap">
            {ACCENTS.map(a => (
              <button key={a.color} type="button" onClick={()=>applyTheme("accent", a.color)}
                title={a.label}
                className="flex flex-col items-center gap-1 group">
                <div className="w-8 h-8 rounded-xl transition-all duration-200"
                  style={{
                    background: a.color,
                    border: theme.accent===a.color ? "3px solid #1a1d23" : "2px solid transparent",
                    transform: theme.accent===a.color ? "scale(1.2)" : "scale(1)",
                    boxShadow: theme.accent===a.color ? `0 4px 12px ${a.color}60` : `0 2px 6px ${a.color}30`,
                  }}/>
                {theme.accent===a.color && <div className="w-1 h-1 rounded-full" style={{ background:"#1a1d23" }}/>}
              </button>
            ))}
          </div>
          {theme.accent && (
            <p className="text-[10px] mt-2" style={{ color:"#94a3b8" }}>
              Cor ativa: <span className="font-bold" style={{ color:theme.accent }}>{ACCENTS.find(a=>a.color===theme.accent)?.label}</span>
              {" — "}
              <button onClick={()=>applyTheme("accent",undefined)} className="underline" style={{ color:"#94a3b8" }}>remover</button>
            </p>
          )}
        </div>

        <Row label="Modo escuro" sub="Fundo escuro para trabalhar à noite">
          <Toggle value={!!theme.darkMode} onChange={v=>applyTheme("darkMode", v)}/>
        </Row>

        <Row label="Densidade da interface" sub="Compacta economiza espaço, espaçosa melhora leitura">
          <div className="flex gap-1.5">
            {[["compact","Compacta"],["normal","Normal"],["relaxed","Espaçosa"]].map(([v,l]) => (
              <button key={v} onClick={()=>applyTheme("density",v)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                style={{
                  background: (theme.density||"normal")===v ? "linear-gradient(135deg,#1c1f26,#1e2e4a)" : "rgba(241,245,249,0.8)",
                  color: (theme.density||"normal")===v ? "#5aaff5" : "#64748b",
                  border: (theme.density||"normal")===v ? "1px solid rgba(91,170,255,0.2)" : "1px solid rgba(226,232,240,0.6)",
                }}>
                {l}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Fonte da interface" sub="Tipografia usada em toda a aplicação">
          <select value={theme.font||FONTS[0].value} onChange={e=>applyTheme("font",e.target.value)}
            className="border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151", fontFamily:theme.font||"inherit", maxWidth:200 }}>
            {FONTS.map(f=><option key={f.value} value={f.value} style={{ fontFamily:f.value }}>{f.label}</option>)}
          </select>
        </Row>

        <Row label="Arredondamento dos cards" sub={`${theme.radius??16}px — controla bordas de todos os elementos`} last>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={24} step={2} value={theme.radius??16} onChange={e=>applyTheme("radius",Number(e.target.value))}
              className="w-28" style={{ accentColor:"#2b8be8" }}/>
            <div className="w-8 h-8 border-2 border-current rounded flex-shrink-0"
              style={{ borderRadius:(theme.radius??16)+"px", borderColor:"#2b8be8", background:"rgba(43,139,232,0.08)" }}/>
          </div>
        </Row>
      </Section>

      {/* APLICATIVO */}
      <Section title="Aplicativo" icon="⚙️">
        <Row label="Nome do sistema" sub="Exibido na barra lateral">
          <input value={settings.appName||"Códice Produtivo"}
            onChange={e=>updateSettings({...settings,appName:e.target.value})}
            className="border rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-300 w-44"
            style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}/>
        </Row>
        <Row label="Iniciar na aba" sub="Qual página abre ao fazer login" last>
          <select className="border rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}
            value={settings.defaultTab||"dashboard"}
            onChange={e=>updateSettings({...settings,defaultTab:e.target.value})}>
            <option value="dashboard">Dashboard</option>
            <option value="tasks">Tarefas</option>
            <option value="habits">Hábitos</option>
            <option value="clients">Clientes</option>
            <option value="projects">Projetos</option>
          </select>
        </Row>
      </Section>

      {/* CATEGORIAS */}
      {isAdmin && (
        <Section title="Categorias de Tarefas" icon="🏷️">
          <div className="space-y-2 mb-4">
            {categories.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl group transition-all"
                style={{ background:"rgba(248,250,252,0.7)", border:"1px solid rgba(226,232,240,0.6)" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(203,213,225,0.8)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(226,232,240,0.6)"}>
                <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background:c.color }}/>
                <span className="flex-1 text-sm font-medium" style={{ color:"#374151" }}>{c.name}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={()=>{setEditCat(c);setCatForm({name:c.name,color:c.color});}}
                    className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                    <Icon.Edit />
                  </button>
                  <button onClick={()=>deleteCategory(c.id)}
                    className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)";e.currentTarget.style.color="#ef4444";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                    <Icon.Trash />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input type="color" value={catForm.color} onChange={e=>setCatForm(p=>({...p,color:e.target.value}))}
              className="w-9 h-9 rounded-xl cursor-pointer flex-shrink-0" style={{ padding:2, border:"1px solid rgba(226,232,240,0.7)" }}/>
            <input value={catForm.name} onChange={e=>setCatForm(p=>({...p,name:e.target.value}))}
              onKeyDown={e=>e.key==="Enter"&&saveCat()}
              placeholder={editCat?"Editar categoria...":"Nova categoria..."}
              className="flex-1 border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)" }}/>
            <button onClick={saveCat} disabled={!catForm.name.trim()}
              className="px-3 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex-shrink-0"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
              {editCat?"Salvar":"+ Add"}
            </button>
            {editCat && (
              <button onClick={()=>{setEditCat(null);setCatForm({name:"",color:"#2b8be8"});}}
                className="px-3 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-sm">✕</button>
            )}
          </div>
        </Section>
      )}

      {/* CONTEXTOS */}
      {isAdmin && (
        <Section title="Contextos" icon="📍">
          <div className="space-y-2 mb-4">
            {contexts.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl group transition-all"
                style={{ background:"rgba(248,250,252,0.7)", border:"1px solid rgba(226,232,240,0.6)" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(203,213,225,0.8)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(226,232,240,0.6)"}>
                <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background:c.color||"#64748b" }}/>
                <span className="flex-1 text-sm font-medium" style={{ color:"#374151" }}>{c.name}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={()=>{setEditCtx(c);setCtxForm({name:c.name,color:c.color||"#64748b"});}}
                    className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                    <Icon.Edit />
                  </button>
                  <button onClick={()=>deleteContext(c.id)}
                    className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)";e.currentTarget.style.color="#ef4444";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                    <Icon.Trash />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input type="color" value={ctxForm.color} onChange={e=>setCtxForm(p=>({...p,color:e.target.value}))}
              className="w-9 h-9 rounded-xl cursor-pointer flex-shrink-0" style={{ padding:2, border:"1px solid rgba(226,232,240,0.7)" }}/>
            <input value={ctxForm.name} onChange={e=>setCtxForm(p=>({...p,name:e.target.value}))}
              onKeyDown={e=>e.key==="Enter"&&saveCtx()}
              placeholder={editCtx?"Editar contexto...":"Novo contexto..."}
              className="flex-1 border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)" }}/>
            <button onClick={saveCtx} disabled={!ctxForm.name.trim()}
              className="px-3 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex-shrink-0"
              style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
              {editCtx?"Salvar":"+ Add"}
            </button>
            {editCtx && (
              <button onClick={()=>{setEditCtx(null);setCtxForm({name:"",color:"#64748b"});}}
                className="px-3 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-sm">✕</button>
            )}
          </div>
        </Section>
      )}

      {/* CONTA */}
      <Section title="Conta & Sessão" icon="👤">
        <Row label="Usuário logado" sub={currentProfile?.role === "admin" ? "Administrador" : currentProfile?.role || "Colaborador"}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white"
              style={{ background:currentProfile?.avatarColor||"#2b8be8" }}>
              {(currentProfile?.name||"U").charAt(0)}
            </div>
            <span className="text-sm font-semibold" style={{ color:"#374151" }}>{currentProfile?.name||"Usuário"}</span>
          </div>
        </Row>
        <Row label="Tema atual" sub="Personalizações salvas localmente no navegador" last>
          <div className="flex items-center gap-2 text-xs" style={{ color:"#94a3b8" }}>
            {theme.accent && <div className="w-3 h-3 rounded-full" style={{ background:theme.accent }}/>}
            {theme.darkMode && <span>🌙 Escuro</span>}
            {theme.font && theme.font !== FONTS[0].value && <span>Aa</span>}
            {!theme.accent && !theme.darkMode && !theme.font && <span>Padrão</span>}
          </div>
        </Row>
      </Section>
    </div>
  );
}



// ============================================================

// ============================================================
// RELATIONSHIP
// ============================================================
function Relationship() {
  const { relationships, addRelationship, updateRelationship, deleteRelationship, clients } = useApp();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("proximos"); // proximos | az | tipo
  const [rf, setRf] = useState({ name:"", type:"cliente", date:"", isAnnual:true, message:"", notes:"", clientId:"", whatsapp:"", email:"" });

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayMD = String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");

  // Normaliza qualquer formato de data para MM-DD
  const getMD = (r) => {
    const d = r.date || "";
    if (d.length === 5 && d[2] === "-") return d;
    if (d.length === 10 && d[4] === "-") return d.slice(5);
    return d;
  };

  const getDaysUntilNum = (r) => {
    const d = getMD(r);
    if (!d) return 999;
    const [m, day] = d.split("-").map(Number);
    if (!m || !day || isNaN(m) || isNaN(day)) return 999;
    const next = new Date(today.getFullYear(), m-1, day);
    if (next < today) next.setFullYear(today.getFullYear()+1);
    return Math.round((next - today) / (1000*60*60*24));
  };

  const getDaysLabel = (r) => {
    const n = getDaysUntilNum(r);
    if (n === 999) return "—";
    if (n === 0) return "HOJE";
    if (n === 1) return "amanhã";
    if (n <= 30) return n + " dias";
    const months = Math.floor(n / 30);
    return months === 1 ? "1 mês" : months + " meses";
  };

  const formatDate = (r) => {
    const d = r.date || "";
    const isAnn = r.isAnnual === true || r.isAnnual === "true" || r.isAnnual === 1;
    const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    if (isAnn) {
      const md = getMD(r);
      const [m, day] = md.split("-");
      if (!m || !day || isNaN(parseInt(m))) return d;
      return day.padStart(2,"0") + "/" + m.padStart(2,"0");
    }
    if (d.length === 10) {
      const [y,m,day] = d.split("-");
      return day + "/" + m + "/" + y;
    }
    return d;
  };

  const typeColors = {
    cliente:          { bg:"#eff6ff", color:"#2b8be8", border:"#bfdbfe", label:"Cliente",        emoji:"👤" },
    data_comemorativa:{ bg:"#fdf4ff", color:"#a855f7", border:"#e9d5ff", label:"Comemorativa",   emoji:"🎉" },
    fornecedor:       { bg:"#f0fdf4", color:"#10b981", border:"#bbf7d0", label:"Fornecedor",     emoji:"🏢" },
    parceiro:         { bg:"#fff7ed", color:"#f97316", border:"#fed7aa", label:"Parceiro",       emoji:"🤝" },
    outro:            { bg:"#f8fafc", color:"#64748b", border:"#e2e8f0", label:"Outro",          emoji:"📌" },
  };

  const daysColor = (n) => {
    if (n === 0) return "#a855f7";
    if (n <= 7)  return "#ef4444";
    if (n <= 30) return "#f97316";
    return "#94a3b8";
  };

  const todayDates   = (relationships||[]).filter(r => getMD(r) === todayMD);
  const upcomingDates= (relationships||[]).filter(r => { const n = getDaysUntilNum(r); return n > 0 && n <= 7; });

  const openForm = (r=null) => {
    setEditing(r);
    setRf(r ? {
      name:r.name, type:r.type, date:r.date, isAnnual:r.isAnnual===true||r.isAnnual==="true"||r.isAnnual===1,
      message:r.message||"", notes:r.notes||"", clientId:r.clientId||"",
      whatsapp:r.whatsapp||"", email:r.email||""
    } : { name:"", type:"cliente", date:"", isAnnual:true, message:"", notes:"", clientId:"", whatsapp:"", email:"" });
    setIsFormOpen(true);
  };

  const save = async () => {
    if (!rf.name.trim() || !rf.date) return;
    const entry = { ...rf, id: editing ? editing.id : uid(), isAnnual: rf.isAnnual };
    if (editing) await updateRelationship(entry);
    else await addRelationship(entry);
    setIsFormOpen(false); setEditing(null);
  };

  const whatsappLink = (r) => {
    const num = (r.whatsapp||"").replace(/[^0-9]/g,"");
    const msg = encodeURIComponent(r.message || "Ola " + r.name + "!");
    return "https://wa.me/55" + num + "?text=" + msg;
  };

  // Filtrar e ordenar
  const list = (relationships||[])
    .filter(r => filter === "todos" || r.type === filter)
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.notes||"").toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => {
      if (sortBy === "az")    return (a.name||"").localeCompare(b.name||"");
      if (sortBy === "tipo")  return (a.type||"").localeCompare(b.type||"");
      return getDaysUntilNum(a) - getDaysUntilNum(b); // proximos
    });

  // Contadores por tipo
  const counts = (relationships||[]).reduce((acc, r) => { acc[r.type] = (acc[r.type]||0)+1; return acc; }, {});

  return (
    <div className="space-y-4">

      {/* Banner hoje */}
      {todayDates.length > 0 && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background:"linear-gradient(135deg,#6d28d9,#a855f7)", color:"#fff" }}>
          <div className="text-3xl">🎉</div>
          <div>
            <p className="font-black text-sm">Hoje é dia especial!</p>
            <p className="text-xs opacity-80">{todayDates.map(r => r.name).join(" · ")}</p>
          </div>
        </div>
      )}

      {/* Próximos 7 dias */}
      {upcomingDates.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background:"#fffbeb", border:"1px solid #fde68a" }}>
          <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color:"#92400e" }}>📅 Próximos 7 dias</p>
          <div className="flex flex-wrap gap-2">
            {upcomingDates.map(r => (
              <span key={r.id} className="text-xs px-3 py-1 rounded-full font-bold" style={{ background:"#fef3c7", color:"#92400e", border:"1px solid #fde68a" }}>
                {r.name} — {getDaysLabel(r)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23" }}>Relacionamento</h2>
          <p className="text-sm" style={{ color:"#94a3b8" }}>{(relationships||[]).length} contatos · {todayDates.length} hoje · {upcomingDates.length} em breve</p>
        </div>
        <button onClick={() => openForm()} className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold"
          style={{ background:"linear-gradient(135deg,#a855f7,#ec4899)", boxShadow:"0 2px 8px rgba(168,85,247,0.3)" }}>
          <Icon.Plus />Nova Data
        </button>
      </div>

      {/* Busca + Ordenação */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{width:16,height:16,position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar contato..." className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-purple-300" />
        </div>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-300" style={{ color:"#64748b" }}>
          <option value="proximos">Mais próximos</option>
          <option value="az">A → Z</option>
          <option value="tipo">Por tipo</option>
        </select>
      </div>

      {/* Filtros por tipo com contadores */}
      <div className="flex gap-2 flex-wrap">
        {[["todos","Todos",(relationships||[]).length],["cliente","Clientes",counts.cliente||0],["data_comemorativa","Datas",counts.data_comemorativa||0],["fornecedor","Fornecedores",counts.fornecedor||0],["parceiro","Parceiros",counts.parceiro||0],["outro","Outros",counts.outro||0]].map(([v,l,c]) => (
          <button key={v} onClick={() => setFilter(v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
            style={{ background: filter===v ? "linear-gradient(135deg,#a855f7,#ec4899)" : "#f0f4f8", color: filter===v ? "#fff" : "#64748b" }}>
            {l}
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black" style={{ background: filter===v ? "rgba(255,255,255,0.25)" : "#e2e8f0", color: filter===v ? "#fff" : "#94a3b8" }}>{c}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {list.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background:"#fff", border:"1px solid #dde3ed" }}>
          <div className="text-5xl mb-4">💝</div>
          <p className="font-bold" style={{ color:"#1a1d23" }}>{search || filter!=="todos" ? "Nenhum resultado encontrado" : "Nenhum contato cadastrado"}</p>
          <p className="text-sm mt-1" style={{ color:"#94a3b8" }}>{search || filter!=="todos" ? "Tente outros filtros" : "Adicione aniversários de clientes e datas especiais"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(r => {
            const tc = typeColors[r.type] || typeColors.outro;
            const daysNum = getDaysUntilNum(r);
            const isToday = daysNum === 0;
            const isUrgent = daysNum <= 7 && daysNum > 0;
            const isAnn = r.isAnnual === true || r.isAnnual === "true" || r.isAnnual === 1;
            return (
              <div key={r.id} className="rounded-2xl p-4" style={{
                background:"#fff",
                border: isToday ? "2px solid #a855f7" : isUrgent ? "1.5px solid #fde68a" : "1px solid #dde3ed",
                boxShadow: isToday ? "0 0 0 4px rgba(168,85,247,0.08)" : "0 2px 6px rgba(26,29,35,0.05)"
              }}>
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-xl font-black select-none" style={{ background: isToday ? "linear-gradient(135deg,#a855f7,#ec4899)" : tc.bg, color: isToday ? "#fff" : tc.color }}>
                    {isToday ? "🎉" : tc.emoji}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-sm" style={{ color:"#1a1d23" }}>{r.name}</p>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:tc.bg, color:tc.color, border:"1px solid "+tc.border }}>{tc.label}</span>
                      {isToday && <span className="text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse" style={{ background:"linear-gradient(135deg,#a855f7,#ec4899)", color:"#fff" }}>HOJE 🎉</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs" style={{ color:"#94a3b8" }}>📅 {formatDate(r)} {isAnn ? "(anual)" : "(única)"}</span>
                      {/* Badge dias */}
                      <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: daysNum <= 7 ? (isToday ? "#f3e8ff" : "#fef9c3") : "#f0f4f8", color: daysColor(daysNum) }}>
                        {isToday ? "🎂 Hoje!" : daysNum <= 7 ? "⚡ " + getDaysLabel(r) : getDaysLabel(r)}
                      </span>
                    </div>
                    {r.message && <p className="text-xs mt-1 truncate" style={{ color:"#94a3b8", fontStyle:"italic" }}>✉️ {r.message}</p>}
                    {r.notes && <p className="text-xs mt-0.5 truncate" style={{ color:"#94a3b8" }}>📝 {r.notes}</p>}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {r.whatsapp && (
                      <a href={whatsappLink(r)} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold"
                        style={{ background:"#dcfce7", color:"#16a34a" }} title="WhatsApp">
                        <Icon.Whatsapp />
                      </a>
                    )}
                    {r.email && (
                      <a href={"mailto:"+r.email+"?subject=Parabens "+r.name+"!&body="+encodeURIComponent(r.message||"")}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold"
                        style={{ background:"#eff6ff", color:"#2b8be8" }} title="E-mail">
                        <Icon.Send />
                      </a>
                    )}
                    <button onClick={() => openForm(r)} className="p-2 rounded-lg" style={{ color:"#94a3b8" }}
                      onMouseEnter={e=>{e.currentTarget.style.background="#f0f4f8";e.currentTarget.style.color="#2b8be8"}}
                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8"}}>
                      <Icon.Edit />
                    </button>
                    <button onClick={() => deleteRelationship(r.id)} className="p-2 rounded-lg" style={{ color:"#94a3b8" }}
                      onMouseEnter={e=>{e.currentTarget.style.background="#fff5f5";e.currentTarget.style.color="#ef4444"}}
                      onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8"}}>
                      <Icon.Trash />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isFormOpen && (
        <Modal title={editing ? "Editar Contato" : "Novo Contato / Data"} onClose={() => { setIsFormOpen(false); setEditing(null); }} maxWidth="max-w-lg">
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
              <input value={rf.name} onChange={e=>setRf(p=>({...p,name:e.target.value}))} placeholder="Ex: João Silva, Natal..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
                <select value={rf.type} onChange={e=>setRf(p=>({...p,type:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400">
                  <option value="cliente">👤 Cliente</option>
                  <option value="data_comemorativa">🎉 Data Comemorativa</option>
                  <option value="fornecedor">🏢 Fornecedor</option>
                  <option value="parceiro">🤝 Parceiro</option>
                  <option value="outro">📌 Outro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recorrência</label>
                <select value={rf.isAnnual ? "anual" : "unica"} onChange={e=>setRf(p=>({...p,isAnnual:e.target.value==="anual",date:""}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400">
                  <option value="anual">🔁 Anual (aniversário)</option>
                  <option value="unica">📌 Data única</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {rf.isAnnual ? "Dia e Mês *" : "Data completa *"}
              </label>
              {rf.isAnnual ? (
                <div>
                  <input type="text" value={rf.date} onChange={e=>setRf(p=>({...p,date:e.target.value}))} placeholder="MM-DD (ex: 03-25 = 25 de março)" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400" maxLength={5} />
                  <p className="text-xs text-slate-400 mt-1">Formato: MM-DD (mês-dia) ex: 07-15 = 15 de julho</p>
                </div>
              ) : (
                <input type="date" value={rf.date} onChange={e=>setRf(p=>({...p,date:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp</label>
                <input value={rf.whatsapp} onChange={e=>setRf(p=>({...p,whatsapp:e.target.value}))} placeholder="(81) 99999-9999" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
                <input type="email" value={rf.email} onChange={e=>setRf(p=>({...p,email:e.target.value}))} placeholder="email@exemplo.com" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mensagem para enviar no dia</label>
              <textarea value={rf.message} onChange={e=>setRf(p=>({...p,message:e.target.value}))} rows={3} placeholder="Parabens pelo seu aniversario! Que este novo ano seja repleto de conquistas..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 resize-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notas internas</label>
              <textarea value={rf.notes} onChange={e=>setRf(p=>({...p,notes:e.target.value}))} rows={2} placeholder="Observacoes sobre este contato..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400 resize-none" />
            </div>
            {!rf.name.trim() || !rf.date ? <p className="text-xs text-red-500">* Nome e data são obrigatórios</p> : null}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setIsFormOpen(false); setEditing(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button onClick={save} disabled={!rf.name.trim()||!rf.date} className="px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background:"linear-gradient(135deg,#a855f7,#ec4899)" }}>
                {editing ? "Salvar" : "Adicionar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}



// ============================================================
// TEAM MANAGEMENT (Multi-usuário)
// ============================================================
function Team() {
  const { teamUsers, addTeamUser, updateTeamUser, removeTeamUser, currentProfile } = useApp();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Abas disponíveis para configurar (admin-only ficam fora)
  const ALL_TABS = [
    { id:"dashboard",    label:"Dashboard",           group:"Principal" },
    { id:"tasks",        label:"Tarefas",             group:"Principal" },
    { id:"habits",       label:"Hábitos e Rotina",    group:"Principal" },
    { id:"clients",      label:"Clientes",            group:"Escritório" },
    { id:"relationship", label:"Relacionamento",      group:"Escritório" },
    { id:"onboarding",   label:"Onboarding",          group:"Escritório" },
    { id:"obligations",  label:"Obrigações",          group:"Escritório" },
  ];

  const emptyUf = { name:"", email:"", password:"", role:"colaborador", avatarColor:"#2b8be8", allowedTabs:null, canCreateTasks:false };

  const [uf, setUf] = useState(emptyUf);
  const [confirmingDelete, setConfirmingDelete] = useState(null); // usuário a deletar
  const [newPassword, setNewPassword] = useState(""); // redefinir senha

  const confirmDelete = (u) => setConfirmingDelete(u);

  const deleteUser = async (u) => {
    setLoading(true);
    try {
      const session = JSON.parse(localStorage.getItem("sb_session") || "{}");
      const res = await fetch("https://kpgpcqjefrixzshmskls.supabase.co/functions/v1/delete-team-user", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+(session.access_token||""), "apikey":import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ user_id: u.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await removeTeamUser(u.id);
      setConfirmingDelete(null);
    } catch(e) {
      setError(e.message || "Erro ao remover usuário");
      setConfirmingDelete(null);
    } finally { setLoading(false); }
  };

  const resetPassword = async () => {
    if (!newPassword || newPassword.length < 6) { setError("Senha deve ter pelo menos 6 caracteres"); return; }
    setLoading(true); setError("");
    try {
      const session = JSON.parse(localStorage.getItem("sb_session") || "{}");
      const res = await fetch("https://kpgpcqjefrixzshmskls.supabase.co/functions/v1/create-team-user", {
        method:"PATCH",
        headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+(session.access_token||""), "apikey":import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ user_id: editing?.id, password: newPassword }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuccess("Senha redefinida com sucesso!");
      setNewPassword("");
      setTimeout(() => setSuccess(""), 2000);
    } catch(e) {
      setError(e.message || "Erro ao redefinir senha");
    } finally { setLoading(false); }
  };

  const toggleTab = (id) => {
    const current = uf.allowedTabs || ALL_TABS.map(t => t.id);
    const next = current.includes(id) ? current.filter(t => t !== id) : [...current, id];
    setUf(p => ({ ...p, allowedTabs: next }));
  };

  const isTabEnabled = (id) => {
    if (uf.allowedTabs === null) return true; // null = todas habilitadas
    return uf.allowedTabs.includes(id);
  };

  const roleColors = {
    admin:        { bg:"#eff6ff", color:"#2b8be8", label:"Administrador" },
    colaborador:  { bg:"#f0fdf4", color:"#10b981", label:"Colaborador" },
    visualizador: { bg:"#fdf4ff", color:"#a855f7", label:"Visualizador" },
  };

  const openForm = (u=null) => {
    setEditing(u);
    if (u) {
      setUf({ name:u.name, email:"", password:"", role:u.role, avatarColor:u.avatarColor||"#2b8be8",
        allowedTabs: u.allowedTabs || null, canCreateTasks: u.canCreateTasks !== false });
    } else {
      setUf(emptyUf);
    }
    setError(""); setSuccess("");
    setIsFormOpen(true);
  };

  const save = async () => {
    if (!uf.name.trim()) { setError("Nome é obrigatório"); return; }
    setLoading(true); setError(""); setSuccess("");
    try {
      if (editing) {
        await updateTeamUser({ ...editing, name:uf.name, role:uf.role, avatarColor:uf.avatarColor, allowedTabs:uf.allowedTabs, canCreateTasks:uf.canCreateTasks });
        setSuccess("Usuário atualizado!");
      } else {
        if (!uf.email.trim() || !uf.password || uf.password.length < 6) {
          setError("Email e senha (mín. 6 caracteres) são obrigatórios"); setLoading(false); return;
        }
        const session = JSON.parse(localStorage.getItem("sb_session") || "{}");
        const res = await fetch("https://kpgpcqjefrixzshmskls.supabase.co/functions/v1/create-team-user", {
          method:"POST",
          headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+(session.access_token||""), "apikey":import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ email:uf.email.trim(), password:uf.password, name:uf.name.trim(), role:uf.role, avatarColor:uf.avatarColor }),
        });
        const data = await res.json();
        if (data.error) {
          // Se usuário já existe, tentar buscar o ID dele e só atualizar o perfil
          if (data.error.includes("already been registered") || data.error.includes("already exists")) {
            // Buscar o user_id pelo email via user_profiles ou pelo erro
            if (data.user_id) {
              await addTeamUser({ id:data.user_id, name:uf.name.trim(), role:uf.role, ownerId:currentProfile?.id, avatarColor:uf.avatarColor, active:true, allowedTabs:uf.allowedTabs, canCreateTasks:uf.canCreateTasks });
              setSuccess("Perfil de " + uf.name + " vinculado à equipe!");
            } else {
              throw new Error("Este e-mail já está cadastrado. Vá em Editar para atualizar as permissões do usuário existente.");
            }
          } else {
            throw new Error(data.error);
          }
        } else {
          await addTeamUser({ id:data.user.id, name:uf.name.trim(), role:uf.role, ownerId:currentProfile?.id, avatarColor:uf.avatarColor, active:true, allowedTabs:uf.allowedTabs, canCreateTasks:uf.canCreateTasks });
          setSuccess("Usuário " + uf.name + " criado! Login: " + uf.email);
        }
      }
      setTimeout(() => { setIsFormOpen(false); setEditing(null); setSuccess(""); }, 1500);
    } catch(e) {
      setError(e.message || "Erro ao salvar");
    } finally { setLoading(false); }
  };

  const toggleActive = async (u) => { await updateTeamUser({ ...u, active: !u.active }); };

  const colorOptions = ["#2b8be8","#10b981","#a855f7","#f97316","#ef4444","#f59e0b","#ec4899","#64748b"];
  const tabGroups = [...new Set(ALL_TABS.map(t => t.group))];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23" }}>Equipe</h2>
          <p className="text-sm" style={{ color:"#94a3b8" }}>Gerencie usuários, acessos e permissões</p>
        </div>
        <button onClick={() => openForm()} className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold"
          style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", boxShadow:"0 2px 8px rgba(26,29,35,0.3)" }}>
          <Icon.Plus />Novo Usuário
        </button>
      </div>

      {/* Legenda de roles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { role:"Administrador", icon:"👑", desc:"Acesso total — todas as abas e configurações", color:"#2b8be8" },
          { role:"Colaborador",   icon:"💼", desc:"Abas configuráveis + pode ou não criar tarefas", color:"#10b981" },
          { role:"Visualizador",  icon:"👁️", desc:"Somente leitura das tarefas atribuídas a ele", color:"#a855f7" },
        ].map(r => (
          <div key={r.role} className="p-3 rounded-xl" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
            <p className="text-sm font-black mb-1" style={{ color:r.color }}>{r.icon} {r.role}</p>
            <p className="text-xs" style={{ color:"#64748b" }}>{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Lista */}
      <div className="space-y-3">
        {(teamUsers||[]).map(u => {
          const rc = roleColors[u.role] || roleColors.colaborador;
          const isMe = u.id === currentProfile?.id;
          const tabCount = u.allowedTabs ? u.allowedTabs.length : ALL_TABS.length;
          return (
            <div key={u.id} className="rounded-2xl p-4 flex items-center gap-4" style={{ background:"#fff", border:"1px solid #dde3ed", opacity: u.active ? 1 : 0.5 }}>
              <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center text-lg font-black text-white" style={{ background: u.avatarColor||"#2b8be8" }}>
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-black text-sm" style={{ color:"#1a1d23" }}>{u.name}</p>
                  {isMe && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"#e0f2fe", color:"#0284c7" }}>Você</span>}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:rc.bg, color:rc.color }}>{rc.label}</span>
                  {!u.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"#f1f5f9", color:"#94a3b8" }}>Inativo</span>}
                </div>
                {u.role !== "admin" && (
                  <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>
                    {tabCount} aba{tabCount!==1?"s":""} visível{tabCount!==1?"s":""} · {u.canCreateTasks ? "✅ pode criar tarefas" : "❌ não cria tarefas"}
                  </p>
                )}
              </div>
              {!isMe && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleActive(u)} className="p-2 rounded-lg text-xs font-medium"
                    style={{ background: u.active ? "#fef9c3" : "#f0fdf4", color: u.active ? "#92400e" : "#166534" }}
                    title={u.active ? "Desativar" : "Ativar"}>
                    {u.active ? "⏸" : "▶"}
                  </button>
                  <button onClick={() => openForm(u)} className="p-2 rounded-lg" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.color="#2b8be8"}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8"}}>
                    <Icon.Edit />
                  </button>
                  <button onClick={() => confirmDelete(u)} className="p-2 rounded-lg" style={{ color:"#94a3b8" }} title="Remover usuário"
                    onMouseEnter={e=>{e.currentTarget.style.background="#fff5f5";e.currentTarget.style.color="#ef4444"}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8"}}>
                    <Icon.Trash />
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {(!teamUsers||teamUsers.length===0) && (
          <div className="rounded-2xl p-10 text-center" style={{ background:"#fff", border:"1px solid #dde3ed" }}>
            <p className="text-4xl mb-3">👥</p>
            <p className="font-bold" style={{ color:"#1a1d23" }}>Nenhum usuário na equipe</p>
          </div>
        )}
      </div>

      {/* Modal confirmação de delete */}
      {confirmingDelete && (
        <Modal title="Remover Usuário" onClose={() => setConfirmingDelete(null)} maxWidth="max-w-sm">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black text-white flex-shrink-0"
                style={{ background: confirmingDelete.avatarColor||"#ef4444" }}>
                {confirmingDelete.name.charAt(0)}
              </div>
              <div>
                <p className="font-black" style={{ color:"#1a1d23" }}>{confirmingDelete.name}</p>
                <p className="text-sm" style={{ color:"#94a3b8" }}>Esta ação removerá o acesso do usuário ao app.</p>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{ background:"#fff5f5", border:"1px solid #fecaca" }}>
              <p className="text-xs" style={{ color:"#dc2626" }}>⚠️ O usuário perderá acesso imediatamente. Os dados criados por ele serão mantidos.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmingDelete(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button onClick={() => deleteUser(confirmingDelete)} disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-60"
                style={{ background:"linear-gradient(135deg,#ef4444,#dc2626)" }}>
                {loading ? <><Icon.Loader />Removendo...</> : <><Icon.Trash />Remover</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal criar/editar */}
      {isFormOpen && (
        <Modal title={editing ? "Editar Usuário" : "Novo Usuário"} onClose={() => { setIsFormOpen(false); setEditing(null); }} maxWidth="max-w-lg">
          <div className="p-6 space-y-5">
            {error && <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background:"#fef2f2", color:"#dc2626", border:"1px solid #fecaca" }}>{error}</div>}
            {success && <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background:"#f0fdf4", color:"#166534", border:"1px solid #bbf7d0" }}>✅ {success}</div>}

            {/* Nome */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nome completo *</label>
              <input value={uf.name} onChange={e=>setUf(p=>({...p,name:e.target.value}))} placeholder="Ex: Iris Cavalcanti"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
            </div>

            {/* Email e senha — só no cadastro */}
            {!editing && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">E-mail *</label>
                  <input type="email" value={uf.email} onChange={e=>setUf(p=>({...p,email:e.target.value}))} placeholder="email@exemplo.com"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Senha *</label>
                  <input type="password" value={uf.password} onChange={e=>setUf(p=>({...p,password:e.target.value}))} placeholder="Mín. 6 caracteres"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
            )}

            {/* Nível de acesso */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Nível de acesso</label>
              <select value={uf.role} onChange={e=>setUf(p=>({...p,role:e.target.value}))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                <option value="colaborador">💼 Colaborador</option>
                <option value="visualizador">👁️ Visualizador — somente leitura</option>
                <option value="admin">👑 Administrador — acesso total</option>
              </select>
            </div>

            {/* Abas visíveis — só para colaborador/visualizador */}
            {uf.role !== "admin" && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-700">Abas visíveis</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setUf(p=>({...p,allowedTabs:ALL_TABS.map(t=>t.id)}))}
                      className="text-xs px-2 py-1 rounded-lg font-medium" style={{ background:"#eff6ff", color:"#2b8be8" }}>Todas</button>
                    <button type="button" onClick={() => setUf(p=>({...p,allowedTabs:[]}))}
                      className="text-xs px-2 py-1 rounded-lg font-medium" style={{ background:"#f1f5f9", color:"#64748b" }}>Nenhuma</button>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  {tabGroups.map((group, gi) => (
                    <div key={group}>
                      {gi > 0 && <div style={{ height:1, background:"#e8edf5" }} />}
                      <div className="px-3 py-1.5" style={{ background:"#f8fafc" }}>
                        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>{group}</p>
                      </div>
                      {ALL_TABS.filter(t => t.group === group).map(tab => (
                        <label key={tab.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors">
                          <input type="checkbox" checked={isTabEnabled(tab.id)}
                            onChange={() => toggleTab(tab.id)}
                            className="rounded text-blue-600 w-4 h-4 flex-shrink-0" />
                          <span className="text-sm" style={{ color:"#374151" }}>{tab.label}</span>
                          {(tab.id === "dashboard" || tab.id === "tasks") && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-auto" style={{ background:"#fef9c3", color:"#92400e" }}>padrão</span>
                          )}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">Dashboard e Tarefas sempre aparecem independente da seleção.</p>
              </div>
            )}

            {/* Permissão de criar tarefas — só para colaborador */}
            {uf.role === "colaborador" && (
              <div className="rounded-xl border border-slate-200 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={uf.canCreateTasks} onChange={e=>setUf(p=>({...p,canCreateTasks:e.target.checked}))}
                    className="rounded text-blue-600 w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold" style={{ color:"#374151" }}>Pode criar e editar tarefas</p>
                    <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Se desmarcado, o colaborador só visualiza as tarefas atribuídas a ele, sem criar nem editar.</p>
                  </div>
                </label>
              </div>
            )}

            {/* Redefinir senha — só na edição */}
            {editing && (
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">Redefinir senha</p>
                <div className="flex gap-2">
                  <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}
                    placeholder="Nova senha (mín. 6 caracteres)"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
                  <button type="button" onClick={resetPassword} disabled={loading || !newPassword}
                    className="px-3 py-2 text-white rounded-lg text-sm font-bold disabled:opacity-50"
                    style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                    Salvar
                  </button>
                </div>
              </div>
            )}

            {/* Cor do avatar */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Cor do avatar</label>
              <div className="flex gap-2 flex-wrap">
                {colorOptions.map(c => (
                  <button key={c} type="button" onClick={() => setUf(p=>({...p,avatarColor:c}))}
                    className="w-8 h-8 rounded-lg transition-all"
                    style={{ background:c, border: uf.avatarColor===c ? "3px solid #1a1d23" : "2px solid transparent", transform: uf.avatarColor===c ? "scale(1.2)" : "scale(1)" }} />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setIsFormOpen(false); setEditing(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button onClick={save} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-60"
                style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)" }}>
                {loading ? <><Icon.Loader />Salvando...</> : editing ? "Salvar" : "Criar Usuário"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}



// ============================================================
// ONBOARDING
// ============================================================

const ONBOARDING_TYPES = {
  abertura_cnpj:      { label:"Abertura de CNPJ",         emoji:"🏢", color:"#2b8be8", bg:"#eff6ff" },
  novo_cliente:       { label:"Chegada de Novo Cliente",   emoji:"🤝", color:"#10b981", bg:"#f0fdf4" },
  regularizacao_fiscal:{ label:"Regularização Fiscal",    emoji:"📋", color:"#f97316", bg:"#fff7ed" },
};

const STEP_TEMPLATES = {
  abertura_cnpj: [
    "Coleta de documentos dos sócios",
    "Definição do objeto social",
    "Escolha do regime tributário",
    "Elaboração do contrato social",
    "Registro na Junta Comercial",
    "Obtenção do CNPJ (Receita Federal)",
    "Inscrição Estadual",
    "Inscrição Municipal / Alvará",
    "Abertura de conta bancária PJ",
    "Cadastro no sistema contábil",
    "Entrega de documentos ao cliente",
  ],
  novo_cliente: [
    "Reunião de boas-vindas",
    "Coleta de documentos da empresa",
    "Levantamento de pendências fiscais",
    "Migração de dados do contador anterior",
    "Regularização de obrigações em atraso",
    "Parametrização no sistema",
    "Treinamento do cliente",
    "Primeiro fechamento contábil",
    "Confirmação de dados cadastrais",
  ],
  regularizacao_fiscal: [
    "Diagnóstico fiscal inicial",
    "Levantamento de débitos",
    "Parcelamento de dívidas (REFIS/PERT)",
    "Entrega de declarações em atraso",
    "Regularização junto à Receita Federal",
    "Regularização junto à Secretaria Estadual",
    "Regularização junto à Prefeitura",
    "Obtenção de Certidões Negativas",
    "Relatório final ao cliente",
  ],
};

const STATUS_CONFIG = {
  pendente:      { label:"Pendente",     color:"#94a3b8", bg:"#f1f5f9", dot:"#cbd5e1" },
  em_andamento:  { label:"Em andamento", color:"#2b8be8", bg:"#eff6ff", dot:"#2b8be8" },
  concluido:     { label:"Concluído",    color:"#10b981", bg:"#f0fdf4", dot:"#10b981" },
  bloqueado:     { label:"Bloqueado",    color:"#ef4444", bg:"#fef2f2", dot:"#ef4444" },
};

const ONB_STATUS = {
  em_andamento: { label:"Em andamento", color:"#2b8be8", bg:"#eff6ff" },
  concluido:    { label:"Concluído",    color:"#10b981", bg:"#f0fdf4" },
  pausado:      { label:"Pausado",      color:"#f59e0b", bg:"#fffbeb" },
  cancelado:    { label:"Cancelado",    color:"#ef4444", bg:"#fef2f2" },
};

function OnboardingDetail({ onb, onClose }) {
  const { onboardingSteps, addStep, updateStep, deleteStep, updateOnboarding, teamUsers, currentProfile, clients } = useApp();
  const steps = onboardingSteps.filter(s => s.onboardingId === onb.id).sort((a,b) => a.orderIndex - b.orderIndex);
  const [newStepTitle, setNewStepTitle] = useState("");
  const [editingStep, setEditingStep] = useState(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const isAdmin = !currentProfile || currentProfile.role === "admin";

  const doneCount = steps.filter(s => s.status === "concluido").length;
  const pct = steps.length > 0 ? Math.round(doneCount / steps.length * 100) : 0;

  const addNewStep = async () => {
    if (!newStepTitle.trim()) return;
    const step = { id:uid(), onboardingId:onb.id, title:newStepTitle.trim(), description:"", status:"pendente", responsibleId:null, orderIndex:steps.length, dueDate:"", completedAt:"", notes:"" };
    await addStep(step);
    setNewStepTitle(""); setShowAddStep(false);
  };

  const toggleStep = async (step) => {
    const next = step.status === "concluido" ? "pendente" : "concluido";
    const updated = { ...step, status:next, completedAt: next==="concluido" ? new Date().toISOString() : "" };
    await updateStep(updated);
    // Se todos concluídos, marcar onboarding como concluído
    const allDone = steps.filter(s => s.id !== step.id).every(s => s.status==="concluido") && next==="concluido";
    if (allDone && onb.status !== "concluido") {
      await updateOnboarding({ ...onb, status:"concluido", completedAt:new Date().toISOString() });
    }
  };

  const changeStepStatus = async (step, status) => {
    await updateStep({ ...step, status, completedAt: status==="concluido" ? new Date().toISOString() : "" });
  };

  const typeInfo = ONBOARDING_TYPES[onb.type] || ONBOARDING_TYPES.abertura_cnpj;
  const onbStatus = ONB_STATUS[onb.status] || ONB_STATUS.em_andamento;

  return (
    <Modal title="" onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex flex-col" style={{ maxHeight:"85vh" }}>
        {/* Header */}
        <div className="p-6 pb-4" style={{ borderBottom:"1px solid #e8edf5" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ background:typeInfo.bg }}>
                {typeInfo.emoji}
              </div>
              <div>
                <h2 className="text-lg font-black" style={{ color:"#1a1d23" }}>{onb.title}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:typeInfo.bg, color:typeInfo.color }}>{typeInfo.label}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background:onbStatus.bg, color:onbStatus.color }}>{onbStatus.label}</span>
                  {onb.clientName && <span className="text-xs" style={{ color:"#94a3b8" }}>👤 {onb.clientName}</span>}
                  {onb.targetDate && <span className="text-xs" style={{ color:"#94a3b8" }}>📅 Prazo: {new Date(onb.targetDate+"T12:00:00").toLocaleDateString("pt-BR")}</span>}
                </div>
              </div>
            </div>
            {isAdmin && (
              <div className="flex gap-2 flex-shrink-0">
                {Object.entries(ONB_STATUS).map(([k,v]) => (
                  <button key={k} onClick={() => updateOnboarding({...onb, status:k})}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg transition-all"
                    style={{ background: onb.status===k ? v.bg : "#f8fafc", color: onb.status===k ? v.color : "#94a3b8", border: onb.status===k ? "1.5px solid "+v.color+"40" : "1px solid #e2e8f0" }}>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Barra de progresso */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold" style={{ color:"#374151" }}>Progresso</span>
              <span className="text-xs font-black" style={{ color: pct===100?"#10b981":pct>50?"#2b8be8":"#94a3b8" }}>{doneCount}/{steps.length} etapas ({pct}%)</span>
            </div>
            <div className="w-full rounded-full h-2" style={{ background:"#e2e8f0" }}>
              <div className="h-2 rounded-full transition-all duration-500"
                style={{ width:pct+"%", background: pct===100?"linear-gradient(90deg,#10b981,#059669)":pct>50?"linear-gradient(90deg,#2b8be8,#1d6fd4)":"linear-gradient(90deg,#f59e0b,#d97706)" }} />
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2">
          {steps.length === 0 && (
            <div className="text-center py-8" style={{ color:"#94a3b8" }}>
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm">Nenhuma etapa ainda. Adicione abaixo.</p>
            </div>
          )}
          {steps.map((step, idx) => {
            const sc = STATUS_CONFIG[step.status] || STATUS_CONFIG.pendente;
            const assignedUser = (teamUsers||[]).find(u => u.id === step.responsibleId);
            return (
              <div key={step.id} className="flex items-start gap-3 p-3 rounded-xl group transition-all"
                style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#dde3ed"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="#e8edf5"}>
                {/* Número + checkbox */}
                <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-black w-5 text-right" style={{ color:"#cbd5e1" }}>{idx+1}</span>
                  <button type="button" onClick={() => toggleStep(step)}
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0"
                    style={{ borderColor: step.status==="concluido" ? "#10b981" : "#cbd5e1", background: step.status==="concluido" ? "#10b981" : "transparent" }}>
                    {step.status==="concluido" && <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" style={{width:10,height:10}}><polyline points="20 6 9 17 4 12"/></svg>}
                  </button>
                </div>
                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <p className={"text-sm font-medium " + (step.status==="concluido"?"line-through":"")}
                    style={{ color: step.status==="concluido"?"#94a3b8":"#1a1d23" }}>{step.title}</p>
                  {step.description && <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>{step.description}</p>}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {/* Status badge */}
                    {isAdmin && (
                      <select value={step.status} onChange={e=>changeStepStatus(step,e.target.value)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full border-0 cursor-pointer"
                        style={{ background:sc.bg, color:sc.color }}>
                        {Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    )}
                    {/* Responsável */}
                    {(teamUsers||[]).length > 1 && isAdmin && (
                      <select value={step.responsibleId||""} onChange={e=>updateStep({...step,responsibleId:e.target.value||null})}
                        className="text-[10px] px-2 py-0.5 rounded-full border-0 cursor-pointer"
                        style={{ background:"#f0f4f8", color:"#64748b" }}>
                        <option value="">Sem responsável</option>
                        {(teamUsers||[]).map(u => <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>)}
                      </select>
                    )}
                    {assignedUser && !isAdmin && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background:assignedUser.avatarColor+"22", color:assignedUser.avatarColor }}>
                        👤 {assignedUser.name.split(" ")[0]}
                      </span>
                    )}
                    {step.dueDate && <span className="text-[10px]" style={{ color:"#94a3b8" }}>📅 {new Date(step.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
                  </div>
                </div>
                {/* Ações */}
                {isAdmin && (
                  <button onClick={() => deleteStep(step.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all flex-shrink-0"
                    style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="#fff5f5";e.currentTarget.style.color="#ef4444"}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8"}}>
                    <Icon.Trash />
                  </button>
                )}
              </div>
            );
          })}

          {/* Adicionar etapa */}
          {isAdmin && (
            <div className="pt-2">
              {showAddStep ? (
                <div className="flex gap-2">
                  <input value={newStepTitle} onChange={e=>setNewStepTitle(e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Enter") addNewStep(); if(e.key==="Escape") setShowAddStep(false); }}
                    placeholder="Nome da etapa..." autoFocus
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
                  <button onClick={addNewStep} className="px-3 py-2 text-white rounded-lg text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Adicionar</button>
                  <button onClick={()=>setShowAddStep(false)} className="px-3 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
                </div>
              ) : (
                <button onClick={()=>setShowAddStep(true)} className="flex items-center gap-2 text-sm font-medium w-full p-3 rounded-xl transition-all"
                  style={{ color:"#94a3b8", border:"1.5px dashed #e2e8f0" }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#2b8be8";e.currentTarget.style.color="#2b8be8";e.currentTarget.style.background="#f8fafc"}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.color="#94a3b8";e.currentTarget.style.background="transparent"}}>
                  <Icon.Plus /> Nova etapa
                </button>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        {(onb.notes || isAdmin) && (
          <div className="p-4 pt-0">
            <textarea value={onb.notes||""} onChange={e=>isAdmin&&updateOnboarding({...onb,notes:e.target.value})}
              readOnly={!isAdmin} placeholder="Observações gerais sobre este onboarding..."
              rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-300 resize-none"
              style={{ color:"#374151", background: isAdmin?"#fff":"#f8fafc" }} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Onboarding() {
  const { onboardings, onboardingSteps, addOnboarding, updateOnboarding, deleteOnboarding, addStep, clients, teamUsers, currentProfile } = useApp();
  const isAdmin = !currentProfile || currentProfile.role === "admin";
  const canManage = isAdmin || currentProfile?.role === "colaborador";
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [detailOnb, setDetailOnb] = useState(null);
  const [filter, setFilter] = useState("todos");
  const [filterType, setFilterType] = useState("todos");
  const [of, setOf] = useState({ title:"", type:"abertura_cnpj", clientName:"", clientId:"", responsibleId:"", targetDate:"", notes:"" });
  const [useTemplate, setUseTemplate] = useState(true);

  const openForm = () => {
    setOf({ title:"", type:"abertura_cnpj", clientName:"", clientId:"", responsibleId:"", targetDate:"", notes:"" });
    setUseTemplate(true);
    setIsFormOpen(true);
  };

  const save = async () => {
    if (!of.title.trim()) return;
    const newOnb = { id:uid(), title:of.title.trim(), type:of.type, status:"em_andamento", clientId:of.clientId||"", clientName:of.clientName||"", responsibleId:of.responsibleId||null, notes:of.notes||"", startDate:new Date().toISOString().split("T")[0], targetDate:of.targetDate||"", completedAt:"" };
    await addOnboarding(newOnb);
    // Criar etapas do template automaticamente
    if (useTemplate && STEP_TEMPLATES[of.type]) {
      for (let i=0; i<STEP_TEMPLATES[of.type].length; i++) {
        await addStep({ id:uid(), onboardingId:newOnb.id, title:STEP_TEMPLATES[of.type][i], description:"", status:"pendente", responsibleId:null, orderIndex:i, dueDate:"", completedAt:"", notes:"" });
      }
    }
    setIsFormOpen(false);
    setDetailOnb(newOnb);
  };

  const getProgress = (onb) => {
    const steps = onboardingSteps.filter(s => s.onboardingId === onb.id);
    if (!steps.length) return 0;
    return Math.round(steps.filter(s => s.status==="concluido").length / steps.length * 100);
  };

  const getStepCount = (onb) => {
    const steps = onboardingSteps.filter(s => s.onboardingId === onb.id);
    return { done: steps.filter(s=>s.status==="concluido").length, total: steps.length };
  };

  const list = onboardings
    .filter(o => filter==="todos" || o.status===filter)
    .filter(o => filterType==="todos" || o.type===filterType)
    .sort((a,b) => (b.startDate||"").localeCompare(a.startDate||""));

  const counts = onboardings.reduce((acc,o) => { acc[o.status]=(acc[o.status]||0)+1; return acc; },{});
  const typeCounts = onboardings.reduce((acc,o) => { acc[o.type]=(acc[o.type]||0)+1; return acc; },{});

  // KPIs
  const total = onboardings.length;
  const ativos = onboardings.filter(o=>o.status==="em_andamento").length;
  const concluidos = onboardings.filter(o=>o.status==="concluido").length;
  const avgPct = total > 0 ? Math.round(onboardings.reduce((s,o)=>s+getProgress(o),0)/total) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23" }}>Onboarding de Clientes</h2>
          <p className="text-sm" style={{ color:"#94a3b8" }}>Acompanhe abertura de CNPJ, chegada de clientes e regularizações</p>
        </div>
        {canManage && (
          <button onClick={openForm} className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold"
            style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px #2b8be840" }}>
            <Icon.Plus />Novo Onboarding
          </button>
        )}
      </div>

      {/* KPIs */}
      {total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label:"Total", value:total, color:"#2b8be8", bg:"#eff6ff" },
            { label:"Em andamento", value:ativos, color:"#f59e0b", bg:"#fffbeb" },
            { label:"Concluídos", value:concluidos, color:"#10b981", bg:"#f0fdf4" },
            { label:"Progresso médio", value:avgPct+"%", color: avgPct>=70?"#10b981":avgPct>=40?"#2b8be8":"#f59e0b", bg:"#f8fafc" },
          ].map(k => (
            <div key={k.label} className="rounded-xl p-4 text-center" style={{ background:k.bg, border:"1px solid "+k.color+"22" }}>
              <p className="text-2xl font-black" style={{ color:k.color }}>{k.value}</p>
              <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>{k.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[["todos","Todos"],["em_andamento","Em andamento"],["concluido","Concluídos"],["pausado","Pausados"],["cancelado","Cancelados"]].map(([v,l]) => (
            <button key={v} onClick={()=>setFilter(v)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ background:filter===v?"linear-gradient(135deg,#5aaff5,#2b8be8)":"#f0f4f8", color:filter===v?"#fff":"#64748b" }}>
              {l}{v!=="todos"&&counts[v]?` (${counts[v]})`:total&&v==="todos"?` (${total})`:""}
            </button>
          ))}
        </div>
        <div className="h-6 w-px bg-slate-200 self-center hidden sm:block" />
        <div className="flex gap-1.5 flex-wrap">
          {[["todos","Todos tipos"],...Object.entries(ONBOARDING_TYPES).map(([k,v])=>[k,v.emoji+" "+v.label.split(" ")[0]])].map(([v,l]) => (
            <button key={v} onClick={()=>setFilterType(v)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{ background:filterType===v?"#1a1d23":"#f0f4f8", color:filterType===v?"#fff":"#64748b" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {list.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background:"#fff", border:"1px solid #dde3ed" }}>
          <p className="text-5xl mb-4">🚀</p>
          <p className="font-bold text-lg" style={{ color:"#1a1d23" }}>Nenhum onboarding ainda</p>
          <p className="text-sm mt-1" style={{ color:"#94a3b8" }}>Crie o primeiro processo de chegada de cliente ou abertura de CNPJ</p>
          {canManage && <button onClick={openForm} className="mt-4 px-5 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Criar primeiro onboarding</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map(onb => {
            const typeInfo = ONBOARDING_TYPES[onb.type] || ONBOARDING_TYPES.abertura_cnpj;
            const onbStatus = ONB_STATUS[onb.status] || ONB_STATUS.em_andamento;
            const pct = getProgress(onb);
            const { done, total: tot } = getStepCount(onb);
            const responsibleUser = (teamUsers||[]).find(u => u.id === onb.responsibleId);

            return (
              <div key={onb.id} className="rounded-2xl p-5 cursor-pointer group transition-all"
                style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.06)" }}
                onClick={() => setDetailOnb(onb)}
                onMouseEnter={e=>{e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.12)";e.currentTarget.style.transform="translateY(-1px)"}}
                onMouseLeave={e=>{e.currentTarget.style.boxShadow="0 2px 8px rgba(26,29,35,0.06)";e.currentTarget.style.transform="translateY(0)"}}>

                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background:typeInfo.bg }}>{typeInfo.emoji}</div>
                    <div>
                      <p className="font-black text-sm" style={{ color:"#1a1d23" }}>{onb.title}</p>
                      {onb.clientName && <p className="text-xs" style={{ color:"#94a3b8" }}>👤 {onb.clientName}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:onbStatus.bg, color:onbStatus.color }}>{onbStatus.label}</span>
                    {isAdmin && (
                      <button onClick={e=>{e.stopPropagation();deleteOnboarding(onb.id)}} className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-all"
                        style={{ color:"#94a3b8" }}
                        onMouseEnter={e=>{e.currentTarget.style.background="#fff5f5";e.currentTarget.style.color="#ef4444"}}
                        onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8"}}>
                        <Icon.Trash />
                      </button>
                    )}
                  </div>
                </div>

                {/* Barra de progresso */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px]" style={{ color:"#94a3b8" }}>{done}/{tot} etapas</span>
                    <span className="text-[10px] font-black" style={{ color: pct===100?"#10b981":pct>50?"#2b8be8":"#94a3b8" }}>{pct}%</span>
                  </div>
                  <div className="w-full rounded-full h-1.5" style={{ background:"#f0f4f8" }}>
                    <div className="h-1.5 rounded-full transition-all"
                      style={{ width:pct+"%", background: pct===100?"#10b981":pct>50?"#2b8be8":"#f59e0b" }} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px]" style={{ color:"#94a3b8" }}>
                  <span style={{ color:typeInfo.color, fontWeight:600 }}>{typeInfo.label}</span>
                  <div className="flex items-center gap-3">
                    {responsibleUser && <span>👤 {responsibleUser.name.split(" ")[0]}</span>}
                    {onb.targetDate && <span>📅 {new Date(onb.targetDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
                    {onb.startDate && <span>Iniciado {new Date(onb.startDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal detalhe */}
      {detailOnb && (
        <OnboardingDetail
          onb={onboardings.find(o=>o.id===detailOnb.id)||detailOnb}
          onClose={()=>setDetailOnb(null)}
        />
      )}

      {/* Modal criar */}
      {isFormOpen && (
        <Modal title="Novo Onboarding" onClose={()=>setIsFormOpen(false)} maxWidth="max-w-lg">
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Tipo de processo *</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(ONBOARDING_TYPES).map(([k,v]) => (
                  <button key={k} type="button" onClick={()=>setOf(p=>({...p,type:k}))}
                    className="p-3 rounded-xl text-center transition-all"
                    style={{ background:of.type===k?v.bg:"#f8fafc", border:of.type===k?"2px solid "+v.color:"1px solid #e2e8f0", color:of.type===k?v.color:"#64748b" }}>
                    <div className="text-2xl mb-1">{v.emoji}</div>
                    <div className="text-[10px] font-bold leading-tight">{v.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Título *</label>
              <input value={of.title} onChange={e=>setOf(p=>({...p,title:e.target.value}))}
                placeholder={of.type==="abertura_cnpj"?"Ex: Abertura CNPJ - Empresa XYZ":of.type==="novo_cliente"?"Ex: Onboarding - João Silva":"Ex: Regularização - Empresa ABC"}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Nome do cliente</label>
                <input value={of.clientName} onChange={e=>setOf(p=>({...p,clientName:e.target.value}))}
                  placeholder="Nome ou empresa"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Prazo alvo</label>
                <input type="date" value={of.targetDate} onChange={e=>setOf(p=>({...p,targetDate:e.target.value}))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
            {(teamUsers||[]).length > 1 && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Responsável</label>
                <select value={of.responsibleId} onChange={e=>setOf(p=>({...p,responsibleId:e.target.value}))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400">
                  <option value="">Sem responsável definido</option>
                  {(teamUsers||[]).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <label className="flex items-center gap-3 p-3 rounded-xl cursor-pointer" style={{ background:"#f0fdf4", border:"1px solid #bbf7d0" }}>
              <input type="checkbox" checked={useTemplate} onChange={e=>setUseTemplate(e.target.checked)} className="rounded text-green-600 w-4 h-4" />
              <div>
                <p className="text-sm font-semibold" style={{ color:"#166534" }}>✅ Usar checklist padrão</p>
                <p className="text-xs" style={{ color:"#4ade80" }}>Cria automaticamente as {STEP_TEMPLATES[of.type]?.length||0} etapas recomendadas para {ONBOARDING_TYPES[of.type]?.label}</p>
              </div>
            </label>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={()=>setIsFormOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button onClick={save} disabled={!of.title.trim()} className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>
                <Icon.Plus />Criar Onboarding
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ============================================================
// WORKLOAD — Gestão de carga do time
// ============================================================
function Workload() {
  const { tasks, teamUsers, currentProfile } = useApp();
  const t = today();
  const [period, setPeriod] = useState(7);

  const periodStart = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate()-period); return d.toISOString().split("T")[0];
  }, [period]);

  // Dados globais
  const periodTasks = tasks.filter(x => x.dueDate >= periodStart && x.dueDate <= t);
  const allActive  = tasks.filter(x => !x.completed && x.dueDate >= t);
  const allOverdue = tasks.filter(x => !x.completed && x.dueDate < t);
  const allDone    = tasks.filter(x => x.completed && x.dueDate >= periodStart);

  // Por membro
  const memberStats = useMemo(() => (teamUsers||[]).map(u => {
    const assigned = tasks.filter(x => x.assignedTo === u.id);
    const active   = assigned.filter(x => !x.completed && x.dueDate >= t);
    const overdue  = assigned.filter(x => !x.completed && x.dueDate < t);
    const done     = assigned.filter(x => x.completed && x.dueDate >= periodStart);
    const total    = assigned.filter(x => x.dueDate >= periodStart);
    const rate     = total.length > 0 ? Math.round(done.length/total.length*100) : 0;
    const load     = active.length + overdue.length * 1.5; // peso maior para atrasadas
    const maxLoad  = 10;
    const loadPct  = Math.min(Math.round(load/maxLoad*100), 100);
    const loadLevel = load <= 3 ? "leve" : load <= 7 ? "normal" : load <= 12 ? "pesada" : "crítica";
    const loadColors = { leve:"#10b981", normal:"#2b8be8", pesada:"#f59e0b", crítica:"#ef4444" };

    // Dias da semana
    const daily = Array.from({length:7}, (_,i) => {
      const d = new Date(); d.setDate(d.getDate()-6+i);
      const ds = d.toISOString().split("T")[0];
      const dt = assigned.filter(x => x.dueDate === ds);
      return { day:d.toLocaleDateString("pt-BR",{weekday:"short"}).replace(".",""), done:dt.filter(x=>x.completed).length, pending:dt.filter(x=>!x.completed).length, date:ds };
    });

    return { ...u, assigned, active, overdue, done, total, rate, load, loadPct, loadLevel, loadColor:loadColors[loadLevel], daily };
  }), [tasks, teamUsers, t, periodStart]);

  // Redistribuição sugerida (tarefas atrasadas sem responsável ou com sobrecarga)
  const redistSuggestions = useMemo(() => {
    const overloaded = memberStats.filter(m => m.loadLevel === "crítica" || m.loadLevel === "pesada");
    const underloaded = memberStats.filter(m => m.loadLevel === "leve" && m.active.length < 3);
    if (overloaded.length === 0 || underloaded.length === 0) return [];
    return overloaded.slice(0,2).map(m => ({
      from: m,
      to: underloaded[0],
      tasks: m.overdue.slice(0,2),
    })).filter(s => s.tasks.length > 0);
  }, [memberStats]);

  const totalLoad = memberStats.reduce((s,m)=>s+m.load,0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23", letterSpacing:"-0.01em" }}>Workload do Time</h2>
          <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Carga de trabalho, produtividade e distribuição de tarefas</p>
        </div>
        <select value={period} onChange={e=>setPeriod(Number(e.target.value))}
          className="border rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-300"
          style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
          <option value={7}>Últimos 7 dias</option>
          <option value={14}>Últimos 14 dias</option>
          <option value={30}>Últimos 30 dias</option>
        </select>
      </div>

      {/* KPIs globais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label:"Ativas no time", value:allActive.length, color:"#2b8be8", icon:"📋" },
          { label:"Atrasadas", value:allOverdue.length, color:allOverdue.length>0?"#ef4444":"#10b981", icon:"⚠️" },
          { label:"Concluídas (período)", value:allDone.length, color:"#10b981", icon:"✅" },
          { label:"Carga total", value:totalLoad.toFixed(0), color:totalLoad>20?"#ef4444":totalLoad>10?"#f59e0b":"#10b981", icon:"⚡", sub:"pontos de carga" },
        ].map(k => (
          <div key={k.label} className="rounded-2xl p-4 transition-all"
            style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)", backdropFilter:"blur(8px)" }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(26,29,35,0.08)";}}
            onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.04)";}}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>{k.label}</p>
                <p className="text-2xl font-black" style={{ color:k.color, fontVariantNumeric:"tabular-nums" }}>{k.value}</p>
                {k.sub && <p className="text-[10px] mt-0.5" style={{ color:"#94a3b8" }}>{k.sub}</p>}
              </div>
              <span className="text-xl">{k.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Cards de membros */}
      {memberStats.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
          <p className="text-4xl mb-3">👥</p>
          <p className="font-bold" style={{ color:"#1a1d23" }}>Nenhuma tarefa atribuída ainda</p>
          <p className="text-xs mt-1" style={{ color:"#94a3b8" }}>Atribua responsáveis nas tarefas para ver o workload</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memberStats.map(m => (
            <div key={m.id} className="rounded-2xl p-5 transition-all"
              style={{ background:"rgba(255,255,255,0.98)", border:`1px solid ${m.loadColor}22`, boxShadow:"0 4px 16px rgba(26,29,35,0.05)", backdropFilter:"blur(8px)" }}
              onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 8px 28px ${m.loadColor}12`;e.currentTarget.style.transform="translateY(-1px)";}}
              onMouseLeave={e=>{e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.05)";e.currentTarget.style.transform="translateY(0)";}}>

              {/* Header membro */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-black text-white flex-shrink-0"
                  style={{ background:m.avatarColor||"#2b8be8", boxShadow:`0 3px 10px ${m.avatarColor||"#2b8be8"}44` }}>
                  {m.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{m.name.split(" ")[0]}</p>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                      style={{ background:m.loadColor+"18", color:m.loadColor, border:`1px solid ${m.loadColor}30` }}>
                      Carga {m.loadLevel}
                    </span>
                  </div>
                  <p className="text-[10px]" style={{ color:"#94a3b8" }}>{m.role} · {m.assigned.length} tarefas totais</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-black" style={{ color:m.loadColor, fontVariantNumeric:"tabular-nums" }}>{m.rate}%</p>
                  <p className="text-[9px]" style={{ color:"#94a3b8" }}>conclusão</p>
                </div>
              </div>

              {/* Barra de carga */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold" style={{ color:"#94a3b8" }}>Nível de carga</span>
                  <span className="text-[10px] font-black" style={{ color:m.loadColor }}>{m.loadPct}%</span>
                </div>
                <div className="w-full h-2 rounded-full" style={{ background:"rgba(226,232,240,0.5)" }}>
                  <div className="h-2 rounded-full transition-all duration-700"
                    style={{ width:m.loadPct+"%", background:`linear-gradient(90deg,${m.loadColor},${m.loadColor}cc)`,
                      boxShadow:m.loadLevel==="crítica"?`0 0 8px ${m.loadColor}66`:"none" }}/>
                </div>
              </div>

              {/* Estatísticas inline */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { l:"Ativas", v:m.active.length, c:"#2b8be8" },
                  { l:"Atrasadas", v:m.overdue.length, c:m.overdue.length>0?"#ef4444":"#10b981" },
                  { l:"Concluídas", v:m.done.length, c:"#10b981" },
                  { l:"No período", v:m.total.length, c:"#64748b" },
                ].map(s => (
                  <div key={s.l} className="text-center p-2 rounded-xl" style={{ background:"rgba(248,250,252,0.7)", border:"1px solid rgba(226,232,240,0.5)" }}>
                    <p className="text-base font-black" style={{ color:s.c }}>{s.v}</p>
                    <p className="text-[9px]" style={{ color:"#94a3b8" }}>{s.l}</p>
                  </div>
                ))}
              </div>

              {/* Mini gráfico diário */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color:"#94a3b8" }}>Distribuição semanal</p>
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={m.daily} barGap={1} barCategoryGap="25%">
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill:"#94a3b8", fontSize:9 }}/>
                      <Tooltip contentStyle={{ borderRadius:10, border:"1px solid rgba(221,227,237,0.8)", fontSize:10, background:"rgba(255,255,255,0.98)", boxShadow:"0 4px 12px rgba(26,29,35,0.1)" }}
                        formatter={(val,name)=>[val,name]} labelStyle={{ fontWeight:700 }}/>
                      <Bar dataKey="done" name="Concluídas" stackId="a" fill={m.avatarColor||"#2b8be8"} radius={[3,3,0,0]} maxBarSize={20}/>
                      <Bar dataKey="pending" name="Pendentes" stackId="a" fill="rgba(226,232,240,0.8)" radius={[3,3,0,0]} maxBarSize={20}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Tarefas atrasadas */}
              {m.overdue.length > 0 && (
                <div className="mt-3 p-3 rounded-xl" style={{ background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.15)" }}>
                  <p className="text-[10px] font-black mb-1.5" style={{ color:"#ef4444" }}>⚠ Tarefas atrasadas</p>
                  {m.overdue.slice(0,3).map(task => (
                    <div key={task.id} className="flex items-center justify-between text-xs mb-1">
                      <span className="truncate" style={{ color:"#374151" }}>{task.title}</span>
                      <span className="font-bold ml-2 flex-shrink-0" style={{ color:"#ef4444" }}>
                        {Math.floor((new Date(t)-new Date(task.dueDate+"T12:00:00"))/(1000*60*60*24))}d
                      </span>
                    </div>
                  ))}
                  {m.overdue.length > 3 && <p className="text-[10px]" style={{ color:"#94a3b8" }}>+{m.overdue.length-3} mais</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sugestões de redistribuição */}
      {redistSuggestions.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,rgba(245,158,11,0.06),rgba(255,255,255,0.98))", border:"1px solid rgba(245,158,11,0.2)", boxShadow:"0 4px 16px rgba(245,158,11,0.06)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⚖️</span>
            <h3 className="text-sm font-black" style={{ color:"#92400e" }}>Sugestões de Redistribuição</h3>
          </div>
          {redistSuggestions.map((s,i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl mb-2" style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.15)" }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black text-white flex-shrink-0" style={{ background:s.from.avatarColor||"#ef4444" }}>{s.from.name.charAt(0)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold" style={{ color:"#374151" }}>
                  <span style={{ color:s.from.loadColor }}>{s.from.name.split(" ")[0]}</span> → <span style={{ color:"#10b981" }}>{s.to.name.split(" ")[0]}</span>
                </p>
                <p className="text-[10px]" style={{ color:"#94a3b8" }}>{s.tasks.map(t=>t.title).join(", ")}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background:"rgba(245,158,11,0.15)", color:"#d97706" }}>Sugerido</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ============================================================
// PROJETOS — Kanban moderno
// ============================================================

const PRIORITY_CONFIG = {
  low:    { label:"Baixa",   color:"#94a3b8", bg:"rgba(148,163,184,0.1)", dot:"#94a3b8", icon:"↓" },
  medium: { label:"Média",   color:"#f59e0b", bg:"rgba(245,158,11,0.1)",  dot:"#f59e0b", icon:"→" },
  high:   { label:"Alta",    color:"#f97316", bg:"rgba(249,115,22,0.1)",  dot:"#f97316", icon:"↑" },
  urgent: { label:"Urgente", color:"#ef4444", bg:"rgba(239,68,68,0.1)",   dot:"#ef4444", icon:"⚡" },
};

const CATEGORY_OPTIONS = ["Fiscal","Contábil","Departamento Pessoal","Administrativo","Jurídico","Tecnologia","Marketing","Financeiro","Outros"];

const COLUMN_CONFIG = {
  todo:  { label:"Não Iniciado", color:"#94a3b8", bg:"rgba(148,163,184,0.06)", icon:"○" },
  doing: { label:"Em Execução",  color:"#2b8be8", bg:"rgba(43,139,232,0.06)",  icon:"◑" },
  done:  { label:"Concluído",    color:"#10b981", bg:"rgba(16,185,129,0.06)",  icon:"●" },
};

const PROJECT_COLORS = ["#2b8be8","#10b981","#a855f7","#f97316","#ef4444","#f59e0b","#ec4899","#06b6d4","#1a1d23","#64748b"];

function ProjectCard({ project, onEdit, onDelete, onMove, onUpdateChecklist }) {
  const { clients, teamUsers } = useApp();
  const [expanded, setExpanded] = useState(false);
  const t = today();

  const checklist = project.checklist||[];
  const done = checklist.filter(c=>c.done).length;
  const pct = checklist.length > 0 ? Math.round(done/checklist.length*100) : 0;
  const pc = PRIORITY_CONFIG[project.priority] || PRIORITY_CONFIG.medium;
  const responsible = (teamUsers||[]).find(u => u.id === project.responsibleId);
  const isOverdue = project.dueDate && project.dueDate < t && project.status !== "done";
  const isDueToday = project.dueDate === t;
  const daysLeft = project.dueDate ? Math.ceil((new Date(project.dueDate+"T12:00:00")-new Date())/(1000*60*60*24)) : null;

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-300 group cursor-pointer"
      style={{
        background:"rgba(255,255,255,0.98)",
        border: isOverdue ? "1.5px solid rgba(239,68,68,0.3)" : "1px solid rgba(221,227,237,0.7)",
        boxShadow: isOverdue ? "0 4px 20px rgba(239,68,68,0.08)" : "0 4px 16px rgba(26,29,35,0.04)",
        backdropFilter:"blur(8px)",
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=isOverdue?"0 8px 28px rgba(239,68,68,0.12)":"0 8px 28px rgba(26,29,35,0.1)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow=isOverdue?"0 4px 20px rgba(239,68,68,0.08)":"0 4px 16px rgba(26,29,35,0.04)";}}>

      {/* Barra de cor topo */}
      <div className="h-1" style={{ background:`linear-gradient(90deg,${project.color||"#2b8be8"},${project.color||"#2b8be8"}88)` }}/>

      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                style={{ background:pc.bg, color:pc.color }}>
                {pc.icon} {pc.label}
              </span>
              {project.category && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ background:"rgba(226,232,240,0.6)", color:"#64748b" }}>
                  {project.category}
                </span>
              )}
            </div>
            <h3 className="text-sm font-black leading-snug" style={{ color:"#1a1d23" }}>{project.title}</h3>
            {project.clientName && (
              <p className="text-[10px] mt-0.5" style={{ color:"#94a3b8" }}>👤 {project.clientName}</p>
            )}
          </div>
          {/* Quick actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
            <button onClick={e=>{e.stopPropagation();setExpanded(v=>!v)}} className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width:13,height:13}}><polyline points={expanded?"18 15 12 9 6 15":"6 9 12 15 18 9"}/></svg>
            </button>
            <button onClick={e=>{e.stopPropagation();onEdit(project)}} className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.08)";e.currentTarget.style.color="#2b8be8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
              <Icon.Edit />
            </button>
            <button onClick={e=>{e.stopPropagation();onDelete(project.id)}} className="p-1.5 rounded-lg transition-all" style={{ color:"#94a3b8" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(239,68,68,0.08)";e.currentTarget.style.color="#ef4444";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
              <Icon.Trash />
            </button>
          </div>
        </div>

        {/* Progresso */}
        {checklist.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px]" style={{ color:"#94a3b8" }}>{done}/{checklist.length} tarefas</span>
              <span className="text-[10px] font-black" style={{ color:pct===100?"#10b981":pct>50?"#2b8be8":"#94a3b8" }}>{pct}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full" style={{ background:"rgba(226,232,240,0.5)" }}>
              <div className="h-1.5 rounded-full transition-all duration-500"
                style={{ width:pct+"%", background:pct===100?"linear-gradient(90deg,#10b981,#059669)":pct>50?`linear-gradient(90deg,${project.color||"#2b8be8"},${project.color||"#2b8be8"}cc)`:project.color||"#2b8be8" }}/>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {responsible && (
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                style={{ background:responsible.avatarColor||"#2b8be8", boxShadow:`0 1px 4px ${responsible.avatarColor||"#2b8be8"}44` }}
                title={responsible.name}>
                {responsible.name.charAt(0)}
              </div>
            )}
            {project.dueDate && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: isOverdue ? "rgba(239,68,68,0.1)" : isDueToday ? "rgba(245,158,11,0.1)" : "rgba(226,232,240,0.4)",
                  color: isOverdue ? "#ef4444" : isDueToday ? "#f59e0b" : "#94a3b8"
                }}>
                {isOverdue ? `${Math.abs(daysLeft)}d atraso` : isDueToday ? "Hoje" : daysLeft !== null ? `${daysLeft}d` : ""}
                {" "}{new Date(project.dueDate+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}
              </span>
            )}
          </div>
          {/* Mover entre colunas */}
          <div className="flex gap-1">
            {project.status !== "todo" && (
              <button onClick={e=>{e.stopPropagation();onMove(project, project.status==="doing"?"todo":"doing")}}
                className="text-[9px] font-bold px-2 py-0.5 rounded-full transition-all"
                style={{ background:"rgba(226,232,240,0.4)", color:"#64748b" }}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.1)";e.currentTarget.style.color="#2b8be8";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgba(226,232,240,0.4)";e.currentTarget.style.color="#64748b";}}>
                ← {project.status==="doing"?"Não iniciado":"Em execução"}
              </button>
            )}
            {project.status !== "done" && (
              <button onClick={e=>{e.stopPropagation();onMove(project, project.status==="todo"?"doing":"done")}}
                className="text-[9px] font-bold px-2 py-0.5 rounded-full transition-all"
                style={{ background:"rgba(226,232,240,0.4)", color:"#64748b" }}
                onMouseEnter={e=>{e.currentTarget.style.background=project.status==="doing"?"rgba(16,185,129,0.1)":"rgba(43,139,232,0.1)";e.currentTarget.style.color=project.status==="doing"?"#10b981":"#2b8be8";}}
                onMouseLeave={e=>{e.currentTarget.style.background="rgba(226,232,240,0.4)";e.currentTarget.style.color="#64748b";}}>
                {project.status==="todo"?"Em execução →":"Concluído →"}
              </button>
            )}
          </div>
        </div>

        {/* Expanded: checklist + notas */}
        {expanded && (
          <div className="mt-3 pt-3" style={{ borderTop:"1px solid rgba(226,232,240,0.5)" }}>
            {project.description && (
              <p className="text-xs mb-3 leading-relaxed" style={{ color:"#64748b" }}>{project.description}</p>
            )}
            {checklist.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {checklist.map((item,i) => (
                  <div key={i} className="flex items-center gap-2 p-1.5 rounded-lg transition-all"
                    style={{ background:"rgba(248,250,252,0.7)" }}>
                    <input type="checkbox" checked={item.done}
                      onChange={e=>{e.stopPropagation(); onUpdateChecklist(project, i, e.target.checked);}}
                      className="w-3.5 h-3.5 rounded flex-shrink-0" style={{ accentColor:project.color||"#2b8be8" }}/>
                    <span className="text-xs" style={{ color:item.done?"#94a3b8":"#374151", textDecoration:item.done?"line-through":"none" }}>{item.text}</span>
                  </div>
                ))}
              </div>
            )}
            {project.notes && (
              <p className="text-[10px] p-2 rounded-lg" style={{ background:"rgba(248,250,252,0.7)", color:"#64748b", fontStyle:"italic" }}>
                📝 {project.notes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectForm({ project, onSave, onClose }) {
  const { clients, teamUsers } = useApp();
  const emptyPF = { title:"", description:"", priority:"medium", category:"", clientId:"", clientName:"", responsibleId:"", teamIds:[], dueDate:"", startDate:"", checklist:[], tags:[], notes:"", color:"#2b8be8", status:"todo" };
  const [pf, setPf] = useState(project ? {
    title:project.title||"", description:project.description||"", priority:project.priority||"medium",
    category:project.category||"", clientId:project.clientId||"", clientName:project.clientName||"",
    responsibleId:project.responsibleId||"", teamIds:project.teamIds||[], dueDate:project.dueDate||"",
    startDate:project.startDate||"", checklist:[...( project.checklist||[])], tags:[...(project.tags||[])],
    notes:project.notes||"", color:project.color||"#2b8be8", status:project.status||"todo"
  } : emptyPF);
  const [newItem, setNewItem] = useState("");
  const [newTag, setNewTag] = useState("");

  const addChecklistItem = () => {
    if (!newItem.trim()) return;
    setPf(p=>({...p, checklist:[...p.checklist,{text:newItem.trim(),done:false}]}));
    setNewItem("");
  };

  const addTag = () => {
    if (!newTag.trim() || pf.tags.includes(newTag.trim())) return;
    setPf(p=>({...p, tags:[...p.tags, newTag.trim()]}));
    setNewTag("");
  };

  const handleClientSelect = v => {
    const c = (clients||[]).find(x=>x.id===v);
    setPf(p=>({...p, clientId:v, clientName:c?.name||""}));
  };

  return (
    <Modal title={project?"Editar Projeto":"Novo Projeto"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-6 space-y-5 overflow-y-auto" style={{ maxHeight:"80vh" }}>
        {/* Cor + Título */}
        <div className="flex gap-3 items-start">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Cor</label>
            <div className="flex gap-1.5 flex-wrap" style={{ maxWidth:120 }}>
              {PROJECT_COLORS.map(c=>(
                <button key={c} type="button" onClick={()=>setPf(p=>({...p,color:c}))}
                  className="w-6 h-6 rounded-lg transition-all"
                  style={{ background:c, border:pf.color===c?"2.5px solid #1a1d23":"2px solid transparent", transform:pf.color===c?"scale(1.2)":"scale(1)" }}/>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Nome do projeto *</label>
            <input value={pf.title} onChange={e=>setPf(p=>({...p,title:e.target.value}))} placeholder="Ex: Abertura CNPJ — Empresa XYZ"
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Descrição</label>
          <textarea value={pf.description} onChange={e=>setPf(p=>({...p,description:e.target.value}))}
            placeholder="O que envolve este projeto..." rows={2} className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
        </div>

        {/* Grid: Prioridade + Categoria + Status */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Prioridade</label>
            <div className="space-y-1">
              {Object.entries(PRIORITY_CONFIG).map(([k,v]) => (
                <button key={k} type="button" onClick={()=>setPf(p=>({...p,priority:k}))}
                  className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                  style={{ background:pf.priority===k?v.bg:"rgba(248,250,252,0.7)", color:pf.priority===k?v.color:"#94a3b8", border:pf.priority===k?`1.5px solid ${v.color}40`:"1px solid rgba(226,232,240,0.6)" }}>
                  <span style={{ color:v.color }}>{v.icon}</span> {v.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Categoria</label>
            <select value={pf.category} onChange={e=>setPf(p=>({...p,category:e.target.value}))}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}>
              <option value="">Sem categoria</option>
              {CATEGORY_OPTIONS.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 mt-3" style={{ color:"#94a3b8" }}>Status</label>
            <select value={pf.status} onChange={e=>setPf(p=>({...p,status:e.target.value}))}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}>
              <option value="todo">Não Iniciado</option>
              <option value="doing">Em Execução</option>
              <option value="done">Concluído</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Início</label>
            <input type="date" value={pf.startDate} onChange={e=>setPf(p=>({...p,startDate:e.target.value}))}
              className="w-full border rounded-xl px-2 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 mt-3" style={{ color:"#94a3b8" }}>Prazo</label>
            <input type="date" value={pf.dueDate} onChange={e=>setPf(p=>({...p,dueDate:e.target.value}))}
              className="w-full border rounded-xl px-2 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
          </div>
        </div>

        {/* Cliente + Responsável */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Cliente</label>
            <select value={pf.clientId} onChange={e=>handleClientSelect(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}>
              <option value="">Sem cliente</option>
              {(clients||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Responsável</label>
            <select value={pf.responsibleId} onChange={e=>setPf(p=>({...p,responsibleId:e.target.value}))}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}>
              <option value="">Sem responsável</option>
              {(teamUsers||[]).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* Checklist */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Checklist</label>
          <div className="space-y-1.5 mb-2">
            {pf.checklist.map((item,i)=>(
              <div key={i} className="flex items-center gap-2 p-2 rounded-xl" style={{ background:"rgba(248,250,252,0.7)", border:"1px solid rgba(226,232,240,0.5)" }}>
                <input type="checkbox" checked={item.done} onChange={e=>setPf(p=>{ const cl=[...p.checklist]; cl[i]={...cl[i],done:e.target.checked}; return {...p,checklist:cl}; })} className="w-3.5 h-3.5 rounded" style={{ accentColor:pf.color }}/>
                <span className="flex-1 text-xs" style={{ color:item.done?"#94a3b8":"#374151", textDecoration:item.done?"line-through":"none" }}>{item.text}</span>
                <button type="button" onClick={()=>setPf(p=>({...p,checklist:p.checklist.filter((_,j)=>j!==i)}))}
                  className="p-0.5 rounded text-slate-300 hover:text-red-400 transition-colors">×</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addChecklistItem()} placeholder="Adicionar item..."
              className="flex-1 border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)" }}/>
            <button onClick={addChecklistItem} type="button" className="px-3 py-1.5 text-white rounded-xl text-xs font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>+ Item</button>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pf.tags.map((tag,i)=>(
              <span key={i} className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background:"rgba(43,139,232,0.1)", color:"#2b8be8", border:"1px solid rgba(43,139,232,0.2)" }}>
                {tag}
                <button type="button" onClick={()=>setPf(p=>({...p,tags:p.tags.filter((_,j)=>j!==i)}))} className="opacity-50 hover:opacity-100">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newTag} onChange={e=>setNewTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder="Nova tag..."
              className="flex-1 border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
              style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)" }}/>
            <button onClick={addTag} type="button" className="px-3 py-1.5 text-white rounded-xl text-xs font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>+ Tag</button>
          </div>
        </div>

        {/* Observações */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>Observações</label>
          <textarea value={pf.notes} onChange={e=>setPf(p=>({...p,notes:e.target.value}))} placeholder="Notas internas..." rows={2}
            className="w-full border rounded-xl px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.8)", background:"rgba(255,255,255,0.98)" }}/>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
          <button onClick={()=>onSave(pf)} disabled={!pf.title.trim()}
            className="flex items-center gap-2 px-5 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50"
            style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)" }}>
            <Icon.Plus />{project?"Salvar":"Criar Projeto"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Projects() {
  const { projects, addProject, updateProject, deleteProject, clients, teamUsers, currentProfile, tasks } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [search, setSearch] = useState("");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterResponsible, setFilterResponsible] = useState("all");
  const t = today();

  // KPIs
  const active = projects.filter(p=>p.status!=="done").length;
  const done = projects.filter(p=>p.status==="done").length;
  const overdue = projects.filter(p=>p.dueDate && p.dueDate < t && p.status!=="done").length;
  const dueThisWeek = projects.filter(p=>{
    if (!p.dueDate || p.status==="done") return false;
    const d = new Date(p.dueDate+"T12:00:00");
    const now = new Date();
    const week = new Date(now); week.setDate(week.getDate()+7);
    return d >= now && d <= week;
  }).length;
  const avgProgress = projects.length > 0 ? Math.round(projects.reduce((s,p)=>{
    const cl=p.checklist||[]; return s+(cl.length>0?Math.round(cl.filter(c=>c.done).length/cl.length*100):0);
  },0)/projects.length) : 0;

  // Filtros
  const filtered = projects.filter(p => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.clientName?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPriority !== "all" && p.priority !== filterPriority) return false;
    if (filterCategory !== "all" && p.category !== filterCategory) return false;
    if (filterResponsible !== "all" && p.responsibleId !== filterResponsible) return false;
    return true;
  });

  const byStatus = status => filtered.filter(p=>p.status===status).sort((a,b)=>{
    const po = { urgent:0,high:1,medium:2,low:3 };
    return (po[a.priority]||2)-(po[b.priority]||2);
  });

  const handleSave = async pf => {
    if (editingProject) {
      await updateProject({ ...editingProject, ...pf, completedAt: pf.status==="done" && editingProject.status!=="done" ? new Date().toISOString() : editingProject.completedAt||"" });
    } else {
      await addProject({ id:uid(), ...pf, createdAt:new Date().toISOString(), completedAt:"", orderIndex:0 });
    }
    setFormOpen(false); setEditingProject(null);
  };

  const handleMove = async (project, newStatus) => {
    await updateProject({ ...project, status:newStatus, completedAt: newStatus==="done" ? new Date().toISOString() : "" });
  };

  const handleUpdateChecklist = async (project, idx, checked) => {
    const cl = [...project.checklist];
    cl[idx] = { ...cl[idx], done:checked };
    await updateProject({ ...project, checklist:cl });
  };

  // Insights
  const insights = useMemo(() => {
    const list = [];
    if (overdue > 0) list.push({ icon:"🚨", text:`${overdue} projeto${overdue>1?"s":""} em atraso — atenção imediata necessária`, color:"#ef4444" });
    if (dueThisWeek > 0) list.push({ icon:"⏰", text:`${dueThisWeek} projeto${dueThisWeek>1?"s":""} vencem esta semana`, color:"#f59e0b" });
    const urgentCount = projects.filter(p=>p.priority==="urgent"&&p.status!=="done").length;
    if (urgentCount > 0) list.push({ icon:"⚡", text:`${urgentCount} projeto${urgentCount>1?"s":""} com prioridade urgente em aberto`, color:"#ef4444" });
    const catCounts = {};
    projects.filter(p=>p.status==="done"&&p.category).forEach(p=>catCounts[p.category]=(catCounts[p.category]||0)+1);
    const topCat = Object.entries(catCounts).sort((a,b)=>b[1]-a[1])[0];
    if (topCat) list.push({ icon:"🏆", text:`Projetos de "${topCat[0]}" têm maior taxa de conclusão`, color:"#10b981" });
    if (list.length === 0 && projects.length > 0) list.push({ icon:"✅", text:"Tudo sob controle! Nenhum alerta no momento.", color:"#10b981" });
    return list.slice(0,3);
  }, [projects, overdue, dueThisWeek]);

  const categories = [...new Set(projects.map(p=>p.category).filter(Boolean))];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color:"#1a1d23", letterSpacing:"-0.01em" }}>Projetos</h2>
          <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Gestão operacional e estratégica do escritório</p>
        </div>
        <button onClick={()=>{setEditingProject(null);setFormOpen(true);}}
          className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold"
          style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", boxShadow:"0 2px 8px rgba(26,29,35,0.25)" }}>
          <Icon.Plus />Novo Projeto
        </button>
      </div>

      {/* KPIs */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label:"Ativos", value:active, color:"#2b8be8", icon:"📋" },
            { label:"Concluídos", value:done, color:"#10b981", icon:"✅" },
            { label:"Atrasados", value:overdue, color:overdue>0?"#ef4444":"#10b981", icon:"⚠️" },
            { label:"Vencem na semana", value:dueThisWeek, color:"#f59e0b", icon:"📅" },
            { label:"Progresso médio", value:`${avgProgress}%`, color:avgProgress>=70?"#10b981":avgProgress>=40?"#2b8be8":"#f59e0b", icon:"📈" },
          ].map(k=>(
            <div key={k.label} className="rounded-2xl p-4 transition-all"
              style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)", boxShadow:"0 4px 16px rgba(26,29,35,0.04)", backdropFilter:"blur(8px)" }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 24px rgba(26,29,35,0.08)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,29,35,0.04)";}}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color:"#94a3b8" }}>{k.label}</p>
                  <p className="text-2xl font-black" style={{ color:k.color }}>{k.value}</p>
                </div>
                <span className="text-xl">{k.icon}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && projects.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {insights.map((ins,i)=>(
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1"
              style={{ background:`${ins.color}08`, border:`1px solid ${ins.color}20`, minWidth:200 }}>
              <span className="text-base flex-shrink-0">{ins.icon}</span>
              <p className="text-xs" style={{ color:"#374151" }}>{ins.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1" style={{ minWidth:180, maxWidth:260 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{width:14,height:14,position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar projetos..."
            className="w-full border rounded-xl pl-8 pr-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)" }}/>
        </div>
        <select value={filterPriority} onChange={e=>setFilterPriority(e.target.value)}
          className="border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
          style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
          <option value="all">Todas prioridades</option>
          {Object.entries(PRIORITY_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        {categories.length > 0 && (
          <select value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}
            className="border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
            <option value="all">Todas categorias</option>
            {categories.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {(teamUsers||[]).length > 1 && (
          <select value={filterResponsible} onChange={e=>setFilterResponsible(e.target.value)}
            className="border rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-300"
            style={{ borderColor:"rgba(221,227,237,0.7)", background:"rgba(255,255,255,0.98)", color:"#374151" }}>
            <option value="all">Todos responsáveis</option>
            {(teamUsers||[]).map(u=><option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>)}
          </select>
        )}
      </div>

      {/* ── KANBAN ── */}
      {projects.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ background:"rgba(255,255,255,0.98)", border:"1px solid rgba(221,227,237,0.7)" }}>
          <p className="text-5xl mb-4">🚀</p>
          <p className="text-lg font-bold" style={{ color:"#1a1d23" }}>Nenhum projeto ainda</p>
          <p className="text-sm mt-1" style={{ color:"#94a3b8" }}>Crie o primeiro projeto estratégico do escritório</p>
          <button onClick={()=>{setEditingProject(null);setFormOpen(true);}} className="mt-4 px-5 py-2 text-white rounded-xl text-sm font-bold"
            style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)" }}>Criar primeiro projeto</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {["todo","doing","done"].map(status => {
            const col = COLUMN_CONFIG[status];
            const colProjects = byStatus(status);
            return (
              <div key={status} className="rounded-2xl overflow-hidden"
                style={{ background:col.bg, border:"1px solid rgba(221,227,237,0.5)" }}>
                {/* Header da coluna */}
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom:"1px solid rgba(221,227,237,0.4)" }}>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-base" style={{ color:col.color }}>{col.icon}</span>
                    <h3 className="text-sm font-black" style={{ color:"#1a1d23" }}>{col.label}</h3>
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background:`${col.color}18`, color:col.color }}>
                      {colProjects.length}
                    </span>
                  </div>
                  <button onClick={()=>{setEditingProject(null); setFormOpen(true);}} className="p-1 rounded-lg transition-all" style={{ color:"#94a3b8" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(43,139,232,0.1)";e.currentTarget.style.color="#2b8be8";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                    <Icon.Plus />
                  </button>
                </div>
                {/* Cards */}
                <div className="p-3 space-y-3 min-h-32">
                  {colProjects.map(p => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onEdit={proj=>{setEditingProject(proj);setFormOpen(true);}}
                      onDelete={deleteProject}
                      onMove={handleMove}
                      onUpdateChecklist={handleUpdateChecklist}
                    />
                  ))}
                  {colProjects.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-xl"
                      style={{ border:"1.5px dashed rgba(221,227,237,0.6)" }}>
                      <p className="text-[10px] font-medium" style={{ color:"#cbd5e1" }}>Nenhum projeto aqui</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {formOpen && (
        <ProjectForm
          project={editingProject}
          onSave={handleSave}
          onClose={()=>{setFormOpen(false);setEditingProject(null);}}
        />
      )}
    </div>
  );
}


// ============================================================
// CÓDICE IA — Central de Inteligência Operacional
// ============================================================

async function callCodiceAI(type, context, messages, sessionToken) {
  const res = await fetch("https://kpgpcqjefrixzshmskls.supabase.co/functions/v1/codice-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (sessionToken || ""),
      "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ type, context, messages }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Erro na IA");
  return json.data;
}

function ScoreRing({ score, size = 80 }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score, 0), 100) / 100;
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={size*0.08}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={size*0.08}
        strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition:"stroke-dashoffset 1s ease", filter:`drop-shadow(0 0 6px ${color}88)` }}/>
      <text x={size/2} y={size/2+4} textAnchor="middle" fontSize={size*0.22} fontWeight="900" fill={color}>{score}</text>
    </svg>
  );
}

function AIInsightCard({ icon, title, content, color, urgent }) {
  return (
    <div className="rounded-2xl p-4 transition-all duration-300"
      style={{
        background: urgent ? `rgba(239,68,68,0.06)` : "rgba(255,255,255,0.04)",
        border: `1px solid ${color}25`,
        backdropFilter: "blur(8px)",
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateX(4px)";e.currentTarget.style.borderColor=color+"50";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="translateX(0)";e.currentTarget.style.borderColor=color+"25";}}>
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
        <div>
          <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color }}>{title}</p>
          <p className="text-sm leading-relaxed" style={{ color:"rgba(255,255,255,0.75)" }}>{content}</p>
        </div>
      </div>
    </div>
  );
}

function CodiceIA() {
  const { tasks, habits, projects, teamUsers, clients, onboardings, currentProfile, aiAnalyses, saveAiAnalysis } = useApp();
  const [loading, setLoading] = useState({ full:false, burnout:false, workload:false, habits:false });
  const [analysis, setAnalysis] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const t = today();

  // Contexto real do sistema para enviar à IA
  const buildContext = () => {
    const overdue = tasks.filter(x => !x.completed && x.dueDate && x.dueDate < t && !x.parentId);
    const doneThisWeek = tasks.filter(x => {
      const d = new Date(); d.setDate(d.getDate()-7);
      return x.completed && x.dueDate >= d.toISOString().split("T")[0];
    });
    const rate = tasks.length > 0 ? Math.round(tasks.filter(x=>x.completed).length/tasks.length*100) : 0;
    return {
      data_hoje: t,
      tarefas: { total:tasks.filter(x=>!x.parentId).length, concluidas:tasks.filter(x=>x.completed).length, atrasadas:overdue.length, concluidas_7d:doneThisWeek.length, taxa_conclusao:rate },
      habitos: { total:habits.length, consistencia_media: habits.length > 0 ? Math.round(habits.reduce((s,h)=>{ const d30=(h.completedDates||[]).filter(d=>{ const dt=new Date(); dt.setDate(dt.getDate()-30); return d >= dt.toISOString().split("T")[0]; }).length; return s+Math.round(d30/30*100); },0)/habits.length) : 0 },
      projetos: { total:projects.length, ativos:projects.filter(p=>p.status!=="done").length, atrasados:projects.filter(p=>p.dueDate&&p.dueDate<t&&p.status!=="done").length },
      equipe: (teamUsers||[]).map(u => { const ut=tasks.filter(x=>x.assignedTo===u.id); return { nome:u.name, ativas:ut.filter(x=>!x.completed).length, atrasadas:ut.filter(x=>!x.completed&&x.dueDate&&x.dueDate<t).length, concluidas:ut.filter(x=>x.completed).length }; }),
      clientes: { total:clients.length, ativos:clients.filter(c=>c.status==="active").length },
      onboardings: { ativos:onboardings.filter(o=>o.status==="em_andamento").length },
      atrasadas_detalhes: overdue.slice(0,5).map(x=>({ titulo:x.title, dias:Math.floor((new Date(t)-new Date(x.dueDate+"T12:00:00"))/(1000*60*60*24)) })),
    };
  };

  // Token JWT direto do auth module — sempre o mais atual
  const getSession = () => {
    try {
      // Prioridade 1: session em memória (mais fresca)
      const session = auth.getSession();
      if (session?.access_token) return session.access_token;
      // Prioridade 2: localStorage como fallback
      const s = JSON.parse(localStorage.getItem("sb_session")||"{}");
      return s.access_token || "";
    } catch { return ""; }
  };

  const runAnalysis = async (type = "full") => {
    setLoading(p=>({...p,[type]:true}));
    try {
      const ctx = buildContext();
      const data = await callCodiceAI(type, ctx, null, getSession());
      if (type === "full") setAnalysis(data);
      await saveAiAnalysis(type, data);
    } catch(e) {
      console.error("Códice IA:", e.message);
    } finally {
      setLoading(p=>({...p,[type]:false}));
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = { role:"user", content: chatInput.trim() };
    const ctx = buildContext();
    const history = [...chatMessages, userMsg];
    setChatMessages(history);
    setChatInput("");
    setChatLoading(true);
    try {
      const msgs = [
        { role:"user", content:`Contexto atual do escritório:\n${JSON.stringify(ctx, null, 2)}\n\nPergunta: ${userMsg.content}` }
      ];
      if (chatMessages.length > 0) {
        msgs.unshift(...chatMessages.slice(-6));
      }
      const reply = await callCodiceAI("chat", ctx, msgs, getSession());
      setChatMessages(p => [...p, { role:"assistant", content: typeof reply === "string" ? reply : JSON.stringify(reply) }]);
    } catch(e) {
      setChatMessages(p => [...p, { role:"assistant", content: "Erro ao processar. Verifique a chave da API." }]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatMessages]);

  // Carregar última análise salva ao montar
  useEffect(() => {
    const last = (aiAnalyses||[]).find(a => a.type === "full");
    if (last?.result && !analysis) setAnalysis(last.result);
  }, [aiAnalyses]);

  const ctx = buildContext();
  const SECTIONS = [["overview","🎯 Visão Geral"],["burnout","🔥 Burnout"],["workload","⚡ Workload"],["habits","🌱 Hábitos"],["chat","💬 Chat IA"]];

  return (
    <div className="min-h-screen rounded-2xl overflow-hidden" style={{
      background: "linear-gradient(160deg,#0f1117 0%,#0d1520 40%,#0f1117 100%)",
      border: "1px solid rgba(91,170,255,0.1)",
    }}>

      {/* ── HERO ── */}
      <div className="px-6 pt-8 pb-6" style={{ borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                style={{ background:"linear-gradient(135deg,rgba(91,170,255,0.2),rgba(43,139,232,0.1))", border:"1px solid rgba(91,170,255,0.2)" }}>
                🧠
              </div>
              <div>
                <h1 className="text-xl font-black" style={{ color:"#fff", letterSpacing:"-0.02em" }}>Códice IA</h1>
                <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color:"rgba(91,170,255,0.7)" }}>Central de Inteligência Operacional</p>
              </div>
            </div>
            <p className="text-xs max-w-lg" style={{ color:"rgba(255,255,255,0.45)" }}>
              Análise estratégica em tempo real com GPT-4o. Dados reais do escritório transformados em inteligência acionável.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {analysis && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.2)" }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background:"#10b981", boxShadow:"0 0 6px #10b981" }}/>
                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color:"#10b981" }}>Análise ativa</span>
              </div>
            )}
            <button onClick={()=>runAnalysis("full")} disabled={loading.full}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-all"
              style={{ background:loading.full?"rgba(91,170,255,0.1)":"linear-gradient(135deg,rgba(91,170,255,0.9),rgba(43,139,232,0.9))", color:"#fff", border:"1px solid rgba(91,170,255,0.3)", boxShadow:loading.full?"none":"0 4px 20px rgba(43,139,232,0.3)", opacity:loading.full?0.7:1 }}>
              {loading.full ? <><Icon.Loader /><span>Analisando...</span></> : <><Icon.Sparkles /><span>Analisar Agora</span></>}
            </button>
          </div>
        </div>

        {/* Mini KPIs sempre visíveis */}
        <div className="grid grid-cols-4 gap-3 mt-5">
          {[
            { label:"Tarefas ativas", value:ctx.tarefas.total-ctx.tarefas.concluidas, color:"#5aaff5" },
            { label:"Atrasadas", value:ctx.tarefas.atrasadas, color:ctx.tarefas.atrasadas>0?"#ef4444":"#10b981" },
            { label:"Taxa conclusão", value:`${ctx.tarefas.taxa_conclusao}%`, color:ctx.tarefas.taxa_conclusao>=70?"#10b981":ctx.tarefas.taxa_conclusao>=40?"#f59e0b":"#ef4444" },
            { label:"Projetos ativos", value:ctx.projetos.ativos, color:"#a855f7" },
          ].map(k=>(
            <div key={k.label} className="rounded-xl p-3" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)" }}>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.35)" }}>{k.label}</p>
              <p className="text-xl font-black" style={{ color:k.color, fontVariantNumeric:"tabular-nums" }}>{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="flex gap-1 px-4 pt-4" style={{ borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        {SECTIONS.map(([id,label])=>(
          <button key={id} onClick={()=>setActiveSection(id)}
            className="px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all"
            style={{ background:activeSection===id?"rgba(91,170,255,0.12)":"transparent", color:activeSection===id?"#5aaff5":"rgba(255,255,255,0.35)", borderBottom:activeSection===id?"2px solid #5aaff5":"2px solid transparent" }}>
            {label}
          </button>
        ))}
      </div>

      <div className="p-6">

        {/* ── VISÃO GERAL ── */}
        {activeSection === "overview" && (
          <div className="space-y-6">
            {!analysis ? (
              <div className="rounded-2xl p-12 text-center" style={{ background:"rgba(255,255,255,0.03)", border:"1px dashed rgba(91,170,255,0.2)" }}>
                <div className="text-5xl mb-4">🧠</div>
                <p className="text-lg font-black mb-2" style={{ color:"#fff" }}>Inteligência ainda não ativada</p>
                <p className="text-sm mb-6" style={{ color:"rgba(255,255,255,0.4)" }}>Clique em "Analisar Agora" para gerar a análise executiva completa do escritório com GPT-4o.</p>
                <button onClick={()=>runAnalysis("full")} disabled={loading.full}
                  className="px-6 py-3 rounded-xl text-sm font-black" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", color:"#fff" }}>
                  {loading.full ? "Analisando..." : "🚀 Gerar primeira análise"}
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Score + Manchete */}
                <div className="rounded-2xl p-6" style={{ background:"linear-gradient(135deg,rgba(43,139,232,0.08),rgba(255,255,255,0.03))", border:"1px solid rgba(91,170,255,0.15)" }}>
                  <div className="flex items-center gap-6">
                    <ScoreRing score={analysis.score||0} size={88}/>
                    <div className="flex-1">
                      <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color:"rgba(91,170,255,0.6)" }}>Score operacional — {analysis.score_label||""}</p>
                      <h2 className="text-xl font-black leading-snug mb-2" style={{ color:"#fff" }}>{analysis.manchete}</h2>
                      <p className="text-sm leading-relaxed" style={{ color:"rgba(255,255,255,0.6)" }}>{analysis.resumo_executivo}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Pontos fortes */}
                  {analysis.pontos_fortes?.length > 0 && (
                    <div className="rounded-2xl p-5" style={{ background:"rgba(16,185,129,0.05)", border:"1px solid rgba(16,185,129,0.15)" }}>
                      <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color:"#10b981" }}>✓ Pontos Fortes</p>
                      <div className="space-y-2">
                        {analysis.pontos_fortes.map((p,i)=>(
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-xs mt-0.5" style={{ color:"#10b981" }}>•</span>
                            <p className="text-sm" style={{ color:"rgba(255,255,255,0.7)" }}>{p}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Alertas */}
                  {analysis.alertas?.length > 0 && (
                    <div className="rounded-2xl p-5" style={{ background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.15)" }}>
                      <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color:"#ef4444" }}>⚡ Alertas</p>
                      <div className="space-y-2">
                        {analysis.alertas.map((a,i)=>(
                          <div key={i} className="p-2.5 rounded-xl" style={{ background:"rgba(239,68,68,0.06)" }}>
                            <p className="text-xs font-bold" style={{ color:a.urgencia==="alta"?"#ef4444":a.urgencia==="media"?"#f59e0b":"#94a3b8" }}>{a.titulo}</p>
                            <p className="text-[11px] mt-0.5" style={{ color:"rgba(255,255,255,0.5)" }}>{a.descricao}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recomendações */}
                {analysis.recomendacoes?.length > 0 && (
                  <div className="rounded-2xl p-5" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color:"rgba(91,170,255,0.8)" }}>🎯 Recomendações</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {analysis.recomendacoes.map((r,i)=>{
                        const prazoCor = r.prazo==="hoje"?"#ef4444":r.prazo==="semana"?"#f59e0b":"#10b981";
                        return (
                          <div key={i} className="p-3 rounded-xl" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)" }}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background:prazoCor+"20", color:prazoCor }}>{r.prazo}</span>
                            </div>
                            <p className="text-xs font-bold mb-1" style={{ color:"rgba(255,255,255,0.9)" }}>{r.acao}</p>
                            <p className="text-[10px]" style={{ color:"rgba(255,255,255,0.4)" }}>{r.impacto}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Insights */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {analysis.insight_habitos && <AIInsightCard icon="🌱" title="Hábitos" content={analysis.insight_habitos} color="#10b981"/>}
                  {analysis.insight_projetos && <AIInsightCard icon="🚀" title="Projetos" content={analysis.insight_projetos} color="#a855f7"/>}
                  {analysis.insight_equipe && <AIInsightCard icon="👥" title="Equipe" content={analysis.insight_equipe} color="#5aaff5"/>}
                </div>

                {/* Previsão */}
                {analysis.previsao_7d && (
                  <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background:"rgba(168,85,247,0.06)", border:"1px solid rgba(168,85,247,0.15)" }}>
                    <span className="text-2xl">🔮</span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color:"rgba(168,85,247,0.8)" }}>Previsão 7 dias</p>
                      <p className="text-sm" style={{ color:"rgba(255,255,255,0.7)" }}>{analysis.previsao_7d}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── BURNOUT ── */}
        {activeSection === "burnout" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black" style={{ color:"#fff" }}>Análise de Risco de Burnout</h3>
                <p className="text-xs" style={{ color:"rgba(255,255,255,0.4)" }}>Baseada em carga, atrasos e padrões comportamentais</p>
              </div>
              <button onClick={()=>runAnalysis("burnout")} disabled={loading.burnout}
                className="px-4 py-2 rounded-xl text-xs font-black" style={{ background:"linear-gradient(135deg,rgba(239,68,68,0.8),rgba(220,38,38,0.8))", color:"#fff" }}>
                {loading.burnout ? "Analisando..." : "🔥 Analisar Burnout"}
              </button>
            </div>
            {analysis?.burnout_risk ? (
              <div className="space-y-4">
                <div className="rounded-2xl p-6 text-center" style={{
                  background:`rgba(${analysis.burnout_risk==="alto"?"239,68,68":analysis.burnout_risk==="medio"?"245,158,11":"16,185,129"},0.08)`,
                  border:`1px solid rgba(${analysis.burnout_risk==="alto"?"239,68,68":analysis.burnout_risk==="medio"?"245,158,11":"16,185,129"},0.2)`
                }}>
                  <p className="text-5xl font-black uppercase mb-2" style={{ color:analysis.burnout_risk==="alto"?"#ef4444":analysis.burnout_risk==="medio"?"#f59e0b":"#10b981" }}>
                    {analysis.burnout_risk}
                  </p>
                  <p className="text-sm" style={{ color:"rgba(255,255,255,0.5)" }}>Risco de burnout detectado</p>
                </div>
                {analysis.burnout_motivos?.length > 0 && (
                  <div className="rounded-2xl p-4" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-3" style={{ color:"rgba(239,68,68,0.8)" }}>Sinais detectados</p>
                    {analysis.burnout_motivos.map((m,i)=>(
                      <div key={i} className="flex items-center gap-2 mb-2">
                        <span className="text-xs" style={{ color:"#ef4444" }}>⚡</span>
                        <p className="text-sm" style={{ color:"rgba(255,255,255,0.65)" }}>{m}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl p-10 text-center" style={{ background:"rgba(255,255,255,0.03)", border:"1px dashed rgba(239,68,68,0.2)" }}>
                <p className="text-3xl mb-3">🔥</p>
                <p className="text-sm" style={{ color:"rgba(255,255,255,0.4)" }}>Clique em "Analisar Burnout" para detectar sinais de sobrecarga</p>
              </div>
            )}
          </div>
        )}

        {/* ── WORKLOAD ── */}
        {activeSection === "workload" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black" style={{ color:"#fff" }}>Análise de Workload da Equipe</h3>
              <button onClick={()=>runAnalysis("workload")} disabled={loading.workload}
                className="px-4 py-2 rounded-xl text-xs font-black" style={{ background:"linear-gradient(135deg,rgba(91,170,255,0.8),rgba(43,139,232,0.8))", color:"#fff" }}>
                {loading.workload ? "Analisando..." : "⚡ Analisar Workload"}
              </button>
            </div>
            {/* Cards da equipe */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ctx.equipe.map((u,i)=>{
                const load = u.ativas + u.atrasadas * 1.5;
                const pct = Math.min(Math.round(load/10*100),100);
                const lc = pct>=80?"#ef4444":pct>=50?"#f59e0b":"#10b981";
                return (
                  <div key={i} className="rounded-2xl p-4" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-black" style={{ color:"#fff" }}>{u.nome}</p>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background:lc+"20", color:lc }}>
                        {pct>=80?"Crítico":pct>=50?"Pesado":"Normal"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[{l:"Ativas",v:u.ativas,c:"#5aaff5"},{l:"Atrasadas",v:u.atrasadas,c:"#ef4444"},{l:"Concluídas",v:u.concluidas,c:"#10b981"}].map(k=>(
                        <div key={k.l} className="text-center p-2 rounded-xl" style={{ background:"rgba(255,255,255,0.04)" }}>
                          <p className="text-base font-black" style={{ color:k.c }}>{k.v}</p>
                          <p className="text-[9px]" style={{ color:"rgba(255,255,255,0.35)" }}>{k.l}</p>
                        </div>
                      ))}
                    </div>
                    <div className="w-full h-1.5 rounded-full" style={{ background:"rgba(255,255,255,0.08)" }}>
                      <div className="h-1.5 rounded-full" style={{ width:pct+"%", background:`linear-gradient(90deg,${lc},${lc}aa)` }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── HÁBITOS ── */}
        {activeSection === "habits" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black" style={{ color:"#fff" }}>Análise Comportamental de Hábitos</h3>
              <button onClick={()=>runAnalysis("habits")} disabled={loading.habits}
                className="px-4 py-2 rounded-xl text-xs font-black" style={{ background:"linear-gradient(135deg,rgba(16,185,129,0.8),rgba(5,150,105,0.8))", color:"#fff" }}>
                {loading.habits ? "Analisando..." : "🌱 Analisar Hábitos"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {habits.map(h=>{
                const d30 = new Date(); d30.setDate(d30.getDate()-30);
                const c = Math.round((h.completedDates||[]).filter(d=>d>=d30.toISOString().split("T")[0]).length/30*100);
                return (
                  <div key={h.id} className="rounded-2xl p-4" style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{h.emoji||"⭐"}</span>
                      <div>
                        <p className="text-sm font-black" style={{ color:"#fff" }}>{h.title}</p>
                        {h.identity && <p className="text-[10px]" style={{ color:`${h.color||"#5aaff5"}` }}>{h.identity}</p>}
                      </div>
                      <div className="ml-auto text-right">
                        <p className="text-lg font-black" style={{ color:c>=70?"#10b981":c>=40?"#f59e0b":"#ef4444" }}>{c}%</p>
                        <p className="text-[9px]" style={{ color:"rgba(255,255,255,0.35)" }}>30 dias</p>
                      </div>
                    </div>
                    <div className="w-full h-1 rounded-full" style={{ background:"rgba(255,255,255,0.08)" }}>
                      <div className="h-1 rounded-full" style={{ width:c+"%", background:h.color||"#5aaff5" }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CHAT IA ── */}
        {activeSection === "chat" && (
          <div className="flex flex-col" style={{ height:"calc(100vh - 380px)", minHeight:400 }}>
            <div className="mb-4">
              <h3 className="text-base font-black" style={{ color:"#fff" }}>Chat com o Códice IA</h3>
              <p className="text-xs" style={{ color:"rgba(255,255,255,0.4)" }}>Consultor executivo com contexto real do seu escritório. Pergunte qualquer coisa.</p>
            </div>
            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
              {chatMessages.length === 0 && (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  {["Como está a produtividade da equipe esta semana?","Quais projetos correm mais risco de atraso?","Existe risco de burnout no time?","O que devo priorizar hoje?"].map(q=>(
                    <button key={q} onClick={()=>{setChatInput(q);}}
                      className="p-3 rounded-xl text-left text-xs transition-all"
                      style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.6)" }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(91,170,255,0.3)";e.currentTarget.style.color="#fff";}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.08)";e.currentTarget.style.color="rgba(255,255,255,0.6)";}}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {chatMessages.map((m,i)=>(
                <div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
                  <div className="max-w-lg rounded-2xl px-4 py-3 text-sm"
                    style={{
                      background: m.role==="user" ? "linear-gradient(135deg,rgba(91,170,255,0.25),rgba(43,139,232,0.2))" : "rgba(255,255,255,0.05)",
                      border: m.role==="user" ? "1px solid rgba(91,170,255,0.3)" : "1px solid rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.85)",
                      lineHeight: 1.6,
                    }}>
                    {m.role==="assistant" && <span className="text-[10px] font-black uppercase tracking-widest block mb-1" style={{ color:"rgba(91,170,255,0.7)" }}>Códice IA</span>}
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3" style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center gap-1.5">
                      {[0,1,2].map(i=>(
                        <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background:"rgba(91,170,255,0.7)", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }}/>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
            {/* Input */}
            <div className="flex gap-3">
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendChat()}
                placeholder="Pergunte sobre produtividade, equipe, projetos, hábitos..."
                className="flex-1 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
                style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#fff", caretColor:"#5aaff5" }}/>
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-3 rounded-xl font-black text-sm transition-all disabled:opacity-40"
                style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", color:"#fff", minWidth:52 }}>
                {chatLoading ? "..." : "→"}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// APP ROOT
// ============================================================
function AppContent({ onLogout }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const { currentProfile } = useApp();
  const isAdmin    = !currentProfile || currentProfile.role === "admin";
  const isColab    = currentProfile?.role === "colaborador";
  const isViewer   = currentProfile?.role === "visualizador";

  // Guard: redirecionar se aba não permitida
  useEffect(() => {
    const adminOnly = ["severance","settings","team"];
    const notForViewer = ["habits","clients","relationship","obligations","reports","severance","settings","team"];
    if (isViewer && notForViewer.includes(activeTab)) setActiveTab("tasks");
    if (!isAdmin && adminOnly.includes(activeTab)) setActiveTab("dashboard");
  }, [activeTab, isAdmin, isViewer]);

  // Atalhos de teclado
  useEffect(() => {
    const handler = (e) => {
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "1") setActiveTab("dashboard");
      if (k === "2") setActiveTab("tasks");
      if (!isViewer && k === "3") setActiveTab("habits");
      if (!isViewer && k === "4") setActiveTab("clients");
      if (!isViewer && k === "6") setActiveTab("obligations");
      if (isAdmin  && k === "7") setActiveTab("severance");
      if (!isViewer && k === "8") setActiveTab("relationship");
      if (!isViewer && k === "9") setActiveTab("reports");
      if (isAdmin  && k === "0") setActiveTab("settings");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isAdmin, isViewer]);

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} onLogout={onLogout}>
      {activeTab === "dashboard" && <Dashboard />}
      {activeTab === "tasks" && <Tasks />}
      {!isViewer && activeTab === "habits" && <Habits />}
      {!isViewer && activeTab === "clients" && <Clients />}
      {activeTab === "onboarding" && <Onboarding />}
      {!isViewer && activeTab === "obligations" && <Obligations />}
      {!isViewer && activeTab === "reports" && <Reports />}
      {isAdmin   && activeTab === "severance" && <SeveranceSimulation />}
      {!isViewer && activeTab === "relationship" && <Relationship />}
      {isAdmin   && activeTab === "settings" && <SettingsPage />}
      {activeTab === "projects" && <Projects />}
      {activeTab === "codiceai" && <CodiceIA />}
      {activeTab === "workload" && <Workload />}
      {isAdmin   && activeTab === "team" && <Team />}
    </Layout>
  );
}

// ============================================================
// LOGIN SCREEN
// ============================================================
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async () => {
    if (!email || !password) { setError("Preencha email e senha"); return; }
    setLoading(true); setError("");
    try {
      if (mode === "login") {
        await auth.signIn(email, password);
      } else {
        await auth.signUp(email, password);
      }
      onLogin();
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg, #1c1f26 0%, #1e2e4a 50%, #1a3a6e 100%)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Inter',system-ui,sans-serif" }}>
      <div style={{ width:"100%", maxWidth:400, padding:"0 24px" }}>
        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <h1 style={{ color:"#fff", fontSize:32, fontWeight:900, margin:0, letterSpacing:"0.08em", lineHeight:1.15, textTransform:"uppercase", textShadow:"0 2px 24px rgba(91,175,245,0.4)" }}>
            CÓDICE<br/>CONTABILIDADE
          </h1>
          <div style={{ width:60, height:3, background:"linear-gradient(90deg,#5aaff5,#2b8be8)", borderRadius:2, margin:"14px auto 0" }}></div>
          <p style={{ color:"rgba(255,255,255,0.45)", fontSize:13, marginTop:12 }}>
            {mode === "login" ? "Entre na sua conta" : "Crie sua conta"}
          </p>
        </div>

        {/* Card */}
        <div style={{ background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:20, padding:32, backdropFilter:"blur(12px)" }}>
          <div style={{ display:"flex", gap:8, marginBottom:24, background:"rgba(0,0,0,0.2)", borderRadius:12, padding:4 }}>
            {["login","signup"].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                style={{ flex:1, padding:"8px 0", borderRadius:10, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, transition:"all 0.2s",
                  background: mode===m ? "linear-gradient(135deg,#5aaff5,#2b8be8)" : "transparent",
                  color: mode===m ? "#fff" : "rgba(255,255,255,0.5)" }}>
                {m === "login" ? "Entrar" : "Cadastrar"}
              </button>
            ))}
          </div>

          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", color:"rgba(255,255,255,0.7)", fontSize:12, fontWeight:600, marginBottom:6 }}>EMAIL</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              onKeyDown={e => e.key === "Enter" && handle()}
              style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:14, outline:"none", boxSizing:"border-box" }} />
          </div>

          <div style={{ marginBottom:24 }}>
            <label style={{ display:"block", color:"rgba(255,255,255,0.7)", fontSize:12, fontWeight:600, marginBottom:6 }}>SENHA</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === "Enter" && handle()}
              style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:"1px solid rgba(255,255,255,0.15)", background:"rgba(255,255,255,0.08)", color:"#fff", fontSize:14, outline:"none", boxSizing:"border-box" }} />
          </div>

          {error && <div style={{ background:"rgba(239,68,68,0.15)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:10, padding:"10px 14px", color:"#fca5a5", fontSize:13, marginBottom:16 }}>{error}</div>}

          <button onClick={handle} disabled={loading}
            style={{ width:"100%", padding:"13px 0", borderRadius:12, border:"none", cursor:loading?"not-allowed":"pointer", fontSize:15, fontWeight:700, color:"#fff",
              background: loading ? "rgba(91,175,245,0.4)" : "linear-gradient(135deg,#5aaff5,#2b8be8)",
              boxShadow: loading ? "none" : "0 4px 20px #2b8be850", transition:"all 0.2s" }}>
            {loading ? "Aguarde..." : (mode === "login" ? "Entrar" : "Criar Conta")}
          </button>
        </div>
        <p style={{ textAlign:"center", color:"rgba(255,255,255,0.25)", fontSize:11, marginTop:24 }}>Códice Contabilidade © 2025</p>
      </div>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    auth.restoreSession().then(session => {
      setLoggedIn(!!session);
      setAuthChecked(true);
    });
  }, []);

  const handleLogin = () => setLoggedIn(true);
  const handleLogout = async () => {
    await auth.signOut();
    setLoggedIn(false);
  };

  // Aguardar verificação de sessão antes de renderizar
  if (!authChecked) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#eef1f7", flexDirection:"column", gap:16 }}>
      <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#5aaff5" strokeWidth="2" style={{ width:24, height:24 }}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <p style={{ color:"#64748b", fontSize:14, fontWeight:600 }}>Carregando...</p>
    </div>
  );

  if (!loggedIn) return <LoginScreen onLogin={handleLogin} />;

  return (
    <AppProvider>
      <AppContent onLogout={handleLogout} />
    </AppProvider>
  );
}
