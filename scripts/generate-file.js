import {open,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const sizeMiB=Number(process.argv[2]||100),destination=resolve(process.argv[3]||`work/fixtures/test-${sizeMiB}MiB.bin`);
const size=sizeMiB*1024**2;if(!Number.isSafeInteger(size)||size<0)throw new Error('大小必须为可表示的非负字节数（参数单位 MiB）');
await mkdir(dirname(destination),{recursive:true});const file=await open(destination,'w');try{await file.truncate(size);if(size>0){const marker=Buffer.from('Upload Lab test fixture');await file.write(marker.subarray(0,Math.min(marker.length,size)),0,Math.min(marker.length,size),0);}}finally{await file.close();}
console.log(`${destination}\n${size.toLocaleString()} bytes（稀疏文件，上传后会实际占用磁盘空间）`);
