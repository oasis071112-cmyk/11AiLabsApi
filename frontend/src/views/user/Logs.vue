<template>
<div class="dashboard">
  <!-- ============ KPI 卡片行 ============ -->
  <el-row :gutter="20" class="kpi-row">
    <el-col :span="6">
      <div class="kpi-card">
        <div class="kpi-icon" style="background:linear-gradient(135deg,#409eff,#3370ff)"><el-icon size="20"><Money/></el-icon></div>
        <div class="kpi-body"><div class="kpi-label">今日消费</div><div class="kpi-value">¥{{ stats.today_consumption?.toFixed(4)||'0.00' }}</div></div>
      </div>
    </el-col>
    <el-col :span="6">
      <div class="kpi-card">
        <div class="kpi-icon" style="background:linear-gradient(135deg,#67c23a,#529b2e)"><el-icon size="20"><TrendCharts/></el-icon></div>
        <div class="kpi-body"><div class="kpi-label">今日调用</div><div class="kpi-value">{{ (stats.today_calls||0).toLocaleString() }}</div></div>
      </div>
    </el-col>
    <el-col :span="6">
      <div class="kpi-card">
        <div class="kpi-icon" style="background:linear-gradient(135deg,#e6a23c,#cf9236)"><el-icon size="20"><Coin/></el-icon></div>
        <div class="kpi-body"><div class="kpi-label">累计消费</div><div class="kpi-value">¥{{ stats.total_consumption?.toFixed(2)||'0.00' }}</div></div>
      </div>
    </el-col>
    <el-col :span="6">
      <div class="kpi-card">
        <div class="kpi-icon" style="background:linear-gradient(135deg,#f56c6c,#d94f4f)"><el-icon size="20"><CircleCheck/></el-icon></div>
        <div class="kpi-body"><div class="kpi-label">成功率</div><div class="kpi-value">{{ successRate }}%</div></div>
      </div>
    </el-col>
  </el-row>

  <!-- ============ 筛选栏 ============ -->
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
      <el-button size="small" :icon="Refresh" @click="fetchAll">刷新</el-button>
    </div>
  </div>

  <!-- ============ 2x2 图表卡片区 ============ -->
  <el-row :gutter="20" class="charts-row">
    <el-col :span="12">
      <div class="chart-card">
        <div class="chart-header"><h3>📈 消费趋势</h3><span class="chart-sub">¥</span></div>
        <div class="chart-body">
          <v-chart :option="costTrendOption" autoresize style="height:280px" v-if="dailyData.length"/>
          <el-empty v-else description="暂无数据" :image-size="60" style="padding:60px 0"/>
        </div>
      </div>
    </el-col>
    <el-col :span="12">
      <div class="chart-card">
        <div class="chart-header"><h3>🔢 Token 消耗趋势</h3><span class="chart-sub">输入 / 输出</span></div>
        <div class="chart-body">
          <v-chart :option="tokenTrendOption" autoresize style="height:280px" v-if="dailyData.length"/>
          <el-empty v-else description="暂无数据" :image-size="60" style="padding:60px 0"/>
        </div>
      </div>
    </el-col>
    <el-col :span="12">
      <div class="chart-card">
        <div class="chart-header"><h3>🥧 模型费用分布</h3><span class="chart-sub">累计消费占比</span></div>
        <div class="chart-body">
          <v-chart :option="modelPieOption" autoresize style="height:280px" v-if="stats.model_usage?.length"/>
          <el-empty v-else description="暂无数据" :image-size="60" style="padding:60px 0"/>
        </div>
      </div>
    </el-col>
    <el-col :span="12">
      <div class="chart-card">
        <div class="chart-header"><h3>📊 模型调用排行</h3><span class="chart-sub">调用次数 TOP10</span></div>
        <div class="chart-body">
          <v-chart :option="modelBarOption" autoresize style="height:280px" v-if="stats.model_usage?.length"/>
          <el-empty v-else description="暂无数据" :image-size="60" style="padding:60px 0"/>
        </div>
      </div>
    </el-col>
  </el-row>

  <!-- ============ 调用明细表 ============ -->
  <div class="chart-card" style="margin-top:0">
    <div class="chart-header"><h3>📋 最近调用记录</h3><span class="chart-sub" style="cursor:pointer;color:#409eff" @click="showAllLogs=true">查看全部 →</span></div>
    <div class="chart-body" style="padding-top:0">
      <el-table :data="recentLogs" stripe size="small" v-loading="loading">
        <el-table-column prop="created_at" label="时间" width="170"/>
        <el-table-column prop="model_code" label="模型" width="130">
          <template #default="{row}"><el-tag size="small" effect="plain">{{ row.model_code }}</el-tag></template>
        </el-table-column>
        <el-table-column label="输入Token" width="100" align="right">
          <template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template>
        </el-table-column>
        <el-table-column label="输出Token" width="100" align="right">
          <template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template>
        </el-table-column>
        <el-table-column label="费用" width="110" align="right">
          <template #default="{row}">¥{{ row.total_cost?.toFixed(6)||'0' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{row}">
            <el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="error_message" label="备注" min-width="140" show-overflow-tooltip/>
      </el-table>
    </div>
  </div>

  <!-- ============ 全部日志弹窗 ============ -->
  <el-dialog v-model="showAllLogs" title="全部调用记录" width="90%" top="3vh" destroy-on-close>
    <div style="margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap">
      <el-select v-model="logFilter.model" clearable placeholder="模型" size="small" style="width:150px" @change="fetchLogs">
        <el-option v-for="m in modelList" :key="m.model_code" :label="m.model_code" :value="m.model_code"/>
      </el-select>
      <el-date-picker v-model="logFilter.dateRange" type="daterange" range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" @change="fetchLogs"/>
      <el-button size="small" @click="fetchLogs">查询</el-button>
    </div>
    <el-table :data="allLogs" stripe size="small" v-loading="logLoading" max-height="60vh">
      <el-table-column prop="created_at" label="时间" width="170"/>
      <el-table-column prop="request_id" label="请求ID" width="180" show-overflow-tooltip/>
      <el-table-column prop="model_code" label="模型" width="130"/>
      <el-table-column label="输入Token" width="100" align="right">
        <template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template>
      </el-table-column>
      <el-table-column label="输出Token" width="100" align="right">
        <template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template>
      </el-table-column>
      <el-table-column label="费用" width="110" align="right">
        <template #default="{row}">¥{{ row.total_cost?.toFixed(6)||'0' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{row}">
          <el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="error_message" label="错误信息" min-width="160" show-overflow-tooltip/>
    </el-table>
    <el-pagination v-model:current-page="logPage" :page-size="20" :total="logTotal" layout="prev,pager,next" @current-change="fetchLogs" style="margin-top:16px;justify-content:center" small/>
  </el-dialog>
</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Money, TrendCharts, Coin, CircleCheck, Refresh } from '@element-plus/icons-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import api from '@/api'
import dayjs from 'dayjs'

use([CanvasRenderer, LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent])

// ============ 数据 ============
const stats = ref({})
const modelList = ref([])
const dailyData = ref([])
const recentLogs = ref([])
const loading = ref(false)

// 筛选
const datePreset = ref('7d')
const customRange = ref([])
const filterModel = ref('')
const dateRange = ref([])

// 全部日志弹窗
const showAllLogs = ref(false)
const allLogs = ref([])
const logLoading = ref(false)
const logPage = ref(1)
const logTotal = ref(0)
const logFilter = ref({ model: '', dateRange: [] })

// ============ 计算 ============
const successRate = computed(() => {
  if (!stats.value.today_calls) return '0.0'
  const success = stats.value.today_status?.find(s => s.status === 'success')?.count || 0
  return ((success / stats.value.today_calls) * 100).toFixed(1)
})

// ============ 图表配置 ============
const costTrendOption = computed(() => ({
  tooltip: { trigger: 'axis', formatter: p => `${p[0].axisValue}<br/>消费: ¥${p[0].value.toFixed(6)}` },
  grid: { left: 10, right: 20, top: 10, bottom: 0, containLabel: true },
  xAxis: { type: 'category', data: dailyData.value.map(d => d.date), axisLabel: { formatter: v => v.slice(5) }, axisLine: { lineStyle: { color: '#e4e7ed' } } },
  yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { formatter: v => '¥'+v.toFixed(4) } },
  series: [{ type: 'line', data: dailyData.value.map(d => d.cost), smooth: true, symbol: 'circle', symbolSize: 6, itemStyle: { color: '#409eff' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(64,158,255,0.25)' }, { offset: 1, color: 'rgba(64,158,255,0.02)' }] } } }]
}))

const tokenTrendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['输入Token', '输出Token'], right: 0, top: 0, textStyle: { fontSize: 12 } },
  grid: { left: 10, right: 20, top: 30, bottom: 0, containLabel: true },
  xAxis: { type: 'category', data: dailyData.value.map(d => d.date), axisLabel: { formatter: v => v.slice(5) }, axisLine: { lineStyle: { color: '#e4e7ed' } } },
  yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { formatter: v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v } },
  series: [
    { name: '输入Token', type: 'line', data: dailyData.value.map(d => d.input_tokens), smooth: true, symbol: 'none', itemStyle: { color: '#67c23a' }, lineStyle: { width: 2 } },
    { name: '输出Token', type: 'line', data: dailyData.value.map(d => d.output_tokens), smooth: true, symbol: 'none', itemStyle: { color: '#409eff' }, lineStyle: { width: 2 } }
  ]
}))

const modelPieOption = computed(() => {
  const top = stats.value.model_usage?.slice(0, 8) || []
  return {
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c}' },
    legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'center', textStyle: { fontSize: 11 }, itemWidth: 8, itemHeight: 8 },
    series: [{
      type: 'pie', radius: ['50%', '75%'], center: ['40%', '50%'], avoidLabelOverlap: false,
      label: { show: false }, emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
      data: top.map(m => ({ name: m.model_code, value: m.cost }))
    }]
  }
})

const modelBarOption = computed(() => {
  const top = stats.value.model_usage?.slice(0, 10) || []
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 10, right: 20, top: 10, bottom: 0, containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } } },
    yAxis: { type: 'category', data: top.map(m => m.model_code).reverse(), axisLabel: { fontSize: 11 }, axisLine: { lineStyle: { color: '#e4e7ed' } } },
    series: [{
      type: 'bar', data: top.map(m => m.calls).reverse(), barWidth: 14,
      itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#409eff' }, { offset: 1, color: '#79bbff' }] } }
    }]
  }
})

// ============ 工具函数 ============
function statusLabel(s) { const m = { success: '成功', failed: '失败', blocked: '拦截' }; return m[s] || s }
function getPresetRange(preset) {
  const end = dayjs().format('YYYY-MM-DD')
  const start = dayjs().subtract(preset === '30d' ? 29 : preset === '90d' ? 89 : 6, 'day').format('YYYY-MM-DD')
  return [start, end]
}

// ============ 数据加载 ============
async function fetchAll() {
  loading.value = true
  try {
    const [modelsRes, statsRes, dailyRes, logsRes] = await Promise.all([
      api.get('/api/user/models'),
      api.get('/api/user/stats'),
      api.get('/api/user/stats/daily', { params: { start_date: dateRange.value[0], end_date: dateRange.value[1] } }),
      api.get('/api/user/logs', { params: { limit: 10, model: filterModel.value || undefined } })
    ])
    modelList.value = modelsRes.data.data || []
    stats.value = statsRes.data
    dailyData.value = dailyRes.data.data || []
    recentLogs.value = logsRes.data.data || []
  } catch (e) { /* silent */ }
  loading.value = false
}

async function fetchLogs() {
  logLoading.value = true
  try {
    const p = { page: logPage.value, limit: 20 }
    if (logFilter.value.model) p.model = logFilter.value.model
    if (logFilter.value.dateRange?.length === 2) { p.start_date = logFilter.value.dateRange[0]; p.end_date = logFilter.value.dateRange[1] }
    const r = await api.get('/api/user/logs', { params: p })
    allLogs.value = r.data.data
    logTotal.value = r.data.pagination.total
  } catch (e) { /* silent */ }
  logLoading.value = false
}

function onPresetChange(val) {
  if (val !== 'custom') { dateRange.value = getPresetRange(val); fetchAll() }
}
function onCustomChange(val) {
  if (val?.length === 2) { dateRange.value = val; fetchAll() }
}

onMounted(() => {
  dateRange.value = getPresetRange('7d')
  fetchAll()
})
</script>

<style scoped>
.dashboard { padding: 20px 24px; max-width: 1400px; margin: 0 auto }
/* KPI 卡片 */
.kpi-row { margin-bottom: 16px }
.kpi-card {
  background: #fff; border-radius: 10px; padding: 20px 24px; display: flex; align-items: center; gap: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: box-shadow .2s, transform .2s; cursor: default;
}
.kpi-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-1px) }
.kpi-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0 }
.kpi-body { flex: 1; min-width: 0 }
.kpi-label { font-size: 13px; color: #909399; margin-bottom: 4px }
.kpi-value { font-size: 24px; font-weight: 700; color: #303133; white-space: nowrap }

/* 筛选栏 */
.filter-bar {
  background: #fff; border-radius: 10px; padding: 12px 20px; margin-bottom: 16px;
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04)
}
.filter-left { display: flex; align-items: center; flex-wrap: wrap; gap: 8px }

/* 图表卡片 */
.charts-row { margin-bottom: 16px }
.chart-card {
  background: #fff; border-radius: 10px; overflow: hidden; margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04)
}
.chart-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 0 20px
}
.chart-header h3 { font-size: 15px; font-weight: 600; color: #303133; margin: 0 }
.chart-sub { font-size: 12px; color: #909399 }
.chart-body { padding: 8px 12px 4px 4px }
</style>