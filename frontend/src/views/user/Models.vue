<template>
<div class="models-page">
  <div class="page-title"><div><h2>模型与价格</h2><p>查看官方价格和当前用户扣费倍率，实际费用以调用记录为准</p></div><div class="model-total">共 {{ models.length }} 个模型</div></div>
  <div class="provider-switch">
    <button v-for="provider in providerTabs" :key="provider.value" :class="['provider-button',{active:activeProvider===provider.value}]" @click="selectProvider(provider.value)"><span>{{ provider.label }}</span><b>{{ provider.count }}</b></button>
  </div>
  <div class="type-switch"><button v-for="type in typeTabs" :key="type.value" :class="{active:activeType===type.value}" @click="activeType=type.value">{{ type.label }} <span>{{ type.count }}</span></button></div>

  <div class="model-grid" v-loading="loading">
    <article v-for="model in filteredModels" :key="model.model_code" class="model-card">
      <div class="model-head"><div><h3>{{ model.model_name }}</h3><code>{{ model.model_code }}</code></div><el-tag size="small" effect="plain">{{ typeLabel(model.model_type) }}</el-tag></div>
      <div class="model-facts"><span><small>上下文</small>{{ contextLabel(model.context_length) }}</span><span><small>图片输入</small>{{ model.supports_image_input?'当前可用':'暂不可用' }}</span></div>
      <div class="price-box"><div class="price-title">官方价格 <span>/ 每 1M Token</span></div><div class="price-row"><span>输入</span><strong>{{ price(model.official_input_price,model.official_currency) }}</strong><em>×{{ model.billing_multiplier_input }}</em></div><div class="price-row"><span>输出</span><strong>{{ price(model.official_output_price,model.official_currency) }}</strong><em>×{{ model.billing_multiplier_output }}</em></div></div>
      <div class="cost-note">用户扣费 = 官方价格 × 当前倍率{{ model.official_currency==='USD'?' × 调用时汇率':'' }}</div>
    </article>
  </div>
  <el-empty v-if="!loading&&!filteredModels.length" description="该分类暂无模型"/>
</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '@/api'

const models=ref([]),loading=ref(false),activeProvider=ref('openai'),activeType=ref('all')
const providers=[{value:'openai',label:'OpenAI'},{value:'deepseek',label:'DeepSeek'},{value:'anthropic',label:'Anthropic'}]
const types=[{value:'all',label:'全部'},{value:'llm',label:'对话'},{value:'embedding',label:'嵌入'},{value:'image',label:'图像'},{value:'audio',label:'音频'},{value:'video',label:'视频'}]
const providerTabs=computed(()=>providers.map(item=>({...item,count:models.value.filter(model=>model.official_provider===item.value).length})))
const providerModels=computed(()=>models.value.filter(model=>model.official_provider===activeProvider.value))
const typeTabs=computed(()=>types.map(item=>({...item,count:item.value==='all'?providerModels.value.length:providerModels.value.filter(model=>model.model_type===item.value).length})).filter(item=>item.value==='all'||item.count))
const filteredModels=computed(()=>activeType.value==='all'?providerModels.value:providerModels.value.filter(model=>model.model_type===activeType.value))
onMounted(async()=>{loading.value=true;try{models.value=(await api.get('/api/user/models')).data.data||[]}catch(e){}loading.value=false})
function selectProvider(value){activeProvider.value=value;activeType.value='all'}
function typeLabel(value){return types.find(item=>item.value===value)?.label||value}
function contextLabel(value){if(!value)return '-';return value>=1e6?`${(value/1e6).toFixed(1)}M`:value>=1000?`${Math.round(value/1000)}K`:value}
function price(value,currency){if(!Number(value))return '待同步';return `${currency==='USD'?'$':'¥'}${Number(value).toFixed(4)}`}
</script>

<style scoped>
.models-page{padding:28px 32px;max-width:1400px;margin:0 auto}.page-title{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:22px}.page-title h2{margin:0;color:#0f172a;font-size:24px}.page-title p{margin:7px 0 0;color:#64748b;font-size:13px}.model-total{font-size:13px;color:#64748b}.provider-switch{display:flex;gap:10px;margin-bottom:14px}.provider-button{border:1px solid #e2e8f0;background:#fff;border-radius:10px;padding:11px 16px;display:flex;align-items:center;gap:18px;color:#475569;cursor:pointer}.provider-button b{background:#f1f5f9;border-radius:999px;padding:2px 8px;font-size:12px}.provider-button.active{border-color:#409eff;color:#1d4ed8;background:#eff6ff}.provider-button.active b{background:#dbeafe}.type-switch{display:flex;gap:7px;margin-bottom:18px}.type-switch button{border:0;background:#f1f5f9;color:#64748b;border-radius:999px;padding:7px 13px;cursor:pointer}.type-switch button.active{background:#0f172a;color:#fff}.type-switch span{opacity:.75;margin-left:3px}.model-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(315px,1fr));gap:16px;min-height:120px}.model-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(15,23,42,.04);transition:.2s}.model-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(15,23,42,.07)}.model-head{display:flex;justify-content:space-between;gap:12px}.model-head h3{margin:0 0 5px;font-size:16px;color:#0f172a}.model-head code{font-size:12px;color:#64748b}.model-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}.model-facts span{background:#f8fafc;border-radius:8px;padding:9px 11px;font-weight:600;color:#334155}.model-facts small{display:block;font-weight:400;color:#94a3b8;margin-bottom:3px}.price-box{border-top:1px solid #f1f5f9;padding-top:13px}.price-title{font-size:12px;color:#64748b;margin-bottom:8px}.price-title span{color:#94a3b8}.price-row{display:grid;grid-template-columns:45px 1fr auto;align-items:center;padding:5px 0}.price-row span{color:#64748b;font-size:13px}.price-row strong{color:#0f172a;font-size:14px}.price-row em{font-style:normal;color:#2563eb;background:#eff6ff;border-radius:6px;padding:2px 7px;font-size:12px}.cost-note{font-size:11px;color:#94a3b8;margin-top:12px}
@media(max-width:768px){
  .page-title{align-items:flex-start;gap:8px;margin-bottom:12px}
  .page-title h2{font-size:19px}
  .page-title p{line-height:1.4;font-size:12px}
  .model-total{white-space:nowrap;padding-top:4px;font-size:12px}
  .provider-switch,.type-switch{overflow-x:auto;scrollbar-width:none;padding-bottom:2px;margin-bottom:9px}
  .provider-switch::-webkit-scrollbar,.type-switch::-webkit-scrollbar{display:none}
  .provider-button{flex-shrink:0;padding:8px 11px;gap:10px;min-height:42px}
  .type-switch button{flex-shrink:0;min-height:40px}
  .model-grid{grid-template-columns:1fr;gap:0;border-radius:12px;overflow:hidden}
  .model-card{padding:12px 10px;border-radius:0;box-shadow:none}
  .model-card+ .model-card{margin-top:-1px}
  .model-card:hover{transform:none;box-shadow:none}
  .model-head h3{font-size:15px;margin-bottom:2px}
  .model-head code{display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .model-facts{margin:8px 0;gap:4px}
  .model-facts span{padding:5px 7px;border-radius:6px;font-size:12px}
  .model-facts small{display:inline;margin:0 5px 0 0}
  .price-box{padding-top:8px}
  .price-title{margin-bottom:3px}
  .price-row{grid-template-columns:38px minmax(0,1fr) auto;padding:3px 0}
  .cost-note{margin-top:7px}
}
</style>
