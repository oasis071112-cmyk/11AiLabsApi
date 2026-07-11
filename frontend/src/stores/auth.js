import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'
export const useAuthStore=defineStore('auth',()=>{
  const user=ref(null),wallet=ref(null),token=ref(localStorage.getItem('token')||'')
  const isAdmin=computed(()=>user.value?.role&&user.value.role!=='user')
  function setToken(t){token.value=t;localStorage.setItem('token',t)}
  function setUser(u){user.value=u;if(u)localStorage.setItem('userRole',u.role)}
  async function checkAuth(){if(!token.value)return false;try{const r=await api.get('/api/auth/me');setUser(r.data.user);wallet.value=r.data.wallet;return true}catch{logout();return false}}
  async function login(u,p){const r=await api.post('/api/auth/login',{username:u,password:p});setToken(r.data.token);setUser(r.data.user);try{await checkAuth()}catch{};return r.data}
  async function register(f){const r=await api.post('/api/auth/register',f);setToken(r.data.token);setUser(r.data.user);await checkAuth();return r.data}
  function logout(){token.value='';user.value=null;wallet.value=null;localStorage.removeItem('token');localStorage.removeItem('userRole')}
  return {user,wallet,token,isAdmin,login,register,logout,checkAuth,setToken,setUser}
})