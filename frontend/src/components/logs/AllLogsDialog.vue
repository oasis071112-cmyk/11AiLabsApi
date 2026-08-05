<template>
  <el-dialog v-model="visible" title="全部调用记录" width="90%" top="3vh" destroy-on-close class="all-logs-dialog user-theme-dialog">
    <div class="log-filter-bar">
      <el-select v-model="logFilter.model" clearable placeholder="模型" size="small" @change="onLogFilterChange"><el-option v-for="m in modelList" :key="m.model_code" :label="m.model_code" :value="m.model_code"/></el-select>
      <el-date-picker v-if="!isMobile" v-model="logFilter.dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="~" start-placeholder="开始" end-placeholder="结束" size="small" @change="onLogFilterChange"/>
      <div v-else class="mobile-date-range"><input v-model="logFilter.dateRange[0]" class="mobile-date-input" type="date" aria-label="开始日期" @change="onLogFilterChange"/><input v-model="logFilter.dateRange[1]" class="mobile-date-input" type="date" aria-label="结束日期" @change="onLogFilterChange"/></div>
      <el-button size="small" @click="onLogFilterChange">查询</el-button>
      <el-button size="small" type="primary" :loading="exportLoading" :disabled="!logRangeValid" @click="exportLogs">导出 CSV</el-button>
    </div>
    <el-table v-if="!isMobile" :data="allLogs" stripe size="small" v-loading="logLoading" max-height="60vh">
      <el-table-column label="时间" width="170"><template #default="{row}">{{ formatBeijingTime(row.created_at) }}</template></el-table-column>
      <el-table-column prop="request_id" label="请求ID" width="180" show-overflow-tooltip/>
      <el-table-column prop="model_code" label="模型" width="130"/>
      <el-table-column label="计费方式" width="110"><template #default="{row}"><el-tag :type="billingModeType(row.billing_mode)" size="small">{{ billingModeLabel(row) }}</el-tag></template></el-table-column>
      <el-table-column label="输入Token" width="100" align="right"><template #default="{row}">{{ row.input_tokens?.toLocaleString()||'-' }}</template></el-table-column>
      <el-table-column label="输出Token" width="100" align="right"><template #default="{row}">{{ row.output_tokens?.toLocaleString()||'-' }}</template></el-table-column>
      <el-table-column label="费用" width="110" align="right"><template #default="{row}">{{ point(row.total_cost) }} 点</template></el-table-column>
      <el-table-column label="计费明细" width="130"><template #default="{row}"><el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="emit('open-billing',row)">查看计算过程</el-button><span v-else class="no-detail">历史记录无快照</span></template></el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{row}"><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column prop="error_message" label="错误信息" min-width="160" show-overflow-tooltip/>
    </el-table>
    <div v-else class="all-logs-mobile-list" v-loading="logLoading">
      <article v-for="row in allLogs" :key="row.request_id" class="mobile-log-card">
        <div class="mobile-log-head"><div><el-tag size="small" effect="plain">{{ row.model_code }}</el-tag><el-tag size="small" :type="billingModeType(row.billing_mode)">{{ billingModeLabel(row) }}</el-tag></div><el-tag :type="row.status==='success'?'success':row.status==='blocked'?'warning':'danger'" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag></div>
        <div class="mobile-log-time">{{ formatBeijingTime(row.created_at) }}</div>
        <div class="mobile-log-request">{{ row.request_id }}</div>
        <div class="mobile-log-usage"><span>输入 <strong>{{ number(row.input_tokens) }}</strong></span><span>输出 <strong>{{ number(row.output_tokens) }}</strong></span><span>扣费 <strong>{{ point(row.total_cost) }} 点</strong></span></div>
        <div v-if="row.error_message" class="mobile-log-error">{{ row.error_message }}</div>
        <el-button v-if="hasBillingDetail(row)" class="billing-detail-button" type="primary" size="small" @click="emit('open-billing',row)">查看扣费计算过程</el-button>
        <span v-else class="no-detail">历史记录无快照</span>
      </article>
      <el-empty v-if="!logLoading&&!allLogs.length" description="暂无调用记录" :image-size="50"/>
    </div>
    <el-pagination v-model:current-page="logPage" :page-size="20" :total="logTotal" layout="prev,pager,next" @current-change="fetchLogs" style="margin-top:16px;justify-content:center" small/>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import api from '@/api'
import { formatBeijingTime } from '@/utils/time'
import { createRequestCoordinator } from '@/utils/request-coordinator'

const visible=defineModel({type:Boolean,default:false})
const props=defineProps({
  modelList:{type:Array,default:()=>[]},
  isMobile:{type:Boolean,default:false},
  initialModel:{type:String,default:''},
  initialDateRange:{type:Array,default:()=>[]},
})
const emit=defineEmits(['open-billing'])
const allLogs=ref([]),logLoading=ref(false),logPage=ref(1),logTotal=ref(0),exportLoading=ref(false)
const logFilter=ref({model:props.initialModel,dateRange:[...props.initialDateRange]})
const logsRequest=createRequestCoordinator()
const logRangeValid=computed(()=>validateRange(logFilter.value.dateRange,false))

function statusLabel(s){const m={success:'成功',failed:'失败',blocked:'拦截'};return m[s]||s}
function billingModeType(mode){return mode==='image'?'warning':mode==='per_request'?'success':'info'}
function billingModeLabel(row){return row.billing_mode==='image'?`图片 ${row.image_count||0} 张`:row.billing_mode==='per_request'?'每请求':'Token'}
function hasBillingDetail(row){return Array.isArray(row?.billing_detail?.dimensions)}
function number(value){return Number(value||0).toLocaleString()}
function point(value){return Number(value||0).toFixed(6)}
function normalizeRange(range){return Array.isArray(range)?range.map(value=>value?dayjs(value).format('YYYY-MM-DD'):''):[]}
function validateRange(range,notify=true){const normalized=normalizeRange(range);let message='';if(normalized.length!==2||!normalized[0]||!normalized[1])message='请选择完整的开始和结束日期';else if(!dayjs(normalized[0],'YYYY-MM-DD',true).isValid()||!dayjs(normalized[1],'YYYY-MM-DD',true).isValid())message='日期格式无效';else if(dayjs(normalized[0]).isAfter(dayjs(normalized[1])))message='开始日期不能晚于结束日期';else if(dayjs(normalized[1]).diff(dayjs(normalized[0]),'day')+1>90)message='日期范围不能超过 90 个自然日';if(message&&notify)ElMessage.warning(message);return !message}
function logParams(){const range=normalizeRange(logFilter.value.dateRange);return {model:logFilter.value.model||undefined,start_date:range[0],end_date:range[1]}}
function onLogFilterChange(){if(!validateRange(logFilter.value.dateRange))return;logPage.value=1;fetchLogs()}
async function fetchLogs(){if(!validateRange(logFilter.value.dateRange))return;const p={page:logPage.value,limit:20,...logParams()};const request=logsRequest.run(`logs:${JSON.stringify(p)}`,(_signal,request)=>api.get('/api/user/logs',{params:p,signal:request.signal}));logLoading.value=true;try{const r=await request.promise;if(!logsRequest.isCurrent(request))return;allLogs.value=r.data.data;logTotal.value=r.data.pagination.total}catch(e){}finally{if(logsRequest.isCurrent(request))logLoading.value=false}}
async function exportLogs(){if(!validateRange(logFilter.value.dateRange))return;exportLoading.value=true;try{const r=await api.get('/api/user/logs/export',{params:logParams(),responseType:'blob'});const disposition=r.headers['content-disposition']||'';const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];const fallback=`调用记录_${logFilter.value.dateRange[0]}_${logFilter.value.dateRange[1]}.csv`;const filename=encoded?decodeURIComponent(encoded):fallback;const url=URL.createObjectURL(r.data);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);ElMessage.success('CSV 导出成功')}catch(e){}exportLoading.value=false}

onMounted(()=>{void fetchLogs()})
onUnmounted(()=>logsRequest.cancel())
</script>

<style scoped>
.billing-detail-button{font-weight:650;--el-button-hover-bg-color:#1d4ed8;--el-button-hover-border-color:#1d4ed8}.no-detail{color:#94a3b8;font-size:11px}.log-filter-bar{margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap}.log-filter-bar>.el-select{width:150px}.mobile-date-range{display:flex;gap:8px}.mobile-log-card{border:1px solid #e2e8f0;border-radius:12px;padding:13px;background:#fff}.mobile-log-head{display:flex;justify-content:space-between;gap:8px}.mobile-log-time{font-size:11px;color:#94a3b8;margin:7px 0}.mobile-log-usage{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}.mobile-log-usage span{background:#f8fafc;border-radius:8px;padding:7px;font-size:11px;color:#64748b}.mobile-log-usage span:last-child{grid-column:1/-1}.mobile-log-usage strong{display:block;color:#0f172a;font-size:12px}.mobile-log-card .billing-detail-button{width:100%}
@media(max-width:768px){
  .mobile-date-range{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%;min-width:0;gap:8px}.mobile-date-input{width:100%;min-width:0;height:44px;padding:0 9px;border:1px solid #dcdfe6;border-radius:4px;color:#606266;background:#fff;font:inherit;box-sizing:border-box;outline:none}.mobile-date-input:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.1)}.log-filter-bar{display:grid;grid-template-columns:1fr 1fr;gap:8px}.log-filter-bar>.el-select,.log-filter-bar>.mobile-date-range{grid-column:1/-1;width:100%}.log-filter-bar>.el-button{margin:0;min-height:44px}
  :deep(.all-logs-dialog){width:calc(100% - 16px)!important;margin-top:8px!important}.all-logs-dialog :deep(.el-dialog__body){padding:12px;overflow:hidden}.all-logs-dialog :deep(.el-pagination){overflow-x:auto;justify-content:flex-start!important}
  .all-logs-mobile-list{display:grid;gap:8px;max-height:58vh;overflow-y:auto}.all-logs-mobile-list .mobile-log-card{border-radius:10px;padding:11px}.mobile-log-request,.mobile-log-error{overflow-wrap:anywhere;font-size:11px;color:#64748b;margin-bottom:8px}.mobile-log-error{padding:7px;background:#fef2f2;border-radius:7px;color:#b91c1c}
  .mobile-log-usage{grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:8px}.mobile-log-usage span{padding:6px}.mobile-log-usage span:last-child{grid-column:auto}.mobile-log-card .billing-detail-button{min-height:40px}
}
</style>
