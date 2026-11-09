import {head,issueSignedToken,presignUrl} from '@vercel/blob';
import {authorize,validPath,apiError} from '../server/cloud-auth.js';
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});try{
 authorize(req);const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!validPath(body?.pathname))return res.status(400).json({error:'文件路径无效'});
 const blob=await head(body.pathname);if(!Number.isSafeInteger(body.size)||blob.size!==body.size)return res.status(422).json({error:'云端文件大小与源文件不一致'});
 const validUntil=Date.now()+60*60*1000;const token=await issueSignedToken({pathname:body.pathname,operations:['get'],validUntil});const {presignedUrl}=await presignUrl(token,{operation:'get',pathname:body.pathname,access:'private',validUntil});
 return res.status(200).json({size:blob.size,pathname:blob.pathname,url:presignedUrl,verified:false,remoteConfirmed:true});
 }catch(e){return apiError(res,e);}}
