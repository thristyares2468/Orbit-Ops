// Last updated: 13 August 2026
// admin.js — moderation HTTP panel, gated by a single shared ADMIN_TOKEN.
//
// Mounted at /admin* on the existing http server. Lets an admin read/search the
// chat logs (who said what, when, where), see live rooms/players, review
// possible alt-account clusters and anti-cheat strikes, and ban/unban accounts.
// Bans here are account/device scoped — never IP/subnet.

const crypto = require('crypto');
const db = require('./db');
const bans = require('./bans');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function tokenOk(presented) {
  if (!presented || !ADMIN_TOKEN) return false;
  const a = Buffer.from(String(presented));
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return resolve({});
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ctx: { rooms, clients } (live in-memory game state from server.js)
async function handle(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const pathName = url.pathname;

  // Determine the presented token (query for GET, header, or body for POST).
  const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let body = null;
  if (req.method === 'POST') body = await readBody(req);
  const presented = url.searchParams.get('token') || headerToken || (body && body.token);

  if (!tokenOk(presented)) {
    if (pathName === '/admin' || pathName === '/admin/') {
      // Still serve the login page (it will prompt for a token) but never with data.
      if (!url.searchParams.get('token')) return servePage(res);
    }
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  try {
    if (req.method === 'GET' && (pathName === '/admin' || pathName === '/admin/')) {
      return servePage(res);
    }
    if (req.method === 'GET' && pathName === '/admin/api/chat-logs') {
      const rows = await db.searchChatLogs({
        room: url.searchParams.get('room') || undefined,
        accountId: url.searchParams.get('account') || undefined,
        name: url.searchParams.get('name') || undefined,
        q: url.searchParams.get('q') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        limit: url.searchParams.get('limit') || undefined,
        offset: url.searchParams.get('offset') || undefined
      });
      return sendJson(res, 200, { rows });
    }
    if (req.method === 'GET' && pathName === '/admin/api/online') {
      return sendJson(res, 200, { rooms: onlineSnapshot(ctx) });
    }
    if (req.method === 'GET' && pathName === '/admin/api/alts') {
      const rows = await db.findAltClusters(200);
      return sendJson(res, 200, { rows });
    }
    if (req.method === 'GET' && pathName === '/admin/api/strikes') {
      const accountId = url.searchParams.get('account');
      if (!accountId) return sendJson(res, 200, { violations: await db.listRecentViolations(250) });
      const [account, violations, accountBans] = await Promise.all([
        db.getAccountById(accountId),
        db.getViolationsForAccount(accountId, 100),
        db.getBansForAccount(accountId)
      ]);
      return sendJson(res, 200, { account, violations, bans: accountBans });
    }
    if (req.method === 'GET' && pathName === '/admin/api/account') {
      const email = url.searchParams.get('email');
      const id = url.searchParams.get('id');
      const account = email ? await db.getAccountByEmail(email) : (id ? await db.getAccountById(id) : null);
      if (!account) return sendJson(res, 404, { error: 'not found' });
      const accountBans = await db.getBansForAccount(account.id);
      return sendJson(res, 200, { account, bans: accountBans });
    }
    if (req.method === 'POST' && pathName === '/admin/api/ban') {
      const { scope, accountId, deviceId, reason, until } = body || {};
      if (scope === 'device' && deviceId) {
        await bans.banDevice({ deviceId, reason: reason || 'admin ban', byAdmin: 'admin', expiresAt: until || null });
      } else if (accountId) {
        await bans.banAccount({ accountId, deviceId: deviceId || null, reason: reason || 'admin ban', byAdmin: 'admin', expiresAt: until || null });
      } else {
        return sendJson(res, 400, { error: 'accountId or deviceId required' });
      }
      if (ctx.onBan) ctx.onBan(accountId, deviceId);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathName === '/admin/api/unban') {
      const { banId, accountId, deviceId } = body || {};
      await bans.unban({ banId, accountId, deviceId });
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && pathName === '/admin/api/reset-leaderboard') {
      if (!db.isEnabled()) return sendJson(res, 503, { error: 'database unavailable' });
      const result = await db.resetLeaderboardStats((body || {}).scope);
      return sendJson(res, 200, { ok: true, result });
    }
    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[admin]', e.message);
    return sendJson(res, 500, { error: 'server_error' });
  }
}

function onlineSnapshot(ctx) {
  const out = [];
  if (!ctx || !ctx.rooms) return out;
  for (const [roomCode, room] of ctx.rooms.entries()) {
    const players = [];
    for (const [id, player] of room.players.entries()) {
      const client = ctx.clients.get(id);
      players.push({
        id,
        name: player.name,
        accountId: client ? client.accountId : null,
        ip: client ? client.ip : null,
        kills: player.kills,
        deaths: player.deaths,
        isHost: room.hostId === id
      });
    }
    out.push({ roomCode, gamemode: room.settings?.gamemode, players });
  }
  return out;
}

// Single-file Orbit Ops Subdivision admin UI. Dependency-free.
function servePage(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(ADMIN_HTML);
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbit Ops Subdivision - Admin</title>
<style>
  :root{--green:#2e7d32;--green-d:#1b5e20;--gold:#ffaa00;--bg:#0b0c0a;--card:#15170f;--muted:#9aa088;--text:#f1f1ec}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 'Courier New',monospace}
  header{background:linear-gradient(90deg,var(--green-d),#0b0c0a);padding:14px 20px;border-bottom:2px solid var(--green);display:flex;align-items:center;gap:14px}
  header h1{margin:0;font-size:18px;color:var(--gold);letter-spacing:1px}
  .wrap{max-width:1100px;margin:0 auto;padding:18px}
  .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
  .tab{padding:8px 14px;background:var(--card);border:1px solid #333;color:var(--text);cursor:pointer;border-radius:4px}
  .tab.active{background:var(--green);border-color:var(--green-d);color:#fff;font-weight:bold}
  input,select{background:#101109;border:1px solid #444;color:var(--text);padding:8px;border-radius:4px;font:13px 'Courier New',monospace}
  button.act{background:var(--green);border:1px solid var(--green-d);color:#fff;padding:8px 14px;border-radius:4px;cursor:pointer;font-weight:bold}
  button.danger{background:#7a2222;border-color:#491414}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid #262a1d;vertical-align:top;font-size:13px}
  th{color:var(--gold);position:sticky;top:0;background:var(--bg)}
  .panel{display:none}.panel.active{display:block}
  .pill{display:inline-block;padding:2px 6px;border-radius:3px;background:#222;color:var(--muted);font-size:11px}
  .tokrow{margin-left:auto;display:flex;gap:8px;align-items:center}
  .muted{color:var(--muted)}
</style></head>
<body>
<header><h1>ORBIT OPS SUBDIVISION - ADMIN</h1><div class="tokrow"><input id="tok" type="password" placeholder="ADMIN_TOKEN" size="28"><button class="act" onclick="saveTok()">Set</button></div></header>
<div class="wrap">
  <div class="tabs">
    <div class="tab active" data-p="chat" onclick="tab('chat')">Chat Logs</div>
    <div class="tab" data-p="online" onclick="tab('online')">Online</div>
    <div class="tab" data-p="alts" onclick="tab('alts')">Possible Alts</div>
    <div class="tab" data-p="strikes" onclick="tab('strikes')">Strikes</div>
    <div class="tab" data-p="ban" onclick="tab('ban')">Ban / Unban</div>
    <div class="tab" data-p="stats" onclick="tab('stats')">Stats</div>
  </div>

  <div id="p-chat" class="panel active">
    <div class="filters">
      <input id="c-room" placeholder="room"><input id="c-account" placeholder="account id"><input id="c-name" placeholder="name contains">
      <input id="c-q" placeholder="message contains"><input id="c-from" type="datetime-local"><input id="c-to" type="datetime-local">
      <button class="act" onclick="loadChat(0)">Search</button>
    </div>
    <div id="chat-out"></div>
  </div>

  <div id="p-online" class="panel"><button class="act" onclick="loadOnline()">Refresh</button><div id="online-out"></div></div>

  <div id="p-alts" class="panel"><button class="act" onclick="loadAlts()">Load alt clusters</button><div id="alts-out"></div></div>

  <div id="p-strikes" class="panel">
    <div class="filters"><input id="s-account" placeholder="account id"><button class="act" onclick="loadStrikes()">Load</button></div>
    <div id="strikes-out"></div>
  </div>

  <div id="p-ban" class="panel">
    <div class="filters">
      <select id="b-scope"><option value="account">account</option><option value="device">device</option></select>
      <input id="b-account" placeholder="account id"><input id="b-device" placeholder="device id (optional)">
      <input id="b-reason" placeholder="reason" size="24"><input id="b-until" type="datetime-local" title="leave empty for permanent">
      <button class="act" onclick="doBan()">Ban</button>
    </div>
    <div class="filters">
      <input id="u-banid" placeholder="ban id"><input id="u-account" placeholder="account id"><input id="u-device" placeholder="device id">
      <button class="act" onclick="doUnban()">Unban</button>
    </div>
    <div id="ban-out" class="muted"></div>
  </div>
  <div id="p-stats" class="panel">
    <h2>Leaderboard Reset</h2>
    <p class="muted">All-time reset zeros saved career totals.</p>
    <button class="act danger" onclick="resetLb('daily')">Reset Daily</button>
    <button class="act danger" onclick="resetLb('weekly')">Reset Weekly</button>
    <button class="act danger" onclick="resetLb('allTime')">Reset All Time</button>
    <pre id="stats-out"></pre>
  </div>
</div>
<script>
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function tokGet(){return localStorage.getItem('jim_admin_tok')||'';}
  function saveTok(){localStorage.setItem('jim_admin_tok',document.getElementById('tok').value);document.getElementById('ban-out').textContent='Token saved.';}
  document.getElementById('tok').value=tokGet();
  function qs(o){return Object.entries(o).filter(([,v])=>v!=='' && v!=null).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');}
  async function api(path,opts){opts=opts||{};const sep=path.includes('?')?'&':'?';const r=await fetch(path+sep+'token='+encodeURIComponent(tokGet()),opts);return r.json();}
  function tab(p){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.p===p));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));document.getElementById('p-'+p).classList.add('active');}
  async function loadChat(off){
    const p={room:c('c-room'),account:c('c-account'),name:c('c-name'),q:c('c-q'),from:c('c-from'),to:c('c-to'),limit:200,offset:off||0};
    const d=await api('/admin/api/chat-logs?'+qs(p));
    if(d.error){out('chat-out','<p class="muted">'+esc(d.error)+'</p>');return;}
    let h='<table><tr><th>time</th><th>room</th><th>name</th><th>acct</th><th>ip</th><th>message</th></tr>';
    (d.rows||[]).forEach(r=>{h+='<tr><td>'+esc(new Date(r.ts).toLocaleString())+'</td><td>'+esc(r.room_code)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.account_id)+'</td><td>'+esc(r.ip)+'</td><td>'+esc(r.message)+'</td></tr>';});
    h+='</table><button class="act" onclick="loadChat('+((off||0)+200)+')">Load more</button>';
    out('chat-out',h);
  }
  async function loadOnline(){const d=await api('/admin/api/online');let h='';(d.rooms||[]).forEach(rm=>{h+='<h3>'+esc(rm.roomCode)+' <span class="pill">'+esc(rm.gamemode)+'</span></h3><table><tr><th>name</th><th>acct</th><th>ip</th><th>K</th><th>D</th><th></th></tr>';rm.players.forEach(p=>{h+='<tr><td>'+esc(p.name)+(p.isHost?' <span class="pill">host</span>':'')+'</td><td>'+esc(p.accountId)+'</td><td>'+esc(p.ip)+'</td><td>'+esc(p.kills)+'</td><td>'+esc(p.deaths)+'</td><td><button class="act danger" onclick="quickBan('+JSON.stringify(p.accountId)+')">Ban</button></td></tr>';});h+='</table>';});out('online-out',h||'<p class="muted">No rooms</p>');}
  async function loadAlts(){const d=await api('/admin/api/alts');let h='<table><tr><th>device</th><th>fingerprint</th><th>usernames</th><th>account ids</th></tr>';(d.rows||[]).forEach(r=>{h+='<tr><td>'+esc(r.device_id)+'</td><td>'+esc(r.fingerprint)+'</td><td>'+esc((r.usernames||[]).join(', '))+'</td><td>'+esc((r.accounts_seen||[]).join(', '))+'</td></tr>';});h+='</table>';out('alts-out',h);}
  async function loadStrikes(){const a=c('s-account');const d=await api('/admin/api/strikes'+(a?'?account='+encodeURIComponent(a):''));let h='';if(d.account)h+='<p>Account '+esc(d.account.id)+' ('+esc(d.account.username)+', '+esc(d.account.email)+') — status '+esc(d.account.status)+', strikes '+esc(d.account.strikes)+'</p>';h+='<table><tr><th>time</th><th>username</th><th>device</th><th>type</th><th>detail</th></tr>';(d.violations||[]).forEach(v=>{h+='<tr><td>'+esc(new Date(v.ts).toLocaleString())+'</td><td>'+esc(v.username||v.account_id)+'</td><td>'+esc(v.device_id)+'</td><td>'+esc(v.type)+'</td><td>'+esc(v.detail)+'</td></tr>';});h+='</table>';out('strikes-out',h);}
  async function doBan(){const b={scope:c('b-scope'),accountId:c('b-account'),deviceId:c('b-device'),reason:c('b-reason'),until:c('b-until')?new Date(c('b-until')).toISOString():null};const d=await api('/admin/api/ban',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({token:tokGet()},b))});document.getElementById('ban-out').textContent=JSON.stringify(d);}
  async function quickBan(acct){if(!confirm('Ban account '+acct+'?'))return;await api('/admin/api/ban',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tokGet(),scope:'account',accountId:acct,reason:'admin quick ban'})});loadOnline();}
  async function doUnban(){const b={banId:c('u-banid'),accountId:c('u-account'),deviceId:c('u-device')};const d=await api('/admin/api/unban',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({token:tokGet()},b))});document.getElementById('ban-out').textContent=JSON.stringify(d);}
  async function resetLb(scope){if(!confirm('Reset '+scope+' leaderboard stats?'))return;const d=await api('/admin/api/reset-leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tokGet(),scope})});document.getElementById('stats-out').textContent=JSON.stringify(d,null,2);}
  function c(id){return document.getElementById(id).value.trim();}
  function out(id,h){document.getElementById(id).innerHTML=h;}
</script>
</body></html>`;

module.exports = { handle, tokenOk };
