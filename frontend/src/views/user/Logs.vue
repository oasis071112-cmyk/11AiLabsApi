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

  <div v-if="!chartsReady" class="charts-loading">调用分析加载中…</div>
  <UsageCharts v-else :stats="stats" :daily-data="dailyData"/>

  <!-- 调用明细表 -->
  <div class="chart-card" style="margin-top:0">
    <div class="chart-header"><ClipboardList :size="14" color="#6366f1"/><span>最近调用记录</span><span class="chart-sub" style="cursor:pointer;color:#409eff" @click="openAllLogs">查看全部 →</span></div>
    <div class="chart-body" style="padding-top:0">
      <el-table class="desktop-log-table" :data="recentLogs" stripe size="small" v-loading="loading">
        <el-table-column label="时间" width="170"><template #default="{row}">{{ formatBeijingTime(row.created_at) }}</template></el-table-column>
        <el-table-column prop="model_code" label="模型" width="130"><template #default="{row}"><el-tag size="small" effect="plain">{{ row.model_code }}</el-tag></template></el-table-column>
        <el-table-column label="输入Token" width="100" align="right"><template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template></el-table-column>
        <el-table-column label="输出Token" width="100" align="right"><template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template></el-table-column>
        <el-table-column label="费用" width="110" align="right"><template #default="{row}">{{ row.total_cost?.toFixed(6)||'0' }} 点</template></el-table-column>
        <el-table-column label="计费明细" width="130"><template #default="{row}"><el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="openBilling(row)">查看计算过程</el-button><span v-else class="no-detail">历史记录无快照</span></template></el-table-column>
        <el-table-column label="状态" width="80" align="center"><template #default="{row}"><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="error_message" label="备注" min-width="140" show-overflow-tooltip/>
      </el-table>
      <div class="mobile-log-list" v-loading="loading">
        <article v-for="row in recentLogs" :key="row.id||row.request_id" class="mobile-log-card">
          <div class="mobile-log-head"><el-tag size="small" effect="plain">{{ row.model_code }}</el-tag><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></div>
          <div class="mobile-log-time">{{ formatBeijingTime(row.created_at) }}</div>
          <div class="mobile-log-usage"><span>输入 <strong>{{ number(row.input_tokens) }}</strong></span><span>输出 <strong>{{ number(row.output_tokens) }}</strong></span><span>扣费 <strong>{{ point(row.total_cost) }} 点</strong></span></div>
          <el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="openBilling(row)">查看扣费计算过程</el-button>
          <span v-else class="no-detail">历史记录无快照</span>
        </article>
        <el-empty v-if="!loading&&!recentLogs.length" description="暂无调用记录" :image-size="50"/>
      </div>
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
      <el-table-column label="时间" width="170"><template #default="{row}">{{ formatBeijingTime(row.created_at) }}</template></el-table-column>
      <el-table-column prop="request_id" label="请求ID" width="180" show-overflow-tooltip/>
      <el-table-column prop="model_code" label="模型" width="130"/>
      <el-table-column label="输入Token" width="100" align="right"><template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template></el-table-column>
      <el-table-column label="输出Token" width="100" align="right"><template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template></el-table-column>
      <el-table-column label="费用" width="110" align="right"><template #default="{row}">{{ row.total_cost?.toFixed(6)||'0' }} 点</template></el-table-column>
      <el-table-column label="计费明细" width="130"><template #default="{row}"><el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="openBilling(row)">查看计算过程</el-button><span v-else class="no-detail">历史记录无快照</span></template></el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{row}"><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column prop="error_message" label="错误信息" min-width="160" show-overflow-tooltip/>
    </el-table>
    <el-pagination v-model:current-page="logPage" :page-size="20" :total="logTotal" layout="prev,pager,next" @current-change="fetchLogs" style="margin-top:16px;justify-content:center" small/>
  </el-dialog>

  <el-dialog v-model="billingDialog" title="计费明细" width="680px" top="8vh">
    <div v-if="selectedBilling" class="billing-dialog">
      <div class="billing-summary">
        <div><span>模型</span><strong>{{ selectedBilling.model_code }}</strong></div>
        <div><span>请求时间</span><strong>{{ formatBeijingTime(selectedBilling.created_at) }}</strong></div>
        <div class="billing-total"><span>本次实际扣费</span><strong>{{ point(selectedBilling.total_cost) }} 点</strong></div>
      </div>
      <el-alert v-if="!hasBillingDetail(selectedBilling)" title="这条记录暂时没有可展示的计费数据" type="warning" :closable="false"/>
      <template v-else>
        <el-alert v-if="selectedBilling.billing_detail.mode==='legacy_zero'" title="本次历史调用实际扣费为 0 点，不会按当前价格追溯补扣" type="warning" :closable="false" show-icon class="legacy-alert"/>
        <div class="snapshot-title">{{ billingTitle }}</div>
        <div class="snapshot-grid">
          <div><span>计费版本</span><strong>{{ billingVersion }}</strong></div>
          <div><span>计费币种</span><strong>{{ selectedBilling.billing_detail.currency||'点数' }}</strong></div>
          <div><span>计费单位</span><strong>{{ formatTokenUnit(selectedBilling.billing_detail.dimensions.find(item=>!item.isAdjustment)?.unitTokens||1000000) }} Token</strong></div>
          <div><span>输入倍率</span><strong>×{{ selectedBilling.billing_multiplier_input }}</strong></div>
          <div><span>输出倍率</span><strong>×{{ selectedBilling.billing_multiplier_output }}</strong></div>
          <div v-if="selectedBilling.official_currency==='USD'"><span>美元兑人民币</span><strong>×{{ selectedBilling.usd_cny_rate }}</strong></div>
        </div>
        <div class="breakdown-title">逐项计算</div>
        <div class="breakdown-list">
          <div v-for="item in billingBreakdown" :key="item.label" class="breakdown-item">
            <div class="breakdown-head"><span>{{ item.label }}</span><strong>{{ point(item.amount) }} 点</strong></div>
            <code>{{ item.formula }}</code>
          </div>
        </div>
        <div class="billing-result"><span>各项费用相加</span><strong>{{ billingSum }} 点</strong><span class="equals">调用记录实际扣除 {{ point(selectedBilling.total_cost) }} 点</span></div>
        <div class="billing-note">{{ selectedBilling.billing_detail.notice }} 1 点 = ¥1。</div>
      </template>
    </div>
    <template #footer><el-button type="primary" @click="billingDialog=false">知道了</el-button></template>
  </el-dialog>
</div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { DollarSign, Activity, Coins, Target, ClipboardList, RefreshCw } from '@lucide/vue'
import api from '@/api'
import dayjs from 'dayjs'
import { formatBeijingTime } from '@/utils/time'

const UsageCharts=defineAsyncComponent(()=>import('@/components/logs/UsageCharts.vue'))

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
const billingDialog = ref(false)
const selectedBilling = ref(null)
const autoRefresh = ref(false)
const chartsReady = ref(false)
let refreshTimer = null

const successRate = computed(() => {
  if (!stats.value.today_calls) return '0.0'
  const success = stats.value.today_status?.find(s => s.status === 'success')?.count || 0
  return ((success / stats.value.today_calls) * 100).toFixed(1)
})

const totalTokens = computed(() => (stats.value.input_tokens || 0) + (stats.value.output_tokens || 0))

const billingBreakdown = computed(() => {
  const row = selectedBilling.value
  if (!hasBillingDetail(row)) return []
  const currency = row.billing_detail.currency
  const symbol = currency==='USD'?'$':currency==='CNY'?'¥':''
  return row.billing_detail.dimensions.map(item=>{
    if(item.isAdjustment)return {...item,formula:'用于对齐钱包最终保存的实际扣费金额'}
    const multiplierLabel=item.label.includes('输出')?'输出倍率':'输入倍率'
    const fx=currency==='USD'?` × 汇率 ${item.fxRate}`:''
    return {...item,formula:`${number(item.usage)} ÷ ${formatTokenUnit(item.unitTokens)} × ${symbol}${item.unitPrice} × ${multiplierLabel} ${item.multiplier}${fx}`}
  })
})
const billingSum = computed(() => point(selectedBilling.value?.billing_detail?.calculatedTotal||0))
const billingTitle = computed(()=>({snapshot:'本次调用采用的价格快照',legacy_zero:'历史 0 扣费计算过程',legacy:'旧版计费计算过程'}[selectedBilling.value?.billing_detail?.mode]||'计费计算过程'))
const billingVersion = computed(()=>({snapshot:'调用时官方价格',legacy_zero:'历史实际 0 扣费',legacy:'旧版价格'}[selectedBilling.value?.billing_detail?.mode]||'未知'))

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
function openBilling(row){selectedBilling.value=row;billingDialog.value=true}
function openAllLogs(){showAllLogs.value=true;fetchLogs()}
function hasBillingDetail(row){return Boolean(row?.billing_detail)}
function number(value){return Number(value||0).toLocaleString()}
function formatTokenUnit(value){return Number(value)===1000000?'1M':number(value)}
function point(value){return Number(value||0).toFixed(6)}
function getPresetRange(preset) { const end = dayjs().format('YYYY-MM-DD'); const start = dayjs().subtract(preset === '30d' ? 29 : preset === '90d' ? 89 : 6, 'day').format('YYYY-MM-DD'); return [start, end] }

async function fetchAll() {
  loading.value = true
  const results=await Promise.allSettled([
    api.get('/api/user/models'),
    api.get('/api/user/stats'),
    api.get('/api/user/stats/daily',{params:{start_date:dateRange.value[0],end_date:dateRange.value[1]}}),
    api.get('/api/user/logs',{params:{limit:10,model:filterModel.value||undefined}}),
  ])
  if(results[0].status==='fulfilled')modelList.value=results[0].value.data.data||[]
  if(results[1].status==='fulfilled')stats.value=results[1].value.data||{}
  if(results[2].status==='fulfilled')dailyData.value=results[2].value.data.data||[]
  if(results[3].status==='fulfilled')recentLogs.value=results[3].value.data.data||[]
  loading.value=false
  scheduleCharts()
}
async function fetchLogs(){logLoading.value=true;try{const p={page:logPage.value,limit:20};if(logFilter.value.model)p.model=logFilter.value.model;if(logFilter.value.dateRange?.length===2){p.start_date=logFilter.value.dateRange[0];p.end_date=logFilter.value.dateRange[1]}const r=await api.get('/api/user/logs',{params:p});allLogs.value=r.data.data;logTotal.value=r.data.pagination.total}catch(e){}logLoading.value=false}
function onPresetChange(val){if(val!=='custom'){dateRange.value=getPresetRange(val);fetchAll()}}
function onCustomChange(val){if(val?.length===2){dateRange.value=val;fetchAll()}}
function toggleAutoRefresh(){autoRefresh.value=!autoRefresh.value;if(autoRefresh.value){refreshTimer=setInterval(fetchAll,5000)}else{clearInterval(refreshTimer)}}
function scheduleCharts(){
  if(chartsReady.value)return
  const show=()=>{chartsReady.value=true}
  if('requestIdleCallback' in window)window.requestIdleCallback(show,{timeout:800})
  else window.setTimeout(show,80)
}
onMounted(()=>{dateRange.value=getPresetRange('7d');fetchAll()})
onUnmounted(()=>{clearInterval(refreshTimer)})
</script>

<style scoped>
.dashboard { padding: 20px 24px; max-width: 1400px; margin: 0 auto }
.billing-detail-button { font-weight: 650; --el-button-hover-bg-color: #1d4ed8; --el-button-hover-border-color: #1d4ed8; }
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
.no-detail { color: #94a3b8; font-size: 11px; }
.chart-sphere { display: flex; align-items: center; justify-content: center; min-height: 240px }
.charts-loading{height:84px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;color:#64748b;margin-bottom:16px}.mobile-log-list{display:none}.mobile-log-card{border:1px solid #e2e8f0;border-radius:12px;padding:13px;background:#fff}.mobile-log-head{display:flex;justify-content:space-between;gap:8px}.mobile-log-time{font-size:11px;color:#94a3b8;margin:7px 0}.mobile-log-usage{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}.mobile-log-usage span{background:#f8fafc;border-radius:8px;padding:7px;font-size:11px;color:#64748b}.mobile-log-usage span:last-child{grid-column:1/-1}.mobile-log-usage strong{display:block;color:#0f172a;font-size:12px}.mobile-log-card .billing-detail-button{width:100%}
.billing-summary{display:grid;grid-template-columns:1fr 1.3fr 1fr;gap:10px;margin-bottom:18px}.billing-summary>div,.snapshot-grid>div{background:#f8fafc;border-radius:9px;padding:11px 12px}.billing-summary span,.snapshot-grid span{display:block;font-size:11px;color:#94a3b8;margin-bottom:4px}.billing-summary strong,.snapshot-grid strong{color:#0f172a;font-size:13px}.billing-total{background:#eff6ff!important}.billing-total strong{color:#2563eb!important;font-size:16px!important}.snapshot-title,.breakdown-title{font-size:13px;font-weight:650;color:#334155;margin:16px 0 9px}.snapshot-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.breakdown-list{display:grid;gap:9px}.breakdown-item{border:1px solid #e2e8f0;border-radius:9px;padding:11px 13px}.breakdown-head{display:flex;justify-content:space-between;margin-bottom:7px;color:#334155}.breakdown-head strong{color:#2563eb}.breakdown-item code{display:block;background:#f8fafc;color:#475569;padding:8px;border-radius:6px;font-size:12px;white-space:normal;line-height:1.6}.billing-result{display:flex;align-items:center;gap:12px;background:#0f172a;color:#fff;border-radius:9px;padding:13px 15px;margin-top:12px}.billing-result strong{font-size:17px;color:#93c5fd}.billing-result .equals{margin-left:auto;color:#cbd5e1;font-size:12px}.billing-note{font-size:11px;color:#94a3b8;margin-top:9px}
@media(max-width:768px){.kpi-card{padding:14px 16px}.filter-bar{padding:12px 14px}.filter-left{width:100%}.filter-left>*{max-width:100%}.charts-row{margin-bottom:4px}.chart-card{margin-bottom:12px}.chart-body{overflow-x:auto}.desktop-log-table{display:none}.mobile-log-list{display:grid;gap:10px;padding:10px 0}.chart-sphere{min-height:210px}.chart-sphere>div{height:210px!important}.billing-summary{grid-template-columns:1fr}.snapshot-grid{grid-template-columns:1fr 1fr}.billing-result{align-items:flex-start;flex-direction:column;gap:4px}.billing-result .equals{margin-left:0}.breakdown-item code{overflow-wrap:anywhere}.chart-header{padding:12px}.chart-sub{white-space:nowrap}}
</style>
