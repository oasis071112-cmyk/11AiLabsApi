<template>
<div class="admin-page admin-logs-page"><div class="flex-between mb-16"><h3>调用日志</h3></div>
<el-form :inline="true" style="margin-bottom:16px"><el-form-item label="用户ID"><el-input v-model="f.user_id" placeholder="用户ID" clearable style="width:120px" @change="fetch"/></el-form-item><el-form-item label="模型"><el-input v-model="f.model" placeholder="模型" clearable style="width:150px" @change="fetch"/></el-form-item><el-form-item label="状态"><el-select v-model="f.status" clearable placeholder="全部" @change="fetch" style="width:120px"><el-option value="success" label="成功"/><el-option value="failed" label="失败"/><el-option value="blocked" label="拦截"/></el-select></el-form-item></el-form>
<el-table :data="logs" stripe v-loading="loading" size="small"><el-table-column label="时间" width="180"><template #default="{row}">{{ formatBeijingTime(row.created_at) }}</template></el-table-column><el-table-column prop="username" label="用户" width="100"/><el-table-column prop="model_code" label="模型" width="140"/><el-table-column label="输入Token" width="100"><template #default="{row}">{{ row.input_tokens?.toLocaleString() }}</template></el-table-column><el-table-column label="输出Token" width="100"><template #default="{row}">{{ row.output_tokens?.toLocaleString() }}</template></el-table-column><el-table-column label="实际扣点" width="120"><template #default="{row}">{{ row.total_cost?.toFixed(6) }} 点</template></el-table-column><el-table-column label="状态" width="80"><template #default="{row}"><el-tag :type="row.status==='success'?'success':'danger'" size="small">{{ row.status }}</el-tag></template></el-table-column><el-table-column prop="error_message" label="错误" min-width="150" show-overflow-tooltip/></el-table>
<el-pagination v-model:current-page="page" :page-size="50" :total="total" layout="prev,pager,next" @current-change="fetch" style="margin-top:16px;justify-content:center"/>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api'
import { formatBeijingTime } from '@/utils/time'
const logs=ref([]),loading=ref(false),page=ref(1),total=ref(0),f=ref({user_id:'',model:'',status:''})
onMounted(()=>fetch())
async function fetch(){loading.value=true;try{const r=await api.get('/api/admin/logs',{params:{...f.value,page:page.value}});logs.value=r.data.data;total.value=r.data.pagination.total}catch(e){}loading.value=false}
</script>
