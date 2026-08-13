<template>
  <div class="admin-page admin-logs-page">
    <header class="logs-heading">
      <div>
        <h3>调用日志</h3>
        <p>按当前时间和筛选范围汇总调用表现，点击榜单可核对原始记录</p>
      </div>
      <el-button plain @click="openAllDetails"><ListFilter :size="16"/>查看全部明细</el-button>
    </header>

    <section class="logs-toolbar" aria-label="调用日志筛选">
      <div class="date-presets" role="group" aria-label="时间范围">
        <button v-for="item in presets" :key="item.value" type="button" :class="{active:preset===item.value}" @click="setPreset(item.value)">{{ item.label }}</button>
      </div>
      <div v-if="preset==='custom'&&!isMobile" class="custom-range-inline">
        <input v-model="customStart" type="datetime-local" aria-label="开始时间" @change="applyCustomRange">
        <span>至</span>
        <input v-model="customEnd" type="datetime-local" aria-label="结束时间" @change="applyCustomRange">
      </div>
      <el-input v-model="searchInput" class="logs-search" clearable placeholder="用户名 / 用户ID / 请求ID / 模型" @keyup.enter="applySearch" @clear="applySearch">
        <template #prefix><Search :size="16"/></template>
      </el-input>
      <el-button plain @click="filterDrawer=true"><SlidersHorizontal :size="16"/>筛选<span v-if="activeFilterCount" class="filter-count">{{ activeFilterCount }}</span></el-button>
      <el-button text class="reset-button" @click="resetFilters"><RotateCcw :size="15"/>重置</el-button>
    </section>

    <div v-if="activeFilterLabels.length" class="active-filters" aria-label="已应用筛选">
      <span v-for="label in activeFilterLabels" :key="label">{{ label }}</span>
    </div>

    <section class="ops-kpi-grid" v-loading="loading" aria-label="运营汇总">
      <article class="stat-card"><span>调用次数</span><strong>{{ formatInteger(summary.total_calls) }}</strong><small>当前筛选范围</small></article>
      <article class="stat-card"><span>美元扣费</span><strong>{{ formatUsdDeduction(summary.user_deduction_usd) }}</strong><small>已结算调用合计</small></article>
      <article class="stat-card success-card"><span>成功率</span><strong>{{ formatPercent(summary.success_rate) }}</strong><small>{{ formatInteger(summary.success_calls) }} 次成功</small></article>
      <article class="stat-card danger-card"><span>失败 / 拦截</span><strong>{{ formatInteger(anomalyCalls) }}</strong><small>{{ formatInteger(summary.failed_calls) }} 失败 · {{ formatInteger(summary.blocked_calls) }} 拦截</small></article>
    </section>

    <section class="logs-insights-grid">
      <el-card class="trend-card" v-loading="loading">
        <template #header><div class="section-heading"><div><strong>调用趋势</strong><span>{{ rangeCaption }}</span></div><span class="chart-legend-hint">北京时间</span></div></template>
        <AdminTrendChart :data="trendData" failure-label="非成功" :height="isMobile?230:286"/>
      </el-card>
    </section>

    <section class="ranking-card" v-loading="loading">
      <div class="ranking-head">
        <div><h4>运营榜单</h4><p>调用量、美元扣费和稳定性均来自当前日志字段</p></div>
        <div class="dimension-tabs" role="tablist" aria-label="榜单维度">
          <button v-for="item in dimensions" :key="item.value" type="button" role="tab" :aria-selected="dimension===item.value" :class="{active:dimension===item.value}" @click="setDimension(item.value)">{{ item.label }}</button>
        </div>
      </div>
      <div v-if="operationsError" class="detail-inline-error operations-inline-error" role="alert"><span>{{ operationsError }}</span><el-button size="small" @click="fetchOperations">重试</el-button></div>

      <el-table v-if="ranking.length" class="desktop-ranking-table" :data="ranking" stripe table-layout="fixed" :default-sort="{prop:'calls',order:'descending'}" @sort-change="handleRankingSort" @row-click="openRankDetails">
        <el-table-column prop="label" :label="dimensionLabel" min-width="220" show-overflow-tooltip sortable="custom"><template #default="{row}"><div class="rank-object"><span>{{ row.label }}</span><small>点击查看调用明细</small></div></template></el-table-column>
        <el-table-column prop="calls" label="调用量" width="120" sortable="custom"><template #default="{row}">{{ formatInteger(row.calls) }}</template></el-table-column>
        <el-table-column prop="share" label="占比" width="110" sortable="custom"><template #default="{row}">{{ formatPercent(row.share) }}</template></el-table-column>
        <el-table-column prop="user_deduction_usd" label="美元扣费" width="140" sortable="custom"><template #default="{row}">{{ formatUsdDeduction(row.user_deduction_usd) }}</template></el-table-column>
        <el-table-column prop="success_rate" label="成功率" width="120" sortable="custom"><template #default="{row}"><span :class="rateTone(row.success_rate)">{{ formatPercent(row.success_rate) }}</span></template></el-table-column>
        <el-table-column prop="failed_or_blocked_calls" label="失败 / 拦截" width="130" sortable="custom"><template #default="{row}">{{ formatInteger(row.failed_or_blocked_calls) }}</template></el-table-column>
      </el-table>

      <div v-if="ranking.length" class="mobile-ranking-list">
        <button v-for="row in ranking" :key="row.key" type="button" class="mobile-ranking-card" @click="openRankDetails(row)">
          <div class="mobile-rank-head"><strong>{{ row.label }}</strong><span>{{ formatInteger(row.calls) }} 次</span></div>
          <div class="mobile-rank-metrics">
            <div><small>调用占比</small><span>{{ formatPercent(row.share) }}</span></div>
            <div><small>美元扣费</small><span>{{ formatUsdDeduction(row.user_deduction_usd) }}</span></div>
            <div><small>成功率</small><span :class="rateTone(row.success_rate)">{{ formatPercent(row.success_rate) }}</span></div>
            <div><small>失败 / 拦截</small><span>{{ formatInteger(row.failed_or_blocked_calls) }}</span></div>
          </div>
          <span class="mobile-rank-action">查看调用明细 →</span>
        </button>
      </div>
      <el-empty v-if="!loading&&!operationsError&&!ranking.length" description="当前范围暂无调用记录" :image-size="64"/>
    </section>

    <el-drawer v-model="detailsOpen" class="log-detail-drawer" direction="rtl" :size="isMobile?'100%':'640px'" :with-header="false" append-to-body>
      <div class="detail-shell">
        <header class="detail-head">
          <button v-if="detailView==='record'" type="button" aria-label="返回调用明细列表" @click="backToDetailList">‹</button>
          <button v-else type="button" aria-label="关闭调用明细" @click="detailsOpen=false">×</button>
          <div v-if="detailView==='record'"><span>完整调用详情</span><h4>{{ selectedLog?.model_code||'调用记录' }}</h4><small class="mono">{{ selectedLog?.request_id||'—' }}</small></div>
          <div v-else><span>{{ activeDetail.caption }}</span><h4>{{ activeDetail.label }}</h4><small>{{ rangeCaption }} · 共 {{ formatInteger(detailTotal) }} 条</small></div>
        </header>
        <div v-if="detailView==='list'" class="detail-filter-note">当前页面的时间、搜索与高级筛选保持生效</div>
        <div v-if="detailView==='list'" class="mobile-log-list">
          <el-skeleton v-if="detailLoading" animated :rows="7"/>
          <div v-else-if="detailError" class="detail-inline-error" role="alert"><span>{{ detailError }}</span><el-button size="small" @click="fetchDetails">重试</el-button></div>
          <article v-for="row in detailLoading||detailError?[]:detailLogs" :key="row.id" class="log-record">
            <button type="button" class="log-record-summary" @click="openLogDetail(row)">
              <div class="record-time"><strong>{{ formatBeijingTime(row.created_at) }}</strong><el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag></div>
              <div class="record-primary"><span>{{ row.model_code||'—' }}</span><strong>{{ formatUsdDeduction(row.user_deduction_usd) }}</strong></div>
              <div class="record-meta"><span>{{ row.username||`用户 #${row.user_id||'—'}` }}</span><span>{{ channelLabel(row) }}</span></div>
            </button>
          </article>
          <el-empty v-if="!detailLoading&&!detailError&&!detailLogs.length" description="暂无调用明细" :image-size="58"/>
        </div>
        <div v-else class="single-log-detail">
          <el-skeleton v-if="singleLoading" animated :rows="10"/>
          <div v-else-if="singleError" class="detail-inline-error" role="alert"><span>{{ singleError }}</span><el-button size="small" @click="retryLogDetail">重试</el-button></div>
          <div v-else-if="selectedLog" class="record-detail complete-record-detail">
            <div v-if="selectedLog.billing_snapshot_missing" class="historical-snapshot-note">历史记录无快照</div>
            <dl>
              <div><dt>数据库日志 ID</dt><dd class="mono">{{ selectedLog.id }}</dd></div>
              <div><dt>请求 ID</dt><dd class="mono">{{ selectedLog.request_id||'—' }}</dd></div>
              <div><dt>用户</dt><dd>{{ selectedLog.username||`用户 #${selectedLog.user_id||'—'}` }}</dd></div>
              <div><dt>API Key</dt><dd>{{ selectedLog.key_name||selectedLog.key_prefix||'—' }}</dd></div>
              <div><dt>实际渠道</dt><dd>{{ channelLabel(selectedLog) }}</dd></div>
              <div><dt>计费模型 / 方式</dt><dd>{{ selectedLog.billing_model||selectedLog.model_code||'—' }} · {{ billingModeLabel(selectedLog) }}</dd></div>
              <div><dt>普通输入 Token</dt><dd>{{ tokenValue(selectedLog.uncached_input_tokens??selectedLog.input_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>缓存读取 Token</dt><dd>{{ tokenValue(selectedLog.cached_input_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>缓存创建 Token</dt><dd>{{ tokenValue(selectedLog.cache_creation_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>缓存创建 5 分钟 Token</dt><dd>{{ tokenValue(selectedLog.cache_creation_5m_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>缓存创建 1 小时 Token</dt><dd>{{ tokenValue(selectedLog.cache_creation_1h_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>图片输入 / 输出 Token</dt><dd>{{ tokenValue(selectedLog.image_input_tokens,selectedLog.billing_mode) }} / {{ tokenValue(selectedLog.image_output_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>输出 Token</dt><dd>{{ tokenValue(selectedLog.output_tokens,selectedLog.billing_mode) }}</dd></div>
              <div><dt>输入 / 输出价格</dt><dd>{{ priceText(selectedLog.input_price) }} / {{ priceText(selectedLog.output_price) }}</dd></div>
              <div><dt>倍率</dt><dd>{{ multiplierText(selectedLog) }}</dd></div>
              <div><dt>美元汇率</dt><dd>{{ selectedLog.usd_cny_rate??'—' }}</dd></div>
              <div><dt>用户实际扣费（USD）</dt><dd>{{ formatUsdDeduction(selectedLog.user_deduction_usd) }}</dd></div>
              <div><dt>自动结算</dt><dd>{{ settlementText(selectedLog.auto_settlement) }}</dd></div>
              <div class="error-row"><dt>错误</dt><dd>{{ selectedLog.error_type||'—' }} · {{ selectedLog.error_message||'—' }}</dd></div>
            </dl>
          </div>
        </div>
        <el-pagination v-if="detailView==='list'&&detailTotal>50" v-model:current-page="detailPage" :page-size="50" :total="detailTotal" layout="prev,pager,next" @current-change="fetchDetails"/>
      </div>
    </el-drawer>

    <el-drawer v-model="filterDrawer" class="advanced-filter-drawer" :direction="isMobile?'btt':'rtl'" :size="isMobile?'82%':'420px'" :with-header="false" append-to-body>
      <div class="filter-shell">
        <header><div><span>高级筛选</span><small>筛选会同步影响 KPI、趋势、榜单和明细</small></div><button type="button" aria-label="关闭筛选" @click="filterDrawer=false">×</button></header>
        <div v-if="preset==='custom'&&isMobile" class="filter-field custom-mobile-range">
          <label>自定义时间</label>
          <input v-model="customStart" type="datetime-local" aria-label="开始时间">
          <input v-model="customEnd" type="datetime-local" aria-label="结束时间">
        </div>
        <div class="filter-field"><label>调用状态</label><el-select v-model="filters.status" clearable placeholder="全部状态"><el-option value="success" label="成功"/><el-option value="failed" label="失败"/><el-option value="blocked" label="拦截"/><el-option value="settlement_pending" label="待审"/></el-select></div>
        <div class="filter-field"><label>实际渠道</label><el-input v-model="filters.channel" clearable placeholder="输入当前日志中的渠道名称或 ID"/></div>
        <div class="filter-field"><label>计费方式</label><el-select v-model="filters.billing_mode" clearable placeholder="全部方式"><el-option value="token" label="Token"/><el-option value="per_request" label="每请求"/><el-option value="image" label="图片"/></el-select></div>
        <div class="filter-actions"><el-button @click="clearAdvanced">清空</el-button><el-button type="primary" @click="applyAdvanced">应用筛选</el-button></div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ListFilter, RotateCcw, Search, SlidersHorizontal } from '@lucide/vue'
import { ElMessage } from 'element-plus'
import api from '@/api'
import AdminTrendChart from '@/components/AdminTrendChart.vue'
import { useMobile } from '@/composables/useMobile'
import { formatBeijingDate, formatBeijingTime } from '@/utils/time'
import { formatUsdDeduction } from '@/utils/billing'

const EMPTY_SUMMARY={total_calls:0,total_cost:0,user_deduction_usd:0,success_calls:0,failed_calls:0,blocked_calls:0,pending_calls:0,success_rate:0}
const presets=[{value:'24h',label:'近24小时'},{value:'today',label:'今天'},{value:'7d',label:'近7天'},{value:'30d',label:'近30天'},{value:'custom',label:'自定义'}]
const dimensions=[{value:'model',label:'按模型'},{value:'channel',label:'按渠道'},{value:'user',label:'按用户'}]
const isMobile=useMobile()
const loading=ref(false),detailLoading=ref(false),singleLoading=ref(false),filterDrawer=ref(false),detailsOpen=ref(false)
const summary=ref({...EMPTY_SUMMARY}),trend=ref([]),ranking=ref([])
const operationsError=ref('')
const preset=ref('24h'),dimension=ref('model'),searchInput=ref(''),customStart=ref(''),customEnd=ref('')
const filters=reactive({q:'',status:'',channel:'',billing_mode:''})
const rankingSort=reactive({prop:'calls',order:'desc'})
const detailLogs=ref([]),detailTotal=ref(0),detailPage=ref(1),detailError=ref(''),singleError=ref('')
const detailView=ref('list'),selectedLog=ref(null),selectedLogIdentity=ref(null)
const activeDetail=ref({type:'all',key:'',label:'全部调用',caption:'调用明细'})
const appliedQueryParams=ref(null)
let operationsRequestId=0,detailRequestId=0,singleRequestId=0,detailController=null,singleController=null

const anomalyCalls=computed(()=>Number(summary.value.failed_calls||0)+Number(summary.value.blocked_calls||0))
const rangeCaption=computed(()=>presets.find(item=>item.value===preset.value)?.label||'当前范围')
const dimensionLabel=computed(()=>({model:'模型',channel:'渠道',user:'用户'}[dimension.value]))
const activeFilterCount=computed(()=>[filters.status,filters.channel,filters.billing_mode].filter(Boolean).length)
const activeFilterLabels=computed(()=>[
  filters.q&&`搜索：${filters.q}`,
  filters.status&&`状态：${statusLabel(filters.status)}`,
  filters.channel&&`渠道：${filters.channel}`,
  filters.billing_mode&&`计费：${billingModeName(filters.billing_mode)}`,
].filter(Boolean))
const trendData=computed(()=>trend.value.map(row=>({date:row.label,success_calls:Number(row.success_calls||0),failed_calls:Number(row.failed_calls||0)+Number(row.blocked_calls||0)+Number(row.pending_calls||0)})))

onMounted(fetchOperations)

function beijingLocalValue(date){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
function ensureCustomDefaults(){
  if(customStart.value&&customEnd.value)return
  const end=new Date(),start=new Date(end.getTime()-24*60*60*1000)
  customStart.value=beijingLocalValue(start);customEnd.value=beijingLocalValue(end)
}
function beijingInputToIso(value){return value?new Date(`${value}:00+08:00`).toISOString():''}
function currentRange(){
  const end=new Date()
  if(preset.value==='custom')return{start_at:beijingInputToIso(customStart.value),end_at:beijingInputToIso(customEnd.value)}
  if(preset.value==='today'){
    const date=formatBeijingDate(end)
    return{start_at:new Date(`${date}T00:00:00+08:00`).toISOString(),end_at:end.toISOString()}
  }
  const days=preset.value==='7d'?7:preset.value==='30d'?30:1
  return{start_at:new Date(end.getTime()-days*24*60*60*1000).toISOString(),end_at:end.toISOString()}
}
function validRange(range){return Boolean(range.start_at&&range.end_at&&Date.parse(range.start_at)<Date.parse(range.end_at))}
function operationsParams(){
  const range=currentRange()
  if(!validRange(range))throw new Error('请选择完整且有效的开始、结束时间')
  return{start_at:range.start_at,end_at:range.end_at,q:filters.q||undefined,status:filters.status||undefined,channel:filters.channel||undefined,billing_mode:filters.billing_mode||undefined,dimension:dimension.value,bucket:preset.value==='24h'?'hour':'day',ranking_sort_by:rankingSort.prop,ranking_sort_order:rankingSort.order}
}
function baseParams(){
  return{...(appliedQueryParams.value||operationsParams())}
}
async function fetchOperations(){
  const requestId=++operationsRequestId
  loading.value=true
  operationsError.value=''
  try{
    const params={...operationsParams(),page:1,limit:50}
    const response=await api.get('/api/admin/logs',{params})
    if(requestId!==operationsRequestId)return
    summary.value={...EMPTY_SUMMARY,...response.data.summary}
    trend.value=response.data.trend||[]
    ranking.value=response.data.ranking||[]
    appliedQueryParams.value={...params}
  }catch(error){if(requestId===operationsRequestId)operationsError.value=error.response?.data?.error||error.message||'调用日志加载失败，请重试'}
  finally{if(requestId===operationsRequestId)loading.value=false}
}
function setPreset(value){
  preset.value=value
  if(value==='custom'){
    ensureCustomDefaults()
    if(isMobile.value)filterDrawer.value=true
    fetchOperations()
    return
  }
  fetchOperations()
}
function applyCustomRange(){if(customStart.value&&customEnd.value)fetchOperations()}
function applySearch(){filters.q=searchInput.value.trim();fetchOperations()}
function setDimension(value){if(dimension.value===value)return;dimension.value=value;fetchOperations()}
function handleRankingSort({prop,order}){rankingSort.prop=prop||'calls';rankingSort.order=order==='ascending'?'asc':'desc';fetchOperations()}
function applyAdvanced(){
  if(preset.value==='custom'&&!validRange(currentRange()))return ElMessage.warning('请选择完整且有效的时间范围')
  filterDrawer.value=false;fetchOperations()
}
function clearAdvanced(){filters.status='';filters.channel='';filters.billing_mode=''}
function resetFilters(){
  preset.value='24h';dimension.value='model';searchInput.value='';customStart.value='';customEnd.value=''
  filters.q='';clearAdvanced();fetchOperations()
}
function detailParams(){
  const params={...baseParams(),page:detailPage.value,limit:50,include_summary:false}
  if(activeDetail.value.type==='model')params.model=activeDetail.value.key
  if(activeDetail.value.type==='user')params.user_id=activeDetail.value.key
  if(activeDetail.value.type==='channel')params.channel_exact=activeDetail.value.key
  return params
}
async function fetchDetails(){
  const requestId=++detailRequestId
  detailController?.abort();detailController=new AbortController()
  detailLoading.value=true
  detailError.value=''
  try{
    const response=await api.get('/api/admin/logs',{params:detailParams(),signal:detailController.signal})
    if(requestId!==detailRequestId)return
    detailLogs.value=response.data.data||[];detailTotal.value=Number(response.data.pagination?.total||0)
  }catch(error){if(requestId===detailRequestId&&error.code!=='ERR_CANCELED')detailError.value=error.response?.data?.error||error.message||'调用明细加载失败，请重试'}
  finally{if(requestId===detailRequestId)detailLoading.value=false}
}
function openAllDetails(){activeDetail.value={type:'all',key:'',label:'全部调用',caption:'调用明细'};detailPage.value=1;detailView.value='list';detailsOpen.value=true;fetchDetails()}
function openRankDetails(row){activeDetail.value={type:dimension.value,key:row.key,label:row.label,caption:`${dimensionLabel.value}明细`};detailPage.value=1;detailView.value='list';detailsOpen.value=true;fetchDetails()}
async function openLogDetail(row){
  const requestId=++singleRequestId
  selectedLogIdentity.value={...row};selectedLog.value=null;singleError.value='';detailView.value='record'
  if(row.exact_detail_supported!==true){selectedLog.value=row;return}
  if(row.id===undefined||!row.created_at){singleError.value='该记录缺少数据库日志标识，无法精确读取';return}
  singleController?.abort();singleController=new AbortController();singleLoading.value=true
  try{const response=await api.get(`/api/admin/logs/${encodeURIComponent(row.id)}`,{params:{created_at:row.created_at},signal:singleController.signal});if(requestId===singleRequestId)selectedLog.value=response.data.data}
  catch(error){if(requestId===singleRequestId&&error.code!=='ERR_CANCELED')singleError.value=error.response?.data?.error||error.message||'完整调用详情加载失败，请重试'}
  finally{if(requestId===singleRequestId)singleLoading.value=false}
}
function retryLogDetail(){if(selectedLogIdentity.value)openLogDetail(selectedLogIdentity.value)}
function backToDetailList(){singleController?.abort();detailView.value='list';selectedLog.value=null;singleError.value=''}
function formatInteger(value){return Number(value||0).toLocaleString('zh-CN')}
function formatPercent(value){return `${Number(value||0).toFixed(2)}%`}
function rateTone(value){return Number(value)>=98?'rate-good':Number(value)>=90?'rate-warn':'rate-bad'}
function statusType(value){return value==='success'?'success':value==='blocked'?'warning':'danger'}
function statusLabel(value){return{success:'成功',failed:'失败',blocked:'拦截',settlement_pending:'待审'}[value]||value||'未知'}
function billingModeName(value){return{token:'Token',per_request:'每请求',image:'图片'}[value]||'Token'}
function billingModeLabel(row){return row.billing_mode==='image'?`图片 ${Number(row.image_count||0)} 张`:billingModeName(row.billing_mode)}
function channelLabel(row){return row.upstream_channel_name||row.upstream_channel_id||row.upstream_account_id||'—'}
function tokenValue(value,mode){return mode&&mode!=='token'?'—':formatInteger(value)}
function multiplierText(row){
  if(row.billing_mode==='image')return `图 ${multiplierValue(row.billing_multiplier_image)} · ${sourceLabel(row.billing_multiplier_source_image)}`
  return `入 ${multiplierValue(row.billing_multiplier_input)} · ${sourceLabel(row.billing_multiplier_source_input)} / 出 ${multiplierValue(row.billing_multiplier_output)} · ${sourceLabel(row.billing_multiplier_source_output)}`
}
function multiplierValue(value){return value===undefined||value===null||value===''?'—':`×${value}`}
function sourceLabel(value){return{request_snapshot:'调用快照',user:'用户专属',routing_group:'路由分组',global:'全局倍率',system_default:'1× 兜底',channel:'旧渠道倍率',platform_model:'旧平台模型',platform_default:'旧平台全局',model_default:'旧模型兜底'}[value]||'旧记录'}
function priceText(value){return value===undefined||value===null?'—':String(value)}
function settlementText(value){if(!value)return'—';return{partial_settled:'部分用量已结算',zero_released:'零扣费已解冻',settled:'已结算'}[value.outcome]||value.outcome||'已自动处理'}
</script>

<style scoped>
.admin-logs-page{min-width:0;overflow-x:hidden;padding-bottom:28px}.log-detail-drawer :deep(.el-drawer__body),.advanced-filter-drawer :deep(.el-drawer__body){padding:0}.logs-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px}.logs-heading h3{font-size:22px}.logs-heading p,.ranking-head p{margin-top:4px;color:var(--text-muted);font-size:12px}.logs-heading .el-button svg,.logs-toolbar .el-button svg{margin-right:6px}.logs-toolbar{display:flex;align-items:center;gap:9px;padding:10px 12px;margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-card);box-shadow:var(--shadow-sm);min-width:0}.date-presets{display:grid;grid-template-columns:repeat(5,auto);gap:3px;padding:3px;border-radius:9px;background:#f2f5ef;flex-shrink:0}.date-presets button,.dimension-tabs button{border:0;border-radius:7px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:12px;font-weight:600;min-height:34px;padding:0 11px;white-space:nowrap}.date-presets button.active,.dimension-tabs button.active{background:#fff;color:var(--primary-dark);box-shadow:0 1px 4px rgba(45,51,44,.08)}.custom-range-inline{display:flex;align-items:center;gap:6px;min-width:0;color:var(--text-muted);font-size:12px}.custom-range-inline input,.filter-field input{min-width:0;min-height:38px;padding:7px 9px;border:1px solid #dcdfe6;border-radius:8px;background:#fff;color:var(--text-primary)}.logs-search{min-width:190px;max-width:320px;margin-left:auto}.reset-button{margin-left:0}.filter-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-left:5px;padding:0 5px;border-radius:9px;background:var(--primary);color:#fff;font-size:10px}.active-filters{display:flex;gap:6px;flex-wrap:wrap;margin:-3px 0 11px}.active-filters span{padding:4px 8px;border:1px solid #dce6d8;border-radius:7px;background:#f5f8f3;color:var(--primary-dark);font-size:11px}.ops-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:11px}.ops-kpi-grid .stat-card{min-width:0;padding:16px 17px}.ops-kpi-grid .stat-card>span{display:block;color:var(--text-muted);font-size:12px;font-weight:600}.ops-kpi-grid .stat-card strong{display:block;margin:5px 0 1px;color:var(--text-primary);font-size:24px;line-height:1.25;letter-spacing:-.035em;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ops-kpi-grid .stat-card small{color:var(--text-muted);font-size:11px}.ops-kpi-grid .success-card strong{color:var(--success)}.ops-kpi-grid .danger-card strong{color:var(--danger)}.logs-insights-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(280px,.7fr);gap:11px;margin-bottom:11px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.section-heading>div{display:flex;flex-direction:column}.section-heading span{color:var(--text-muted);font-size:11px;font-weight:400}.chart-legend-hint{padding:4px 7px;border-radius:6px;background:#f4f6f2}.trend-card :deep(.el-card__body){padding:6px 12px 8px!important}.status-card :deep(.el-card__body){padding-top:14px!important}.status-total{display:flex;align-items:baseline;gap:7px;margin-bottom:17px}.status-total strong{font-size:30px;letter-spacing:-.04em}.status-total span{color:var(--text-muted);font-size:12px}.status-row+.status-row{margin-top:14px}.status-row>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:12px}.status-row>div:first-child span{display:flex;align-items:center;gap:6px;color:var(--text-secondary)}.status-row i{width:7px;height:7px;border-radius:50%}.status-row strong{font-size:11px;font-weight:600}.status-track{height:6px;overflow:hidden;border-radius:3px;background:#edf0eb}.status-track span{display:block;height:100%;border-radius:3px}.ranking-card{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius);background:#fff;box-shadow:var(--shadow-sm)}.ranking-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 17px;border-bottom:1px solid var(--border)}.ranking-head h4{font-size:16px}.dimension-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:3px;border-radius:9px;background:#f2f5ef}.dimension-tabs button{min-width:76px}.desktop-ranking-table{border:0!important;border-radius:0!important}.desktop-ranking-table :deep(.el-table__row){cursor:pointer}.rank-object{display:flex;flex-direction:column;min-width:0}.rank-object span{overflow:hidden;color:var(--text-primary);font-weight:600;text-overflow:ellipsis;white-space:nowrap}.rank-object small{margin-top:2px;color:var(--text-muted);font-size:10px}.rate-good{color:var(--success);font-weight:650}.rate-warn{color:#b7791f;font-weight:650}.rate-bad{color:var(--danger);font-weight:650}.mobile-ranking-list{display:none}.detail-shell,.filter-shell{height:100%;display:flex;flex-direction:column;min-width:0}.detail-head{display:flex;align-items:center;gap:12px;padding:18px;border-bottom:1px solid var(--border)}.detail-head button,.filter-shell header button{width:38px;height:38px;flex-shrink:0;border:0;border-radius:10px;background:#f1f4ef;color:var(--text-primary);cursor:pointer;font-size:24px}.detail-head div{min-width:0}.detail-head span,.filter-shell header span{color:var(--primary-dark);font-size:11px;font-weight:700}.detail-head h4{overflow:hidden;margin:1px 0;font-size:18px;text-overflow:ellipsis;white-space:nowrap}.detail-head small,.filter-shell header small{display:block;color:var(--text-muted);font-size:11px}.detail-filter-note{margin:12px 14px 0;padding:8px 10px;border-radius:8px;background:#f5f8f3;color:var(--text-secondary);font-size:11px}.mobile-log-list{display:grid;align-content:start;gap:9px;min-height:0;padding:12px 14px;overflow-y:auto}.log-record{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:11px;background:#fff}.log-record.expanded{border-color:#cad9c5;box-shadow:var(--shadow-sm)}.log-record-summary{display:block;width:100%;padding:12px;border:0;background:#fff;color:inherit;cursor:pointer;text-align:left}.record-time,.record-primary,.record-meta{display:flex;align-items:center;justify-content:space-between;gap:10px}.record-time strong{font-size:12px}.record-primary{margin:9px 0 5px}.record-primary span{min-width:0;overflow:hidden;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.record-primary strong{flex-shrink:0;color:var(--primary-dark);font-size:13px}.record-meta{color:var(--text-muted);font-size:11px}.record-meta span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-detail{padding:0 12px 12px;background:#fbfcfa}.record-detail dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:11px;border-top:1px solid var(--border)}.record-detail dl>div{min-width:0;padding:8px;border-radius:8px;background:#f4f6f2}.record-detail dt{color:var(--text-muted);font-size:10px}.record-detail dd{margin-top:2px;color:var(--text-secondary);font-size:11px;overflow-wrap:anywhere}.record-detail .error-row{grid-column:1/-1}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.filter-shell{padding:20px}.filter-shell header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:22px}.filter-field{display:grid;gap:7px;margin-bottom:17px}.filter-field label{color:var(--text-secondary);font-size:12px;font-weight:650}.custom-mobile-range input+input{margin-top:7px}.filter-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:auto}.filter-actions .el-button{width:100%;min-height:44px;margin:0}
@media(min-width:769px) and (max-width:1120px){.logs-toolbar{flex-wrap:wrap}.logs-search{order:3;max-width:none;margin-left:0;flex:1 1 100%}.ops-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.logs-insights-grid{grid-template-columns:minmax(0,1.45fr) minmax(240px,.75fr)}}
@media(max-width:768px){.admin-logs-page{padding:0 0 24px!important;overflow-x:hidden}.logs-heading{align-items:flex-start;margin-bottom:12px}.logs-heading h3{font-size:19px}.logs-heading p{max-width:230px}.logs-heading .el-button{min-width:44px;padding:8px}.logs-heading .el-button svg{margin:0}.logs-heading .el-button span{font-size:0}.logs-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px;padding:8px}.date-presets{grid-column:1/-1;grid-template-columns:repeat(5,minmax(0,1fr));width:100%;min-width:0}.date-presets button{min-width:0;min-height:40px;padding:0 3px;font-size:11px}.logs-search{width:100%;min-width:0;max-width:none;margin:0}.reset-button{width:42px;padding:0}.reset-button svg{margin:0!important}.reset-button span{font-size:0}.ops-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ops-kpi-grid .stat-card{padding:13px;min-height:102px}.ops-kpi-grid .stat-card strong{font-size:20px;white-space:normal;overflow-wrap:anywhere}.logs-insights-grid{grid-template-columns:minmax(0,1fr);gap:8px}.status-card{display:none}.ranking-head{display:block;padding:13px}.dimension-tabs{width:100%;margin-top:12px}.dimension-tabs button{min-width:0;min-height:42px}.desktop-ranking-table{display:none}.mobile-ranking-list{display:grid;gap:8px;padding:9px;background:#f7f9f5}.mobile-ranking-card{min-width:0;padding:13px;border:1px solid var(--border);border-radius:11px;background:#fff;color:inherit;text-align:left}.mobile-rank-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.mobile-rank-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-rank-head span{flex-shrink:0;color:var(--primary-dark);font-size:12px;font-weight:650}.mobile-rank-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:11px 0}.mobile-rank-metrics>div{min-width:0;padding:8px;border-radius:8px;background:#f5f7f3}.mobile-rank-metrics small,.mobile-rank-metrics span{display:block}.mobile-rank-metrics small{color:var(--text-muted);font-size:10px}.mobile-rank-metrics span{margin-top:2px;font-size:12px;font-weight:650;overflow-wrap:anywhere}.mobile-rank-action{display:block;color:var(--primary-dark);font-size:11px;font-weight:650}.active-filters{overflow:hidden}.detail-head{padding:max(14px,env(safe-area-inset-top)) 12px 12px}.detail-filter-note{margin:9px 9px 0}.mobile-log-list{padding:9px;overflow-x:hidden}.record-detail dl{grid-template-columns:1fr}.record-detail .error-row{grid-column:auto}.filter-shell{padding:18px 14px max(16px,env(safe-area-inset-bottom))}.admin-logs-page :deep(.el-drawer__body){padding:0}.admin-logs-page :deep(.el-pagination){max-width:100%;padding:10px;overflow-x:auto;justify-content:flex-start}}
.logs-insights-grid{grid-template-columns:minmax(0,1fr)}.detail-head button,.filter-shell header button{width:44px;height:44px}
@media(min-width:769px) and (max-width:1120px){.logs-insights-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:768px){.logs-heading .el-button,.logs-toolbar>.el-button{min-height:44px}.logs-toolbar :deep(.el-input__wrapper){min-height:44px}.date-presets button{min-height:44px}.reset-button{width:44px;min-height:44px}.dimension-tabs button{min-height:44px}.admin-logs-page :deep(.el-pagination button),.admin-logs-page :deep(.el-pager li){min-width:44px;height:44px}}
@media(max-width:390px){.date-presets button{font-size:10px}.ops-kpi-grid .stat-card{padding:11px}.ops-kpi-grid .stat-card strong{font-size:18px}.logs-heading p{max-width:205px}.mobile-rank-metrics{gap:6px}}
.detail-inline-error{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0;padding:14px;border:1px solid #f2c6c6;border-radius:10px;background:#fff5f5;color:var(--danger);font-size:12px}.single-log-detail{min-height:0;padding:14px;overflow-y:auto}.single-log-detail>.el-skeleton{padding:8px}.complete-record-detail{padding:0;background:transparent}.complete-record-detail dl{grid-template-columns:repeat(2,minmax(0,1fr));padding-top:0;border-top:0}.historical-snapshot-note{margin-bottom:10px;padding:9px 11px;border-radius:8px;background:#fff8e8;color:#8a6116;font-size:12px}
.operations-inline-error{margin:12px}
@media(max-width:768px){.complete-record-detail dl{grid-template-columns:1fr}.detail-inline-error{align-items:flex-start;flex-direction:column}.detail-inline-error .el-button{min-height:44px}}
</style>
