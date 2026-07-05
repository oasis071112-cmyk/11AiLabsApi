<template>
<div class="flex-between mb-16"><h2 class="card-title">🎯 我的额度</h2><el-button type="primary" size="large" @click="rechargeDialog=true">🛒 购买额度包</el-button></div>
<el-row :gutter="16" style="margin-bottom:24px">
<el-col :span="6"><div class="stat-card"><div class="label">额度点数</div><div class="value">{{ wallet.quota_balance?.toFixed(4) }} 点</div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="label">赠送点数</div><div class="value">{{ wallet.gift_quota?.toFixed(4) }} 点</div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="label">冻结点数</div><div class="value">{{ wallet.frozen_balance?.toFixed(4) }} 点</div></div></el-col>
<el-col :span="6"><div class="stat-card"><div class="label">可用额度</div><div class="value">{{ availableBalance }} 点</div></div></el-col>
</el-row>
<el-tabs v-model="activeTab">
<el-tab-pane label="流水记录" name="tx">
<el-table :data="transactions" stripe v-loading="ltx" size="small"><el-table-column prop="created_at" label="时间" width="180"/><el-table-column label="类型" width="120"><template #default="{row}"><el-tag :type="typeColor(row.transaction_type)" size="small">{{ typeLabel(row.transaction_type) }}</el-tag></template></el-table-column><el-table-column label="点数类型" width="100"><template #default="{row}">{{ row.balance_type==='quota'||row.balance_type==='recharge'?'额度点数':'赠送点数' }}</template></el-table-column><el-table-column label="点数" width="120"><template #default="{row}"><span :class="row.amount>0?'text-success':'text-danger'">{{ row.amount>0?'+':'' }}{{ row.amount?.toFixed(4) }}</span></template></el-table-column><el-table-column prop="before_balance" label="变动前" width="120"/><el-table-column prop="after_balance" label="变动后" width="120"/><el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip/></el-table>
<el-pagination v-model:current-page="txPage" :page-size="20" :total="txTotal" layout="prev,pager,next" @current-change="fetchTx" style="margin-top:16px;justify-content:center"/>
</el-tab-pane>
<el-tab-pane label="购买记录" name="orders">
<el-table :data="orders" stripe v-loading="lo" size="small"><el-table-column prop="order_no" label="订单号" width="220"/><el-table-column label="点数" width="120"><template #default="{row}">{{ row.amount?.toFixed(0) }} 点</template></el-table-column><el-table-column prop="payment_method" label="支付方式" width="120"><template #default="{row}">{{ payLabel(row.payment_method) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="osType(row.status)" size="small">{{ osLabel(row.status) }}</el-tag></template></el-table-column><el-table-column prop="created_at" label="创建时间" width="180"/><el-table-column prop="credited_at" label="发放时间" width="180"><template #default="{row}">{{ row.credited_at || row.granted_at }}</template></el-table-column></el-table>
<el-pagination v-model:current-page="oPage" :page-size="20" :total="oTotal" layout="prev,pager,next" @current-change="fetchOrders" style="margin-top:16px;justify-content:center"/>
</el-tab-pane>
</el-tabs>

<el-dialog v-model="rechargeDialog" title="🛒 购买额度包" width="480px">
<el-form :model="rf" label-width="100px"><el-form-item label="购买点数"><el-input-number v-model="rf.amount" :min="1" :max="99999" :step="10" style="width:100%"/></el-form-item><el-form-item label="支付方式"><el-radio-group v-model="rf.payment_method"><el-radio value="alipay">支付宝</el-radio><el-radio value="wechat">微信支付</el-radio><el-radio value="usdt">USDT</el-radio><el-radio value="manual_transfer">手动转账</el-radio></el-radio-group></el-form-item><el-alert title="额度包点数1:1兑换，不可转让，不可提现，不可兑换现金，不支持二次流通" type="info" show-icon :closable="false" style="margin-top:12px"/></el-form>
<template #footer><el-button @click="rechargeDialog=false">取消</el-button><el-button type="primary" :loading="recharging" @click="submitRecharge">提交购买订单</el-button></template>
</el-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const wallet=ref({quota_balance:0,gift_quota:0,frozen_balance:0})
const availableBalance=computed(()=>((wallet.value.quota_balance||0)+(wallet.value.gift_quota||0)-(wallet.value.frozen_balance||0)).toFixed(4))
const activeTab=ref('tx'),transactions=ref([]),orders=ref([]),ltx=ref(false),lo=ref(false)
const txPage=ref(1),txTotal=ref(0),oPage=ref(1),oTotal=ref(0)
const rechargeDialog=ref(false),recharging=ref(false),rf=ref({amount:10,payment_method:'alipay'})
onMounted(async()=>{try{const r=await api.get('/api/user/wallet');wallet.value={quota_balance:r.data.quota_balance||r.data.recharge_balance||0,gift_quota:r.data.gift_quota||r.data.gift_balance||0,frozen_balance:r.data.frozen_balance||0}}catch(e){};fetchTx();fetchOrders()})
async function fetchTx(){ltx.value=true;try{const r=await api.get('/api/user/transactions',{params:{page:txPage.value}});transactions.value=r.data.data;txTotal.value=r.data.pagination.total}catch(e){}ltx.value=false}
async function fetchOrders(){lo.value=true;try{const r=await api.get('/api/user/recharge-orders',{params:{page:oPage.value}});orders.value=r.data.data;oTotal.value=r.data.pagination.total}catch(e){}lo.value=false}
async function submitRecharge(){recharging.value=true;try{await api.post('/api/user/recharge',rf.value);ElMessage.success('购买订单已创建,请联系管理员确认发放');rechargeDialog.value=false;fetchOrders()}catch(e){}recharging.value=false}
function typeColor(t){const m={recharge:'success',purchase:'success',gift:'warning',consume:'danger',manual_add:'success',manual_deduct:'danger',refund:'info'};return m[t]||'info'}
function typeLabel(t){const m={recharge:'额度购买',purchase:'额度购买',gift:'赠送',consume:'消耗',manual_add:'手动增加',manual_deduct:'手动扣减',refund:'退回',freeze:'冻结',unfreeze:'解冻'};return m[t]||t}
function osType(s){const m={pending:'warning',paid:'primary',granted:'success',credited:'success',cancelled:'info',abnormal:'danger'};return m[s]||'info'}
function osLabel(s){const m={pending:'待支付',paid:'已支付',granted:'已发放',credited:'已发放',cancelled:'已取消',abnormal:'异常'};return m[s]||s}
function payLabel(m){const map={alipay:'支付宝',wechat:'微信支付',usdt:'USDT',manual_transfer:'手动转账'};return map[m]||m}
</script>