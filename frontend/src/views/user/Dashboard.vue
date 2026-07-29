<template>
<div class="page-container">
<el-alert v-if="appStore.platformInfo.announcement" :title="appStore.platformInfo.announcement" type="info" show-icon :closable="false" style="margin-bottom:24px"/>
<el-alert v-if="authStore.authError" :title="authStore.authError" type="warning" show-icon :closable="false" style="margin-bottom:24px"/>

<el-row v-loading="walletLoading" :gutter="20" class="dashboard-balance-row" style="margin-bottom:28px">
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#409eff"><DollarSign :size="20" color="#fff"/></div><div><div class="label">可用额度</div><div class="value">{{ walletAmount('total_balance') }}</div></div></div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#409eff"><Wallet :size="20" color="#fff"/></div><div><div class="label">额度点数</div><div class="value">{{ walletAmount('quota_balance') }}</div></div></div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#f59e0b"><Gift :size="20" color="#fff"/></div><div><div class="label">赠送点数</div><div class="value">{{ walletAmount('gift_quota') }}</div></div></div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#8b5cf6"><Activity :size="20" color="#fff"/></div><div><div class="label">累计消费</div><div class="value">{{ walletAmount('total_spent') }}</div></div></div></div></el-col>
</el-row>

<el-row :gutter="20" class="dashboard-action-row" style="margin-bottom:28px">
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/wallet')" style="cursor:pointer"><div class="dashboard-action-content" style="text-align:center;padding:12px"><div class="action-icon" style="background:#409eff"><ShoppingCart :size="24" color="#fff"/></div><div class="dashboard-action-title" style="margin-top:12px;font-weight:600;font-size:15px">购买额度包</div><div class="dashboard-action-description" style="font-size:12px;color:var(--text-muted);margin-top:4px">支付宝 / 微信支付</div></div></el-card></el-col>
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/keys')" style="cursor:pointer"><div class="dashboard-action-content" style="text-align:center;padding:12px"><div class="action-icon" style="background:#409eff"><Key :size="24" color="#fff"/></div><div class="dashboard-action-title" style="margin-top:12px;font-weight:600;font-size:15px">创建 API Key</div><div class="dashboard-action-description" style="font-size:12px;color:var(--text-muted);margin-top:4px">管理 API 密钥</div></div></el-card></el-col>
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/keys')" style="cursor:pointer"><div class="dashboard-action-content" style="text-align:center;padding:12px"><div class="action-icon" style="background:#f59e0b"><BookOpen :size="24" color="#fff"/></div><div class="dashboard-action-title" style="margin-top:12px;font-weight:600;font-size:15px">API 使用说明</div><div class="dashboard-action-description" style="font-size:12px;color:var(--text-muted);margin-top:4px">各渠道接入指南</div></div></el-card></el-col>
</el-row>

<div v-if="isMobile" class="mobile-stats-card">
  <div class="mobile-stats-head"><strong>今日调用</strong><el-button size="small" text :loading="chartLoading" @click="fetchStats"><RefreshCw :size="14"/>刷新</el-button></div>
  <div class="mobile-stats-grid"><div><span>总调用</span><strong>{{ stats.today_calls||0 }}</strong></div><div><span>成功</span><strong class="success-value">{{ todaySuccess }}</strong></div><div><span>累计费用</span><strong>{{ Number(stats.total_consumption||0).toFixed(4) }} 点</strong></div></div>
  <div v-if="stats.model_usage?.length" class="mobile-rank"><span>常用模型</span><div v-for="item in stats.model_usage.slice(0,3)" :key="item.model_code"><code>{{ item.model_code }}</code><strong>{{ item.calls }} 次</strong></div></div>
</div>
<DashboardCharts v-else :stats="stats" :loading="chartLoading" @refresh="fetchStats"/>

<el-card v-loading="modelsLoading" style="margin-top:20px"><template #header><div style="display:flex;align-items:center;gap:8px"><Cpu :size="18" color="#409eff"/> 可用模型</div></template>
<el-table :data="models" stripe size="small" :empty-text="hasApiKeys?'当前路由分组暂无可用模型':'尚未创建路由分组 API Key'"><el-table-column label="模型" min-width="220"><template #default="{row}"><strong>{{ row.model_name }}</strong><div class="dashboard-model-code">{{ row.model_code }}</div></template></el-table-column><el-table-column label="协议" min-width="180"><template #default="{row}">{{ protocolLabel(row.protocol_types) }}</template></el-table-column><el-table-column label="类型" width="100"><template #default="{row}"><el-tag size="small" effect="plain">{{ modelTypeLabel(row.model_type) }}</el-tag></template></el-table-column></el-table>
</el-card>
</div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';import { useAppStore } from '@/stores/app';import { useAuthStore } from '@/stores/auth';import api from '@/api'
import { DollarSign, Wallet, Gift, Activity, ShoppingCart, Key, BookOpen, Cpu, RefreshCw } from '@lucide/vue'
import { useMobile } from '@/composables/useMobile'

const appStore=useAppStore(),authStore=useAuthStore(),stats=ref({}),models=ref([]),hasApiKeys=ref(false),chartLoading=ref(true),modelsLoading=ref(true)
const DashboardCharts=defineAsyncComponent(()=>import('@/components/DashboardCharts.vue'))
const isMobile=useMobile()
const wallet=computed(()=>{
  const source=authStore.wallet
  if(!source)return null
  const quotaBalance=Number(source.quota_balance??source.recharge_balance??0)
  const giftQuota=Number(source.gift_quota??source.gift_balance??0)
  return {...source,quota_balance:quotaBalance,gift_quota:giftQuota,total_balance:quotaBalance+giftQuota-Number(source.frozen_balance||0)}
})
const walletLoading=computed(()=>!wallet.value&&!authStore.authError)
const todaySuccess=computed(()=>stats.value.today_status?.find(item=>item.status==='success')?.count||0)

async function fetchStats(){chartLoading.value=true;try{const s=await api.get('/api/user/stats');stats.value=s.data}catch(e){}finally{chartLoading.value=false}}
async function fetchModels(){modelsLoading.value=true;try{const m=await api.get('/api/user/models');models.value=m.data.data||[];hasApiKeys.value=Boolean(m.data.has_api_keys)}catch(e){}finally{modelsLoading.value=false}}

function walletAmount(field){return wallet.value?`${Number(wallet.value[field]||0).toFixed(4)} 点`:'—'}
function protocolLabel(protocols=[]){return protocols.map(protocol=>protocol==='anthropic'?'Anthropic Messages':'OpenAI 兼容').join(' / ')||'—'}
function modelTypeLabel(modelType){return modelType==='image'?'生图':'LLM'}
onMounted(()=>{void fetchStats();void fetchModels()})
</script>

<style scoped>
.kpi-row-inner{display:flex;align-items:center;gap:16px}
.kpi-icon-bg{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.action-icon{width:48px;height:48px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center}
.mobile-stats-card{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px}.mobile-stats-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.mobile-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mobile-stats-grid>div{background:#f8fafc;border-radius:10px;padding:10px}.mobile-stats-grid span,.mobile-rank>span{display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px}.mobile-stats-grid strong{font-size:13px}.success-value{color:#16a34a}.mobile-rank{border-top:1px solid var(--border);margin-top:13px;padding-top:11px}.mobile-rank>div{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0}.mobile-rank code{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-rank strong{font-size:12px;white-space:nowrap}
.dashboard-model-code{font-size:11px;color:#94a3b8;font-family:monospace;margin-top:2px}
@media(max-width:768px){
  .page-container>:deep(.el-alert){margin-bottom:10px!important}
  .dashboard-balance-row{margin-left:0!important;margin-right:0!important;row-gap:0!important;overflow:hidden;border-radius:12px}
  .dashboard-balance-row>[class*="el-col-"]{flex:0 0 50%;max-width:50%;padding:0!important}
  .dashboard-balance-row .stat-card{min-height:70px;padding:10px;border-radius:0;box-shadow:none}
  .dashboard-balance-row>[class*="el-col-"]:nth-child(1) .stat-card{border-radius:12px 0 0 0}
  .dashboard-balance-row>[class*="el-col-"]:nth-child(2) .stat-card{border-radius:0 12px 0 0}
  .dashboard-balance-row>[class*="el-col-"]:nth-child(3) .stat-card{border-radius:0 0 0 12px}
  .dashboard-balance-row>[class*="el-col-"]:nth-child(4) .stat-card{border-radius:0 0 12px 0}
  .dashboard-balance-row>[class*="el-col-"]:nth-child(even) .stat-card{margin-left:-1px}
  .dashboard-balance-row>[class*="el-col-"]:nth-child(n+3) .stat-card{margin-top:-1px}
  .dashboard-balance-row .kpi-row-inner{gap:8px}
  .dashboard-balance-row .kpi-icon-bg{width:32px;height:32px;border-radius:9px}
  .dashboard-balance-row .label{font-size:11px;margin-bottom:1px;letter-spacing:0;text-transform:none}
  .dashboard-balance-row .value{font-size:15px;letter-spacing:0;white-space:nowrap}
  .dashboard-action-row{margin-left:-3px!important;margin-right:-3px!important;row-gap:0!important}
  .dashboard-action-row>[class*="el-col-"]{flex:0 0 33.333%;max-width:33.333%;padding:0 3px!important}
  .dashboard-action-row .el-card{height:100%;border-radius:10px!important;box-shadow:none!important}
  .dashboard-action-row :deep(.el-card__body){height:100%;padding:9px 3px!important}
  .dashboard-action-content{padding:0!important}
  .dashboard-action-row .action-icon{width:34px;height:34px;border-radius:10px}
  .dashboard-action-title{margin-top:6px!important;font-size:12px!important;white-space:nowrap}
  .dashboard-action-description{display:none}
  .mobile-stats-card{padding:11px 12px;margin-bottom:10px;border-radius:12px}
  .mobile-stats-head{margin-bottom:7px}
  .mobile-stats-grid{grid-template-columns:repeat(3,1fr);gap:0}
  .mobile-stats-grid>div{padding:5px 7px;border-radius:0}
  .mobile-rank{margin-top:8px;padding-top:7px}
  .page-container>.el-row{margin-bottom:10px!important}
  .page-container>.el-card{margin-top:10px!important}
}
@media(min-width:769px) and (max-width:1180px){.dashboard-balance-row>[class*="el-col-"]{flex:0 0 50%;max-width:50%}.dashboard-balance-row .stat-card{padding:20px}.dashboard-balance-row .stat-card .value{font-size:26px}}
</style>
