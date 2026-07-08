<template>
<el-container style="min-height:100vh">
<el-aside width="200px" style="background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto">
  <!-- Logo -->
  <div style="padding:20px 20px 12px">
    <router-link to="/" style="display:flex;align-items:center;gap:8px;text-decoration:none">
      <img src="/logo.svg" alt="11AiLabs" style="height:28px"/>
    </router-link>
  </div>

  <!-- 用户信息卡片 — 固定在 logo 下方 -->
  <div style="padding:0 16px 12px;border-bottom:1px solid var(--border);margin-bottom:4px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <el-avatar :size="36" icon="UserFilled" style="background:#409eff;flex-shrink:0"/>
      <div style="min-width:0">
        <div style="font-weight:600;font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ authStore.user?.username }}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px"><DollarSign :size="12" style="vertical-align:middle;margin-right:2px"/>{{ walletBalance }}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px">
      <el-button v-if="authStore.isAdmin" size="small" style="flex:1;font-size:12px" @click="$router.push('/admin')"><Shield :size="13" style="margin-right:2px"/>管理后台</el-button>
      <el-button size="small" style="flex:1;font-size:12px" @click="$router.push('/change-password')"><Lock :size="13" style="margin-right:2px"/>修改密码</el-button>
      <el-button size="small" type="danger" plain style="flex:1;font-size:12px" @click="authStore.logout();$router.push('/login')"><LogOut :size="13" style="margin-right:2px"/>退出</el-button>
    </div>
  </div>

  <!-- 导航菜单 -->
  <nav style="flex:1;padding:4px 12px 0">
    <router-link v-for="item in navItems" :key="item.path" :to="item.path" class="sidebar-link" :class="{active: route.path===item.path}">
      <component :is="item.icon" :size="18"/>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</el-aside>

<el-container>
  <el-main style="background:var(--bg-page)"><router-view/></el-main>
</el-container>
</el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import api from '@/api'
import { LayoutDashboard, Wallet, Key, Cpu, ScrollText, DollarSign, Shield, LogOut, Lock, ShoppingCart } from '@lucide/vue'
const route=useRoute(),router=useRouter(),authStore=useAuthStore(),appStore=useAppStore()
const walletBalance=ref('0.00')
const navItems=[
  {path:'/',label:'控制台',icon:LayoutDashboard},
  {path:'/wallet',label:'钱包',icon:Wallet},
  {path:'/subscribe',label:'订阅额度',icon:ShoppingCart},
  {path:'/keys',label:'API Key',icon:Key},
  {path:'/models',label:'模型列表',icon:Cpu},
  {path:'/logs',label:'调用记录',icon:ScrollText},
]
onMounted(async()=>{appStore.fetchPlatformInfo();try{const r=await api.get('/api/user/wallet');const w=r.data;walletBalance.value=(w.recharge_balance+w.gift_balance).toFixed(2)}catch(e){}})
</script>

<style scoped>
.sidebar-link {
  display:flex;align-items:center;gap:10px;
  padding:10px 12px;margin-bottom:2px;
  border-radius:8px;font-size:14px;font-weight:500;
  color:var(--text-secondary);text-decoration:none;
  transition:all .15s;
}
.sidebar-link:hover { background:#f1f5f9;color:var(--text-primary) }
.sidebar-link.active { background:#eff6ff;color:#409eff;font-weight:600 }
</style>
