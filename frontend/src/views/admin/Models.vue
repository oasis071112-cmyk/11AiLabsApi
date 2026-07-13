<template>
<div><div class="flex-between mb-16"><h3>模型管理</h3><div><el-button :loading="syncing" @click="syncPricing">同步官方价格与汇率</el-button><el-button type="primary" @click="openDialog()">+ 新增模型</el-button></div></div>
<el-table :data="models" stripe v-loading="loading">
<el-table-column prop="model_code" label="编码" width="150"/><el-table-column prop="model_name" label="显示名称" width="150"/>
<el-table-column prop="upstream_model_name" label="上游名称" min-width="160"/><el-table-column prop="model_type" label="类型" width="80"/>
<el-table-column prop="channel_name" label="归属渠道" width="120">
  <template #default="{row}"><el-tag v-if="row.channel_name" size="small" type="info">{{ row.channel_name }}</el-tag><span v-else style="color:#909399">未分配</span></template>
</el-table-column>
<el-table-column label="输入倍率" width="90"><template #default="{row}">×{{ row.billing_multiplier_input }}</template></el-table-column>
<el-table-column label="输出倍率" width="90"><template #default="{row}">×{{ row.billing_multiplier_output }}</template></el-table-column>
<el-table-column label="官方价格" width="180"><template #default="{row}"><span v-if="row.official_input_price||row.official_output_price">{{ currency(row.official_currency) }} 入{{ row.official_input_price }}/出{{ row.official_output_price }} / 1M</span><span v-else style="color:#e6a23c">待同步</span></template></el-table-column>
<el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status }}</el-tag></template></el-table-column>
<el-table-column label="操作" width="160"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleStatus(row)">{{ row.status==='active'?'下架':'上架' }}</el-button></template></el-table-column>
</el-table>

<el-dialog v-model="dialogVisible" :title="isEdit?'编辑模型':'新增模型'" width="600px"><el-form :model="form" label-width="120px">
<el-form-item label="模型编码"><el-input v-model="form.model_code" :disabled="isEdit"/></el-form-item>
<el-form-item label="显示名称"><el-input v-model="form.model_name"/></el-form-item>
<el-form-item label="上游模型名"><el-input v-model="form.upstream_model_name"/></el-form-item>
<el-form-item label="类型"><el-select v-model="form.model_type"><el-option value="llm" label="LLM 对话"/><el-option value="embedding" label="Embedding"/><el-option value="image" label="图像"/><el-option value="audio" label="音频"/></el-select></el-form-item>
<el-form-item label="上下文长度"><el-input-number v-model="form.context_length" :min="0" :step="1024"/></el-form-item>
<el-form-item label="多模态"><el-switch v-model="form.is_multimodal"/></el-form-item>
<el-form-item label="输入基础价"><el-input-number v-model="form.base_input_price" :min="0" :step="0.0001" :precision="6"/></el-form-item>
<el-form-item label="输出基础价"><el-input-number v-model="form.base_output_price" :min="0" :step="0.0001" :precision="6"/></el-form-item>
<el-form-item label="展示倍率(入)"><el-input-number v-model="form.display_multiplier_input" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="展示倍率(出)"><el-input-number v-model="form.display_multiplier_output" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="扣费倍率(入)"><el-input-number v-model="form.billing_multiplier_input" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="扣费倍率(出)"><el-input-number v-model="form.billing_multiplier_output" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="官方提供方"><el-select v-model="form.official_provider"><el-option value="manual" label="手动维护"/><el-option value="openai" label="OpenAI"/><el-option value="deepseek" label="DeepSeek"/><el-option value="anthropic" label="Anthropic"/></el-select></el-form-item>
<el-form-item label="官方模型标识"><el-input v-model="form.official_model_id" placeholder="例如 gpt-5.5"/></el-form-item>
<el-form-item v-if="form.channel_id" label="渠道成本币种"><el-select v-model="form.channel_cost.currency"><el-option value="CNY" label="人民币 CNY"/><el-option value="USD" label="美元 USD"/></el-select></el-form-item>
<el-form-item v-if="form.channel_id" label="渠道输入成本"><el-input-number v-model="form.channel_cost.input_price" :min="0" :step="0.0001" :precision="6"/><span class="hint">每 1M Token，仅管理端可见</span></el-form-item>
<el-form-item v-if="form.channel_id" label="渠道输出成本"><el-input-number v-model="form.channel_cost.output_price" :min="0" :step="0.0001" :precision="6"/><span class="hint">每 1M Token，仅管理端可见</span></el-form-item>
<el-form-item v-if="form.channel_id" label="渠道缓存成本"><el-input-number v-model="form.channel_cost.cached_input_price" :min="0" :step="0.0001" :precision="6"/><span class="hint">每 1M Token</span></el-form-item>
<el-form-item label="描述"><el-input v-model="form.description" type="textarea"/></el-form-item>
</el-form><template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const models=ref([]),loading=ref(false),dialogVisible=ref(false),isEdit=ref(false),saving=ref(false),syncing=ref(false)
const emptyForm=()=>({model_code:'',model_name:'',upstream_model_name:'',model_type:'llm',context_length:4096,is_multimodal:false,base_input_price:0,base_output_price:0,display_multiplier_input:1,display_multiplier_output:1,billing_multiplier_input:1,billing_multiplier_output:1,official_provider:'manual',official_model_id:'',description:'',channel_cost:{currency:'CNY',input_price:0,output_price:0,cached_input_price:0}})
const form=ref(emptyForm())
onMounted(()=>fetchModels())
async function fetchModels(){loading.value=true;try{models.value=(await api.get('/api/admin/models')).data.data}catch(e){}loading.value=false}
async function openDialog(row){isEdit.value=!!row;form.value=row?{...row,channel_cost:{currency:'CNY',input_price:0,output_price:0,cached_input_price:0}}:emptyForm();if(row?.channel_id){try{const costs=(await api.get(`/api/admin/channels/${row.channel_id}/costs`)).data.data||[];form.value.channel_cost=costs.find(c=>c.model_code===row.model_code)||form.value.channel_cost}catch(e){}}dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value){await api.put(`/api/admin/models/${form.value.id}`,form.value);if(form.value.channel_id)await api.put(`/api/admin/channels/${form.value.channel_id}/costs/${encodeURIComponent(form.value.model_code)}`,form.value.channel_cost)}else{await api.post('/api/admin/models',form.value)}ElMessage.success('保存成功');dialogVisible.value=false;fetchModels()}catch(e){}saving.value=false}
async function toggleStatus(row){const ns=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/models/${row.id}/status`,{status:ns});ElMessage.success('状态已更新');fetchModels()}
async function syncPricing(){syncing.value=true;try{const r=await api.post('/api/admin/pricing-sync');ElMessage.success(`同步完成：更新 ${r.data.official_pricing.updated} 个模型，USD/CNY=${r.data.exchange_rate.rate}`);fetchModels()}catch(e){}syncing.value=false}
function currency(value){return value==='USD'?'$':'¥'}
</script>
<style scoped>.hint{margin-left:8px;color:#909399;font-size:12px}</style>
