import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
export const useAppStore=defineStore('app',()=>{
  const platformInfo=ref({platform_name:'11AiLabs',announcement:''})
  async function fetchPlatformInfo(){try{const r=await api.get('/api/public/info');platformInfo.value=r.data}catch(e){}}
  return {platformInfo,fetchPlatformInfo}
})
