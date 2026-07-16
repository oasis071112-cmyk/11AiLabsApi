<template>
<div class="dashboard">
  <!-- KPI -->
  <el-row :gutter="16" class="kpi-row">
    <el-col :span="8"><div class="kpi-card kpi-appear-1"><div class="kpi-icon" style="background:#0EA5E9"><Key :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">密钥总数</div><div class="kpi-value">{{ keys.length }}</div></div></div></el-col>
    <el-col :span="8"><div class="kpi-card kpi-appear-2"><div class="kpi-icon" style="background:#22c55e"><CircleCheck :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">启用中</div><div class="kpi-value">{{ keys.filter(function(k){return k.status==='active'}).length }}</div></div></div></el-col>
    <el-col :span="8"><div class="kpi-card kpi-appear-3"><div class="kpi-icon" style="background:#f59e0b"><Shield :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">已禁用</div><div class="kpi-value">{{ keys.filter(function(k){return k.status!=='active'}).length }}</div></div></div></el-col>
  </el-row>

  <!-- 操作栏 -->
  <div class="filter-bar kpi-appear-2">
    <span style="font-weight:600;font-size:15px">API Key 管理</span>
    <div style="margin-left:auto;display:flex;gap:8px">
      <el-button size="small" text @click="fetchKeys" :loading="loading"><RefreshCw :size="14"/></el-button>
      <el-button type="primary" @click="openCreate">+ 创建 API Key</el-button>
    </div>
  </div>

  <el-alert title="⚠️ API Key 创建后仅展示一次，请立即保存" type="warning" show-icon :closable="false" style="margin-bottom:20px"/>

  <div v-if="isMobile" class="mobile-key-list kpi-appear-4" v-loading="loading">
    <article v-for="row in keys" :key="row.id" class="mobile-key-card">
      <div class="mobile-key-head"><div><span class="status-dot" :class="row.status==='active'?'dot-on':'dot-off'"></span><strong>{{ row.key_name }}</strong></div><el-tag :type="row.status==='active'?'success':'info'" size="small" effect="plain">{{ row.status==='active'?'启用':'禁用' }}</el-tag></div>
      <code>{{ row.key_prefix }}</code>
      <div class="mobile-key-meta"><span><small>分组</small>{{ row.channel_name||'未分组' }}</span><span><small>模型数</small>{{ row.models?.length||0 }} 个</span><span><small>最后使用</small>{{ formatBeijingTime(row.last_used_at) }}</span></div>
      <div class="mobile-key-actions"><el-button size="small" type="primary" @click="openExport(row)">复制</el-button><el-button size="small" @click="toggleKey(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button><el-button v-if="row.channel_name" size="small" type="success" @click="openDocs(row)" :loading="docsLoading&&docsTarget===row"><BookOpen :size="13"/>文档</el-button><el-popconfirm title="确定删除？" @confirm="deleteKey(row.id)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></div>
    </article>
    <el-empty v-if="!loading&&!keys.length" description="暂无 API Key"/>
  </div>

  <!-- 桌面端表格 -->
  <div v-else class="glass-table kpi-appear-4">
    <el-table :data="keys" v-loading="loading" size="medium" style="background:transparent" :header-cell-style="{background:'transparent',borderColor:'rgba(0,0,0,0.06)',color:'#525252',fontWeight:600,fontSize:'11px',textTransform:'uppercase',letterSpacing:'.5px',textAlign:'center'}" :cell-style="{borderColor:'rgba(0,0,0,0.04)'}">
      <el-table-column label="Key名称" min-width="200" align="center">
        <template #default="{row}">
          <div style="display:inline-flex;align-items:center;gap:8px;text-align:left">
            <span class="status-dot" :class="row.status==='active'?'dot-on':'dot-off'"></span>
            <div>
              <div style="font-weight:600;font-size:13px;color:#000;margin-bottom:2px">{{ row.key_name }}</div>
              <code style="font-size:11px;color:#737373;white-space:nowrap">{{ row.key_prefix }}</code>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="分组" width="100" align="center">
        <template #default="{row}">
          <el-tag v-if="row.channel_name" size="small" type="info" effect="light">{{ row.channel_name }}</el-tag>
          <span v-else style="color:#d4d4d4">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{row}">
          <el-tag :type="row.status==='active'?'success':'info'" size="small" effect="plain">{{ row.status==='active'?'启用':'禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="模型" min-width="200" align="center">
        <template #default="{row}">
          <template v-if="row.models?.length">
            <el-tag v-for="m in row.models.slice(0, 3)" :key="m.model_code" size="small" effect="plain" style="margin:1px">{{ m.model_code }}</el-tag>
            <el-popover v-if="row.models.length>3" trigger="hover" :width="260" placement="top">
              <template #reference>
                <el-tag size="small" type="info" effect="plain" style="cursor:pointer;margin:1px">+{{ row.models.length-3 }}</el-tag>
              </template>
              <div style="display:flex;flex-wrap:wrap;gap:4px">
                <el-tag v-for="m in row.models" :key="m.model_code" size="small" effect="plain">{{ m.model_code }}</el-tag>
              </div>
            </el-popover>
          </template>
          <span v-else style="color:#d4d4d4;font-size:12px">—</span>
        </template>
      </el-table-column>
      <el-table-column label="最后使用" width="150" align="center">
        <template #default="{row}">
          <span style="font-size:12px;color:#a3a3a3">{{ formatBeijingTime(row.last_used_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="150" align="center">
        <template #default="{row}">
          <span style="font-size:12px;color:#a3a3a3">{{ formatBeijingTime(row.created_at) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230" align="center">
        <template #default="{row}">
          <div style="display:flex;gap:6px;justify-content:center">
          <el-button size="small" type="primary" @click="openExport(row)">复制</el-button>
          <el-button size="small" @click="toggleKey(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button>
          <el-popconfirm title="确定删除？" @confirm="deleteKey(row.id)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="使用文档" min-width="90" align="center">
        <template #default="{row}">
          <el-button v-if="row.channel_name" size="small" type="success" @click="openDocs(row)" :loading="docsLoading && docsTarget===row"><BookOpen :size="13"/></el-button>
          <span v-else style="color:#d4d4d4;font-size:12px">—</span>
        </template>
      </el-table-column>
    </el-table>
  </div>

  <!-- 弹窗 -->
  <el-dialog v-model="createDialog" width="520px"><template #header><span style="font-weight:700;font-size:16px"><Key :size="18" style="margin-right:6px;vertical-align:middle"/> 创建 API Key</span></template>
    <el-form label-width="80px">
      <el-form-item label="Key 名称"><el-input v-model="newKeyName" placeholder="例如：我的开发密钥"/></el-form-item>
      <el-form-item label="选择分组" required>
        <div v-if="channelLoading" style="text-align:center;padding:10px;color:#a3a3a3">加载分组列表...</div>
        <el-radio-group v-model="selectedChannelId" v-else style="width:100%">
          <div v-for="c in channels" :key="c.id" style="margin-bottom:8px;display:flex;align-items:center">
            <el-radio :value="c.id"><span style="font-weight:500">{{ c.channel_name }}</span><span style="color:#a3a3a3;font-size:12px;margin-left:8px">{{ c.model_count }} 个模型</span></el-radio>
          </div>
        </el-radio-group>
        <div v-if="!channelLoading && channels.length===0" style="color:#a3a3a3;text-align:center;padding:10px">暂无可用分组</div>
      </el-form-item>
      <el-alert v-if="selectedChannelId && selectedChannel" :title="`选择「${selectedChannel.channel_name}」分组，Key 将自动拥有该分组所有模型权限`" type="info" :closable="false" style="margin-top:8px"/>
    </el-form>
    <template #footer><el-button @click="createDialog=false">取消</el-button><el-button type="primary" :loading="creating" @click="createKey" :disabled="!selectedChannelId">创建</el-button></template>
  </el-dialog>

  <el-dialog v-model="resultDialog" width="540px" :close-on-click-modal="false" :close-on-press-escape="false"><template #header><div style="display:flex;align-items:center;gap:8px"><CircleCheck :size="20" color="#22c55e"/> API Key 创建成功</div></template>
    <el-alert title="请立即复制保存此 Key！关闭后无法再次查看" type="error" show-icon :closable="false"/>
    <div style="background:#f5f5f5;padding:12px;border-radius:6px;margin-top:16px;word-break:break-all;font-family:monospace;font-size:14px">{{ newKeyRaw }}</div>
    <el-button type="primary" style="margin-top:12px" @click="copyKey"><Clipboard :size="14" style="margin-right:4px"/> 复制到剪贴板</el-button>
    <template #footer><el-button @click="resultDialog=false">我已知晓，关闭</el-button></template>
  </el-dialog>

  <el-dialog v-model="exportDialog" width="440px" :close-on-click-modal="false"><template #header><span style="font-weight:700;font-size:16px"><Shield :size="18" style="margin-right:6px;vertical-align:middle"/> 验证身份 — 获取完整密钥</span></template>
    <el-form label-width="80px">
      <el-form-item label="目标密钥"><span style="font-family:monospace;font-size:13px;color:#0EA5E9">{{ exportTarget?.key_name }}</span><br/><span style="color:#a3a3a3;font-size:12px">{{ exportTarget?.key_prefix }}</span></el-form-item>
      <el-form-item label="登录密码"><el-input v-model="exportPwd" type="password" show-password placeholder="请输入您的登录密码"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="exportDialog=false">取消</el-button><el-button type="primary" :loading="exportLoading" @click="doExport">验证并获取</el-button></template>
  </el-dialog>

  <el-dialog v-model="exportResultDialog" width="540px" :close-on-click-modal="false" :close-on-press-escape="false"><template #header><span style="font-weight:700;font-size:16px"><CircleCheck :size="18" style="margin-right:6px;vertical-align:middle;color:#22c55e"/> 完整 API Key</span></template>
    <div style="background:#f5f5f5;padding:12px;border-radius:6px;word-break:break-all;font-family:monospace;font-size:14px">{{ exportedRaw }}</div>
    <el-button type="primary" style="margin-top:12px" @click="copyExported"><Clipboard :size="14" style="margin-right:4px"/> 复制到剪贴板</el-button>
    <template #footer><el-button @click="exportResultDialog=false">关闭</el-button></template>
  </el-dialog>

  <el-dialog v-model="docsDialog" width="700px" :close-on-click-modal="false" destroy-on-close><template #header><span style="font-weight:700;font-size:16px"><BookOpen :size="18" style="margin-right:6px;vertical-align:middle"/> {{ docsChannelName }} — 使用说明</span></template>
    <div v-if="docsLoading" style="text-align:center;padding:40px"><Loader2 :size="28" color="#0EA5E9" style="animation:spin 1s linear infinite"/><p style="color:#a3a3a3;margin-top:12px">加载文档...</p></div>
    <template v-else>
      <div style="margin-bottom:12px"><el-tag type="success" size="small" style="margin-right:8px">{{ docsData.protocol_label }}</el-tag><span style="font-size:12px;color:#a3a3a3">端点：<code>{{ docsData.endpoint }}</code></span></div>
      <div v-if="docsData.models?.length" style="margin-bottom:12px;font-size:12px;color:#525252">可用模型：<el-tag v-for="m in docsData.models" :key="m.model_code" size="small" style="margin:2px">{{ m.model_code }}</el-tag></div>
      <div style="display:flex;gap:0;margin-bottom:0;border-bottom:2px solid #000">
        <button v-for="tab in tabs" :key="tab.key" @click="activeTab=tab.key" :style="{background:activeTab===tab.key?'#000':'#f5f5f5',color:activeTab===tab.key?'#fff':'#525252',border:'none',padding:'8px 20px',cursor:'pointer',fontSize:'13px',fontWeight:activeTab===tab.key?600:400}" type="button">{{ tab.label }}</button>
      </div>
      <div style="background:#1e1e1e;padding:16px 20px;overflow-x:auto;position:relative">
        <el-button size="small" text style="position:absolute;top:10px;right:16px;z-index:1;color:#a3a3a3" @click="copyDocsCode"><Clipboard :size="12" style="margin-right:3px"/>{{ docsCopied ? '已复制' : '复制' }}</el-button>
        <pre style="margin:0;font-family:monospace;font-size:12px;line-height:1.6;color:#d4d4d4;white-space:pre-wrap;word-break:break-all;padding-top:28px">{{ activeCode }}</pre>
      </div>
    </template>
    <template #footer><el-button @click="docsDialog=false">关闭</el-button></template>
  </el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
import { formatBeijingTime } from '@/utils/time'
import { useMobile } from '@/composables/useMobile'
import { Key, BookOpen, CircleCheck, Clipboard, Shield, RefreshCw, Loader2 } from '@lucide/vue'
const keys=ref([]),loading=ref(false),createDialog=ref(false),resultDialog=ref(false),creating=ref(false),newKeyName=ref(''),newKeyRaw=ref('')
const channels=ref([]),selectedChannelId=ref(null),channelLoading=ref(false)
const selectedChannel=computed(()=>channels.value.find(c=>c.id===selectedChannelId.value))
const exportDialog=ref(false),exportResultDialog=ref(false),exportTarget=ref(null),exportLoading=ref(false),exportedRaw=ref('')
const exportPwd=ref('')
const docsDialog=ref(false),docsLoading=ref(false),docsTarget=ref(null),docsData=ref({}),docsChannelName=ref(''),docsCopied=ref(false)
const tabs=[{key:'curl',label:'cURL'},{key:'python',label:'Python'},{key:'nodejs',label:'Node.js'}]
const activeTab=ref('curl');const activeCode=computed(()=>docsData.value?.[activeTab.value]||'')
const isMobile=useMobile()
onMounted(()=>{fetchKeys()})
async function fetchKeys(){loading.value=true;try{keys.value=(await api.get('/api/user/keys')).data.data}catch(e){}loading.value=false}
async function openCreate(){createDialog.value=true;selectedChannelId.value=null;channelLoading.value=true;try{channels.value=(await api.get('/api/user/channels')).data.data}catch(e){}channelLoading.value=false}
async function createKey(){if(!selectedChannelId.value){ElMessage.warning('请选择分组');return};creating.value=true;try{const r=await api.post('/api/user/keys',{key_name:newKeyName.value,routing_group_id:selectedChannelId.value});newKeyRaw.value=r.data.key.key_raw;createDialog.value=false;resultDialog.value=true;newKeyName.value='';fetchKeys()}catch(e){}creating.value=false}
async function toggleKey(k){await api.patch('/api/user/keys/'+k.id+'/toggle');ElMessage.success('操作成功');fetchKeys()}
async function deleteKey(id){await api.delete('/api/user/keys/'+id);ElMessage.success('已删除');fetchKeys()}
async function copyKey(){await navigator.clipboard.writeText(newKeyRaw.value);ElMessage.success('已复制')}
function openExport(row){exportTarget.value=row;exportPwd.value='';exportDialog.value=true}
async function doExport(){if(!exportPwd.value){ElMessage.warning('请输入登录密码');return};exportLoading.value=true;try{const r=await api.post('/api/user/keys/'+exportTarget.value.id+'/export',{password:exportPwd.value});exportedRaw.value=r.data.key_raw;exportDialog.value=false;exportResultDialog.value=true;exportPwd.value=''}catch(e){}exportLoading.value=false}
async function copyExported(){await navigator.clipboard.writeText(exportedRaw.value);ElMessage.success('已复制')}
async function openDocs(row){docsTarget.value=row;docsDialog.value=true;docsLoading.value=true;docsData.value={};docsChannelName.value=row.channel_name;activeTab.value='curl';docsCopied.value=false;try{const r=await api.get('/api/user/docs/channel?channel_name='+encodeURIComponent(row.channel_name));docsData.value=r.data}catch(e){ElMessage.error('获取文档失败')};docsLoading.value=false}
async function copyDocsCode(){try{await navigator.clipboard.writeText(activeCode.value);docsCopied.value=true;ElMessage.success('已复制');setTimeout(()=>docsCopied.value=false,2000)}catch(e){}}
</script>

<style scoped>
.dashboard{padding:20px 24px}
.kpi-row{margin-bottom:16px}
.kpi-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:box-shadow .2s}
.kpi-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.05)}
.kpi-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-body{flex:1;min-width:0}
.kpi-label{font-size:12px;color:#525252;margin-bottom:4px;font-weight:500;text-transform:uppercase}
.kpi-value{font-size:24px;font-weight:700;color:#000;white-space:nowrap}
.filter-bar{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 20px;margin-bottom:12px;display:flex;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,0.04)}

/* 毛玻璃表格 */
.glass-table{
  background:rgba(255,255,255,0.82);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  border:1px solid rgba(229,229,229,0.7);
  border-radius:16px;
  overflow:hidden;
  box-shadow:0 4px 24px rgba(0,0,0,0.04);
}

/* 状态指示灯 */
.status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot-on{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,0.12)}
.dot-off{background:#d4d4d4}

/* 渐进入场 */
@keyframes appear-up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.kpi-appear-1{animation:appear-up .4s cubic-bezier(.4,0,.2,1) both;animation-delay:.05s}
.kpi-appear-2{animation:appear-up .4s cubic-bezier(.4,0,.2,1) both;animation-delay:.1s}
.kpi-appear-3{animation:appear-up .4s cubic-bezier(.4,0,.2,1) both;animation-delay:.15s}
.kpi-appear-4{animation:appear-up .4s cubic-bezier(.4,0,.2,1) both;animation-delay:.2s}
.mobile-key-list{display:grid;gap:10px;min-height:100px}.mobile-key-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px}.mobile-key-head,.mobile-key-head>div{display:flex;align-items:center;gap:9px}.mobile-key-head{justify-content:space-between}.mobile-key-card>code{display:block;color:#737373;font-size:11px;margin:7px 0 12px;overflow:hidden;text-overflow:ellipsis}.mobile-key-meta{display:grid;grid-template-columns:1fr 70px;gap:8px}.mobile-key-meta span{background:#f8fafc;border-radius:8px;padding:8px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-key-meta span:last-child{grid-column:1/-1}.mobile-key-meta small{display:block;color:#94a3b8;font-size:10px;margin-bottom:2px}.mobile-key-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.mobile-key-actions .el-button{margin:0;flex:1;min-width:64px}
@media(max-width:768px){.kpi-card{padding:14px 16px}.filter-bar{padding:12px 14px}.filter-bar>div{width:100%;margin-left:0!important}.filter-bar .el-button--primary{flex:1}.kpi-row{margin-bottom:12px}}
</style>
