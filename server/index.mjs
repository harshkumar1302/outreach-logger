import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createSupabaseContext } from '@supabase/server';

const fileEnv = {};
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) fileEnv[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

const env = (name, fallback = '') => process.env[name] || fileEnv[name] || fallback;
const port = Number(process.env.PORT || 8787);
const dataDir = path.resolve(process.env.DATA_DIR || 'server/data');
const dataFile = path.join(dataDir, 'store.json');
const cookieName = 'creonnect_session';
const allowedOrigin = 'http://127.0.0.1:5173';
const sessions = new Map();

const serviceAccount = env('GOOGLE_SERVICE_ACCOUNT_JSON') ? JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON')) : null;
if (serviceAccount?.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
const sheetId = env('GOOGLE_SHEET_ID');

const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL') || env('VITE_SUPABASE_URL');
const supabaseKey = env('SUPABASE_PUBLISHABLE_KEY') || env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_ANON_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY');
const supabaseSecretKey = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
const supabaseJwksUrl = env('SUPABASE_JWKS_URL') || (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : '');
let store = { users: [], settings: {}, entries: [] };

async function loadStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    store = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    store.users ||= [];
    store.settings ||= {};
    store.entries ||= [];
  } catch {
    await saveStore();
  }
}

async function saveStore() {
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function json(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-credentials': 'true',
    ...extra
  });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').filter(Boolean).map(item => {
      const index = item.indexOf('=');
      return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))];
    })
  );
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(`${salt}:${key.toString('hex')}`)
    )
  );
}

async function verifyPassword(password, stored = '') {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = (await hashPassword(password, salt)).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function googleConfigured() {
  return Boolean(
    sheetId &&
    serviceAccount?.client_email &&
    serviceAccount?.private_key?.includes('BEGIN PRIVATE KEY') &&
    !serviceAccount.private_key.includes('...')
  );
}

function supabaseConfigured() {
  return Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project') && !supabaseKey.includes('replace_me'));
}

function supabaseServerConfigured() {
  return Boolean(supabaseUrl && supabaseKey && supabaseSecretKey && !supabaseSecretKey.includes('replace_with'));
}

function webRequestFromNode(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(','));
    else if (value !== undefined) headers.set(key, value);
  }
  return new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers });
}

async function currentUser(req) {
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ') && supabaseConfigured()) {
    try {
      const envOverrides = {
        url: supabaseUrl,
        publishableKeys: { default: supabaseKey },
        secretKeys: supabaseServerConfigured() ? { default: supabaseSecretKey } : {},
        jwks: supabaseJwksUrl ? new URL(supabaseJwksUrl) : null
      };
      const { data: ctx, error } = await createSupabaseContext(webRequestFromNode(req), {
        auth: 'user',
        env: envOverrides,
        cors: false
      });
      if (error) return null;
      const remoteUser = ctx.userClaims;
      const id = remoteUser?.sub;
      if (!id) return null;
      let user = store.users.find(item => item.id === id);
      if (!user) {
        user = {
          id,
          name: remoteUser.user_metadata?.full_name || remoteUser.email?.split('@')[0] || remoteUser.email || 'User',
          email: remoteUser.email || '',
          createdAt: new Date().toISOString(),
          authProvider: 'supabase'
        };
        store.users.push(user);
        store.settings[id] ||= { theme: 'Light', language: 'English (US)' };
        await saveStore();
      }
      user.name = remoteUser.user_metadata?.full_name || user.name || remoteUser.email?.split('@')[0] || 'User';
      user.email = remoteUser.email || user.email || '';
      return user;
    } catch (error) {
      console.error('Supabase auth notice:', error.message);
    }
  }

  const token = parseCookies(req)[cookieName];
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) return null;
  return store.users.find(user => user.id === session.userId) || null;
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    json(res, 401, { ok: false, error: 'Authentication required' });
    return null;
  }
  return user;
}

function issueSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.setHeader('set-cookie', `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearSession(res, req) {
  const token = parseCookies(req)[cookieName];
  if (token) sessions.delete(token);
  res.setHeader('set-cookie', `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function base64(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(input, key) {
  return crypto.createSign('RSA-SHA256').update(input).sign(key, 'base64url');
}

async function googleToken() {
  if (!googleConfigured()) {
    const error = new Error('Spreadsheet sync is not configured on the server');
    error.status = 503;
    throw error;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );
  const assertion = `${header}.${claim}.${sign(`${header}.${claim}`, serviceAccount.private_key)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) {
    const error = new Error('Google authentication failed. Check the service-account credentials.');
    error.status = 502;
    throw error;
  }
  return (await response.json()).access_token;
}

function tabFor(entry) {
  return entry.type === 'Brand' ? 'Brands' : 'Creators';
}

function sheetHeaders(type) {
  if (type === 'Creator') {
    return ['#', 'Name', 'Platform', 'Handle', 'Niche', 'Audience', 'Phone', 'Email', 'Connected Via', 'Reached Out By', 'Date', 'Response Status', 'Response Notes', 'Follow Needed', 'Follow Date', 'Follow Notes', 'Next Action', 'Remarks', 'Updated At', 'Local ID'];
  } else {
    return ['#', 'Company Name', 'Website', 'Industry', 'POC', 'Designation', 'Phone', 'Email', 'Connected Via', 'Reached Out By', 'Date', 'Response Status', 'Response Notes', 'Follow Needed', 'Follow Date', 'Follow Notes', 'Next Action', 'Remarks', 'Updated At', 'Local ID'];
  }
}

function row(entry, index) {
  return [
    index !== undefined ? index + 1 : '',
    entry.name,
    entry.platform || entry.website,
    entry.handle || entry.industry,
    entry.niche || entry.poc,
    entry.audience || entry.designation,
    (`${entry.country?.code || ''} ${entry.phone || ''}`.trim().startsWith('+') ? `'` : '') + `${entry.country?.code || ''} ${entry.phone || ''}`.trim(),
    entry.email,
    entry.connected,
    entry.reachedBy,
    entry.date,
    entry.response,
    entry.responseNotes,
    entry.follow,
    entry.followDate,
    entry.followNotes,
    entry.nextAction,
    entry.remarks,
    entry.updatedAt || entry.createdAt || new Date().toISOString(),
    entry.id || ''
  ];
}

async function createSheetTab(tab) {
  const token = await googleToken();
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: { title: tab }
            }
          }
        ]
      })
    }
  );
}

async function appendToSheet(entry) {
  const token = await googleToken();
  const tab = tabFor(entry);
  let response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A:T:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [row(entry)] })
    }
  );
  if (!response.ok) {
    const details = await response.text();
    if (details.includes('Unable to parse range') || details.includes('INVALID_ARGUMENT')) {
      try {
        await createSheetTab(tab);
        response = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}!A:T:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ values: [row(entry)] })
          }
        );
      } catch (err) {
        console.error('Failed to auto-create tab:', err.message);
      }
    }
    if (!response.ok) {
      const finalDetails = await response.text();
      const error = new Error(`Spreadsheet rejected the row${finalDetails ? `: ${finalDetails.slice(0, 240)}` : ''}`);
      error.status = 502;
      throw error;
    }
  }
  const body = await response.json();
  const match = body.updates?.updatedRange?.match(/!A(\d+):/);
  return { tab, rowNumber: match ? Number(match[1]) : null };
}

async function updateSheet(entry) {
  if (!entry.sheetRow?.rowNumber || !entry.sheetRow?.tab) return appendToSheet(entry);
  const token = await googleToken();
  const range = `${entry.sheetRow.tab}!A${entry.sheetRow.rowNumber}:T${entry.sheetRow.rowNumber}`;
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [row(entry)] })
    }
  );
  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`Spreadsheet update failed${details ? `: ${details.slice(0, 240)}` : ''}`);
    error.status = 502;
    throw error;
  }
  return entry.sheetRow;
}

async function clearSheetRow(entry) {
  if (!entry.sheetRow?.rowNumber || !entry.sheetRow?.tab) return;
  const token = await googleToken();
  const range = `${entry.sheetRow.tab}!A${entry.sheetRow.rowNumber}:T${entry.sheetRow.rowNumber}`;
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:clear`,
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }
  );
  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`Spreadsheet delete sync failed${details ? `: ${details.slice(0, 240)}` : ''}`);
    error.status = 502;
    throw error;
  }
}

async function fetchFromSupabase(userId) {
  if (!supabaseServerConfigured()) return [];
  const response = await fetch(`${supabaseUrl}/rest/v1/outreach_entries?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`, {
    headers: {
      apikey: supabaseSecretKey,
      authorization: `Bearer ${supabaseSecretKey}`
    }
  });
  if (!response.ok) return [];
  const rows = await response.json();
  return rows.map(r => r.payload);
}

async function saveToSupabase(entry, userId) {
  if (!supabaseServerConfigured()) return false;
  const response = await fetch(`${supabaseUrl}/rest/v1/outreach_entries?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: supabaseSecretKey,
      authorization: `Bearer ${supabaseSecretKey}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: entry.id,
      user_id: userId,
      type: entry.type,
      payload: entry,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt || entry.createdAt
    })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase row save failed${details ? `: ${details.slice(0, 200)}` : ''}`);
  }
  return true;
}

async function deleteFromSupabase(entryId, userId) {
  if (!supabaseServerConfigured()) return false;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/outreach_entries?id=eq.${encodeURIComponent(entryId)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: supabaseSecretKey,
        authorization: `Bearer ${supabaseSecretKey}`,
        prefer: 'return=minimal'
      }
    }
  );
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase delete failed${details ? `: ${details.slice(0, 200)}` : ''}`);
  }
  return true;
}

function csv(entries) {
  const headers =
    'ID,Type,Name,Platform/Website,Handle/Industry,Niche/POC,Audience/Designation,Phone,Email,Connected Via,Reached Out By,Date,Response Status,Response Notes,Follow Needed,Follow Date,Follow Notes,Next Action,Remarks,Updated At\n';
  const rows = entries.map((entry, idx) => {
    const raw = row(entry, idx);
    // CSV expects legacy format basically, but let's just use the raw output.
    return raw.map(value => `"${String(value || '').replaceAll('"', '""')}"`).join(',');
  });
  return headers + rows.join('\n');
}

async function syncAllToSheets(userId) {
  if (!googleConfigured()) return { ok: false, error: 'Google Sheets not configured' };
  const userEntries = store.entries.filter(e => e.userId === userId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  
  const creators = userEntries.filter(e => e.type === 'Creator');
  const brands = userEntries.filter(e => e.type === 'Brand');
  const token = await googleToken();

  const pushTab = async (type, data) => {
    const tabName = type === 'Creator' ? 'Creators' : 'Brands';
    const values = [sheetHeaders(type), ...data.map((e, idx) => row(e, idx))];
    
    // Clear the existing tab first so deleted rows are properly removed
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A:T:clear`,
      { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }
    );
    
    let res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A:T?valueInputOption=USER_ENTERED`,
      { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values }) }
    );
    if (!res.ok) {
      const details = await res.text();
      if (details.includes('Unable to parse range') || details.includes('INVALID_ARGUMENT')) {
        await createSheetTab(tabName);
        res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}!A:T?valueInputOption=USER_ENTERED`,
          { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values }) }
        );
      }
      if (!res.ok) throw new Error(`Failed to sync ${tabName} tab: ${await res.text()}`);
    }
  };

  await Promise.all([pushTab('Creator', creators), pushTab('Brand', brands)]);
  return { ok: true };
}

function validateEntry(entry) {
  if (!['Creator', 'Brand'].includes(entry.type)) return 'Choose Creator or Brand';
  if (entry.type === 'Creator' && (!String(entry.name || '').trim() || !String(entry.handle || '').trim())) {
    return 'Creator name and Instagram ID are required';
  }
  if (entry.type === 'Brand' && !String(entry.name || '').trim()) return 'Brand / company name is required';
  return '';
}

async function rewriteExcelCsv() {
  const excelCsvFile = path.join(dataDir, 'outreach_export.csv');
  await fs.writeFile(excelCsvFile, csv(store.entries), 'utf8');
}

await loadStore();

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'POST,GET,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-credentials': 'true'
    });
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, configured: googleConfigured() || supabaseServerConfigured() });
    }
    if (url.pathname === '/api/integrations/status' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        googleSheets: { configured: googleConfigured(), sheetId: sheetId || null },
        supabase: {
          configured: supabaseConfigured(),
          serverConfigured: supabaseServerConfigured(),
          url: supabaseUrl || null
        },
        excel: { configured: true, exportPath: '/api/export/excel' },
        json: { configured: true, exportPath: '/api/export/json' }
      });
    }
    if (url.pathname === '/api/auth/session' && req.method === 'GET') {
      const user = await currentUser(req);
      return json(res, 200, { authenticated: Boolean(user), user: user && safeUser(user) });
    }
    if (url.pathname === '/api/auth/signup' && req.method === 'POST') {
      const data = await requestBody(req);
      const name = String(data.name || '').trim();
      const email = String(data.email || '').trim().toLowerCase();
      const password = String(data.password || '');
      if (name.length < 2 || !email.includes('@') || password.length < 6) {
        return json(res, 400, { ok: false, error: 'Enter a name, valid email, and password of at least 6 characters' });
      }
      if (store.users.some(user => user.email === email)) {
        return json(res, 409, { ok: false, error: 'An account with this email already exists' });
      }
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
        authProvider: 'local'
      };
      store.users.push(user);
      store.settings[user.id] = { theme: 'Light', language: 'English (US)' };
      await saveStore();
      issueSession(res, user);
      return json(res, 201, { ok: true, user: safeUser(user) });
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const data = await requestBody(req);
      const email = String(data.email || '').trim().toLowerCase();
      const user = store.users.find(item => item.email === email);
      if (!user || !(await verifyPassword(String(data.password || ''), user.passwordHash))) {
        return json(res, 401, { ok: false, error: 'Email or password is incorrect' });
      }
      issueSession(res, user);
      return json(res, 200, { ok: true, user: safeUser(user) });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      clearSession(res, req);
      return json(res, 200, { ok: true });
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, { ok: true, settings: store.settings[user.id] || { theme: 'Light', language: 'English (US)' } });
    }
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      const data = await requestBody(req);
      store.settings[user.id] = {
        theme: data.theme === 'Dark' ? 'Dark' : 'Light',
        language: ['English (US)', 'English (UK)'].includes(data.language) ? data.language : 'English (US)'
      };
      await saveStore();
      return json(res, 200, { ok: true, settings: store.settings[user.id] });
    }
    if (url.pathname === '/api/profile' && req.method === 'PUT') {
      const data = await requestBody(req);
      user.name = String(data.name || '').trim().slice(0, 120);
      user.email = String(data.email || '').trim().toLowerCase();
      if (user.name.length < 2 || !user.email.includes('@')) return json(res, 400, { ok: false, error: 'Enter a valid name and email' });
      await saveStore();
      return json(res, 200, { ok: true, user: safeUser(user) });
    }
    
    // FETCH ENTRIES - prioritize Supabase
    if (url.pathname === '/api/entries' && req.method === 'GET') {
      let entries = [];
      if (supabaseServerConfigured()) {
        try {
          entries = await fetchFromSupabase(user.id);
          // Sync to local store as a backup
          const userEntryIds = new Set(entries.map(e => e.id));
          store.entries = store.entries.filter(e => e.userId !== user.id || userEntryIds.has(e.id));
          for (const e of entries) {
            const idx = store.entries.findIndex(se => se.id === e.id);
            if (idx >= 0) store.entries[idx] = e;
            else store.entries.push(e);
          }
          await saveStore();
        } catch (err) {
          console.error("Failed to fetch from supabase:", err.message);
          entries = store.entries.filter(entry => entry.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
      } else {
        entries = store.entries.filter(entry => entry.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }
      return json(res, 200, { ok: true, entries });
    }
    
    // EXPORT
    if (url.pathname === '/api/export/excel' && req.method === 'GET') {
      const userEntries = store.entries.filter(entry => entry.userId === user.id);
      res.writeHead(200, {
        'content-type': 'text/csv;charset=utf-8',
        'content-disposition': 'attachment; filename="outreach_clients.csv"',
        'cache-control': 'no-store'
      });
      return res.end(csv(userEntries));
    }
    if (url.pathname === '/api/export/json' && req.method === 'GET') {
      const userEntries = store.entries.filter(entry => entry.userId === user.id);
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="outreach_clients.json"',
        'cache-control': 'no-store'
      });
      return res.end(JSON.stringify(userEntries, null, 2));
    }

    // CREATE ENTRY
    if (url.pathname === '/api/entries' && req.method === 'POST') {
      const data = await requestBody(req);
      const now = new Date().toISOString();
      const saved = {
        ...data,
        id: crypto.randomUUID(),
        userId: user.id,
        createdAt: now,
        updatedAt: now,
        sheetSynced: false,
        supabaseSynced: false
      };
      const validation = validateEntry(saved);
      if (validation) return json(res, 400, { ok: false, error: validation });

      const warnings = [];
      try {
        saved.sheetRow = await appendToSheet(saved);
        saved.sheetSynced = true;
      } catch (error) {
        console.error('Sheet sync notice:', error.message);
        warnings.push(error.message);
      }
      try {
        saved.supabaseSynced = await saveToSupabase(saved, user.id);
      } catch (error) {
        console.error('Supabase sync notice:', error.message);
        warnings.push(error.message);
      }
      store.entries.push(saved);
      await rewriteExcelCsv();
      await saveStore();
      return json(res, 201, { ok: true, entry: saved, warnings: warnings.length ? warnings : undefined });
    }

    // UPDATE ENTRY
    const entryMatch = url.pathname.match(/^\/api\/entries\/([0-9a-f-]{36}|local_\d+)$/);
    if (entryMatch && req.method === 'PUT') {
      const entry = store.entries.find(item => item.id === entryMatch[1] && item.userId === user.id);
      if (!entry) return json(res, 404, { ok: false, error: 'Entry not found' });
      const data = await requestBody(req);
      const updated = {
        ...entry,
        ...data,
        id: entry.id,
        userId: user.id,
        createdAt: entry.createdAt,
        updatedAt: new Date().toISOString(),
        sheetRow: entry.sheetRow
      };
      const validation = validateEntry(updated);
      if (validation) return json(res, 400, { ok: false, error: validation });

      const warnings = [];
      try {
        updated.supabaseSynced = await saveToSupabase(updated, user.id);
      } catch (error) {
        console.error('Supabase update notice:', error.message);
        warnings.push(error.message);
      }
      store.entries[store.entries.findIndex(i => i.id === updated.id && i.userId === user.id)] = updated;
      await rewriteExcelCsv();
      await saveStore();
      return json(res, 200, { ok: true, entry: updated, warnings: warnings.length ? warnings : undefined });
    }

    // SYNC SHEETS (Full Replace)
    if (url.pathname === '/api/sync-sheets' && req.method === 'POST') {
      try {
        await syncAllToSheets(user.id);
        
        // Mark all as sheetSynced locally
        for (const e of store.entries) {
          if (e.userId === user.id) e.sheetSynced = true;
        }
        await saveStore();

        return json(res, 200, { ok: true });
      } catch (err) {
        console.error('Force sync error:', err.message);
        return json(res, 500, { ok: false, error: err.message });
      }
    }

    // DELETE ENTRY
    if (entryMatch && req.method === 'DELETE') {
      const entryId = entryMatch[1];
      const entry = store.entries.find(item => item.id === entryId && item.userId === user.id);
      if (!entry) return json(res, 404, { ok: false, error: 'Entry not found' });
      
      const warnings = [];
      try {
        await deleteFromSupabase(entryId, user.id);
      } catch (err) {
        warnings.push(err.message);
      }
      store.entries = store.entries.filter(item => !(item.id === entryId && item.userId === user.id));
      await rewriteExcelCsv();
      await saveStore();
      return json(res, 200, { ok: true, warnings: warnings.length ? warnings : undefined });
    }

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, { ok: false, error: error.message || 'Server error' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Creonnect server listening on http://127.0.0.1:${port}`));
