import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,open,rm,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createApp} from '../server/app.js';
const root=resolve('work/browser-test');await mkdir(root,{recursive:true});
const server=createApp({dataDir:join(root,'data')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;const results=[],errors=[];const report={startedAt:new Date().toISOString(),platform:process.platform,node:process.version,results};
const fixture=async size=>{const path=join(root,'fixture.bin');const f=await open(path,'w');try{await f.truncate(size);if(size>0)await f.write(Buffer.from('upload-lab'),0,Math.min(10,size),0);}finally{await f.close();}return path;};
try{
 browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'}),headless:true,args:['--no-sandbox']});report.browser=browser.version();
 const page=await browser.newPage({viewport:{width:1440,height:1080}});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.getByText('本地服务已连接').waitFor();
 await page.screenshot({path:join(root,'desktop.png'),fullPage:true});
 // A real throttled upload is interrupted after the first persisted chunk, then resumed.
 const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:20*1024**2,uploadThroughput:4*1024**2});
 await page.getByLabel('选择上传文件').setInputFiles(await fixture(32*1024**2));await page.getByLabel('分片大小').selectOption('1');await page.getByLabel('并发请求').selectOption('1');
 const first=page.waitForResponse(r=>r.url().includes('/chunks/')&&r.status()===200);await page.getByRole('button',{name:'开始上传'}).click();await first;await page.getByRole('button',{name:'暂停上传'}).click();await page.getByTestId('status').filter({hasText:'已暂停'}).waitFor();
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 // Refresh and re-select to prove that resume data lives on the server, not just in React state.
 await page.reload();await page.getByText('本地服务已连接').waitFor();await page.getByLabel('选择上传文件').setInputFiles(join(root,'fixture.bin'));await page.getByLabel('分片大小').selectOption('1');await page.getByLabel('并发请求').selectOption('1');await page.getByRole('button',{name:'开始上传'}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('upload-lab-history')||'[]').length===1,null,{timeout:120000});
 const resumed=await page.evaluate(()=>JSON.parse(localStorage.getItem('upload-lab-history'))[0]);assert.ok(resumed.resumedChunks>=1);assert.equal(resumed.verified,true);report.resume={passed:true,resumedChunks:resumed.resumedChunks};console.log('PASS pause → refresh → resume',resumed.resumedChunks,'chunks');
 await rm(join(root,'data'),{recursive:true,force:true});
 const sizes=process.env.TEST_SIZES?process.env.TEST_SIZES.split(',').map(Number):[100*1024**2,1024**3,2*1024**3+1,4*1024**3+1];
 for(const size of sizes){const path=await fixture(size);for(const mode of ['raw','chunked']){
 await page.getByRole('tab',{name:mode==='raw'?'整文件上传 SINGLE':'分片上传 CHUNKED'}).click();
 if(mode==='chunked'){await page.getByLabel('分片大小').selectOption('8');await page.getByLabel('并发请求').selectOption('3');}
 await page.getByLabel('选择上传文件').setInputFiles(path);const previous=await page.evaluate(()=>JSON.parse(localStorage.getItem('upload-lab-history')||'[]').length);
 await page.getByRole('button',{name:'开始上传'}).click();await page.waitForFunction(n=>JSON.parse(localStorage.getItem('upload-lab-history')||'[]').length>n,previous,{timeout:600000});
 const result=await page.evaluate(()=>JSON.parse(localStorage.getItem('upload-lab-history'))[0]);assert.equal(result.size,size);assert.equal(result.mode,mode);assert.equal(result.verified,true);assert.equal(result.resumedChunks,0);results.push(result);console.log(`PASS ${mode} ${size} bytes | hash ${Math.round(result.hashMs)} ms | upload ${Math.round(result.uploadMs)} ms`);
 await rm(join(root,'data'),{recursive:true,force:true});await writeFile('browser-test-report.json',JSON.stringify(report,null,2));
 }}
 await page.screenshot({path:join(root,'desktop-results.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(root,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);report.pageErrors=errors;report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;throw e;}finally{report.finishedAt=new Date().toISOString();await writeFile('browser-test-report.json',JSON.stringify(report,null,2));await browser?.close();await new Promise(r=>server.close(r));await rm(join(root,'data'),{recursive:true,force:true});await rm(join(root,'fixture.bin'),{force:true});}
