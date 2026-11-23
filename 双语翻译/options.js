const defaults={endpoint:'https://api.openai.com/v1/chat/completions',model:'',key:'',target:'简体中文',prompt:'你是电化学和材料科学领域的专业学术翻译。准确翻译，保留化学式、单位、符号、引文编号和术语；不要解释或遗漏。'};
const fields=['name','kind','protocol','addressType','endpoint','model','key','target','prompt'],builtin='builtin-microsoft';let profiles=[],selected='';const $=id=>document.getElementById(id),status=$('status');
function updateFields(){const edge=$('kind').value==='edge',gateway=$('kind').value==='gateway';$('modelFields').hidden=edge;$('edgeNote').hidden=!edge;$('kind').disabled=selected===builtin;$('name').readOnly=selected===builtin;$('remove').disabled=selected===builtin;$('directProtocol').hidden=gateway;$('gatewayProtocol').hidden=!gateway;$('addressTypeField').hidden=!gateway;$('directTools').hidden=gateway;$('apiKeyField').hidden=gateway;$('key').disabled=gateway;$('modelKeyFields').classList.toggle('single-field',gateway);$('endpointLabel').textContent=gateway?'接口地址':'Base URL';$('endpoint').placeholder=gateway?'http://127.0.0.0:0000/v1/chat/completions':'https://api.example.com/v1';$('endpointHint').textContent=gateway?'按网关提供的协议填写基础地址或完整接口地址。网关需要在使用时保持运行，此模式不发送 API Key。需要密钥认证时，请选择“大模型接口”并添加自定义供应商。':'填写服务商的 Base URL，研译会按所选协议生成请求地址。检测协议会发送少量测试请求。';for(const button of $('protocolTabs').children)button.setAttribute('aria-pressed',String(button.dataset.protocol===$('protocol').value));}
function render(){const select=$('provider');select.replaceChildren();for(const p of profiles){const option=document.createElement('option');option.value=p.id;option.textContent=p.name||'未命名供应商';select.appendChild(option)}select.value=selected;const profile=profiles.find(p=>p.id===selected);if(profile)for(const field of fields){let value=profile[field]??(field==='kind'?'llm':field==='protocol'?'openai':'');if(field==='target'){const aliases={'zh-CN':'简体中文','zh-Hans':'简体中文','zh-TW':'繁体中文','zh-Hant':'繁体中文','英语':'en','英文':'en','日语':'ja','韩语':'ko'};value=aliases[value]||value;if(value&&!Array.from($('target').options).some(o=>o.value===value))$('target').add(new Option(value,value));}$(field).value=value}updateFields()}
function endpointFor(p){return ProviderAPI.endpoint(p)}
function formProfile(){const p={id:selected,connectionVersion:1};for(const f of fields)p[f]=$(f).value.trim();if(p.kind==='llm')p.addressType='base';if(p.kind==='gateway')p.key='';return p}
async function save(){const p=formProfile();if(!p.name||!p.target||(p.kind!=='edge'&&!p.model))throw Error('请填写供应商名称、目标语言和大模型名称');const endpoint=p.kind==='edge'?'https://edge.microsoft.com/translate/translatetext':endpointFor(p);const index=profiles.findIndex(x=>x.id===selected);profiles[index]=p;await chrome.storage.local.set({profiles,activeProvider:selected,kind:p.kind,protocol:p.protocol,endpoint,model:p.model,key:p.key,target:p.target,prompt:p.prompt});render()}
document.addEventListener('DOMContentLoaded',async()=>{const saved=await chrome.storage.local.get([...Object.keys(defaults),'profiles','activeProvider','protocol','kind']);profiles=Array.isArray(saved.profiles)?saved.profiles:[];if(!profiles.length&&saved.model)profiles.push({id:crypto.randomUUID(),name:'原有供应商',kind:saved.kind||'llm',protocol:saved.protocol||'openai',addressType:'full',...defaults,...Object.fromEntries(Object.keys(defaults).filter(k=>saved[k]!==undefined).map(k=>[k,saved[k]]))});for(const p of profiles)if(p.name==='默认供应商'&&p.id!==builtin)p.name=p.model||p.key?'原有供应商':'原有配置';if(!profiles.some(p=>p.id===builtin))profiles.unshift({id:builtin,name:'默认供应商 · 微软翻译',kind:'edge',addressType:'full',endpoint:'https://edge.microsoft.com/translate/translatetext',model:'',key:'',target:'简体中文',prompt:defaults.prompt});profiles=profiles.map(migrateProfile);selected=profiles.some(p=>p.id===saved.activeProvider)?saved.activeProvider:(saved.model&&profiles.find(p=>p.model===saved.model)?.id)||builtin;render()});
$('provider').addEventListener('change',()=>{selected=$('provider').value;render();status.textContent='已显示所选供应商，点击“保存并使用”启用。'});
$('add').addEventListener('click',()=>{$('providerDialog').showModal()});
$('remove').addEventListener('click',async()=>{if(selected===builtin)return;if(!confirm('确定删除此供应商及其保存的密钥？'))return;const stored=await chrome.storage.local.get('activeProvider');if(stored.activeProvider===selected){status.textContent='请先启用其他供应商，再删除当前供应商。';return}profiles=profiles.filter(p=>p.id!==selected);selected=builtin;await chrome.storage.local.set({profiles});render();status.textContent='供应商已删除。'});
$('form').addEventListener('submit',async e=>{e.preventDefault();try{await save();status.textContent='已保存并启用：'+$('name').value}catch(e){status.textContent=e.message}});
$('test').addEventListener('click',async()=>{try{await save();status.textContent='正在测试连接…';const result=await chrome.runtime.sendMessage({type:'translate',texts:['The electrochemical stability of the electrode was evaluated.']});status.textContent=result.ok?'连接成功：'+result.data[0]:result.error}catch(e){status.textContent=e.message}});
$('clearCache').addEventListener('click',async()=>{await chrome.storage.local.remove('translationCacheV1');status.textContent='本地翻译缓存已清除。'});
function migrateProfile(profile){
 const p={...profile,protocol:profile.protocol||'openai'};
 if(p.connectionVersion===1||p.kind==='edge'||p.kind==='gateway')return p;
 try{
  if(['localhost','127.0.0.1','[::1]'].includes(new URL(p.endpoint).hostname)){p.kind='gateway';return p}
  if(p.addressType!=='base'){
   const base=ProviderAPI.baseFromFull(p);
   if(!base){p.kind='gateway';return p}
   p.endpoint=base;
  }
  p.kind='llm';p.addressType='base';
 }catch{p.kind='gateway'}
 return p;
}
$('kind').addEventListener('change',()=>{
 if($('kind').value==='llm'){
  try{const base=ProviderAPI.baseFromFull(formProfile());if(base)$('endpoint').value=base}catch{}
  $('addressType').value='base';
 }
 updateFields();clearModels();status.textContent=$('kind').value==='edge'?'微软快速翻译无需模型和密钥。':'请填写对应服务的连接配置。';
});
for(const [id,info] of Object.entries(ProviderAPI.protocols)){
 const button=document.createElement('button');button.type='button';button.dataset.protocol=id;button.textContent=info.label;
 button.addEventListener('click',()=>{$('protocol').value=id;clearModels();updateFields()});$('protocolTabs').append(button);
}
$('protocol').addEventListener('change',updateFields);

const presets=[['Anthropic','https://api.anthropic.com/v1','anthropic'],['OpenAI','https://api.openai.com/v1'],['DeepSeek','https://api.deepseek.com/v1'],['Gemini','https://generativelanguage.googleapis.com/v1beta','gemini'],['xAI','https://api.x.ai/v1'],['Kimi','https://api.moonshot.cn/v1'],['智谱 GLM','https://open.bigmodel.cn/api/paas/v4'],['通义千问','https://dashscope.aliyuncs.com/compatible-mode/v1'],['火山引擎方舟','https://ark.cn-beijing.volces.com/api/v3'],['MiniMax','https://api.minimaxi.com/v1'],['阶跃星辰','https://api.stepfun.com/v1'],['Groq','https://api.groq.com/openai/v1'],['Mistral','https://api.mistral.ai/v1'],['OpenRouter','https://openrouter.ai/api/v1'],['自定义供应商',''],['本地 / 自定义网关','']];
for(const [name,endpoint,protocol] of presets){const button=document.createElement('button');button.type='button';button.className='preset';const symbols={'Anthropic':['A','#d77755'],'OpenAI':['O','#0f7466'],'DeepSeek':['D','#456af1'],'Gemini':['G','#5686e8'],'xAI':['X','#252a30'],'Kimi':['K','#252b32'],'智谱 GLM':['智','#5e6de9'],'通义千问':['通','#8257e9'],'火山引擎方舟':['火','#3188f5'],'MiniMax':['M','#eb4c69'],'阶跃星辰':['阶','#2f5050'],'Groq':['G','#df6d4f'],'Mistral':['M','#e09241'],'OpenRouter':['↗','#374b4a'],'自定义供应商':['＋','#78938d']};const [glyph,color]=symbols[name]||['•','#78938d'];const icon=document.createElement('span');icon.className='preset-icon';icon.style.setProperty('--preset-color',color);icon.textContent=glyph;icon.setAttribute('aria-hidden','true');const label=document.createElement('span');label.className='preset-name';label.textContent=name;button.append(icon,label);button.title=endpoint?new URL(endpoint).hostname:'手动填写接口地址';button.addEventListener('click',()=>{profiles.push({id:crypto.randomUUID(),name:name==='自定义供应商'?'新供应商':name,kind:name==='本地 / 自定义网关'?'gateway':'llm',protocol:protocol||'openai',addressType:name==='本地 / 自定义网关'?'full':'base',endpoint,model:'',key:'',target:'简体中文',prompt:defaults.prompt});selected=profiles.at(-1).id;render();$('providerDialog').close();$('modelSuggestions').replaceChildren();$('modelResults').textContent='';status.textContent=$('kind').value==='gateway'?'填写网关地址及模型后保存；也可以先获取模型。':'填写接口地址、密钥及模型后保存；也可以先获取模型。'});$('presetGrid').append(button)}
$('closeDialog').addEventListener('click',()=>$('providerDialog').close());

let fetchedModels=[],fetchGeneration=0,fetchedFingerprint='';
function clearModels(){fetchGeneration++;fetchedModels=[];fetchedFingerprint='';$('modelSuggestions').replaceChildren();$('modelChips').replaceChildren();$('modelResults').textContent=''}
for(const id of ['provider','endpoint','addressType','protocol','key','kind'])$(id).addEventListener('change',clearModels);
for(const id of ['endpoint','key'])$(id).addEventListener('input',clearModels);
$('add').addEventListener('click',clearModels);
function serviceConfig(p=formProfile()){return {...p,chat:endpointFor({...p,model:p.model||'model-placeholder'}),models:ProviderAPI.modelsURL(p)}}
function fingerprint(c){return JSON.stringify([c.id,c.kind,c.models,c.key,c.protocol])}
async function query(url,options){
 let r;try{r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)})}catch{throw Error('无法连接服务，请检查地址、网络和本地网关是否启动')}
 if(!r.ok)throw Error('服务返回 HTTP '+r.status+'，请检查接口、密钥和权限');
 try{return await r.json()}catch{throw Error('服务未返回有效 JSON，请确认填写的是 API 地址')}
}
async function modelList(c){
 let url=c.models,rows=[];
 for(let page=0;page<20;page++){
  const data=await query(url,{headers:ProviderAPI.headers(c)});
  const list=c.protocol==='gemini'?data.models:data.data;
  if(!Array.isArray(list))throw Error('该服务不提供兼容的模型列表，可手动填写模型名称');
  rows.push(...list);
  const next=new URL(c.models);
  if(c.protocol==='gemini'&&data.nextPageToken)next.searchParams.set('pageToken',data.nextPageToken);
  else if(c.protocol==='anthropic'&&data.has_more){if(!data.last_id)throw Error('模型列表分页信息不完整');next.searchParams.set('after_id',data.last_id)}
  else return [...new Set(rows.filter(x=>c.protocol!=='gemini'||!x.supportedGenerationMethods||x.supportedGenerationMethods.includes('generateContent')).map(x=>c.protocol==='gemini'?x.name?.replace(/^models\//,''):x.id).filter(x=>typeof x==='string'&&x))];
  url=next.href;
 }
 throw Error('模型列表页数超过上限，请手动填写模型');
}
function renderModels(){
 $('modelSuggestions').replaceChildren();$('modelChips').replaceChildren();
 for(const id of fetchedModels){const option=document.createElement('option');option.value=id;$('modelSuggestions').append(option)}
 for(const id of fetchedModels.slice(0,30)){
  const button=document.createElement('button');button.type='button';button.textContent=id;button.setAttribute('aria-pressed',String(id===$('model').value));
  button.addEventListener('click',()=>{$('model').value=id;renderModels()});$('modelChips').append(button);
 }
}
$('model').addEventListener('input',renderModels);
$('fetchModels').addEventListener('click',async()=>{
 clearModels();const generation=fetchGeneration;$('modelResults').textContent='正在获取模型…';
 try{const c=serviceConfig(),models=await modelList(c);if(generation!==fetchGeneration)return;fetchedModels=models;fetchedFingerprint=fingerprint(c);if(models.length===1&&!$('model').value)$('model').value=models[0];renderModels();$('modelResults').textContent=`已获取 ${models.length} 个模型；点击模型或在输入框中搜索。`}
 catch(e){if(generation===fetchGeneration)$('modelResults').textContent=e.message}
});
async function probe(p,model){
 const c={...p,model,endpoint:endpointFor({...p,model})};
 const b={model,messages:[{role:'user',content:'Reply OK.'}],max_tokens:128};
 const data=await query(ProviderAPI.requestURL(c),{method:'POST',headers:ProviderAPI.headers(c),body:JSON.stringify(ProviderAPI.body(c,b))});
 const answer=ProviderAPI.text(c,data);if(typeof answer!=='string'||!answer.trim())throw Error('模型未返回有效文本');return answer;
}
$('testModels').addEventListener('click',async()=>{
 if(!fetchedModels.length){$('modelResults').textContent='请先获取模型；也可手动填写模型后点击“测试连接”。';return}
 let c;try{c=serviceConfig()}catch(e){$('modelResults').textContent=e.message;return}
 if(fetchedFingerprint!==fingerprint(c)){$('modelResults').textContent='配置已变化，请重新获取模型。';return}
 const generation=fetchGeneration,models=[...fetchedModels],p=formProfile();$('testModels').disabled=true;let ok=0,failed=0;
 try{for(const model of models){if(generation!==fetchGeneration)return;try{await probe(p,model);ok++}catch{failed++}if(generation!==fetchGeneration)return;$('modelResults').textContent=`测试中 ${ok+failed}/${models.length}：正常 ${ok}，失败 ${failed}。`}}
 finally{$('testModels').disabled=false;if(generation===fetchGeneration)$('modelResults').textContent=`已测试 ${models.length} 个模型：正常 ${ok}，失败 ${failed}。测试结果仅代表本次请求。`}
});
$('detectProtocol').addEventListener('click',async()=>{
 const generation=++fetchGeneration,p=formProfile();$('detectProtocol').disabled=true;$('modelResults').textContent='正在检测协议…';
 const supported=[],details=[];
 try{
  for(const protocol of Object.keys(ProviderAPI.protocols)){
   if(generation!==fetchGeneration)return;
   const candidate={...p,protocol,addressType:'base'};
   try{const model=p.model||(await modelList(serviceConfig(candidate)))[0];if(!model)throw Error('没有可测试模型');await probe(candidate,model);supported.push({protocol,model})}
   catch(e){details.push(ProviderAPI.protocols[protocol].label+'：'+e.message)}
  }
  if(generation!==fetchGeneration)return;
  if(supported.length){const pick=supported.find(x=>x.protocol===p.protocol)||supported[0];$('protocol').value=pick.protocol;if(!$('model').value)$('model').value=pick.model;clearModels();updateFields();$('modelResults').textContent='已实测可用：'+supported.map(x=>ProviderAPI.protocols[x.protocol].label).join('、')+'。已选择 '+ProviderAPI.protocols[pick.protocol].label+'，保存后生效。'}
  else $('modelResults').textContent='未检测到可用协议。'+details.join('；');
 }finally{$('detectProtocol').disabled=false}
});
