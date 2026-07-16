<template>
<div class="app-shell user-shell">
  <header class="mobile-topbar">
    <button class="mobile-menu-button" type="button" aria-label="打开导航菜单" @click="drawerOpen=true"><Menu :size="22"/></button>
    <router-link to="/" class="mobile-brand"><img src="/logo-icon.svg" alt="11AiLabs"/><span>11AiLabs</span></router-link>
    <button class="mobile-avatar" type="button" aria-label="打开用户菜单" @click="drawerOpen=true">{{ userInitial }}</button>
  </header>

  <button v-if="drawerOpen" class="drawer-backdrop" type="button" aria-label="关闭导航菜单" @click="drawerOpen=false"></button>

  <aside class="app-sidebar user-sidebar" :class="{open:drawerOpen}">
    <div class="sidebar-mobile-head">
      <span>导航菜单</span>
      <button type="button" aria-label="关闭导航菜单" @click="drawerOpen=false"><X :size="20"/></button>
    </div>

    <div class="sidebar-logo">
      <router-link to="/" @click="drawerOpen=false">
        <img src="/logo-icon.svg" alt="11AiLabs"/>
        <span>11AiLabs</span>
      </router-link>
    </div>

    <nav class="sidebar-nav">
      <router-link v-for="item in navItems" :key="item.path" :to="item.path" class="sidebar-link" :class="{active:route.path===item.path}" @click="drawerOpen=false">
        <component :is="item.icon" :size="18"/>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <div class="sidebar-account">
      <div class="account-card">
        <div class="account-name">
          <el-avatar :size="30" icon="UserFilled"/>
          <div>{{ authStore.user?.username }}</div>
        </div>
        <div class="account-actions">
          <el-button v-if="authStore.isAdmin" size="small" @click="go('/admin')"><Shield :size="12"/>管理</el-button>
          <el-button size="small" @click="go('/change-password')"><Lock :size="12"/>密码</el-button>
          <el-button size="small" type="danger" plain @click="logout"><LogOut :size="12"/>退出</el-button>
        </div>
      </div>
    </div>
  </aside>

  <main class="app-main"><router-view/></main>
</div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { LayoutDashboard, Wallet, Key, Cpu, ScrollText, Shield, LogOut, Lock, ShoppingCart, Menu, X } from '@lucide/vue'

const route=useRoute(),router=useRouter(),authStore=useAuthStore(),appStore=useAppStore()
const drawerOpen=ref(false)
const userInitial=computed(()=>(authStore.user?.username||'U').slice(0,1).toUpperCase())
const navItems=[
  {path:'/',label:'控制台',icon:LayoutDashboard},
  {path:'/wallet',label:'钱包',icon:Wallet},
  {path:'/subscribe',label:'订阅额度',icon:ShoppingCart},
  {path:'/keys',label:'API Key',icon:Key},
  {path:'/models',label:'模型列表',icon:Cpu},
  {path:'/logs',label:'调用记录',icon:ScrollText},
]

function go(path){drawerOpen.value=false;router.push(path)}
function logout(){drawerOpen.value=false;authStore.logout();router.push('/login')}

watch(()=>route.fullPath,()=>{drawerOpen.value=false})
onMounted(()=>{appStore.fetchPlatformInfo()})
</script>

<style scoped>
.user-sidebar{background:#fff;border:1px solid var(--border);box-shadow:var(--shadow-sm)}
.sidebar-logo{padding:22px 20px 14px}.sidebar-logo a{display:flex;align-items:center;gap:8px;text-decoration:none}.sidebar-logo img{height:34px}.sidebar-logo span{font-size:20px;font-weight:700;color:var(--text-primary);letter-spacing:-.5px}
.sidebar-nav{flex:1;padding:0 12px 8px}.sidebar-link{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:2px;border-radius:8px;font-size:14px;font-weight:500;color:var(--text-secondary);text-decoration:none;transition:all .15s}.sidebar-link:hover{background:#f2f5ef;color:var(--text-primary)}.sidebar-link.active{background:#edf4ea;color:var(--primary);font-weight:600}
.sidebar-account{padding:0 12px 12px}.account-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow-sm)}.account-name{display:flex;align-items:center;gap:10px;margin-bottom:8px}.account-name .el-avatar{background:var(--primary);flex-shrink:0}.account-name div{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-actions{display:flex;gap:4px}.account-actions .el-button{flex:1;font-size:11px;margin:0}.account-actions svg{margin-right:2px}
@media(max-width:768px){.sidebar-logo{padding-top:10px}.sidebar-account{padding-bottom:max(12px,env(safe-area-inset-bottom))}.account-actions .el-button{min-height:36px}}
</style>
