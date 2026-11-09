import {handleUpload} from '@vercel/blob/client';
import {authorize,cloudLimit,validPath,apiError} from '../server/cloud-auth.js';
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});try{
 const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
 const result=await handleUpload({request:req,body,onBeforeGenerateToken:async pathname=>{authorize(req);if(!validPath(pathname))throw Object.assign(new Error('文件路径无效'),{status:400});return {maximumSizeInBytes:cloudLimit(),addRandomSuffix:false,allowOverwrite:false,validUntil:Date.now()+60*60*1000};}});
 return res.status(200).json(result);
}catch(e){return apiError(res,e);}}
