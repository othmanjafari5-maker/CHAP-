import {useEffect,useState} from 'react';
import {request,setAccessToken} from './api';
import {AuthContext} from './auth-context';
export default function AuthGate({children}){
  const [user,setUser]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const expired=()=>{setAccessToken('');setUser(null);setError('Your session ended. Please sign in again.');};window.addEventListener('chap-session-expired',expired);return()=>window.removeEventListener('chap-session-expired',expired);},[]);
  async function login(event){event.preventDefault();setBusy(true);setError('');const f=new FormData(event.currentTarget);try{const result=await request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.get('username'),password:f.get('password')})});setAccessToken(result.token);setUser(result.user);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function logout(){try{await request('/api/auth/logout',{method:'POST'});}finally{setAccessToken('');setUser(null);}}
  if(!user)return <main className="login-shell"><section className="panel login-card"><span className="brand-mark">✚</span><p className="eyebrow">CHAP / SECURE WORKSPACE</p><h1>Sign in</h1><p>Access your fleet operations workspace.</p><form onSubmit={login}><label>Username<input name="username" autoComplete="username" required autoFocus/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button className="primary-button" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>{error&&<p role="alert" className="notice">{error}</p>}</section></main>;
  return <AuthContext.Provider value={{user,logout,can:(...roles)=>roles.includes(user.role)}}>{children}</AuthContext.Provider>;
}
