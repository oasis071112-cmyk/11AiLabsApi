<template>
<div class="auth-page"><section class="auth-shell">
<aside class="auth-brand-panel"><img src="/logo-icon.svg" alt="11AiLabs"/><div><strong>11AiLabs</strong><span>API 服务管理平台</span></div><p>创建账号后即可管理自己的模型调用与额度。</p></aside>
<div class="auth-card">
<div class="auth-card-head"><UserPlus :size="24"/><div><div>注册账号</div><span>填写基本信息创建你的使用空间</span></div></div>
<el-form :model="form" :rules="rules" ref="frm">
<el-form-item prop="username"><el-input v-model="form.username" placeholder="用户名（3-32字符）" size="large"/></el-form-item>
<el-form-item prop="email"><el-input v-model="form.email" placeholder="邮箱（选填）" size="large"/></el-form-item>
<el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="密码（至少6位）" size="large" show-password/></el-form-item>
<el-form-item prop="cp"><el-input v-model="form.cp" type="password" placeholder="确认密码" size="large" show-password/></el-form-item>
<el-form-item><el-button type="primary" size="large" style="width:100%" :loading="loading" @click="handleRegister">注 册</el-button></el-form-item>
</el-form>
<div class="auth-switch" style="text-align:center;color:#909399">已有账号？<el-link type="primary" @click="$router.push('/login')">立即登录</el-link></div>
<el-alert v-if="result" :title="result" type="success" style="margin-top:16px" :closable="false"/>
</div></section></div>
</template>

<script setup>
import { ref, reactive } from 'vue';import { useRouter } from 'vue-router';import { useAuthStore } from '@/stores/auth';import { ElMessage } from 'element-plus';import { UserPlus } from '@lucide/vue'
const router=useRouter(),authStore=useAuthStore(),frm=ref(null),loading=ref(false),result=ref('')
const form=reactive({username:'',email:'',password:'',cp:''})
const rules={username:[{required:true,message:'请输入用户名',trigger:'blur'},{min:3,max:32,message:'3-32字符',trigger:'blur'}],password:[{required:true,message:'请输入密码',trigger:'blur'},{min:6,message:'至少6位',trigger:'blur'}],cp:[{required:true,message:'请确认密码',trigger:'blur'},{validator:(r,v,cb)=>v===form.password?cb():cb(new Error('两次密码不一致')),trigger:'blur'}]}
async function handleRegister(){const v=await frm.value.validate().catch(()=>false);if(!v)return;loading.value=true;try{await authStore.register({username:form.username,password:form.password,email:form.email});result.value='注册成功，登录中...';ElMessage.success('注册成功，登录中...');setTimeout(()=>router.replace('/'),800)}catch(e){}loading.value=false}
</script>
<style scoped>
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;padding:24px}
.auth-shell{width:min(920px,100%);min-height:560px;display:grid;grid-template-columns:minmax(280px,.85fr) minmax(420px,1.15fr);background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04)}
.auth-brand-panel{padding:42px 34px;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center}.auth-brand-panel>img{width:52px;height:52px;margin-bottom:20px}.auth-brand-panel>div{display:flex;flex-direction:column;gap:3px}.auth-brand-panel strong{font-size:24px;letter-spacing:-.04em;color:var(--text-primary)}.auth-brand-panel span,.auth-brand-panel p{color:var(--text-muted)}.auth-brand-panel p{max-width:25ch;margin-top:18px;line-height:1.7}
.auth-card{width:100%;padding:42px 52px;align-self:center}.auth-card-head{display:flex;align-items:center;gap:13px;margin-bottom:24px}.auth-card-head>div>div{font-size:24px;font-weight:750;letter-spacing:-.03em;color:var(--text-primary)}.auth-card-head span{display:block;margin-top:3px;font-size:13px;color:var(--text-muted)}.auth-card :deep(.el-form-item){margin-bottom:18px}.auth-card :deep(.el-input__wrapper){min-height:44px}.auth-card :deep(.el-button){min-height:46px;font-weight:650}.auth-switch{font-size:13px}
@media(max-width:768px){.auth-page{padding:16px 12px}.auth-shell{display:block;width:100%;min-height:0;border-radius:14px}.auth-brand-panel{display:none}.auth-card{padding:30px 24px}.auth-card-head{margin-bottom:22px}.auth-card-head>div>div{font-size:21px}}
</style>
