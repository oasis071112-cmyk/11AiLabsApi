import axios from 'axios'
import { ElMessage } from 'element-plus'
const api=axios.create({baseURL:'',timeout:30000})
api.interceptors.request.use(c=>{const t=localStorage.getItem('token');if(t)c.headers.Authorization=`Bearer ${t}`;return c})
api.interceptors.response.use(r=>r,e=>{ElMessage.error(e.response?.data?.error||e.message||'请求失败');if(e.response?.status===401){localStorage.removeItem('token');localStorage.removeItem('userRole');window.location.href='/login'}return Promise.reject(e)})
export default api
