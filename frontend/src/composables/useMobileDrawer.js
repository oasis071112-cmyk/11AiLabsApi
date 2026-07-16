import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMobile } from './useMobile'

export function useMobileDrawer() {
  const isMobile = useMobile()
  const drawerOpen = ref(false)
  const drawerRef = ref(null)
  const triggerRef = ref(null)
  let opener

  function openDrawer(event) {
    opener = event?.currentTarget || document.activeElement
    drawerOpen.value = true
  }
  function closeDrawer() { drawerOpen.value = false }
  function onKeydown(event) {
    if (!drawerOpen.value) return
    if (event.key === 'Escape') return closeDrawer()
    if (event.key !== 'Tab') return
    const focusable = [...(drawerRef.value?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
      .filter(element => !element.hasAttribute('inert'))
    if (!focusable.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !drawerRef.value.contains(document.activeElement))) {
      event.preventDefault();last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !drawerRef.value.contains(document.activeElement))) {
      event.preventDefault();first.focus()
    }
  }

  watch(drawerOpen, async open => {
    if (!isMobile.value) return
    await nextTick()
    if (open) drawerRef.value?.querySelector('button, a')?.focus()
    else (opener || triggerRef.value)?.focus()
  })

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { isMobile, drawerOpen, drawerRef, triggerRef, openDrawer, closeDrawer }
}
