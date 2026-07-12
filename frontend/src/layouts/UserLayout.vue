<template>
<div style="height:100vh;display:flex;background:var(--bg-page);padding:12px;gap:12px;overflow:hidden">
<!-- 侧栏 — 独立圆角卡片 -->
<aside style="width:220px;background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;box-shadow:var(--shadow-sm)">

  <!-- Logo -->
  <div style="padding:22px 20px 14px">
    <router-link to="/" style="display:flex;align-items:center;gap:8px;text-decoration:none">
      <img src="/logo-icon.svg" alt="11AiLabs" style="height:34px"/>
      <span style="font-size:20px;font-weight:700;color:var(--text-primary);letter-spacing:-0.5px">11AiLabs</span>
    </router-link>
  </div>

  <!-- 导航菜单 -->
  <nav style="flex:1;padding:0 12px 8px">
    <router-link v-for="item in navItems" :key="item.path" :to="item.path" class="sidebar-link" :class="{active: route.path===item.path}">
      <component :is="item.icon" :size="18"/>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>

  <!-- 用户信息 — 底部独立圆角卡片 -->
  <div style="padding:0 12px 12px">
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow-sm)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <el-avatar :size="30" icon="UserFilled" style="background:var(--primary);flex-shrink:0"/>
        <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">{{ authStore.user?.username }}</div>
      </div>
      <div style="display:flex;gap:4px">
        <el-button v-if="authStore.isAdmin" size="small" style="flex:1;font-size:11px" @click="$router.push('/admin')"><Shield :size="12" style="margin-right:2px"/>管理</el-button>
        <el-button size="small" style="flex:1;font-size:11px" @click="$router.push('/change-password')"><Lock :size="12" style="margin-right:2px"/>密码</el-button>
        <el-button size="small" type="danger" plain style="flex:1;font-size:11px" @click="authStore.logout();$router.push('/login')"><LogOut :size="12" style="margin-right:2px"/>退出</el-button>
      </div>
    </div>
  </div>
</aside>

<!-- 右侧内容区 -->
<main style="flex:1;min-width:0;overflow:auto"><router-view/></main>
</div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { LayoutDashboard, Wallet, Key, Cpu, ScrollText, Shield, LogOut, Lock, ShoppingCart } from '@lucide/vue'
const route=useRoute(),router=useRouter(),authStore=useAuthStore(),appStore=useAppStore()
const navItems=[
  {path:'/',label:'控制台',icon:LayoutDashboard},
  {path:'/wallet',label:'钱包',icon:Wallet},
  {path:'/subscribe',label:'订阅额度',icon:ShoppingCart},
  {path:'/keys',label:'API Key',icon:Key},
  {path:'/models',label:'模型列表',icon:Cpu},
  {path:'/logs',label:'调用记录',icon:ScrollText},
]
onMounted(()=>{appStore.fetchPlatformInfo()})
</script>

<style scoped>
.sidebar-link {
  display:flex;align-items:center;gap:10px;
  padding:10px 12px;margin-bottom:2px;
  border-radius:8px;font-size:14px;font-weight:500;
  color:var(--text-secondary);text-decoration:none;
  transition:all .15s;
}
.sidebar-link:hover { background:#F2F5EF;color:var(--text-primary) }
.sidebar-link.active { background:#EDF4EA;color:var(--primary);font-weight:600 }
</style>
