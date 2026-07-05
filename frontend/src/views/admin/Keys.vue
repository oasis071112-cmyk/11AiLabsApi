<template>
<div><div class="flex-between mb-16"><h3>API Key 管理</h3></div>
<el-table :data="keys" stripe v-loading="loading">
<el-table-column prop="id" label="ID" width="60"/><el-table-column prop="username" label="用户" width="120"/>
<el-table-column prop="key_name" label="名称" width="150"/><el-table-column label="Key" width="200"><template #default="{row}">{{ row.key_prefix }}***</template></el-table-column>
<el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status }}</el-tag></template></el-table-column>
<el-table-column label="支持模型" min-width="300"><template #default="{row}"><el-tag v-for="m in (row.permissions||[])" :key="m" size="small" style="margin:2px">{{ m }}</el-tag></template></el-table-column>
<el-table-column prop="last_used_at" label="最后使用" width="160"/>
<el-table-column label="操作" width="160"><template #default="{row}"><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleKey(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button><el-button size="small" @click="editPerms(row)">权限</el-button></template></el-table-column>
</el-table>
<el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="prev,pager,next" @current-change="fetch" style="margin-top:16px;justify-content:center"/>

<el-dialog v-model="permDialog" title="编辑 Key 权限" width="500px"><el-checkbox-group v-model="selModels"><el-checkbox v-for="m in allModels" :key="m.model_code" :label="m.model_code" style="margin:4px">{{ m.model_name }}</el-checkbox></el-checkbox-group><template #footer><el-button @click="permDialog=false">取消</el-button><el-button type="primary" @click="savePerms">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const keys=ref([]),loading=ref(false),page=ref(1),total=ref(0),permDialog=ref(false),selModels=ref([]),editingKeyId=ref(null),allModels=ref([])
onMounted(async()=>{try{allModels.value=(await api.get('/api/admin/models')).data.data}catch(e){};fetch()})
async function fetch(){loading.value=true;try{const r=await api.get('/api/admin/keys',{params:{page:page.value}});keys.value=r.data.data;total.value=r.data.pagination.total}catch(e){}loading.value=false}
async function toggleKey(k){const s=k.status==='active'?'disabled':'active';await api.patch(`/api/admin/keys/${k.id}/status`,{status:s});ElMessage.success('操作成功');fetch()}
function editPerms(k){editingKeyId.value=k.id;selModels.value=k.permissions||[];permDialog.value=true}
async function savePerms(){await api.put(`/api/admin/keys/${editingKeyId.value}/permissions`,{model_codes:selModels.value});ElMessage.success('权限已更新');permDialog.value=false;fetch()}
</script>
