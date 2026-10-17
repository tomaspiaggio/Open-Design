import type { Locator, Page } from 'playwright'

export const PRESENTATION_SLIDE_SELECTOR = '.slide, [data-od-slide]'

export function presentationHostStyles(html: string, mode: 'slides' | 'canvas') {
  if (mode === 'canvas') return 'html,body{width:100%;height:100%;overflow:auto}'
  const hasStage = /class=["'][^"']*\bstage\b[^"']*["']/.test(html)
  return `html,body{width:100%;height:100%;overflow:${hasStage ? 'hidden' : 'auto'}}`
}

export function presentationNavigationScript(selectedSlide: number) {
  return `<script id="opendesign-host-scaler">(()=>{
      const slides=[...document.querySelectorAll('${PRESENTATION_SLIDE_SELECTOR}')];
      let currentSlide=${selectedSlide > 0 ? selectedSlide : 1};
      const fit=()=>{const s=document.querySelector('.stage');if(!s)return;const w=s.offsetWidth||1280,h=s.offsetHeight||720;s.style.scale=String(Math.min(innerWidth/w,innerHeight/h))};
      const selectSlide=(index,behavior='instant')=>{const selected=Number(index);if(!Number.isInteger(selected)||selected<1||selected>slides.length)return;currentSlide=selected;slides.forEach((s,i)=>{const on=i===selected-1;s.classList.toggle('active',on);s.setAttribute('aria-hidden',String(!on))});if(!document.querySelector('.stage'))slides[selected-1].scrollIntoView({behavior,block:'center'});const counter=document.getElementById('counter');if(counter)counter.textContent=String(selected).padStart(2,'0')+' / '+String(slides.length);const progress=document.getElementById('progress');if(progress)progress.style.width=(selected/slides.length*100)+'%'};
      selectSlide(${selectedSlide});
      addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='opendesign-select-slide')return;selectSlide(event.data.index)});
      document.addEventListener('keydown',event=>{if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]'))return;let next=currentSlide;if(['ArrowRight','ArrowDown','PageDown',' ','Enter'].includes(event.key))next=Math.min(slides.length,currentSlide+1);else if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key))next=Math.max(1,currentSlide-1);else if(event.key==='Home')next=1;else if(event.key==='End')next=slides.length;else return;if(next===currentSlide)return;event.preventDefault();event.stopImmediatePropagation();selectSlide(next,'smooth');parent.postMessage({type:'opendesign-slide-changed',slide:next},'*')},true);
      document.addEventListener('click',event=>{const el=event.target.closest('.slide h1,.slide h2,.slide h3,.slide p,.slide button,.slide a,.slide [data-od-id]');if(!el)return;const section=el.closest('${PRESENTATION_SLIDE_SELECTOR}');const index=section?slides.indexOf(section)+1:${selectedSlide || 1};const label=(el.innerText||el.getAttribute('aria-label')||el.getAttribute('data-od-id')||el.tagName).replace(/\\s+/g,' ').trim().slice(0,140);parent.postMessage({type:'opendesign-target',slide:index,label,tag:el.tagName.toLowerCase()},'*')},true);
      addEventListener('resize',fit);addEventListener('load',fit);requestAnimationFrame(fit);
    })();</script>`
}

export async function presentationThumbnailTarget(page: Page, index: number): Promise<Locator> {
  const slides = page.locator(PRESENTATION_SLIDE_SELECTOR)
  if (await slides.count() >= index) return slides.nth(index - 1)
  const stage = page.locator('.stage').first()
  return await stage.count() ? stage : page.locator('body')
}
