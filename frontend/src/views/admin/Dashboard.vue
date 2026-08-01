<template>
<div class="admin-dashboard admin-page">
  <section v-if="dashboardError" class="dashboard-error" role="alert" aria-label="管理概览加载失败"><div><strong>管理概览加载失败</strong><span>{{ dashboardError }}</span></div><el-button type="primary" plain :loading="dashboardLoading" @click="loadDashboard">重试</el-button></section>
  <section v-if="dashboardLoading" class="admin-metrics dashboard-skeleton" aria-busy="true" aria-label="正在加载管理概览"><article v-for="index in 8" :key="index" class="stat-card"><span/><span/></article></section>
  <section v-else-if="!dashboardError" class="admin-metrics">
    <article v-for="item in metrics" :key="item.label" class="stat-card"><div class="label">{{ item.label }}</div><div class="value" :class="item.tone">{{ item.value }}</div></article>
  </section>
  <section v-if="!dashboardLoading&&!dashboardError" class="admin-insights">
    <div ref="trendRoot" class="admin-trend-wrap"><el-card class="admin-trend-card"><template #header><div class="insight-heading"><LineChart :size="18" color="#409eff"/> 7天调用趋势</div></template><div v-if="isMobile" class="mobile-trend-list"><div v-for="item in data.daily_trend||[]" :key="item.date"><span>{{ item.date }}</span><strong>{{ item.success_calls||0 }} 成功</strong><em>{{ item.failed_calls||0 }} 失败</em></div><el-empty v-if="!hasTrendData" description="暂无数据" :image-size="52"/></div><AdminTrendChart v-else-if="hasTrendData&&trendVisible" :data="data.daily_trend"/><el-empty v-else-if="!hasTrendData" description="暂无数据" :image-size="52"/><div v-else class="trend-deferred-placeholder" aria-label="图表将在可见时加载"/></el-card></div>
    <el-card class="admin-ranking-card"><template #header><div class="insight-heading"><Trophy :size="18" color="#f59e0b"/> 模型调用排行</div></template><el-empty v-if="!data.model_ranking?.length" description="暂无数据" :image-size="52"/><el-table v-else :data="data.model_ranking" size="small" stripe><el-table-column prop="model_code" label="模型"/><el-table-column prop="calls" label="调用次数" width="100"/><el-table-column label="消费" width="120"><template #default="{row}">{{ row.cost?.toFixed(4) }} 点</template></el-table-column></el-table></el-card>
  </section>
</div>
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';import api from '@/api';import { LineChart, Trophy } from '@lucide/vue'
import { useMobile } from '@/composables/useMobile'
const data=ref({}),isMobile=useMobile(),dashboardLoading=ref(true),dashboardError=ref(''),trendRoot=ref(null),trendVisible=ref(false)
const AdminTrendChart=defineAsyncComponent(()=>import('@/components/AdminTrendChart.vue'))
let trendObserver=null
const metrics=computed(()=>[
  {label:'今日购买',value:`¥${data.value.today_recharge?.toFixed(2)||0}`},{label:'今日消费',value:`${data.value.today_consumption?.toFixed(2)||0} 点`},{label:'新增用户',value:data.value.new_users_today||0},{label:'今日调用',value:data.value.today_calls||0},{label:'失败数',value:data.value.failed_calls||0,tone:'text-danger'},{label:'活跃渠道',value:data.value.active_channels||0,tone:'text-success'},{label:'总收入',value:`¥${data.value.total_revenue?.toFixed(2)||0}`},{label:'总用户',value:data.value.total_users||0}
])
const hasTrendData=computed(()=>Boolean(data.value.daily_trend?.length))
function observeTrend(){
  if(trendVisible.value||trendObserver||!trendRoot.value)return
  if(!('IntersectionObserver' in window)){trendVisible.value=true;return}
  trendObserver=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){
      trendVisible.value=true
      trendObserver?.disconnect()
      trendObserver=null
    }
  },{rootMargin:'160px 0px'})
  trendObserver.observe(trendRoot.value)
}
async function loadDashboard(){
  dashboardLoading.value=true
  dashboardError.value=''
  try{
    try{
      data.value=(await api.get('/api/admin/dashboard/bootstrap',{timeout:10000})).data
    }catch(error){
      if(error.response?.status!==404)throw error
      data.value=(await api.get('/api/admin/dashboard',{timeout:10000})).data
    }
  }catch(error){
    dashboardError.value=error.response?.data?.error||error.message||'请稍后重试'
  }finally{
    dashboardLoading.value=false
  }
}
onMounted(loadDashboard)
watch(dashboardLoading,async loading=>{if(!loading){await nextTick();observeTrend()}})
onBeforeUnmount(()=>trendObserver?.disconnect())
</script>

<style scoped>
.admin-dashboard{min-width:0}.dashboard-error{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;padding:14px 16px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#991b1b}.dashboard-error>div{display:flex;flex-direction:column;gap:3px}.dashboard-error span{font-size:12px;color:#b91c1c}.admin-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.admin-metrics .stat-card{min-width:0;min-height:104px;padding:17px 18px}.admin-metrics .value{white-space:nowrap;font-size:24px;overflow:hidden;text-overflow:ellipsis}.dashboard-skeleton .stat-card{display:grid;align-content:space-between}.dashboard-skeleton span,.trend-deferred-placeholder{display:block;border-radius:8px;background:linear-gradient(90deg,#f6f8f5 25%,#edf2eb 37%,#f6f8f5 63%);background-size:400% 100%;animation:dashboard-skeleton 1.2s ease-in-out infinite}.dashboard-skeleton span:first-child{width:48%;height:13px}.dashboard-skeleton span:last-child{width:72%;height:27px}.admin-insights{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr);gap:12px}.admin-trend-wrap{min-width:0}.admin-insights :deep(.el-card){height:100%}.insight-heading{display:flex;align-items:center;gap:8px}.admin-ranking-card :deep(.el-card__body){padding:12px 16px}.mobile-trend-list{display:grid;gap:6px}.mobile-trend-list>div{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;background:#f8fafc;border-radius:8px;padding:9px 10px;font-size:12px}.mobile-trend-list strong{color:#16a34a}.mobile-trend-list em{color:#dc2626;font-style:normal}.trend-deferred-placeholder{height:300px}@keyframes dashboard-skeleton{to{background-position:-400% 0}}
@media(min-width:769px) and (max-width:1180px){.admin-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.admin-metrics .stat-card{min-height:100px;padding:15px 16px}.admin-metrics .value{font-size:22px}.admin-insights{grid-template-columns:minmax(0,1fr) minmax(300px,.9fr);gap:10px}}
@media(max-width:768px){.admin-dashboard{padding:0}.admin-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}.admin-metrics .stat-card{min-height:102px;padding:14px 13px}.admin-metrics .label{margin-bottom:7px;letter-spacing:0}.admin-metrics .value{font-size:20px;line-height:1.25;overflow-wrap:anywhere;white-space:normal}.admin-insights{grid-template-columns:1fr;gap:12px}.admin-ranking-card :deep(.el-card__body){padding:12px}}
</style>
