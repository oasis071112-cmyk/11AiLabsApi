<template>
<div class="dashboard">
  <!-- KPI -->
  <el-row :gutter="16" class="kpi-row">
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#0EA5E9"><Cpu :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">可用模型</div><div class="kpi-value">{{ models.length }}</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#22c55e"><MessageSquare :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">对话模型</div><div class="kpi-value">{{ models.filter(m=>m.model_type==='llm').length }}</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#f59e0b"><Image :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">多模态</div><div class="kpi-value">{{ models.filter(m=>m.is_multimodal).length }}</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#8b5cf6"><Hash :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">其他类型</div><div class="kpi-value">{{ models.filter(m=>m.model_type!=='llm').length }}</div></div></div></el-col>
  </el-row>

  <!-- 表格 -->
  <div class="chart-card">
    <div class="chart-header"><Cpu :size="14" color="var(--primary)"/><span>模型列表、官方定价与倍率</span><span class="price-note">1 点 = ¥1；美元价格按调用时汇率自动折算</span></div>
    <div class="chart-body">
      <el-table :data="models">
        <el-table-column prop="model_name" label="模型名称"/>
        <el-table-column prop="model_code" label="编码" width="160"/>
        <el-table-column label="类型" width="90"><template #default="{row}"><el-tag size="small" effect="plain">{{ tl(row.model_type) }}</el-tag></template></el-table-column>
        <el-table-column label="上下文" width="100" align="right"><template #default="{row}">{{ fc(row.context_length) }}</template></el-table-column>
        <el-table-column label="多模态" width="80" align="center"><template #default="{row}"><span :style="{color:row.is_multimodal?'#22c55e':'#a3a3a3',fontWeight:600,fontSize:'15px'}">{{ row.is_multimodal?'✓':'—' }}</span></template></el-table-column>
        <el-table-column label="官方输入价" width="150" align="right"><template #default="{row}">{{ price(row.official_input_price,row.official_currency) }} / 1M</template></el-table-column>
        <el-table-column label="官方输出价" width="150" align="right"><template #default="{row}">{{ price(row.official_output_price,row.official_currency) }} / 1M</template></el-table-column>
        <el-table-column label="输入扣费倍率" width="120" align="right"><template #default="{row}"><span style="font-weight:600;font-size:14px">×{{ row.billing_multiplier_input }}</span></template></el-table-column>
        <el-table-column label="输出扣费倍率" width="120" align="right"><template #default="{row}"><span style="font-weight:600;font-size:14px">×{{ row.billing_multiplier_output }}</span></template></el-table-column>
        <el-table-column prop="description" label="描述" show-overflow-tooltip/>
      </el-table>
    </div>
  </div>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { Cpu, MessageSquare, Image, Hash } from '@lucide/vue'
const models=ref([])
onMounted(async()=>{try{models.value=(await api.get('/api/user/models')).data.data}catch(e){}})
function tl(t){const m={llm:'对话',embedding:'嵌入',image:'图像',audio:'音频',video:'视频'};return m[t]||t}
function fc(n){return n>=1000?`${(n/1000).toFixed(0)}K`:n}
function price(value,currency){if(!value)return '待同步';return `${currency==='USD'?'$':'¥'}${Number(value).toFixed(4)}`}
</script>

<style scoped>
.dashboard{padding:28px 32px}
.kpi-row{margin-bottom:16px}
.kpi-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:box-shadow .2s}
.kpi-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.05)}
.kpi-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-body{flex:1;min-width:0}
.kpi-label{font-size:12px;color:#525252;margin-bottom:4px;font-weight:500;text-transform:uppercase}
.kpi-value{font-size:24px;font-weight:700;color:#000;white-space:nowrap}
.chart-card{background:rgba(255,255,255,0.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(232,235,229,0.7);border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.04);margin-bottom:20px}
.chart-header{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid rgba(0,0,0,0.06);font-size:14px;font-weight:600;color:var(--text-primary)}
.price-note{margin-left:auto;font-size:12px;font-weight:400;color:#737373}
.chart-body{padding:8px 12px 8px 12px}
</style>
