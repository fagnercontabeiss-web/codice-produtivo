import { useState, useEffect, useMemo, useRef, createContext, useContext, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { db } from "./supabase.js";

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
  settings: { appName: "Códice Produtivo", loginEmail: "Fagner", loginPassword: "Codice" }
};

// ============================================================
// CONTEXT
// ============================================================
const AppContext = createContext(null);
function AppProvider({ children }) {
  const [state, setState] = useState(defaultState);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);

  const taskFromDb = r => ({ id:r.id, title:r.title, description:r.description||"", categoryId:r.category_id, contextId:r.context_id, clientId:r.client_id, dueDate:r.due_date, completed:r.completed, isRecurring:r.is_recurring, checklist:r.checklist||[] });
  const taskToDb   = t => ({ id:t.id, title:t.title, description:t.description||"", category_id:t.categoryId, context_id:t.contextId, client_id:t.clientId, due_date:t.dueDate, completed:t.completed, is_recurring:t.isRecurring, checklist:t.checklist||[] });
  const habitFromDb = r => ({ id:r.id, name:r.name, frequency:r.frequency, freqDays:r.freq_days||[], completedDates:r.completed_dates||[] });
  const habitToDb   = h => ({ id:h.id, name:h.name, frequency:h.frequency, freq_days:h.freqDays||[], completed_dates:h.completedDates||[] });
  const clientFromDb = r => ({ id:r.id, name:r.name, document:r.document, type:r.type, monthlyFee:r.monthly_fee, paymentStatus:r.payment_status, paymentMethod:r.payment_method, notes:r.notes, dueDates:r.due_dates||[], obligations:r.obligations||[], obligationStatuses:r.obligation_statuses||[], status:r.status, createdAt:r.created_at });
  const clientToDb   = c => ({ id:c.id, name:c.name, document:c.document, type:c.type, monthly_fee:c.monthlyFee, payment_status:c.paymentStatus, payment_method:c.paymentMethod, notes:c.notes, due_dates:c.dueDates||[], obligations:c.obligations||[], obligation_statuses:c.obligationStatuses||[], status:c.status||"active" });
  const goalFromDb = r => ({ id:r.id, title:r.title, completed:r.completed, createdAt:r.created_at });
  const goalToDb   = g => ({ id:g.id, title:g.title, completed:g.completed });

  useEffect(() => {
    const load = async () => {
      try {
        const [tasks, habits, clients, goals, cats, ctxs, settingsRows] = await Promise.all([
          db.select("tasks"), db.select("habits"), db.select("clients"),
          db.select("weekly_goals"), db.select("categories"), db.select("contexts"), db.select("settings"),
        ]);
        const settings = settingsRows?.[0]
          ? { appName:settingsRows[0].app_name, loginEmail:settingsRows[0].login_email, loginPassword:settingsRows[0].login_password }
          : defaultState.settings;
        setState({
          tasks: tasks.map(taskFromDb), habits: habits.map(habitFromDb),
          clients: clients.map(clientFromDb), weeklyGoals: goals.map(goalFromDb),
          categories: cats.length > 0 ? cats.map(r => ({ id:r.id, name:r.name, color:r.color })) : defaultCategories,
          contexts:   ctxs.length > 0 ? ctxs.map(r => ({ id:r.id, name:r.name, color:r.color })) : defaultContexts,
          settings,
        });
        if (cats.length === 0) await db.upsert("categories", defaultCategories);
        if (ctxs.length === 0) await db.upsert("contexts", defaultContexts);
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
  const updateTask = useCallback(async t => { setState(s => ({ ...s, tasks:s.tasks.map(x => x.id===t.id?t:x) })); await db.upsert("tasks", taskToDb(t)).catch(console.error); }, []);
  const deleteTask = useCallback(async id => { setState(s => ({ ...s, tasks:s.tasks.filter(t => t.id!==id) })); await db.delete("tasks", id).catch(console.error); }, []);
  const toggleTaskCompletion = useCallback(async id => {
    let updated;
    setState(s => { const tasks = s.tasks.map(t => t.id===id ? {...t,completed:!t.completed} : t); updated = tasks.find(t => t.id===id); return {...s,tasks}; });
    setTimeout(() => { if (updated) db.upsert("tasks", taskToDb(updated)).catch(console.error); }, 0);
  }, []);

  const addHabit = useCallback(async h => { setState(s => ({ ...s, habits:[...s.habits,h] })); await db.upsert("habits", habitToDb(h)).catch(console.error); }, []);
  const updateHabit = useCallback(async h => { setState(s => ({ ...s, habits:s.habits.map(x => x.id===h.id?h:x) })); await db.upsert("habits", habitToDb(h)).catch(console.error); }, []);
  const deleteHabit = useCallback(async id => { setState(s => ({ ...s, habits:s.habits.filter(h => h.id!==id) })); await db.delete("habits", id).catch(console.error); }, []);
  const toggleHabitCompletion = useCallback(async (id, date) => {
    let updated;
    setState(s => { const habits = s.habits.map(h => { if (h.id!==id) return h; const d = h.completedDates.includes(date) ? h.completedDates.filter(x => x!==date) : [...h.completedDates,date]; return {...h,completedDates:d}; }); updated = habits.find(h => h.id===id); return {...s,habits}; });
    setTimeout(() => { if (updated) db.upsert("habits", habitToDb(updated)).catch(console.error); }, 0);
  }, []);

  const addClient = useCallback(async c => { setState(s => ({ ...s, clients:[...s.clients,c] })); await db.upsert("clients", clientToDb(c)).catch(console.error); }, []);
  const updateClient = useCallback(async c => { setState(s => ({ ...s, clients:s.clients.map(x => x.id===c.id?c:x) })); await db.upsert("clients", clientToDb(c)).catch(console.error); }, []);
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

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#eef1f7", flexDirection:"column", gap:16 }}>
      <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#5aaff5" strokeWidth="2" style={{ width:24, height:24 }}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <p style={{ color:"#64748b", fontSize:14, fontWeight:600 }}>Carregando Códice Produtivo...</p>
      {dbError && <p style={{ color:"#ef4444", fontSize:12 }}>Erro ao conectar — usando dados locais</p>}
    </div>
  );

  const v = { ...state, addTask, updateTask, deleteTask, toggleTaskCompletion, addHabit, updateHabit, deleteHabit, toggleHabitCompletion, addClient, updateClient, deleteClient, addWeeklyGoal, updateWeeklyGoal, deleteWeeklyGoal, toggleWeeklyGoalCompletion, addCategory, updateCategory, deleteCategory, addContext, updateContext, deleteContext, updateSettings };
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
function Layout({ children, activeTab, setActiveTab, onLogout }) {
  const { settings } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navGroups = [
    {
      label: "Principal",
      items: [
        { id: "dashboard", label: "Dashboard", icon: Icon.Dashboard },
        { id: "tasks", label: "Tarefas", icon: Icon.Tasks },
        { id: "habits", label: "Hábitos e Rotina", icon: Icon.Habits },
      ]
    },
    {
      label: "Escritório",
      items: [
        { id: "clients", label: "Clientes", icon: Icon.Clients },
        { id: "finances", label: "Finanças", icon: Icon.Finance },
        { id: "obligations", label: "Obrigações", icon: Icon.Obligations },
        { id: "severance", label: "Simulação Rescisória", icon: Icon.Calculator },
      ]
    },
    {
      label: "Análise",
      items: [
        { id: "reports", label: "Relatórios", icon: Icon.Reports },
        { id: "settings", label: "Configurações", icon: Icon.Settings },
      ]
    }
  ];
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
              {(settings.loginEmail?.[0] || "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "rgba(255,255,255,0.85)" }}>{settings.loginEmail || "Usuário"}</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Administrador</p>
            </div>
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
  const { tasks, habits, clients, weeklyGoals, categories } = useApp();
  const t = today();
  const overdue = tasks.filter(t => !t.completed && t.dueDate < today());
  const todayTasks = tasks.filter(t2 => t2.dueDate === t);
  const habitsToday = habits.filter(h => h.completedDates?.includes(t)).length;
  const totalMRR = clients.reduce((s, c) => s + (c.monthlyFee || 0), 0);
  const activeClients = clients.filter(c => c.status !== "inactive").length;
  const done30 = tasks.filter(t2 => t2.completed).length;
  const rate = tasks.length > 0 ? Math.round((done30 / tasks.length) * 100) : 0;

  const catData = useMemo(() => categories.map(c => ({
    name: c.name, value: tasks.filter(t2 => t2.categoryId === c.id).length, color: c.color
  })).filter(d => d.value > 0), [tasks, categories]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 6 + i);
      const ds = d.toISOString().split("T")[0];
      const dt = tasks.filter(t2 => t2.dueDate === ds);
      return { name: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3), Tarefas: dt.length, Concluídas: dt.filter(t2 => t2.completed).length };
    });
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5 flex items-center justify-between" style={{ background: "linear-gradient(135deg, #1c1f26 0%, #1e2e4a 50%, #1a3a6e 100%)", color: "#fff" }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>Bem-vindo de volta</p>
          <h2 className="text-2xl font-black" style={{ letterSpacing: "-0.5px" }}>Olá, {new Date().getHours() < 12 ? "bom dia" : new Date().getHours() < 18 ? "boa tarde" : "boa noite"}! 👋</h2>
          <p className="text-sm mt-0.5 capitalize" style={{ color: "rgba(255,255,255,0.6)" }}>{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="text-4xl font-black" style={{ color: "rgba(255,255,255,0.15)" }}>{new Date().getDate()}</p>
          <p className="text-xs uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>{new Date().toLocaleDateString("pt-BR", { month: "short" })}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Taxa de Conclusão" value={`${rate}%`} icon={<svg viewBox="0 0 24 24" fill="none" stroke="#2b8be8" strokeWidth="2" className="w-6 h-6"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>} trend={`${done30} de ${tasks.length} tarefas`} trendColor="text-blue-600" accent="#2b8be8" />
        <StatCard title="Tarefas Atrasadas" value={overdue.length} icon={<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" className="w-6 h-6"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>} trend={overdue.length > 0 ? "Atenção necessária" : "Tudo em dia"} trendColor={overdue.length > 0 ? "text-red-600" : "text-emerald-600"} accent="#ef4444" />
        <StatCard title="Receita (MRR)" value={fmtCurrency(totalMRR)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" className="w-6 h-6"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>} trend={`${activeClients} clientes ativos`} trendColor="text-emerald-600" accent="#10b981" />
        <StatCard title="Hábitos Hoje" value={`${habitsToday}/${habits.length}`} icon={<svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" className="w-6 h-6"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>} trend={`${weeklyGoals.filter(g => !g.completed).length} metas pendentes`} trendColor="text-amber-600" accent="#f59e0b" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl p-6" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2"><Icon.Reports /> Volume de Atividades (7 dias)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekDays}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }} />
                <Legend verticalAlign="top" height={32} iconType="circle" />
                <Bar dataKey="Tarefas" fill="#bfdbfe" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Concluídas" fill="#2b8be8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl p-6" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <h3 className="text-base font-semibold text-slate-800 mb-4">Atividades por Categoria</h3>
          <div className="h-56">
            {catData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={catData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={4} dataKey="value">
                    {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "none" }} />
                  <Legend verticalAlign="bottom" height={32} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center text-slate-400 text-sm">Nenhuma atividade ainda.</div>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl p-6" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <h3 className="text-base font-semibold text-slate-800 mb-4">Foco de Hoje</h3>
          {todayTasks.length === 0 ? <p className="text-sm text-slate-500 py-4 text-center">Nenhuma tarefa para hoje.</p> :
            todayTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-center space-x-3 p-3 rounded-xl mb-2" style={{ background:"#f5f7fb", border:"1px solid #dde3ed" }}>
                <div className={`w-2 h-2 rounded-full ${task.completed ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className={`text-sm font-medium ${task.completed ? "text-slate-400 line-through" : "text-slate-700"}`}>{task.title}</span>
              </div>
            ))}
        </div>
        <div className="rounded-2xl p-6" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center justify-between">
            Hábitos Diários <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">{habitsToday}/{habits.length}</span>
          </h3>
          {habits.length === 0 ? <p className="text-sm text-slate-500 py-4 text-center">Nenhum hábito configurado.</p> :
            habits.slice(0, 5).map(h => {
              const done = h.completedDates?.includes(t);
              return (
                <div key={h.id} className="flex items-center justify-between p-3 rounded-xl mb-2" style={{ border:"1px solid #dde3ed" }}>
                  <span className={`text-sm font-medium ${done ? "text-slate-400 line-through" : "text-slate-700"}`}>{h.title}</span>
                  {done && <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" className="w-5 h-5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TASKS
// ============================================================
function Tasks() {
  const { tasks, addTask, updateTask, deleteTask, toggleTaskCompletion, clients, categories, contexts } = useApp();
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split("T")[0]; });
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 2); return d.toISOString().split("T")[0]; });
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [filterCtx, setFilterCtx] = useState("all");
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
  const filtered = tasks.filter(t => {
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

  const [tf, setTf] = useState({ title:"", description:"", categoryId:"", contextId:"", dueDate:"", clientId:"", isRecurring:false });
  const [multiText, setMultiText] = useState("");

  const openTaskForm = (task) => {
    setEditing(task || null);
    setTf(task ? { title:task.title||"", description:task.description||"", categoryId:task.categoryId||categories[0]?.id||"", contextId:task.contextId||contexts[0]?.id||"", dueDate:task.dueDate||new Date().toISOString().split("T")[0], clientId:task.clientId||"", isRecurring:!!task.isRecurring } : { title:"", description:"", categoryId:categories[0]?.id||"", contextId:contexts[0]?.id||"", dueDate:new Date().toISOString().split("T")[0], clientId:"", isRecurring:false });
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
            {overdue.map(task => <TaskItem key={task.id} task={task} onToggle={() => toggleTaskCompletion(task.id)} onEdit={() => openTaskForm(task)} onDelete={() => deleteTask(task.id)} onUpdate={updateTask} categories={categories} contexts={contexts} />)}
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
            <button onClick={() => setIsMultiOpen(true)} className="flex items-center px-4 py-2 rounded-xl text-sm font-semibold gap-1.5 transition-colors" style={{ background:"#f0f4f8", color:"#1a1d23" }}><Icon.List />Em Lote</button>
            <button onClick={() => openTaskForm(null)} className="flex items-center px-4 py-2 text-white rounded-xl text-sm font-bold gap-1.5 transition-all" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 8px #2b8be840" }}><Icon.Plus />Nova Tarefa</button>
          </div>
        </div>

        {viewMode === "list" && (
          <div className="px-4 py-3 flex flex-wrap gap-3" style={{ borderBottom:"1px solid #dde3ed", background:"#f5f7fb" }}>
            <input placeholder="🔍 Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 w-48" />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400">
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
              {filtered.map(task => <TaskItem key={task.id} task={task} onToggle={() => toggleTaskCompletion(task.id)} onEdit={() => openTaskForm(task)} onDelete={() => deleteTask(task.id)} onUpdate={updateTask} categories={categories} contexts={contexts} />)}
            </div>
          )}
        </div>
      </div>

      {isFormOpen && (
        <Modal title={editing ? "Editar Tarefa" : "Nova Tarefa"} onClose={() => { setIsFormOpen(false); setEditing(null); }}>
          <div className="p-6 space-y-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Título</label><input value={tf.title} onChange={e=>setTf(p=>({...p,title:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
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
                  {(useApp().clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"><input type="checkbox" checked={tf.isRecurring} onChange={e=>setTf(p=>({...p,isRecurring:e.target.checked}))} className="rounded text-indigo-600" />Tarefa Recorrente</label>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setIsFormOpen(false); setEditing(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button><button type="button" onClick={saveTask} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar</button></div>
          </div>
        </Modal>
      )}
      {isMultiOpen && (
        <Modal title="Adicionar Tarefas em Lote" onClose={() => setIsMultiOpen(false)}>
          <div className="p-6 space-y-4">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Tarefas (uma por linha)</label><textarea value={multiText} onChange={e=>setMultiText(e.target.value)} rows={6} placeholder={"Enviar e-mail\nRevisar folha\nLigar fornecedor"} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /><p className="text-xs text-slate-500 mt-1">Serão adicionadas para {fmt(startDate)}</p></div>
            <div className="flex justify-end gap-3"><button type="button" onClick={() => setIsMultiOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button><button type="button" onClick={saveMulti} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Adicionar</button></div>
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
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
        style={{ color: color || "#64748b", background: color ? `${color}18` : "#f1f5f9", border: `1px solid ${color ? `${color}30` : "#e2e8f0"}` }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color || "#64748b" }} />
        {label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5 opacity-50" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1.5 rounded-xl shadow-xl overflow-hidden" style={{ minWidth: 170, border: "1px solid #e2eaf3", background: "#fff", maxHeight: 220, overflowY: "auto" }}>
          <div className="px-3 py-2 sticky top-0 bg-white" style={{ borderBottom: "1px solid #dde3ed" }}>
            <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#94a3b8" }}>{menuTitle}</p>
          </div>
          {items.map(item => (
            <button key={item.id} type="button" onClick={() => { onSelect(item.id); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors"
              style={{ background: selectedId === item.id ? `${item.color}18` : "transparent", color: selectedId === item.id ? item.color : "#44403c", fontWeight: selectedId === item.id ? 700 : 400 }}
              onMouseEnter={e => { if (selectedId !== item.id) e.currentTarget.style.background = "#f8fafc"; }}
              onMouseLeave={e => { if (selectedId !== item.id) e.currentTarget.style.background = "transparent"; }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
              <span className="flex-1">{item.name}</span>
              {selectedId === item.id && <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskItem({ task, onToggle, onEdit, onDelete, onUpdate, categories, contexts }) {
  const cat = categories.find(c => c.id === task.categoryId);
  const ctx = contexts.find(c => c.id === task.contextId);
  const od = isOverdue(task.dueDate, task.completed);

  // checklist expand
  const [expanded, setExpanded] = useState(false);
  // inline date edit
  const [editingDate, setEditingDate] = useState(false);
  const dateRef = useRef(null);
  // new checklist item input
  const [newItem, setNewItem] = useState("");

  const checklist = task.checklist || [];
  const doneItems = checklist.filter(i => i.done).length;

  const toggleCheckItem = (itemId) => {
    const updated = checklist.map(i => i.id === itemId ? { ...i, done: !i.done } : i);
    onUpdate({ ...task, checklist: updated });
  };
  const addCheckItem = () => {
    const text = newItem.trim();
    if (!text) return;
    onUpdate({ ...task, checklist: [...checklist, { id: uid(), text, done: false }] });
    setNewItem("");
  };
  const deleteCheckItem = (itemId) => {
    onUpdate({ ...task, checklist: checklist.filter(i => i.id !== itemId) });
  };

  // close date picker on outside click
  useEffect(() => {
    if (!editingDate) return;
    const h = e => { if (dateRef.current && !dateRef.current.contains(e.target)) setEditingDate(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [editingDate]);

  return (
    <div className="rounded-xl transition-all duration-150 group"
      style={{
        background: task.completed ? "#f8fafc" : "#fff",
        border: od ? "1px solid #fca5a5" : "1px solid #dde3ed",
        borderLeft: od ? "3px solid #ef4444" : task.completed ? "3px solid #cbd5e1" : "3px solid #2b8be8",
        boxShadow: task.completed ? "none" : "0 1px 3px rgba(26,29,35,0.05)",
        opacity: task.completed ? 0.75 : 1,
      }}>

      {/* Main row */}
      <div className="flex items-start gap-3 px-4 py-3.5">

        {/* Checkbox */}
        <button onClick={onToggle} className="mt-0.5 flex-shrink-0 transition-transform hover:scale-110">
          {task.completed
            ? <svg viewBox="0 0 24 24" fill="#10b981" stroke="none" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" strokeWidth="2" fill="none"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" className="w-5 h-5 hover:stroke-blue-400"><circle cx="12" cy="12" r="10"/></svg>
          }
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug" style={{ color: task.completed ? "#94a3b8" : "#1a1d23", textDecoration: task.completed ? "line-through" : "none" }}>
            {task.title}
          </p>
          {task.description && <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>{task.description}</p>}

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Contexto dropdown */}
            <QuickDropdown
              label={ctx?.name || "Contexto"}
              color={ctx?.color}
              items={contexts}
              selectedId={task.contextId}
              onSelect={id => onUpdate({ ...task, contextId: id })}
              menuTitle="Contexto"
            />
            {/* Categoria dropdown */}
            <QuickDropdown
              label={cat?.name || "Categoria"}
              color={cat?.color}
              items={categories}
              selectedId={task.categoryId}
              onSelect={id => onUpdate({ ...task, categoryId: id })}
              menuTitle="Área"
            />

            {/* ── DATA EDITÁVEL INLINE ── */}
            <div ref={dateRef} className="relative">
              <button
                type="button"
                onClick={() => setEditingDate(v => !v)}
                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                style={od
                  ? { background: "#fef2f2", color: "#ef4444", border: "1px solid #fca5a580" }
                  : task.dueDate
                    ? { background: "#f0f4f8", color: "#374151", border: "1px solid #dde3ed" }
                    : { background: "#f5f7fb", color: "#94a3b8", border: "1px solid #dde3ed" }
                }
                title="Clique para alterar a data"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                {od && "⚠ "}{task.dueDate ? fmt(task.dueDate) : "Sem data"}
              </button>
              {editingDate && (
                <div className="absolute z-50 top-full left-0 mt-1.5 rounded-xl shadow-xl p-3"
                  style={{ background: "#fff", border: "1px solid #dde3ed", minWidth: 200 }}>
                  <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: "#94a3b8" }}>Reagendar para</p>
                  <input
                    type="date"
                    defaultValue={task.dueDate || ""}
                    autoFocus
                    onChange={e => {
                      onUpdate({ ...task, dueDate: e.target.value });
                      setEditingDate(false);
                    }}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400"
                    style={{ borderColor: "#dde3ed" }}
                  />
                  {task.dueDate && (
                    <button
                      type="button"
                      onClick={() => { onUpdate({ ...task, dueDate: "" }); setEditingDate(false); }}
                      className="mt-2 w-full text-xs py-1 rounded-lg transition-colors"
                      style={{ color: "#94a3b8", background: "#f5f7fb" }}
                    >Limpar data</button>
                  )}
                </div>
              )}
            </div>

            {task.isRecurring && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: "#eff6ff", color: "#2b8be8", border: "1px solid #bfdbfe" }}>↻ Recorrente</span>
            )}

            {/* Checklist counter — clicável */}
            {checklist.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-all"
                style={doneItems === checklist.length
                  ? { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" }
                  : { background: "#f5f7fb", color: "#374151", border: "1px solid #dde3ed" }
                }
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
                  <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                {doneItems}/{checklist.length}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-2.5 h-2.5 opacity-50"
                  style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#94a3b8" }}
            title="Checklist"
            onMouseEnter={e => { e.currentTarget.style.background="#eff6ff"; e.currentTarget.style.color="#2b8be8"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#94a3b8"; }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
          </button>
          <button onClick={onEdit} className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#94a3b8" }}
            onMouseEnter={e => { e.currentTarget.style.background="#eff6ff"; e.currentTarget.style.color="#2b8be8"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#94a3b8"; }}>
            <Icon.Edit />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#94a3b8" }}
            onMouseEnter={e => { e.currentTarget.style.background="#fef2f2"; e.currentTarget.style.color="#ef4444"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#94a3b8"; }}>
            <Icon.Trash />
          </button>
        </div>
      </div>

      {/* ── CHECKLIST EXPANDIDO ── */}
      {expanded && (
        <div className="px-4 pb-4 pt-0" style={{ borderTop: "1px solid #f0f4f8" }}>
          <div className="mt-3 space-y-1.5">
            {checklist.length === 0 && (
              <p className="text-xs text-center py-2" style={{ color: "#cbd5e1" }}>Nenhum item ainda. Adicione abaixo.</p>
            )}
            {checklist.map(item => (
              <div key={item.id} className="flex items-center gap-2 group/item px-2 py-1.5 rounded-lg transition-colors"
                style={{ background: item.done ? "#f8fafc" : "transparent" }}>
                <button type="button" onClick={() => toggleCheckItem(item.id)} className="flex-shrink-0">
                  {item.done
                    ? <svg viewBox="0 0 24 24" fill="#10b981" stroke="none" className="w-4 h-4"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" strokeWidth="2.5" fill="none"/></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="10"/></svg>
                  }
                </button>
                <span className="flex-1 text-xs" style={{ color: item.done ? "#94a3b8" : "#374151", textDecoration: item.done ? "line-through" : "none" }}>
                  {item.text}
                </span>
                <button type="button" onClick={() => deleteCheckItem(item.id)}
                  className="opacity-0 group-hover/item:opacity-100 transition-opacity p-0.5 rounded"
                  style={{ color: "#94a3b8" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                  onMouseLeave={e => e.currentTarget.style.color = "#94a3b8"}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
          {/* Add new item */}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCheckItem()}
              placeholder="Novo item..."
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border focus:ring-2 focus:ring-blue-400 outline-none"
              style={{ borderColor: "#dde3ed", color: "#374151" }}
            />
            <button
              type="button"
              onClick={addCheckItem}
              disabled={!newItem.trim()}
              className="px-3 py-1.5 text-xs font-bold text-white rounded-lg transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#5aaff5,#2b8be8)" }}
            >+ Add</button>
          </div>
          {/* Progress bar */}
          {checklist.length > 0 && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#e8edf5" }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((doneItems / checklist.length) * 100)}%`, background: doneItems === checklist.length ? "#10b981" : "linear-gradient(90deg,#5aaff5,#2b8be8)" }} />
              </div>
              <p className="text-[10px] mt-1 text-right" style={{ color: "#94a3b8" }}>{Math.round((doneItems / checklist.length) * 100)}% concluído</p>
            </div>
          )}
        </div>
      )}
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

function Habits() {
  const { habits, addHabit, updateHabit, deleteHabit, toggleHabitCompletion, weeklyGoals, addWeeklyGoal, toggleWeeklyGoalCompletion, deleteWeeklyGoal, categories } = useApp();
  const [isHabitOpen, setIsHabitOpen] = useState(false);
  const [editHabit, setEditHabit] = useState(null);
  const [calendarHabit, setCalendarHabit] = useState(null);
  const [isGoalOpen, setIsGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [aiTip, setAiTip] = useState(""); const [tipLoading, setTipLoading] = useState(false);
  const t = today();

  // Last 7 days for the quick view
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    return { date: d.toISOString().split("T")[0], label: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3), day: d.getDate() };
  });

  // Today's progress
  const habitsForToday = habits.filter(h => isExpectedDay(t, h.freq, h.freqDays));
  const doneToday = habitsForToday.filter(h => (h.completedDates||[]).includes(t)).length;
  const progressPct = habitsForToday.length > 0 ? Math.round((doneToday / habitsForToday.length) * 100) : 0;

  const freqOptions = [
    { value: "daily", label: "Todo dia" },
    { value: "weekly_days", label: "Dias específicos" },
  ];
  const dowLabels = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

  const [hf, setHf] = useState({ title:"", categoryId:"", freq:"daily", freqDays:[] });
  const openHabitForm = (h) => {
    setEditHabit(h||null);
    setHf(h ? { title:h.title||"", categoryId:h.categoryId||categories[0]?.id||"", freq:h.freq||"daily", freqDays:h.freqDays||[] }
             : { title:"", categoryId:categories[0]?.id||"", freq:"daily", freqDays:[] });
    setIsHabitOpen(true);
  };
  const saveHabit = () => {
    if (!hf.title.trim()) return;
    const data = { id: editHabit?.id || uid(), title: hf.title, categoryId: hf.categoryId, freq: hf.freq, freqDays: hf.freqDays, completedDates: editHabit?.completedDates || [] };
    editHabit ? updateHabit(data) : addHabit(data);
    setIsHabitOpen(false); setEditHabit(null);
  };
  const toggleDay = (dow) => setHf(p => ({ ...p, freqDays: p.freqDays.includes(dow) ? p.freqDays.filter(d => d !== dow) : [...p.freqDays, dow] }));

  const fetchTip = async () => {
    setTipLoading(true);
    try {
      const tip = await callClaude(`Atue como coach de produtividade. O usuário tem ${habits.length} hábitos, completou ${doneToday} de ${habitsForToday.length} hoje (${progressPct}%). Dê uma dica curta e motivacional em Markdown (máx 2 parágrafos).`);
      setAiTip(tip);
    } catch (e) { setAiTip("Continue focado! A consistência é a chave."); } finally { setTipLoading(false); }
  };

  return (
    <div className="space-y-6">

      {/* ── PROGRESSO DO DIA ── */}
      {habits.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#fff" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.5)" }}>Progresso de Hoje</p>
              <p className="text-3xl font-black" style={{ letterSpacing:"-1px" }}>
                {doneToday}<span className="text-lg font-semibold" style={{ color:"rgba(255,255,255,0.4)" }}>/{habitsForToday.length}</span>
              </p>
              <p className="text-sm mt-0.5" style={{ color:"rgba(255,255,255,0.55)" }}>
                {progressPct === 100 ? "🎉 Todos os hábitos concluídos!" : progressPct >= 50 ? `💪 ${habitsForToday.length - doneToday} restante(s) para hoje` : `🎯 Vamos lá! ${habitsForToday.length - doneToday} hábito(s) pendentes`}
              </p>
            </div>
            {/* Anel de progresso SVG */}
            <div className="relative flex-shrink-0">
              <svg width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
                <circle cx="36" cy="36" r="28" fill="none" stroke={progressPct===100?"#10b981":"#5aaff5"} strokeWidth="7"
                  strokeDasharray={`${2*Math.PI*28}`}
                  strokeDashoffset={`${2*Math.PI*28*(1-progressPct/100)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 36 36)"
                  style={{ transition:"stroke-dashoffset 0.6s ease" }}
                />
                <text x="36" y="41" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff">{progressPct}%</text>
              </svg>
            </div>
          </div>
          {/* Barra de progresso */}
          <div className="h-2 rounded-full overflow-hidden" style={{ background:"rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width:`${progressPct}%`, background: progressPct===100 ? "#10b981" : "linear-gradient(90deg,#5aaff5,#2b8be8)" }} />
          </div>
        </div>
      )}

      {/* ── DICA IA ── */}
      {habits.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,#eff6ff,#eef2ff)", border:"1px solid #bfdbfe" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color:"#3730a3" }}><Icon.Sparkles />Dica da Códice IA</div>
            <button onClick={fetchTip} disabled={tipLoading} className="p-1.5 rounded-lg transition-colors disabled:opacity-50" style={{ color:"#6366f1" }}
              onMouseEnter={e=>e.currentTarget.style.background="#e0e7ff"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span className={tipLoading?"animate-spin inline-block":""}><Icon.Refresh /></span>
            </button>
          </div>
          <div className="text-sm" style={{ color:"#374151" }}>
            {tipLoading ? <span className="flex items-center gap-2" style={{ color:"#6366f1" }}><Icon.Loader />Analisando...</span>
              : aiTip ? <div dangerouslySetInnerHTML={{ __html: aiTip.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br/>") }} />
              : <p style={{ color:"#94a3b8" }}>Clique em ↺ para gerar uma dica personalizada.</p>}
          </div>
        </div>
      )}

      {/* ── TABELA DE HÁBITOS ── */}
      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        <div className="p-5 flex items-center justify-between" style={{ borderBottom:"1px solid #dde3ed" }}>
          <h2 className="text-base font-bold flex items-center gap-2" style={{ color:"#1a1d23" }}><Icon.Habits />Hábitos e Rotina</h2>
          <button onClick={() => openHabitForm(null)} className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-bold transition-all" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}><Icon.Plus />Novo Hábito</button>
        </div>
        <div className="p-4 overflow-x-auto">
          {habits.length === 0 ? (
            <div className="text-center py-10" style={{ color:"#94a3b8" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mx-auto mb-2 opacity-30"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>
              <p className="text-sm">Nenhum hábito configurado.</p>
            </div>
          ) : (
            <table className="w-full text-left min-w-[560px]">
              <thead>
                <tr style={{ borderBottom:"2px solid #e8edf5" }}>
                  <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide" style={{ color:"#94a3b8" }}>Hábito</th>
                  <th className="py-2 px-2 text-xs font-bold uppercase tracking-wide text-center" style={{ color:"#94a3b8" }}>🔥</th>
                  {days.map(d => (
                    <th key={d.date} className="py-2 px-1 text-center" style={{ minWidth:36 }}>
                      <div className="flex flex-col items-center">
                        <span className="text-[9px] font-bold uppercase" style={{ color:"#94a3b8" }}>{d.label}</span>
                        <span className="mt-0.5 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold"
                          style={d.date===t ? { background:"#2b8be8", color:"#fff" } : { color:"#374151" }}>{d.day}</span>
                      </div>
                    </th>
                  ))}
                  <th className="py-2 px-3 text-xs font-bold uppercase tracking-wide text-right" style={{ color:"#94a3b8" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {habits.map(h => {
                  const cat = categories.find(c => c.id === h.categoryId);
                  const streak = calcStreak(h.completedDates, h.freq, h.freqDays);
                  const freqLabel = h.freq === "weekly_days" && h.freqDays?.length
                    ? `${h.freqDays.length}x/sem` : "Diário";
                  return (
                    <tr key={h.id} className="group" style={{ borderBottom:"1px solid #f0f4f8" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-sm" style={{ color:"#1a1d23" }}>{h.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {cat && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background:`${cat.color}15`, color:cat.color }}>{cat.name}</span>}
                          <span className="text-[10px] font-medium" style={{ color:"#94a3b8" }}>{freqLabel}</span>
                        </div>
                      </td>
                      {/* Streak */}
                      <td className="py-3 px-2 text-center">
                        <span className="text-xs font-black" style={{ color: streak >= 7 ? "#f59e0b" : streak >= 3 ? "#2b8be8" : "#cbd5e1" }}>
                          {streak > 0 ? (streak >= 3 ? `🔥${streak}` : streak) : "—"}
                        </span>
                      </td>
                      {/* 7-day checkboxes */}
                      {days.map(d => {
                        const done = (h.completedDates||[]).includes(d.date);
                        const expected = isExpectedDay(d.date, h.freq, h.freqDays);
                        const isFuture = d.date > t;
                        return (
                          <td key={d.date} className="py-3 px-1 text-center">
                            {expected && !isFuture ? (
                              <button onClick={() => toggleHabitCompletion(h.id, d.date)}
                                className="w-7 h-7 rounded-lg mx-auto flex items-center justify-center transition-all"
                                style={done
                                  ? { background:"#2b8be8", color:"#fff" }
                                  : { background:"#f0f4f8", color:"#cbd5e1", border:"1px solid #dde3ed" }}
                                onMouseEnter={e => { if(!done) { e.currentTarget.style.background="#dbeafe"; e.currentTarget.style.color="#2b8be8"; }}}
                                onMouseLeave={e => { if(!done) { e.currentTarget.style.background="#f0f4f8"; e.currentTarget.style.color="#cbd5e1"; }}}>
                                {done
                                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"/></svg>
                                  : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><circle cx="12" cy="12" r="4"/></svg>
                                }
                              </button>
                            ) : (
                              <div className="w-7 h-7 mx-auto flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full" style={{ background:"#e8edf5" }} />
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {/* Actions */}
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setCalendarHabit(h)} className="p-1.5 rounded-lg transition-colors"
                            style={{ color:"#94a3b8" }} title="Ver histórico"
                            onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.color="#2b8be8";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                            <Icon.Calendar />
                          </button>
                          <button onClick={() => openHabitForm(h)} className="p-1.5 rounded-lg transition-colors"
                            style={{ color:"#94a3b8" }}
                            onMouseEnter={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.color="#2b8be8";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                            <Icon.Edit />
                          </button>
                          <button onClick={() => deleteHabit(h.id)} className="p-1.5 rounded-lg transition-colors"
                            style={{ color:"#94a3b8" }}
                            onMouseEnter={e=>{e.currentTarget.style.background="#fef2f2";e.currentTarget.style.color="#ef4444";}}
                            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";}}>
                            <Icon.Trash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── METAS SEMANAIS ── */}
      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        <div className="p-5 flex items-center justify-between" style={{ borderBottom:"1px solid #dde3ed" }}>
          <h2 className="text-base font-bold flex items-center gap-2" style={{ color:"#1a1d23" }}><Icon.Goals />Metas da Semana</h2>
          <button onClick={() => setIsGoalOpen(true)} className="flex items-center gap-1.5 px-3 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#fbbf24,#d97706)" }}><Icon.Plus />Nova Meta</button>
        </div>
        <div className="p-4">
          {isGoalOpen && (
            <div className="flex gap-2 mb-4">
              <input autoFocus value={goalTitle} onChange={e => setGoalTitle(e.target.value)}
                onKeyDown={e => { if(e.key==="Enter"&&goalTitle.trim()){ addWeeklyGoal({id:uid(),title:goalTitle,completed:false,createdAt:today()}); setGoalTitle(""); setIsGoalOpen(false); }}}
                placeholder="Descreva sua meta..." className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 outline-none" style={{ borderColor:"#dde3ed" }} />
              <button type="button" onClick={() => setIsGoalOpen(false)} className="px-3 py-2 rounded-lg text-sm" style={{ color:"#64748b" }}>Cancelar</button>
              <button type="button" onClick={() => { if(!goalTitle.trim()) return; addWeeklyGoal({id:uid(),title:goalTitle,completed:false,createdAt:today()}); setGoalTitle(""); setIsGoalOpen(false); }}
                className="px-3 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#fbbf24,#d97706)" }}>Adicionar</button>
            </div>
          )}
          {weeklyGoals.length === 0 && !isGoalOpen ? (
            <div className="text-center py-8 text-sm" style={{ color:"#94a3b8" }}>Nenhuma meta definida para esta semana.</div>
          ) : (
            <div className="space-y-2">
              {weeklyGoals.map(g => (
                <div key={g.id} className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                  style={g.completed
                    ? { background:"#f8fafc", border:"1px solid #e8edf5" }
                    : { background:"#fff", border:"1px solid #fde68a", borderLeft:"3px solid #f59e0b" }}>
                  <button onClick={() => toggleWeeklyGoalCompletion(g.id)} className="flex-shrink-0 transition-transform hover:scale-110">
                    {g.completed
                      ? <svg viewBox="0 0 24 24" fill="#10b981" stroke="none" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" stroke="white" strokeWidth="2.5" fill="none"/></svg>
                      : <svg viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" className="w-5 h-5"><circle cx="12" cy="12" r="10"/></svg>
                    }
                  </button>
                  <span className="flex-1 text-sm font-medium" style={{ color: g.completed ? "#94a3b8":"#1a1d23", textDecoration: g.completed?"line-through":"none" }}>{g.title}</span>
                  {g.createdAt && <span className="text-[10px]" style={{ color:"#cbd5e1" }}>{fmt(g.createdAt)}</span>}
                  <button onClick={() => deleteWeeklyGoal(g.id)} className="p-1 rounded transition-colors flex-shrink-0"
                    style={{ color:"#cbd5e1" }}
                    onMouseEnter={e=>e.currentTarget.style.color="#ef4444"} onMouseLeave={e=>e.currentTarget.style.color="#cbd5e1"}>
                    <Icon.Trash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL NOVO HÁBITO ── */}
      {isHabitOpen && (
        <Modal title={editHabit ? "Editar Hábito" : "Novo Hábito"} onClose={() => { setIsHabitOpen(false); setEditHabit(null); }}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Título</label>
              <input value={hf.title} onChange={e=>setHf(p=>({...p,title:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none" placeholder="Ex: Ler 20 minutos, Revisar e-mails..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
              <select value={hf.categoryId} onChange={e=>setHf(p=>({...p,categoryId:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none">
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Frequência</label>
              <div className="flex gap-2">
                {freqOptions.map(o => (
                  <button key={o.value} type="button" onClick={() => setHf(p=>({...p,freq:o.value,freqDays:[]}))}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
                    style={hf.freq===o.value
                      ? { background:"linear-gradient(135deg,#5aaff5,#2b8be8)", color:"#fff" }
                      : { background:"#f0f4f8", color:"#374151", border:"1px solid #dde3ed" }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {hf.freq === "weekly_days" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Dias da semana</label>
                <div className="flex gap-2 flex-wrap">
                  {dowLabels.map((label, dow) => (
                    <button key={dow} type="button" onClick={() => toggleDay(dow)}
                      className="w-10 h-10 rounded-xl text-xs font-bold transition-all"
                      style={hf.freqDays.includes(dow)
                        ? { background:"#2b8be8", color:"#fff" }
                        : { background:"#f0f4f8", color:"#374151", border:"1px solid #dde3ed" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setIsHabitOpen(false); setEditHabit(null); }} className="px-4 py-2 rounded-lg text-sm" style={{ color:"#64748b" }}>Cancelar</button>
              <button type="button" onClick={saveHabit} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL CALENDÁRIO DO HÁBITO ── */}
      {calendarHabit && (
        <HabitCalendarModal
          habit={calendarHabit}
          onClose={() => setCalendarHabit(null)}
          onToggle={(id, date) => { toggleHabitCompletion(id, date); setCalendarHabit(h => habits.find(x => x.id === h.id) || h); }}
          categories={categories}
        />
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
    </div>
  );
}

// ============================================================
// FINANCES
// ============================================================
function Finances() {
  const { clients } = useApp();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [snapshots, setSnapshots] = useState(() => { try { return JSON.parse(localStorage.getItem("financeSnapshots") || "{}"); } catch { return {}; } });
  useEffect(() => { localStorage.setItem("financeSnapshots", JSON.stringify(snapshots)); }, [snapshots]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const records = snapshots[month] || null;

  // ── Totals ────────────────────────────────────────────────
  const total   = records?.reduce((s, r) => s + (r.monthlyFee || 0), 0) || 0;
  const paid    = records?.filter(r => r.paymentStatus === "paid").reduce((s, r) => s + r.monthlyFee, 0) || 0;
  const pending = records?.filter(r => r.paymentStatus === "pending").reduce((s, r) => s + r.monthlyFee, 0) || 0;
  const overdue = records?.filter(r => r.paymentStatus === "overdue").reduce((s, r) => s + r.monthlyFee, 0) || 0;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const cntPaid    = records?.filter(r => r.paymentStatus === "paid").length || 0;
  const cntPending = records?.filter(r => r.paymentStatus === "pending").length || 0;
  const cntOverdue = records?.filter(r => r.paymentStatus === "overdue").length || 0;

  // ── Historical data (last 6 months from snapshots) ───────
  const histData = useMemo(() => {
    const result = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const recs = snapshots[key] || [];
      const lbl = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".","");
      result.push({
        mes: lbl.charAt(0).toUpperCase() + lbl.slice(1),
        Previsto: recs.reduce((s, r) => s + (r.monthlyFee || 0), 0),
        Recebido: recs.filter(r => r.paymentStatus === "paid").reduce((s, r) => s + r.monthlyFee, 0),
        Atrasado: recs.filter(r => r.paymentStatus === "overdue").reduce((s, r) => s + r.monthlyFee, 0),
      });
    }
    return result;
  }, [snapshots]);

  const hasHistory = histData.some(d => d.Previsto > 0);

  // ── Actions ───────────────────────────────────────────────
  const generate = () => {
    const nr = clients.map(c => ({
      clientId: c.id, name: c.name, document: c.document,
      monthlyFee: c.monthlyFee || 0, paymentMethod: c.paymentMethod || "pix",
      paymentStatus: "pending", billingSent: false, paidAt: null,
    }));
    setSnapshots(p => ({ ...p, [month]: nr }));
  };

  const syncNew = () => {
    const existing = new Set(records.map(r => r.clientId));
    const newOnes = clients.filter(c => !existing.has(c.id)).map(c => ({
      clientId: c.id, name: c.name, document: c.document,
      monthlyFee: c.monthlyFee || 0, paymentMethod: c.paymentMethod || "pix",
      paymentStatus: "pending", billingSent: false, paidAt: null,
    }));
    if (!newOnes.length) return;
    setSnapshots(p => ({ ...p, [month]: [...p[month], ...newOnes] }));
  };

  const chStatus = (id, st) => setSnapshots(p => ({
    ...p,
    [month]: p[month].map(r => r.clientId === id
      ? { ...r, paymentStatus: st, paidAt: st === "paid" ? today() : r.paidAt }
      : r)
  }));

  const chBilling = (id) => setSnapshots(p => ({
    ...p, [month]: p[month].map(r => r.clientId === id ? { ...r, billingSent: !r.billingSent } : r)
  }));

  // ── Export CSV ────────────────────────────────────────────
  const exportCSV = () => {
    if (!records) return;
    const header = ["Cliente","CNPJ/CPF","Honorários","Forma Pagamento","Status","Cobrança Enviada","Data Pagamento"];
    const methodLabel = { boleto:"Boleto", pix:"Pix", transfer:"Transferência" };
    const statusLabel = { paid:"Em dia", pending:"Pendente", overdue:"Atrasado" };
    const rows = records.map(r => [
      r.name, r.document || "", r.monthlyFee,
      methodLabel[r.paymentMethod] || r.paymentMethod,
      statusLabel[r.paymentStatus] || r.paymentStatus,
      r.billingSent ? "Sim" : "Não",
      r.paidAt || "",
    ]);
    const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `financeiro-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Filtered records ──────────────────────────────────────
  const filtered = (records || []).filter(r => {
    if (filterStatus !== "all" && r.paymentStatus !== filterStatus) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !(r.document||"").includes(search)) return false;
    return true;
  });

  const methodLabel = { boleto:"Boleto", pix:"Pix", transfer:"Transferência" };
  const statusCfg = {
    paid:    { label:"Em dia",   dot:"#10b981", bg:"#f0fdf4", color:"#16a34a", border:"#bbf7d0" },
    pending: { label:"Pendente", dot:"#f59e0b", bg:"#fffbeb", color:"#d97706", border:"#fde68a" },
    overdue: { label:"Atrasado", dot:"#ef4444", bg:"#fff5f5", color:"#dc2626", border:"#fca5a5" },
  };

  return (
    <div className="space-y-5">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black" style={{ color:"#1a1d23" }}>Gestão Financeira</h2>
          <p className="text-xs mt-0.5" style={{ color:"#94a3b8" }}>Controle de honorários por competência</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 1px 4px rgba(26,29,35,0.06)" }}>
          <Icon.Calendar />
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border-none focus:ring-0 font-semibold bg-transparent text-sm cursor-pointer outline-none" style={{ color:"#374151" }} />
        </div>
      </div>

      {/* ── MÊS NÃO INICIADO ── */}
      {!records ? (
        <div className="rounded-2xl p-12 text-center" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background:"#eff6ff", border:"1px solid #bfdbfe" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#2b8be8" strokeWidth="1.5" className="w-8 h-8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
          </div>
          <h3 className="text-lg font-black mb-1" style={{ color:"#1a1d23" }}>Competência não iniciada</h3>
          <p className="text-sm mb-6" style={{ color:"#94a3b8" }}>
            {clients.length === 0
              ? "Cadastre clientes antes de gerar o controle mensal."
              : `Gere o controle para importar os ${clients.length} clientes cadastrados.`}
          </p>
          <button onClick={generate} disabled={clients.length === 0}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-white rounded-xl font-bold text-sm disabled:opacity-40"
            style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}>
            <Icon.Save />Gerar Controle do Mês
          </button>
        </div>
      ) : (
        <>
          {/* ── KPI + BARRA DE RECEBIMENTO ── */}
          <div className="rounded-2xl p-5" style={{ background:"linear-gradient(135deg,#1c1f26,#1e2e4a)", color:"#fff" }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.45)" }}>Total Previsto</p>
                <p className="text-3xl font-black" style={{ letterSpacing:"-1px" }}>{fmtCurrency(total)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.45)" }}>Taxa de Recebimento</p>
                <p className="text-3xl font-black" style={{ color: paidPct >= 80 ? "#10b981" : paidPct >= 50 ? "#f59e0b" : "#ef4444" }}>{paidPct}%</p>
              </div>
            </div>
            {/* Barra de progresso segmentada */}
            <div className="mb-3">
              <div className="flex h-3 rounded-full overflow-hidden gap-0.5" style={{ background:"rgba(255,255,255,0.08)" }}>
                {paid > 0 && <div className="h-full rounded-l-full transition-all duration-700" style={{ width:`${(paid/total)*100}%`, background:"#10b981" }} />}
                {pending > 0 && <div className="h-full transition-all duration-700" style={{ width:`${(pending/total)*100}%`, background:"#f59e0b" }} />}
                {overdue > 0 && <div className="h-full rounded-r-full transition-all duration-700" style={{ width:`${(overdue/total)*100}%`, background:"#ef4444" }} />}
              </div>
            </div>
            {/* Legenda */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label:"Recebido",  value: paid,    count: cntPaid,    color:"#10b981" },
                { label:"Pendente",  value: pending,  count: cntPending, color:"#f59e0b" },
                { label:"Atrasado",  value: overdue,  count: cntOverdue, color:"#ef4444" },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-3" style={{ background:"rgba(255,255,255,0.07)" }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color:"rgba(255,255,255,0.5)" }}>{item.label}</span>
                  </div>
                  <p className="text-base font-black">{fmtCurrency(item.value)}</p>
                  <p className="text-[10px] mt-0.5" style={{ color:"rgba(255,255,255,0.35)" }}>{item.count} cliente(s)</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── GRÁFICO HISTÓRICO ── */}
          {hasHistory && (
            <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
              <p className="text-sm font-black mb-4" style={{ color:"#1a1d23" }}>Evolução dos Últimos 6 Meses</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={histData} barCategoryGap="25%" barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize:11, fill:"#94a3b8", fontWeight:600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize:10, fill:"#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} width={36} />
                  <Tooltip
                    contentStyle={{ borderRadius:12, border:"1px solid #dde3ed", boxShadow:"0 4px 16px rgba(0,0,0,0.08)", fontSize:12 }}
                    formatter={(v, n) => [fmtCurrency(v), n]}
                  />
                  <Bar dataKey="Previsto" fill="#dbeafe" radius={[4,4,0,0]} />
                  <Bar dataKey="Recebido" fill="#2b8be8" radius={[4,4,0,0]} />
                  <Bar dataKey="Atrasado" fill="#fca5a5" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-5 mt-2 justify-center">
                {[["Previsto","#dbeafe"],["Recebido","#2b8be8"],["Atrasado","#fca5a5"]].map(([l,c]) => (
                  <div key={l} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded" style={{ background:c }} />
                    <span className="text-[11px] font-semibold" style={{ color:"#94a3b8" }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TABELA ── */}
          <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
            {/* Toolbar */}
            <div className="p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom:"1px solid #e8edf5" }}>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente..."
                    className="pl-9 pr-3 py-1.5 text-sm rounded-xl outline-none focus:ring-2 focus:ring-blue-400"
                    style={{ border:"1px solid #dde3ed", width:180, color:"#374151" }} />
                </div>
                {/* Status filter */}
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="text-sm rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-400"
                  style={{ border:"1px solid #dde3ed", color:"#374151" }}>
                  <option value="all">Todos status</option>
                  <option value="paid">Em dia</option>
                  <option value="pending">Pendente</option>
                  <option value="overdue">Atrasado</option>
                </select>
                {filtered.length !== records.length && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background:"#dbeafe", color:"#2b8be8" }}>
                    {filtered.length} de {records.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={syncNew}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-xl transition-all"
                  style={{ color:"#2b8be8", background:"#eff6ff", border:"1px solid #bfdbfe" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#dbeafe"} onMouseLeave={e=>e.currentTarget.style.background="#eff6ff"}>
                  <Icon.Refresh />Sincronizar
                </button>
                <button onClick={exportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-xl transition-all"
                  style={{ color:"#16a34a", background:"#f0fdf4", border:"1px solid #bbf7d0" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#dcfce7"} onMouseLeave={e=>e.currentTarget.style.background="#f0fdf4"}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Exportar CSV
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead style={{ background:"#f8fafc", borderBottom:"2px solid #e8edf5" }}>
                  <tr>
                    {["Cliente","Honorários","Pagamento","Cobrança","Data Pgto","Status"].map(h => (
                      <th key={h} className="px-4 py-3 text-[10px] font-black uppercase tracking-widest" style={{ color:"#94a3b8" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color:"#94a3b8" }}>Nenhum registro encontrado.</td></tr>
                  ) : filtered.map(r => {
                    const st = statusCfg[r.paymentStatus || "pending"];
                    return (
                      <tr key={r.clientId} className="group" style={{ borderBottom:"1px solid #f0f4f8", borderLeft:`3px solid ${st.dot}` }}
                        onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        {/* Cliente */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-bold" style={{ color:"#1a1d23" }}>{r.name}</p>
                          <p className="text-xs" style={{ color:"#94a3b8" }}>{r.document || "—"}</p>
                        </td>
                        {/* Honorários */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-bold" style={{ color:"#1a1d23" }}>{fmtCurrency(r.monthlyFee)}</p>
                        </td>
                        {/* Forma pagamento */}
                        <td className="px-4 py-3 text-sm" style={{ color:"#64748b" }}>
                          {methodLabel[r.paymentMethod] || "—"}
                        </td>
                        {/* Cobrança enviada */}
                        <td className="px-4 py-3">
                          <button onClick={() => chBilling(r.clientId)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all"
                            style={r.billingSent
                              ? { background:"#eff6ff", color:"#2b8be8", border:"1px solid #bfdbfe" }
                              : { background:"#f5f7fb", color:"#94a3b8", border:"1px solid #e8edf5" }}>
                            <Icon.Send />{r.billingSent ? "Enviada" : "Pendente"}
                          </button>
                        </td>
                        {/* Data pagamento */}
                        <td className="px-4 py-3">
                          {r.paymentStatus === "paid" ? (
                            <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ background:"#f0fdf4", color:"#16a34a", border:"1px solid #bbf7d0" }}>
                              {r.paidAt ? fmt(r.paidAt) : "—"}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color:"#cbd5e1" }}>—</span>
                          )}
                        </td>
                        {/* Status buttons */}
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {Object.entries(statusCfg).map(([k, v]) => {
                              const active = (r.paymentStatus || "pending") === k;
                              return (
                                <button key={k} onClick={() => chStatus(r.clientId, k)}
                                  className="px-2 py-1 text-[10px] font-bold rounded-lg transition-all"
                                  style={active
                                    ? { background:v.bg, color:v.color, border:`1px solid ${v.border}` }
                                    : { background:"transparent", color:"#cbd5e1", border:"1px solid #e8edf5" }}
                                  onMouseEnter={e=>{ if(!active){ e.currentTarget.style.background=v.bg; e.currentTarget.style.color=v.color; }}}
                                  onMouseLeave={e=>{ if(!active){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#cbd5e1"; }}}>
                                  {v.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Footer totals */}
                {filtered.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop:"2px solid #e8edf5", background:"#f8fafc" }}>
                      <td className="px-4 py-3 text-xs font-bold" style={{ color:"#64748b" }}>{filtered.length} cliente(s)</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-black" style={{ color:"#1a1d23" }}>{fmtCurrency(filtered.reduce((s,r)=>s+(r.monthlyFee||0),0))}</p>
                        <p className="text-[10px]" style={{ color:"#94a3b8" }}>filtrado</p>
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
  const { tasks, categories, contexts } = useApp();
  const now = new Date();
  const [startDate, setStartDate] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const [endDate, setEndDate] = useState(now.toISOString().split("T")[0]);
  const [aiFeedback, setAiFeedback] = useState(null);
  const [loading, setLoading] = useState(false);

  const filtered = tasks.filter(t => t.dueDate >= startDate && t.dueDate <= endDate);
  const total = filtered.length;
  const completed = filtered.filter(t => t.completed).length;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const catStats = categories.map(c => ({ ...c, total: filtered.filter(t => t.categoryId === c.id).length, done: filtered.filter(t => t.categoryId === c.id && t.completed).length })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);
  const catChartData = catStats.map(c => ({ name: c.name, value: c.total, color: c.color }));
  const ctxStats = contexts.map(c => ({ ...c, total: filtered.filter(t => t.contextId === c.id).length })).sort((a, b) => b.total - a.total);

  const generateFeedback = async () => {
    setLoading(true); setAiFeedback(null);
    try {
      const fb = await callClaude(`Atue como consultor de produtividade para escritório de contabilidade. Analise: Total de tarefas: ${total}, Concluídas: ${completed} (${rate}%), Categoria mais focada: ${catStats[0]?.name || "N/A"} (${catStats[0]?.total || 0} tarefas), Contexto mais focado: ${ctxStats[0]?.name || "N/A"}. Forneça feedback construtivo em Markdown com: 1) Resumo do desempenho, 2) Pontos fortes, 3) Oportunidades de melhoria.`);
      setAiFeedback(fb);
    } catch { setAiFeedback("Erro ao gerar análise."); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-slate-900">Relatório de Produtividade</h2><p className="text-slate-500 mt-1 text-sm">Análise de foco e desempenho</p></div>
        <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
          <Icon.Calendar />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border-none text-sm focus:ring-0 text-slate-700 bg-transparent" />
          <span className="text-slate-400 text-sm">até</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border-none text-sm focus:ring-0 text-slate-700 bg-transparent" />
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}><Icon.Reports /><p className="text-slate-500 mt-3">Adicione tarefas neste período para gerar o relatório.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}><p className="text-xs text-slate-500 mb-2">Taxa de Conclusão Global</p><p className="text-3xl font-bold text-slate-900">{rate}%</p><p className="text-xs text-slate-500 mt-1">{completed} de {total} tarefas</p></div>
            <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}><p className="text-xs text-slate-500 mb-2">Maior Foco (Categoria)</p><p className="text-lg font-bold text-slate-900 truncate">{catStats[0]?.name || "-"}</p><p className="text-xs text-slate-500 mt-1">{catStats[0]?.total || 0} tarefas</p></div>
            <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}><p className="text-xs text-slate-500 mb-2">Maior Foco (Contexto)</p><p className="text-lg font-bold text-slate-900 truncate">{ctxStats[0]?.name || "-"}</p><p className="text-xs text-slate-500 mt-1">{ctxStats[0]?.total || 0} tarefas</p></div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Distribuição por Categoria</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={catChartData} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={4} dataKey="value">
                      {catChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: "8px", border: "none" }} />
                    <Legend verticalAlign="bottom" height={32} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-2xl p-5" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Desempenho por Categoria</h3>
              <div className="space-y-3">
                {catStats.map(c => (
                  <div key={c.id}>
                    <div className="flex items-center justify-between text-xs mb-1"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: c.color }} /><span className="font-medium text-slate-700">{c.name}</span></div><span className="text-slate-500">{c.done}/{c.total} ({c.total > 0 ? Math.round(c.done / c.total * 100) : 0}%)</span></div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5"><div className="h-1.5 rounded-full transition-all" style={{ width: `${c.total > 0 ? Math.round(c.done / c.total * 100) : 0}%`, background: c.color }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
              <h3 className="text-base font-semibold text-indigo-900 flex items-center gap-2"><Icon.Sparkles />Análise Inteligente com IA</h3>
              <button onClick={generateFeedback} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-bold disabled:opacity-50" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)", boxShadow:"0 2px 6px #2b8be830" }}>
                {loading ? <><Icon.Loader />Analisando...</> : <><Icon.Sparkles />Gerar Análise</>}
              </button>
            </div>
            <div className="bg-white rounded-lg p-5 border border-indigo-100 shadow-sm text-sm text-slate-700">
              {aiFeedback ? <div dangerouslySetInnerHTML={{ __html: aiFeedback.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/#{1,3} (.*)/g, "<h4 class='font-bold mt-3 mb-1'>$1</h4>").replace(/\n/g, "<br/>") }} /> : loading ? <div className="text-indigo-500 flex items-center gap-2"><Icon.Loader />Processando...</div> : <div className="text-center py-6 text-slate-500"><p>Clique para gerar uma análise personalizada do seu desempenho.</p></div>}
            </div>
          </div>
        </>
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
    observacoes: `Este cálculo é uma **simulação estimada** baseada nas informações fornecidas e nas tabelas vigentes (INSS e IRRF 2024). A multa de 40% do FGTS usa o saldo estimado — **recomenda-se confirmar o saldo real na Caixa Econômica Federal**. Os valores de IRRF podem variar conforme outras deduções (previdência privada, pensão alimentícia, etc.). Confira os valores no sistema oficial de folha de pagamento antes do pagamento.`
  };
}

function SeveranceSimulation() {
  const { clients } = useApp();

  const [view, setView]           = useState("list");
  const [saved, setSaved]         = useState(() => {
    try { return JSON.parse(localStorage.getItem("severanceSimulations") || "[]"); } catch { return []; }
  });
  const [reportData, setReportData] = useState(null);
  const [verbas, setVerbas]         = useState([]);
  const [formData, setFormData]     = useState(null);
  const [erroCalc, setErroCalc]     = useState("");

  useEffect(() => {
    localStorage.setItem("severanceSimulations", JSON.stringify(saved));
  }, [saved]);

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

  const saveSimulation = () => {
    const entry = {
      id: uid(), date: new Date().toISOString(),
      clientId: formData.clientId,
      employeeName: reportData.employeeInfo.name,
      cargo: reportData.employeeInfo.cargo,
      reason: reportData.employeeInfo.reason,
      dismissalDate: reportData.employeeInfo.dismissalDate,
      netAmount: totalLiq, reportData, verbas, formData
    };
    setSaved(p => [entry, ...p]);
    setView("list");
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
      setFormData(f); setReportData(res); setVerbas(res.verbas); setView("result");
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
                          <button onClick={() => { setReportData(s.reportData); setVerbas(s.verbas); setFormData(s.formData); setView("result"); }}
                            className="p-1.5 rounded-lg transition-all" style={{ color:"#2b8be8" }}
                            onMouseEnter={e=>e.currentTarget.style.background="#eff6ff"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <Icon.Eye />
                          </button>
                          <button onClick={() => setSaved(p => p.filter(x => x.id !== s.id))}
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
            <button onClick={() => window.print()}
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
            <h3 className="text-sm font-black uppercase tracking-widest mb-4" style={{ color:"#94a3b8" }}>3. Memória de Cálculo</h3>
            <div className="rounded-xl p-4 space-y-2 text-sm ml-4" style={{ background:"#f8fafc", border:"1px solid #e8edf5" }}>
              {reportData.memoriaCalculo.split("\n\n").map((linha, i) => (
                <p key={i} style={{ color:"#374151", lineHeight:1.6 }} dangerouslySetInnerHTML={{ __html: linha.replace(/\*\*(.*?)\*\*/g, "<strong style='color:#1a1d23'>$1</strong>") }} />
              ))}
            </div>
          </div>

          <div className="mb-12">
            <h3 className="text-sm font-black uppercase tracking-widest mb-4" style={{ color:"#94a3b8" }}>4. Observações</h3>
            <div className="rounded-xl p-4 text-sm ml-4" style={{ background:"#fffbeb", border:"1px solid #fde68a", color:"#78350f" }}
              dangerouslySetInnerHTML={{ __html: reportData.observacoes.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }} />
          </div>

          <div className="flex justify-between pt-8 px-4" style={{ borderTop:"1px solid #dde3ed" }}>
            <div className="w-52 text-center">
              <div className="border-t-2 pt-2 mt-12" style={{ borderColor:"#1a1d23" }}>
                <p className="text-sm font-semibold" style={{ color:"#1a1d23" }}>Códice Contabilidade</p>
              </div>
            </div>
            <div className="w-52 text-center">
              <div className="border-t-2 pt-2 mt-12" style={{ borderColor:"#1a1d23" }}>
                <p className="text-sm font-semibold" style={{ color:"#1a1d23" }}>{reportData.employeeInfo.name}</p>
                {reportData.employeeInfo.cpf && <p className="text-xs" style={{ color:"#94a3b8" }}>CPF: {reportData.employeeInfo.cpf}</p>}
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
  const { categories, addCategory, updateCategory, deleteCategory, contexts, addContext, updateContext, deleteContext, settings, updateSettings } = useApp();
  const [appCfg, setAppCfg] = useState(settings);
  const [isCatOpen, setIsCatOpen] = useState(false); const [editCat, setEditCat] = useState(null);
  const [isCtxOpen, setIsCtxOpen] = useState(false); const [editCtx, setEditCtx] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setAppCfg(settings); }, [settings]);

  const [catF, setCatF] = useState({ name:"", color:"#6366f1" });
  const [ctxF, setCtxF] = useState({ name:"", color:"#10b981" });
  const openCat = (c) => { setEditCat(c||null); setCatF(c ? {name:c.name,color:c.color} : {name:"",color:"#6366f1"}); setIsCatOpen(true); };
  const openCtx = (c) => { setEditCtx(c||null); setCtxF(c ? {name:c.name,color:c.color} : {name:"",color:"#10b981"}); setIsCtxOpen(true); };
  const saveCat = () => { if(!catF.name.trim()) return; const d={id:editCat?.id||uid(),name:catF.name,color:catF.color}; editCat?updateCategory(d):addCategory(d); setIsCatOpen(false); setEditCat(null); };
  const saveCtx = () => { if(!ctxF.name.trim()) return; const d={id:editCtx?.id||uid(),name:ctxF.name,color:ctxF.color}; editCtx?updateContext(d):addContext(d); setIsCtxOpen(false); setEditCtx(null); };

  return (
    <div className="space-y-7 max-w-4xl mx-auto">
      <div className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
        <div className="p-5 flex items-center gap-2" style={{ borderBottom:"1px solid #dde3ed" }}><Icon.Settings /><h2 className="text-base font-bold" style={{ color:"#1a1d23" }}>Personalização do Sistema</h2></div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-500 uppercase border-b border-slate-100 pb-2">Aparência</h4>
              <div><label className="block text-xs font-medium text-slate-700 mb-1">Nome do Sistema</label><input required value={appCfg.appName} onChange={e => setAppCfg({ ...appCfg, appName: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
              <div><label className="block text-xs font-medium text-slate-700 mb-1">URL da Logo (Opcional)</label><input type="url" value={appCfg.logoUrl || ""} onChange={e => setAppCfg({ ...appCfg, logoUrl: e.target.value })} placeholder="https://..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
            </div>
            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-slate-500 uppercase border-b border-slate-100 pb-2">Credenciais de Acesso</h4>
              <div><label className="block text-xs font-medium text-slate-700 mb-1">Login</label><input required value={appCfg.loginEmail || ""} onChange={e => setAppCfg({ ...appCfg, loginEmail: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
              <div><label className="block text-xs font-medium text-slate-700 mb-1">Senha</label><input type="password" required value={appCfg.loginPassword || ""} onChange={e => setAppCfg({ ...appCfg, loginPassword: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button type="button" onClick={() => { updateSettings(appCfg); setSaved(true); setTimeout(() => setSaved(false), 2000); }} className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-sm font-medium"><Icon.Save />{saved ? "Salvo!" : "Salvar"}</button>
          </div>
        </div>
      </div>

      {[{ title: "Categorias de Tarefas", items: categories, onAdd: () => openCat(null), onEdit: c => openCat(c), onDelete: deleteCategory, addLabel: "Nova Categoria", color: "indigo" },
        { title: "Contextos (Para quem é)", items: contexts, onAdd: () => openCtx(null), onEdit: c => openCtx(c), onDelete: deleteContext, addLabel: "Novo Contexto", color: "emerald" }].map(s => (
        <div key={s.title} className="rounded-2xl overflow-hidden" style={{ background:"#fff", border:"1px solid #dde3ed", boxShadow:"0 2px 8px rgba(26,29,35,0.07)" }}>
          <div className="p-5 flex items-center justify-between" style={{ borderBottom:"1px solid #dde3ed" }}>
            <h2 className="text-base font-bold" style={{ color:"#1a1d23" }}>{s.title}</h2>
            <button onClick={s.onAdd} className={`flex items-center gap-1.5 px-3 py-2 bg-${s.color}-600 text-white rounded-lg hover:bg-${s.color}-700 text-sm font-medium`}><Icon.Plus />{s.addLabel}</button>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {s.items.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3"><div className="w-5 h-5 rounded-full" style={{ background: item.color }} /><span className="font-medium text-sm text-slate-800">{item.name}</span></div>
                <div className="flex gap-1">
                  <button onClick={() => s.onEdit(item)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"><Icon.Edit /></button>
                  <button onClick={() => s.onDelete(item.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"><Icon.Trash /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {isCatOpen && <Modal title={editCat ? "Editar Categoria" : "Nova Categoria"} onClose={() => { setIsCatOpen(false); setEditCat(null); }}>
        <div className="p-5 space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Nome</label><input value={catF.name} onChange={e=>setCatF(p=>({...p,name:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Cor</label><div className="flex items-center gap-3"><input type="color" value={catF.color} onChange={e=>setCatF(p=>({...p,color:e.target.value}))} className="w-12 h-12 p-1 border border-slate-300 rounded-lg cursor-pointer" /><span className="text-sm text-slate-500">Escolha a cor</span></div></div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => { setIsCatOpen(false); setEditCat(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button><button type="button" onClick={saveCat} className="px-4 py-2 text-white rounded-xl text-sm font-bold" style={{ background:"linear-gradient(135deg,#5aaff5,#2b8be8)" }}>Salvar</button></div>
        </div>
      </Modal>}

      {isCtxOpen && <Modal title={editCtx ? "Editar Contexto" : "Novo Contexto"} onClose={() => { setIsCtxOpen(false); setEditCtx(null); }}>
        <div className="p-5 space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Nome</label><input value={ctxF.name} onChange={e=>setCtxF(p=>({...p,name:e.target.value}))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-400" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Cor</label><div className="flex items-center gap-3"><input type="color" value={ctxF.color} onChange={e=>setCtxF(p=>({...p,color:e.target.value}))} className="w-12 h-12 p-1 border border-slate-300 rounded-lg cursor-pointer" /><span className="text-sm text-slate-500">Escolha a cor</span></div></div>
          <div className="flex justify-end gap-3"><button type="button" onClick={() => { setIsCtxOpen(false); setEditCtx(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button><button type="button" onClick={saveCtx} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">Salvar</button></div>
        </div>
      </Modal>}
    </div>
  );
}

// ============================================================
// APP ROOT
// ============================================================
function AppContent({ onLogout }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} onLogout={onLogout}>
      {activeTab === "dashboard" && <Dashboard />}
      {activeTab === "tasks" && <Tasks />}
      {activeTab === "habits" && <Habits />}
      {activeTab === "clients" && <Clients />}
      {activeTab === "finances" && <Finances />}
      {activeTab === "obligations" && <Obligations />}
      {activeTab === "reports" && <Reports />}
      {activeTab === "severance" && <SeveranceSimulation />}
      {activeTab === "settings" && <SettingsPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent onLogout={() => {}} />
    </AppProvider>
  );
}
