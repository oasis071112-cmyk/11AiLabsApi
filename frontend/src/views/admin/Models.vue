<template>
<div>
  <div class="flex-between mb-16"><h3>模型管理</h3><div><el-button :loading="syncing" @click="syncPricing">同步官方价格与汇率</el-button><el-button type="primary" @click="openDialog()">+ 新增模型</el-button></div></div>
  <el-table :data="models" stripe v-loading="loading">
    <el-table-column prop="model_code" label="编码" width="170"/><el-table-column prop="model_name" label="显示名称" width="150"/>
    <el-table-column prop="channel_name" label="官方渠道" width="120"/><el-table-column prop="model_type" label="类型" width="80"/>
    <el-table-column label="官方价格" min-width="220"><template #default="{row}"><span v-if="row.official_input_price||row.official_output_price">{{ currency(row.official_currency) }} 输入 {{ row.official_input_price }} / 输出 {{ row.official_output_price }}（每 1M Token）</span><span v-else style="color:#e6a23c">待同步</span></template></el-table-column>
    <el-table-column label="用户扣费倍率" width="150"><template #default="{row}">输入 ×{{ row.billing_multiplier_input }} / 输出 ×{{ row.billing_multiplier_output }}</template></el-table-column>
    <el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status }}</el-tag></template></el-table-column>
    <el-table-column label="操作" width="160"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleStatus(row)">{{ row.status==='active'?'下架':'上架' }}</el-button></template></el-table-column>
  </el-table>
  <el-dialog v-model="dialogVisible" :title="isEdit?'编辑模型':'新增模型'" width="600px"><el-form :model="form" label-width="120px">
    <el-form-item label="模型编码"><el-input v-model="form.model_code" :disabled="isEdit"/></el-form-item><el-form-item label="显示名称"><el-input v-model="form.model_name"/></el-form-item><el-form-item label="上游模型名"><el-input v-model="form.upstream_model_name"/></el-form-item>
    <el-form-item label="官方提供方"><el-select v-model="form.official_provider"><el-option value="openai" label="OpenAI"/><el-option value="deepseek" label="DeepSeek"/><el-option value="anthropic" label="Anthropic"/></el-select></el-form-item><el-form-item label="官方模型标识"><el-input v-model="form.official_model_id" placeholder="例如 gpt-5.5"/></el-form-item>
    <el-form-item label="类型"><el-select v-model="form.model_type"><el-option value="llm" label="LLM 对话"/><el-option value="embedding" label="Embedding"/><el-option value="image" label="图像"/></el-select></el-form-item><el-form-item label="上下文长度"><el-input-number v-model="form.context_length" :min="0" :step="1024"/></el-form-item><el-form-item label="多模态"><el-switch v-model="form.is_multimodal"/></el-form-item>
    <el-form-item label="用户扣费倍率(入)"><el-input-number v-model="form.multiplier_input" :min="0.0001" :step="0.1"/></el-form-item><el-form-item label="用户扣费倍率(出)"><el-input-number v-model="form.multiplier_output" :min="0.0001" :step="0.1"/></el-form-item>
  </el-form><template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>
</div>
</template>
<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const models=ref([]),loading=ref(false),dialogVisible=ref(false),isEdit=ref(false),saving=ref(false),syncing=ref(false)
const emptyForm=()=>({model_code:'',model_name:'',upstream_model_name:'',model_type:'llm',context_length:4096,is_multimodal:false,multiplier_input:1,multiplier_output:1,official_provider:'openai',official_model_id:''})
const form=ref(emptyForm())
onMounted(fetchModels)
async function fetchModels(){loading.value=true;try{models.value=(await api.get('/api/admin/models')).data.data}catch(e){}loading.value=false}
function openDialog(row){isEdit.value=!!row;form.value=row?{...row,multiplier_input:row.billing_multiplier_input,multiplier_output:row.billing_multiplier_output}:emptyForm();dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value)await api.put(`/api/admin/models/${form.value.id}`,form.value);else await api.post('/api/admin/models',form.value);ElMessage.success('保存成功');dialogVisible.value=false;fetchModels()}catch(e){}saving.value=false}
async function toggleStatus(row){const status=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/models/${row.id}/status`,{status});ElMessage.success('状态已更新');fetchModels()}
async function syncPricing(){syncing.value=true;try{const r=await api.post('/api/admin/pricing-sync');ElMessage.success(`同步完成：更新 ${r.data.official_pricing.updated} 个模型，USD/CNY=${r.data.exchange_rate.rate}`);fetchModels()}catch(e){}syncing.value=false}
function currency(value){return value==='USD'?'$':'¥'}
</script>
