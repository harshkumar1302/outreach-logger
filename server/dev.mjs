import { spawn } from 'node:child_process';
const server=spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:process.env});
const client=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173'],{stdio:'inherit',env:process.env});
function stop(){server.kill('SIGTERM');client.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
server.on('exit',code=>{if(code&&code!==0){client.kill('SIGTERM');process.exit(code)}});
client.on('exit',code=>{if(code&&code!==0){server.kill('SIGTERM');process.exit(code)}});
