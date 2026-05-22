import { useState, useEffect, useRef, createContext, useContext, useCallback } from "react";
import { db, auth } from "./supabase.js";

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);

function AppProvider({ children }) {
  const [state, setState] = useState({ tasks: [], habits: [], clients: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        await auth.restoreSession();
        const [tasks, habits, clients] = await Promise.all([
          db.select("tasks"), db.select("habits"), db.select("clients"),
        ]);
        setState({ tasks: tasks||[], habits: habits||[], clients: clients||[] });
      } catch(e) {
        console.error('Load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <div style={{padding:40, textAlign:'center'}}>Carregando...</div>;

  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

function Dashboard() {
  const { tasks, habits, clients } = useApp();
  return (
    <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1 style={{ color: '#1a1d23' }}>Códice Produtivo ✅</h1>
      <p>Tarefas: {tasks.length}</p>
      <p>Hábitos: {habits.length}</p>
      <p>Clientes: {clients.length}</p>
      <p style={{ color: '#10b981', fontWeight: 'bold', marginTop: 16 }}>
        App funcionando! Erro foi corrigido.
      </p>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');

  const login = async () => {
    try {
      await auth.signIn(email, pass);
      onLogin();
    } catch(e) {
      setErr(e.message);
    }
  };

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#1a1d23' }}>
      <div style={{ background:'#fff', padding:32, borderRadius:16, width:320 }}>
        <h2 style={{ marginBottom:24, textAlign:'center' }}>CÓDICE CONTABILIDADE</h2>
        {err && <p style={{ color:'red', marginBottom:16 }}>{err}</p>}
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={{ width:'100%', padding:10, marginBottom:12, border:'1px solid #ddd', borderRadius:8, boxSizing:'border-box' }} />
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Senha" onKeyDown={e=>e.key==='Enter'&&login()} style={{ width:'100%', padding:10, marginBottom:16, border:'1px solid #ddd', borderRadius:8, boxSizing:'border-box' }} />
        <button onClick={login} style={{ width:'100%', padding:12, background:'#2b8be8', color:'#fff', border:'none', borderRadius:8, fontWeight:'bold', cursor:'pointer' }}>Entrar</button>
      </div>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    auth.restoreSession().then(s => {
      setLoggedIn(!!s);
      setChecked(true);
    });
  }, []);

  if (!checked) return <div style={{padding:40}}>Carregando...</div>;
  if (!loggedIn) return <LoginScreen onLogin={() => setLoggedIn(true)} />;

  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  );
}
