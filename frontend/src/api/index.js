import axios from 'axios'
const api=axios.create({baseURL:'',timeout:30000})
api.interceptors.request.use(c=>{const t=localStorage.getItem('token');c.__authToken=t||null;if(t)c.headers.Authorization=`Bearer ${t}`;return c})
api.interceptors.response.use(r=>r,e=>{
  if(axios.isCancel(e)||e?.code==='ERR_CANCELED')return Promise.reject(e)
  const errorMessage=e.response?.data?.error||e.message||'请求失败'
  void import('element-plus').then(({ElMessage})=>ElMessage.error(errorMessage)).catch(()=>{})
  const isLoginRequest=String(e.config?.url||'').includes('/api/auth/login')
  const requestToken=e.config?.__authToken??null
  const currentToken=localStorage.getItem('token')
  if(e.response?.status===401&&!isLoginRequest&&requestToken===currentToken){
    localStorage.removeItem('token');localStorage.removeItem('userRole')
    if(window.location.pathname!=='/login')window.location.assign('/login')
  }
  return Promise.reject(e)
})
export default api
