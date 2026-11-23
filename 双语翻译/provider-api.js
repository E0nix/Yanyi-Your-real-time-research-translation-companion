/* Shared by the settings page and the extension service worker. */
globalThis.ProviderAPI = (() => {
  const protocols = {
    openai: {label:'OpenAI 兼容', suffix:'/chat/completions'},
    responses: {label:'OpenAI Responses', suffix:'/responses'},
    anthropic: {label:'Anthropic 兼容', suffix:'/messages'},
    gemini: {label:'Gemini 兼容', suffix:''}
  };
  function url(value) {
    let u; try { u = new URL(value); } catch { throw Error('请填写有效的接口地址'); }
    if (u.username || u.password) throw Error('接口地址中不能包含用户名或密码');
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw Error('请使用 HTTPS 接口地址（本机地址除外）');
    return u;
  }
  function endpoint(p) {
    const u = url(p.endpoint), protocol = p.protocol || 'openai';
    if (!protocols[protocol]) throw Error('不支持的接口协议');
    if (p.addressType !== 'base') return u.href;
    if (u.search || u.hash) throw Error('基础地址不能包含查询参数或片段');
    let path = u.pathname.replace(/\/+$/, '');
    // A bare origin uses the protocol's standard API version; custom prefixes stay intact.
    if (!path) path = protocol === 'gemini' ? '/v1beta' : '/v1';
    if (protocol === 'gemini') {
      if (!p.model) throw Error('请先填写 Gemini 模型名称');
      path += '/models/' + encodeURIComponent(p.model.replace(/^models\//,'')) + ':generateContent';
    } else if (!path.endsWith(protocols[protocol].suffix)) path += protocols[protocol].suffix;
    u.pathname = path;
    return u.href;
  }
  function baseFromFull(p) {
    const u = url(p.endpoint);
    if (u.search || u.hash) return null;
    const suffix = protocols[p.protocol || 'openai']?.suffix;
    if (p.protocol === 'gemini') {
      if (!/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/.test(u.pathname)) return null;
      u.pathname = u.pathname.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/, '');
    } else {
      if (!suffix || !u.pathname.endsWith(suffix)) return null;
      u.pathname = u.pathname.slice(0,-suffix.length);
    }
    return u.href.replace(/\/$/,'');
  }
  function modelsURL(p) {
    const probe = {...p, model:p.model || 'model-placeholder'};
    const base = baseFromFull({...probe, endpoint:endpoint(probe)});
    if (!base) throw Error('获取模型需要标准接口路径；此服务可手动填写模型名称');
    return base + '/models';
  }
  function headers(c) {
    const h = {'Content-Type':'application/json'};
    // Gateway mode never forwards keys retained from an earlier direct API setup.
    const key = c.kind === 'gateway' ? '' : c.key;
    if (c.protocol === 'anthropic') return {...h,...(key ? {'x-api-key':key} : {}), 'anthropic-version':'2023-06-01'};
    if (c.protocol === 'gemini') return {...h,...(key ? {'x-goog-api-key':key} : {})};
    return {...h,...(key ? {Authorization:'Bearer '+key} : {})};
  }
  function body(c,b) {
    const system = b.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    const messages = b.messages.filter(m=>m.role!=='system');
    if (c.protocol === 'anthropic') return {model:b.model,system,messages,max_tokens:b.max_tokens || 4096,...(b.temperature!==undefined?{temperature:b.temperature}:{}),...(b.stream?{stream:true}:{})};
    if (c.protocol === 'responses') return {model:b.model,instructions:system,input:messages,store:false,...(b.max_tokens?{max_output_tokens:b.max_tokens}:{}),...(b.stream?{stream:true}:{})};
    if (c.protocol === 'gemini') return {...(system?{systemInstruction:{parts:[{text:system}]}}:{}),contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{...(b.temperature!==undefined?{temperature:b.temperature}:{}),...(b.max_tokens?{maxOutputTokens:b.max_tokens}:{})}};
    return b;
  }
  function requestURL(c,stream=false) {
    const u = url(c.endpoint);
    if (c.protocol === 'gemini') {
      if(c.model)u.pathname=u.pathname.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/, '/models/'+encodeURIComponent(c.model.replace(/^models\//,''))+':generateContent');
      u.pathname = u.pathname.replace(/:(?:streamGenerateContent|generateContent)$/, stream ? ':streamGenerateContent' : ':generateContent');
      if (stream) u.searchParams.set('alt','sse'); else u.searchParams.delete('alt');
    }
    return u.href;
  }
  function text(c,d) {
    if (d.error) throw Error('模型返回错误，请检查模型和服务配置');
    if (c.protocol === 'anthropic') return (d.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');
    if (c.protocol === 'responses') {
      if (d.status && d.status!=='completed') throw Error('模型输出未完整结束，请重试');
      return (d.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('') || d.output_text || '';
    }
    if (c.protocol === 'gemini') {
      const candidate=d.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason!=='STOP') throw Error('模型输出未完整结束，请重试');
      return (candidate?.content?.parts||[]).filter(x=>!x.thought).map(x=>x.text||'').join('');
    }
    return d.choices?.[0]?.message?.content;
  }
  function event(c,d) {
    if (d.error || ['error','response.failed','response.incomplete'].includes(d.type)) throw Error('模型流式响应出错或未完整结束');
    if (c.protocol === 'responses') return {delta:d.type==='response.output_text.delta'?d.delta:'',done:d.type==='response.completed'};
    if (c.protocol === 'anthropic') {
      if (d.type==='message_delta' && d.delta?.stop_reason && d.delta.stop_reason!=='end_turn') throw Error('模型输出未完整结束，请重试');
      return {delta:d.type==='content_block_delta'?d.delta?.text:'',done:d.type==='message_stop'};
    }
    if (c.protocol === 'gemini') return {delta:text(c,d),done:d.candidates?.[0]?.finishReason==='STOP'};
    const finish=d.choices?.[0]?.finish_reason;
    if (finish && finish!=='stop') throw Error('模型输出未完整结束，请重试');
    return {delta:d.choices?.[0]?.delta?.content,done:finish==='stop'};
  }
  return {protocols, endpoint, baseFromFull, modelsURL, headers, body, requestURL, text, event};
})();
