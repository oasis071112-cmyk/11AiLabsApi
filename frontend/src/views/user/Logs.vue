<template>
<div class="dashboard">
  <!-- KPI 卡片行 -->
  <el-row :gutter="20" class="kpi-row">
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#409eff"><DollarSign :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">今日消费</div><div class="kpi-value">{{ decimal(stats.today_consumption,4) }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#22c55e"><Activity :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">今日调用</div><div class="kpi-value">{{ (stats.today_calls||0).toLocaleString() }}</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#f59e0b"><Coins :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">累计消费</div><div class="kpi-value">{{ decimal(stats.total_consumption,2) }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#ef4444"><Target :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">成功率</div><div class="kpi-value">{{ successRate }}%</div></div></div></el-col>
  </el-row>

  <!-- 筛选栏 -->
  <div class="filter-bar">
    <div class="filter-left">
      <el-radio-group v-model="datePreset" @change="onPresetChange" size="small">
        <el-radio-button value="1d">近1天</el-radio-button>
        <el-radio-button value="7d">近7天</el-radio-button>
        <el-radio-button value="30d">近30天</el-radio-button>
        <el-radio-button value="custom">自定义</el-radio-button>
      </el-radio-group>
      <el-date-picker v-if="datePreset==='custom'&&!isMobile" v-model="customRange" type="daterange" value-format="YYYY-MM-DD" range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" @change="onCustomChange" class="custom-range"/>
      <div v-if="datePreset==='custom'&&isMobile" class="mobile-date-range"><input v-model="customRange[0]" class="mobile-date-input" type="date" aria-label="开始日期" @change="onCustomChange(customRange)"/><input v-model="customRange[1]" class="mobile-date-input" type="date" aria-label="结束日期" @change="onCustomChange(customRange)"/></div>
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
        <el-table-column label="计费方式" width="110"><template #default="{row}"><el-tag :type="billingModeType(row.billing_mode)" size="small">{{ billingModeLabel(row) }}</el-tag></template></el-table-column>
        <el-table-column label="输入Token" width="100" align="right"><template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template></el-table-column>
        <el-table-column label="输出Token" width="100" align="right"><template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template></el-table-column>
        <el-table-column label="费用" width="110" align="right"><template #default="{row}">{{ point(row.total_cost) }} 点</template></el-table-column>
        <el-table-column label="计费明细" width="130"><template #default="{row}"><el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="openBilling(row)">查看计算过程</el-button><span v-else class="no-detail">历史记录无快照</span></template></el-table-column>
        <el-table-column label="状态" width="80" align="center"><template #default="{row}"><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="error_message" label="备注" min-width="140" show-overflow-tooltip/>
      </el-table>
      <div class="mobile-log-list" v-loading="loading">
        <article v-for="row in recentLogs" :key="row.id||row.request_id" class="mobile-log-card">
          <div class="mobile-log-head"><div><el-tag size="small" effect="plain">{{ row.model_code }}</el-tag><el-tag v-if="row.billing_mode==='image'" size="small" type="warning">图片 {{ row.image_count }} 张</el-tag></div><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></div>
          <div class="mobile-log-time">{{ formatBeijingTime(row.created_at) }}</div>
          <div class="mobile-log-usage"><span>输入 <strong>{{ number(row.input_tokens) }}</strong></span><span>输出 <strong>{{ number(row.output_tokens) }}</strong></span><span>扣费 <strong>{{ point(row.total_cost) }} 点</strong></span></div>
          <el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="openBilling(row)">查看扣费计算过程</el-button>
          <span v-else class="no-detail">历史记录无快照</span>
        </article>
        <el-empty v-if="!loading&&!recentLogs.length" description="暂无调用记录" :image-size="50"/>
      </div>
    </div>
  </div>

  <AllLogsDialog v-if="showAllLogs" v-model="showAllLogs" :model-list="modelList" :is-mobile="isMobile" :initial-model="allLogsInitialModel" :initial-date-range="allLogsInitialRange" @open-billing="openBilling"/>
  <BillingDetailsDialog v-if="billingDialog" v-model="billingDialog" :billing="selectedBilling"/>
</div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import { DollarSign, Activity, Coins, Target, ClipboardList, RefreshCw } from '@lucide/vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import dayjs from 'dayjs'
import { formatBeijingDate, formatBeijingTime } from '@/utils/time'
import { createRequestCoordinator } from '@/utils/request-coordinator'
import { coldStartKeys, takeColdStartRequest } from '@/utils/cold-start-prefetch'
import UsageCharts from '@/components/logs/UsageCharts.vue'

const AllLogsDialog=defineAsyncComponent(()=>import('@/components/logs/AllLogsDialog.vue'))
const BillingDetailsDialog=defineAsyncComponent(()=>import('@/components/logs/BillingDetailsDialog.vue'))

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
const allLogsInitialModel = ref('')
const allLogsInitialRange = ref([])
const isMobile = ref(false)
const billingDialog = ref(false)
const selectedBilling = ref(null)
const autoRefresh = ref(false)
const chartsReady = ref(false)
let refreshTimer = null
let mobileMedia = null
const dashboardRequest = createRequestCoordinator()
const analyticsRequest = createRequestCoordinator()
function syncMobile(){isMobile.value=mobileMedia.matches}

const successRate = computed(() => {
  if (!stats.value.today_calls) return '0.0'
  const success = stats.value.today_status?.find(s => s.status === 'success')?.count || 0
  return ((success / stats.value.today_calls) * 100).toFixed(1)
})
const totalTokens = computed(() => (stats.value.input_tokens || 0) + (stats.value.output_tokens || 0))

function statusLabel(s) { const m = { success: '成功', failed: '失败', blocked: '拦截' }; return m[s] || s }
function billingModeType(mode){return mode==='image'?'warning':mode==='per_request'?'success':'info'}
function billingModeLabel(row){return row.billing_mode==='image'?`图片 ${row.image_count||0} 张`:row.billing_mode==='per_request'?'每请求':'Token'}
function openBilling(row){selectedBilling.value=row;billingDialog.value=true}
function openAllLogs(){allLogsInitialModel.value=filterModel.value;allLogsInitialRange.value=[...dateRange.value];showAllLogs.value=true}
function hasBillingDetail(row){return Array.isArray(row?.billing_detail?.dimensions)}
function number(value){return Number(value||0).toLocaleString()}
function point(value){return Number(value||0).toFixed(6)}
function decimal(value,digits=2){const parsed=Number(value);return Number.isFinite(parsed)?parsed.toFixed(digits):(0).toFixed(digits)}
function getPresetRange(preset) { const end = formatBeijingDate(); const start = dayjs(end).subtract(preset === '1d' ? 0 : preset === '30d' ? 29 : 6, 'day').format('YYYY-MM-DD'); return [start, end] }
function normalizeRange(range){return Array.isArray(range)?range.map(value=>value?dayjs(value).format('YYYY-MM-DD'):''):[]}
function validateRange(range, notify=true){const normalized=normalizeRange(range);let message='';if(normalized.length!==2||!normalized[0]||!normalized[1])message='请选择完整的开始和结束日期';else if(!dayjs(normalized[0],'YYYY-MM-DD',true).isValid()||!dayjs(normalized[1],'YYYY-MM-DD',true).isValid())message='日期格式无效';else if(dayjs(normalized[0]).isAfter(dayjs(normalized[1])))message='开始日期不能晚于结束日期';else if(dayjs(normalized[1]).diff(dayjs(normalized[0]),'day')+1>90)message='日期范围不能超过 90 个自然日';if(message&&notify)ElMessage.warning(message);return !message}

async function fetchAll() {
  const range=[...dateRange.value]
  const model=filterModel.value||undefined
  analyticsRequest.cancel()
  const request=dashboardRequest.run(`overview:${range.join(':')}:${model||''}`, (_signal, request) => Promise.allSettled([
    takeColdStartRequest(coldStartKeys.logsModels,()=>api.get('/api/user/models',{signal:request.signal})),
    takeColdStartRequest(coldStartKeys.logsOverview,()=>api.get('/api/user/logs/overview',{params:{limit:10,model,start_date:range[0],end_date:range[1]},signal:request.signal})),
  ]))
  loading.value = true
  try{
    const results=await request.promise
    if(!dashboardRequest.isCurrent(request))return
    if(results[0].status==='fulfilled')modelList.value=results[0].value.data.data||[]
    if(results[1].status==='fulfilled'){
      const overview=results[1].value.data||{}
      stats.value=overview.stats||overview.summary||{}
      recentLogs.value=overview.data||[]
      dailyData.value=overview.daily||[]
    }else{
      // 兼容旧后端；聚合接口切换完成后此分支可移除。
      const fallback=await Promise.allSettled([
        api.get('/api/user/stats',{signal:request.signal}),
        api.get('/api/user/logs',{params:{limit:10,model,start_date:range[0],end_date:range[1]},signal:request.signal}),
        api.get('/api/user/stats/daily',{params:{start_date:range[0],end_date:range[1]},signal:request.signal}),
      ])
      if(!dashboardRequest.isCurrent(request))return
      if(fallback[0].status==='fulfilled')stats.value=fallback[0].value.data||{}
      if(fallback[1].status==='fulfilled')recentLogs.value=fallback[1].value.data.data||[]
      if(fallback[2].status==='fulfilled')dailyData.value=fallback[2].value.data.data||[]
    }
    scheduleCharts()
  }catch(e){
    if(dashboardRequest.isCurrent(request))dailyData.value=[]
  }finally{
    if(dashboardRequest.isCurrent(request))loading.value=false
  }
}
function onPresetChange(val){if(val!=='custom'){dateRange.value=getPresetRange(val);customRange.value=[...dateRange.value];fetchAll()}else{customRange.value=[...dateRange.value]}}
function onCustomChange(val){const range=normalizeRange(val);if(validateRange(range)){customRange.value=range;dateRange.value=range;fetchAll()}}
function toggleAutoRefresh(){autoRefresh.value=!autoRefresh.value;if(autoRefresh.value){refreshTimer=setInterval(fetchAll,5000)}else{clearInterval(refreshTimer)}}
function scheduleCharts(){
  if(chartsReady.value)return
  const show=()=>{chartsReady.value=true}
  if('requestIdleCallback' in window)window.requestIdleCallback(show,{timeout:800})
  else window.setTimeout(show,80)
}
onMounted(()=>{mobileMedia=window.matchMedia('(max-width: 768px)');syncMobile();mobileMedia.addEventListener('change',syncMobile);dateRange.value=getPresetRange('7d');customRange.value=[...dateRange.value];fetchAll()})
onUnmounted(()=>{dashboardRequest.cancel();analyticsRequest.cancel();clearInterval(refreshTimer);mobileMedia?.removeEventListener('change',syncMobile)})
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
.custom-range{width:260px;margin-left:12px}.mobile-date-range{display:flex;gap:8px}
.charts-row { margin-bottom: 16px }
.chart-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.04) }
.chart-header { display: flex; align-items: center; gap: 8px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; font-size: 14px; font-weight: 600; color: #0f172a }
.chart-sub { font-size: 12px; color: #64748b; margin-left: auto }
.chart-body { padding: 8px 12px 8px 12px }
.no-detail { color: #94a3b8; font-size: 11px; }
.chart-sphere { display: flex; align-items: center; justify-content: center; min-height: 240px }
.charts-loading{height:84px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;color:#64748b;margin-bottom:16px}.analysis-empty-state{min-height:168px;margin-bottom:14px;padding:26px 30px;display:flex;align-items:center;gap:18px;background:#fff;border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-sm)}.analysis-empty-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:12px;background:#eef3ec;color:var(--primary-dark)}.analysis-empty-state h3{margin:0 0 5px;color:var(--text-primary);font-size:16px}.analysis-empty-state p{margin:0;color:var(--text-secondary);font-size:13px;line-height:1.65}.analysis-empty-action{margin-left:auto;flex:0 0 auto;padding:8px 12px;border-radius:8px;background:var(--primary);color:#fff;font-size:13px;font-weight:600;text-decoration:none}.mobile-log-list{display:none}.mobile-log-card{border:1px solid #e2e8f0;border-radius:12px;padding:13px;background:#fff}.mobile-log-head{display:flex;justify-content:space-between;gap:8px}.mobile-log-time{font-size:11px;color:#94a3b8;margin:7px 0}.mobile-log-usage{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}.mobile-log-usage span{background:#f8fafc;border-radius:8px;padding:7px;font-size:11px;color:#64748b}.mobile-log-usage span:last-child{grid-column:1/-1}.mobile-log-usage strong{display:block;color:#0f172a;font-size:12px}.mobile-log-card .billing-detail-button{width:100%}
@media(max-width:768px){
  .kpi-row{margin-left:0!important;margin-right:0!important;row-gap:0!important;overflow:hidden;border-radius:12px;margin-bottom:10px}
  .kpi-row>[class*="el-col-"]{flex:0 0 50%;max-width:50%;padding:0!important}
  .kpi-card{min-height:66px;padding:9px 10px;gap:8px;border-radius:0;box-shadow:none}
  .kpi-row>[class*="el-col-"]:nth-child(1) .kpi-card{border-radius:12px 0 0 0}
  .kpi-row>[class*="el-col-"]:nth-child(2) .kpi-card{border-radius:0 12px 0 0;margin-left:-1px}
  .kpi-row>[class*="el-col-"]:nth-child(3) .kpi-card{border-radius:0 0 0 12px;margin-top:-1px}
  .kpi-row>[class*="el-col-"]:nth-child(4) .kpi-card{border-radius:0 0 12px 0;margin-top:-1px;margin-left:-1px}
  .kpi-icon{width:32px;height:32px;border-radius:9px}
  .kpi-label{font-size:11px;margin-bottom:1px;text-transform:none}
  .kpi-value{font-size:15px}
  .filter-bar{padding:9px 10px;margin-bottom:10px;gap:8px;box-shadow:none}
  .filter-left{width:100%;flex-wrap:wrap;overflow:visible;padding-bottom:2px}
  .filter-left>*{max-width:none;flex-shrink:0}
  .filter-left .el-radio-group{width:100%;display:flex}.filter-left .el-radio-button{flex:1}.filter-left :deep(.el-radio-button__inner){width:100%;padding:8px 6px}
  .filter-left .el-select{width:100%!important;margin-left:0!important}
  .mobile-date-range{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%;min-width:0;gap:8px}.mobile-date-input{width:100%;min-width:0;height:44px;padding:0 9px;border:1px solid #dcdfe6;border-radius:4px;color:#606266;background:#fff;font:inherit;box-sizing:border-box;outline:none}.mobile-date-input:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.1)}
  .filter-right{display:flex;width:100%;gap:8px}
  .filter-right .el-button{flex:1;min-height:40px;margin:0}
  .charts-row{margin-bottom:4px}
  .chart-card{margin-bottom:10px;border-radius:12px;box-shadow:none}
  .chart-body{overflow-x:auto}
  .desktop-log-table{display:none}
  .mobile-log-list{display:grid;gap:0;padding:0}
  .mobile-log-card{border-radius:0;padding:11px 10px}
  .mobile-log-card+ .mobile-log-card{margin-top:-1px}
  .mobile-log-usage{grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:8px}
  .mobile-log-usage span{padding:6px}
  .mobile-log-usage span:last-child{grid-column:auto}
  .mobile-log-card .billing-detail-button{min-height:40px}
  .chart-sphere{min-height:210px}.chart-sphere>div{height:210px!important}
  .chart-header{padding:10px}.chart-sub{white-space:nowrap}
}
</style>
