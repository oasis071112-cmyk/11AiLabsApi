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
  const platformInfoLoaded=ref(false)
  let platformInfoRequest=null
  async function fetchPlatformInfo(){
    if(platformInfoLoaded.value)return platformInfo.value
    if(platformInfoRequest)return platformInfoRequest
    platformInfoRequest=api.get('/api/public/info').then(r=>{
      platformInfo.value=r.data
      platformInfoLoaded.value=true
      return platformInfo.value
    }).catch(()=>platformInfo.value).finally(()=>{platformInfoRequest=null})
    return platformInfoRequest
  }
  return {platformInfo,fetchPlatformInfo}
})
