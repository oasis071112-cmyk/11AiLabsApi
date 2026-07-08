<template>
<div class="auth-page"><div class="auth-card">
<h2 style="text-align:center;margin-bottom:24px;color:#409eff"><UserPlus :size="24" style="margin-right:6px;vertical-align:middle"/> 注册账号</h2>
<el-form :model="form" :rules="rules" ref="frm">
<el-form-item prop="username"><el-input v-model="form.username" placeholder="用户名（3-32字符）" size="large"/></el-form-item>
<el-form-item prop="email"><el-input v-model="form.email" placeholder="邮箱（选填）" size="large"/></el-form-item>
<el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="密码（至少6位）" size="large" show-password/></el-form-item>
<el-form-item prop="cp"><el-input v-model="form.cp" type="password" placeholder="确认密码" size="large" show-password/></el-form-item>
<el-form-item><el-button type="primary" size="large" style="width:100%" :loading="loading" @click="handleRegister">注 册</el-button></el-form-item>
</el-form>
<div style="text-align:center;color:#909399">已有账号？<el-link type="primary" @click="$router.push('/login')">立即登录</el-link></div>
<el-alert v-if="result" :title="result" type="success" style="margin-top:16px" :closable="false">
<template v-if="apiKey"><div style="margin-top:8px;font-weight:bold;color:#e6a23c">⚠️ 请保存 API Key（仅展示一次）：</div><div style="background:#f5f7fa;padding:8px;border-radius:4px;word-break:break-all;margin-top:4px;font-family:monospace">{{ apiKey }}</div></template>
</el-alert>
</div></div>
</template>

<script setup>
import { ref, reactive } from 'vue';import { useRouter } from 'vue-router';import { useAuthStore } from '@/stores/auth';import { ElMessage } from 'element-plus';import { UserPlus, AlertTriangle } from '@lucide/vue'
const router=useRouter(),authStore=useAuthStore(),frm=ref(null),loading=ref(false),result=ref(''),apiKey=ref('')
const form=reactive({username:'',email:'',password:'',cp:''})
const rules={username:[{required:true,message:'请输入用户名',trigger:'blur'},{min:3,max:32,message:'3-32字符',trigger:'blur'}],password:[{required:true,message:'请输入密码',trigger:'blur'},{min:6,message:'至少6位',trigger:'blur'}],cp:[{required:true,message:'请确认密码',trigger:'blur'},{validator:(r,v,cb)=>v===form.password?cb():cb(new Error('两次密码不一致')),trigger:'blur'}]}
async function handleRegister(){const v=await frm.value.validate().catch(()=>false);if(!v)return;loading.value=true;try{const r=await authStore.register({username:form.username,password:form.password,email:form.email});result.value=`注册成功！${r.gift_amount>0?`已赠送 ${r.gift_amount} 额度点数。`:''}`;apiKey.value=r.api_key;ElMessage.success('注册成功！');setTimeout(()=>router.push('/'),3000)}catch(e){}loading.value=false}
</script>
<style scoped>.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc}.auth-card{width:450px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:44px 40px;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04)}</style>