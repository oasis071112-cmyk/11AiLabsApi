<template>
<div class="app-shell admin-shell">
  <header class="mobile-topbar admin-mobile-topbar">
    <button ref="triggerRef" class="mobile-menu-button" type="button" aria-label="打开管理菜单" @click="openDrawer"><Menu :size="22"/></button>
    <div class="mobile-page-title"><small>管理后台</small><span>{{ pageTitle }}</span></div>
    <button class="mobile-avatar admin-avatar" type="button" aria-label="打开管理菜单" @click="openDrawer">{{ userInitial }}</button>
  </header>

  <button v-if="drawerOpen" class="drawer-backdrop" type="button" aria-label="关闭管理菜单" @click="closeDrawer"></button>

  <aside ref="drawerRef" class="app-sidebar admin-sidebar" :class="{open:drawerOpen}" :aria-hidden="isMobile&&!drawerOpen" :inert="isMobile&&!drawerOpen?'':null">
    <div class="sidebar-mobile-head admin-drawer-head">
      <span>管理菜单</span>
      <button type="button" aria-label="关闭管理菜单" @click="closeDrawer"><X :size="20"/></button>
    </div>
    <div class="admin-logo"><img src="/logo-white.svg" alt="11AiLabs"/><div>11AiLabs</div></div>
    <el-menu :default-active="route.path" background-color="#111827" text-color="#9ca3af" active-text-color="#C5D5C0" router class="admin-menu" @select="closeDrawer">
      <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path"><el-icon><component :is="item.icon" :size="16"/></el-icon>{{ item.label }}</el-menu-item>
    </el-menu>
    <div class="admin-mobile-account">
      <div><strong>{{ authStore.user?.username }}</strong><small>{{ roleLabel }}</small></div>
      <el-button size="small" plain @click="logout">退出登录</el-button>
    </div>
  </aside>

  <div class="app-content">
    <header class="desktop-admin-header">
      <span>{{ pageTitle }}</span>
      <div><small>{{ roleLabel }}</small><strong>{{ authStore.user?.username }}</strong><el-button size="small" text @click="logout">退出</el-button></div>
    </header>
    <main class="app-main"><router-view/></main>
  </div>
</div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useMobileDrawer } from '@/composables/useMobileDrawer'
import { LayoutDashboard, Users, ShoppingCart, Cpu, Percent, Key, ScrollText, Share2, Settings, Lock, Menu, X } from '@lucide/vue'

const route=useRoute(),router=useRouter(),authStore=useAuthStore()
const { isMobile, drawerOpen, drawerRef, triggerRef, openDrawer, closeDrawer }=useMobileDrawer()
const menuItems=[
  {path:'/admin',label:'仪表盘',icon:LayoutDashboard},{path:'/admin/users',label:'用户管理',icon:Users},{path:'/admin/orders',label:'额度订单',icon:ShoppingCart},{path:'/admin/channels',label:'路由与渠道',icon:Share2},{path:'/admin/models',label:'模型管理',icon:Cpu},{path:'/admin/pricing',label:'倍率规则',icon:Percent},{path:'/admin/keys',label:'API Key',icon:Key},{path:'/admin/logs',label:'调用日志',icon:ScrollText},{path:'/admin/settings',label:'系统设置',icon:Settings},{path:'/admin/change-password',label:'修改密码',icon:Lock},
]
const titles=Object.fromEntries(menuItems.map(item=>[item.path,item.label]))
const pageTitle=computed(()=>titles[route.path]||'管理后台')
const roleLabel=computed(()=>({admin:'超级管理员',operator:'运营',finance:'财务'}[authStore.user?.role]||''))
const userInitial=computed(()=>(authStore.user?.username||'A').slice(0,1).toUpperCase())
function logout(){closeDrawer();authStore.logout();router.push('/login')}
</script>

<style scoped>
.admin-sidebar{background:#111827}.admin-logo{padding:20px 20px 16px;text-align:center;border-bottom:1px solid #1f2937}.admin-logo img{height:32px;margin-bottom:6px}.admin-logo div{font-size:14px;font-weight:700;color:#fff}.admin-menu{border-right:0;flex:1}.desktop-admin-header{background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:52px;margin-bottom:12px;flex-shrink:0;box-shadow:var(--shadow-sm)}.desktop-admin-header>span{font-size:15px;font-weight:700;color:#000}.desktop-admin-header>div{display:flex;align-items:center;gap:14px}.desktop-admin-header small{font-size:12px;color:var(--text-muted);font-weight:500}.desktop-admin-header strong{font-size:13px;font-weight:500}.admin-mobile-account{display:none}
@media(max-width:768px){.desktop-admin-header{display:none}.admin-logo{padding-top:10px}.admin-mobile-account{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px max(14px,env(safe-area-inset-bottom));border-top:1px solid #1f2937;color:#fff}.admin-mobile-account div{min-width:0}.admin-mobile-account strong,.admin-mobile-account small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.admin-mobile-account small{color:#9ca3af;font-size:11px;margin-top:2px}.admin-mobile-account .el-button{margin:0;flex-shrink:0}.mobile-page-title{display:flex;flex-direction:column;min-width:0;text-align:center}.mobile-page-title small{font-size:10px;color:var(--text-muted);line-height:1.2}.mobile-page-title span{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.admin-avatar{background:#111827}}
</style>
