const aborted=()=>new DOMException('已暂停','AbortError');
export async function api(path,options={}){const response=await fetch('/api'+path,options);const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
function hashFile(file,signal,onProgress){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./hash.worker.js',import.meta.url),{type:'module'});const finish=(fn,value)=>{worker.terminate();signal.removeEventListener('abort',cancel);fn(value);};const cancel=()=>finish(reject,aborted());signal.addEventListener('abort',cancel,{once:true});worker.onerror=e=>finish(reject,new Error(e.message));worker.onmessage=({data})=>{if(data.error)finish(reject,new Error(data.error));else if(data.sha256)finish(resolve,data.sha256);else onProgress(data.progress);};if(signal.aborted)cancel();else worker.postMessage(file);});}
function send(path,blob,signal,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();const cancel=()=>xhr.abort();const cleanup=()=>signal.removeEventListener('abort',cancel);xhr.open('POST','/api'+path);if(path.includes('/chunks/'))xhr.open('PUT','/api'+path);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.upload.onprogress=e=>onProgress(e.loaded);xhr.onload=()=>{cleanup();try{const data=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)reject(new Error(data.error||`HTTP ${xhr.status}`));else resolve(data);}catch{reject(new Error(`响应解析失败 HTTP ${xhr.status}`));}};xhr.onerror=()=>{cleanup();reject(new Error('网络请求失败'));};xhr.onabort=()=>{cleanup();reject(aborted());};signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cleanup();reject(aborted());}else xhr.send(blob);});}
export async function uploadFile({file,mode,chunkSize,concurrency,signal,onUpdate,knownHash}){
 const began=performance.now();onUpdate({stage:'hashing',hashProgress:0,loaded:0,rate:0,uploadMs:0,resumedChunks:0,totalChunks:undefined,doneChunks:0});const sha256=knownHash||await hashFile(file,signal,p=>onUpdate({hashProgress:p}));const hashMs=performance.now()-began;onUpdate({sha256,hashProgress:1,stage:'uploading'});
 const started=performance.now();let initial=0;const progress=new Map();let confirmed=0;
 const report=()=>{const loaded=confirmed+[...progress.values()].reduce((a,b)=>a+b,0);onUpdate({loaded,rate:Math.max(0,loaded-initial)/Math.max(.001,(performance.now()-started)/1000),uploadMs:performance.now()-started});};
 let result,resumedChunks=0;
 if(mode==='raw')result=await send(`/raw?${new URLSearchParams({name:file.name,size:String(file.size),sha256})}`,file,signal,n=>{progress.set(0,n);report();});
 else{
 let job=await api('/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,chunkSize,sha256}),signal});
 if(job.result){await api(`/uploads/${job.id}`,{method:'DELETE',signal});job=await api('/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,chunkSize,sha256}),signal});}
 if(job.result){throw new Error('任务已被其他窗口完成，请重试');}
 else{
 const done=new Set(job.uploaded);resumedChunks=done.size;for(const i of done)confirmed+=Math.min(chunkSize,file.size-i*chunkSize);initial=confirmed;report();onUpdate({resumedChunks,totalChunks:job.totalChunks,doneChunks:done.size});
 const pending=Array.from({length:job.totalChunks},(_,i)=>i).filter(i=>!done.has(i));let cursor=0,failure;
 const worker=async()=>{while(!signal.aborted&&!failure){const index=pending[cursor++];if(index===undefined)return;const blob=file.slice(index*chunkSize,(index+1)*chunkSize);try{
 for(let attempt=0;;attempt++){try{await send(`/uploads/${job.id}/chunks/${index}`,blob,signal,n=>{progress.set(index,n);report();});break;}catch(e){progress.delete(index);report();if(e.name==='AbortError'||attempt>=2)throw e;}}
 progress.delete(index);confirmed+=blob.size;done.add(index);report();onUpdate({doneChunks:done.size});
 }catch(e){failure=e;}}};
 await Promise.all(Array.from({length:concurrency},worker));if(signal.aborted)throw aborted();if(failure)throw failure;
 onUpdate({stage:'merging'});result=await api(`/uploads/${job.id}/complete`,{method:'POST',signal});
 }
 }
 if(result.sha256!==sha256||result.size!==file.size)throw new Error('服务端返回的文件大小或哈希与源文件不一致');
 const uploadMs=performance.now()-started;onUpdate({stage:'done',loaded:file.size,uploadMs,rate:Math.max(0,file.size-initial)/(uploadMs/1000)});
 return {...result,mode,chunkSize,concurrency,resumedChunks,hashMs,uploadMs,totalMs:performance.now()-began,date:new Date().toISOString(),userAgent:navigator.userAgent};
}
