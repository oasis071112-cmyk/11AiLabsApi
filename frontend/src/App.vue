<template><router-view/></template>
<script setup>import { onMounted } from 'vue';import { useAuthStore } from '@/stores/auth';const authStore=useAuthStore();onMounted(()=>authStore.checkAuth())</script>
<style>body{margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif}</style>
