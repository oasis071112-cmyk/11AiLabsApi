<template>
<div class="admin-page users-page"><div class="flex-between mb-16 users-toolbar"><h3>用户管理</h3><el-input v-model="search" class="admin-search" placeholder="搜索用户名/邮箱" clearable @change="fetch"/></div>
<el-table class="desktop-users-table" :data="users" stripe v-loading="loading" table-layout="fixed">
<el-table-column prop="id" label="ID" width="60"/><el-table-column prop="username" label="用户名" min-width="130"/><el-table-column prop="email" label="邮箱" min-width="190" show-overflow-tooltip/>
<el-table-column label="角色" width="100"><template #default="{row}"><el-tag :type="row.role==='admin'?'danger':'info'" size="small">{{ rl(row.role) }}</el-tag></template></el-table-column>
<el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status==='active'?'正常':'禁用' }}</el-tag></template></el-table-column>
<el-table-column label="额度点数" width="110"><template #default="{row}">{{ points(row.quota_balance) }} 点</template></el-table-column>
<el-table-column label="赠送点数" width="110"><template #default="{row}">{{ points(row.gift_quota) }} 点</template></el-table-column>
<el-table-column label="累计消费" width="110"><template #default="{row}">{{ points(row.total_spent) }} 点</template></el-table-column>
<el-table-column label="注册时间" width="170"><template #default="{row}">{{ formatBeijingTime(row.register_time) }}</template></el-table-column>
<el-table-column label="操作" width="200"><template #default="{row}">
<el-button size="small" @click="showDetail(row)">详情</el-button>
<el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleStatus(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button>
</template></el-table-column>
</el-table>
<div class="mobile-user-list" v-loading="loading">
  <article v-for="row in users" :key="row.id" class="mobile-user-card">
    <div class="mobile-user-head"><div><strong>{{ row.username }}</strong><span>#{{ row.id }}</span></div><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status==='active'?'正常':'禁用' }}</el-tag></div>
    <div class="mobile-user-email">{{ row.email || '-' }}</div>
    <div class="mobile-user-meta"><span>额度<strong>{{ points(row.quota_balance) }} 点</strong></span><span>赠送<strong>{{ points(row.gift_quota) }} 点</strong></span><span>消费<strong>{{ points(row.total_spent) }} 点</strong></span></div>
    <div class="mobile-user-time">注册于 {{ formatBeijingTime(row.register_time) }}</div>
    <div class="mobile-user-actions"><el-button @click="showDetail(row)">详情</el-button><el-button :type="row.status==='active'?'warning':'success'" @click="toggleStatus(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button></div>
  </article>
  <el-empty v-if="!loading&&!users.length" description="暂无用户" :image-size="56"/>
</div>
<el-pagination v-model:current-page="page" :page-size="limit" :total="total" layout="prev,pager,next" @current-change="fetch" style="margin-top:16px;justify-content:center"/>

<!-- 用户详情弹窗 -->
<el-dialog v-model="detailDialog" title="用户详情" width="700px">
<template v-if="detailUser">
<el-descriptions :column="2" border><el-descriptions-item label="ID">{{ detailUser.id }}</el-descriptions-item><el-descriptions-item label="用户名">{{ detailUser.username }}</el-descriptions-item><el-descriptions-item label="邮箱">{{ detailUser.email||'-' }}</el-descriptions-item><el-descriptions-item label="角色">{{ rl(detailUser.role) }}</el-descriptions-item><el-descriptions-item label="状态">{{ detailUser.status }}</el-descriptions-item><el-descriptions-item label="注册时间">{{ formatBeijingTime(detailUser.register_time) }}</el-descriptions-item><el-descriptions-item label="额度点数">{{ points(detailUser.quota_balance) }} 点</el-descriptions-item><el-descriptions-item label="赠送点数">{{ points(detailUser.gift_quota) }} 点</el-descriptions-item><el-descriptions-item label="累计消费">{{ points(detailUser.total_spent) }} 点</el-descriptions-item></el-descriptions>
<el-alert v-if="pendingOrders.length" :title="`该用户有 ${pendingOrders.length} 笔待处理订单；同额手工加款将被拦截，请优先前往额度订单确认发放`" type="warning" show-icon :closable="false" style="margin-top:14px"/>
<div style="margin-top:16px"><el-button type="success" @click="adjustDialog=true"><DollarSign :size="14" style="margin-right:2px"/> 手工调账</el-button></div>
</template>
</el-dialog>

<!-- 调账弹窗 -->
<el-dialog v-model="adjustDialog" title="手工调账" width="450px"><el-form :model="adj" label-width="100px"><el-form-item label="类型"><el-radio-group v-model="adj.type"><el-radio value="manual_add">增加</el-radio><el-radio value="manual_deduct">扣减</el-radio></el-radio-group></el-form-item><el-form-item label="点数类型"><el-select v-model="adj.balance_type"><el-option value="recharge" label="额度点数"/><el-option value="gift" label="赠送点数"/></el-select></el-form-item><el-form-item label="点数"><el-input-number v-model="adj.amount" :min="0" :step="1"/></el-form-item><el-form-item label="原因"><el-input v-model="adj.remark" type="textarea"/></el-form-item></el-form><template #footer><el-button @click="adjustDialog=false">取消</el-button><el-button type="primary" :loading="adjusting" @click="doAdjust">确认调账</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage, ElMessageBox } from 'element-plus';import { DollarSign } from '@lucide/vue';import { formatBeijingTime } from '@/utils/time'
const users=ref([]),loading=ref(false),search=ref(''),page=ref(1),limit=ref(20),total=ref(0)
const detailDialog=ref(false),detailUser=ref(null),pendingOrders=ref([]),adjustDialog=ref(false),adjusting=ref(false)
const adj=ref({type:'manual_add',balance_type:'recharge',amount:0,remark:''})
onMounted(()=>fetch())
async function fetch(){loading.value=true;try{const r=await api.get('/api/admin/users',{params:{page:page.value,limit:limit.value,search:search.value}});users.value=r.data.data;total.value=r.data.pagination.total}catch(e){ElMessage.error(e.response?.data?.error||'用户列表加载失败，请重试')}loading.value=false}
async function toggleStatus(u){const s=u.status==='active'?'disabled':'active';await api.patch(`/api/admin/users/${u.id}/status`,{status:s});ElMessage.success('状态已更新');fetch()}
async function showDetail(u){detailUser.value=u;pendingOrders.value=[];detailDialog.value=true;try{const r=await api.get(`/api/admin/users/${u.id}`);detailUser.value=r.data.user;pendingOrders.value=r.data.pending_orders||[]}catch(e){ElMessage.error(e.response?.data?.error||'用户详情加载失败')}}
async function doAdjust(){
  if(!adj.value.amount)return ElMessage.warning('请输入点数')
  adjusting.value=true
  try{
    await api.post(`/api/admin/users/${detailUser.value.id}/adjust-balance`,adj.value)
    ElMessage.success('调账成功');adjustDialog.value=false;showDetail(detailUser.value)
  }catch(e){
    if(e.response?.data?.code==='PENDING_ORDER_CONFLICT'){
      try{
        await ElMessageBox.confirm(`${e.response.data.error}。如果本次确实与该订单无关，可继续独立调账；该订单仍会保持待处理。`,'防止重复入账',{confirmButtonText:'确认独立调账',cancelButtonText:'取消，去处理订单',type:'warning'})
        await api.post(`/api/admin/users/${detailUser.value.id}/adjust-balance`,{...adj.value,allow_pending_order_conflict:true})
        ElMessage.success('独立调账成功，待处理订单未变更');adjustDialog.value=false;showDetail(detailUser.value)
      }catch(confirmError){}
    }
  }
  adjusting.value=false
}
function rl(r){const m={admin:'管理员',operator:'运营',finance:'财务',user:'用户'};return m[r]||r}
function points(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed.toFixed(0):'0'}
</script>

<style scoped>
.users-page{width:100%;min-width:0}.users-toolbar{gap:16px}.admin-search{width:260px}.desktop-users-table{width:100%}.mobile-user-list{display:none}
@media(max-width:768px){
  .users-toolbar{align-items:stretch;flex-direction:column}.users-toolbar h3{margin:0}.admin-search{width:100%}.desktop-users-table{display:none}.mobile-user-list{display:grid;gap:10px}.mobile-user-card{min-width:0;padding:13px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}.mobile-user-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.mobile-user-head>div{display:flex;align-items:baseline;min-width:0;gap:7px}.mobile-user-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mobile-user-head span,.mobile-user-time{color:#94a3b8;font-size:11px}.mobile-user-email{margin:6px 0 10px;color:#64748b;font-size:12px;overflow-wrap:anywhere}.mobile-user-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.mobile-user-meta span{min-width:0;padding:7px;background:#f8fafc;border-radius:8px;color:#64748b;font-size:11px}.mobile-user-meta strong{display:block;margin-top:2px;color:#0f172a;font-size:12px;overflow-wrap:anywhere}.mobile-user-time{margin-top:8px}.mobile-user-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.mobile-user-actions .el-button{min-height:44px;margin:0}.users-page :deep(.el-pagination){max-width:100%;overflow-x:auto;justify-content:flex-start!important}.users-page :deep(.el-dialog){width:calc(100% - 16px)!important}.users-page :deep(.el-dialog__body){padding:14px}.users-page :deep(.el-descriptions__body){overflow-x:auto}
}
</style>
