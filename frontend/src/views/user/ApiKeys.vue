<template>
<div class="page-container">
<div class="flex-between mb-16"><h2 class="card-title"><Key :size="22"/> API Key 管理</h2><div style="display:flex;gap:8px"><el-button size="small" text @click="fetchKeys" :loading="loading"><RefreshCw :size="16"/></el-button><el-button type="primary" @click="openCreate">+ 创建 API Key</el-button></div></div>
<el-alert title="⚠️ 安全提示：API Key 创建后仅展示一次，请立即保存。后续可通过列表中的「复制」按钮，输入登录密码验证后获取完整密钥。" type="warning" show-icon :closable="false" style="margin-bottom:16px"/>
<el-table :data="keys" stripe v-loading="loading">
<el-table-column prop="key_name" label="名称" min-width="120"/><el-table-column label="Key" min-width="200"><template #default="{row}">{{ row.key_prefix }}</template></el-table-column>
<el-table-column prop="channel_name" label="分组" width="100"><template #default="{row}"><el-tag v-if="row.channel_name" size="small" type="info">{{ row.channel_name }}</el-tag><span v-else style="color:#909399">-</span></template></el-table-column>
<el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status==='active'?'启用':'已禁用' }}</el-tag></template></el-table-column>
<el-table-column label="支持模型" min-width="280"><template #default="{row}"><el-tag v-for="m in row.models" :key="m.model_code" size="small" style="margin:2px">{{ m.model_code }}</el-tag><span v-if="!row.models?.length" style="color:#909399">无</span></template></el-table-column>
<el-table-column label="文档" width="100" align="center"><template #default="{row}"><el-button v-if="row.channel_name" size="small" type="success" @click="openDocs(row)" :loading="docsLoading && docsTarget===row" :disabled="docsLoading"><BookOpen :size="14" style="margin-right:2px"/> 使用说明</el-button><span v-else style="color:#c0c4cc;font-size:12px">-</span></template></el-table-column>
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
<el-dialog v-model="resultDialog" width="540px" :close-on-click-modal="false" :close-on-press-escape="false"><template #header><div style="display:flex;align-items:center;gap:8px"><CircleCheck :size="20" color="#409eff"/> API Key 创建成功</div></template><el-alert title="请立即复制保存此 Key！" type="error" show-icon :closable="false"/><div style="background:#f5f7fa;padding:12px;border-radius:6px;margin-top:16px;word-break:break-all;font-family:monospace;font-size:14px">{{ newKeyRaw }}</div><el-button type="primary" style="margin-top:12px" @click="copyKey"><Clipboard :size="14" style="margin-right:4px"/> 复制到剪贴板</el-button><template #footer><el-button @click="resultDialog=false">我已知晓，关闭</el-button></template></el-dialog>

<!-- 密码验证 → 导出完整 Key -->
<el-dialog v-model="exportDialog" width="440px" :close-on-click-modal="false"><template #header><div style="display:flex;align-items:center;gap:8px"><Shield :size="20" color="#409eff"/> 验证身份 — 获取完整密钥</div></template>
  <el-form label-width="80px">
  <el-form-item label="目标密钥"><span style="font-family:monospace;font-size:13px;color:#409eff">{{ exportTarget?.key_name }}</span><br/><span style="color:#909399;font-size:12px">{{ exportTarget?.key_prefix }}</span></el-form-item>
  <el-form-item label="登录密码"><el-input v-model="exportPassword" type="password" show-password placeholder="请输入您的登录密码"/></el-form-item>
  </el-form>
  <template #footer><el-button @click="exportDialog=false">取消</el-button><el-button type="primary" :loading="exportLoading" @click="doExport">验证并获取</el-button></template>
</el-dialog>

<!-- 导出结果展示 -->
<el-dialog v-model="exportResultDialog" width="540px" :close-on-click-modal="false" :close-on-press-escape="false"><template #header><div style="display:flex;align-items:center;gap:8px"><CircleCheck :size="20" color="#409eff"/> 完整 API Key</div></template>
  <div style="background:#f5f7fa;padding:12px;border-radius:6px;word-break:break-all;font-family:monospace;font-size:14px">{{ exportedRaw }}</div>
  <el-button type="primary" style="margin-top:12px" @click="copyExported"><Clipboard :size="14" style="margin-right:4px"/> 复制到剪贴板</el-button>
  <template #footer><el-button @click="exportResultDialog=false">关闭</el-button></template>
</el-dialog>

<!-- 渠道使用文档弹窗 -->
<el-dialog v-model="docsDialog" width="700px" :close-on-click-modal="false" destroy-on-close><template #header><div style="display:flex;align-items:center;gap:8px"><BookOpen :size="20" color="#409eff"/> {{ docsChannelName }} — 使用说明</div></template>
  <div v-if="docsLoading" style="text-align:center;padding:40px"><Loader2 :size="32" color="#409eff" style="animation:spin 1s linear infinite"/><p style="color:#909399;margin-top:12px">加载文档...</p></div>
  <template v-else>
    <div style="margin-bottom:16px">
      <el-tag type="success" size="small" style="margin-right:8px">{{ docsData.protocol_label }}</el-tag>
      <span style="font-size:12px;color:#909399">端点：<code>{{ docsData.endpoint }}</code></span>
    </div>
    <div v-if="docsData.models?.length" style="margin-bottom:12px;font-size:12px;color:#606266">可用模型：<el-tag v-for="m in docsData.models" :key="m.model_code" size="small" style="margin:2px">{{ m.model_code }}</el-tag></div>

    <!-- 横向 Tab -->
    <div style="display:flex;gap:4px;margin-bottom:0;border-bottom:2px solid #409eff">
      <button v-for="tab in tabs" :key="tab.key" @click="activeTab=tab.key" :style="{background:activeTab===tab.key?'#409eff':'#f0f2f5',color:activeTab===tab.key?'#fff':'#606266',border:'none',padding:'8px 20px',cursor:'pointer',borderRadius:'6px 6px 0 0',fontSize:'14px',fontWeight:activeTab===tab.key?600:400}" type="button">{{ tab.label }}</button>
    </div>

    <!-- 代码块 -->
    <div style="background:#1e1e1e;border-radius:0 0 8px 8px;padding:16px 20px;overflow-x:auto;position:relative">
      <el-button size="small" type="info" plain style="position:absolute;top:10px;right:16px;z-index:1;border-color:#555;color:#ccc" @click="copyDocsCode"><Clipboard :size="12" style="margin-right:3px"/>{{ docsCopied ? '已复制' : '复制' }}</el-button>
      <pre style="margin:0;font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:12px;line-height:1.6;color:#d4d4d4;white-space:pre-wrap;word-break:break-all;padding-top:32px">{{ activeCode }}</pre>
    </div>
  </template>
  <template #footer><el-button @click="docsDialog=false">关闭</el-button></template>
</el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted, computed, nextTick } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus';import { Loader2, Key, BookOpen, CircleCheck, Clipboard, Shield, RefreshCw } from '@lucide/vue'
const keys=ref([]),loading=ref(false),createDialog=ref(false),resultDialog=ref(false),creating=ref(false),newKeyName=ref(''),newKeyRaw=ref('')
const channels=ref([]),selectedChannelId=ref(null),channelLoading=ref(false)
const selectedChannel=computed(()=>channels.value.find(c=>c.id===selectedChannelId.value))
// 导出
const exportDialog=ref(false),exportResultDialog=ref(false),exportTarget=ref(null),exportPassword=ref(''),exportLoading=ref(false),exportedRaw=ref('')
// 使用文档
const docsDialog=ref(false),docsLoading=ref(false),docsTarget=ref(null),docsData=ref({}),docsChannelName=ref(''),docsCopied=ref(false)
const tabs=[{key:'curl',label:'cURL'},{key:'python',label:'Python'},{key:'nodejs',label:'Node.js'}]
const activeTab=ref('curl')
const activeCode=computed(()=>docsData.value?.[activeTab.value]||'')

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

// ========== 使用说明 ==========
async function openDocs(row){
  docsTarget.value=row;docsDialog.value=true;docsLoading.value=true;docsData.value={};docsChannelName.value=row.channel_name;activeTab.value='curl';docsCopied.value=false
  try{const r=await api.get(`/api/user/docs/channel?channel_name=${encodeURIComponent(row.channel_name)}`);docsData.value=r.data}catch(e){ElMessage.error('获取文档失败')}
  docsLoading.value=false
}
async function copyDocsCode(){
  try{await navigator.clipboard.writeText(activeCode.value);docsCopied.value=true;ElMessage.success('已复制到剪贴板');setTimeout(()=>docsCopied.value=false,2000)}catch(e){ElMessage.error('复制失败')}
}
</script>
