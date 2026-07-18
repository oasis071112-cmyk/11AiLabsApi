<template>
<div class="auth-page"><div class="auth-card">
<div style="text-align:center;margin-bottom:28px"><img src="/logo-icon.svg" alt="11AiLabs" style="height:56px"/><div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-top:10px;letter-spacing:1px">11AiLabs</div></div>
<el-form :model="form" :rules="rules" ref="frm" @submit.prevent="handleLogin">
<el-form-item prop="username"><el-input v-model="form.username" placeholder="用户名" size="large"/></el-form-item>
<el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password @keyup.enter="handleLogin"/></el-form-item>
<el-form-item><el-button native-type="button" type="primary" size="large" style="width:100%" :loading="loading" @click="handleLogin">登 录</el-button></el-form-item>
</el-form>
<el-alert v-if="loginError" :title="loginError" type="error" show-icon :closable="false" class="login-error" role="alert" aria-live="polite"/>
<div style="text-align:center;color:#909399">没有账号？<el-link type="primary" @click="$router.push('/register')">立即注册</el-link></div>
</div></div>
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
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; }
.auth-card { width: 420px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 44px 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); }
.login-error { margin: -4px 0 18px; }
</style>
