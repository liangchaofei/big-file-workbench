import {createHash,timingSafeEqual} from 'node:crypto';
export const cloudLimit=()=>{const n=Number(process.env.MAX_FILE_SIZE||1024**3);if(!Number.isSafeInteger(n)||n<1||n>16*1024**3)throw new Error('MAX_FILE_SIZE 必须在 1 字节到 16 GiB 之间');return n;};
export const validPath=path=>typeof path==='string'&&/^uploads\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[\w.-]{1,140}$/.test(path);
export function authorize(req){
 const password=process.env.UPLOAD_PASSWORD;
 if(!password||!process.env.BLOB_READ_WRITE_TOKEN)throw Object.assign(new Error('请先配置 Blob 存储和 UPLOAD_PASSWORD'),{status:503});
 const supplied=req.headers['x-upload-password'];
 const hash=s=>createHash('sha256').update(s).digest();
 if(typeof supplied!=='string'||!timingSafeEqual(hash(password),hash(supplied)))throw Object.assign(new Error('上传口令不正确'),{status:401});
}
export function apiError(res,error){const status=error.status||500;if(status===500)console.error('Blob API:',error.message);return res.status(status).json({error:status===500?'云存储请求失败，请检查配置或重试':error.message});}
