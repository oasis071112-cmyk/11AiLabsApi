import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useMobile(breakpoint = 768) {
  const isMobile = ref(false)
  let mediaQuery

  function update(event) {
    isMobile.value = event.matches
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`)
    isMobile.value = mediaQuery.matches
    mediaQuery.addEventListener?.('change', update)
  })

  onBeforeUnmount(() => mediaQuery?.removeEventListener?.('change', update))
  return isMobile
}
