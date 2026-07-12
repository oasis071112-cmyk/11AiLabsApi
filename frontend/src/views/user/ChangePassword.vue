<template>
<div style="max-width:500px;margin:40px auto">
<h3 style="margin-bottom:24px">修改密码</h3>
<el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
<el-form-item label="旧密码" prop="oldPassword"><el-input v-model="form.oldPassword" type="password" show-password/></el-form-item>
<el-form-item label="新密码" prop="newPassword"><el-input v-model="form.newPassword" type="password" show-password/></el-form-item>
<el-form-item label="确认新密码" prop="confirmPassword"><el-input v-model="form.confirmPassword" type="password" show-password/></el-form-item>
<el-form-item><el-button type="primary" :loading="loading" @click="submit">修改密码</el-button></el-form-item>
</el-form>
</div>
</template>
<script setup>
import { ref } from 'vue';import api from '@/api';import { ElMessage } from 'element-plus'
const form=ref({oldPassword:'',newPassword:'',confirmPassword:''}),formRef=ref(null),loading=ref(false)
const rules={oldPassword:[{required:true,message:'请输入旧密码',trigger:'blur'}],newPassword:[{required:true,min:6,message:'新密码至少6位',trigger:'blur'}],confirmPassword:[{required:true,validator:(_r,v,cb)=>v===form.value.newPassword?cb():cb(new Error('两次密码不一致')),trigger:'blur'}]}
async function submit(){const ok=await formRef.value.validate().catch(()=>false);if(!ok)return;loading.value=true;try{await api.put('/api/user/password',{old_password:form.value.oldPassword,new_password:form.value.newPassword});ElMessage.success('密码修改成功');formRef.value.resetFields()}catch(e){ElMessage.error(e.response?.data?.error||'修改失败')}loading.value=false}
</script>
