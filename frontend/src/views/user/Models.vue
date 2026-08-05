<template>
<div class="models-page">
  <div class="page-title">
    <div>
      <h2>模型与价格</h2>
      <p>按已创建 API Key 的路由分组展示可用模型和分组倍率，实际扣费以调用记录为准</p>
    </div>
    <div class="model-total">共 {{ modelCount }} 个分组模型</div>
  </div>

  <div v-loading="loading" class="group-list">
    <section v-for="group in groups" :key="group.id" class="group-card">
      <div class="group-head">
        <div>
          <h3>{{ group.group_name }}</h3>
          <p>{{ group.description || '该 API Key 路由分组可用的模型' }}</p>
        </div>
        <div class="group-rates">
          <span>输入 <strong>{{ multiplierLabel(group.billing_multiplier_input) }}</strong></span>
          <span>输出 <strong>{{ multiplierLabel(group.billing_multiplier_output) }}</strong></span>
          <span>生图 <strong>{{ multiplierLabel(group.billing_multiplier_image) }}</strong></span>
        </div>
      </div>

      <div class="model-grid">
        <article v-for="model in group.models" :key="model.model_code" class="model-card">
          <div class="model-head">
            <div><h4>{{ model.model_name }}</h4><code>{{ model.model_code }}</code></div>
            <el-tag size="small" effect="plain">{{ modelTypeLabel(model.model_type) }}</el-tag>
          </div>
          <div class="model-facts">
            <span><small>上下文</small>{{ contextLabel(model.context_length) }}</span>
            <span><small>图片输入</small>{{ model.supports_image_input ? '可用' : '不可用' }}</span>
          </div>
          <div v-if="model.model_type==='image'" class="price-box">
            <div class="price-title">默认图片价格 <span>/ 单张（2K）</span></div>
            <div class="price-row"><span>默认</span><strong>{{ price(model.default_image_unit_price, model.default_image_currency) }}</strong></div>
          </div>
          <div v-else class="price-box">
            <div class="price-title">官方价格 <span>/ 每 1M Token</span></div>
            <div class="price-row"><span>输入</span><strong>{{ price(model.official_input_price, model.official_currency) }}</strong></div>
            <div class="price-row"><span>输出</span><strong>{{ price(model.official_output_price, model.official_currency) }}</strong></div>
          </div>
        </article>
      </div>
      <el-empty v-if="!group.models.length" description="该路由分组暂无可用模型" :image-size="54"/>
    </section>

    <el-empty
      v-if="!loading&&!hasApiKeys"
      description="尚未创建路由分组 API Key，当前没有可用模型"
      :image-size="72"
    >
      <el-button type="primary" @click="router.push('/keys')">创建 API Key</el-button>
    </el-empty>
    <el-empty
      v-else-if="!loading&&!groups.length"
      description="当前 API Key 绑定的路由分组暂无可用模型"
      :image-size="72"
    />
  </div>

  <div v-if="groups.length" class="billing-note">
    扣费优先级：单独用户倍率 → 路由分组倍率 → 全局倍率 → 1× 兜底。分组倍率留空时自动沿用全局倍率。
  </div>
</div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import { ElMessage } from 'element-plus'
import { coldStartKeys, takeColdStartRequest } from '@/utils/cold-start-prefetch'

const router=useRouter()
const groups=ref([]),loading=ref(false),hasApiKeys=ref(false)
const modelCount=computed(()=>groups.value.reduce((total,group)=>total+(group.models?.length||0),0))

onMounted(async()=>{
  loading.value=true
  try{
    const response=(await takeColdStartRequest(coldStartKeys.models,()=>api.get('/api/user/models'))).data
    groups.value=response.groups||[]
    hasApiKeys.value=Boolean(response.has_api_keys)
  }catch(e){ElMessage.error(e.response?.data?.error||'模型与价格加载失败，请重试')}finally{
    loading.value=false
  }
})

function multiplierLabel(value){return value===null||value===undefined||value===''?'沿用全局':`×${Number(value).toFixed(2)}`}
function modelTypeLabel(modelType){return modelType==='image'?'生图':'LLM'}
function contextLabel(value){if(!value)return '—';return value>=1e6?`${(value/1e6).toFixed(1)}M`:value>=1000?`${Math.round(value/1000)}K`:value}
function price(value,currency){if(!Number(value))return '待同步';return `${currency==='USD'?'$':'¥'}${Number(value).toFixed(4)}`}
</script>

<style scoped>
.models-page{padding:28px 32px;max-width:1400px;margin:0 auto}.page-title{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:22px}.page-title h2{margin:0;color:#0f172a;font-size:24px}.page-title p{margin:7px 0 0;color:#64748b;font-size:13px}.model-total{font-size:13px;color:#64748b}.group-list{min-height:180px}.group-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:18px;overflow:hidden}.group-head{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.group-head h3{margin:0;color:#0f172a;font-size:18px}.group-head p{margin:5px 0 0;color:#64748b;font-size:12px}.group-rates{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.group-rates span{display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #dbeafe;border-radius:999px;padding:6px 10px;color:#64748b;font-size:12px}.group-rates strong{color:#1d4ed8}.model-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px;padding:16px}.model-card{border:1px solid #e2e8f0;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(15,23,42,.03)}.model-head{display:flex;justify-content:space-between;gap:12px}.model-head h4{margin:0 0 5px;font-size:15px;color:#0f172a}.model-head code{font-size:12px;color:#64748b}.model-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.model-facts span{background:#f8fafc;border-radius:8px;padding:8px 10px;font-weight:600;color:#334155}.model-facts small{display:block;font-weight:400;color:#94a3b8;margin-bottom:3px}.price-box{border-top:1px solid #f1f5f9;padding-top:12px}.price-title{font-size:12px;color:#64748b;margin-bottom:6px}.price-title span{color:#94a3b8}.price-row{display:grid;grid-template-columns:45px 1fr;align-items:center;padding:4px 0}.price-row span{color:#64748b;font-size:13px}.price-row strong{color:#0f172a;font-size:14px}.billing-note{font-size:12px;color:#64748b;background:#eff6ff;border:1px solid #dbeafe;border-radius:10px;padding:12px 14px}
@media(max-width:768px){.models-page{padding:16px 12px}.page-title{align-items:flex-start;gap:10px;margin-bottom:14px}.page-title h2{font-size:20px}.page-title p{line-height:1.5;font-size:12px}.model-total{white-space:nowrap;padding-top:4px}.group-head{align-items:flex-start;flex-direction:column;padding:14px;gap:12px}.group-rates{justify-content:flex-start}.model-grid{grid-template-columns:1fr;padding:10px;gap:8px}.model-card{padding:12px}.model-facts{margin:10px 0}.billing-note{line-height:1.6}}
</style>
