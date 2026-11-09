import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorize,validPath,cloudLimit} from '../server/cloud-auth.js';
import config from '../api/config.js';
import upload from '../api/blob-upload.js';
import status from '../api/blob-status.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
test('cloud configuration does not expose credentials; upload and status reject unauthorized access',async()=>{
 const before={password:process.env.UPLOAD_PASSWORD,token:process.env.BLOB_READ_WRITE_TOKEN,max:process.env.MAX_FILE_SIZE};
 try{
 process.env.UPLOAD_PASSWORD='test-password';process.env.BLOB_READ_WRITE_TOKEN='test-server-token';delete process.env.MAX_FILE_SIZE;
 assert.equal(cloudLimit(),1024**3);assert.throws(()=>authorize({headers:{}}),{status:401});assert.doesNotThrow(()=>authorize({headers:{'x-upload-password':'test-password'}}));
 assert.equal(validPath(`uploads/${'a'.repeat(64)}/12345678-1234-1234-1234-123456789012/file.pdf`),true);assert.equal(validPath('../secrets'),false);
 const cfg=response();config({method:'GET'},cfg);assert.equal(cfg.body.storage,'vercel-blob');assert.equal(cfg.body.configured,true);assert.equal(JSON.stringify(cfg.body).includes('test-password'),false);assert.equal(JSON.stringify(cfg.body).includes('test-server-token'),false);
 const denied=response();await status({method:'POST',headers:{},body:{pathname:'invalid'}},denied);assert.equal(denied.code,401);
 const noToken=response();await upload({method:'POST',headers:{},body:{type:'blob.generate-client-token',payload:{pathname:'invalid'}}},noToken);assert.equal(noToken.code,401);
 const invalid=response();await status({method:'POST',headers:{'x-upload-password':'test-password'},body:{pathname:'../secret'}},invalid);assert.equal(invalid.code,400);
 process.env.MAX_FILE_SIZE='NaN';assert.throws(cloudLimit);
 }finally{for(const [key,value] of [['UPLOAD_PASSWORD',before.password],['BLOB_READ_WRITE_TOKEN',before.token],['MAX_FILE_SIZE',before.max]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
