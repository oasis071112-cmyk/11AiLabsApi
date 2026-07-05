<template>
<div class="page-container">
<el-alert v-if="appStore.platformInfo.announcement" :title="appStore.platformInfo.announcement" type="info" show-icon :closable="false" style="margin-bottom:16px"/>
<el-row :gutter="16" style="margin-bottom:24px">
<el-col :span="6"><div class="stat-card"><div class="label">可用额度</div><div class="value">{{ wallet?.total_balance?.toFixed(4)||'0.00' }} 点</div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="label">额度点数</div><div class="value">{{ wallet?.quota_balance?.toFixed(4)||'0.00' }} 点</div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="label">赠送点数</div><div class="value">{{ wallet?.gift_quota?.toFixed(4)||'0.00' }} 点</div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="label">累计消费</div><div class="value">{{ wallet?.total_spent?.toFixed(4)||'0.00' }} 点</div></div></el-col>
</el-row>
<el-row :gutter="16" style="margin-bottom:24px">
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/wallet')" style="cursor:pointer"><div style="text-align:center;padding:16px"><el-icon size="32" color="#409eff"><Wallet/></el-icon><div style="margin-top:8px;font-weight:600">购买额度包</div><div style="font-size:12px;color:#909399;margin-top:4px">支付宝/微信/USDT</div></div></el-card></el-col>
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/keys')" style="cursor:pointer"><div style="text-align:center;padding:16px"><el-icon size="32" color="#67c23a"><Key/></el-icon><div style="margin-top:8px;font-weight:600">创建 API Key</div><div style="font-size:12px;color:#909399;margin-top:4px">管理 API 密钥</div></div></el-card></el-col>
<el-col :span="8"><el-card shadow="hover" @click="$router.push('/docs')" style="cursor:pointer"><div style="text-align:center;padding:16px"><el-icon size="32" color="#e6a23c"><Reading/></el-icon><div style="margin-top:8px;font-weight:600">接入文档</div><div style="font-size:12px;color:#909399;margin-top:4px">API 调用指南</div></div></el-card></el-col>
</el-row>
<el-row :gutter="16">
<el-col :span="12"><el-card header="📊 今日统计"><div style="display:flex;justify-content:space-around;text-align:center"><div><div style="font-size:24px;font-weight:700">{{ stats.today_consumption?.toFixed(6)||0 }}</div><div style="color:#909399;font-size:12px">今日消费</div></div><div><div style="font-size:24px;font-weight:700">{{ stats.total_calls||0 }}</div><div style="color:#909399;font-size:12px">总调用次数</div></div><div><div style="font-size:24px;font-weight:700">{{ stats.total_consumption?.toFixed(2)||0 }}</div><div style="color:#909399;font-size:12px">累计消费</div></div></div></el-card></el-col>
<el-col :span="12"><el-card header="🔥 模型使用排行"><div v-if="stats.model_usage?.length"><div v-for="m in stats.model_usage.slice(0,5)" :key="m.model_code" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0"><span>{{ m.model_code }}</span><span style="color:#909399">{{ m.calls }} 次 / {{ m.cost?.toFixed(4) }} 点</span></div></div><el-empty v-else description="暂无数据" :image-size="60"/></el-card></el-col>
</el-row>
<el-card header="🤖 可用模型" style="margin-top:16px">
<el-table :data="models" stripe size="small"><el-table-column prop="model_name" label="模型名称"/><el-table-column prop="model_type" label="类型" width="100"><template #default="{row}"><el-tag size="small">{{ row.model_type }}</el-tag></template></el-table-column><el-table-column label="输入倍率" width="120"><template #default="{row}">×{{ row.display_multiplier_input }}</template></el-table-column><el-table-column label="输出倍率" width="120"><template #default="{row}">×{{ row.display_multiplier_output }}</template></el-table-column><el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip/></el-table>
</el-card>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import { useAppStore } from '@/stores/app';import api from '@/api'
const appStore=useAppStore(),wallet=ref({}),stats=ref({}),models=ref([])
onMounted(async()=>{appStore.fetchPlatformInfo();try{const[w,s,m]=await Promise.all([api.get('/api/user/wallet'),api.get('/api/user/stats'),api.get('/api/user/models')]);wallet.value=w.data;wallet.value.total_balance=(w.data.quota_balance||w.data.recharge_balance||0)+(w.data.gift_quota||w.data.gift_balance||0);stats.value=s.data;models.value=m.data.data||[]}catch(e){}})
</script>