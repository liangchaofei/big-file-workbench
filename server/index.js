import {createApp} from './app.js';
const port=Number(process.env.PORT||3001);
createApp({maxFileSize:Number(process.env.MAX_FILE_SIZE||16*1024**3)}).listen(port,'127.0.0.1',()=>console.log(`Upload Lab: http://127.0.0.1:${port}`));
