<template>
<div><div class="flex-between mb-16"><h3>模型管理</h3><el-button type="primary" @click="openDialog()">+ 新增模型</el-button></div>
<el-table :data="models" stripe v-loading="loading">
<el-table-column prop="model_code" label="编码" width="150"/><el-table-column prop="model_name" label="显示名称" width="150"/>
<el-table-column prop="upstream_model_name" label="上游名称" width="160"/><el-table-column prop="model_type" label="类型" width="80"/>
<el-table-column prop="channel_name" label="归属渠道" width="120">
  <template #default="{row}"><el-tag v-if="row.channel_name" size="small" type="info">{{ row.channel_name }}</el-tag><span v-else style="color:#909399">未分配</span></template>
</el-table-column>
<el-table-column label="输入倍率" width="90"><template #default="{row}">×{{ row.billing_multiplier_input }}</template></el-table-column>
<el-table-column label="输出倍率" width="90"><template #default="{row}">×{{ row.billing_multiplier_output }}</template></el-table-column>
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
<el-form-item label="描述"><el-input v-model="form.description" type="textarea"/></el-form-item>
</el-form><template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const models=ref([]),loading=ref(false),dialogVisible=ref(false),isEdit=ref(false),saving=ref(false)
const form=ref({model_code:'',model_name:'',upstream_model_name:'',model_type:'llm',context_length:4096,is_multimodal:false,base_input_price:0,base_output_price:0,display_multiplier_input:1,display_multiplier_output:1,billing_multiplier_input:1,billing_multiplier_output:1,description:''})
onMounted(()=>fetchModels())
async function fetchModels(){loading.value=true;try{models.value=(await api.get('/api/admin/models')).data.data}catch(e){}loading.value=false}
function openDialog(row){isEdit.value=!!row;form.value=row?{...row}:{model_code:'',model_name:'',upstream_model_name:'',model_type:'llm',context_length:4096,is_multimodal:false,base_input_price:0,base_output_price:0,display_multiplier_input:1,display_multiplier_output:1,billing_multiplier_input:1,billing_multiplier_output:1,description:''};dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value){await api.put(`/api/admin/models/${form.value.id}`,form.value)}else{await api.post('/api/admin/models',form.value)}ElMessage.success('保存成功');dialogVisible.value=false;fetchModels()}catch(e){}saving.value=false}
async function toggleStatus(row){const ns=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/models/${row.id}/status`,{status:ns});ElMessage.success('状态已更新');fetchModels()}
</script>