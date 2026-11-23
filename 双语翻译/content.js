(() => {
  if (window.__researchTranslate) return;
  window.__researchTranslate = true;
  let active = false, observer, mutation, timer, inflight = 0, generation = 0;
  let queue = [], queued = new WeakSet(), done = new WeakMap(), failureCount=0;
  const recentTranslations=new WeakMap();let recentUntil=0,currentSignature=null;
  const selector = 'p,li,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6,dt,dd,div,section,article,[role="paragraph"],span[id^="abspara"]';
  const textBlocks = 'div,section,article,[role="paragraph"]';
  const skip = 'script,style,noscript,code,pre,textarea,input,select,button,svg,math,[contenteditable],.rt-translation,[translate="no"]';
  function eligible(el) {
    if (el.closest(skip) || el.querySelector('p,li,blockquote,td,th,h1,h2,h3,h4,h5,h6') ||
        el.querySelector('canvas,table,video,iframe,button,input,textarea,[contenteditable]')) return false;
    const text = el.innerText?.trim();
    if (!text || text.length < 20 || text.length > 10000 || !/[a-zA-Z]{3}/.test(text) || !el.getClientRects().length) return false;
    if (el.matches(textBlocks) && Array.from(el.querySelectorAll(textBlocks)).some(child => {
      const childText = child.innerText?.trim();
      return childText && childText.length >= 20 && /[a-zA-Z]{3}/.test(childText) && child.getClientRects().length > 0;
    })) return false;
    return true;
  }
  function extract(el) {
    const clone=el.cloneNode(true), map=[];if(/⟦RT\d+⟧/.test(el.innerText))return null;
    for(const n of Array.from(clone.querySelectorAll('span.formula,span.math,.MathJax,.katex,math,svg'))){
      if(!n.isConnected && !clone.contains(n))continue;
      if(n.parentElement?.closest('span.formula,span.math,.MathJax,.katex,math,svg'))continue;
      const label=(n.getAttribute('alttext')||n.getAttribute('aria-label')||n.querySelector('img[alt]')?.getAttribute('alt')||n.querySelector('annotation[encoding="application/x-tex"]')?.textContent||n.textContent||'').trim();
      if(!label)return null;
      const token=`⟦RT${map.length}⟧`;map.push({token,label});n.replaceWith(document.createTextNode(token));
    }
    return {text:map.length?clone.textContent.replace(/\s+/g,' ').trim():el.innerText.trim(),map};
  }
  function restoreTokens(text,map){for(const {token,label} of map){if(text.split(token).length!==2)return null;text=text.replace(token,label)}return text}
  function register(root) {
    if (!active || (root.nodeType !== 1 && root.nodeType !== 9)) return;
    if (root.nodeType === 1 && root.closest('.rt-translation')) return;
    if (root.nodeType === 1 && root.matches(selector) && eligible(root) && !done.has(root)) observer.observe(root);
    root.querySelectorAll(selector).forEach(el => { if (eligible(el) && !done.has(el)) observer.observe(el); });
  }
  function add(el) {
    if (!active || queued.has(el) || done.has(el) || !eligible(el)) return;
    queued.add(el); queue.push(el); schedule();
  }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = null; pump(); }, 100); }
  const ports = new Set();
  function distance(el) { const r=el.getBoundingClientRect(); return r.bottom>=0 && r.top<=innerHeight ? 0 : Math.min(Math.abs(r.bottom),Math.abs(r.top-innerHeight)); }
  function pump() {
    while (active && inflight < 2 && queue.length) {
      queue.sort((a,b) => distance(a)-distance(b) || a.getBoundingClientRect().top-b.getBoundingClientRect().top);
      const el=queue.shift(); if(!el.isConnected || !eligible(el) || done.has(el)) continue;
      const epoch=generation,original=el.innerText.trim(),saved=recentTranslations.get(el);if(currentSignature&&Date.now()<recentUntil&&saved&&saved.original===original&&saved.signature===currentSignature){const div=document.createElement('div');div.className='rt-translation';div.textContent=saved.text;el.appendChild(div);done.set(el,div);queued.delete(el);continue}const snapshot=extract(el);if(!snapshot||!snapshot.text){queued.delete(el);continue}const source=snapshot.text; let div=null, completed=false,buffer=''; inflight++;
      const port=chrome.runtime.connect({name:'translate-stream'}); ports.add(port);
      function close(){if(completed)return;completed=true;ports.delete(port);try{port.disconnect()}catch{}inflight--;if(active&&queue.length)schedule()}
      port.onMessage.addListener(msg=>{
        if(!active||epoch!==generation||!el.isConnected){close();return}
        if(msg.type==='error'){queued.delete(el);div?.remove();done.delete(el);close();showParagraphError('有段落翻译失败：'+msg.error);return}
        if(snapshot.map.length&&msg.type==='delta'){buffer+=msg.text;return}
        if(snapshot.map.length&&msg.type==='done'){const restored=restoreTokens(msg.text,snapshot.map);if(restored===null){queued.delete(el);close();showError('部分公式段落未能安全还原，原文已保留。');return}msg={...msg,text:restored}}
        if(!div && (msg.type==='delta'||msg.type==='done')){if(el.innerText.trim()!==original){queued.delete(el);if(eligible(el))observer.observe(el);close();return}div=document.createElement('div');div.className='rt-translation';el.appendChild(div);done.set(el,div)}
        if(msg.type==='delta')div.textContent+=msg.text;
        if(msg.type==='done'){div.textContent=msg.text;if(currentSignature)recentTranslations.set(el,{original,text:msg.text,signature:currentSignature});queued.delete(el);close()}
      });
      port.onDisconnect.addListener(()=>{if(!completed){close();if(active&&epoch===generation){queued.delete(el);div?.remove();done.delete(el);showParagraphError('有段落的翻译连接中断')}}});
      port.postMessage({text:source});
    }
  }
  function showParagraphError(message){failureCount++;if(failureCount===1)showError(message+'；其他段落会继续翻译。')}
  function showError(message) { const note = document.createElement('div'); note.className = 'rt-notice'; note.textContent = '研译：' + message; document.documentElement.appendChild(note); setTimeout(() => note.remove(), 8000); }
  function start() {
    active = true; failureCount=0; generation++;
    observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { observer.unobserve(e.target); add(e.target); } }), {rootMargin:'1000px 0px'});
    const epoch=generation;currentSignature=null;
    const ready=chrome.runtime.sendMessage?chrome.runtime.sendMessage({type:'page-cache-signature'}).catch(()=>null):Promise.resolve(null);
    Promise.resolve(ready).then(value=>{if(active&&generation===epoch){currentSignature=value?.signature||null;register(document)}});
    mutation = new MutationObserver(records => {
      const changed = new Set();
      for (const r of records) {
        if (r.target.nodeType === 1 && r.target.closest('.rt-translation')) continue;
        if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.classList.contains('rt-translation'))) continue;
        for (const n of r.addedNodes) if (n.nodeType === 1 && !n.classList.contains('rt-translation')) register(n);
        const parent = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const block = parent?.closest(selector);
        if (block && done.has(block)) changed.add(block);
      }
      for (const block of changed) { const translation = done.get(block); translation?.remove(); done.delete(block); queued.delete(block); if (eligible(block)) observer.observe(block); }
    });
    mutation.observe(document.documentElement, {childList:true, characterData:true, subtree:true});
  }
  function stop() {
    active = false; recentUntil=Date.now()+5*60*1000; generation++; clearTimeout(timer); timer = null; queue = []; queued = new WeakSet();
    observer?.disconnect(); mutation?.disconnect(); for(const port of ports) port.disconnect(); ports.clear(); document.querySelectorAll('.rt-translation').forEach(el => el.remove()); done = new WeakMap();
  }
  function toggle(){active ? stop() : start(); updateBall()}
  let updateBall=()=>{};
  if(window===window.top && chrome.runtime.getURL){
    const size=36, margin=6;
    const host=document.createElement('div');host.className='rt-ball-host';const root=host.attachShadow({mode:'closed'});
    for(const [name,value] of Object.entries({position:'fixed','z-index':'2147483647',right:margin+'px',top:'45%',width:size+'px',height:size+'px','touch-action':'none',opacity:'1',transition:'opacity 220ms ease','pointer-events':'auto',overflow:'visible'}))host.style.setProperty(name,value,'important');
    const style=document.createElement('style');style.textContent='button{display:block;box-sizing:border-box;width:36px;height:36px;border:1px solid white;border-radius:50%;background:#034e49;box-shadow:0 2px 8px #003c394d;cursor:grab;padding:0;overflow:hidden}button:active{cursor:grabbing}img{width:114%;height:114%;margin:-7%;object-fit:cover;pointer-events:none}button.on{outline:1px solid #45c4aa}.menu{position:absolute;top:44px;width:168px;padding:12px;background:#fff;border:1px solid #dbeae7;border-radius:12px;box-shadow:0 8px 28px #103f3933;font:13px/1.5 Segoe UI,Microsoft YaHei,sans-serif;color:#1b4740;display:none;box-sizing:border-box}.menu.show{display:block}.menu.right{left:0}.menu.left{right:0}.menu label{display:block;color:#64847c;font-size:11px;margin-bottom:5px}.menu select{width:100%;padding:7px;border:1px solid #d7e9e4;border-radius:7px;color:#194a40;background:#fff;font:inherit}.menu .model-label{display:block;color:#64847c;font-size:11px;margin:10px 0 5px}.menu .model-value{padding:7px 9px;border:1px solid #d7e9e4;border-radius:7px;background:#f8fbfa;color:#194a40;overflow-wrap:anywhere}.menu .settings{display:block;width:100%;height:auto;border:0;border-radius:7px;background:#edf6f3;box-shadow:none;color:#126a5c;text-align:left;font:inherit;padding:8px;margin-top:8px;cursor:pointer}';
    const button=document.createElement('button');button.setAttribute('aria-label','翻译或还原页面');const image=document.createElement('img');image.src=chrome.runtime.getURL('assets/brand.png');image.alt='';button.append(image);const menu=document.createElement('div');menu.className='menu left';const label=document.createElement('label');label.textContent='目标语言';const language=document.createElement('select');language.setAttribute('aria-label','目标翻译语言');for(const [value,name] of [['简体中文','简体中文'],['繁体中文','繁體中文'],['en','English'],['ja','日本語'],['ko','한국어'],['fr','Français'],['de','Deutsch'],['es','Español'],['ru','Русский']]){const option=document.createElement('option');option.value=value;option.textContent=name;language.append(option)}label.append(language);const settings=document.createElement('button');settings.className='settings';settings.textContent='模型与翻译设置  ↗';settings.type='button';settings.addEventListener('click',()=>chrome.runtime.sendMessage({type:'open-options'}));const modelLabel=document.createElement('span');modelLabel.className='model-label';modelLabel.textContent='当前翻译模型';const modelValue=document.createElement('div');modelValue.className='model-value';modelValue.textContent='读取中…';menu.append(label,modelLabel,modelValue,settings);root.append(style,button,menu);document.documentElement.append(host);updateBall=()=>button.classList.toggle('on',active);
    let moved=false,down=null,idleTimer,hover=false;
    function wake(){host.style.setProperty('opacity','1','important');clearTimeout(idleTimer);if(!hover&&!down)idleTimer=setTimeout(()=>host.style.setProperty('opacity','.3','important'),3000)}
    let hideTimer,showTimer;function showMenu(){clearTimeout(hideTimer);hover=true;wake();if(!down){menu.classList.toggle('right',host.getBoundingClientRect().left+size/2<innerWidth/2);menu.classList.toggle('left',!menu.classList.contains('right'));menu.classList.add('show');menu.style.top='44px';if(menu.getBoundingClientRect().bottom>innerHeight-6)menu.style.top=Math.min(0,innerHeight-host.getBoundingClientRect().top-menu.offsetHeight-6)+'px';chrome.runtime.sendMessage({type:'get-target'}).then(r=>{if(r?.target){const aliases={'zh-CN':'简体中文','zh-Hans':'简体中文','zh-TW':'繁体中文','zh-Hant':'繁体中文','英语':'en','日语':'ja','韩语':'ko'};language.value=aliases[r.target]||r.target}modelValue.textContent=r?.kind==='edge'?'微软翻译':(r?.model?.split('/').pop()||'未设置')}).catch(()=>{modelValue.textContent='读取失败'})}}function scheduleMenu(){clearTimeout(showTimer);showTimer=setTimeout(()=>{if(hover&&!down)showMenu()},1000)}host.addEventListener('pointerenter',()=>{clearTimeout(hideTimer);hover=true;wake();if(!menu.classList.contains('show'))scheduleMenu()});host.addEventListener('pointerleave',()=>{hover=false;clearTimeout(showTimer);hideTimer=setTimeout(()=>{menu.classList.remove('show');wake()},220)});button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();showMenu();language.focus()}});language.addEventListener('change',()=>{chrome.runtime.sendMessage({type:'set-target',target:language.value}).catch(()=>{})});
    function place(x,y){const maxX=Math.max(0,innerWidth-size-margin),maxY=Math.max(0,innerHeight-size-margin);host.style.setProperty('left',Math.max(0,Math.min(maxX,x))+'px','important');host.style.setProperty('top',Math.max(0,Math.min(maxY,y))+'px','important');host.style.setProperty('right','auto','important')}
    button.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.clientX,y:e.clientY,rect:host.getBoundingClientRect()};moved=false;clearTimeout(showTimer);menu.classList.remove('show');wake();button.setPointerCapture(e.pointerId)});
    button.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;if(Math.hypot(dx,dy)>4)moved=true;if(moved)place(down.rect.left+dx,down.rect.top+dy)});
    button.addEventListener('pointerup',e=>{if(!down)return;if(moved){const rect=host.getBoundingClientRect();place(rect.left+size/2<innerWidth/2?margin:innerWidth-size-margin,rect.top)}else toggle();down=null;wake();if(hover)scheduleMenu()});
    button.addEventListener('pointercancel',()=>{down=null;wake()});window.addEventListener('resize',()=>{const r=host.getBoundingClientRect();place(r.left+size/2<innerWidth/2?margin:innerWidth-size-margin,r.top)});wake();

  }
  chrome.runtime.onMessage.addListener((m,s,reply) => { if (m.type === 'toggle') { toggle(); reply({active}); } if (m.type === 'status') reply({active}); });
})();


