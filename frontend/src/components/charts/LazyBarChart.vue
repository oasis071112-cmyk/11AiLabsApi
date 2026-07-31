<template>
  <Bar :data="data" :options="options"/>
</template>

<script setup>
import { Bar } from 'vue-chartjs'
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale, Tooltip } from 'chart.js'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

defineProps({
  data: { type: Object, required: true },
  options: { type: Object, required: true },
})
</script>
