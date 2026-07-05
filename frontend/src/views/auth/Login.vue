<template>
<div class="auth-page"><div class="auth-card">
<h2 style="text-align:center;margin-bottom:24px;color:#409eff">🔑 {{ appStore.platformInfo.platform_name }}</h2>
<el-form :model="form" :rules="rules" ref="frm">
<el-form-item prop="username"><el-input v-model="form.username" placeholder="用户名" size="large" prefix-icon="User"/></el-form-item>
<el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="密码" size="large" prefix-icon="Lock" show-password/></el-form-item>
<el-form-item><el-button type="primary" size="large" style="width:100%" :loading="loading" @click="handleLogin">登 录</el-button></el-form-item>
</el-form>
<div style="text-align:center;color:#909399">没有账号？<el-link type="primary" @click="$router.push('/register')">立即注册</el-link></div>
<div style="text-align:center;margin-top:12px;color:#c0c4cc;font-size:12px">测试账号: admin/admin123 | testuser/user123</div>
</div></div>
</template>

<script setup>
import { ref, reactive } from 'vue';import { useRouter } from 'vue-router';import { useAuthStore } from '@/stores/auth';import { useAppStore } from '@/stores/app';import { ElMessage } from 'element-plus'
const router=useRouter(),authStore=useAuthStore(),appStore=useAppStore(),frm=ref(null),loading=ref(false)
const form=reactive({username:'',password:''})
const rules={username:[{required:true,message:'请输入用户名',trigger:'blur'}],password:[{required:true,message:'请输入密码',trigger:'blur'}]}
async function handleLogin(){const v=await frm.value.validate().catch(()=>false);if(!v)return;loading.value=true;try{await authStore.login(form.username,form.password);ElMessage.success('登录成功');router.push(authStore.isAdmin?'/admin':'/')}catch(e){}loading.value=false}
</script>
<style scoped>.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.auth-card{width:420px;background:#fff;border-radius:12px;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,0.15)}</style>
