import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'
export const useAppStore=defineStore('app',()=>{
  const platformInfo=ref({
    platform_name:'IonAiLabs',
    announcement:'',
    customer_service_text:'',
    customer_service_url:''
  })
  async function fetchPlatformInfo(){try{const r=await api.get('/api/public/info');platformInfo.value=r.data}catch(e){}}
  return {platformInfo,fetchPlatformInfo}
})
