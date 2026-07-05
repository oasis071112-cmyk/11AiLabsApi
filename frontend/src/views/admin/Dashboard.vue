<template>
<div>
<el-row :gutter="16" style="margin-bottom:24px">
<el-col :span="4"><div class="stat-card"><div class="label">今日购买</div><div class="value">¥{{ data.today_recharge?.toFixed(2)||0 }}</div></div></el-col>
<el-col :span="4"><div class="stat-card"><div class="label">今日消费</div><div class="value">{{ data.today_consumption?.toFixed(2)||0 }} 点</div></div></el-col>
<el-col :span="4"><div class="stat-card"><div class="label">新增用户</div><div class="value">{{ data.new_users_today||0 }}</div></div></el-col>
<el-col :span="4"><div class="stat-card"><div class="label">今日调用</div><div class="value">{{ data.today_calls||0 }}</div></div></el-col>
<el-col :span="4"><div class="stat-card"><div class="label">失败数</div><div class="value text-danger">{{ data.failed_calls||0 }}</div></div></el-col>
<el-col :span="4"><div class="stat-card"><div class="label">活跃渠道</div><div class="value text-success">{{ data.active_channels||0 }}</div></div></el-col>
</el-row>
<el-row :gutter="16" style="margin-bottom:24px">
<el-col :span="4"><div class="stat-card"><div class="label">总收入</div><div class="value">¥{{ data
.total_revenue?.toFixed(2)||0 }}</div></div></el-col>
<el-col :span="4"><div class="stat-card"><div class="label">总用户</div><div class="value">{{ data.total_users||0 }}</div></div></el-col>
</el-row>
<el-row :gutter="16">
<el-col :span="14"><el-card header="📈 7天调用趋势"><div ref="trendChart" style="height:300px"></div></el-card></el-col>
<el-col :span="10"><el-card header="🏆 模型调用排行"><el-table :data="data.model_ranking" size="small" stripe><el-table-column prop="model_code" label="模型"/><el-table-column prop="calls" label="调用次数" width="100"/><el-table-column label="消费" width="120"><template #default="{row}">{{ row.cost?.toFixed(4) }} 点</template></el-table-column></el-table></el-card></el-col>
</el-row>
</div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';import api from '@/api';import * as echarts from 'echarts'
const data=ref({}),trendChart=ref(null)
onMounted(async()=>{try{data.value=(await api.get('/api/admin/dashboard')).data}catch(e){};await nextTick();setTimeout(drawChart,500)})
function drawChart(){if(!trendChart.value||!data.value.daily_trend)return;const c=echarts.init(trendChart.value);c.setOption({tooltip:{trigger:'axis'},legend:{data:['成功','失败']},xAxis:{type:'category',data:data.value.daily_trend.map(d=>d.date)},yAxis:{type:'value'},series:[{name:'成功',type:'line',data:data.value.daily_trend.map(d=>d.success_calls),smooth:true,color:'#67c23a'},{name:'失败',type:'line',data:data.value.daily_trend.map(d=>d.failed_calls),smooth:true,color:'#f56c6c'}]})}
</script>