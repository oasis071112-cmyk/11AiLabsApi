<template>
<div style="height:100vh;display:flex;background:var(--bg-page);padding:12px;gap:12px;overflow:hidden">
<!-- 侧栏 — 深色独立圆角卡片 -->
<aside style="width:220px;background:#111827;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">

  <!-- Logo -->
  <div style="padding:20px 20px 16px;text-align:center;border-bottom:1px solid #1f2937">
    <img src="/logo-white.svg" alt="11AiLabs" style="height:26px;margin-bottom:6px"/>
    <div style="font-size:14px;font-weight:700;color:#fff;letter-spacing:-0.3px">11AiLabs</div>
  </div>

  <!-- 菜单 -->
  <el-menu :default-active="route.path" background-color="#111827" text-color="#9ca3af" active-text-color="#C5D5C0" router style="border-right:none;flex:1">
    <el-menu-item index="/admin"><el-icon><LayoutDashboard :size="16"/></el-icon>仪表盘</el-menu-item>
    <el-menu-item index="/admin/users"><el-icon><Users :size="16"/></el-icon>用户管理</el-menu-item>
    <el-menu-item index="/admin/orders"><el-icon><ShoppingCart :size="16"/></el-icon>额度订单</el-menu-item>
    <el-menu-item index="/admin/models"><el-icon><Cpu :size="16"/></el-icon>模型管理</el-menu-item>
    <el-menu-item index="/admin/pricing"><el-icon><Percent :size="16"/></el-icon>倍率规则</el-menu-item>
    <el-menu-item index="/admin/keys"><el-icon><Key :size="16"/></el-icon>API Key</el-menu-item>
    <el-menu-item index="/admin/logs"><el-icon><ScrollText :size="16"/></el-icon>调用日志</el-menu-item>
    <el-menu-item index="/admin/channels"><el-icon><Share2 :size="16"/></el-icon>渠道管理</el-menu-item>
    <el-menu-item index="/admin/settings"><el-icon><Settings :size="16"/></el-icon>系统设置</el-menu-item>
  </el-menu>
</aside>

<!-- 右侧 -->
<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  <!-- 顶栏 -->
  <header style="background:#fff;border:1px solid var(--border);border-radius:12px;display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:52px;margin-bottom:12px;flex-shrink:0;box-shadow:var(--shadow-sm)">
    <span style="font-size:15px;font-weight:700;color:#000">{{ pageTitle }}</span>
    <div style="display:flex;align-items:center;gap:14px">
      <span style="font-size:12px;color:var(--text-muted);font-weight:500">{{ roleLabel }}</span>
      <span style="font-size:13px;font-weight:500;color:#000">{{ authStore.user?.username }}</span>
      <el-button size="small" text style="color:var(--text-muted)" @click="authStore.logout();$router.push('/login')">退出</el-button>
    </div>
  </header>
  <!-- 内容 -->
  <main style="flex:1;min-width:0;overflow:auto"><router-view/></main>
</div>
</div>
</template>

<script setup>
import { computed } from 'vue';import { useRoute } from 'vue-router';import { useAuthStore } from '@/stores/auth'
import { LayoutDashboard, Users, ShoppingCart, Cpu, Percent, Key, ScrollText, Share2, Settings } from '@lucide/vue'
const route=useRoute(),authStore=useAuthStore()
const pageTitle=computed(()=>{const m={'/admin':'仪表盘','/admin/users':'用户管理','/admin/orders':'额度购买订单','/admin/models':'模型管理','/admin/pricing':'倍率规则','/admin/keys':'API Key 管理','/admin/logs':'调用日志','/admin/channels':'渠道管理','/admin/settings':'系统设置'};return m[route.path]||'管理后台'})
const roleLabel=computed(()=>{const m={admin:'超级管理员',operator:'运营',finance:'财务'};return m[authStore.user?.role]||''})
</script>
