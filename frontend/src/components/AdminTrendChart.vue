<template><div ref="chartElement" class="admin-trend-chart"></div></template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

const props=defineProps({data:{type:Array,default:()=>[]}})
const chartElement=ref(null)
let chart

async function draw(){await nextTick();if(!chartElement.value||!props.data.length)return;chart?.dispose();chart=echarts.init(chartElement.value);chart.setOption({tooltip:{trigger:'axis'},legend:{data:['成功','失败']},grid:{left:32,right:16,top:42,bottom:26,containLabel:true},xAxis:{type:'category',data:props.data.map(item=>item.date)},yAxis:{type:'value'},series:[{name:'成功',type:'line',data:props.data.map(item=>item.success_calls),smooth:true,color:'#67c23a'},{name:'失败',type:'line',data:props.data.map(item=>item.failed_calls),smooth:true,color:'#f56c6c'}]})}
function resize(){chart?.resize()}
watch(()=>props.data,draw,{deep:true})
onMounted(()=>{draw();window.addEventListener('resize',resize)})
onBeforeUnmount(()=>{window.removeEventListener('resize',resize);chart?.dispose()})
</script>

<style scoped>.admin-trend-chart{height:300px;width:100%}</style>
