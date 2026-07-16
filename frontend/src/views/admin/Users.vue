<template>
<div><div class="flex-between mb-16"><h3>用户管理</h3><el-input v-model="search" placeholder="搜索用户名/邮箱" style="width:260px" clearable @change="fetch"/></div>
<el-table :data="users" stripe v-loading="loading">
<el-table-column prop="id" label="ID" width="60"/><el-table-column prop="username" label="用户名"/><el-table-column prop="email" label="邮箱"/>
<el-table-column label="角色" width="100"><template #default="{row}"><el-tag :type="row.role==='admin'?'danger':'info'" size="small">{{ rl(row.role) }}</el-tag></template></el-table-column>
<el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'danger'" size="small">{{ row.status==='active'?'正常':'禁用' }}</el-tag></template></el-table-column>
<el-table-column label="额度点数" width="100"><template #default="{row}">{{ row.quota_balance?.toFixed(0)||0 }} 点</template></el-table-column>
<el-table-column label="赠送点数" width="100"><template #default="{row}">{{ row.gift_quota?.toFixed(0)||0 }} 点</template></el-table-column>
<el-table-column label="累计消费" width="100"><template #default="{row}">{{ row.total_spent?.toFixed(0)||0 }} 点</template></el-table-column>
<el-table-column prop="register_time" label="注册时间" width="160"/>
<el-table-column label="操作" width="200"><template #default="{row}">
<el-button size="small" @click="showDetail(row)">详情</el-button>
<el-button size="small" :type="row.status==='active'?'warning':'success'" @click="toggleStatus(row)">{{ row.status==='active'?'禁用':'启用' }}</el-button>
</template></el-table-column>
</el-table>
<el-pagination v-model:current-page="page" :page-size="limit" :total="total" layout="prev,pager,next" @current-change="fetch" style="margin-top:16px;justify-content:center"/>

<!-- 用户详情弹窗 -->
<el-dialog v-model="detailDialog" title="用户详情" width="700px">
<template v-if="detailUser">
<el-descriptions :column="2" border><el-descriptions-item label="ID">{{ detailUser.id }}</el-descriptions-item><el-descriptions-item label="用户名">{{ detailUser.username }}</el-descriptions-item><el-descriptions-item label="邮箱">{{ detailUser.email||'-' }}</el-descriptions-item><el-descriptions-item label="角色">{{ rl(detailUser.role) }}</el-descriptions-item><el-descriptions-item label="状态">{{ detailUser.status }}</el-descriptions-item><el-descriptions-item label="注册时间">{{ detailUser.register_time }}</el-descriptions-item><el-descriptions-item label="额度点数">{{ detailUser.quota_balance?.toFixed(0)||0 }} 点</el-descriptions-item><el-descriptions-item label="赠送点数">{{ detailUser.gift_quota?.toFixed(0)||0 }} 点</el-descriptions-item><el-descriptions-item label="累计消费">{{ detailUser.total_spent?.toFixed(0)||0 }} 点</el-descriptions-item></el-descriptions>
<el-alert v-if="pendingOrders.length" :title="`该用户有 ${pendingOrders.length} 笔待处理订单；同额手工加款将被拦截，请优先前往额度订单确认发放`" type="warning" show-icon :closable="false" style="margin-top:14px"/>
<div style="margin-top:16px"><el-button type="success" @click="adjustDialog=true"><DollarSign :size="14" style="margin-right:2px"/> 手工调账</el-button></div>
</template>
</el-dialog>

<!-- 调账弹窗 -->
<el-dialog v-model="adjustDialog" title="手工调账" width="450px"><el-form :model="adj" label-width="100px"><el-form-item label="类型"><el-radio-group v-model="adj.type"><el-radio value="manual_add">增加</el-radio><el-radio value="manual_deduct">扣减</el-radio></el-radio-group></el-form-item><el-form-item label="点数类型"><el-select v-model="adj.balance_type"><el-option value="recharge" label="额度点数"/><el-option value="gift" label="赠送点数"/></el-select></el-form-item><el-form-item label="点数"><el-input-number v-model="adj.amount" :min="0" :step="1"/></el-form-item><el-form-item label="原因"><el-input v-model="adj.remark" type="textarea"/></el-form-item></el-form><template #footer><el-button @click="adjustDialog=false">取消</el-button><el-button type="primary" :loading="adjusting" @click="doAdjust">确认调账</el-button></template></el-dialog>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage, ElMessageBox } from 'element-plus';import { DollarSign } from '@lucide/vue'
const users=ref([]),loading=ref(false),search=ref(''),page=ref(1),limit=ref(20),total=ref(0)
const detailDialog=ref(false),detailUser=ref(null),pendingOrders=ref([]),adjustDialog=ref(false),adjusting=ref(false)
const adj=ref({type:'manual_add',balance_type:'recharge',amount:0,remark:''})
onMounted(()=>fetch())
async function fetch(){loading.value=true;try{const r=await api.get('/api/admin/users',{params:{page:page.value,limit:limit.value,search:search.value}});users.value=r.data.data;total.value=r.data.pagination.total}catch(e){}loading.value=false}
async function toggleStatus(u){const s=u.status==='active'?'disabled':'active';await api.patch(`/api/admin/users/${u.id}/status`,{status:s});ElMessage.success('状态已更新');fetch()}
async function showDetail(u){detailUser.value=u;pendingOrders.value=[];detailDialog.value=true;try{const r=await api.get(`/api/admin/users/${u.id}`);detailUser.value=r.data.user;pendingOrders.value=r.data.pending_orders||[]}catch(e){}}
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
</script>
