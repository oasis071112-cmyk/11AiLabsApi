<template>
<div class="page-container password-page">
<section class="password-panel">
<h3 style="margin-bottom:24px">修改密码</h3>
<el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
<el-form-item label="旧密码" prop="oldPassword"><el-input v-model="form.oldPassword" type="password" show-password/></el-form-item>
<el-form-item label="新密码" prop="newPassword"><el-input v-model="form.newPassword" type="password" show-password/></el-form-item>
<el-form-item label="确认新密码" prop="confirmPassword"><el-input v-model="form.confirmPassword" type="password" show-password/></el-form-item>
<el-form-item><el-button type="primary" :loading="loading" @click="submit">修改密码</el-button></el-form-item>
</el-form>
</section>
</div>
</template>
<script setup>
import { ref } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const form=ref({oldPassword:'',newPassword:'',confirmPassword:''}),formRef=ref(null),loading=ref(false)
const rules={oldPassword:[{required:true,message:'请输入旧密码',trigger:'blur'}],newPassword:[{required:true,min:6,message:'新密码至少6位',trigger:'blur'}],confirmPassword:[{required:true,validator:(_r,v,cb)=>v===form.value.newPassword?cb():cb(new Error('两次密码不一致')),trigger:'blur'}]}
async function submit(){const ok=await formRef.value.validate().catch(()=>false);if(!ok)return;loading.value=true;try{await api.put('/api/user/password',{oldPassword:form.value.oldPassword,newPassword:form.value.newPassword});ElMessage.success('密码修改成功');formRef.value.resetFields()}catch(e){ElMessage.error(e.response?.data?.error||'修改失败')}loading.value=false}
</script>
<style scoped>
.password-page{max-width:620px}.password-panel{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:28px 30px;box-shadow:var(--shadow-sm)}
.password-panel :deep(.el-form-item){margin-bottom:20px}.password-panel :deep(.el-button){min-width:120px}
@media(max-width:768px){.password-panel{padding:20px 16px}.password-panel :deep(.el-form-item){display:block}.password-panel :deep(.el-form-item__label){width:auto!important;justify-content:flex-start}.password-panel :deep(.el-form-item__content){margin-left:0!important}.password-panel :deep(.el-button){width:100%}}
</style>
