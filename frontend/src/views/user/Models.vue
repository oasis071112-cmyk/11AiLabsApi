<template>
<div class="page-container"><h2 class="card-title mb-16"><Cpu :size="22"/> 模型列表与倍率</h2>
<el-table :data="models" stripe><el-table-column prop="model_name" label="模型名称" min-width="150"/><el-table-column prop="model_code" label="编码" width="160"/><el-table-column label="类型" width="100"><template #default="{row}"><el-tag size="small" effect="plain">{{ tl(row.model_type) }}</el-tag></template></el-table-column><el-table-column label="上下文" width="120"><template #default="{row}">{{ fc(row.context_length) }}</template></el-table-column><el-table-column label="多模态" width="80" align="center"><template #default="{row}"><el-tag :type="row.is_multimodal?'success':'info'" size="small" effect="plain">{{ row.is_multimodal?'是':'否' }}</el-tag></template></el-table-column><el-table-column label="输入倍率" width="100"><template #default="{row}"><span style="font-weight:600">×{{ row.display_multiplier_input }}</span></template></el-table-column><el-table-column label="输出倍率" width="100"><template #default="{row}"><span style="font-weight:600">×{{ row.display_multiplier_output }}</span></template></el-table-column><el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip/><el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small" effect="plain">{{ row.status==='active'?'可用':'维护' }}</el-tag></template></el-table-column></el-table>
</div>
</template>
<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { Cpu } from '@lucide/vue'
const models=ref([])
onMounted(async()=>{try{models.value=(await api.get('/api/user/models')).data.data}catch(e){}})
function tl(t){const m={llm:'对话',embedding:'嵌入',image:'图像',audio:'音频',video:'视频'};return m[t]||t}
function fc(n){return n>=1000?`${(n/1000).toFixed(0)}K`:n}
</script>
