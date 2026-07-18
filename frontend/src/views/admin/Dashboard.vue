<template>
<div class="admin-dashboard admin-page">
  <section class="admin-metrics">
    <article v-for="item in metrics" :key="item.label" class="stat-card"><div class="label">{{ item.label }}</div><div class="value" :class="item.tone">{{ item.value }}</div></article>
  </section>
  <section class="admin-insights">
    <el-card class="admin-trend-card"><template #header><div class="insight-heading"><LineChart :size="18" color="#409eff"/> 7天调用趋势</div></template><div v-if="isMobile" class="mobile-trend-list"><div v-for="item in data.daily_trend||[]" :key="item.date"><span>{{ item.date }}</span><strong>{{ item.success_calls||0 }} 成功</strong><em>{{ item.failed_calls||0 }} 失败</em></div><el-empty v-if="!data.daily_trend?.length" description="暂无数据" :image-size="52"/></div><AdminTrendChart v-else :data="data.daily_trend||[]"/></el-card>
    <el-card class="admin-ranking-card"><template #header><div class="insight-heading"><Trophy :size="18" color="#f59e0b"/> 模型调用排行</div></template><el-empty v-if="!data.model_ranking?.length" description="暂无数据" :image-size="52"/><el-table v-else :data="data.model_ranking" size="small" stripe><el-table-column prop="model_code" label="模型"/><el-table-column prop="calls" label="调用次数" width="100"/><el-table-column label="消费" width="120"><template #default="{row}">{{ row.cost?.toFixed(4) }} 点</template></el-table-column></el-table></el-card>
  </section>
</div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';import api from '@/api';import { LineChart, Trophy } from '@lucide/vue'
import { useMobile } from '@/composables/useMobile'
const data=ref({}),isMobile=useMobile()
const AdminTrendChart=defineAsyncComponent(()=>import('@/components/AdminTrendChart.vue'))
const metrics=computed(()=>[
  {label:'今日购买',value:`¥${data.value.today_recharge?.toFixed(2)||0}`},{label:'今日消费',value:`${data.value.today_consumption?.toFixed(2)||0} 点`},{label:'新增用户',value:data.value.new_users_today||0},{label:'今日调用',value:data.value.today_calls||0},{label:'失败数',value:data.value.failed_calls||0,tone:'text-danger'},{label:'活跃渠道',value:data.value.active_channels||0,tone:'text-success'},{label:'总收入',value:`¥${data.value.total_revenue?.toFixed(2)||0}`},{label:'总用户',value:data.value.total_users||0}
])
onMounted(async()=>{try{data.value=(await api.get('/api/admin/dashboard')).data}catch(e){}})
</script>

<style scoped>
.admin-dashboard{min-width:0}.admin-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.admin-metrics .stat-card{min-width:0;min-height:104px;padding:17px 18px}.admin-metrics .value{white-space:nowrap;font-size:24px;overflow:hidden;text-overflow:ellipsis}.admin-insights{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr);gap:12px}.admin-insights :deep(.el-card){height:100%}.insight-heading{display:flex;align-items:center;gap:8px}.admin-ranking-card :deep(.el-card__body){padding:12px 16px}.mobile-trend-list{display:grid;gap:6px}.mobile-trend-list>div{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;background:#f8fafc;border-radius:8px;padding:9px 10px;font-size:12px}.mobile-trend-list strong{color:#16a34a}.mobile-trend-list em{color:#dc2626;font-style:normal}
@media(min-width:769px) and (max-width:1180px){.admin-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.admin-metrics .stat-card{min-height:100px;padding:15px 16px}.admin-metrics .value{font-size:22px}.admin-insights{grid-template-columns:minmax(0,1fr) minmax(300px,.9fr);gap:10px}}
@media(max-width:768px){.admin-dashboard{padding:0}.admin-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}.admin-metrics .stat-card{min-height:102px;padding:14px 13px}.admin-metrics .label{margin-bottom:7px;letter-spacing:0}.admin-metrics .value{font-size:20px;line-height:1.25;overflow-wrap:anywhere;white-space:normal}.admin-insights{grid-template-columns:1fr;gap:12px}.admin-ranking-card :deep(.el-card__body){padding:12px}}
</style>
