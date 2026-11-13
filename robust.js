'use strict';
/* ================= robustez =================
   - conserta dados quebrados ao abrir
   - cópia automática diária (7 dias) + recuperar tarefas apagadas
   - várias abas abertas ficam em acordo
   - avisa se o armazenamento encher
   - pede ao navegador para não apagar os dados
   - erros inesperados viram aviso, não travam o app
   - busca nas tarefas */

/* ---------- erros inesperados ---------- */
let lastErrToast = 0;
function reportError(msg) {
  console.error(msg);
  if (Date.now() - lastErrToast < 5000) return;
  lastErrToast = Date.now();
  try { toast('Algo deu errado, mas suas tarefas estão salvas. Se repetir, recarregue a página.'); } catch {}
}
window.addEventListener('error', e => reportError(e.message));
window.addEventListener('unhandledrejection', e => reportError(e.reason && e.reason.message || String(e.reason)));

/* ---------- conserta dados ao abrir ---------- */
function repair(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const ok = [];
  for (const t of list) {
    if (!t || typeof t !== 'object' || typeof t.title !== 'string' || !t.title.trim()) continue;
    if (!t.id || seen.has(t.id)) t.id = uid();
    seen.add(t.id);
    if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) t.due = null;
    if (t.time && !/^\d{2}:\d{2}$/.test(t.time)) t.time = null;
    if (!['alta', 'normal', 'baixa'].includes(t.priority)) t.priority = 'normal';
    if (typeof t.category !== 'string' || !t.category) t.category = guessCategory(t.title);
    if (t.recur && !['daily', 'weekly', 'monthly', 'weekdays'].includes(t.recur.type)) t.recur = null;
    if (t.recur && t.recur.type === 'weekly' && !(t.recur.dow >= 0 && t.recur.dow <= 6)) t.recur.dow = t.due ? fromIso(t.due).getDay() : 1;
    t.done = !!t.done;
    if (typeof t.created !== 'number') t.created = Date.now();
    ok.push(t);
  }
  return ok;
}
{
  const before = JSON.stringify(tasks);
  tasks = repair(tasks);
  if (JSON.stringify(tasks) !== before) { saveLocalOnly(); rememberAll(); render(); }
}

/* ---------- armazenamento: pedir para não apagar + checar se gravou ---------- */
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}

function checkSaved() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (saved !== JSON.stringify(tasks)) {
    toast('Não consegui salvar neste aparelho (armazenamento cheio?). Baixe um backup.');
    return false;
  }
  return true;
}

/* ---------- cópia diária ---------- */
const SNAP_PREFIX = 'rotina_copia_';
const SNAP_KEEP = 7;
function snapKeys() {
  const ks = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(SNAP_PREFIX)) ks.push(k); } } catch {}
  return ks.sort();
}
function dailyCopy() {
  const k = SNAP_PREFIX + iso(today());
  try { localStorage.setItem(k, JSON.stringify(tasks)); } catch { return; }
  const ks = snapKeys();
  ks.slice(0, Math.max(0, ks.length - SNAP_KEEP)).forEach(x => { try { localStorage.removeItem(x); } catch {} });
}
let snapTimer = null;
const scheduleSnap = () => { clearTimeout(snapTimer); snapTimer = setTimeout(dailyCopy, 3000); };
dailyCopy();

/* encadeia no salvamento já existente (sincronização) */
{
  const prev = window.afterSave;
  window.afterSave = () => {
    if (prev) prev();
    if (checkSaved()) scheduleSnap();
  };
}

/* tela de cópias: recupera tarefas que existiam naquele dia e não existem mais */
function openCopies() {
  closeSheet();
  const ids = new Set(tasks.map(t => t.id));
  const rows = snapKeys().reverse().map(k => {
    let list = [];
    try { list = repair(JSON.parse(localStorage.getItem(k))); } catch {}
    const missing = list.filter(t => !ids.has(t.id));
    const d = k.slice(SNAP_PREFIX.length);
    return { k, d, total: list.length, missing: missing.length };
  });
  const bg = document.createElement('div');
  bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
  bg.innerHTML = `<div class="sheet">
    <h2>🗂 Cópias automáticas</h2>
    <p>O app guarda uma cópia por dia (últimos ${SNAP_KEEP} dias). Recuperar traz de volta as tarefas daquele dia que foram apagadas — não mexe nas que existem hoje.</p>
    <div class="copies">${rows.map(r => `<div class="copy-row">
      <div><b>${esc(dateLabel(r.d))}</b><span>${r.total} tarefas${r.missing ? ` · ${r.missing} apagada${r.missing > 1 ? 's' : ''} desde então` : ''}</span></div>
      <button data-r="restore" data-k="${esc(r.k)}" ${r.missing ? '' : 'disabled'}>Recuperar</button>
    </div>`).join('') || '<p>Nenhuma cópia ainda.</p>'}</div>
    <button class="close" data-s="close">Fechar</button>
  </div>`;
  document.body.appendChild(bg);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-r="restore"]');
  if (!b) return;
  let list = [];
  try { list = repair(JSON.parse(localStorage.getItem(b.dataset.k))); } catch {}
  const ids = new Set(tasks.map(t => t.id));
  const back = list.filter(t => !ids.has(t.id));
  if (!back.length) return;
  const before = snapshot();
  back.forEach(t => { delete t.upd; tasks.push(t); });
  save(); render(); closeSheet();
  toast(`${back.length} tarefa${back.length > 1 ? 's' : ''} recuperada${back.length > 1 ? 's' : ''}`, () => { tasks = before; });
});
{
  const btn = document.createElement('button');
  btn.textContent = 'Cópias automáticas';
  btn.addEventListener('click', openCopies);
  $('btnExport').before(btn);
}

/* ---------- várias abas: quem mudou por último vale, sem sobrescrever ---------- */
window.addEventListener('storage', e => {
  if (e.key !== KEY || e.newValue == null) return;
  let list;
  try { list = repair(JSON.parse(e.newValue)); } catch { return; }
  tasks = list;
  rememberAll();
  try { sync.tombs = load(TOMB_KEY, []); sync.dirty = new Set(load(DIRTY_KEY, [])); sync.since = load(SINCE_KEY, null); } catch {}
  if (!document.querySelector('[data-edit]')) render();
});

/* ---------- busca ---------- */
{
  const wrap = document.createElement('div');
  wrap.className = 'search';
  wrap.innerHTML = '<input id="busca" type="search" placeholder="Buscar tarefa…" autocomplete="off">';
  $('filters').before(wrap);
  const input = $('busca');
  const applySearch = () => {
    const q = norm(input.value.trim());
    wrap.classList.toggle('on', !!q);
    document.querySelectorAll('#lists .task').forEach(el => {
      const txt = norm(el.textContent);
      const hit = !q || q.split(/\s+/).every(w => txt.includes(w));
      el.style.display = hit ? '' : 'none';
      const menu = el.nextElementSibling;
      if (menu && menu.classList.contains('menu')) menu.style.display = hit ? '' : 'none';
    });
    document.querySelectorAll('#lists section, #lists details.done-box').forEach(sec => {
      const any = [...sec.querySelectorAll('.task')].some(el => el.style.display !== 'none');
      sec.style.display = any ? '' : 'none';
      if (q && any && sec.tagName === 'DETAILS') sec.open = true;
    });
    let none = $('buscaVazia');
    const anyVisible = [...document.querySelectorAll('#lists .task')].some(el => el.style.display !== 'none');
    if (q && !anyVisible) {
      if (!none) { none = document.createElement('div'); none.id = 'buscaVazia'; none.className = 'empty'; $('lists').appendChild(none); }
      none.innerHTML = `<b>Nada encontrado</b>Nenhuma tarefa com “${esc(input.value.trim())}”.`;
    } else if (none) none.remove();
  };
  input.addEventListener('input', applySearch);
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; applySearch(); } });
  const origRender = render;
  render = function () {
    const fixed = repair(tasks);
    if (fixed.length !== tasks.length) { tasks = fixed; saveLocalOnly(); }
    origRender();
    if (input.value.trim()) applySearch();
  };
}
