import { defineStore } from 'pinia'
import { ref } from 'vue'
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
    platformInfoRequest=fetch('/api/public/info',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(async response=>{
      if(!response.ok)throw new Error(`平台信息加载失败 (${response.status})`)
      platformInfo.value=await response.json()
      platformInfoLoaded.value=true
      return platformInfo.value
    }).catch(()=>platformInfo.value).finally(()=>{platformInfoRequest=null})
    return platformInfoRequest
  }
  return {platformInfo,fetchPlatformInfo}
})
