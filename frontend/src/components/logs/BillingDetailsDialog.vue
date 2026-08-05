<template>
  <el-dialog v-model="visible" title="计费明细" width="680px" top="8vh" class="billing-dialog-modal user-theme-dialog">
    <div v-if="selectedBilling" class="billing-dialog">
      <div class="billing-summary">
        <div><span>模型</span><strong>{{ selectedBilling.model_code }}</strong></div>
        <div v-if="selectedBilling.image_operation"><span>图片操作</span><strong>{{ imageOperationLabel(selectedBilling.image_operation) }}</strong></div>
        <div><span>请求时间</span><strong>{{ formatBeijingTime(selectedBilling.created_at) }}</strong></div>
        <div class="billing-total"><span>本次实际扣费</span><strong>{{ point(selectedBilling.total_cost) }} 点</strong></div>
      </div>
      <el-alert v-if="!hasBillingDetail(selectedBilling)" title="这条记录暂时没有可展示的计费数据" type="warning" :closable="false"/>
      <template v-else>
        <el-alert v-if="selectedBilling.billing_detail.mode==='legacy_zero'" title="本次历史调用实际扣费为 0 点，不会按当前价格追溯补扣" type="warning" :closable="false" show-icon class="legacy-alert"/>
        <div class="snapshot-title">{{ billingTitle }}</div>
        <div class="snapshot-grid">
          <div><span>计费版本</span><strong>{{ billingVersion }}</strong></div>
          <div><span>计费币种</span><strong>{{ selectedBilling.billing_detail.currency||'点数' }}</strong></div>
          <div><span>计费单位</span><strong>{{ billingUnitLabel }}</strong></div>
          <div><span>{{ selectedBilling.billing_mode==='image'?'图片倍率':'计费倍率' }}</span><strong>×{{ billingMultiplier }}</strong></div>
          <div v-if="billingFxRate!==1"><span>美元兑人民币</span><strong>×{{ billingFxRate }}</strong></div>
        </div>
        <div class="breakdown-title">逐项计算</div>
        <div class="breakdown-list">
          <div v-for="item in billingBreakdown" :key="item.label" class="breakdown-item">
            <div class="breakdown-head"><span>{{ item.label }}</span><strong>{{ point(item.amount) }} 点</strong></div>
            <code>{{ item.formula }}</code>
          </div>
        </div>
        <div class="billing-result"><span>各项费用相加</span><strong>{{ billingSum }} 点</strong><span class="equals">调用记录实际扣除 {{ point(selectedBilling.total_cost) }} 点</span></div>
        <div class="billing-note">{{ selectedBilling.billing_detail.notice || '本次计算使用调用时保存的计费快照。' }} 1 点 = ¥1。</div>
      </template>
    </div>
    <template #footer><el-button type="primary" @click="visible=false">知道了</el-button></template>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue'
import { formatBeijingTime } from '@/utils/time'

const visible=defineModel({type:Boolean,default:false})
const props=defineProps({billing:{type:Object,default:null}})
const selectedBilling=computed(()=>props.billing)
const billingPrimaryDimension=computed(()=>selectedBilling.value?.billing_detail?.dimensions?.find(item=>!item.isAdjustment)||{})
const billingUnitLabel=computed(()=>selectedBilling.value?.billing_mode==='image'?'1 张':selectedBilling.value?.billing_mode==='per_request'?'1 次':`${formatTokenUnit(billingPrimaryDimension.value.unitTokens||1000000)} Token`)
const billingMultiplier=computed(()=>billingPrimaryDimension.value.multiplier??1)
const billingFxRate=computed(()=>Number(billingPrimaryDimension.value.fxRate||1))
const billingBreakdown=computed(()=>{
  const row=selectedBilling.value
  if(!hasBillingDetail(row))return []
  const currency=row.billing_detail.currency
  const symbol=currency==='USD'?'$':currency==='CNY'?'¥':''
  return row.billing_detail.dimensions.map(item=>{
    if(item.isAdjustment)return {...item,formula:'用于对齐钱包最终保存的实际扣费金额'}
    if(row.billing_detail.mode==='image_snapshot'){
      const itemSymbol=item.currency==='USD'?'$':item.currency==='CNY'?'¥':''
      const fx=item.currency==='USD'?` × 汇率 ${item.fxRate}`:''
      return {...item,formula:`${number(item.usage)} 张 × ${itemSymbol}${decimal(item.unitPrice,4)}/张 × 倍率 ${item.multiplier}${fx}（${item.size||'默认尺寸'}）`}
    }
    if(row.billing_detail.mode==='fixed_snapshot'){
      const fx=currency==='USD'?` × 汇率 ${item.fxRate}`:''
      return {...item,formula:`1 次 × ${symbol}${item.unitPrice}/次 × 倍率 ${item.multiplier}${fx}`}
    }
    const multiplierLabel=item.label.includes('输出')?'输出倍率':'输入倍率'
    const fx=currency==='USD'?` × 汇率 ${item.fxRate}`:''
    return {...item,formula:`${number(item.usage)} ÷ ${formatTokenUnit(item.unitTokens)} × ${symbol}${item.unitPrice} × ${multiplierLabel} ${item.multiplier}${fx}`}
  })
})
const billingSum=computed(()=>point(selectedBilling.value?.billing_detail?.calculatedTotal??selectedBilling.value?.total_cost??0))
const billingTitle=computed(()=>({snapshot:'本次调用采用的价格快照',image_snapshot:'本次图片生成价格快照',fixed_snapshot:'本次固定请求价格快照',legacy_zero:'历史 0 扣费计算过程',legacy:'旧版计费计算过程'}[selectedBilling.value?.billing_detail?.mode]||'计费计算过程'))
const billingVersion=computed(()=>({snapshot:'调用时官方价格',image_snapshot:'按实际图片结果计费',fixed_snapshot:'按每请求固定价计费',legacy_zero:'历史实际 0 扣费',legacy:'旧版价格'}[selectedBilling.value?.billing_detail?.mode]||'未知'))

function imageOperationLabel(operation){return ({generation:'生成',edit:'编辑',variation:'变体',transformation:'变换'})[operation]||operation}
function hasBillingDetail(row){return Array.isArray(row?.billing_detail?.dimensions)}
function number(value){return Number(value||0).toLocaleString()}
function formatTokenUnit(value){return Number(value)===1000000?'1M':number(value)}
function point(value){return Number(value||0).toFixed(6)}
function decimal(value,digits=2){const parsed=Number(value);return Number.isFinite(parsed)?parsed.toFixed(digits):(0).toFixed(digits)}
</script>

<style scoped>
.billing-summary{display:grid;grid-template-columns:1fr 1.3fr 1fr;gap:10px;margin-bottom:18px}.billing-summary>div,.snapshot-grid>div{background:#f8fafc;border-radius:9px;padding:11px 12px}.billing-summary span,.snapshot-grid span{display:block;font-size:11px;color:#94a3b8;margin-bottom:4px}.billing-summary strong,.snapshot-grid strong{color:#0f172a;font-size:13px}.billing-total{background:#eff6ff!important}.billing-total strong{color:#2563eb!important;font-size:16px!important}.snapshot-title,.breakdown-title{font-size:13px;font-weight:650;color:#334155;margin:16px 0 9px}.snapshot-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.breakdown-list{display:grid;gap:9px}.breakdown-item{border:1px solid #e2e8f0;border-radius:9px;padding:11px 13px}.breakdown-head{display:flex;justify-content:space-between;margin-bottom:7px;color:#334155}.breakdown-head strong{color:#2563eb}.breakdown-item code{display:block;background:#f8fafc;color:#475569;padding:8px;border-radius:6px;font-size:12px;white-space:normal;line-height:1.6}.billing-result{display:flex;align-items:center;gap:12px;background:#0f172a;color:#fff;border-radius:9px;padding:13px 15px;margin-top:12px}.billing-result strong{font-size:17px;color:#93c5fd}.billing-result .equals{margin-left:auto;color:#cbd5e1;font-size:12px}.billing-note{font-size:11px;color:#94a3b8;margin-top:9px}
@media(max-width:768px){:deep(.billing-dialog-modal){width:calc(100% - 16px)!important;margin-top:8px!important}.billing-dialog-modal :deep(.el-dialog__body){padding:12px;overflow:hidden}.billing-summary{grid-template-columns:1fr}.snapshot-grid{grid-template-columns:1fr 1fr}.billing-result{align-items:flex-start;flex-direction:column;gap:4px}.billing-result .equals{margin-left:0}.breakdown-item code{overflow-wrap:anywhere}}
</style>
