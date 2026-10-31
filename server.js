import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { db, hashPassword, usernameKey, verifyPassword } from './db.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_USERS = Math.max(1, Number.parseInt(process.env.MAX_USERS || '20', 10) || 20);
const SESSION_DAYS = 14;
const PUBLIC = resolve('.');
const cookieName = 'hamsohbat_session';
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml' };
const allowedFiles = new Set(['index.html','app.js','style.css','manifest.json','sw.js','icon.svg']);
const attempts = new Map();
const fakeHash = await hashPassword(randomBytes(24).toString('hex'));

function json(res, status, value, extra = {}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...extra });
  res.end(JSON.stringify(value));
}
function digest(token) { return createHash('sha256').update(token).digest('hex'); }
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),decodeURIComponent(v.slice(i+1))];}));
}
function cookie(token, req) {
  const secure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}${secure?'; Secure':''}`;
}
async function body(req, max = 8192) {
  let text = '', size = 0;
  for await (const chunk of req) { size += chunk.length; if(size > max) throw Object.assign(new Error('بدنهٔ درخواست بزرگ است.'), {status:413}); text += chunk; }
  try {
    const parsed=JSON.parse(text || '{}');
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('object expected');
    return parsed;
  } catch { throw Object.assign(new Error('درخواست معتبر نیست.'), {status:400}); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function sessionFor(req) {
  const token = cookies(req)[cookieName];
  if (!token || token.length > 200) return null;
  const now = Date.now(), tokenHash = digest(token);
  const session = db.prepare(`SELECT s.token_hash,s.user_id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash, now);
  if (session) db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now, tokenHash);
  else db.prepare('DELETE FROM sessions WHERE token_hash=? OR expires_at<=?').run(tokenHash, now);
  return session;
}
function limited(req) {
  const key = req.socket.remoteAddress || 'unknown', now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.until) { attempts.set(key,{count:1,until:now+15*60_000}); return false; }
  entry.count++;
  return entry.count > 20;
}
setInterval(()=>{const now=Date.now();for(const [key,value] of attempts)if(now>value.until)attempts.delete(key);db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);},60*60_000).unref();

async function api(req, res, url) {
  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res,403,{error:'درخواست از مبدأ معتبر نیست.'});
    if (limited(req)) return json(res,429,{error:'تلاش‌های زیادی انجام شد. ۱۵ دقیقه بعد دوباره امتحان کن.'});
    const input=await body(req), username=String(input.username||'').normalize('NFKC').trim(), password=String(input.password||'');
    if(username.length>64||password.length>128)return json(res,400,{error:'نام کاربری یا رمز معتبر نیست.'});
    const user=db.prepare('SELECT id,username,password_hash,active FROM users WHERE username_key=?').get(usernameKey(username));
    const valid=await verifyPassword(password,user?.password_hash||fakeHash);
    if(!user||!valid||!user.active)return json(res,401,{error:'نام کاربری یا رمز درست نیست.'});
    const token=randomBytes(32).toString('base64url'),now=Date.now();
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,last_seen) VALUES(?,?,?,?,?)').run(digest(token),user.id,now,now+SESSION_DAYS*86400_000,now);
    return json(res,200,{username:user.username},{'Set-Cookie':cookie(token,req)});
  }
  const session=sessionFor(req);
  if(url.pathname==='/api/me'&&req.method==='GET')return session?json(res,200,{username:session.username}):json(res,401,{error:'ابتدا وارد شو.'});
  if(url.pathname==='/api/logout'&&req.method==='POST'){
    if(!sameOrigin(req))return json(res,403,{error:'درخواست از مبدأ معتبر نیست.'});
    const token=cookies(req)[cookieName];if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
    return json(res,200,{ok:true},{'Set-Cookie':`${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`});
  }
  if(!session)return json(res,401,{error:'ابتدا وارد شو.'});
  if(url.pathname==='/api/messages'&&req.method==='GET'){
    const after=Number(url.searchParams.get('after')||0);
    const rows=after>0?db.prepare(`SELECT m.id,m.body,m.created_at,u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id>? ORDER BY m.id ASC LIMIT 200`).all(after):db.prepare(`SELECT * FROM (SELECT m.id,m.body,m.created_at,u.username FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 100) ORDER BY id ASC`).all();
    const active=db.prepare(`SELECT DISTINCT u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.active=1 AND s.last_seen>? ORDER BY u.username COLLATE NOCASE`).all(Date.now()-120_000).map(row=>row.username);
    return json(res,200,{messages:rows,activeUsers:active,serverTime:Date.now()});
  }
  if(url.pathname==='/api/messages'&&req.method==='POST'){
    if(!sameOrigin(req))return json(res,403,{error:'درخواست از مبدأ معتبر نیست.'});
    const input=await body(req,12_000),text=String(input.text||'').trim();
    if(!text)return json(res,400,{error:'پیام خالی است.'});
    if([...text].length>1000)return json(res,400,{error:'پیام حداکثر ۱۰۰۰ نویسه باشد.'});
    const now=Date.now();db.prepare('INSERT INTO messages(user_id,body,created_at) VALUES(?,?,?)').run(session.user_id,text,now);
    db.prepare('DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT 5000)').run();
    const row=db.prepare('SELECT id,body,created_at,? AS username FROM messages WHERE id=last_insert_rowid()').get(session.username);
    return json(res,201,{message:row});
  }
  return json(res,404,{error:'مسیر پیدا نشد.'});
}

async function handler(req,res){
  try {
    const url=new URL(req.url,'http://local');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'روش درخواست پشتیبانی نمی‌شود.'});
    const pathname=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname),name=pathname.slice(1);
    if(!allowedFiles.has(name))return json(res,404,{error:'صفحه پیدا نشد.'});
    const path=resolve(PUBLIC,name);if(!path.startsWith(PUBLIC))return json(res,404,{error:'صفحه پیدا نشد.'});
    const content=await readFile(path);
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':name==='index.html'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:content);
  } catch(error) {
    if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'خطای داخلی رخ داد.'});else res.end();
    if(!error.status)console.error(error);
  }
}

const server=createServer(handler);
server.listen(PORT,HOST,()=>console.log(`اتاق چت روی http://${HOST}:${PORT} آماده است؛ سقف حساب‌ها: ${MAX_USERS}.`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>{db.close();process.exit(0);}));
