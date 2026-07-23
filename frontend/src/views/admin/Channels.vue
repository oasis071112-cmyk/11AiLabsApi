<template>
<div class="routing-page admin-page">
  <div class="flex-between mb-16">
    <div><h3>路由与渠道</h3><div class="page-hint">API Key 绑定路由分组；每个分组可配置多个上游渠道并自动择优。</div></div>
  </div>

  <section class="section-card">
    <div class="section-head"><div><h4>路由分组</h4><p>面向用户展示，决定 Key 可以使用哪些模型和上游。</p></div><el-button type="primary" @click="openGroup()">+ 新增分组</el-button></div>
    <el-table :data="activeGroups" stripe v-loading="groupLoading">
      <el-table-column prop="group_name" label="分组名称" min-width="170"/>
      <el-table-column label="上游渠道" min-width="260"><template #default="{row}"><el-tag v-for="item in row.channels" :key="item.channel_id" size="small" effect="plain" class="mr-tag">{{ item.channel_name }}</el-tag><span v-if="!row.channels.length" class="muted">未配置</span></template></el-table-column>
      <el-table-column prop="model_count" label="授权模型" width="90"/>
      <el-table-column prop="key_count" label="绑定 Key" width="90"/>
      <el-table-column label="备用分组" width="130"><template #default="{row}">{{ row.fallback_group_name||'—' }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status==='active'?'启用':'停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="220" fixed="right"><template #default="{row}"><el-button size="small" @click="openGroup(row)">编辑</el-button><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleGroup(row)">{{ row.status==='active'?'停用':'启用' }}</el-button><el-popconfirm title="确定删除该分组？若仍有有效 API Key，系统会阻止删除。" @confirm="deleteGroup(row)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></template></el-table-column>
    </el-table>
    <el-collapse v-if="inactiveGroups.length" v-model="collapsedSections" class="inactive-section"><el-collapse-item name="groups"><template #title><span>已停用分组（{{ inactiveGroups.length }}）</span><span class="collapse-hint">点击展开查看</span></template><el-table :data="inactiveGroups" stripe><el-table-column prop="group_name" label="分组名称" min-width="170"/><el-table-column label="上游渠道" min-width="260"><template #default="{row}"><el-tag v-for="item in row.channels" :key="item.channel_id" size="small" effect="plain" class="mr-tag">{{ item.channel_name }}</el-tag><span v-if="!row.channels.length" class="muted">未配置</span></template></el-table-column><el-table-column prop="model_count" label="授权模型" width="90"/><el-table-column prop="key_count" label="绑定 Key" width="90"/><el-table-column label="操作" width="220" fixed="right"><template #default="{row}"><el-button size="small" @click="openGroup(row)">编辑</el-button><el-button size="small" type="success" @click="toggleGroup(row)">启用</el-button><el-popconfirm title="确定删除该分组？若仍有有效 API Key，系统会阻止删除。" @confirm="deleteGroup(row)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></template></el-table-column></el-table></el-collapse-item></el-collapse>
  </section>

  <section class="section-card">
    <div class="section-head"><div><h4>上游渠道</h4><p>真实 API 地址和密钥。当前支持任意名称的 OpenAI 兼容渠道。</p></div><el-button type="primary" plain @click="openChannel()">+ 新增渠道</el-button></div>
    <el-table :data="activeChannels" stripe v-loading="channelLoading">
      <el-table-column prop="channel_name" label="渠道名称" min-width="150"/>
      <el-table-column prop="base_url" label="上游地址" min-width="250" show-overflow-tooltip/>
      <el-table-column label="所属分组" min-width="180"><template #default="{row}">{{ row.group_names||'未加入分组' }}</template></el-table-column>
      <el-table-column prop="model_count" label="模型" width="70"/>
      <el-table-column label="接口能力" min-width="260"><template #default="{row}"><el-tag v-if="row.capabilities?.includes('chat_completions')" size="small" effect="plain" class="mr-tag">对话</el-tag><el-tag v-if="row.capabilities?.includes('embeddings')" size="small" effect="plain" type="success" class="mr-tag">向量</el-tag><el-tag v-if="row.capabilities?.includes('image_generations')" size="small" effect="plain" type="warning" class="mr-tag">生图</el-tag><el-tag v-if="row.capabilities?.includes('responses')" size="small" effect="plain" type="primary" class="mr-tag">Responses</el-tag></template></el-table-column>
      <el-table-column label="健康" width="90"><template #default="{row}"><el-tag :type="healthType(row)" size="small">{{ healthLabel(row) }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status==='active'?'启用':'停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="430" fixed="right"><template #default="{row}"><el-button size="small" @click="openChannel(row)">编辑</el-button><el-button size="small" @click="openMappings(row)">模型映射</el-button><el-button size="small" type="primary" plain :loading="syncingId===row.id" @click="syncModels(row)">同步模型</el-button><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleChannel(row)">{{ row.status==='active'?'停用':'启用' }}</el-button><el-popconfirm title="确定删除该渠道？若仍被路由分组使用，系统会阻止删除。" @confirm="deleteChannel(row)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></template></el-table-column>
    </el-table>
    <el-collapse v-if="inactiveChannels.length" v-model="collapsedSections" class="inactive-section"><el-collapse-item name="channels"><template #title><span>已停用渠道（{{ inactiveChannels.length }}）</span><span class="collapse-hint">点击展开查看</span></template><el-table :data="inactiveChannels" stripe><el-table-column prop="channel_name" label="渠道名称" min-width="150"/><el-table-column prop="base_url" label="上游地址" min-width="250" show-overflow-tooltip/><el-table-column label="所属分组" min-width="180"><template #default="{row}">{{ row.group_names||'未加入分组' }}</template></el-table-column><el-table-column prop="model_count" label="模型" width="70"/><el-table-column label="操作" width="430" fixed="right"><template #default="{row}"><el-button size="small" @click="openChannel(row)">编辑</el-button><el-button size="small" @click="openMappings(row)">模型映射</el-button><el-button size="small" type="success" @click="toggleChannel(row)">启用</el-button><el-popconfirm title="确定删除该渠道？若仍被路由分组使用，系统会阻止删除。" @confirm="deleteChannel(row)"><template #reference><el-button size="small" type="danger">删除</el-button></template></el-popconfirm></template></el-table-column></el-table></el-collapse-item></el-collapse>
  </section>

  <el-dialog v-model="groupDialog" :title="editingGroup?'编辑路由分组':'新增路由分组'" width="760px">
    <el-form :model="groupForm" label-width="100px">
      <el-form-item label="分组名称" required><el-input v-model="groupForm.group_name" placeholder="例如：稳定线路、低价线路"/></el-form-item>
      <el-form-item label="说明"><el-input v-model="groupForm.description" type="textarea" :rows="2"/></el-form-item>
      <el-form-item label="备用分组"><el-select v-model="groupForm.fallback_group_id" clearable placeholder="主分组无可用渠道时切换"><el-option v-for="item in fallbackGroups" :key="item.id" :label="item.group_name" :value="item.id"/></el-select></el-form-item>
      <el-form-item label="限制模型"><el-switch v-model="groupForm.restrict_models"/><span class="switch-help">开启后，只向该分组 Key 展示并授权下方选中的模型</span></el-form-item>
      <el-form-item v-if="groupForm.restrict_models" label="可见模型"><el-select v-model="groupForm.model_codes" multiple filterable collapse-tags collapse-tags-tooltip style="width:100%" placeholder="选择该分组允许的模型"><el-option v-for="model in models" :key="model.model_code" :label="`${model.model_name}（${model.model_code}）`" :value="model.model_code"/></el-select></el-form-item>
      <el-form-item label="上游渠道">
        <el-table :data="groupForm.channels" size="small" border>
          <el-table-column label="启用" width="70"><template #default="{row}"><el-switch v-model="row.selected"/></template></el-table-column>
          <el-table-column prop="channel_name" label="渠道" min-width="180"/>
          <el-table-column label="优先级" width="140"><template #default="{row}"><el-input-number v-model="row.priority" :min="0" :max="999" size="small" :disabled="!row.selected"/></template></el-table-column>
          <el-table-column label="流量权重" width="140"><template #default="{row}"><el-input-number v-model="row.weight" :min="1" :max="1000" size="small" :disabled="!row.selected"/></template></el-table-column>
          <el-table-column label="健康" width="90"><template #default="{row}">{{ Math.round(row.health_score||0) }}%</template></el-table-column>
        </el-table>
      </el-form-item>
    </el-form>
    <template #footer><el-button @click="groupDialog=false">取消</el-button><el-button type="primary" :loading="savingGroup" @click="saveGroup">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="channelDialog" :title="editingChannel?'编辑上游渠道':'新增上游渠道'" width="520px">
    <el-form :model="channelForm" label-width="100px">
      <el-form-item label="渠道名称" required><el-input v-model="channelForm.channel_name" placeholder="可自定义，例如：Uozi 主线路"/></el-form-item>
      <el-form-item label="协议"><el-select v-model="channelForm.protocol_type" disabled><el-option value="openai_compatible" label="OpenAI 兼容协议"/></el-select></el-form-item>
      <el-form-item label="上游地址" required><el-input v-model="channelForm.base_url" placeholder="https://example.com/v1"/></el-form-item>
      <el-form-item label="API Key" required><el-input v-model="channelForm.api_key" type="password" show-password :placeholder="editingChannel?'已配置，留空表示不修改':'请输入上游 API Key'"/></el-form-item>
      <el-form-item label="接口能力" required><div><el-checkbox-group v-model="channelForm.capabilities"><el-checkbox value="chat_completions">对话 / Chat Completions</el-checkbox><el-checkbox value="embeddings">向量 / Embeddings</el-checkbox><el-checkbox value="image_generations">生图 / Images Generations</el-checkbox><el-checkbox value="responses">Responses 原生工具</el-checkbox></el-checkbox-group><div class="switch-help">只会把请求分配给已声明对应接口能力的渠道。</div></div></el-form-item>
      <el-form-item label="默认优先级"><el-input-number v-model="channelForm.priority" :min="0"/></el-form-item>
      <el-form-item label="默认权重"><el-input-number v-model="channelForm.weight" :min="1" :max="1000"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="channelDialog=false">取消</el-button><el-button type="primary" :loading="savingChannel" @click="saveChannel">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="mappingDialog" :title="`${mappingChannel?.channel_name||''} · 模型映射`" width="760px">
    <el-alert title="公开模型名供用户调用；上游模型名和图片输入能力按渠道分别配置。只有这里开启图片输入的映射才会接收图片请求。" type="info" :closable="false" style="margin-bottom:12px"/>
    <el-input v-model="mappingSearch" clearable placeholder="搜索模型" style="margin-bottom:12px"/>
    <el-table :data="filteredMappings" height="430" v-loading="mappingLoading">
      <el-table-column label="启用" width="70"><template #default="{row}"><el-switch v-model="row.selected"/></template></el-table-column>
      <el-table-column label="公开模型" min-width="230"><template #default="{row}"><strong>{{ row.model_name }}</strong><div class="muted">{{ row.model_code }}</div></template></el-table-column>
      <el-table-column label="该渠道上游模型名" min-width="280"><template #default="{row}"><el-input v-model="row.upstream_model_name" :disabled="!row.selected" placeholder="上游实际模型 ID"/></template></el-table-column>
      <el-table-column label="图片输入" width="105"><template #default="{row}"><el-switch v-model="row.supports_image_input" :disabled="!row.selected"/></template></el-table-column>
    </el-table>
    <template #footer><el-button @click="mappingDialog=false">取消</el-button><el-button type="primary" :loading="savingMappings" @click="saveMappings">保存映射</el-button></template>
  </el-dialog>
</div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { ElMessage } from 'element-plus'

const groups=ref([]),channels=ref([]),models=ref([]),groupLoading=ref(false),channelLoading=ref(false),syncingId=ref(null)
const groupDialog=ref(false),editingGroup=ref(null),savingGroup=ref(false),groupForm=ref({}),collapsedSections=ref([])
const channelDialog=ref(false),editingChannel=ref(null),savingChannel=ref(false),channelForm=ref({}),originalApiKey=ref('')
const mappingDialog=ref(false),mappingChannel=ref(null),mappingRows=ref([]),mappingSearch=ref(''),mappingLoading=ref(false),savingMappings=ref(false)
const fallbackGroups=computed(()=>groups.value.filter(item=>item.id!==editingGroup.value?.id))
const filteredMappings=computed(()=>{const term=mappingSearch.value.trim().toLowerCase();return term?mappingRows.value.filter(item=>`${item.model_name} ${item.model_code}`.toLowerCase().includes(term)):mappingRows.value})
const activeGroups=computed(()=>groups.value.filter(item=>item.status==='active'))
const inactiveGroups=computed(()=>groups.value.filter(item=>item.status!=='active'))
const activeChannels=computed(()=>channels.value.filter(item=>item.status==='active'))
const inactiveChannels=computed(()=>channels.value.filter(item=>item.status!=='active'))

onMounted(loadAll)
async function loadAll(){await Promise.all([loadGroups(),loadChannels(),loadModels()])}
async function loadGroups(){groupLoading.value=true;try{groups.value=(await api.get('/api/admin/routing-groups')).data.data||[]}finally{groupLoading.value=false}}
async function loadChannels(){channelLoading.value=true;try{channels.value=(await api.get('/api/admin/channels')).data.data||[]}finally{channelLoading.value=false}}
async function loadModels(){models.value=(await api.get('/api/admin/models')).data.data||[]}

function openGroup(row){editingGroup.value=row||null;const linked=new Map((row?.channels||[]).map(item=>[item.channel_id,item]));groupForm.value={group_name:row?.group_name||'',description:row?.description||'',fallback_group_id:row?.fallback_group_id||null,status:row?.status||'active',restrict_models:Number(row?.restrict_models||0)===1,model_codes:[...(row?.model_codes||[])],channels:channels.value.map(channel=>{const link=linked.get(channel.id);return{channel_id:channel.id,channel_name:channel.channel_name,health_score:channel.health_score,selected:!!link,priority:link?.priority??channel.priority??0,weight:link?.weight??channel.weight??100}})};groupDialog.value=true}
async function saveGroup(){if(!groupForm.value.group_name.trim()){ElMessage.warning('请输入分组名称');return}savingGroup.value=true;try{const payload={...groupForm.value,channels:groupForm.value.channels.filter(item=>item.selected).map(({channel_id,priority,weight})=>({channel_id,priority,weight,status:'active'}))};if(editingGroup.value)await api.put(`/api/admin/routing-groups/${editingGroup.value.id}`,payload);else await api.post('/api/admin/routing-groups',payload);ElMessage.success('分组已保存');groupDialog.value=false;await loadGroups()}finally{savingGroup.value=false}}
async function toggleGroup(row){const nextStatus=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/routing-groups/${row.id}/status`,{status:nextStatus});if(nextStatus==='inactive')collapsedSections.value=collapsedSections.value.filter(item=>item!=='groups');await loadGroups()}
async function deleteGroup(row){await api.delete(`/api/admin/routing-groups/${row.id}`);ElMessage.success('分组已删除');await loadGroups()}

const emptyChannel=()=>({channel_name:'',base_url:'',api_key:'',priority:0,weight:100,protocol_type:'openai_compatible',capabilities:['chat_completions']})
function openChannel(row){editingChannel.value=row||null;channelForm.value=row?{...row}:emptyChannel();originalApiKey.value=row?.api_key||'';channelDialog.value=true}
async function saveChannel(){if(!channelForm.value.channel_name.trim()||!channelForm.value.base_url.trim()){ElMessage.warning('请填写渠道名称和上游地址');return}if(!channelForm.value.capabilities?.length){ElMessage.warning('请至少选择一种接口能力');return}savingChannel.value=true;try{const payload={...channelForm.value};if(editingChannel.value&&payload.api_key===originalApiKey.value)payload.api_key='';if(editingChannel.value)await api.put(`/api/admin/channels/${editingChannel.value.id}`,payload);else await api.post('/api/admin/channels',payload);ElMessage.success('渠道已保存');channelDialog.value=false;await loadAll()}finally{savingChannel.value=false}}
async function toggleChannel(row){const nextStatus=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/channels/${row.id}/status`,{status:nextStatus});if(nextStatus==='inactive')collapsedSections.value=collapsedSections.value.filter(item=>item!=='channels');await loadAll()}
async function deleteChannel(row){await api.delete(`/api/admin/channels/${row.id}`);ElMessage.success('渠道已删除');await loadAll()}
async function syncModels(row){syncingId.value=row.id;try{const result=await api.post(`/api/admin/channels/${row.id}/sync-models`);ElMessage.success(result.data.message);await loadAll()}finally{syncingId.value=null}}
async function openMappings(row){mappingChannel.value=row;mappingDialog.value=true;mappingLoading.value=true;mappingSearch.value='';try{const result=(await api.get(`/api/admin/channels/${row.id}/models`)).data;const byCode=new Map((result.mappings||[]).map(item=>[item.model_code,item]));mappingRows.value=(result.data||[]).map(model=>{const mapping=byCode.get(model.model_code);return{...model,selected:mapping?.status==='active',upstream_model_name:mapping?.upstream_model_name||model.upstream_model_name||model.model_code,supports_image_input:mapping?.supports_image_input==null?Boolean(model.is_multimodal):Number(mapping.supports_image_input)===1}})}finally{mappingLoading.value=false}}
async function saveMappings(){savingMappings.value=true;try{const models=mappingRows.value.filter(item=>item.selected).map(item=>({model_code:item.model_code,upstream_model_name:item.upstream_model_name||item.model_code,supports_image_input:Boolean(item.supports_image_input)}));await api.put(`/api/admin/channels/${mappingChannel.value.id}/models`,{models});ElMessage.success('模型映射已保存');mappingDialog.value=false;await loadAll()}finally{savingMappings.value=false}}
function healthType(row){return row.status!=='active'?'info':Number(row.health_score||0)>=60?'success':'warning'}
function healthLabel(row){return row.status!=='active'?'未启用':Number(row.health_score||0)>=60?'在线':'降级'}
</script>

<style scoped>
.routing-page{padding-bottom:24px}.page-hint,.section-head p{font-size:12px;color:#94a3b8;margin:4px 0 0}.section-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:18px;overflow:hidden}.section-head{padding:16px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eef2f7}.section-head h4{margin:0;color:#0f172a}.mr-tag{margin:2px 4px 2px 0}.muted,.switch-help{color:#94a3b8;font-size:12px}.switch-help{margin-left:10px}.inactive-section{border-top:1px solid #eef2f7}.inactive-section :deep(.el-collapse-item__header){padding:0 18px;font-size:13px;font-weight:600;color:#64748b}.inactive-section :deep(.el-collapse-item__content){padding:0}.collapse-hint{margin-left:auto;margin-right:12px;font-size:12px;font-weight:400;color:#94a3b8}
@media(max-width:768px){.section-card{margin-bottom:12px}.section-head{padding:14px;align-items:flex-start;gap:12px;flex-wrap:wrap}.section-head .el-button{width:100%;margin:0}.switch-help{display:block;margin:6px 0 0}.routing-page :deep(.el-table__inner-wrapper){min-width:680px}.routing-page :deep(.el-dialog .el-table__inner-wrapper){min-width:620px}}
</style>
