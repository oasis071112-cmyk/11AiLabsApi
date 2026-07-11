<template>
<div class="dashboard">
  <!-- KPI 卡片行 -->
  <el-row :gutter="16" class="kpi-row">
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#0EA5E9"><Coins :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">额度点数</div><div class="kpi-value">{{ wallet.quota_balance?.toFixed(2) }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#f59e0b"><Gift :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">赠送点数</div><div class="kpi-value">{{ wallet.gift_quota?.toFixed(2) }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#a3a3a3"><Lock :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">冻结点数</div><div class="kpi-value">{{ wallet.frozen_balance?.toFixed(2) }} 点</div></div></div></el-col>
    <el-col :span="6"><div class="kpi-card"><div class="kpi-icon" style="background:#000"><Wallet :size="20" color="#fff"/></div><div class="kpi-body"><div class="kpi-label">可用额度</div><div class="kpi-value">{{ availableBalance }} 点</div></div></div></el-col>
  </el-row>

  <!-- 操作栏 -->
  <div class="filter-bar" style="margin-bottom:20px">
    <span style="font-weight:600;font-size:15px">余额明细</span>
    <el-button type="primary" @click="rechargeDialog=true" style="margin-left:auto"><ShoppingCart :size="14" style="margin-right:4px"/> 购买额度包</el-button>
  </div>

  <!-- Tabs + 表格 -->
  <div class="chart-card">
    <el-tabs v-model="activeTab" class="wallet-tabs">
      <el-tab-pane label="流水记录" name="tx">
        <el-table :data="transactions" v-loading="ltx">
          <el-table-column prop="created_at" label="时间" width="180"/>
          <el-table-column label="类型" width="100"><template #default="{row}"><el-tag :type="typeColor(row.transaction_type)" size="small">{{ typeLabel(row.transaction_type) }}</el-tag></template></el-table-column>
          <el-table-column label="来源" width="80"><template #default="{row}">{{ row.balance_type==='quota'||row.balance_type==='recharge'?'额度':'赠送' }}</template></el-table-column>
          <el-table-column label="点数" width="130" align="right"><template #default="{row}"><span :class="row.amount>0?'text-success':'text-danger'" style="font-weight:600;font-size:14px">{{ row.amount>0?'+':'' }}{{ row.amount?.toFixed(2) }}</span></template></el-table-column>
          <el-table-column prop="before_balance" label="变动前" width="130" align="right"/>
          <el-table-column prop="after_balance" label="变动后" width="130" align="right"/>
          <el-table-column prop="remark" label="备注" show-overflow-tooltip/>
        </el-table>
        <el-pagination v-model:current-page="txPage" :page-size="20" :total="txTotal" layout="prev,pager,next" @current-change="fetchTx" style="justify-content:center;padding:16px 0 0" small/>
      </el-tab-pane>
      <el-tab-pane label="购买记录" name="orders">
        <el-table :data="orders" v-loading="lo">
          <el-table-column prop="order_no" label="订单号" width="200"/>
          <el-table-column label="点数" width="100" align="right"><template #default="{row}">{{ row.amount?.toFixed(0) }} 点</template></el-table-column>
          <el-table-column prop="payment_method" label="支付方式" width="100"><template #default="{row}">{{ payLabel(row.payment_method) }}</template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="osType(row.status)" size="small">{{ osLabel(row.status) }}</el-tag></template></el-table-column>
          <el-table-column prop="created_at" label="创建时间"/>
          <el-table-column prop="granted_at" label="发放时间" width="170"/>
        </el-table>
        <el-pagination v-model:current-page="oPage" :page-size="20" :total="oTotal" layout="prev,pager,next" @current-change="fetchOrders" style="justify-content:center;padding:16px 0 0" small/>
      </el-tab-pane>
    </el-tabs>
  </div>

  <!-- 购买弹窗 -->
  <el-dialog v-model="rechargeDialog" width="480px"><template #header><span style="font-weight:700;font-size:16px"><ShoppingCart :size="18" style="margin-right:6px;vertical-align:middle"/> 购买额度包</span></template>
    <el-form :model="rf" label-width="100px">
      <el-form-item label="购买点数"><el-input-number v-model="rf.amount" :min="1" :max="99999" :step="10" style="width:100%"/></el-form-item>
      <el-form-item label="支付方式"><el-radio-group v-model="rf.payment_method"><el-radio value="alipay">支付宝</el-radio><el-radio value="wechat">微信支付</el-radio><el-radio value="usdt">USDT</el-radio><el-radio value="manual_transfer">手动转账</el-radio></el-radio-group></el-form-item>
      <el-alert title="额度包点数1:1兑换，不可转让，不可提现，不可兑换现金，不支持二次流通" type="info" show-icon :closable="false"/>
    </el-form>
    <template #footer><el-button @click="rechargeDialog=false">取消</el-button><el-button type="primary" :loading="recharging" @click="submitRecharge">提交购买订单</el-button></template>
  </el-dialog>
</div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
import { Wallet, ShoppingCart, Coins, Gift, Lock } from '@lucide/vue'
const wallet=ref({quota_balance:0,gift_quota:0,frozen_balance:0})
const availableBalance=computed(()=>((wallet.value.quota_balance||0)+(wallet.value.gift_quota||0)-(wallet.value.frozen_balance||0)).toFixed(2))
const activeTab=ref('tx'),transactions=ref([]),orders=ref([]),ltx=ref(false),lo=ref(false)
const txPage=ref(1),txTotal=ref(0),oPage=ref(1),oTotal=ref(0)
const rechargeDialog=ref(false),recharging=ref(false),rf=ref({amount:10,payment_method:'alipay'})
onMounted(async()=>{try{const r=await api.get('/api/user/wallet');wallet.value={quota_balance:r.data.quota_balance||r.data.recharge_balance||0,gift_quota:r.data.gift_quota||r.data.gift_balance||0,frozen_balance:r.data.frozen_balance||0}}catch(e){};fetchTx();fetchOrders()})
async function fetchTx(){ltx.value=true;try{const r=await api.get('/api/user/transactions',{params:{page:txPage.value}});transactions.value=r.data.data;txTotal.value=r.data.pagination.total}catch(e){}ltx.value=false}
async function fetchOrders(){lo.value=true;try{const r=await api.get('/api/user/recharge-orders',{params:{page:oPage.value}});orders.value=r.data.data;oTotal.value=r.data.pagination.total}catch(e){}lo.value=false}
async function submitRecharge(){recharging.value=true;try{await api.post('/api/user/recharge',rf.value);ElMessage.success('购买订单已创建');rechargeDialog.value=false;fetchOrders()}catch(e){}recharging.value=false}
function typeColor(t){const m={recharge:'',purchase:'',gift:'warning',consume:'danger',manual_add:'',manual_deduct:'danger',refund:'info'};return m[t]||'info'}
function typeLabel(t){const m={recharge:'购买',purchase:'购买',gift:'赠送',consume:'消耗',manual_add:'增加',manual_deduct:'扣减',refund:'退回',freeze:'冻结',unfreeze:'解冻'};return m[t]||t}
function osType(s){const m={pending:'warning',paid:'primary',granted:'success',credited:'success',cancelled:'info',abnormal:'danger'};return m[s]||'info'}
function osLabel(s){const m={pending:'待支付',paid:'已支付',granted:'已发放',credited:'已发放',cancelled:'已取消',abnormal:'异常'};return m[s]||s}
function payLabel(m){const map={alipay:'支付宝',wechat:'微信支付',usdt:'USDT',manual_transfer:'手动转账'};return map[m]||m}
</script>

<style scoped>
.dashboard{padding:28px 32px}
.kpi-row{margin-bottom:16px}
.kpi-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:box-shadow .2s}
.kpi-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.05)}
.kpi-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.kpi-body{flex:1;min-width:0}
.kpi-label{font-size:12px;color:#525252;margin-bottom:4px;font-weight:500;text-transform:uppercase}
.kpi-value{font-size:24px;font-weight:700;color:#000;white-space:nowrap}
.filter-bar{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px 20px;display:flex;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
.chart-card{background:rgba(255,255,255,0.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(232,235,229,0.7);border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.04)}
.wallet-tabs :deep(.el-tabs__header){margin:0;padding:0 18px;border-bottom:1px solid rgba(0,0,0,0.06)}
.wallet-tabs :deep(.el-tabs__content){padding:12px 18px 4px}
</style>
