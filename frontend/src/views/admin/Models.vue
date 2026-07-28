<template>
<div class="models-page admin-page">
  <div class="flex-between mb-16">
    <div><h3>模型管理</h3><div class="page-hint">按官方厂商和模型类型分类查看</div></div>
    <div><el-button :loading="syncing" @click="syncPricing">同步官方价格与汇率</el-button><el-button type="primary" @click="openDialog()">+ 新增模型</el-button></div>
  </div>

  <el-tabs v-model="activeProvider" class="provider-tabs">
    <el-tab-pane v-for="provider in providerTabs" :key="provider.value" :name="provider.value">
      <template #label><span>{{ provider.label }}</span><el-tag size="small" effect="plain" round>{{ provider.count }}</el-tag></template>
    </el-tab-pane>
  </el-tabs>

  <div class="type-filter">
    <el-radio-group v-model="activeType" size="small">
      <el-radio-button value="all">全部 {{ providerModels.length }}</el-radio-button>
      <el-radio-button v-for="item in typeTabs" :key="item.value" :value="item.value">{{ item.label }} {{ item.count }}</el-radio-button>
    </el-radio-group>
  </div>

  <div class="table-card" v-loading="loading">
    <el-table class="desktop-model-table" :data="activeModels" stripe empty-text="该分类暂无已上架模型">
      <el-table-column type="expand" width="52"><template #default="{row}"><div class="channel-mapping-list"><div class="mapping-title">渠道来源与映射状态</div><article v-for="mapping in row.channel_mappings" :key="mapping.channel_id" class="channel-mapping-row"><div><strong>{{ mapping.channel_name }}</strong><span>{{ mapping.upstream_model_name }}</span><div class="mapping-groups"><el-tag v-for="group in mapping.routing_group_names" :key="group" size="small" effect="plain">{{ group }}</el-tag><em v-if="mapping.channel_status!=='active'">渠道已停用</em></div></div><el-switch :model-value="mapping.status==='active'" :disabled="mapping.channel_status!=='active'&&mapping.status!=='active'" @change="toggleMapping(row,mapping)"/></article><el-empty v-if="!row.channel_mappings?.length" description="暂无渠道映射，请先在渠道管理中添加" :image-size="44"/></div></template></el-table-column>
      <el-table-column label="模型" min-width="230"><template #default="{row}"><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></template></el-table-column>
      <el-table-column label="分类" width="110"><template #default="{row}"><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></template></el-table-column>
      <el-table-column label="价格" min-width="290"><template #default="{row}"><div v-if="row.model_type==='image'" class="price-pair"><el-tag size="small" type="info">默认兜底</el-tag><span>单张 {{ imagePrice(row) }}</span></div><div v-else-if="row.official_input_price||row.official_output_price" class="price-pair"><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>缓存 {{ currency(row.official_currency) }}{{ row.official_cached_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div><span v-else class="pending">待同步</span></template></el-table-column>
      <el-table-column label="平台兜底倍率" width="175"><template #default="{row}"><div class="multiplier"><span>输入 ×{{ row.billing_multiplier_input }}</span><span>输出 ×{{ row.billing_multiplier_output }}</span><span v-if="row.model_type==='image'">图片 ×{{ row.billing_multiplier_image }}</span></div></template></el-table-column>
      <el-table-column label="映射状态" width="120"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ mappingSummary(row) }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="90" fixed="right"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button></template></el-table-column>
    </el-table>
    <el-collapse v-if="inactiveModels.length" v-model="expandedSections" class="inactive-models desktop-inactive-models">
      <el-collapse-item name="inactive">
        <template #title><span>已下架模型（{{ inactiveModels.length }}）</span><span class="collapse-hint">点击展开查看</span></template>
        <el-table :data="inactiveModels" stripe>
          <el-table-column type="expand" width="52"><template #default="{row}"><div class="channel-mapping-list"><div class="mapping-title">渠道来源与映射状态</div><article v-for="mapping in row.channel_mappings" :key="mapping.channel_id" class="channel-mapping-row"><div><strong>{{ mapping.channel_name }}</strong><span>{{ mapping.upstream_model_name }}</span><div class="mapping-groups"><el-tag v-for="group in mapping.routing_group_names" :key="group" size="small" effect="plain">{{ group }}</el-tag><em v-if="mapping.channel_status!=='active'">渠道已停用</em></div></div><el-switch :model-value="mapping.status==='active'" :disabled="mapping.channel_status!=='active'&&mapping.status!=='active'" @change="toggleMapping(row,mapping)"/></article><el-empty v-if="!row.channel_mappings?.length" description="暂无渠道映射，请先在渠道管理中添加" :image-size="44"/></div></template></el-table-column>
          <el-table-column label="模型" min-width="230"><template #default="{row}"><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></template></el-table-column>
          <el-table-column label="分类" width="110"><template #default="{row}"><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></template></el-table-column>
          <el-table-column label="价格" min-width="290"><template #default="{row}"><div v-if="row.model_type==='image'" class="price-pair"><el-tag size="small" type="info">默认兜底</el-tag><span>单张 {{ imagePrice(row) }}</span></div><div v-else-if="row.official_input_price||row.official_output_price" class="price-pair"><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div><span v-else class="pending">待同步</span></template></el-table-column>
          <el-table-column label="平台兜底倍率" width="175"><template #default="{row}"><div class="multiplier"><span>输入 ×{{ row.billing_multiplier_input }}</span><span>输出 ×{{ row.billing_multiplier_output }}</span><span v-if="row.model_type==='image'">图片 ×{{ row.billing_multiplier_image }}</span></div></template></el-table-column>
          <el-table-column label="映射状态" width="120"><template #default="{row}"><el-tag type="info" size="small">{{ mappingSummary(row) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button></template></el-table-column>
        </el-table>
      </el-collapse-item>
    </el-collapse>

    <div class="mobile-model-list">
      <article v-for="row in activeModels" :key="row.id" class="mobile-model-card">
        <div class="mobile-model-head"><div><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></div><el-tag type="success" size="small">{{ mappingSummary(row) }}</el-tag></div>
        <div class="mobile-model-meta"><div><small>分类</small><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></div><div><small>图片能力默认</small><span>{{ row.is_multimodal?'开启':'关闭' }}</span></div><div><small>平台输入兜底</small><span>×{{ row.billing_multiplier_input }}</span></div><div><small>平台输出兜底</small><span>×{{ row.billing_multiplier_output }}</span></div></div>
        <div class="mobile-model-price"><small>{{ row.model_type==='image'?'默认图片价格 / 张':'官方价格 / 1M Token' }}</small><template v-if="row.model_type==='image'"><div><el-tag size="small" type="info">默认兜底</el-tag><span>{{ imagePrice(row) }}</span></div></template><template v-else-if="row.official_input_price||row.official_output_price"><div><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>缓存 {{ currency(row.official_currency) }}{{ row.official_cached_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div></template><span v-else class="pending">待同步</span></div>
        <div class="mobile-channel-mappings"><div class="mapping-title">渠道来源</div><article v-for="mapping in row.channel_mappings" :key="mapping.channel_id"><div><strong>{{ mapping.channel_name }}</strong><small>{{ mapping.routing_group_names?.join('、')||'未加入路由分组' }}</small></div><el-switch :model-value="mapping.status==='active'" :disabled="mapping.channel_status!=='active'&&mapping.status!=='active'" @change="toggleMapping(row,mapping)"/></article><span v-if="!row.channel_mappings?.length" class="pending">暂无渠道映射</span></div>
        <div class="mobile-model-actions single-action"><el-button @click="openDialog(row)">编辑模型资料</el-button></div>
      </article>
      <el-empty v-if="!activeModels.length" description="该分类暂无已上架模型" :image-size="56"/>
    </div>

    <el-collapse v-if="inactiveModels.length" v-model="expandedSections" class="inactive-models mobile-inactive-models">
      <el-collapse-item name="inactive">
        <template #title><span>已下架模型（{{ inactiveModels.length }}）</span><span class="collapse-hint">点击展开查看</span></template>
        <div class="mobile-model-list mobile-inactive-list">
          <article v-for="row in inactiveModels" :key="row.id" class="mobile-model-card">
            <div class="mobile-model-head"><div><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></div><el-tag type="info" size="small">{{ mappingSummary(row) }}</el-tag></div>
            <div class="mobile-model-meta"><div><small>分类</small><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></div><div><small>图片能力默认</small><span>{{ row.is_multimodal?'开启':'关闭' }}</span></div><div><small>平台输入兜底</small><span>×{{ row.billing_multiplier_input }}</span></div><div><small>平台输出兜底</small><span>×{{ row.billing_multiplier_output }}</span></div></div>
            <div class="mobile-model-price"><small>{{ row.model_type==='image'?'默认图片价格 / 张':'官方价格 / 1M Token' }}</small><template v-if="row.model_type==='image'"><div><el-tag size="small" type="info">默认兜底</el-tag><span>{{ imagePrice(row) }}</span></div></template><template v-else-if="row.official_input_price||row.official_output_price"><div><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>缓存 {{ currency(row.official_currency) }}{{ row.official_cached_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div></template><span v-else class="pending">待同步</span></div>
            <div class="mobile-channel-mappings"><div class="mapping-title">渠道来源</div><article v-for="mapping in row.channel_mappings" :key="mapping.channel_id"><div><strong>{{ mapping.channel_name }}</strong><small>{{ mapping.routing_group_names?.join('、')||'未加入路由分组' }}</small></div><el-switch :model-value="mapping.status==='active'" :disabled="mapping.channel_status!=='active'&&mapping.status!=='active'" @change="toggleMapping(row,mapping)"/></article><span v-if="!row.channel_mappings?.length" class="pending">暂无渠道映射</span></div>
            <div class="mobile-model-actions single-action"><el-button @click="openDialog(row)">编辑模型资料</el-button></div>
          </article>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>

  <el-dialog v-model="dialogVisible" :title="isEdit?'编辑模型':'新增模型'" width="650px"><el-form :model="form" label-width="130px">
    <el-form-item label="模型编码"><el-input v-model="form.model_code" :disabled="isEdit"/></el-form-item><el-form-item label="显示名称"><el-input v-model="form.model_name"/></el-form-item><el-form-item label="默认上游模型名"><el-input v-model="form.upstream_model_name"/><div class="form-help">渠道同步后会优先使用各渠道自己的模型映射。</div></el-form-item>
    <el-form-item label="类型"><el-select v-model="form.model_type"><el-option value="llm" label="LLM 对话"/><el-option value="embedding" label="Embedding"/><el-option value="image" label="图像"/><el-option value="audio" label="音频"/><el-option value="video" label="视频"/></el-select></el-form-item>
    <el-form-item label="官方提供方"><el-select v-model="form.official_provider"><el-option value="openai" label="OpenAI"/><el-option value="deepseek" label="DeepSeek"/><el-option value="anthropic" label="Anthropic"/><el-option value="manual" label="待归类（请选择官方厂商）" disabled/></el-select></el-form-item><el-form-item label="官方模型标识"><el-input v-model="form.official_model_id" placeholder="例如 gpt-5.5"/></el-form-item>
    <el-alert v-if="form.model_type==='image'" title="图片生成统一采用默认兜底价格" type="info" :closable="false" description="不设置官方价格或手动价格；实际结算仍按图片尺寸、渠道成本配置和路由分组倍率计算。"/>
    <template v-else>
      <el-form-item label="定价方式"><el-radio-group v-model="form.official_pricing_mode"><el-radio value="auto">自动同步</el-radio><el-radio value="manual">管理员手动录入</el-radio></el-radio-group></el-form-item>
      <template v-if="form.official_pricing_mode==='manual'">
      <el-form-item label="价格币种"><el-radio-group v-model="form.official_currency"><el-radio value="USD">美元 USD</el-radio><el-radio value="CNY">人民币 CNY</el-radio></el-radio-group></el-form-item>
      <el-form-item label="输入价 / 1M"><el-input-number v-model="form.official_input_price" :min="0" :precision="6" :step="0.1"/></el-form-item>
      <el-form-item label="缓存输入价 / 1M"><el-input-number v-model="form.official_cached_input_price" :min="0" :precision="6" :step="0.1"/></el-form-item>
      <el-form-item label="输出价 / 1M"><el-input-number v-model="form.official_output_price" :min="0" :precision="6" :step="0.1"/></el-form-item>
      <el-divider content-position="left">图片生成单价 / 张</el-divider>
      <el-form-item label="1K 单张价格"><el-input-number v-model="form.official_image_price_1k" :min="0" :precision="6" :step="0.01"/><div class="form-help">适用于最长边不超过 1024px 的图片。</div></el-form-item>
      <el-form-item label="2K 单张价格"><el-input-number v-model="form.official_image_price_2k" :min="0" :precision="6" :step="0.01"/><div class="form-help">适用于最长边不超过 2048px 的图片。</div></el-form-item>
      <el-form-item label="4K 单张价格"><el-input-number v-model="form.official_image_price_4k" :min="0" :precision="6" :step="0.01"/><div class="form-help">适用于最长边超过 2048px 的图片。</div></el-form-item>
      <el-form-item label="方图 1024×1024"><el-input-number v-model="form.official_image_price_square" :min="0" :precision="6" :step="0.01"/></el-form-item>
      <el-form-item label="横图 1536×1024"><el-input-number v-model="form.official_image_price_landscape" :min="0" :precision="6" :step="0.01"/></el-form-item>
      <el-form-item label="竖图 1024×1536"><el-input-number v-model="form.official_image_price_portrait" :min="0" :precision="6" :step="0.01"/></el-form-item>
      <el-alert title="未填写档位价格时，系统继续使用现有兜底价格；手动价格会被锁定，定时同步和手动同步官方价格都不会覆盖。" type="warning" :closable="false"/>
      </template>
    </template>
    <el-form-item label="上下文长度"><el-input-number v-model="form.context_length" :min="0" :step="1024"/></el-form-item><el-form-item label="目录图片能力"><div><el-switch v-model="form.is_multimodal"/><div class="form-help">作为新渠道映射的默认值；实际图片请求还要求对应渠道模型映射已开启“图片输入”。</div></div></el-form-item>
    <el-form-item label="平台兜底倍率(入)"><el-input-number v-model="form.multiplier_input" :min="0.0001" :step="0.1"/></el-form-item><el-form-item label="平台兜底倍率(出)"><el-input-number v-model="form.multiplier_output" :min="0.0001" :step="0.1"/></el-form-item><el-form-item label="平台兜底倍率(图)"><el-input-number v-model="form.multiplier_image" :min="0.0001" :step="0.1"/><div class="form-help">实际优先使用用户专属倍率或路由分组倍率；这里只在前两者未配置时生效。</div></el-form-item>
  </el-form><template #footer><el-button @click="dialogVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '@/api'
import { ElMessage } from 'element-plus'

const models=ref([]),loading=ref(false),dialogVisible=ref(false),isEdit=ref(false),saving=ref(false),syncing=ref(false),expandedSections=ref([])
const activeProvider=ref('openai'),activeType=ref('all')
const providers=[{value:'openai',label:'OpenAI'},{value:'deepseek',label:'DeepSeek'},{value:'anthropic',label:'Anthropic'},{value:'manual',label:'待归类'}]
const types=[{value:'llm',label:'对话'},{value:'embedding',label:'嵌入'},{value:'image',label:'图像'},{value:'audio',label:'音频'},{value:'video',label:'视频'}]
const providerTabs=computed(()=>providers.map(item=>({...item,count:models.value.filter(model=>model.official_provider===item.value).length})))
const providerModels=computed(()=>models.value.filter(model=>model.official_provider===activeProvider.value))
const typeTabs=computed(()=>types.map(item=>({...item,count:providerModels.value.filter(model=>model.model_type===item.value).length})).filter(item=>item.count>0))
const filteredModels=computed(()=>activeType.value==='all'?providerModels.value:providerModels.value.filter(model=>model.model_type===activeType.value))
const activeModels=computed(()=>filteredModels.value.filter(model=>model.status==='active').sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.model_code.localeCompare(b.model_code)))
const inactiveModels=computed(()=>filteredModels.value.filter(model=>model.status!=='active').sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.model_code.localeCompare(b.model_code)))
watch(activeProvider,()=>{activeType.value='all'})
watch([activeProvider,activeType],()=>{expandedSections.value=[]})

const emptyForm=()=>({model_code:'',model_name:'',upstream_model_name:'',model_type:'llm',context_length:4096,is_multimodal:false,multiplier_input:1,multiplier_output:1,multiplier_image:1,official_provider:activeProvider.value,official_model_id:'',official_pricing_mode:'auto',official_currency:activeProvider.value==='deepseek'?'CNY':'USD',official_input_price:0,official_cached_input_price:0,official_output_price:0,official_image_price_1k:null,official_image_price_2k:null,official_image_price_4k:null,official_image_price_square:null,official_image_price_landscape:null,official_image_price_portrait:null,status:'active',sort_order:0})
const form=ref(emptyForm())
onMounted(fetchModels)
const asMultimodal=value=>value===true||Number(value)===1
async function fetchModels(){loading.value=true;try{models.value=((await api.get('/api/admin/models')).data.data||[]).map(model=>({...model,is_multimodal:asMultimodal(model.is_multimodal)}))}catch(e){}loading.value=false}
function imagePrices(value){try{return typeof value==='string'?JSON.parse(value||'{}'):(value||{})}catch(e){return {}}}
function openDialog(row){isEdit.value=!!row;if(!row){form.value=emptyForm()}else{const prices=imagePrices(row.official_image_prices);form.value={...row,is_multimodal:asMultimodal(row.is_multimodal),official_pricing_mode:row.official_pricing_mode||'auto',multiplier_input:row.billing_multiplier_input,multiplier_output:row.billing_multiplier_output,multiplier_image:row.billing_multiplier_image||1,official_image_price_1k:prices['1K']??0,official_image_price_2k:prices['2K']??0,official_image_price_4k:prices['4K']??0,official_image_price_square:prices['1024x1024']??prices.default??0,official_image_price_landscape:prices['1536x1024']??prices.default??0,official_image_price_portrait:prices['1024x1536']??prices.default??0}}dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value)await api.put(`/api/admin/models/${form.value.id}`,form.value);else await api.post('/api/admin/models',form.value);ElMessage.success('保存成功');dialogVisible.value=false;fetchModels()}catch(e){}saving.value=false}
async function toggleMapping(model,mapping){const status=mapping.status==='active'?'inactive':'active';await api.patch(`/api/admin/channels/${mapping.channel_id}/models/${encodeURIComponent(model.model_code)}/status`,{status});ElMessage.success(`${mapping.channel_name} · ${model.model_code} 已${status==='active'?'上架':'下架'}`);fetchModels()}
function mappingSummary(row){const active=(row.channel_mappings||[]).filter(item=>item.status==='active').length;return `${active}/${row.channel_mappings?.length||0} 个渠道启用`}
async function syncPricing(){syncing.value=true;try{const r=await api.post('/api/admin/pricing-sync');ElMessage.success(`同步完成：更新 ${r.data.official_pricing.updated} 个模型，USD/CNY=${r.data.exchange_rate.rate}`);fetchModels()}catch(e){}syncing.value=false}
function currency(value){return value==='USD'?'$':'¥'}
function imagePrice(row){return `${currency(row.default_image_currency||'USD')}${Number(row.default_image_unit_price||0).toFixed(4)}`}
function typeLabel(value){return types.find(item=>item.value===value)?.label||value}
</script>

<style scoped>
.models-page{padding-bottom:24px}.page-hint,.form-help{font-size:12px;color:#94a3b8;margin-top:4px}.provider-tabs :deep(.el-tabs__item){display:flex;gap:8px;align-items:center}.type-filter{display:flex;justify-content:space-between;align-items:center;margin:4px 0 16px}.table-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}.inactive-models{border-top:1px solid #e5e7eb}.inactive-models :deep(.el-collapse-item__header){padding:0 18px;font-size:13px;font-weight:600;color:#64748b}.inactive-models :deep(.el-collapse-item__content){padding:0}.collapse-hint{margin-left:auto;margin-right:10px;font-size:12px;font-weight:400;color:#94a3b8}.model-name{font-weight:600;color:#0f172a}.model-code{font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace}.price-pair,.multiplier{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.price-pair span,.multiplier span{white-space:nowrap}.pending{color:#e6a23c}.mobile-model-list,.mobile-inactive-models{display:none}
.channel-mapping-list{padding:14px 24px;background:#f8fafc}.mapping-title{font-size:12px;font-weight:700;color:#64748b;margin-bottom:10px}.channel-mapping-row{display:grid;grid-template-columns:minmax(210px,1fr) auto;gap:18px;align-items:center;padding:12px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px}.channel-mapping-row>div:first-child{display:flex;flex-direction:column;gap:3px}.channel-mapping-row strong{color:#0f172a}.channel-mapping-row span{font-size:12px;color:#64748b}.mapping-groups{display:flex;gap:5px;flex-wrap:wrap;align-items:center}.mapping-groups em{font-style:normal;color:#dc2626;font-size:12px}.mobile-channel-mappings{border-top:1px solid #f1f5f9;margin-top:10px;padding-top:10px}.mobile-channel-mappings article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}.mobile-channel-mappings article+article{border-top:1px solid #f1f5f9}.mobile-channel-mappings article>div{display:flex;flex-direction:column;gap:3px;min-width:0}.mobile-channel-mappings article strong{color:#0f172a}.mobile-channel-mappings article small{color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.single-action{grid-template-columns:1fr!important}
@media(max-width:768px){.provider-tabs :deep(.el-tabs__nav-scroll){overflow-x:auto}.provider-tabs :deep(.el-tabs__nav){float:none}.type-filter{overflow-x:auto;margin-bottom:12px}.desktop-model-table,.desktop-inactive-models{display:none}.mobile-model-list{display:grid;gap:10px;padding:10px}.mobile-model-card{border:1px solid #e5e7eb;border-radius:12px;padding:13px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.03)}.mobile-model-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.mobile-model-head>div{min-width:0}.mobile-model-head .model-code{max-width:245px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-model-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding:12px 0}.mobile-model-meta>div,.mobile-model-price{display:flex;flex-direction:column;gap:3px;min-width:0}.mobile-model-meta small,.mobile-model-price small{font-size:11px;color:#94a3b8}.mobile-model-meta span{font-size:13px;color:#334155}.mobile-model-price{border-top:1px solid #f1f5f9;padding-top:10px}.mobile-model-price>div{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12px;color:#475569}.mobile-model-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}.mobile-model-actions .el-button{width:100%;min-height:44px;margin:0}.mobile-inactive-models{display:block}.mobile-inactive-list{padding-top:0}.inactive-models :deep(.el-collapse-item__header){padding:0 12px}.collapse-hint{display:block}.model-code{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
</style>
