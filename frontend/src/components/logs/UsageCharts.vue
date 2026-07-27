<template>
  <div class="analysis-layout">
    <section class="metrics-panel" aria-label="调用概览">
      <div class="metric-item">
        <div class="metric-icon metric-icon-cost"><TrendingUp :size="18"/></div>
        <div>
          <span class="metric-label">累计消费</span>
          <strong class="metric-value">{{ formatPoints(totalCost) }} <small>点</small></strong>
        </div>
      </div>
      <div class="metric-item">
        <div class="metric-icon metric-icon-token"><Hash :size="18"/></div>
        <div>
          <span class="metric-label">Token 消耗</span>
          <strong class="metric-value">{{ formatCompact(totalTokens) }}</strong>
        </div>
      </div>
    </section>

    <div class="charts-grid">
      <section class="chart-card">
        <div class="chart-header"><ChartPie :size="15"/><span>费用分布</span></div>
        <div v-if="hasCostData" class="chart-body chart-body-doughnut">
          <Doughnut :data="costChartData" :options="costChartOptions"/>
        </div>
        <div v-else class="empty">暂无费用数据</div>
      </section>
      <section class="chart-card">
        <div class="chart-header"><BarChart3 :size="15"/><span>模型调用排行</span></div>
        <div v-if="hasCallData" class="chart-body chart-body-bar">
          <Bar :data="rankChartData" :options="rankChartOptions"/>
        </div>
        <div v-else class="empty">暂无调用数据</div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Bar, Doughnut } from 'vue-chartjs'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import { TrendingUp, Hash, ChartPie, BarChart3 } from '@lucide/vue'

ChartJS.register(ArcElement,BarElement,CategoryScale,LinearScale,Tooltip,Legend)

const props=defineProps({stats:{type:Object,default:()=>({})},dailyData:{type:Array,default:()=>[]}})
const palette=['#7D9B76','#C4A35A','#7A8FA3','#9B7E76','#8E83A6','#6E9B91','#B28A6A','#6F8769']
const modelUsage=computed(()=>(props.stats.model_usage||[]).slice(0,8))
const totalCost=computed(()=>Number(props.stats.total_consumption||0))
const totalTokens=computed(()=>Number(props.stats.input_tokens||0)+Number(props.stats.output_tokens||0))
const hasCostData=computed(()=>modelUsage.value.some(item=>Number(item.cost||0)>0))
const hasCallData=computed(()=>modelUsage.value.some(item=>Number(item.calls||0)>0))
const formatPoints=value=>Number(value||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:4})
const formatCompact=value=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(Number(value||0))

const costChartData=computed(()=>({
  labels:modelUsage.value.map(item=>item.model_code),
  datasets:[{
    data:modelUsage.value.map(item=>Number(item.cost||0)),
    backgroundColor:modelUsage.value.map((_,index)=>palette[index%palette.length]),
    borderColor:'#FFFFFF',
    borderWidth:3,
    hoverOffset:4,
  }],
}))
const costChartOptions={
  responsive:true,
  maintainAspectRatio:false,
  cutout:'64%',
  animation:{duration:220},
  plugins:{
    legend:{position:'bottom',labels:{boxWidth:9,boxHeight:9,usePointStyle:true,padding:14,color:'#5C635A',font:{size:11}}},
    tooltip:{callbacks:{label:context=>` ${context.label}: ${formatPoints(context.raw)} 点`}},
  },
}
const rankChartData=computed(()=>{
  const ranked=[...modelUsage.value].sort((a,b)=>Number(b.calls||0)-Number(a.calls||0))
  return {
    labels:ranked.map(item=>item.model_code),
    datasets:[{data:ranked.map(item=>Number(item.calls||0)),backgroundColor:'#7D9B76',borderRadius:5,borderSkipped:false,barThickness:14}],
  }
})
const rankChartOptions={
  indexAxis:'y',
  responsive:true,
  maintainAspectRatio:false,
  animation:{duration:220},
  scales:{
    x:{beginAtZero:true,ticks:{precision:0,color:'#969E94',font:{size:10}},grid:{color:'#EEF1EC'},border:{display:false}},
    y:{ticks:{color:'#5C635A',font:{size:11},autoSkip:false,callback:function(value){const label=this.getLabelForValue(value);return label.length>18?`${label.slice(0,16)}…`:label}},grid:{display:false},border:{display:false}},
  },
  plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>items[0]?.label||'',label:context=>` 调用 ${Number(context.raw||0).toLocaleString()} 次`}}},
}
</script>

<style scoped>
.analysis-layout{margin-bottom:14px}.metrics-panel{display:flex;gap:1px;margin-bottom:14px;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius);background:var(--border);box-shadow:var(--shadow-sm)}.metric-item{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:16px 18px;background:var(--bg-card)}.metric-icon{width:38px;height:38px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:10px}.metric-icon-cost{background:#eef3ec;color:var(--primary-dark)}.metric-icon-token{background:#f5f0e3;color:#8a713b}.metric-label{display:block;margin-bottom:2px;color:var(--text-muted);font-size:12px;font-weight:600}.metric-value{display:block;color:var(--text-primary);font-size:21px;line-height:1.2;font-variant-numeric:tabular-nums;letter-spacing:-.025em}.metric-value small{font-size:12px;font-weight:600;color:var(--text-secondary)}.charts-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.chart-card{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-card);box-shadow:var(--shadow-sm)}.chart-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);color:var(--text-primary);font-size:13px;font-weight:650}.chart-header svg{color:var(--primary-dark)}.chart-body{position:relative;width:100%;padding:14px}.chart-body-doughnut{height:286px}.chart-body-bar{height:286px}.empty{height:286px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px}
@media(max-width:768px){.analysis-layout{margin-bottom:8px}.metrics-panel{margin-bottom:8px}.metric-item{padding:12px 10px;gap:8px}.metric-icon{width:32px;height:32px;border-radius:8px}.metric-value{font-size:16px}.charts-grid{grid-template-columns:1fr;gap:8px}.chart-body-doughnut,.chart-body-bar,.empty{height:238px}.chart-header{padding:10px 12px}}
@media(prefers-reduced-motion:reduce){.chart-body{transition:none}}
</style>
