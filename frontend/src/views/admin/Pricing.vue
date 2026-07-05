<template>
<div><div class="flex-between mb-16"><h3>倍率规则管理</h3><el-button type="primary" @click="openDialog()">+ 新增规则</el-button></div>
<el-table :data="rules" stripe v-loading="loading">
<el-table-column prop="rule_name" label="规则名称" width="150"/><el-table-column prop="model_code" label="适用模型" width="150"/>
<el-table-column label="作用范围" width="150"><template #default="{row}"><el-tag size="small">{{ scl(row.scope_type) }}</el-tag><span v-if="row.scope_id"> ID:{{ row.scope_id }}</span></template></el-table-column>
<el-table-column label="展示倍率(入/出)" width="140"><template #default="{row}">×{{ row.display_multiplier_input }} / ×{{ row.display_multiplier_output }}</template></el-table-column>
<el-table-column label="扣费倍率(入/出)" width="140"><template #default="{row}">×{{ row.billing_multiplier_input }} / ×{{ row.billing_multiplier_output }}</template></el-table-column>
<el-table-column label="优先级" width="80"><template #default="{row}">{{ row.priority }}</template></el-table-column>
<el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status }}</el-tag></template></el-table-column>
<el-table-column label="操作" width="160"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button><el-popconfirm title="确定删除？" @confirm="delRule(row.id)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></template></el-table-column>
</el-table>

<el-dialog v-model="dialogVisible" :title="isEdit?'编辑规则':'新增规则'" width="560px"><el-form :model="form" label-width="130px">
<el-form-item label="规则名称"><el-input v-model="form.rule_name"/></el-form-item>
<el-form-item label="适用模型"><el-input v-model="form.model_code" placeholder="留空=全部模型"/></el-form-item>
<el-form-item label="作用范围"><el-select v-model="form.scope_type"><el-option value="platform" label="平台默认"/><el-option value="user_group" label="用户组"/><el-option value="user" label="单个用户"/><el-option value="api_key" label="单个Key"/></el-select></el-form-item>
<el-form-item v-if="form.scope_type!=='platform'" label="范围ID"><el-input-number v-model="form.scope_id" :min="1"/></el-form-item>
<el-form-item label="展示倍率(输入)"><el-input-number v-model="form.display_multiplier_input" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="展示倍率(输出)"><el-input-number v-model="form.display_multiplier_output" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="扣费倍率(输入)"><el-input-number v-model="form.billing_multiplier_input" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="扣费倍率(输出)"><el-input-number v-model="form.billing_multiplier_output" :min="0" :step="0.1"/></el-form-item>
<el-form-item label="优先级"><el-input-number v-model="form.priority" :min="0" :max="999"/></el-form-item>
<el-form-item label="生效时间"><el-date-picker v-model="form.start_time" type="datetime" placeholder="开始"/></el-form-item>
<el-form-item label="失效时间"><el-date-picker v-model="form.end_time" type="datetime" placeholder="结束"/></el-form-item>
<el-form-item label="状态"><el-switch v-model="form.status" active-value="active" inactive-value="inactive"/></el-form-item>
</el-form><template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const rules=ref([]),loading=ref(false),dialogVisible=ref(false),isEdit=ref(false),saving=ref(false)
const form=ref({rule_name:'',model_code:'',scope_type:'platform',scope_id:null,display_multiplier_input:1,display_multiplier_output:1,billing_multiplier_input:1,billing_multiplier_output:1,priority:0,start_time:null,end_time:null,status:'active'})
onMounted(()=>fetchRules())
async function fetchRules(){loading.value=true;try{rules.value=(await api.get('/api/admin/pricing-rules')).data.data}catch(e){}loading.value=false}
function openDialog(row){isEdit.value=!!row;form.value=row?{...row}:{rule_name:'',model_code:'',scope_type:'platform',scope_id:null,display_multiplier_input:1,display_multiplier_output:1,billing_multiplier_input:1,billing_multiplier_output:1,priority:0,start_time:null,end_time:null,status:'active'};dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value){await api.put(`/api/admin/pricing-rules/${form.value.id}`,form.value)}else{await api.post('/api/admin/pricing-rules',form.value)}ElMessage.success('保存成功');dialogVisible.value=false;fetchRules()}catch(e){}saving.value=false}
async function delRule(id){await api.delete(`/api/admin/pricing-rules/${id}`);ElMessage.success('已删除');fetchRules()}
function scl(s){const m={platform:'平台默认',user_group:'用户组',user:'单用户',api_key:'单Key'};return m[s]||s}
</script>
