<template>
  <Doughnut :data="data" :options="options"/>
</template>

<script setup>
import { Doughnut } from 'vue-chartjs'
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js'

ChartJS.register(ArcElement, Legend, Tooltip)

defineProps({
  data: { type: Object, required: true },
  options: { type: Object, required: true },
})
</script>
