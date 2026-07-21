import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.PORT || 8787);
const dataDir = path.resolve(process.env.DATA_DIR || 'server/data');
const dataFile = path.join(dataDir, 'store.json');
const cookieName = 'creonnect_session';
const sessions = new Map();
const serviceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : null;
const sheetId = process.env.GOOGLE_SHEET_ID || '';
let store = { users: [], settings: {}, entries: [] };

async function loadStore() { await fs.mkdir(dataDir, { recursive:true }); try { store = JSON.parse(await fs.readFile(dataFile, 'utf8')); } catch { await saveStore(); } }
async function saveStore() { await fs.writeFile(dataFile, JSON.stringify(store, null, 2), { mode:0o600 }); }
function json(res, status, body, extra={}) { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'http://127.0.0.1:5173','access-control-allow-credentials':'true',...extra}); res.end(JSON.stringify(body)); }
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x=>{ const i=x.indexOf('='); return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1))]; })); }
function requestBody(req) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data',chunk=>{ raw+=chunk; if(raw.length>1e6) req.destroy(); }); req.on('end',()=>{ try { resolve(JSON.parse(raw||'{}')); } catch { reject(new Error('Invalid JSON')); } }); req.on('error',reject); }); }
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')) { return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(`${salt}:${key.toString('hex')}`))); }
async function verifyPassword(password, stored) { const [salt,expected] = stored.split(':'); const actual = (await hashPassword(password,salt)).split(':')[1]; return expected && crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')); }
function safeUser(user) { return {id:user.id,name:user.name,email:user.email}; }
function currentUser(req) { const token=parseCookies(req)[cookieName]; const session=token&&sessions.get(token); if(!session || session.expires<Date.now()) return null; return store.users.find(user=>user.id===session.userId) || null; }
function requireUser(req,res) { const user=currentUser(req); if(!user) { json(res,401,{ok:false,error:'Authentication required'}); return null; } return user; }
function issueSession(res,user) { const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{userId:user.id,expires:Date.now()+7*24*60*60*1000}); res.setHeader('set-cookie',`${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); }
function clearSession(res,req) { const token=parseCookies(req)[cookieName]; if(token) sessions.delete(token); res.setHeader('set-cookie',`${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); }
function base64(value) { return Buffer.from(value).toString('base64url'); }
function sign(input,key) { return crypto.createSign('RSA-SHA256').update(input).sign(key,'base64url'); }
async function googleToken() {
  if(!serviceAccount||!sheetId) throw new Error('Spreadsheet sync is not configured on the server');
  const now=Math.floor(Date.now()/1000), header=base64(JSON.stringify({alg:'RS256',typ:'JWT'})), claim=base64(JSON.stringify({iss:serviceAccount.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const assertion=`${header}.${claim}.${sign(`${header}.${claim}`,serviceAccount.private_key)}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!response.ok) throw new Error('Google authentication failed'); return (await response.json()).access_token;
}
function row(entry) { return [entry.type==='Creator'?'Creator':'Brand',entry.name,entry.platform||entry.website,entry.handle||entry.industry,entry.niche||entry.poc,entry.audience||entry.designation,`${entry.country?.code||''} ${entry.phone||''}`.trim(),entry.email,entry.connected,entry.reachedBy,entry.date,entry.response,entry.responseNotes,entry.follow,entry.followDate,entry.followNotes,entry.nextAction,entry.remarks,new Date().toISOString()]; }
async function appendToSheet(entry) { const token=await googleToken(); const tab=entry.type==='Brand'?'Brands':'Creators'; const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({values:[row(entry)]})}); if(!response.ok) throw new Error('Spreadsheet rejected the row'); }

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'http://127.0.0.1:5173','access-control-allow-methods':'POST,GET,PUT,OPTIONS','access-control-allow-headers':'content-type','access-control-allow-credentials':'true'});return res.end();}
  try {
    if(req.url==='/api/health'&&req.method==='GET') return json(res,200,{ok:true,configured:Boolean(serviceAccount&&sheetId)});
    if(req.url==='/api/auth/session'&&req.method==='GET'){const user=currentUser(req);return json(res,200,{authenticated:Boolean(user),user:user&&safeUser(user)});}
    if(req.url==='/api/auth/signup'&&req.method==='POST'){const data=await requestBody(req);const name=String(data.name||'').trim(),email=String(data.email||'').trim().toLowerCase(),password=String(data.password||'');if(name.length<2||!email.includes('@')||password.length<8)return json(res,400,{ok:false,error:'Enter a name, valid email, and password of at least 8 characters'});if(store.users.some(user=>user.email===email))return json(res,409,{ok:false,error:'An account with this email already exists'});const user={id:crypto.randomUUID(),name,email,passwordHash:await hashPassword(password),createdAt:new Date().toISOString()};store.users.push(user);store.settings[user.id]={theme:'Light',language:'English (US)'};await saveStore();issueSession(res,user);return json(res,201,{ok:true,user:safeUser(user)});}
    if(req.url==='/api/auth/login'&&req.method==='POST'){const data=await requestBody(req),email=String(data.email||'').trim().toLowerCase(),user=store.users.find(item=>item.email===email);if(!user||!(await verifyPassword(String(data.password||''),user.passwordHash)))return json(res,401,{ok:false,error:'Email or password is incorrect'});issueSession(res,user);return json(res,200,{ok:true,user:safeUser(user)});}
    if(req.url==='/api/auth/logout'&&req.method==='POST'){clearSession(res,req);return json(res,200,{ok:true});}
    const user=requireUser(req,res); if(!user)return;
    if(req.url==='/api/settings'&&req.method==='GET')return json(res,200,{ok:true,settings:store.settings[user.id]||{theme:'Light',language:'English (US)'}});
    if(req.url==='/api/settings'&&req.method==='PUT'){const data=await requestBody(req);store.settings[user.id]={theme:data.theme==='Dark'?'Dark':'Light',language:['English (US)','English (UK)'].includes(data.language)?data.language:'English (US)'};await saveStore();return json(res,200,{ok:true,settings:store.settings[user.id]});}
    if(req.url==='/api/profile'&&req.method==='PUT'){const data=await requestBody(req);user.name=String(data.name||'').trim().slice(0,120);user.email=String(data.email||'').trim().toLowerCase();if(user.name.length<2||!user.email.includes('@'))return json(res,400,{ok:false,error:'Enter a valid name and email'});await saveStore();return json(res,200,{ok:true,user:safeUser(user)});}
    if(req.url==='/api/entries'&&req.method==='GET')return json(res,200,{ok:true,entries:store.entries.filter(entry=>entry.userId===user.id).slice(-100).reverse()});
    if(req.url==='/api/entries'&&req.method==='POST'){const entry=await requestBody(req);if(entry.type==='Creator'&&(!String(entry.name||'').trim()||!String(entry.handle||'').trim()))return json(res,400,{ok:false,error:'Creator name and Instagram ID are required'});await appendToSheet(entry);const saved={...entry,id:crypto.randomUUID(),userId:user.id,createdAt:new Date().toISOString()};store.entries.push(saved);await saveStore();return json(res,201,{ok:true,entry:saved});}
    return json(res,404,{ok:false,error:'Not found'});
  } catch(error) { console.error(error); return json(res,500,{ok:false,error:error.message||'Server error'}); }
});
await loadStore();
server.listen(port,'127.0.0.1',()=>console.log(`Creonnect server listening on http://127.0.0.1:${port}`));
