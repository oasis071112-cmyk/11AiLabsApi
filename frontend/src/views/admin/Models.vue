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
      <el-table-column label="模型" min-width="230"><template #default="{row}"><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></template></el-table-column>
      <el-table-column label="分类" width="110"><template #default="{row}"><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></template></el-table-column>
      <el-table-column label="官方价格 / 1M Token" min-width="290"><template #default="{row}"><div v-if="row.official_input_price||row.official_output_price" class="price-pair"><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>缓存 {{ currency(row.official_currency) }}{{ row.official_cached_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div><span v-else class="pending">待同步</span></template></el-table-column>
      <el-table-column label="用户扣费倍率" width="175"><template #default="{row}"><div class="multiplier"><span>输入 ×{{ row.billing_multiplier_input }}</span><span>输出 ×{{ row.billing_multiplier_output }}</span></div></template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status==='active'?'已上架':'已下架' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="165" fixed="right"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button><el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleStatus(row)">{{ row.status==='active'?'下架':'上架' }}</el-button></template></el-table-column>
    </el-table>
    <el-collapse v-if="inactiveModels.length" v-model="expandedSections" class="inactive-models desktop-inactive-models">
      <el-collapse-item name="inactive">
        <template #title><span>已下架模型（{{ inactiveModels.length }}）</span><span class="collapse-hint">点击展开查看</span></template>
        <el-table :data="inactiveModels" stripe>
          <el-table-column label="模型" min-width="230"><template #default="{row}"><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></template></el-table-column>
          <el-table-column label="分类" width="110"><template #default="{row}"><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></template></el-table-column>
          <el-table-column label="官方价格 / 1M Token" min-width="290"><template #default="{row}"><div v-if="row.official_input_price||row.official_output_price" class="price-pair"><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div><span v-else class="pending">待同步</span></template></el-table-column>
          <el-table-column label="用户扣费倍率" width="175"><template #default="{row}"><div class="multiplier"><span>输入 ×{{ row.billing_multiplier_input }}</span><span>输出 ×{{ row.billing_multiplier_output }}</span></div></template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{row}"><el-tag type="info" size="small">已下架</el-tag></template></el-table-column>
          <el-table-column label="操作" width="165" fixed="right"><template #default="{row}"><el-button size="small" @click="openDialog(row)">编辑</el-button><el-button size="small" type="success" @click="toggleStatus(row)">上架</el-button></template></el-table-column>
        </el-table>
      </el-collapse-item>
    </el-collapse>

    <div class="mobile-model-list">
      <article v-for="row in activeModels" :key="row.id" class="mobile-model-card">
        <div class="mobile-model-head"><div><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></div><el-tag type="success" size="small">已上架</el-tag></div>
        <div class="mobile-model-meta"><div><small>分类</small><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></div><div><small>图片能力默认</small><span>{{ row.is_multimodal?'开启':'关闭' }}</span></div><div><small>输入倍率</small><span>×{{ row.billing_multiplier_input }}</span></div><div><small>输出倍率</small><span>×{{ row.billing_multiplier_output }}</span></div></div>
        <div class="mobile-model-price"><small>官方价格 / 1M Token</small><template v-if="row.official_input_price||row.official_output_price"><div><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>缓存 {{ currency(row.official_currency) }}{{ row.official_cached_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div></template><span v-else class="pending">待同步</span></div>
        <div class="mobile-model-actions"><el-button @click="openDialog(row)">编辑</el-button><el-button type="warning" plain @click="toggleStatus(row)">下架</el-button></div>
      </article>
      <el-empty v-if="!activeModels.length" description="该分类暂无已上架模型" :image-size="56"/>
    </div>

    <el-collapse v-if="inactiveModels.length" v-model="expandedSections" class="inactive-models mobile-inactive-models">
      <el-collapse-item name="inactive">
        <template #title><span>已下架模型（{{ inactiveModels.length }}）</span><span class="collapse-hint">点击展开查看</span></template>
        <div class="mobile-model-list mobile-inactive-list">
          <article v-for="row in inactiveModels" :key="row.id" class="mobile-model-card">
            <div class="mobile-model-head"><div><div class="model-name">{{ row.model_name }}</div><div class="model-code">{{ row.model_code }}</div></div><el-tag type="info" size="small">已下架</el-tag></div>
            <div class="mobile-model-meta"><div><small>分类</small><el-tag size="small" effect="plain">{{ typeLabel(row.model_type) }}</el-tag></div><div><small>图片能力默认</small><span>{{ row.is_multimodal?'开启':'关闭' }}</span></div><div><small>输入倍率</small><span>×{{ row.billing_multiplier_input }}</span></div><div><small>输出倍率</small><span>×{{ row.billing_multiplier_output }}</span></div></div>
            <div class="mobile-model-price"><small>官方价格 / 1M Token</small><template v-if="row.official_input_price||row.official_output_price"><div><el-tag size="small" :type="row.official_pricing_mode==='manual'?'warning':'success'">{{ row.official_pricing_mode==='manual'?'手动锁定':'自动同步' }}</el-tag><span>输入 {{ currency(row.official_currency) }}{{ row.official_input_price }}</span><span>缓存 {{ currency(row.official_currency) }}{{ row.official_cached_input_price }}</span><span>输出 {{ currency(row.official_currency) }}{{ row.official_output_price }}</span></div></template><span v-else class="pending">待同步</span></div>
            <div class="mobile-model-actions"><el-button @click="openDialog(row)">编辑</el-button><el-button type="success" plain @click="toggleStatus(row)">上架</el-button></div>
          </article>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>

  <el-dialog v-model="dialogVisible" :title="isEdit?'编辑模型':'新增模型'" width="650px"><el-form :model="form" label-width="130px">
    <el-form-item label="模型编码"><el-input v-model="form.model_code" :disabled="isEdit"/></el-form-item><el-form-item label="显示名称"><el-input v-model="form.model_name"/></el-form-item><el-form-item label="默认上游模型名"><el-input v-model="form.upstream_model_name"/><div class="form-help">渠道同步后会优先使用各渠道自己的模型映射。</div></el-form-item>
    <el-form-item label="官方提供方"><el-select v-model="form.official_provider"><el-option value="openai" label="OpenAI"/><el-option value="deepseek" label="DeepSeek"/><el-option value="anthropic" label="Anthropic"/><el-option value="manual" label="待归类（请选择官方厂商）" disabled/></el-select></el-form-item><el-form-item label="官方模型标识"><el-input v-model="form.official_model_id" placeholder="例如 gpt-5.5"/></el-form-item>
    <el-form-item label="定价方式"><el-radio-group v-model="form.official_pricing_mode"><el-radio value="auto">自动同步</el-radio><el-radio value="manual">管理员手动录入</el-radio></el-radio-group></el-form-item>
    <template v-if="form.official_pricing_mode==='manual'">
      <el-form-item label="价格币种"><el-radio-group v-model="form.official_currency"><el-radio value="USD">美元 USD</el-radio><el-radio value="CNY">人民币 CNY</el-radio></el-radio-group></el-form-item>
      <el-form-item label="输入价 / 1M"><el-input-number v-model="form.official_input_price" :min="0" :precision="6" :step="0.1"/></el-form-item>
      <el-form-item label="缓存输入价 / 1M"><el-input-number v-model="form.official_cached_input_price" :min="0" :precision="6" :step="0.1"/></el-form-item>
      <el-form-item label="输出价 / 1M"><el-input-number v-model="form.official_output_price" :min="0" :precision="6" :step="0.1"/></el-form-item>
      <el-divider content-position="left">图片生成单价 / 张</el-divider>
      <el-form-item label="方图 1024×1024"><el-input-number v-model="form.official_image_price_square" :min="0" :precision="6" :step="0.01"/></el-form-item>
      <el-form-item label="横图 1536×1024"><el-input-number v-model="form.official_image_price_landscape" :min="0" :precision="6" :step="0.01"/></el-form-item>
      <el-form-item label="竖图 1024×1536"><el-input-number v-model="form.official_image_price_portrait" :min="0" :precision="6" :step="0.01"/></el-form-item>
      <el-alert title="手动价格会被锁定，定时同步和手动同步官方价格都不会覆盖。" type="warning" :closable="false"/>
    </template>
    <el-form-item label="类型"><el-select v-model="form.model_type"><el-option value="llm" label="LLM 对话"/><el-option value="embedding" label="Embedding"/><el-option value="image" label="图像"/><el-option value="audio" label="音频"/><el-option value="video" label="视频"/></el-select></el-form-item><el-form-item label="上下文长度"><el-input-number v-model="form.context_length" :min="0" :step="1024"/></el-form-item><el-form-item label="目录图片能力"><div><el-switch v-model="form.is_multimodal"/><div class="form-help">作为新渠道映射的默认值；实际图片请求还要求对应渠道模型映射已开启“图片输入”。</div></div></el-form-item>
    <el-form-item label="用户扣费倍率(入)"><el-input-number v-model="form.multiplier_input" :min="0.0001" :step="0.1"/></el-form-item><el-form-item label="用户扣费倍率(出)"><el-input-number v-model="form.multiplier_output" :min="0.0001" :step="0.1"/></el-form-item><el-form-item label="用户扣费倍率(图)"><el-input-number v-model="form.multiplier_image" :min="0.0001" :step="0.1"/></el-form-item>
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

const emptyForm=()=>({model_code:'',model_name:'',upstream_model_name:'',model_type:'llm',context_length:4096,is_multimodal:false,multiplier_input:1,multiplier_output:1,multiplier_image:1,official_provider:activeProvider.value,official_model_id:'',official_pricing_mode:'auto',official_currency:activeProvider.value==='deepseek'?'CNY':'USD',official_input_price:0,official_cached_input_price:0,official_output_price:0,official_image_price_square:0,official_image_price_landscape:0,official_image_price_portrait:0,status:'active',sort_order:0})
const form=ref(emptyForm())
onMounted(fetchModels)
const asMultimodal=value=>value===true||Number(value)===1
async function fetchModels(){loading.value=true;try{models.value=((await api.get('/api/admin/models')).data.data||[]).map(model=>({...model,is_multimodal:asMultimodal(model.is_multimodal)}))}catch(e){}loading.value=false}
function imagePrices(value){try{return typeof value==='string'?JSON.parse(value||'{}'):(value||{})}catch(e){return {}}}
function openDialog(row){isEdit.value=!!row;if(!row){form.value=emptyForm()}else{const prices=imagePrices(row.official_image_prices);form.value={...row,is_multimodal:asMultimodal(row.is_multimodal),official_pricing_mode:row.official_pricing_mode||'auto',multiplier_input:row.billing_multiplier_input,multiplier_output:row.billing_multiplier_output,multiplier_image:row.billing_multiplier_image||1,official_image_price_square:prices['1024x1024']??prices.default??0,official_image_price_landscape:prices['1536x1024']??prices.default??0,official_image_price_portrait:prices['1024x1536']??prices.default??0}}dialogVisible.value=true}
async function save(){saving.value=true;try{if(isEdit.value)await api.put(`/api/admin/models/${form.value.id}`,form.value);else await api.post('/api/admin/models',form.value);ElMessage.success('保存成功');dialogVisible.value=false;fetchModels()}catch(e){}saving.value=false}
async function toggleStatus(row){const status=row.status==='active'?'inactive':'active';await api.patch(`/api/admin/models/${row.id}/status`,{status});ElMessage.success('状态已更新');fetchModels()}
async function syncPricing(){syncing.value=true;try{const r=await api.post('/api/admin/pricing-sync');ElMessage.success(`同步完成：更新 ${r.data.official_pricing.updated} 个模型，USD/CNY=${r.data.exchange_rate.rate}`);fetchModels()}catch(e){}syncing.value=false}
function currency(value){return value==='USD'?'$':'¥'}
function typeLabel(value){return types.find(item=>item.value===value)?.label||value}
</script>

<style scoped>
.models-page{padding-bottom:24px}.page-hint,.form-help{font-size:12px;color:#94a3b8;margin-top:4px}.provider-tabs :deep(.el-tabs__item){display:flex;gap:8px;align-items:center}.type-filter{display:flex;justify-content:space-between;align-items:center;margin:4px 0 16px}.table-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}.inactive-models{border-top:1px solid #e5e7eb}.inactive-models :deep(.el-collapse-item__header){padding:0 18px;font-size:13px;font-weight:600;color:#64748b}.inactive-models :deep(.el-collapse-item__content){padding:0}.collapse-hint{margin-left:auto;margin-right:10px;font-size:12px;font-weight:400;color:#94a3b8}.model-name{font-weight:600;color:#0f172a}.model-code{font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace}.price-pair,.multiplier{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.price-pair span,.multiplier span{white-space:nowrap}.pending{color:#e6a23c}.mobile-model-list,.mobile-inactive-models{display:none}
@media(max-width:768px){.provider-tabs :deep(.el-tabs__nav-scroll){overflow-x:auto}.provider-tabs :deep(.el-tabs__nav){float:none}.type-filter{overflow-x:auto;margin-bottom:12px}.desktop-model-table,.desktop-inactive-models{display:none}.mobile-model-list{display:grid;gap:10px;padding:10px}.mobile-model-card{border:1px solid #e5e7eb;border-radius:12px;padding:13px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.03)}.mobile-model-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.mobile-model-head>div{min-width:0}.mobile-model-head .model-code{max-width:245px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-model-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;padding:12px 0}.mobile-model-meta>div,.mobile-model-price{display:flex;flex-direction:column;gap:3px;min-width:0}.mobile-model-meta small,.mobile-model-price small{font-size:11px;color:#94a3b8}.mobile-model-meta span{font-size:13px;color:#334155}.mobile-model-price{border-top:1px solid #f1f5f9;padding-top:10px}.mobile-model-price>div{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12px;color:#475569}.mobile-model-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}.mobile-model-actions .el-button{width:100%;min-height:44px;margin:0}.mobile-inactive-models{display:block}.mobile-inactive-list{padding-top:0}.inactive-models :deep(.el-collapse-item__header){padding:0 12px}.collapse-hint{display:block}.model-code{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
</style>
