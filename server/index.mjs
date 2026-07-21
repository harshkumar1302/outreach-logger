import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fileEnv={};
for(const file of ['.env','.env.local']){try{for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^([^#=]+)=(.*)$/);if(match)fileEnv[match[1].trim()]=match[2].trim().replace(/^['"]|['"]$/g,'')}}catch{}}
const env=(name,fallback='')=>process.env[name]||fileEnv[name]||fallback;
const port = Number(process.env.PORT || 8787);
const dataDir = path.resolve(process.env.DATA_DIR || 'server/data');
const dataFile = path.join(dataDir, 'store.json');
const cookieName = 'creonnect_session';
const sessions = new Map();
const serviceAccount = env('GOOGLE_SERVICE_ACCOUNT_JSON') ? JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON')) : null;
if(serviceAccount?.private_key) serviceAccount.private_key=serviceAccount.private_key.replace(/\\n/g,'\n');
const sheetId = env('GOOGLE_SHEET_ID');
const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY') || env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const supabaseServiceKey = env('SUPABASE_SERVICE_ROLE_KEY');
let store = { users: [], settings: {}, entries: [] };

async function loadStore() { await fs.mkdir(dataDir, { recursive:true }); try { store = JSON.parse(await fs.readFile(dataFile, 'utf8')); } catch { await saveStore(); } }
async function saveStore() { await fs.writeFile(dataFile, JSON.stringify(store, null, 2), { mode:0o600 }); }
function json(res, status, body, extra={}) { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'http://127.0.0.1:5173','access-control-allow-credentials':'true',...extra}); res.end(JSON.stringify(body)); }
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x=>{ const i=x.indexOf('='); return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1))]; })); }
function requestBody(req) { return new Promise((resolve,reject)=>{ let raw=''; req.on('data',chunk=>{ raw+=chunk; if(raw.length>1e6) req.destroy(); }); req.on('end',()=>{ try { resolve(JSON.parse(raw||'{}')); } catch { reject(new Error('Invalid JSON')); } }); req.on('error',reject); }); }
function hashPassword(password, salt=crypto.randomBytes(16).toString('hex')) { return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(`${salt}:${key.toString('hex')}`))); }
async function verifyPassword(password, stored) { const [salt,expected] = stored.split(':'); const actual = (await hashPassword(password,salt)).split(':')[1]; return expected && crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')); }
function safeUser(user) { return {id:user.id,name:user.name,email:user.email}; }
function googleConfigured() { return Boolean(sheetId&&serviceAccount?.client_email&&serviceAccount?.private_key?.includes('BEGIN PRIVATE KEY')&&!serviceAccount.private_key.includes('...')); }
function supabaseConfigured() { return Boolean(supabaseUrl&&supabaseKey); }
async function currentUser(req) { const authorization=req.headers.authorization||''; if(authorization.startsWith('Bearer ')&&supabaseUrl&&supabaseKey){try{const response=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:supabaseKey,authorization}});if(!response.ok)return null;const remote=await response.json();if(!remote?.id)return null;let user=store.users.find(item=>item.id===remote.id);if(!user){user={id:remote.id,name:remote.user_metadata?.full_name||remote.email?.split('@')[0]||'User',email:remote.email||'',createdAt:new Date().toISOString()};store.users.push(user);await saveStore()}return user}catch(error){console.error('Supabase session validation notice:',error.message)}}const token=parseCookies(req)[cookieName];const session=token&&sessions.get(token);if(!session||session.expires<Date.now())return null;return store.users.find(user=>user.id===session.userId)||null; }
async function requireUser(req,res) { const user=await currentUser(req); if(!user) { json(res,401,{ok:false,error:'Authentication required'}); return null; } return user; }
function issueSession(res,user) { const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{userId:user.id,expires:Date.now()+7*24*60*60*1000}); res.setHeader('set-cookie',`${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); }
function clearSession(res,req) { const token=parseCookies(req)[cookieName]; if(token) sessions.delete(token); res.setHeader('set-cookie',`${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); }
function base64(value) { return Buffer.from(value).toString('base64url'); }
function sign(input,key) { return crypto.createSign('RSA-SHA256').update(input).sign(key,'base64url'); }
async function googleToken() {
  if(!serviceAccount||!sheetId) { const error=new Error('Spreadsheet sync is not configured on the server'); error.status=503; throw error; }
  if(!serviceAccount.client_email||!serviceAccount.private_key?.includes('BEGIN PRIVATE KEY')||serviceAccount.private_key.includes('...')) { const error=new Error('Spreadsheet sync credentials are invalid. Replace GOOGLE_SERVICE_ACCOUNT_JSON with the real service-account JSON.'); error.status=503; throw error; }
  const now=Math.floor(Date.now()/1000), header=base64(JSON.stringify({alg:'RS256',typ:'JWT'})), claim=base64(JSON.stringify({iss:serviceAccount.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const assertion=`${header}.${claim}.${sign(`${header}.${claim}`,serviceAccount.private_key)}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!response.ok) { const error=new Error('Google authentication failed. Check the service-account credentials.'); error.status=502; throw error; } return (await response.json()).access_token;
}
function row(entry) { return [entry.type==='Creator'?'Creator':'Brand',entry.name,entry.platform||entry.website,entry.handle||entry.industry,entry.niche||entry.poc,entry.audience||entry.designation,`${entry.country?.code||''} ${entry.phone||''}`.trim(),entry.email,entry.connected,entry.reachedBy,entry.date,entry.response,entry.responseNotes,entry.follow,entry.followDate,entry.followNotes,entry.nextAction,entry.remarks,new Date().toISOString()]; }
async function appendToSheet(entry) { const token=await googleToken(); const tab=entry.type==='Brand'?'Brands':'Creators'; const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({values:[row(entry)]})}); if(!response.ok) { const details=await response.text(); const error=new Error(`Spreadsheet rejected the row${details?`: ${details.slice(0,240)}`:''}`); error.status=502; throw error; } }
async function saveToSupabase(entry,userId) { if(!supabaseUrl||!supabaseServiceKey)return; const response=await fetch(`${supabaseUrl}/rest/v1/outreach_entries`,{method:'POST',headers:{apikey:supabaseServiceKey,authorization:`Bearer ${supabaseServiceKey}`,'content-type':'application/json',prefer:'return=minimal'},body:JSON.stringify({user_id:userId,type:entry.type,payload:entry,created_at:new Date().toISOString()})}); if(!response.ok){const details=await response.text();throw new Error(`Supabase row save failed${details?`: ${details.slice(0,200)}`:''}`)} }
async function appendToExcelCsv(entry) {
  const excelCsvFile = path.join(dataDir, 'outreach_export.csv');
  const headers = 'Type,Name,Platform/Website,Handle/Industry,Niche/POC,Audience/Designation,Phone,Email,Connected Via,Reached Out By,Date,Response Status,Response Notes,Follow Needed,Follow Date,Follow Notes,Next Action,Remarks,Logged At\n';
  let exists = false;
  try { await fs.access(excelCsvFile); exists = true; } catch {}
  const values = row(entry).map(v => `"${String(v || '').replaceAll('"', '""')}"`).join(',');
  await fs.appendFile(excelCsvFile, (exists ? '' : headers) + values + '\n', 'utf8');
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'http://127.0.0.1:5173','access-control-allow-methods':'POST,GET,PUT,OPTIONS','access-control-allow-headers':'content-type','access-control-allow-credentials':'true'});return res.end();}
  try {
    if(req.url==='/api/health'&&req.method==='GET') return json(res,200,{ok:true,configured:googleConfigured()});
    if(req.url==='/api/integrations/status'&&req.method==='GET') return json(res,200,{ok:true,googleSheets:{configured:googleConfigured(),sheetId:sheetId||null},supabase:{configured:supabaseConfigured(),url:supabaseUrl||null}});
    if(req.url==='/api/auth/session'&&req.method==='GET'){const user=await currentUser(req);return json(res,200,{authenticated:Boolean(user),user:user&&safeUser(user)});}
    if(req.url==='/api/auth/signup'&&req.method==='POST'){const data=await requestBody(req);const name=String(data.name||'').trim(),email=String(data.email||'').trim().toLowerCase(),password=String(data.password||'');if(name.length<2||!email.includes('@')||password.length<8)return json(res,400,{ok:false,error:'Enter a name, valid email, and password of at least 8 characters'});if(store.users.some(user=>user.email===email))return json(res,409,{ok:false,error:'An account with this email already exists'});const user={id:crypto.randomUUID(),name,email,passwordHash:await hashPassword(password),createdAt:new Date().toISOString()};store.users.push(user);store.settings[user.id]={theme:'Light',language:'English (US)'};await saveStore();issueSession(res,user);return json(res,201,{ok:true,user:safeUser(user)});}
    if(req.url==='/api/auth/login'&&req.method==='POST'){const data=await requestBody(req),email=String(data.email||'').trim().toLowerCase(),user=store.users.find(item=>item.email===email);if(!user||!(await verifyPassword(String(data.password||''),user.passwordHash)))return json(res,401,{ok:false,error:'Email or password is incorrect'});issueSession(res,user);return json(res,200,{ok:true,user:safeUser(user)});}
    if(req.url==='/api/auth/logout'&&req.method==='POST'){clearSession(res,req);return json(res,200,{ok:true});}
    const user=await requireUser(req,res); if(!user)return;
    if(req.url==='/api/settings'&&req.method==='GET')return json(res,200,{ok:true,settings:store.settings[user.id]||{theme:'Light',language:'English (US)'}});
    if(req.url==='/api/settings'&&req.method==='PUT'){const data=await requestBody(req);store.settings[user.id]={theme:data.theme==='Dark'?'Dark':'Light',language:['English (US)','English (UK)'].includes(data.language)?data.language:'English (US)'};await saveStore();return json(res,200,{ok:true,settings:store.settings[user.id]});}
    if(req.url==='/api/profile'&&req.method==='PUT'){const data=await requestBody(req);user.name=String(data.name||'').trim().slice(0,120);user.email=String(data.email||'').trim().toLowerCase();if(user.name.length<2||!user.email.includes('@'))return json(res,400,{ok:false,error:'Enter a valid name and email'});await saveStore();return json(res,200,{ok:true,user:safeUser(user)});}
    if(req.url==='/api/entries'&&req.method==='GET')return json(res,200,{ok:true,entries:store.entries.filter(entry=>entry.userId===user.id).slice(-100).reverse()});
    if(req.url==='/api/export/excel'&&req.method==='GET'){
      const userEntries = store.entries.filter(entry=>entry.userId===user.id);
      const headers = 'Type,Name,Platform/Website,Handle/Industry,Niche/POC,Audience/Designation,Phone,Email,Connected Via,Reached Out By,Date,Response Status,Response Notes,Follow Needed,Follow Date,Follow Notes,Next Action,Remarks,Logged At\n';
      const rows = userEntries.map(e => row(e).map(v => `"${String(v || '').replaceAll('"', '""')}"`).join(',')).join('\n');
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="outreach_clients.csv"' });
      return res.end(headers + rows);
    }
    if(req.url==='/api/entries'&&req.method==='POST'){
      const entry=await requestBody(req);
      if(entry.type==='Creator'&&(!String(entry.name||'').trim()||!String(entry.handle||'').trim())) return json(res,400,{ok:false,error:'Creator name and Instagram ID are required'});
      
      let sheetSynced = false, supabaseSynced = false, syncWarnings = [];
      try { await appendToSheet(entry); sheetSynced = true; } catch (err) { console.error('Sheet sync notice:', err.message); syncWarnings.push(err.message); }
      try { await saveToSupabase(entry, user.id); supabaseSynced = true; } catch (err) { console.error('Supabase sync notice:', err.message); syncWarnings.push(err.message); }
      try { await appendToExcelCsv(entry); } catch (err) { console.error('Excel CSV notice:', err.message); }
      
      const saved={...entry,id:crypto.randomUUID(),userId:user.id,createdAt:new Date().toISOString(),sheetSynced,supabaseSynced};
      store.entries.push(saved);
      return json(res,201,{ok:true,entry:saved,warnings:syncWarnings.length>0?syncWarnings:undefined});
    }
    return json(res,404,{ok:false,error:'Not found'});
  } catch(error) { console.error(error); return json(res,error.status||500,{ok:false,error:error.message||'Server error'}); }
});
await loadStore();
server.listen(port,'127.0.0.1',()=>console.log(`Creonnect server listening on http://127.0.0.1:${port}`));

