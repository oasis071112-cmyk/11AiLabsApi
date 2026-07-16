<template>
<div class="page-container">
<el-alert v-if="appStore.platformInfo.announcement" :title="appStore.platformInfo.announcement" type="info" show-icon :closable="false" style="margin-bottom:24px"/>

<el-row :gutter="20" style="margin-bottom:28px">
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#409eff"><DollarSign :size="20" color="#fff"/></div><div><div class="label">可用额度</div><div class="value">{{ wallet?.total_balance?.toFixed(4)||'0.00' }} 点</div></div></div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#409eff"><Wallet :size="20" color="#fff"/></div><div><div class="label">额度点数</div><div class="value">{{ wallet?.quota_balance?.toFixed(4)||'0.00' }} 点</div></div></div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#f59e0b"><Gift :size="20" color="#fff"/></div><div><div class="label">赠送点数</div><div class="value">{{ wallet?.gift_quota?.toFixed(4)||'0.00' }} 点</div></div></div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="kpi-row-inner"><div class="kpi-icon-bg" style="background:#8b5cf6"><Activity :size="20" color="#fff"/></div><div><div class="label">累计消费</div><div class="value">{{ wallet?.total_spent?.toFixed(4)||'0.00' }} 点</div></div></div></div></el-col>
</el-row>

<el-row :gutter="20" style="margin-bottom:28px">
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/wallet')" style="cursor:pointer"><div style="text-align:center;padding:12px"><div class="action-icon" style="background:#409eff"><ShoppingCart :size="24" color="#fff"/></div><div style="margin-top:12px;font-weight:600;font-size:15px">购买额度包</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">支付宝 / 微信 / USDT</div></div></el-card></el-col>
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/keys')" style="cursor:pointer"><div style="text-align:center;padding:12px"><div class="action-icon" style="background:#409eff"><Key :size="24" color="#fff"/></div><div style="margin-top:12px;font-weight:600;font-size:15px">创建 API Key</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">管理 API 密钥</div></div></el-card></el-col>
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/keys')" style="cursor:pointer"><div style="text-align:center;padding:12px"><div class="action-icon" style="background:#f59e0b"><BookOpen :size="24" color="#fff"/></div><div style="margin-top:12px;font-weight:600;font-size:15px">API 使用说明</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">各渠道接入指南</div></div></el-card></el-col>
</el-row>

<div v-if="isMobile" class="mobile-stats-card">
  <div class="mobile-stats-head"><strong>今日调用</strong><el-button size="small" text :loading="chartLoading" @click="fetchStats"><RefreshCw :size="14"/>刷新</el-button></div>
  <div class="mobile-stats-grid"><div><span>总调用</span><strong>{{ stats.today_calls||0 }}</strong></div><div><span>成功</span><strong class="success-value">{{ todaySuccess }}</strong></div><div><span>累计费用</span><strong>{{ Number(stats.total_consumption||0).toFixed(4) }} 点</strong></div></div>
  <div v-if="stats.model_usage?.length" class="mobile-rank"><span>常用模型</span><div v-for="item in stats.model_usage.slice(0,3)" :key="item.model_code"><code>{{ item.model_code }}</code><strong>{{ item.calls }} 次</strong></div></div>
</div>
<DashboardCharts v-else :stats="stats" :loading="chartLoading" @refresh="fetchStats"/>

<el-card style="margin-top:20px"><template #header><div style="display:flex;align-items:center;gap:8px"><Cpu :size="18" color="#409eff"/> 可用模型</div></template>
<el-table :data="models" stripe size="small"><el-table-column prop="model_name" label="模型名称"/><el-table-column prop="model_type" label="类型" width="100"><template #default="{row}"><el-tag size="small" effect="plain">{{ row.model_type }}</el-tag></template></el-table-column><el-table-column label="输入扣费倍率" width="140"><template #default="{row}"><span style="font-weight:600">×{{ row.billing_multiplier_input }}</span></template></el-table-column><el-table-column label="输出扣费倍率" width="140"><template #default="{row}"><span style="font-weight:600">×{{ row.billing_multiplier_output }}</span></template></el-table-column></el-table>
</el-card>
</div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, ref } from 'vue';import { useAppStore } from '@/stores/app';import api from '@/api'
import { DollarSign, Wallet, Gift, Activity, ShoppingCart, Key, BookOpen, Cpu, RefreshCw } from '@lucide/vue'
import { useMobile } from '@/composables/useMobile'

const appStore=useAppStore(),wallet=ref({}),stats=ref({}),models=ref([]),chartLoading=ref(false)
const DashboardCharts=defineAsyncComponent(()=>import('@/components/DashboardCharts.vue'))
const isMobile=useMobile()
const todaySuccess=computed(()=>stats.value.today_status?.find(item=>item.status==='success')?.count||0)

async function fetchStats(){chartLoading.value=true;try{const s=await api.get('/api/user/stats');stats.value=s.data}catch(e){}chartLoading.value=false}

onMounted(async()=>{appStore.fetchPlatformInfo();try{const[w,s,m]=await Promise.all([api.get('/api/user/wallet'),api.get('/api/user/stats'),api.get('/api/user/models')]);wallet.value=w.data;wallet.value.total_balance=(w.data.quota_balance||w.data.recharge_balance||0)+(w.data.gift_quota||w.data.gift_balance||0);stats.value=s.data;models.value=m.data.data||[]}catch(e){}})
</script>

<style scoped>
.kpi-row-inner{display:flex;align-items:center;gap:16px}
.kpi-icon-bg{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.action-icon{width:48px;height:48px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center}
.mobile-stats-card{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px}.mobile-stats-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.mobile-stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mobile-stats-grid>div{background:#f8fafc;border-radius:10px;padding:10px}.mobile-stats-grid span,.mobile-rank>span{display:block;font-size:11px;color:var(--text-muted);margin-bottom:3px}.mobile-stats-grid strong{font-size:13px}.success-value{color:#16a34a}.mobile-rank{border-top:1px solid var(--border);margin-top:13px;padding-top:11px}.mobile-rank>div{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0}.mobile-rank code{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-rank strong{font-size:12px;white-space:nowrap}
@media(max-width:768px){.kpi-row-inner{gap:12px}.kpi-icon-bg{width:38px;height:38px}.action-icon{width:42px;height:42px}.mobile-stats-grid{grid-template-columns:1fr}.page-container>.el-row{margin-bottom:14px!important}.page-container>.el-card{margin-top:14px!important}}
</style>
