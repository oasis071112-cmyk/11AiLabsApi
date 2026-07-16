<template>
  <el-row :gutter="20" class="charts-row">
    <el-col :xs="24" :sm="12" :lg="6"><ChartShell title="消费趋势" :icon="TrendingUp" color="#409eff" :has-data="dailyData.length>0"><v-chart :option="costGaugeOption" autoresize class="chart"/></ChartShell></el-col>
    <el-col :xs="24" :sm="12" :lg="6"><ChartShell title="Token 消耗" :icon="Hash" color="#22c55e" :has-data="dailyData.length>0"><v-chart :option="tokenGaugeOption" autoresize class="chart"/></ChartShell></el-col>
    <el-col :xs="24" :sm="12" :lg="6"><ChartShell title="费用分布" :icon="ChartPie" color="#f59e0b" :has-data="Boolean(stats.model_usage?.length)"><v-chart :option="modelPieOption" autoresize class="chart"/></ChartShell></el-col>
    <el-col :xs="24" :sm="12" :lg="6"><ChartShell title="调用排行" :icon="BarChart3" color="#8b5cf6" :has-data="Boolean(stats.model_usage?.length)"><v-chart :option="modelRankOption" autoresize class="chart"/></ChartShell></el-col>
  </el-row>
</template>

<script setup>
import { computed, h } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GaugeChart, PieChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { TrendingUp, Hash, ChartPie, BarChart3 } from '@lucide/vue'

use([CanvasRenderer, GaugeChart, PieChart, TooltipComponent])
const props=defineProps({stats:{type:Object,default:()=>({})},dailyData:{type:Array,default:()=>[]}})
const ChartShell=(shellProps,{slots})=>h('div',{class:'chart-card'},[
  h('div',{class:'chart-header'},[h(shellProps.icon,{size:14,color:shellProps.color}),h('span',shellProps.title)]),
  h('div',{class:'chart-body'},shellProps.hasData?slots.default?.():h('div',{class:'empty'},'暂无数据')),
])
ChartShell.props={title:String,icon:Object,color:String,hasData:Boolean}

const totalTokens=computed(()=>Number(props.stats.input_tokens||0)+Number(props.stats.output_tokens||0))
const costGaugeOption=computed(()=>{
  const spent=Number(props.stats.total_consumption||0),cap=Math.max(spent*1.5,10),pct=Math.min(spent/cap,1)
  return {series:[{type:'gauge',radius:'85%',center:['50%','55%'],startAngle:210,endAngle:-30,min:0,max:Number(cap.toFixed(1)),splitNumber:5,axisLine:{lineStyle:{width:14,color:[[pct,'#409eff'],[1,'#f1f5f9']]}},axisTick:{show:false},splitLine:{show:false},axisLabel:{show:false},pointer:{length:'65%',width:6,itemStyle:{color:'#1e293b'}},detail:{offsetCenter:[0,'65%'],valueAnimation:true,formatter:'{value} 点',fontSize:14,fontWeight:700,color:'#1e293b'},data:[{value:Number(spent.toFixed(2))}]}]}
})
const tokenGaugeOption=computed(()=>{
  const tokens=totalTokens.value,cap=Math.max(tokens*1.2,10000),pct=Math.min(tokens/cap,1),label=tokens>=1e6?`${(tokens/1e6).toFixed(1)}M`:tokens>=1000?`${(tokens/1000).toFixed(1)}K`:String(tokens)
  return {series:[{type:'gauge',radius:'85%',center:['50%','55%'],startAngle:210,endAngle:-30,min:0,max:100,axisLine:{lineStyle:{width:14,color:[[pct,'#22c55e'],[1,'#f1f5f9']]}},axisTick:{show:false},splitLine:{show:false},axisLabel:{show:false},pointer:{show:false},detail:{offsetCenter:[0,'8%'],formatter:`${label}\nToken`,fontSize:16,lineHeight:24,fontWeight:700,color:'#1e293b'},data:[{value:Number((pct*100).toFixed(1))}]}]}
})
const modelPieOption=computed(()=>({tooltip:{trigger:'item',formatter:'{b}: {c} 点',confine:true},series:[{type:'pie',radius:['45%','75%'],center:['50%','50%'],itemStyle:{borderRadius:4,borderColor:'#fff',borderWidth:3},label:{show:false},data:(props.stats.model_usage||[]).slice(0,6).map((item,index)=>({name:item.model_code,value:item.cost,itemStyle:{color:['#409eff','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4'][index%6]}}))}]}))
const modelRankOption=computed(()=>{
  const top=(props.stats.model_usage||[]).slice(0,8),first=top[0],total=top.reduce((sum,item)=>sum+Number(item.calls||0),0)||1,pct=first?Number(first.calls||0)/total*100:0
  return {series:[{type:'gauge',radius:'80%',center:['50%','55%'],startAngle:210,endAngle:-30,min:0,max:100,axisLine:{lineStyle:{width:16,color:[[pct/100,'#8b5cf6'],[1,'#f1f5f9']]}},axisTick:{show:false},splitLine:{show:false},axisLabel:{show:false},pointer:{length:'60%',width:6,itemStyle:{color:'#1e293b'}},detail:{offsetCenter:[0,'68%'],valueAnimation:true,formatter:`{value}%\n{a|${first?.model_code||''}}`,rich:{a:{fontSize:10,color:'#64748b',padding:[3,0,0,0]}},fontSize:18,fontWeight:800,color:'#8b5cf6'},data:[{value:Number(pct.toFixed(1))}]}]}
})
</script>

<style scoped>
.charts-row{margin-bottom:16px}.chart-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}.chart-header{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;color:#0f172a}.chart-body{display:flex;align-items:center;justify-content:center;min-height:240px;padding:8px 12px}.chart{height:240px;width:100%}.empty{color:#94a3b8;font-size:13px}
@media(max-width:768px){.charts-row{margin-bottom:4px}.chart-card{margin-bottom:12px}.chart-body{min-height:210px}.chart{height:210px}.chart-header{padding:12px}}
</style>
