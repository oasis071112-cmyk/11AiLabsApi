<template>
<div class="auth-page"><div class="auth-card">
<div style="text-align:center;margin-bottom:28px"><img src="/logo-icon.svg" alt="11AiLabs" style="height:56px"/><div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-top:10px;letter-spacing:1px">11AiLabs</div></div>
<el-form :model="form" :rules="rules" ref="frm">
<el-form-item prop="username"><el-input v-model="form.username" placeholder="用户名" size="large"/></el-form-item>
<el-form-item prop="password"><el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password/></el-form-item>
<el-form-item><el-button type="primary" size="large" style="width:100%" :loading="loading" @click="handleLogin">登 录</el-button></el-form-item>
</el-form>
<div style="text-align:center;color:#909399">没有账号？<el-link type="primary" @click="$router.push('/register')">立即注册</el-link></div>
<div style="text-align:center;margin-top:12px;color:#c0c4cc;font-size:12px">测试账号: admin/admin123 | testuser/user123</div>
</div></div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()
const frm = ref(null)
const loading = ref(false)
const form = reactive({ username: '', password: '' })
const rules = {
  username: [ { required: true, message: '请输入用户名', trigger: 'blur' } ],
  password: [ { required: true, message: '请输入密码', trigger: 'blur' } ]
}

async function handleLogin() {
  const valid = await frm.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await authStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    router.push(authStore.isAdmin ? '/admin' : '/')
  } catch (e) {
    ElMessage.error(e.response?.data?.error || e.message || '登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; }
.auth-card { width: 420px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 44px 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04); }
</style>
