<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Adapted from the official Vue Bits port of React Bits FadeContent.
// The reduced-motion branch is IonAiLabs-specific.

const props = defineProps({
  duration: { type: Number, default: 0.5 },
  delay: { type: Number, default: 0 },
  threshold: { type: Number, default: 0.12 },
  offsetY: { type: Number, default: 18 }
})

const fadeRef = ref(null)
let observer = null
let animation = null
let idleHandle = null
let idleFallback = null

onMounted(() => {
  const element = fadeRef.value
  if (!element) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.style.opacity = '1'
    element.style.visibility = 'visible'
    element.style.transform = ''
    return
  }

  element.style.opacity = '0'
  element.style.visibility = 'hidden'
  element.style.transform = `translate3d(0, ${props.offsetY}px, 0)`
  element.style.willChange = 'opacity, transform'

  const reveal = () => {
    element.style.visibility = 'visible'
    animation = element.animate([
      { opacity: 0, transform: `translate3d(0, ${props.offsetY}px, 0)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ], {
      duration: props.duration * 1000,
      delay: props.delay * 1000,
      easing: 'cubic-bezier(.25,.46,.45,.94)',
      fill: 'forwards',
    })
    animation.addEventListener('finish',()=>{
      element.style.opacity = '1'
      element.style.visibility = 'visible'
      element.style.transform = ''
      element.style.willChange = ''
    },{once:true})
  }
  const initialize = () => {
    if (!('IntersectionObserver' in window) || !('animate' in element)) {
      element.style.opacity = '1'
      element.style.visibility = 'visible'
      element.style.transform = ''
      element.style.willChange = ''
      return
    }
    observer = new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return
      observer?.disconnect()
      reveal()
    },{threshold:props.threshold})
    observer.observe(element)
  }

  if ('requestIdleCallback' in window) idleHandle = window.requestIdleCallback(initialize, { timeout: 100 })
  else idleFallback = window.setTimeout(initialize, 32)
})

onBeforeUnmount(() => {
  if (idleHandle!==null) window.cancelIdleCallback(idleHandle)
  if (idleFallback!==null) window.clearTimeout(idleFallback)
  observer?.disconnect()
  animation?.cancel()
})
</script>

<template>
  <div ref="fadeRef">
    <slot />
  </div>
</template>
