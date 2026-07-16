<template>
  <el-config-provider :locale="zhCn">
    <router-view/>
  </el-config-provider>
</template>

<script setup>
import { onMounted } from 'vue'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
onMounted(() => authStore.checkAuth())
</script>

<style>body{margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif}</style>
