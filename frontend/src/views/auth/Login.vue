<template>
<div class="auth-page"><section class="auth-shell">
<aside class="auth-brand-panel"><img src="/logo-icon.svg" alt="11AiLabs"/><div><strong>11AiLabs</strong><span>API 服务管理平台</span></div><p>统一管理模型、密钥、调用与额度。</p></aside>
<div class="auth-card">
<div class="auth-card-head"><img src="/logo-icon.svg" alt="11AiLabs"/><div><div>欢迎回来</div><span>登录后继续管理你的 API 服务</span></div></div>
<el-form :model="form" :rules="rules" ref="frm" @submit.prevent="handleLogin">
<el-form-item prop="username"><el-input v-model="form.username" placeholder="用户名" size="large"/></el-form-item>
<el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password @keyup.enter="handleLogin"/></el-form-item>
<el-form-item><el-button native-type="button" type="primary" size="large" style="width:100%" :loading="loading" @click="handleLogin">登 录</el-button></el-form-item>
</el-form>
<el-alert v-if="loginError" :title="loginError" type="error" show-icon :closable="false" class="login-error" role="alert" aria-live="polite"/>
<div class="auth-switch" style="text-align:center;color:#909399">没有账号？<el-link type="primary" @click="$router.push('/register')">立即注册</el-link></div>
</div></section></div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const frm = ref(null)
const loading = ref(false)
const loginError = ref('')
const form = reactive({ username: '', password: '' })
const rules = {
  username: [ { required: true, message: '请输入用户名', trigger: 'blur' } ],
  password: [ { required: true, message: '请输入密码', trigger: 'blur' } ]
}

async function handleLogin() {
  if (loading.value) return
  loading.value = true
  loginError.value = ''
  const valid = await frm.value.validate().catch(() => false)
  if (!valid) { loading.value = false; return }
  try {
    await authStore.login(form.username, form.password)
    router.push(authStore.isAdmin ? '/admin' : '/')
  } catch (e) {
    loginError.value = e.response?.data?.error || e.message || '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; padding:24px; }
.auth-shell{width:min(880px,100%);min-height:520px;display:grid;grid-template-columns:minmax(260px,.8fr) minmax(380px,1.2fr);background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04)}
.auth-brand-panel{padding:42px 34px;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center}.auth-brand-panel>img{width:52px;height:52px;margin-bottom:20px}.auth-brand-panel>div{display:flex;flex-direction:column;gap:3px}.auth-brand-panel strong{font-size:24px;letter-spacing:-.04em;color:var(--text-primary)}.auth-brand-panel span,.auth-brand-panel p{color:var(--text-muted)}.auth-brand-panel p{max-width:24ch;margin-top:18px;line-height:1.7}
.auth-card { width:100%; padding:50px 52px; align-self:center; }
.auth-card-head{display:flex;align-items:center;gap:13px;margin-bottom:28px}.auth-card-head>img{display:none;width:44px;height:44px}.auth-card-head>div>div{font-size:24px;font-weight:750;letter-spacing:-.03em;color:var(--text-primary)}.auth-card-head span{display:block;margin-top:3px;font-size:13px;color:var(--text-muted)}
.auth-card :deep(.el-form-item){margin-bottom:20px}.auth-card :deep(.el-input__wrapper){min-height:46px}.auth-card :deep(.el-button){min-height:46px;font-weight:650}.auth-switch{font-size:13px}
.login-error { margin: -4px 0 18px; }
@media(max-width:768px){.auth-page{padding:16px 12px}.auth-shell{display:block;width:100%;min-height:0;border-radius:14px}.auth-brand-panel{display:none}.auth-card{padding:34px 24px}.auth-card-head>img{display:block}.auth-card-head{margin-bottom:24px}.auth-card-head>div>div{font-size:21px}}
</style>
