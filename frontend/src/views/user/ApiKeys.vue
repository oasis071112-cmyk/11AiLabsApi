<template>
<div class="page-container">
<div class="flex-between mb-16"><h2 class="card-title">🔑 API Key 管理</h2><el-button type="primary" @click="openCreate">+ 创建 API Key</el-button></div>
<el-alert title="⚠️ 安全提示：API Key 创建后仅展示一次，请立即保存。后续可通过列表中的「复制」按钮，输入登录密码验证后获取完整密钥。" type="warning" show-icon :closable="false" style="margin-bottom:16px"/>
<el-table :data="keys" stripe v-loading="loading">
<el-table-column prop="key_name" label="名称" min-width="120"/><el-table-column label="Key" min-width="200"><template #default="{row}">{{ row.key_prefix }}</template></el-table-column>
<el-table-column prop="channel_name" label="分组" width="120"><template #default="{row}"><el-tag v-if="row.channel_name" size="small" type="info">{{ row.channel_name }}</el-tag><span v-else style="color:#909399">-</span></template></el-table-column>
<el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status==='active'?'启用':'已禁用' }}</el-tag></template></el-table-column>
<el-table-column label="支持模型" min-width="300"><template #default="{row}"><el-tag v-for="m in row.models" :key="m.model_code" size="small" style="margin:2px">{{ m.model_code }}</el-tag><span v-if="!row.models?.length" style="color:#909399">无</span></template></el-table-column>
<el-table-column prop="last_used_at" label="最后使用" width="160"/><el-table-column prop="created_at" label="创建时间" width="160"/>
<el-table-column label="操作" width="260" fixed="right"><template #default="{row}"><el-button size="small" type="primary" @click="openExport(row)">复制</el-button><el-button size="small" @click="toggleKey(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button><el-popconfirm title="确定删除？" @confirm="deleteKey(row.id)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></template></el-table-column>
</el-table>

<el-dialog v-model="createDialog" title="创建 API Key" width="520px">
  <el-form label-width="80px">
  <el-form-item label="Key 名称"><el-input v-model="newKeyName" placeholder="例如：我的开发密钥"/></el-form-item>
  <el-form-item label="选择分组" required>
    <div v-if="channelLoading" style="text-align:center;padding:10px">加载分组列表...</div>
    <el-radio-group v-model="selectedChannelId" v-else style="width:100%">
      <div v-for="c in channels" :key="c.id" style="margin-bottom:8px;display:flex;align-items:center">
        <el-radio :value="c.id">
          <span style="font-weight:500">{{ c.channel_name }}</span>
          <span style="color:#909399;font-size:12px;margin-left:8px">{{ c.model_count }} 个模型</span>
        </el-radio>
      </div>
    </el-radio-group>
    <div v-if="!channelLoading && channels.length===0" style="color:#909399;text-align:center;padding:10px">暂无可用的分组，请联系管理员</div>
  </el-form-item>
  <el-alert v-if="selectedChannelId && selectedChannel" :title="`选择「${selectedChannel.channel_name}」分组后，创建的 Key 将自动拥有该分组分配的所有模型权限。`" type="info" :closable="false" style="margin-top:8px"/>
  </el-form>
  <template #footer><el-button @click="createDialog=false">取消</el-button><el-button type="primary" :loading="creating" @click="createKey" :disabled="!selectedChannelId">创建</el-button></template>
</el-dialog>
<el-dialog v-model="resultDialog" title="✅ API Key 创建成功" width="540px" :close-on-click-modal="false" :close-on-press-escape="false"><el-alert title="请立即复制保存此 Key！" type="error" show-icon :closable="false"/><div style="background:#f5f7fa;padding:12px;border-radius:6px;margin-top:16px;word-break:break-all;font-family:monospace;font-size:14px">{{ newKeyRaw }}</div><el-button type="primary" style="margin-top:12px" @click="copyKey">📋 复制到剪贴板</el-button><template #footer><el-button @click="resultDialog=false">我已知晓，关闭</el-button></template></el-dialog>

<!-- 密码验证 → 导出完整 Key -->
<el-dialog v-model="exportDialog" title="🔐 验证身份 — 获取完整密钥" width="440px" :close-on-click-modal="false">
  <el-form label-width="80px">
  <el-form-item label="目标密钥"><span style="font-family:monospace;font-size:13px;color:#409eff">{{ exportTarget?.key_name }}</span><br/><span style="color:#909399;font-size:12px">{{ exportTarget?.key_prefix }}</span></el-form-item>
  <el-form-item label="登录密码"><el-input v-model="exportPassword" type="password" show-password placeholder="请输入您的登录密码"/></el-form-item>
  </el-form>
  <template #footer><el-button @click="exportDialog=false">取消</el-button><el-button type="primary" :loading="exportLoading" @click="doExport">验证并获取</el-button></template>
</el-dialog>

<!-- 导出结果展示 -->
<el-dialog v-model="exportResultDialog" title="✅ 完整 API Key" width="540px" :close-on-click-modal="false" :close-on-press-escape="false">
  <div style="background:#f5f7fa;padding:12px;border-radius:6px;word-break:break-all;font-family:monospace;font-size:14px">{{ exportedRaw }}</div>
  <el-button type="primary" style="margin-top:12px" @click="copyExported">📋 复制到剪贴板</el-button>
  <template #footer><el-button @click="exportResultDialog=false">关闭</el-button></template>
</el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const keys=ref([]),loading=ref(false),createDialog=ref(false),resultDialog=ref(false),creating=ref(false),newKeyName=ref(''),newKeyRaw=ref('')
const channels=ref([]),selectedChannelId=ref(null),channelLoading=ref(false)
const selectedChannel=computed(()=>channels.value.find(c=>c.id===selectedChannelId.value))
// 导出
const exportDialog=ref(false),exportResultDialog=ref(false),exportTarget=ref(null),exportPassword=ref(''),exportLoading=ref(false),exportedRaw=ref('')
onMounted(()=>{fetchKeys()})
async function fetchKeys(){loading.value=true;try{keys.value=(await api.get('/api/user/keys')).data.data}catch(e){}loading.value=false}
async function openCreate(){createDialog.value=true;selectedChannelId.value=null;channelLoading.value=true
  try{channels.value=(await api.get('/api/user/channels')).data.data}catch(e){}channelLoading.value=false}
async function createKey(){
  if(!selectedChannelId.value){ElMessage.warning('请选择分组');return}
  creating.value=true;try{const r=await api.post('/api/user/keys',{key_name:newKeyName.value,channel_id:selectedChannelId.value});newKeyRaw.value=r.data.key.key_raw;createDialog.value=false;resultDialog.value=true;newKeyName.value='';fetchKeys()}catch(e){}creating.value=false}
async function toggleKey(k){await api.patch(`/api/user/keys/${k.id}/toggle`);ElMessage.success('操作成功');fetchKeys()}
async function deleteKey(id){await api.delete(`/api/user/keys/${id}`);ElMessage.success('已删除');fetchKeys()}
async function copyKey(){await navigator.clipboard.writeText(newKeyRaw.value);ElMessage.success('已复制')}
function openExport(row){exportTarget.value=row;exportPassword.value='';exportDialog.value=true}
async function doExport(){
  if(!exportPassword.value){ElMessage.warning('请输入登录密码');return}
  exportLoading.value=true
  try{const r=await api.post(`/api/user/keys/${exportTarget.value.id}/export`,{password:exportPassword.value});exportedRaw.value=r.data.key_raw;exportDialog.value=false;exportResultDialog.value=true;exportPassword.value=''}catch(e){}
  exportLoading.value=false}
async function copyExported(){await navigator.clipboard.writeText(exportedRaw.value);ElMessage.success('已复制')}
</script>