<template>
<div><h3 style="margin-bottom:16px">系统设置</h3>
<el-card><el-form label-width="200px">
<el-form-item v-for="c in configs" :key="c.config_key" :label="c.description || c.config_key">
<el-input v-if="!['registration_enabled','new_user_gift_enabled'].includes(c.config_key)" v-model="c.config_value"/>
<el-switch v-else v-model="c.config_value" active-value="true" inactive-value="false"/>
</el-form-item>
<el-form-item><el-button type="primary" :loading="saving" @click="saveAll">保存全部设置</el-button></el-form-item>
</el-form></el-card>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const configs=ref([]),saving=ref(false)
onMounted(async()=>{try{configs.value=(await api.get('/api/admin/config')).data.data}catch(e){}})
async function saveAll(){saving.value=true;try{for(const c of configs.value){await api.put(`/api/admin/config/${c.config_key}`,{config_value:c.config_value})}ElMessage.success('所有设置已保存')}catch(e){}saving.value=false}
</script>
