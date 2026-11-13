'use strict';
/* ================= sincronização entre aparelhos =================
   Cada aparelho guarda as tarefas localmente (funciona offline) e, se tiver um
   código de sincronização, troca com o Supabase. Quem tem o código vê as tarefas.
   Cada tarefa é uma linha no banco; o aparelho envia só o que mudou e recebe só o
   que mudou desde a última vez. Conflitos: vale a alteração mais recente de cada
   tarefa (decidido no banco). Excluídas viram "lápide" para a exclusão se espalhar. */
const SB_URL = 'https://kxcczvsavdnpzvfmmcdq.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4Y2N6dnNhdmRucHp2Zm1tY2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjkwOTYsImV4cCI6MjA5ODYwNTA5Nn0.EQOBtgLDeEtv_9dpvvpzQEk7JsLqE_kCqRQeUfvGQEs';
const CODE_KEY = 'rotina_sync_code';
const TOMB_KEY = 'rotina_sync_tombs';
const DIRTY_KEY = 'rotina_sync_dirty';
const SINCE_KEY = 'rotina_sync_since';
const TOMB_TTL = 60 * 864e5;

const sync = {
  code: null, busy: false, again: false, timer: null, state: 'off', lastOk: 0,
  tombs: [], known: new Map(), dirty: new Set(), since: null,
};
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
try { sync.code = localStorage.getItem(CODE_KEY); } catch {}
sync.tombs = load(TOMB_KEY, []);
sync.dirty = new Set(load(DIRTY_KEY, []));
sync.since = load(SINCE_KEY, null);

const stripUpd = t => { const { upd, ...rest } = t; return JSON.stringify(rest); };
const rememberAll = () => { sync.known = new Map(tasks.map(t => [t.id, stripUpd(t)])); };
const saveMeta = () => { store(TOMB_KEY, sync.tombs); store(DIRTY_KEY, [...sync.dirty]); store(SINCE_KEY, sync.since); };
const saveLocalOnly = () => { try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch {} };

// marca o que mudou desde o último salvamento: ganha carimbo novo e entra na fila de envio
function stamp() {
  const now = Date.now();
  const ids = new Set();
  for (const t of tasks) {
    ids.add(t.id);
    const prev = sync.known.get(t.id);
    if (prev === undefined || prev !== stripUpd(t)) { t.upd = now; sync.dirty.add(t.id); }
    sync.tombs = sync.tombs.filter(x => x.id !== t.id || x.upd > (t.upd || 0));
  }
  for (const id of sync.known.keys()) {
    if (!ids.has(id)) { sync.tombs.push({ id, del: true, upd: now }); sync.dirty.add(id); }
  }
  rememberAll();
  saveLocalOnly();
  saveMeta();
}

window.afterSave = () => {
  stamp();
  if (sync.code) { clearTimeout(sync.timer); sync.timer = setTimeout(runSync, 800); }
};

// junta o que veio do servidor: em cada tarefa vale a versão mais recente
function applyRemote(items) {
  const all = new Map();
  const put = x => { if (!x || !x.id) return; const cur = all.get(x.id); if (!cur || (x.upd || 0) > (cur.upd || 0)) all.set(x.id, x); };
  tasks.forEach(put);
  sync.tombs.forEach(put);
  (items || []).forEach(put);
  const cutoff = Date.now() - TOMB_TTL;
  const merged = [...all.values()];
  tasks = merged.filter(x => !x.del);
  sync.tombs = merged.filter(x => x.del && x.upd > cutoff);
}

async function rpc(fn, body) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = r.status + '';
      try { const j = await r.json(); msg = j.code === 'PGRST202' || r.status === 404 ? 'semBanco' : (j.message || msg); } catch {}
      throw new Error(msg);
    }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    if (e.name === 'AbortError') throw new TypeError('timeout');
    throw e;
  } finally { clearTimeout(to); }
}

function setState(s, detail) {
  sync.state = s;
  const chip = $('syncChip');
  if (!sync.code) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.className = 'sync-chip' + (s === 'ok' ? ' ok' : s === 'err' ? ' err' : '');
  chip.textContent = s === 'ok' ? '☁ sincronizado' : s === 'busy' ? '☁ sincronizando…' : s === 'offline' ? '☁ sem internet' : '☁ erro';
  chip.title = detail || (s === 'ok' ? 'Última sincronização: ' + new Date(sync.lastOk).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
}

async function runSync() {
  if (!sync.code) return;
  if (sync.busy) { sync.again = true; return; }
  sync.busy = true;
  setState('busy');
  try {
    // 1) envia o que mudou aqui (em lotes)
    if (sync.dirty.size) {
      const byId = new Map([...tasks, ...sync.tombs].map(x => [x.id, x]));
      const ids = [...sync.dirty];
      for (let i = 0; i < ids.length; i += 500) {
        const lote = ids.slice(i, i + 500).map(id => byId.get(id)).filter(Boolean);
        if (lote.length) await rpc('rotina_push', { p_code: sync.code, p_items: lote });
        ids.slice(i, i + 500).forEach(id => sync.dirty.delete(id));
        saveMeta();
      }
    }
    // 2) recebe o que mudou nos outros aparelhos
    const res = await rpc('rotina_pull', { p_code: sync.code, p_since: sync.since });
    const before = JSON.stringify(tasks);
    applyRemote(res.items);
    sync.since = res.now;
    rememberAll(); saveLocalOnly(); saveMeta();
    if (JSON.stringify(tasks) !== before) render();
    sync.lastOk = Date.now();
    setState('ok');
  } catch (e) {
    if (!navigator.onLine || e instanceof TypeError) setState('offline', 'Vai sincronizar quando voltar a internet');
    else if (e.message === 'semBanco') setState('err', 'Banco de sincronização indisponível');
    else setState('err', e.message);
  } finally {
    sync.busy = false;
    if (sync.again) { sync.again = false; runSync(); }
  }
}

/* ---------- código ---------- */
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  const c = [...b].map(x => ALPH[x % ALPH.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
const normCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
const linkFor = code => `${location.origin}${location.pathname}?sync=${code}`;

function connect(code) {
  sync.code = code;
  sync.since = null;
  sync.dirty = new Set([...tasks, ...sync.tombs].map(x => x.id));
  saveMeta();
  try { localStorage.setItem(CODE_KEY, code); } catch {}
  setState('busy');
  return runSync();
}
function disconnect() {
  sync.code = null;
  try { localStorage.removeItem(CODE_KEY); } catch {}
  setState('off');
}

/* ---------- tela ---------- */
function openSheet() {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
  if (sync.code) {
    bg.innerHTML = `<div class="sheet">
      <h2>☁ Sincronização ligada</h2>
      <p>No outro aparelho, aponte a câmera para o QR code — ou abra o link, ou digite o código.</p>
      <div class="qr" id="qrBox" aria-label="QR code para conectar outro aparelho"></div>
      <div class="code">${esc(sync.code)}</div>
      <div class="row">
        <button class="pri" data-s="copy">Copiar link</button>
        <button data-s="share" ${navigator.share ? '' : 'hidden'}>Enviar…</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button data-s="now">Sincronizar agora</button>
        <button class="danger" data-s="off">Desligar aqui</button>
      </div>
      <div class="msg" id="sheetMsg"></div>
      <button class="close" data-s="close">Fechar</button>
    </div>`;
  } else {
    bg.innerHTML = `<div class="sheet">
      <h2>☁ Ver as tarefas em vários aparelhos</h2>
      <p>Crie um código aqui e use o mesmo código no celular e no computador. Quem tiver o código vê suas tarefas, então não compartilhe com outras pessoas.</p>
      <div class="row"><button class="pri" data-s="create">Criar código</button></div>
      <div class="or">ou, se já criou em outro aparelho:</div>
      <input id="codeIn" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
      <div class="row"><button data-s="join">Entrar com código</button></div>
      <div class="msg" id="sheetMsg"></div>
      <button class="close" data-s="close">Fechar</button>
    </div>`;
  }
  document.body.appendChild(bg);
  if (sync.code) drawQR();
}

// QR code com o link de conexão (biblioteca carregada só quando precisa)
let qrLib = null;
function loadQRLib() {
  if (window.qrcode) return Promise.resolve();
  if (qrLib) return qrLib;
  const urls = ['https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js'];
  const tryLoad = i => new Promise((ok, fail) => {
    if (i >= urls.length) return fail();
    const sc = document.createElement('script');
    sc.src = urls[i];
    sc.onload = ok;
    sc.onerror = () => { sc.remove(); tryLoad(i + 1).then(ok, fail); };
    document.head.appendChild(sc);
  });
  qrLib = tryLoad(0).catch(e => { qrLib = null; throw e; });
  return qrLib;
}
async function drawQR() {
  const box = $('qrBox');
  if (!box) return;
  try {
    await loadQRLib();
    const q = qrcode(0, 'M');
    q.addData(linkFor(sync.code));
    q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  } catch {
    box.innerHTML = '<span>Sem internet para gerar o QR. Use o link ou o código.</span>';
  }
}
function closeSheet() { $('sheet')?.remove(); }
const sheetMsg = m => { const el = $('sheetMsg'); if (el) el.textContent = m; };

async function copyLink() {
  const url = linkFor(sync.code);
  try { await navigator.clipboard.writeText(url); toast('Link copiado'); }
  catch { prompt('Copie o link:', url); }
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  const a = b.dataset.s;
  if (a === 'close') closeSheet();
  else if (a === 'create') {
    await connect(newCode());
    if (sync.state === 'err') { sheetMsg($('syncChip').title); return; }
    openSheet();
  } else if (a === 'join') {
    const code = normCode($('codeIn').value);
    if (code.replace(/-/g, '').length !== 12) { sheetMsg('O código tem 12 letras/números.'); return; }
    await connect(code);
    if (sync.state === 'err') { sheetMsg($('syncChip').title); return; }
    closeSheet(); toast('Aparelho conectado ✓');
  } else if (a === 'copy') copyLink();
  else if (a === 'share') { try { await navigator.share({ title: 'Rotina', text: 'Abra para sincronizar minhas tarefas', url: linkFor(sync.code) }); } catch {} }
  else if (a === 'now') { await runSync(); sheetMsg(sync.state === 'ok' ? '' : $('syncChip').title); if (sync.state === 'ok') toast('Sincronizado ✓'); }
  else if (a === 'off') { disconnect(); closeSheet(); toast('Sincronização desligada neste aparelho'); }
});
$('btnSync').addEventListener('click', openSheet);
$('syncChip').addEventListener('click', openSheet);

/* ---------- início ---------- */
rememberAll();
(() => {
  const p = new URLSearchParams(location.search);
  const c = p.get('sync');
  if (c) {
    const code = normCode(c);
    history.replaceState(null, '', location.pathname);
    if (code.replace(/-/g, '').length === 12 && code !== sync.code) {
      connect(code).then(() => { if (sync.state === 'ok') toast('Aparelho conectado ✓'); });
      return;
    }
  }
  if (sync.code) { setState('busy'); runSync(); }
})();
document.addEventListener('visibilitychange', () => { if (!document.hidden) runSync(); });
window.addEventListener('online', runSync);
setInterval(() => { if (!document.hidden) runSync(); }, 20000);
