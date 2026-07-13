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

<el-row :gutter="20">
<el-col :span="12">
  <el-card class="chart-card"><template #header><div style="display:flex;align-items:center;gap:8px;width:100%"><BarChart3 :size="18" color="#409eff"/> 今日统计<el-button size="small" text @click="fetchStats" :loading="chartLoading" style="margin-left:auto"><RefreshCw :size="14"/></el-button></div></template>
    <v-chart :option="todayStatsOption" autoresize style="height:300px" v-if="stats.today_calls"/>
    <el-empty v-else description="暂无数据" :image-size="60" style="padding:40px 0"/>
  </el-card>
</el-col>
<el-col :span="12">
  <el-card class="chart-card"><template #header><div style="display:flex;align-items:center;gap:8px;width:100%"><TrendingUp :size="18" color="#f59e0b"/> 模型使用排行<el-button size="small" text @click="fetchStats" :loading="chartLoading" style="margin-left:auto"><RefreshCw :size="14"/></el-button></div></template>
    <v-chart :option="modelRankOption" autoresize style="height:300px" v-if="stats.model_usage?.length"/>
    <el-empty v-else description="暂无数据" :image-size="60" style="padding:40px 0"/>
  </el-card>
</el-col>
</el-row>

<el-card style="margin-top:20px"><template #header><div style="display:flex;align-items:center;gap:8px"><Cpu :size="18" color="#409eff"/> 可用模型</div></template>
<el-table :data="models" stripe size="small"><el-table-column prop="model_name" label="模型名称"/><el-table-column prop="model_type" label="类型" width="100"><template #default="{row}"><el-tag size="small" effect="plain">{{ row.model_type }}</el-tag></template></el-table-column><el-table-column label="输入扣费倍率" width="140"><template #default="{row}"><span style="font-weight:600">×{{ row.billing_multiplier_input }}</span></template></el-table-column><el-table-column label="输出扣费倍率" width="140"><template #default="{row}"><span style="font-weight:600">×{{ row.billing_multiplier_output }}</span></template></el-table-column></el-table>
</el-card>
</div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';import { useAppStore } from '@/stores/app';import api from '@/api'
import { DollarSign, Wallet, Gift, Activity, ShoppingCart, Key, BookOpen, BarChart3, TrendingUp, Cpu, RefreshCw } from '@lucide/vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'

use([CanvasRenderer, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent])

const appStore=useAppStore(),wallet=ref({}),stats=ref({}),models=ref([]),chartLoading=ref(false)

async function fetchStats(){chartLoading.value=true;try{const s=await api.get('/api/user/stats');stats.value=s.data}catch(e){}chartLoading.value=false}

onMounted(async()=>{appStore.fetchPlatformInfo();try{const[w,s,m]=await Promise.all([api.get('/api/user/wallet'),api.get('/api/user/stats'),api.get('/api/user/models')]);wallet.value=w.data;wallet.value.total_balance=(w.data.quota_balance||w.data.recharge_balance||0)+(w.data.gift_quota||w.data.gift_balance||0);stats.value=s.data;models.value=m.data.data||[]}catch(e){}})

const todayStatsOption = computed(() => {
  const s = stats.value; const total = s.today_calls || 1
  const success = s.today_status?.find(x => x.status === 'success')?.count || 0
  const failed = s.today_status?.find(x => x.status === 'failed')?.count || 0
  const blocked = s.today_status?.find(x => x.status === 'blocked')?.count || 0
  const rate = ((success / total) * 100).toFixed(1)
  return {
    tooltip: { trigger: 'axis' },
    grid: { containLabel: true, left: '56%', right: 10, top: 10, bottom: 30 },
    xAxis: { type: 'value', max: Math.max(success, failed, blocked, 1), splitLine: { lineStyle: { color: '#f1f5f9' } } },
    yAxis: { type: 'category', data: ['成功', '失败', '拦截'], axisLabel: { fontSize: 13 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { type: 'bar', barWidth: 20, itemStyle: { borderRadius: [0, 6, 6, 0] },
        data: [{ value: success, itemStyle: { color: '#22c55e' } }, { value: failed, itemStyle: { color: '#ef4444' } }, { value: blocked, itemStyle: { color: '#f59e0b' } }] },
      { type: 'pie', center: ['20%', '50%'], radius: ['48%', '58%'],
        label: { show: true, position: 'center', formatter: `{b|${rate}%}\n{a|成功率}`, rich: { b: { fontSize: 22, fontWeight: 800, color: '#22c55e' }, a: { fontSize: 11, color: '#64748b', padding: [4,0,0,0] } } },
        labelLine: { show: false },
        data: [{ value: success, name: '成功', itemStyle: { color: '#22c55e' } }, { value: total - success, name: '其他', itemStyle: { color: '#f1f5f9' } }] }
    ]
  }
})

const modelRankOption = computed(() => {
  const top = stats.value.model_usage?.slice(0, 8) || []
  const top1 = top[0]
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { containLabel: true, left: '56%', right: 10, top: 10, bottom: 30 },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f1f5f9' } } },
    yAxis: { type: 'category', data: top.map(m => m.model_code).reverse(), axisLabel: { fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { type: 'bar', data: top.map(m => m.calls).reverse(), barWidth: 14, itemStyle: { borderRadius: [0, 6, 6, 0], color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#409eff' }, { offset: 1, color: '#93c5fd' }] } } },
      ...(top1 ? [{ type: 'pie', center: ['20%', '50%'], radius: ['48%', '58%'],
        label: { show: true, position: 'center', formatter: `{b|${top1.calls}次}\n{a|TOP 1 调用量}`, rich: { b: { fontSize: 18, fontWeight: 800, color: '#409eff' }, a: { fontSize: 10, color: '#64748b', padding: [3,0,0,0] } } },
        labelLine: { show: false },
        data: [{ value: top1.calls, name: top1.model_code, itemStyle: { color: '#409eff' } }, { value: Math.max(0, top.reduce((s,m) => s + m.calls, 0) - top1.calls), name: '其他', itemStyle: { color: '#f1f5f9' } }] }] : [])
    ]
  }
})
</script>

<style scoped>
.kpi-row-inner{display:flex;align-items:center;gap:16px}
.kpi-icon-bg{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.action-icon{width:48px;height:48px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center}
.chart-card :deep(.el-card__body) { padding: 12px 16px }
</style>
