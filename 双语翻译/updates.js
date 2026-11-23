(() => {
  const current = chrome.runtime.getManifest().version;
  const status = document.getElementById('updateStatus');
  const check = document.getElementById('checkUpdate');
  const link = document.getElementById('releaseLink');
  document.getElementById('currentVersion').textContent = '当前版本 '+current;
  const repository = globalThis.YANYI_RELEASE?.repository || '';
  let repo;
  try {
    const u = new URL(repository);
    if(u.origin !== 'https://github.com' || u.search || u.hash || u.username || u.password)throw Error();
    const parts=u.pathname.replace(/\/$/,'').split('/').slice(1);
    if(parts.length!==2 || !parts.every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)))throw Error();
    repo=parts.join('/');
  } catch {
    status.textContent='更新源尚未配置，等待作者提供发布仓库。';
    check.disabled=true;
    return;
  }
  link.href=`https://github.com/${repo}/releases/latest`;
  link.hidden=false;
  const cacheKey='releaseCheckV1',ttl=6*60*60*1000;
  function versionParts(v){
    const m=/^v?(\d+(?:\.\d+){1,3})$/.exec(v);
    return m ? m[1].split('.').map(Number) : null;
  }
  function newer(tag){
    const a=versionParts(tag),b=versionParts(current);
    if(!a||!b)return null;
    for(let i=0;i<4;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0)}
    return false;
  }
  function render(data){
    const available=newer(data.tag);
    link.textContent=available?'更新至 '+data.tag+' ↗':'查看最新 Release ↗';
    link.classList.toggle('update-available',available===true);
    status.textContent=available===null?'发现发布版本 '+data.tag+'，请前往 Release 查看。':available?'发现新版本 '+data.tag+'。点击右侧按钮查看并下载更新。':'当前没有更新的正式版本。';
  }
  async function run(manual=false){
    check.disabled=true;status.textContent='正在检查更新…';
    try {
      if(!manual){
        const saved=(await chrome.storage.local.get(cacheKey))[cacheKey];
        if(saved?.repo===repo && typeof saved.tag==='string' && Date.now()-saved.time>=0 && Date.now()-saved.time<ttl){render(saved);return}
      }
      const response=await fetch(`https://api.github.com/repos/${repo}/releases/latest`,{
        headers:{Accept:'application/vnd.github+json'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)
      });
      if(response.status===404){status.textContent='暂未找到公开的正式 Release，可点击右侧按钮查看。';return}
      if(response.status===403||response.status===429){status.textContent='检查更新暂受 GitHub 限制，可直接打开 Release 页面。';return}
      if(!response.ok)throw Error();
      const data=await response.json();
      if(typeof data.tag_name!=='string'||data.tag_name.length>80||data.draft||data.prerelease)throw Error();
      const entry={repo,tag:data.tag_name,time:Date.now()};
      render(entry);
      await chrome.storage.local.set({[cacheKey]:entry}).catch(()=>{});
    }catch{status.textContent='暂时无法检查更新，可重试或直接打开 Release 页面。'}
    finally{check.disabled=false}
  }
  check.addEventListener('click',()=>run(true));
  run();
})();
