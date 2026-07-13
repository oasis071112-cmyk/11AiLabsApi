<template>
<div class="dashboard">
  <!-- KPI 卡片行 -->
  <el-row :gutter="20" class="kpi-row">
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#409eff"><DollarSign :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">今日消费</div><div class="kpi-value">{{ stats.today_consumption?.toFixed(4)||'0.00' }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#22c55e"><Activity :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">今日调用</div><div class="kpi-value">{{ (stats.today_calls||0).toLocaleString() }}</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#f59e0b"><Coins :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">累计消费</div><div class="kpi-value">{{ stats.total_consumption?.toFixed(2)||0 }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#ef4444"><Target :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">成功率</div><div class="kpi-value">{{ successRate }}%</div></div></div></el-col>
  </el-row>

  <!-- 筛选栏 -->
  <div class="filter-bar">
    <div class="filter-left">
      <el-radio-group v-model="datePreset" @change="onPresetChange" size="small">
        <el-radio-button value="7d">近7天</el-radio-button>
        <el-radio-button value="30d">近30天</el-radio-button>
        <el-radio-button value="90d">近90天</el-radio-button>
        <el-radio-button value="custom">自定义</el-radio-button>
      </el-radio-group>
      <el-date-picker v-if="datePreset==='custom'" v-model="customRange" type="daterange" range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" @change="onCustomChange" style="width:260px;margin-left:12px"/>
      <el-select v-model="filterModel" clearable placeholder="全部模型" size="small" style="width:160px;margin-left:12px" @change="fetchAll">
        <el-option v-for="m in modelList" :key="m.model_code" :label="m.model_code" :value="m.model_code"/>
      </el-select>
    </div>
    <div class="filter-right">
      <el-button size="small" @click="fetchAll"><RefreshCw :size="14" style="margin-right:4px"/>刷新</el-button>
      <el-button size="small" type="success" @click="toggleAutoRefresh">{{ autoRefresh ? '⏸ 停止自动' : '▶ 自动刷新' }}</el-button>
    </div>
  </div>

  <!-- 2x2 球型图表 -->
  <el-row :gutter="20" class="charts-row">
    <!-- 消费趋势球型图 -->
    <el-col :span="6">
      <div class="chart-card">
        <div class="chart-header"><TrendingUp :size="14" color="#409eff"/><span>消费趋势</span></div>
        <div class="chart-body chart-sphere">
          <v-chart :option="costGaugeOption" autoresize style="height:240px" v-if="dailyData.length"/>
          <el-empty v-else description="暂无数据" :image-size="50" style="padding:30px 0"/>
        </div>
      </div>
    </el-col>
    <!-- Token消耗球型图 -->
    <el-col :span="6">
      <div class="chart-card">
        <div class="chart-header"><Hash :size="14" color="#22c55e"/><span>Token 消耗</span></div>
        <div class="chart-body chart-sphere">
          <v-chart :option="tokenLiquidOption" autoresize style="height:240px" v-if="dailyData.length"/>
          <el-empty v-else description="暂无数据" :image-size="50" style="padding:30px 0"/>
        </div>
      </div>
    </el-col>
    <!-- 模型费用分布球型图 -->
    <el-col :span="6">
      <div class="chart-card">
        <div class="chart-header"><ChartPie :size="14" color="#f59e0b"/><span>费用分布</span></div>
        <div class="chart-body chart-sphere">
          <v-chart :option="modelPie3DOption" autoresize style="height:240px" v-if="stats.model_usage?.length"/>
          <el-empty v-else description="暂无数据" :image-size="50" style="padding:30px 0"/>
        </div>
      </div>
    </el-col>
    <!-- 模型调用排行球型图 -->
    <el-col :span="6">
      <div class="chart-card">
        <div class="chart-header"><BarChart3 :size="14" color="#8b5cf6"/><span>调用排行</span></div>
        <div class="chart-body chart-sphere">
          <v-chart :option="modelRankGaugeOption" autoresize style="height:240px" v-if="stats.model_usage?.length"/>
          <el-empty v-else description="暂无数据" :image-size="50" style="padding:30px 0"/>
        </div>
      </div>
    </el-col>
  </el-row>

  <!-- 调用明细表 -->
  <div class="chart-card" style="margin-top:0">
    <div class="chart-header"><ClipboardList :size="14" color="#6366f1"/><span>最近调用记录</span><span class="chart-sub" style="cursor:pointer;color:#409eff" @click="showAllLogs=true">查看全部 →</span></div>
    <div class="chart-body" style="padding-top:0">
      <el-table :data="recentLogs" stripe size="small" v-loading="loading">
        <el-table-column prop="created_at" label="时间" width="170"/>
        <el-table-column prop="model_code" label="模型" width="130"><template #default="{row}"><el-tag size="small" effect="plain">{{ row.model_code }}</el-tag></template></el-table-column>
        <el-table-column label="输入Token" width="100" align="right"><template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template></el-table-column>
        <el-table-column label="输出Token" width="100" align="right"><template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template></el-table-column>
        <el-table-column label="费用" width="110" align="right"><template #default="{row}">{{ row.total_cost?.toFixed(6)||'0' }} 点</template></el-table-column>
        <el-table-column label="计费明细" width="130"><template #default="{row}"><el-tooltip v-if="row.official_currency" :content="billingDetail(row)"><span class="detail-link">官方价 × 倍率</span></el-tooltip><span v-else>-</span></template></el-table-column>
        <el-table-column label="状态" width="80" align="center"><template #default="{row}"><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="error_message" label="备注" min-width="140" show-overflow-tooltip/>
      </el-table>
    </div>
  </div>

  <!-- 全部日志弹窗 -->
  <el-dialog v-model="showAllLogs" title="全部调用记录" width="90%" top="3vh" destroy-on-close>
    <div style="margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap">
      <el-select v-model="logFilter.model" clearable placeholder="模型" size="small" style="width:150px" @change="fetchLogs"><el-option v-for="m in modelList" :key="m.model_code" :label="m.model_code" :value="m.model_code"/></el-select>
      <el-date-picker v-model="logFilter.dateRange" type="daterange" range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" @change="fetchLogs"/>
      <el-button size="small" @click="fetchLogs">查询</el-button>
    </div>
    <el-table :data="allLogs" stripe size="small" v-loading="logLoading" max-height="60vh">
      <el-table-column prop="created_at" label="时间" width="170"/>
      <el-table-column prop="request_id" label="请求ID" width="180" show-overflow-tooltip/>
      <el-table-column prop="model_code" label="模型" width="130"/>
      <el-table-column label="输入Token" width="100" align="right"><template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template></el-table-column>
      <el-table-column label="输出Token" width="100" align="right"><template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template></el-table-column>
      <el-table-column label="费用" width="110" align="right"><template #default="{row}">{{ row.total_cost?.toFixed(6)||'0' }} 点</template></el-table-column>
      <el-table-column label="计费明细" width="130"><template #default="{row}"><el-tooltip v-if="row.official_currency" :content="billingDetail(row)"><span class="detail-link">官方价 × 倍率</span></el-tooltip><span v-else>-</span></template></el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{row}"><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column prop="error_message" label="错误信息" min-width="160" show-overflow-tooltip/>
    </el-table>
    <el-pagination v-model:current-page="logPage" :page-size="20" :total="logTotal" layout="prev,pager,next" @current-change="fetchLogs" style="margin-top:16px;justify-content:center" small/>
  </el-dialog>
</div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { DollarSign, Activity, Coins, Target, TrendingUp, Hash, ChartPie, BarChart3, ClipboardList, RefreshCw } from '@lucide/vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GaugeChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import 'echarts-liquidfill'
import api from '@/api'
import dayjs from 'dayjs'

use([CanvasRenderer, GaugeChart, PieChart, GridComponent, TooltipComponent, LegendComponent])

const stats = ref({})
const modelList = ref([])
const dailyData = ref([])
const recentLogs = ref([])
const loading = ref(false)
const datePreset = ref('7d')
const customRange = ref([])
const filterModel = ref('')
const dateRange = ref([])
const showAllLogs = ref(false)
const allLogs = ref([])
const logLoading = ref(false)
const logPage = ref(1)
const logTotal = ref(0)
const logFilter = ref({ model: '', dateRange: [] })
const autoRefresh = ref(false)
let refreshTimer = null

const successRate = computed(() => {
  if (!stats.value.today_calls) return '0.0'
  const success = stats.value.today_status?.find(s => s.status === 'success')?.count || 0
  return ((success / stats.value.today_calls) * 100).toFixed(1)
})

const totalTokens = computed(() => (stats.value.input_tokens || 0) + (stats.value.output_tokens || 0))

// ============ 球型 1: 消费仪表盘 ============
const costGaugeOption = computed(() => {
  const spent = stats.value.total_consumption || 0
  const cap = Math.max(spent * 1.5, 10)
  const pct = Math.min((spent / cap) * 100, 100)
  return {
    series: [{
      type: 'gauge', radius: '85%', center: ['50%', '55%'],
      startAngle: 210, endAngle: -30,
      min: 0, max: cap.toFixed(1),
      splitNumber: 5,
      axisLine: { lineStyle: { width: 14, color: [[pct/100, '#409eff'], [1, '#f1f5f9']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { length: '65%', width: 6, itemStyle: { color: '#1e293b' } },
      detail: { offsetCenter: [0, '65%'], valueAnimation: true, formatter: '{value} 点', fontSize: 14, fontWeight: 700, color: '#1e293b' },
      data: [{ value: parseFloat(spent.toFixed(2)) }]
    }]
  }
})

// ============ 球型 2: Token 水球 ============
const tokenLiquidOption = computed(() => {
  const t = totalTokens.value
  const max = Math.max(t * 1.2, 10000)
  const pct = Math.min(t / max, 1)
  return {
    series: [{
      type: 'liquidFill', radius: '75%', center: ['50%', '50%'],
      data: [pct, pct * 0.9, pct * 0.8],
      color: [{ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22c55e' }, { offset: 1, color: '#16a34a' }] }],
      backgroundStyle: { color: '#f1f5f9' },
      outline: { show: false },
      label: { formatter: () => { const v = totalTokens.value; return (v>=1e6?(v/1e6).toFixed(1)+'M Token':v>=1000?(v/1000).toFixed(1)+'K Token':v+' Token') }, fontSize: 14, fontWeight: 700, color: '#1e293b' },
      shape: 'circle', waveAnimation: true, animationDuration: 3000, animationDurationUpdate: 1000
    }]
  }
})

// ============ 球型 3: 费用分布 3D 环形 ============
const modelPie3DOption = computed(() => {
  const top = stats.value.model_usage?.slice(0, 6) || []
  const colors = ['#409eff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 点', confine: true },
    series: [{
      type: 'pie', radius: ['45%', '75%'], center: ['50%', '50%'],
      avoidLabelOverlap: false, itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 3 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' }, scaleSize: 8 },
      data: top.map((m, i) => ({ name: m.model_code, value: m.cost, itemStyle: { color: colors[i % colors.length] } }))
    }]
  }
})

// ============ 球型 4: 调用排行仪表盘 ============
const modelRankGaugeOption = computed(() => {
  const top = stats.value.model_usage?.slice(0, 8) || []
  const top1 = top[0]
  const total = top.reduce((s, m) => s + m.calls, 0) || 1
  const pct = top1 ? (top1.calls / total) * 100 : 0
  return {
    series: [{
      type: 'gauge', radius: '80%', center: ['50%', '55%'],
      startAngle: 210, endAngle: -30,
      min: 0, max: 100,
      axisLine: { lineStyle: { width: 16, color: [[pct/100, '#8b5cf6'], [1, '#f1f5f9']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { length: '60%', width: 6, itemStyle: { color: '#1e293b' } },
      detail: { offsetCenter: [0, '68%'], valueAnimation: true, formatter: `{value}%\n{a|${top1?.model_code||''}}`, rich: { value: { fontSize: 18, fontWeight: 800, color: '#8b5cf6' }, a: { fontSize: 10, color: '#64748b', padding: [3,0,0,0] } }, fontSize: 18, fontWeight: 800, color: '#8b5cf6' },
      data: [{ value: parseFloat(pct.toFixed(1)), name: 'TOP1 占比' }]
    }]
  }
})

function statusLabel(s) { const m = { success: '成功', failed: '失败', blocked: '拦截' }; return m[s] || s }
function billingDetail(row) { const unit=row.official_unit_tokens||1000000;const c=row.official_currency==='USD'?'$':'¥';const cached=Math.min(row.cached_input_tokens||0,row.input_tokens||0);const uncached=Math.max(0,(row.input_tokens||0)-cached);const fx=row.official_currency==='USD'?` × 汇率 ${row.usd_cny_rate}`:'';const cachePart=cached?` + ${cached}÷${unit}×${c}${row.official_cached_input_price}`:'';return `本次扣 ${Number(row.total_cost||0).toFixed(6)} 点 = [(${uncached}÷${unit}×${c}${row.official_input_price}${cachePart})×${row.billing_multiplier_input} + (${row.output_tokens||0}÷${unit}×${c}${row.official_output_price})×${row.billing_multiplier_output}]${fx}；1点=¥1` }
function getPresetRange(preset) { const end = dayjs().format('YYYY-MM-DD'); const start = dayjs().subtract(preset === '30d' ? 29 : preset === '90d' ? 89 : 6, 'day').format('YYYY-MM-DD'); return [start, end] }

async function fetchAll() {
  loading.value = true
  try {
    const [modelsRes, statsRes, dailyRes, logsRes] = await Promise.all([api.get('/api/user/models'),api.get('/api/user/stats'),api.get('/api/user/stats/daily',{params:{start_date:dateRange.value[0],end_date:dateRange.value[1]}}),api.get('/api/user/logs',{params:{limit:10,model:filterModel.value||undefined}})])
    modelList.value=modelsRes.data.data||[];stats.value=statsRes.data;dailyData.value=dailyRes.data.data||[];recentLogs.value=logsRes.data.data||[]
  }catch(e){}
  loading.value=false
}
async function fetchLogs(){logLoading.value=true;try{const p={page:logPage.value,limit:20};if(logFilter.value.model)p.model=logFilter.value.model;if(logFilter.value.dateRange?.length===2){p.start_date=logFilter.value.dateRange[0];p.end_date=logFilter.value.dateRange[1]}const r=await api.get('/api/user/logs',{params:p});allLogs.value=r.data.data;logTotal.value=r.data.pagination.total}catch(e){}logLoading.value=false}
function onPresetChange(val){if(val!=='custom'){dateRange.value=getPresetRange(val);fetchAll()}}
function onCustomChange(val){if(val?.length===2){dateRange.value=val;fetchAll()}}
function toggleAutoRefresh(){autoRefresh.value=!autoRefresh.value;if(autoRefresh.value){refreshTimer=setInterval(fetchAll,5000)}else{clearInterval(refreshTimer)}}
onMounted(()=>{dateRange.value=getPresetRange('7d');fetchAll()})
onUnmounted(()=>{clearInterval(refreshTimer)})
</script>

<style scoped>
.dashboard { padding: 20px 24px; max-width: 1400px; margin: 0 auto }
.kpi-row { margin-bottom: 16px }
.kpi-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px 24px; display: flex; align-items: center; gap: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: box-shadow .2s; }
.kpi-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.06) }
.kpi-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0 }
.kpi-body { flex: 1; min-width: 0 }
.kpi-label { font-size: 12px; color: #64748b; margin-bottom: 4px; font-weight: 500; text-transform: uppercase }
.kpi-value { font-size: 24px; font-weight: 700; color: #0f172a; white-space: nowrap }
.filter-bar { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 20px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04) }
.filter-left { display: flex; align-items: center; flex-wrap: wrap; gap: 8px }
.charts-row { margin-bottom: 16px }
.chart-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04) }
.chart-header { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; font-size: 14px; font-weight: 600; color: #0f172a }
.chart-sub { font-size: 12px; color: #64748b; margin-left: auto }
.chart-body { padding: 8px 12px 8px 12px }
.detail-link { color: #409eff; cursor: help; font-size: 12px; }
.chart-sphere { display: flex; align-items: center; justify-content: center; min-height: 240px }
</style>
