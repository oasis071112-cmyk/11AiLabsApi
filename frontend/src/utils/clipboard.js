export async function copyText(text) {
  const value=String(text||'')
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea=document.createElement('textarea')
  textarea.value=value
  textarea.setAttribute('readonly','')
  textarea.style.position='fixed'
  textarea.style.opacity='0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied=document.execCommand('copy')
  textarea.remove()
  if(!copied)throw new Error('复制失败')
}
