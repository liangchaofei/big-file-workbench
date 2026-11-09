import {defineConfig} from 'vite';
export default defineConfig({server:{host:'127.0.0.1',watch:{usePolling:true,interval:1000,ignored:['**/data/**','**/work/**','**/test-files/**']},proxy:{'/api':{target:'http://127.0.0.1:3001',timeout:0,proxyTimeout:0}}}});
