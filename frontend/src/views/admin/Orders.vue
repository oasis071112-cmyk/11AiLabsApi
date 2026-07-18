<template>
<div class="admin-page orders-page"><div class="flex-between mb-16"><h3>额度购买订单管理</h3></div>
<el-radio-group v-model="statusFilter" @change="fetch" style="margin-bottom:16px"><el-radio-button value="">全部</el-radio-button><el-radio-button value="pending">待支付</el-radio-button><el-radio-button value="paid">已支付</el-radio-button><el-radio-button value="granted">已发放</el-radio-button><el-radio-button value="cancelled">已取消</el-radio-button></el-radio-group>
<el-table :data="orders" stripe v-loading="loading">
<el-table-column prop="order_no" label="订单号" width="220"/><el-table-column prop="username" label="用户" width="120"/>
<el-table-column label="点数" width="100"><template #default="{row}">{{ row.amount }} 点</template></el-table-column>
<el-table-column prop="payment_method" label="支付方式" width="120"/>
<el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="st(row.status)" size="small">{{ sl(row.status) }}</el-tag></template></el-table-column>
<el-table-column prop="created_at" label="创建时间" min-width="160"/>
<el-table-column label="操作" width="200"><template #default="{row}">
<el-button v-if="row.status==='pending'||row.status==='paid'" size="small" type="success" @click="confirmOrder(row)">确认发放</el-button>
<el-button v-if="row.status==='pending'" size="small" type="danger" @click="rejectOrder(row)">驳回</el-button>
</template></el-table-column>
</el-table>
<el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="prev,pager,next" @current-change="fetch" style="margin-top:16px;justify-content:center"/>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage, ElMessageBox } from 'element-plus'
const orders=ref([]),loading=ref(false),statusFilter=ref(''),page=ref(1),total=ref(0)
onMounted(()=>fetch())
async function fetch(){loading.value=true;const p={page:page.value};if(statusFilter.value)p.status=statusFilter.value;try{const r=await api.get('/api/admin/recharge-orders',{params:p});orders.value=r.data.data;total.value=r.data.pagination.total}catch(e){}loading.value=false}
async function confirmOrder(o){await ElMessageBox.confirm(`确认发放 ${o.amount} 点给 ${o.username}？`,'确认操作');await api.patch(`/api/admin/recharge-orders/${o.id}/confirm`);ElMessage.success('已确认发放');fetch()}
async function rejectOrder(o){const {value}=await ElMessageBox.prompt('驳回原因','驳回订单');if(value!==null){await api.patch(`/api/admin/recharge-orders/${o.id}/reject`,{remark:value});ElMessage.success('已驳回');fetch()}}
function st(s){const m={pending:'warning',paid:'primary',granted:'success',credited:'success',cancelled:'info',abnormal:'danger'};return m[s]||'info'}
function sl(s){const m={pending:'待支付',paid:'已支付',granted:'已发放',credited:'已发放',cancelled:'已取消',abnormal:'异常'};return m[s]||s}
</script>
