import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'
import { coldStartKeys, takeColdStartRequest } from '@/utils/cold-start-prefetch'
export const useAuthStore=defineStore('auth',()=>{
  const user=ref(null),wallet=ref(null),token=ref(localStorage.getItem('token')||''),authError=ref('')
  const isAdmin=computed(()=>user.value?.role&&user.value.role!=='user')
  function setToken(t){token.value=t;authError.value='';localStorage.setItem('token',t)}
  function setUser(u){user.value=u;if(u)localStorage.setItem('userRole',u.role)}
  async function checkAuth(){if(!token.value)return false;const requestToken=token.value;authError.value='';try{const r=await takeColdStartRequest(coldStartKeys.auth,()=>api.get('/api/auth/me'));if(token.value!==requestToken||localStorage.getItem('token')!==requestToken)return false;setUser(r.data.user);wallet.value=r.data.wallet;return true}catch(e){if(token.value!==requestToken||localStorage.getItem('token')!==requestToken)return false;if(e.response?.status===401){logout();if(window.location.pathname!=='/login')window.location.assign('/login')}else authError.value='账户信息加载失败，请刷新页面重试';return false}}
  async function login(u,p){const r=await api.post('/api/auth/login',{username:u,password:p});setToken(r.data.token);setUser(r.data.user);return r.data}
  async function register(f){const r=await api.post('/api/auth/register',f);setToken(r.data.token);setUser(r.data.user);return r.data}
  function logout(){token.value='';user.value=null;wallet.value=null;authError.value='';localStorage.removeItem('token');localStorage.removeItem('userRole')}
  return {user,wallet,token,authError,isAdmin,login,register,logout,checkAuth,setToken,setUser}
})
