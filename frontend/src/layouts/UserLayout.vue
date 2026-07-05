<template>
<el-container style="min-height:100vh">
<el-header style="background:#fff;border-bottom:1px solid #e4e7ed;display:flex;align-items:center;justify-content:space-between;padding:0 24px;z-index:100">
<div style="display:flex;align-items:center;gap:40px">
<h2 style="color:#409eff;cursor:pointer" @click="$router.push('/')">🚀 {{ appStore.platformInfo.platform_name }}</h2>
<el-menu mode="horizontal" :default-active="route.path" @select="(i)=>$router.push(i)" :ellipsis="false">
<el-menu-item index="/">控制台</el-menu-item>
<el-menu-item index="/wallet">钱包</el-menu-item>
<el-menu-item index="/keys">API Key</el-menu-item>
<el-menu-item index="/models">模型列表</el-menu-item>
<el-menu-item index="/logs">调用记录</el-menu-item>
<el-menu-item index="/docs">文档</el-menu-item>
</el-menu>
</div>
<div style="display:flex;align-items:center;gap:12px">
<el-tag type="success" effect="plain">💰 {{ walletBalance }}</el-tag>
<el-dropdown @command="handleCmd">
<span style="cursor:pointer;display:flex;align-items:center;gap:4px"><el-avatar :size="32" icon="UserFilled"/><span>{{ authStore.user?.username }}</span><el-icon><ArrowDown/></el-icon></span>
<template #dropdown><el-dropdown-menu>
<el-dropdown-item command="wallet">钱包</el-dropdown-item>
<el-dropdown-item command="changePassword">修改密码</el-dropdown-item>
<el-dropdown-item v-if="authStore.isAdmin" command="admin">管理后台</el-dropdown-item>
<el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
</el-dropdown-menu></template>
</el-dropdown>
</div>
</el-header>
<el-main><router-view/></el-main>
</el-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import api from '@/api'
const route=useRoute(),router=useRouter(),authStore=useAuthStore(),appStore=useAppStore()
const walletBalance=ref('0.00')
onMounted(async()=>{appStore.fetchPlatformInfo();try{const r=await api.get('/api/user/wallet');const w=r.data;walletBalance.value=(w.recharge_balance+w.gift_balance).toFixed(2)}catch(e){}})
function handleCmd(c){if(c==='logout'){authStore.logout();router.push('/login')}else if(c==='admin')router.push('/admin');else if(c==='wallet')router.push('/wallet');else if(c==='changePassword')router.push('/change-password')}
</script>
