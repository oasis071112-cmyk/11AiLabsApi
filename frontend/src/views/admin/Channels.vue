<template>
<div><div class="flex-between mb-16"><h3>渠道管理</h3><el-button type="primary" @click="openDialog()">+ 新增渠道</el-button></div>
<el-table :data="channels" stripe v-loading="loading">
<el-table-column prop="channel_name" label="名称" width="150"/><el-table-column prop="base_url" label="上游地址" min-width="250"/>
<el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status }}</el-tag></template></el-table-column>
<el-table-column prop="priority" label="优先级" width="80"/><el-table-column label="健康状态" width="130"><template #default="{row}"><el-tag :type="healthType(row)" size="small" effect="dark" style="width:100%;text-align:center">{{ healthLabel(row) }}</el-tag></template></el-table-column>
<el-table-column label="健康分" width="70"><template #default="{row}">{{ row.health_score?.toFixed(0)||100 }}</template></el-table-column>
<el-table-column prop="weight" label="权重" width="70"/>
<el-table-column label="操作" width="280"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button><el-button size="small" type="info" @click="openModelDialog(row)">管理模型</el-button><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggle(row)">{{ row.status==='active'?'停用':'启用' }}</el-button></template></el-table-column>
</el-table>

<el-dialog v-model="dialogVisible" :title="isEdit?'编辑渠道':'新增渠道'" width="480px"><el-form :model="form" label-width="100px">
<el-form-item label="渠道名称"><el-input v-model="form.channel_name"/></el-form-item>
<el-form-item label="上游地址"><el-input v-model="form.base_url"/></el-form-item>
<el-form-item label="API Key"><el-input v-model="form.api_key" type="password" show-password/></el-form-item>
<el-form-item label="优先级"><el-input-number v-model="form.priority" :min="0"/></el-form-item>
<el-form-item label="权重"><el-input-number v-model="form.weight" :min="0" :max="1000"/></el-form-item>
</el-form><template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>

<!-- 渠道模型管理 -->
<el-dialog v-model="modelDialogVisible" :title="`渠道模型分配 — ${modelChannel?.channel_name||''}`" width="700px" top="5vh">
  <div v-loading="modelLoading">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
      <template #title>勾选模型将分配给此渠道，未勾选的模型不在此渠道可用</template>
    </el-alert>
    <el-checkbox-group v-model="selectedModels">
      <div v-for="m in allModels" :key="m.model_code" style="display:inline-block;width:48%;margin:4px 1%;">
        <el-checkbox :value="m.model_code" :label="m.model_code">
          <span style="font-size:13px">{{ m.model_name }}</span>
          <span style="color:#909399;font-size:11px;margin-left:4px">({{ m.model_code }})</span>
          <el-tag v-if="m.channel_id && m.channel_id!==modelChannel?.id" size="small" type="warning" style="margin-left:4px">已分配</el-tag>
        </el-checkbox>
      </div>
    </el-checkbox-group>
    <div v-if="allModels.length===0" style="text-align:center;color:#909399;padding:20px">暂无模型，请先在「模型管理」中添加</div>
  </div>
  <template #footer>
    <el-button @click="modelDialogVisible=false">取消</el-button>
    <el-button type="primary" :loading="modelSaving" @click="saveModels">保存分配</el-button>
  </template>
</el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const channels=ref([]),loading=ref(false),dialogVisible=ref(false),isEdit=ref(false),saving=ref(false)
const form=ref({channel_name:'',base_url:'',api_key:'',priority:0,weight:100})
// 模型管理
const modelDialogVisible=ref(false),modelChannel=ref(null),allModels=ref([]),selectedModels=ref([]),modelLoading=ref(false),modelSaving=ref(false)
onMounted(()=>fetch())
async function fetch(){loading.value=true;try{channels.value=(await api.get('/api/admin/channels')).data.data}catch(e){}loading.value=false}
function openDialog(row){isEdit.value=!!row;form.value=row?{...row,api_key:''}:{channel_name:'',base_url:'',api_key:'',priority:0,weight:100};dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value){await api.put(`/api/admin/channels/${form.value.id}`,form.value)}else{await api.post('/api/admin/channels',form.value)}ElMessage.success('保存成功');dialogVisible.value=false;fetch()}catch(e){}saving.value=false}
async function toggle(row){const s=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/channels/${row.id}/status`,{status:s});ElMessage.success('操作成功');fetch()}
async function openModelDialog(row){modelChannel.value=row;modelDialogVisible.value=true;modelLoading.value=true
  try{const res=await api.get(`/api/admin/channels/${row.id}/models`);allModels.value=res.data.data;selectedModels.value=[...res.data.channel_model_codes]}catch(e){}
  modelLoading.value=false}
async function saveModels(){modelSaving.value=true
  try{await api.put(`/api/admin/channels/${modelChannel.value.id}/models`,{model_codes:selectedModels.value});ElMessage.success('模型分配已保存');modelDialogVisible.value=false;fetch()}catch(e){}
  modelSaving.value=false}
function healthType(r){if(r.status!=="active")return "info";if(r.circuit_breaker_until&&new Date(r.circuit_breaker_until)>new Date())return "danger";return(r.health_score||100)>=60?"success":(r.health_score||100)>=30?"warning":"danger"}
function healthLabel(r){if(r.status!=="active")return "未启用";if(r.circuit_breaker_until&&new Date(r.circuit_breaker_until)>new Date())return "熔断中";return(r.health_score||100)>=60?"在线":(r.health_score||100)>=30?"降级":"离线"}
</script>