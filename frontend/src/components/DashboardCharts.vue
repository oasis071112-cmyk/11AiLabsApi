<template>
<section v-if="showDesktopEmptyState" class="dashboard-empty-state">
  <div class="dashboard-empty-icon"><BarChart3 :size="24"/></div>
  <div><h3>暂无调用数据</h3><p>创建 API Key 并完成一次调用后，这里将展示今日统计和模型使用排行。</p></div>
  <router-link to="/keys" class="dashboard-empty-action">创建 API Key</router-link>
</section>
<el-row v-else :gutter="20">
  <el-col :span="12">
    <el-card class="chart-card"><template #header><div class="chart-heading"><BarChart3 :size="18" color="#409eff"/> 今日统计<el-button size="small" text :loading="loading" @click="$emit('refresh')"><RefreshCw :size="14"/></el-button></div></template>
      <v-chart v-if="stats.today_calls" :option="todayStatsOption" autoresize style="height:300px"/>
      <el-empty v-else description="暂无数据" :image-size="60" style="padding:40px 0"/>
    </el-card>
  </el-col>
  <el-col :span="12">
    <el-card class="chart-card"><template #header><div class="chart-heading"><TrendingUp :size="18" color="#f59e0b"/> 模型使用排行<el-button size="small" text :loading="loading" @click="$emit('refresh')"><RefreshCw :size="14"/></el-button></div></template>
      <v-chart v-if="stats.model_usage?.length" :option="modelRankOption" autoresize style="height:300px"/>
      <el-empty v-else description="暂无数据" :image-size="60" style="padding:40px 0"/>
    </el-card>
  </el-col>
</el-row>
</template>

<script setup>
import { computed } from 'vue'
import { BarChart3, RefreshCw, TrendingUp } from '@lucide/vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { useMobile } from '@/composables/useMobile'

const props=defineProps({stats:{type:Object,default:()=>({})},loading:Boolean})
const isMobile=useMobile()
const showDesktopEmptyState=computed(()=>!isMobile.value&&!Number(props.stats.today_calls||0)&&!props.stats.model_usage?.length)
defineEmits(['refresh'])
use([CanvasRenderer,BarChart,PieChart,GridComponent,TooltipComponent,LegendComponent])

const todayStatsOption=computed(()=>{
  const s=props.stats,total=s.today_calls||1
  const success=s.today_status?.find(x=>x.status==='success')?.count||0
  const failed=s.today_status?.find(x=>x.status==='failed')?.count||0
  const blocked=s.today_status?.find(x=>x.status==='blocked')?.count||0
  const rate=((success/total)*100).toFixed(1)
  return {tooltip:{trigger:'axis'},grid:{containLabel:true,left:'56%',right:10,top:10,bottom:30},xAxis:{type:'value',max:Math.max(success,failed,blocked,1),splitLine:{lineStyle:{color:'#f1f5f9'}}},yAxis:{type:'category',data:['成功','失败','拦截'],axisLabel:{fontSize:13},axisLine:{show:false},axisTick:{show:false}},series:[{type:'bar',barWidth:20,itemStyle:{borderRadius:[0,6,6,0]},data:[{value:success,itemStyle:{color:'#22c55e'}},{value:failed,itemStyle:{color:'#ef4444'}},{value:blocked,itemStyle:{color:'#f59e0b'}}]},{type:'pie',center:['20%','50%'],radius:['48%','58%'],label:{show:true,position:'center',formatter:`{b|${rate}%}\n{a|成功率}`,rich:{b:{fontSize:22,fontWeight:800,color:'#22c55e'},a:{fontSize:11,color:'#64748b',padding:[4,0,0,0]}}},labelLine:{show:false},data:[{value:success,name:'成功',itemStyle:{color:'#22c55e'}},{value:total-success,name:'其他',itemStyle:{color:'#f1f5f9'}}]}]}
})

const modelRankOption=computed(()=>{
  const top=props.stats.model_usage?.slice(0,8)||[],top1=top[0]
  return {tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},grid:{containLabel:true,left:'56%',right:10,top:10,bottom:30},xAxis:{type:'value',splitLine:{lineStyle:{color:'#f1f5f9'}}},yAxis:{type:'category',data:top.map(m=>m.model_code).reverse(),axisLabel:{fontSize:11},axisLine:{show:false},axisTick:{show:false}},series:[{type:'bar',data:top.map(m=>m.calls).reverse(),barWidth:14,itemStyle:{borderRadius:[0,6,6,0],color:{type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'#409eff'},{offset:1,color:'#93c5fd'}]}}},...(top1?[{type:'pie',center:['20%','50%'],radius:['48%','58%'],label:{show:true,position:'center',formatter:`{b|${top1.calls}次}\n{a|TOP 1 调用量}`,rich:{b:{fontSize:18,fontWeight:800,color:'#409eff'},a:{fontSize:10,color:'#64748b',padding:[3,0,0,0]}}},labelLine:{show:false},data:[{value:top1.calls,name:top1.model_code,itemStyle:{color:'#409eff'}},{value:Math.max(0,top.reduce((sum,m)=>sum+m.calls,0)-top1.calls),name:'其他',itemStyle:{color:'#f1f5f9'}}]}]:[])]}
})
</script>

<style scoped>
.chart-heading{display:flex;align-items:center;gap:8px;width:100%}.chart-heading .el-button{margin-left:auto}.chart-card{height:100%}
.chart-card :deep(.el-card__body){padding:10px 14px}
.dashboard-empty-state{min-height:168px;display:flex;align-items:center;gap:18px;padding:26px 30px;border:1px solid var(--border);border-radius:var(--radius);background:#fff;box-shadow:var(--shadow-sm)}.dashboard-empty-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:12px;background:#eff6ff;color:#409eff}.dashboard-empty-state h3{margin:0 0 5px;font-size:16px;color:var(--text-primary)}.dashboard-empty-state p{margin:0;color:var(--text-muted);font-size:13px;line-height:1.65}.dashboard-empty-action{margin-left:auto;flex:0 0 auto;padding:8px 12px;border-radius:8px;background:var(--primary);color:#fff;font-size:13px;font-weight:600;text-decoration:none}
</style>
