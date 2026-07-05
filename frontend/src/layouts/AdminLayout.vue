<template>
<el-container style="min-height:100vh">
<el-aside width="220px" style="background:#1d1e2c;overflow-y:auto">
<div style="padding:20px;text-align:center;color:#fff;font-size:18px;font-weight:bold;border-bottom:1px solid #333">⚙️ 管理后台</div>
<el-menu :default-active="route.path" background-color="#1d1e2c" text-color="#bfcbd9" active-text-color="#409eff" router>
<el-menu-item index="/admin"><el-icon><DataAnalysis/></el-icon> 仪表盘</el-menu-item>
<el-menu-item index="/admin/users"><el-icon><User/></el-icon> 用户管理</el-menu-item>
<el-menu-item index="/admin/orders"><el-icon><Tickets/></el-icon> 额度购买订单</el-menu-item>
<el-menu-item index="/admin/models"><el-icon><Cpu/></el-icon> 模型管理</el-menu-item>
<el-menu-item index="/admin/pricing"><el-icon><PriceTag/></el-icon> 倍率规则</el-menu-item>
<el-menu-item index="/admin/keys"><el-icon><Key/></el-icon> API Key 管理</el-menu-item>
<el-menu-item index="/admin/logs"><el-icon><Document/></el-icon> 调用日志</el-menu-item>
<el-menu-item index="/admin/channels"><el-icon><Connection/></el-icon> 渠道管理</el-menu-item>
<el-menu-item index="/admin/settings"><el-icon><Setting/></el-icon> 系统设置</el-menu-item>
<el-menu-item index="/" style="margin-top:20px"><el-icon><Back/></el-icon> 返回用户端</el-menu-item>
</el-menu>
</el-aside>
<el-container>
<el-header style="background:#fff;border-bottom:1px solid #e4e7ed;display:flex;justify-content:space-between;align-items:center;padding:0 24px">
<span style="font-size:16px;font-weight:600">{{ pageTitle }}</span>
<div style="display:flex;align-items:center;gap:8px">
  <span>{{ authStore.user?.username }} ({{ roleLabel }})</span>
  <el-button size="small" @click="$router.push('/change-password')">修改密码</el-button>
  <el-button size="small" @click="authStore.logout();$router.push('/login')">退出</el-button>
</div>
</el-header>
<el-main style="background:#f5f7fa"><router-view/></el-main>
</el-container>
</el-container>
</template>

<script setup>
import { computed } from 'vue';import { useRoute } from 'vue-router';import { useAuthStore } from '@/stores/auth'
const route=useRoute(),authStore=useAuthStore()
const pageTitle=computed(()=>{const m={'/admin':'仪表盘','/admin/users':'用户管理','/admin/orders':'额度购买订单','/admin/models':'模型管理','/admin/pricing':'倍率规则','/admin/keys':'API Key 管理','/admin/logs':'调用日志','/admin/channels':'渠道管理','/admin/settings':'系统设置'};return m[route.path]||'管理后台'})
const roleLabel=computed(()=>{const m={admin:'超级管理员',operator:'运营',finance:'财务'};return m[authStore.user?.role]||''})
</script>