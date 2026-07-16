import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint}px)`
  const isMobile = ref(typeof window !== 'undefined' && window.matchMedia(query).matches)
  let mediaQuery

  function update(event) {
    isMobile.value = event.matches
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(query)
    isMobile.value = mediaQuery.matches
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', update)
    else mediaQuery.addListener?.(update)
  })

  onBeforeUnmount(() => {
    if (mediaQuery?.removeEventListener) mediaQuery.removeEventListener('change', update)
    else mediaQuery?.removeListener?.(update)
  })
  return isMobile
}
