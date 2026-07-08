<template>
<div class="page-container" style="max-width:600px">
<h2 class="card-title"><ShoppingCart :size="22"/> 订阅额度包</h2>

<el-card>
  <el-form :model="form" label-width="100px">
    <el-form-item label="购买点数">
      <el-input-number v-model="form.amount" :min="1" :max="99999" :step="10" style="width:100%" size="large"/>
    </el-form-item>
    <el-form-item label="支付方式">
      <el-radio-group v-model="form.payment_method">
        <el-radio value="alipay" size="large">支付宝</el-radio>
        <el-radio value="wechat" size="large">微信支付</el-radio>
        <el-radio value="usdt" size="large">USDT</el-radio>
        <el-radio value="manual_transfer" size="large">手动转账</el-radio>
      </el-radio-group>
    </el-form-item>
    <el-divider/>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:#64748b">购买点数</span><span style="font-weight:700">{{ form.amount?.toFixed(0) }} 点</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:#64748b">兑换比例</span><span>1 : 1</span></div>
      <el-divider style="margin:12px 0"/>
      <div style="display:flex;justify-content:space-between"><span style="font-weight:600">实付金额</span><span style="font-weight:700;font-size:18px;color:#409eff">¥ {{ form.amount?.toFixed(0)||0 }}</span></div>
    </div>
    <el-alert title="额度包点数1:1兑换，不可转让，不可提现，不可兑换现金，不支持二次流通" type="info" show-icon :closable="false" style="margin-bottom:16px"/>
    <el-button type="primary" size="large" style="width:100%" :loading="submitting" @click="submit">提交购买订单</el-button>
  </el-form>
</el-card>

<!-- 购买记录 -->
<el-card style="margin-top:20px">
  <template #header><div style="display:flex;align-items:center;gap:8px"><ClipboardList :size="16" color="#409eff"/> 购买记录</div></template>
  <el-table :data="orders" stripe size="small" v-loading="ordersLoading">
    <el-table-column prop="order_no" label="订单号" width="220"/>
    <el-table-column label="点数" width="100"><template #default="{row}">{{ row.amount?.toFixed(0) }} 点</template></el-table-column>
    <el-table-column prop="payment_method" label="支付方式" width="100"><template #default="{row}">{{ payLabel(row.payment_method) }}</template></el-table-column>
    <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="osType(row.status)" size="small">{{ osLabel(row.status) }}</el-tag></template></el-table-column>
    <el-table-column prop="created_at" label="创建时间" width="170"/>
    <el-table-column prop="credited_at" label="发放时间" width="170"/>
  </el-table>
  <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="prev,pager,next" @current-change="fetchOrders" style="margin-top:16px;justify-content:center"/>
</el-card>
</div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
import { ShoppingCart, ClipboardList } from '@lucide/vue'

const form=reactive({amount:50,payment_method:'alipay'})
const submitting=ref(false)
const orders=ref([]),ordersLoading=ref(false),page=ref(1),total=ref(0)

onMounted(()=>{fetchOrders()})

async function submit(){
  if(!form.amount||form.amount<=0){ElMessage.warning('请输入购买点数');return}
  submitting.value=true
  try{await api.post('/api/user/recharge',{amount:form.amount,payment_method:form.payment_method});ElMessage.success('购买订单已创建,请联系管理员确认发放');fetchOrders()}catch(e){}
  submitting.value=false
}

async function fetchOrders(){ordersLoading.value=true;try{const r=await api.get('/api/user/recharge-orders',{params:{page:page.value}});orders.value=r.data.data;total.value=r.data.pagination.total}catch(e){}ordersLoading.value=false}

function osType(s){const m={pending:'warning',paid:'primary',granted:'success',credited:'success',cancelled:'info',abnormal:'danger'};return m[s]||'info'}
function osLabel(s){const m={pending:'待支付',paid:'已支付',granted:'已发放',credited:'已发放',cancelled:'已取消',abnormal:'异常'};return m[s]||s}
function payLabel(m){const map={alipay:'支付宝',wechat:'微信支付',usdt:'USDT',manual_transfer:'手动转账'};return map[m]||m}
</script>
