<template>
<section v-if="showDesktopEmptyState" class="dashboard-empty-state">
  <div class="dashboard-empty-icon"><BarChart3 :size="24"/></div>
  <div><h3>暂无调用数据</h3><p>创建 API Key 并完成一次调用后，这里将展示今日统计和模型使用排行。</p></div>
  <router-link to="/keys" class="dashboard-empty-action">创建 API Key</router-link>
</section>
<el-row v-else :gutter="20">
  <el-col :span="12">
    <el-card class="chart-card"><template #header><div class="chart-heading"><BarChart3 :size="18"/> 今日统计<el-button size="small" text :loading="loading" @click="$emit('refresh')"><RefreshCw :size="14"/></el-button></div></template>
      <div v-if="stats.today_calls" class="chart-content">
        <div class="chart-metric"><span>今日成功率</span><strong>{{ successRate }}%</strong><small>{{ successCount.toLocaleString() }} 次成功调用</small></div>
        <div class="chart-canvas"><Bar :data="todayChartData" :options="todayChartOptions"/></div>
      </div>
      <el-empty v-else description="暂无数据" :image-size="60" style="padding:40px 0"/>
    </el-card>
  </el-col>
  <el-col :span="12">
    <el-card class="chart-card"><template #header><div class="chart-heading"><TrendingUp :size="18"/> 模型使用排行<el-button size="small" text :loading="loading" @click="$emit('refresh')"><RefreshCw :size="14"/></el-button></div></template>
      <div v-if="stats.model_usage?.length" class="chart-content">
        <div class="chart-metric"><span>TOP 1 模型</span><strong class="model-name" :title="topModel?.model_code">{{ topModel?.model_code }}</strong><small>占前八模型调用的 {{ topModelShare }}%</small></div>
        <div class="chart-canvas"><Bar :data="modelChartData" :options="modelChartOptions"/></div>
      </div>
      <el-empty v-else description="暂无数据" :image-size="60" style="padding:40px 0"/>
    </el-card>
  </el-col>
</el-row>
</template>

<script setup>
import { computed } from 'vue'
import { BarChart3, RefreshCw, TrendingUp } from '@lucide/vue'
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js'
import { useMobile } from '@/composables/useMobile'

ChartJS.register(BarElement,CategoryScale,LinearScale,Tooltip)

const props=defineProps({stats:{type:Object,default:()=>({})},loading:Boolean})
const isMobile=useMobile()
const showDesktopEmptyState=computed(()=>!isMobile.value&&!Number(props.stats.today_calls||0)&&!props.stats.model_usage?.length)
defineEmits(['refresh'])

const statusCount=status=>Number(props.stats.today_status?.find(item=>item.status===status)?.count||0)
const successCount=computed(()=>statusCount('success'))
const failedCount=computed(()=>statusCount('failed'))
const blockedCount=computed(()=>statusCount('blocked'))
const successRate=computed(()=>props.stats.today_calls?((successCount.value/Number(props.stats.today_calls))*100).toFixed(1):'0.0')
const rankedModels=computed(()=>[...(props.stats.model_usage||[])].sort((a,b)=>Number(b.calls||0)-Number(a.calls||0)).slice(0,8))
const topModel=computed(()=>rankedModels.value[0])
const topModelShare=computed(()=>{
  const total=rankedModels.value.reduce((sum,item)=>sum+Number(item.calls||0),0)
  return total&&topModel.value?((Number(topModel.value.calls||0)/total)*100).toFixed(1):'0.0'
})
const todayChartData=computed(()=>({
  labels:['成功','失败','拦截'],
  datasets:[{data:[successCount.value,failedCount.value,blockedCount.value],backgroundColor:['#6B9B6F','#C47A7A','#C4A35A'],borderRadius:5,borderSkipped:false,barThickness:18}],
}))
const modelChartData=computed(()=>({
  labels:rankedModels.value.map(item=>item.model_code),
  datasets:[{data:rankedModels.value.map(item=>Number(item.calls||0)),backgroundColor:'#7D9B76',borderRadius:5,borderSkipped:false,barThickness:13}],
}))
const baseOptions={
  indexAxis:'y',
  responsive:true,
  maintainAspectRatio:false,
  animation:{duration:220},
  scales:{
    x:{beginAtZero:true,ticks:{precision:0,color:'#969E94',font:{size:10}},grid:{color:'#EEF1EC'},border:{display:false}},
    y:{ticks:{color:'#5C635A',font:{size:11}},grid:{display:false},border:{display:false}},
  },
  plugins:{legend:{display:false}},
}
const todayChartOptions={...baseOptions,plugins:{...baseOptions.plugins,tooltip:{callbacks:{label:context=>` ${Number(context.raw||0).toLocaleString()} 次`}}}}
const modelChartOptions={...baseOptions,scales:{...baseOptions.scales,y:{...baseOptions.scales.y,ticks:{...baseOptions.scales.y.ticks,autoSkip:false,callback:function(value){const label=this.getLabelForValue(value);return label.length>16?`${label.slice(0,14)}…`:label}}}},plugins:{...baseOptions.plugins,tooltip:{callbacks:{title:items=>items[0]?.label||'',label:context=>` 调用 ${Number(context.raw||0).toLocaleString()} 次`}}}}
</script>

<style scoped>
.chart-heading{display:flex;align-items:center;gap:8px;width:100%;color:var(--text-primary)}.chart-heading>svg{color:var(--primary-dark)}.chart-heading .el-button{margin-left:auto}.chart-card{height:100%}.chart-card :deep(.el-card__body){padding:14px 16px}.chart-content{display:grid;grid-template-columns:minmax(128px,.72fr) minmax(0,1.5fr);align-items:center;gap:18px;min-height:286px}.chart-metric{min-width:0;padding:16px;border-radius:12px;background:#F4F7F2}.chart-metric span,.chart-metric small{display:block;color:var(--text-muted);font-size:11px;font-weight:600}.chart-metric strong{display:block;margin:5px 0;color:var(--primary-dark);font-size:28px;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.035em}.chart-metric .model-name{overflow:hidden;font-size:17px;white-space:nowrap;text-overflow:ellipsis;letter-spacing:-.01em}.chart-canvas{position:relative;height:250px;min-width:0}.dashboard-empty-state{min-height:168px;display:flex;align-items:center;gap:18px;padding:26px 30px;border:1px solid var(--border);border-radius:var(--radius);background:#fff;box-shadow:var(--shadow-sm)}.dashboard-empty-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:12px;background:#eef3ec;color:var(--primary-dark)}.dashboard-empty-state h3{margin:0 0 5px;font-size:16px;color:var(--text-primary)}.dashboard-empty-state p{margin:0;color:var(--text-secondary);font-size:13px;line-height:1.65}.dashboard-empty-action{margin-left:auto;flex:0 0 auto;padding:8px 12px;border-radius:8px;background:var(--primary);color:#fff;font-size:13px;font-weight:600;text-decoration:none}
@media(max-width:1100px){.chart-content{grid-template-columns:1fr;gap:8px}.chart-metric{display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:10px;padding:11px 13px}.chart-metric strong{grid-row:1/3;grid-column:2;margin:0;font-size:22px}.chart-metric .model-name{max-width:180px;font-size:15px}.chart-canvas{height:220px}}
</style>
