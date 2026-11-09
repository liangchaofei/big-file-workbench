import {createMultipartUpload,uploadPart,completeMultipartUpload,put} from '@vercel/blob/client';
import {api} from './upload';
export const cloudHeaders=()=>({'Content-Type':'application/json','x-upload-password':sessionStorage.getItem('upload-lab-password')||''});
export async function cloudDownload(record){return api('/blob-status',{method:'POST',headers:cloudHeaders(),body:JSON.stringify({pathname:record.pathname,size:record.size})});}
export async function uploadCloud({file,mode,chunkSize,concurrency,signal,onUpdate,sha256,hashMs,began}){
 const beganUpload=performance.now();let initial=0,confirmed=0;const pendingProgress=new Map();
 const report=()=>{const loaded=confirmed+[...pendingProgress.values()].reduce((a,b)=>a+b,0);onUpdate({loaded,uploadMs:performance.now()-beganUpload,rate:Math.max(0,loaded-initial)/Math.max(.001,(performance.now()-beganUpload)/1000)});};
 const cacheKey=`upload-lab-blob:${sha256}:${file.size}:${chunkSize}`;
 let job;try{job=JSON.parse(sessionStorage.getItem(cacheKey)||'null');}catch{}
 const multipart=mode==='chunked'&&file.size>0;
 if(!multipart||!job||Date.now()-job.createdAt>24*60*60*1000)job={pathname:`uploads/${sha256}/${crypto.randomUUID()}/${file.name.replace(/[^\w.-]/g,'_').slice(0,120)||'file.bin'}`,parts:[],createdAt:Date.now()};
 const tokenResult=await api('/blob-upload',{method:'POST',headers:cloudHeaders(),body:JSON.stringify({type:'blob.generate-client-token',payload:{pathname:job.pathname,multipart}}),signal});
 const options={access:'private',token:tokenResult.clientToken,abortSignal:signal,contentType:file.type||'application/octet-stream'};
 let blob,resumedChunks=0;
 if(!multipart){blob=await put(job.pathname,file,{...options,onUploadProgress:({loaded})=>{pendingProgress.set(0,loaded);report();}});}
 else{
 if(chunkSize<8*1024**2)throw new Error('云端分片大小至少为 8 MiB');
 const save=()=>{try{sessionStorage.setItem(cacheKey,JSON.stringify(job));}catch{throw new Error('浏览器无法保存断点信息，请允许站点存储');}};
 if(!job.uploadId){Object.assign(job,await createMultipartUpload(job.pathname,options));save();}
 const total=Math.ceil(file.size/chunkSize),done=new Map(job.parts.map(p=>[p.partNumber,p]));resumedChunks=done.size;
 for(const number of done.keys())confirmed+=Math.min(chunkSize,file.size-(number-1)*chunkSize);initial=confirmed;report();onUpdate({totalChunks:total,doneChunks:done.size,resumedChunks});
 const indices=Array.from({length:total},(_,i)=>i+1).filter(i=>!done.has(i));let cursor=0,failure;
 const worker=async()=>{while(!signal.aborted&&!failure){const number=indices[cursor++];if(number===undefined)return;const part=file.slice((number-1)*chunkSize,number*chunkSize);try{
 const result=await uploadPart(job.pathname,part,{...options,uploadId:job.uploadId,key:job.key,partNumber:number,onUploadProgress:({loaded})=>{pendingProgress.set(number,loaded);report();}});
 pendingProgress.delete(number);done.set(number,result);confirmed+=part.size;job.parts=[...done.values()];save();report();onUpdate({doneChunks:done.size});
 }catch(e){failure=e;}}};
 await Promise.all(Array.from({length:concurrency},worker));if(signal.aborted)throw new DOMException('已暂停','AbortError');if(failure)throw failure;
 onUpdate({stage:'merging'});blob=await completeMultipartUpload(job.pathname,[...done.values()].sort((a,b)=>a.partNumber-b.partNumber),{...options,uploadId:job.uploadId,key:job.key});sessionStorage.removeItem(cacheKey);
 }
 onUpdate({stage:'merging'});
 const remote=await api('/blob-status',{method:'POST',headers:cloudHeaders(),body:JSON.stringify({pathname:blob.pathname,size:file.size}),signal});
 const uploadMs=performance.now()-beganUpload;onUpdate({stage:'done',cloud:true,loaded:file.size,uploadMs,rate:Math.max(0,file.size-initial)/Math.max(.001,uploadMs/1000)});
 return {...remote,id:blob.pathname,name:file.name,sha256,mode,chunkSize,concurrency,resumedChunks,hashMs,uploadMs,totalMs:performance.now()-began,date:new Date().toISOString(),storage:'vercel-blob',userAgent:navigator.userAgent};
}
