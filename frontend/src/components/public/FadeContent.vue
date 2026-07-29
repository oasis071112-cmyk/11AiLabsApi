<script setup>
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Adapted from the official Vue Bits port of React Bits FadeContent.
// The reduced-motion branch is IonAiLabs-specific.
gsap.registerPlugin(ScrollTrigger)

const props = defineProps({
  duration: { type: Number, default: 0.5 },
  delay: { type: Number, default: 0 },
  threshold: { type: Number, default: 0.12 },
  offsetY: { type: Number, default: 18 }
})

const fadeRef = ref(null)
let timeline = null
let trigger = null

onMounted(() => {
  const element = fadeRef.value
  if (!element) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.set(element, { autoAlpha: 1, y: 0, clearProps: 'transform' })
    return
  }

  gsap.set(element, {
    autoAlpha: 0,
    y: props.offsetY,
    willChange: 'opacity, transform'
  })

  timeline = gsap.timeline({ paused: true, delay: props.delay })
  timeline.to(element, {
    autoAlpha: 1,
    y: 0,
    duration: props.duration,
    ease: 'power2.out',
    clearProps: 'willChange'
  })

  trigger = ScrollTrigger.create({
    trigger: element,
    start: `top ${(1 - props.threshold) * 100}%`,
    once: true,
    onEnter: () => timeline?.play()
  })
})

onBeforeUnmount(() => {
  trigger?.kill()
  timeline?.kill()
  if (fadeRef.value) gsap.killTweensOf(fadeRef.value)
})
</script>

<template>
  <div ref="fadeRef">
    <slot />
  </div>
</template>
