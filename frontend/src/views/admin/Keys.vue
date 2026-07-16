<template>
<div class="keys-page">
  <div class="flex-between mb-16"><div><h3>API Key 管理</h3><div class="page-hint">按用户展开查看 Key、状态和模型权限</div></div></div>
  <el-collapse v-model="expandedUsers" accordion v-loading="loading" class="user-groups">
    <el-collapse-item v-for="group in groups" :key="group.user_id" :name="group.user_id">
      <template #title>
        <div class="user-summary">
          <div class="avatar">{{ group.username.slice(0,1).toUpperCase() }}</div>
          <div><div class="username">{{ group.username }}</div><div class="user-meta">用户 ID {{ group.user_id }} · {{ roleLabel(group.role) }}</div></div>
          <div class="summary-tags"><el-tag size="small" effect="plain">共 {{ group.key_count }} 个 Key</el-tag><el-tag size="small" type="success" effect="plain">启用 {{ group.active_key_count }}</el-tag><el-tag size="small" :type="group.user_status==='active'?'success':'danger'">{{ group.user_status==='active'?'用户正常':'用户停用' }}</el-tag></div>
        </div>
      </template>
      <div class="key-list">
        <el-empty v-if="!group.keys.length" description="该用户暂无 API Key" :image-size="50"/>
        <div v-for="key in group.keys" :key="key.id" class="key-card">
          <div class="key-head"><div><span class="key-name">{{ key.key_name||'未命名 Key' }}</span><span class="key-code">{{ key.key_prefix }}***</span></div><el-tag :type="keyStatusType(key.status)" size="small">{{ keyStatusLabel(key.status) }}</el-tag></div>
          <div class="key-meta"><span v-if="key.group_name">路由分组：{{ key.group_name }}</span><span>创建：{{ formatTime(key.created_at) }}</span><span>最后使用：{{ formatTime(key.last_used_at) }}</span><span>每分钟限制：{{ key.rate_limit_per_min }}</span></div>
          <div class="permission-row"><span class="permission-label">支持模型</span><div class="permission-tags"><el-tag v-for="model in key.permissions" :key="model" size="small" effect="plain">{{ model }}</el-tag><span v-if="!key.permissions.length" class="empty-text">暂无权限</span></div></div>
          <div class="key-actions"><el-button v-if="key.status!=='revoked'" size="small" :type="key.status==='active'?'warning':'success'" @click="toggleKey(key)">{{ key.status==='active'?'禁用':'启用' }}</el-button><el-button v-if="key.permission_mode!=='group_dynamic'" size="small" @click="editPerms(key)">编辑权限</el-button><span v-else class="empty-text">模型权限随分组自动更新</span></div>
        </div>
      </div>
    </el-collapse-item>
  </el-collapse>
  <el-empty v-if="!loading&&!groups.length" description="暂无用户 Key"/>
  <el-pagination v-model:current-page="page" :page-size="10" :total="total" layout="prev,pager,next" @current-change="fetch" class="pagination"/>

  <el-dialog v-model="permDialog" title="编辑 Key 权限" width="600px"><el-checkbox-group v-model="selModels" class="permission-picker"><div v-for="provider in modelGroups" :key="provider.name" class="model-group"><div class="model-group-title">{{ provider.label }}</div><el-checkbox v-for="model in provider.models" :key="model.model_code" :label="model.model_code">{{ model.model_name }}（{{ model.model_code }}）</el-checkbox></div></el-checkbox-group><template #footer><el-button @click="permDialog=false">取消</el-button><el-button type="primary" @click="savePerms">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/api'
import { ElMessage } from 'element-plus'
import { formatBeijingTime } from '@/utils/time'

const groups=ref([]),loading=ref(false),page=ref(1),total=ref(0),expandedUsers=ref('')
const permDialog=ref(false),selModels=ref([]),editingKeyId=ref(null),allModels=ref([])
const modelGroups=computed(()=>['openai','deepseek','anthropic'].map(name=>({name,label:{openai:'OpenAI',deepseek:'DeepSeek',anthropic:'Anthropic'}[name],models:allModels.value.filter(model=>model.official_provider===name)})).filter(group=>group.models.length))
onMounted(async()=>{try{allModels.value=(await api.get('/api/admin/models')).data.data||[]}catch(e){};fetch()})
async function fetch(){loading.value=true;try{const r=await api.get('/api/admin/keys',{params:{page:page.value,limit:10,group_by:'user'}});groups.value=r.data.data||[];total.value=r.data.pagination.total}catch(e){}loading.value=false}
async function toggleKey(key){const status=key.status==='active'?'disabled':'active';await api.patch(`/api/admin/keys/${key.id}/status`,{status});ElMessage.success('操作成功');fetch()}
function editPerms(key){editingKeyId.value=key.id;selModels.value=[...(key.permissions||[])];permDialog.value=true}
async function savePerms(){await api.put(`/api/admin/keys/${editingKeyId.value}/permissions`,{model_codes:selModels.value});ElMessage.success('权限已更新');permDialog.value=false;fetch()}
function roleLabel(role){return {admin:'管理员',operator:'运营',finance:'财务',user:'普通用户'}[role]||role}
function keyStatusLabel(status){return {active:'启用',disabled:'停用',revoked:'已撤销'}[status]||status}
function keyStatusType(status){return {active:'success',disabled:'warning',revoked:'info'}[status]||'info'}
function formatTime(value){return formatBeijingTime(value,'从未使用')}
</script>

<style scoped>
.keys-page{padding-bottom:24px}.page-hint{font-size:12px;color:#94a3b8;margin-top:4px}.user-groups{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff}.user-groups :deep(.el-collapse-item__header){height:auto;min-height:74px;padding:0 20px}.user-groups :deep(.el-collapse-item__content){padding:0}.user-summary{width:100%;display:flex;align-items:center;gap:12px;padding-right:18px}.avatar{width:38px;height:38px;border-radius:10px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;font-weight:700}.username{font-weight:650;color:#0f172a;line-height:1.4}.user-meta{font-size:12px;color:#94a3b8}.summary-tags{margin-left:auto;display:flex;gap:8px}.key-list{padding:14px 20px 18px;background:#f8fafc;display:grid;gap:12px}.key-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px}.key-head,.permission-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.key-name{font-weight:600;color:#0f172a}.key-code{font-family:monospace;font-size:12px;color:#64748b;margin-left:12px}.key-meta{display:flex;gap:24px;flex-wrap:wrap;color:#64748b;font-size:12px;margin:10px 0}.permission-row{justify-content:flex-start}.permission-label{font-size:12px;color:#64748b;min-width:56px}.permission-tags{display:flex;gap:5px;flex-wrap:wrap}.empty-text{color:#94a3b8;font-size:12px}.key-actions{text-align:right;margin-top:12px}.pagination{margin-top:16px;justify-content:center}.permission-picker{display:block}.model-group{padding:10px 0;border-bottom:1px solid #f1f5f9}.model-group-title{font-weight:600;margin-bottom:8px}.model-group :deep(.el-checkbox){display:flex;margin:5px 0}
@media(max-width:768px){.user-groups :deep(.el-collapse-item__header){padding:0 12px}.user-summary{padding-right:7px;gap:8px}.avatar{width:34px;height:34px}.summary-tags{gap:4px}.summary-tags .el-tag:first-child{display:none}.key-list{padding:10px}.key-card{padding:12px}.key-head{display:block}.key-code{display:block;margin:3px 0 0;overflow:hidden;text-overflow:ellipsis}.key-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:10px 0}.permission-row{display:block}.permission-label{display:block;margin-bottom:6px}.key-actions{display:flex;gap:6px}.key-actions .el-button{flex:1;margin:0}.pagination{justify-content:flex-start}}
</style>
