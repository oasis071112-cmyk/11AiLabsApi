<template><el-empty v-if="!props.data.length" class="admin-trend-empty" description="暂无数据" :image-size="52" :style="chartStyle"/><div v-else ref="chartElement" class="admin-trend-chart" :style="chartStyle"></div></template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

const props=defineProps({data:{type:Array,default:()=>[]},successLabel:{type:String,default:'成功'},failureLabel:{type:String,default:'失败'},height:{type:Number,default:300}})
const chartElement=ref(null)
let chart
const chartStyle=computed(()=>({height:`${props.height}px`}))

async function draw(){await nextTick();if(!chartElement.value)return;if(!chart)chart=echarts.init(chartElement.value);if(!props.data.length){chart.clear();return}chart.setOption({tooltip:{trigger:'axis'},legend:{top:6,data:[props.successLabel,props.failureLabel]},grid:{left:32,right:16,top:48,bottom:26,containLabel:true},xAxis:{type:'category',data:props.data.map(item=>item.date)},yAxis:{type:'value'},series:[{name:props.successLabel,type:'line',data:props.data.map(item=>item.success_calls),smooth:true,color:'#67c23a'},{name:props.failureLabel,type:'line',data:props.data.map(item=>item.failed_calls),smooth:true,color:'#f56c6c'}]},true)}
function resize(){chart?.resize()}
watch(()=>[props.data,props.successLabel,props.failureLabel,props.height],draw,{deep:true})
onMounted(()=>{draw();window.addEventListener('resize',resize)})
onBeforeUnmount(()=>{window.removeEventListener('resize',resize);chart?.dispose()})
</script>

<style scoped>.admin-trend-chart{height:300px;width:100%}.admin-trend-empty{height:300px;display:flex;align-items:center;justify-content:center}</style>
