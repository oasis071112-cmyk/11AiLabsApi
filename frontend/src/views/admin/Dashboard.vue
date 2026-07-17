<template>
<div>
<el-row class="dashboard-stats" :gutter="16" style="margin-bottom:24px">
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">今日购买</div><div class="value">¥{{ data.today_recharge?.toFixed(2)||0 }}</div></div></el-col>
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">今日消费</div><div class="value">{{ data.today_consumption?.toFixed(2)||0 }} 点</div></div></el-col>
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">新增用户</div><div class="value">{{ data.new_users_today||0 }}</div></div></el-col>
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">今日调用</div><div class="value">{{ data.today_calls||0 }}</div></div></el-col>
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">失败数</div><div class="value text-danger">{{ data.failed_calls||0 }}</div></div></el-col>
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">活跃渠道</div><div class="value text-success">{{ data.active_channels||0 }}</div></div></el-col>
</el-row>
<el-row class="dashboard-stats" :gutter="16" style="margin-bottom:24px">
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">总收入</div><div class="value">¥{{ data
.total_revenue?.toFixed(2)||0 }}</div></div></el-col>
<el-col :span="4" :xs="12"><div class="stat-card"><div class="label">总用户</div><div class="value">{{ data.total_users||0 }}</div></div></el-col>
</el-row>
<el-row :gutter="16">
<el-col :span="14"><el-card><template #header><div style="display:flex;align-items:center;gap:8px"><LineChart :size="18" color="#409eff"/> 7天调用趋势</div></template><div v-if="isMobile" class="mobile-trend-list"><div v-for="item in data.daily_trend||[]" :key="item.date"><span>{{ item.date }}</span><strong>{{ item.success_calls||0 }} 成功</strong><em>{{ item.failed_calls||0 }} 失败</em></div><el-empty v-if="!data.daily_trend?.length" description="暂无数据" :image-size="52"/></div><AdminTrendChart v-else :data="data.daily_trend||[]"/></el-card></el-col>
<el-col :span="10"><el-card><template #header><div style="display:flex;align-items:center;gap:8px"><Trophy :size="18" color="#f59e0b"/> 模型调用排行</div></template><el-table :data="data.model_ranking" size="small" stripe><el-table-column prop="model_code" label="模型"/><el-table-column prop="calls" label="调用次数" width="100"/><el-table-column label="消费" width="120"><template #default="{row}">{{ row.cost?.toFixed(4) }} 点</template></el-table-column></el-table></el-card></el-col>
</el-row>
</div>
</template>

<script setup>
import { defineAsyncComponent, onMounted, ref } from 'vue';import api from '@/api';import { LineChart, Trophy } from '@lucide/vue'
import { useMobile } from '@/composables/useMobile'
const data=ref({}),isMobile=useMobile()
const AdminTrendChart=defineAsyncComponent(()=>import('@/components/AdminTrendChart.vue'))
onMounted(async()=>{try{data.value=(await api.get('/api/admin/dashboard')).data}catch(e){}})
</script>

<style scoped>
.mobile-trend-list{display:grid;gap:6px}.mobile-trend-list>div{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;background:#f8fafc;border-radius:8px;padding:9px 10px;font-size:12px}.mobile-trend-list strong{color:#16a34a}.mobile-trend-list em{color:#dc2626;font-style:normal}
@media(max-width:768px){:deep(.dashboard-stats>.el-col){max-width:50%!important;flex:0 0 50%!important}.dashboard-stats .stat-card{min-height:102px;padding:14px 13px}.dashboard-stats .stat-card .label{margin-bottom:7px;letter-spacing:0}.dashboard-stats .stat-card .value{font-size:20px;line-height:1.25;overflow-wrap:anywhere}}
</style>
