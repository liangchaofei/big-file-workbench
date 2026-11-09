import http from 'node:http';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile, rename, stat, rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform, Readable} from 'node:stream';
import {createHash, randomUUID} from 'node:crypto';
import {join, resolve, extname, basename} from 'node:path';

const MAX_CHUNK=64*1024*1024;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(res,status,body)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}};
async function bodyJSON(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)fail(413,'元数据过大');}try{return JSON.parse(data);}catch{fail(400,'无效 JSON');}}
async function existsSize(path){try{return (await stat(path)).size;}catch(e){if(e.code==='ENOENT')return -1;throw e;}}
async function streamSave(source,target,expected){
 let size=0;const hash=createHash('sha256');const part=target+'.'+randomUUID()+'.tmp';
 try{await pipeline(source,new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>expected)return cb(Object.assign(new Error('数据超过声明大小'),{status:400}));hash.update(chunk);cb(null,chunk);}}),createWriteStream(part,{flags:'wx'}));
 if(size!==expected)fail(400,'数据长度与声明不一致');await rename(part,target);return {size,sha256:hash.digest('hex')};
 }catch(e){await rm(part,{force:true});throw e;}
}
export function createApp({dataDir=resolve('data'),maxFileSize=16*1024**3,distDir=resolve('dist')}={}){
 if(!Number.isSafeInteger(maxFileSize)||maxFileSize<0)throw new Error('MAX_FILE_SIZE 必须为非负安全整数');
 const jobs=join(dataDir,'chunks'),files=join(dataDir,'files'),locks=new Map(),active=new Map(),merging=new Set();
 const locked=async(key,fn)=>{const previous=locks.get(key)||Promise.resolve();let unlock;const current=new Promise(r=>unlock=r);locks.set(key,current);await previous;try{return await fn();}finally{unlock();if(locks.get(key)===current)locks.delete(key);}};
 const validate=m=>{if(typeof m.name!=='string'||!m.name.trim()||m.name.length>255)fail(400,'文件名无效');if(!Number.isSafeInteger(m.size)||m.size<0)fail(400,'文件大小必须为非负安全整数');if(m.size>maxFileSize)fail(413,'超过服务端文件大小限制');if(!/^[a-f0-9]{64}$/.test(m.sha256))fail(400,'SHA-256 无效');};
 const metadata=async id=>{try{return JSON.parse(await readFile(join(jobs,id,'meta.json'),'utf8'));}catch(e){if(e.code==='ENOENT')fail(404,'上传任务不存在');throw e;}};
 const result=async id=>{try{return JSON.parse(await readFile(join(jobs,id,'result.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const status=async(id,m)=>{const completed=await result(id);const count=Math.ceil(m.size/m.chunkSize);const uploaded=[];if(!completed)for(let i=0;i<count;i++){if(await existsSize(join(jobs,id,String(i)))===Math.min(m.chunkSize,m.size-i*m.chunkSize))uploaded.push(i);}return {id,uploaded,totalChunks:count,result:completed};};
 const server=http.createServer(async(req,res)=>{
 try{
 const u=new URL(req.url,'http://localhost');await mkdir(files,{recursive:true});
 if(req.method==='GET'&&u.pathname==='/api/config')return json(res,200,{maxFileSize,maxChunkSize:MAX_CHUNK});
 if(req.method==='POST'&&u.pathname==='/api/uploads'){
 const m=await bodyJSON(req);validate(m);if(!Number.isSafeInteger(m.chunkSize)||m.chunkSize<1||m.chunkSize>MAX_CHUNK)fail(400,'分片大小须为 1 字节至 64 MiB');if(Math.ceil(m.size/m.chunkSize)>100000)fail(400,'分片数量不能超过 100000，请增大分片');
 const id=createHash('sha256').update(`${m.sha256}:${m.size}:${m.chunkSize}`).digest('hex');
 return await locked(id,async()=>{const dir=join(jobs,id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'meta.json'),JSON.stringify({...m,name:basename(m.name)}));json(res,200,await status(id,m));});
 }
 const match=u.pathname.match(/^\/api\/uploads\/([a-f0-9]{64})(?:\/(complete|chunks\/([0-9]+)))?$/);
 if(match){const [,id,action,indexText]=match;
 return await locked(req.method==='PUT'?`${id}:${indexText}`:id,async()=>{const m=await metadata(id);const dir=join(jobs,id);
 if(req.method==='GET'&&!action)return json(res,200,await status(id,m));
 if(req.method==='DELETE'&&!action){if(active.get(id)||merging.has(id))fail(409,'任务正在写入，请稍后清理');await rm(dir,{recursive:true,force:true});await rm(join(files,id),{force:true});return json(res,200,{ok:true});}
 if(req.method==='PUT'&&indexText!==undefined){if(merging.has(id))fail(409,'正在合并');active.set(id,(active.get(id)||0)+1);try{const index=Number(indexText);const expected=Math.min(m.chunkSize,m.size-index*m.chunkSize);if(!Number.isSafeInteger(index)||index>=Math.ceil(m.size/m.chunkSize))fail(400,'分片索引越界');if(req.headers['content-length']!==undefined&&Number(req.headers['content-length'])!==expected)fail(400,'分片长度错误');if(await result(id))fail(409,'文件已合并');const saved=await streamSave(req,join(dir,String(index)),expected);return json(res,200,{index,...saved});}finally{const remaining=active.get(id)-1;if(remaining)active.set(id,remaining);else active.delete(id);}}
 if(req.method==='POST'&&action==='complete'){
 if(active.get(id))fail(409,'分片仍在写入，请稍后合并');merging.add(id);try{
 const done=await result(id);if(done)return json(res,200,done);
 const count=Math.ceil(m.size/m.chunkSize);for(let i=0;i<count;i++)if(await existsSize(join(dir,String(i)))!==Math.min(m.chunkSize,m.size-i*m.chunkSize))fail(409,`缺少分片 ${i}`);
 const destination=join(files,id);async function* chunks(){for(let i=0;i<count;i++)yield* createReadStream(join(dir,String(i)));}
 const saved=await streamSave(Readable.from(chunks()),destination,m.size);if(saved.sha256!==m.sha256){await rm(destination,{force:true});fail(422,'SHA-256 校验不一致，请清除任务后重新上传');}
 const out={id,name:m.name,...saved,url:`/api/files/${id}`,verified:true};await writeFile(join(dir,'result.json'),JSON.stringify(out));for(let i=0;i<count;i++)await rm(join(dir,String(i)),{force:true});return json(res,200,out);
 }finally{merging.delete(id);}}fail(405,'不支持的请求');});
 }
 if(req.method==='POST'&&u.pathname==='/api/raw'){
 const m={name:u.searchParams.get('name'),size:Number(u.searchParams.get('size')),sha256:u.searchParams.get('sha256')};if(!u.searchParams.has('size'))fail(400,'缺少文件大小');validate(m);
 if(req.headers['content-length']!==undefined&&Number(req.headers['content-length'])!==m.size)fail(400,'文件长度错误');
 const id=randomUUID(),destination=join(files,id);const saved=await streamSave(req,destination,m.size);if(saved.sha256!==m.sha256){await rm(destination,{force:true});fail(422,'SHA-256 校验失败');}return json(res,200,{id,name:basename(m.name),...saved,verified:true,url:`/api/files/${id}`});
 }
 if(req.method==='GET'&&/^\/api\/files\/[a-f0-9-]+$/.test(u.pathname)){
 const path=join(files,u.pathname.split('/').at(-1));const size=await existsSize(path);if(size<0)fail(404,'文件不存在');res.writeHead(200,{'Content-Length':size,'Content-Type':'application/octet-stream','Content-Disposition':'attachment'});await pipeline(createReadStream(path),res);return;
 }
 if(u.pathname.startsWith('/api/'))fail(404,'接口不存在');
 if(req.method==='GET'){
 const relative=decodeURIComponent(u.pathname);const path=resolve(distDir,'.'+(relative==='/'?'/index.html':relative));if(!path.startsWith(resolve(distDir)+'/'))fail(403,'路径无效');const size=await existsSize(path);if(size<0)fail(404,'请先 npm run build 或使用 npm run dev');const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Content-Length':size});await pipeline(createReadStream(path),res);return;
 }fail(404,'不存在');
 }catch(e){if(!e.status)console.error(e);if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'服务端错误，请检查磁盘空间和日志'});else res.destroy();}
 });server.requestTimeout=0;return server;
}
