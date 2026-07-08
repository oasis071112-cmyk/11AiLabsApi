<template>
<el-container style="min-height:100vh">
<el-aside width="220px" style="background:#111827;overflow-y:auto">
<div style="padding:18px 20px;text-align:center;border-bottom:1px solid #1f2937"><img src="/logo-white.svg" alt="11AiLabs" style="height:26px"/></div>
<el-menu :default-active="route.path" background-color="#111827" text-color="#9ca3af" active-text-color="#60a5fa" router style="border-right:none">
<el-menu-item index="/admin"><el-icon><LayoutDashboard :size="16"/></el-icon> 仪表盘</el-menu-item>
<el-menu-item index="/admin/users"><el-icon><Users :size="16"/></el-icon> 用户管理</el-menu-item>
<el-menu-item index="/admin/orders"><el-icon><ShoppingCart :size="16"/></el-icon> 额度订单</el-menu-item>
<el-menu-item index="/admin/models"><el-icon><Cpu :size="16"/></el-icon> 模型管理</el-menu-item>
<el-menu-item index="/admin/pricing"><el-icon><Percent :size="16"/></el-icon> 倍率规则</el-menu-item>
<el-menu-item index="/admin/keys"><el-icon><Key :size="16"/></el-icon> API Key</el-menu-item>
<el-menu-item index="/admin/logs"><el-icon><ScrollText :size="16"/></el-icon> 调用日志</el-menu-item>
<el-menu-item index="/admin/channels"><el-icon><Share2 :size="16"/></el-icon> 渠道管理</el-menu-item>
<el-menu-item index="/admin/settings"><el-icon><Settings :size="16"/></el-icon> 系统设置</el-menu-item>
<el-menu-item index="/" style="margin-top:20px"><el-icon><ArrowLeft :size="16"/></el-icon> 返回用户端</el-menu-item>
</el-menu>
</el-aside>
<el-container>
<el-header style="background:#fff;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;padding:0 28px;height:60px;position:sticky;top:0;z-index:99">
<span style="font-size:16px;font-weight:700">{{ pageTitle }}</span>
<div style="display:flex;align-items:center;gap:12px">
  <el-tag size="small" effect="plain" round>{{ roleLabel }}</el-tag>
  <span style="font-weight:500">{{ authStore.user?.username }}</span>
  <el-button size="small" text @click="$router.push('/change-password')">修改密码</el-button>
  <el-button size="small" text type="danger" @click="authStore.logout();$router.push('/login')">退出</el-button>
</div>
</el-header>
<el-main><router-view/></el-main>
</el-container>
</el-container>
</template>

<script setup>
import { computed } from 'vue';import { useRoute } from 'vue-router';import { useAuthStore } from '@/stores/auth'
import { LayoutDashboard, Users, ShoppingCart, Cpu, Percent, Key, ScrollText, Share2, Settings, ArrowLeft } from '@lucide/vue'
const route=useRoute(),authStore=useAuthStore()
const pageTitle=computed(()=>{const m={'/admin':'仪表盘','/admin/users':'用户管理','/admin/orders':'额度购买订单','/admin/models':'模型管理','/admin/pricing':'倍率规则','/admin/keys':'API Key 管理','/admin/logs':'调用日志','/admin/channels':'渠道管理','/admin/settings':'系统设置'};return m[route.path]||'管理后台'})
const roleLabel=computed(()=>{const m={admin:'超级管理员',operator:'运营',finance:'财务'};return m[authStore.user?.role]||''})
</script>
