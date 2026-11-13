'use strict';
/* ================= recursos extras =================
   - etapas (subtarefas) dentro de cada tarefa
   - modo foco (Pomodoro 25 min + pausa de 5)
   - lembretes no horário da tarefa (com o app aberto/instalado)
   - aviso de nova versão */

/* ---------- utilidades ---------- */
const fid = () => Math.random().toString(36).slice(2, 9);
const findT = id => tasks.find(t => t.id === id);
function cleanSubs(t) {
  if (!Array.isArray(t.subs)) { if (t.subs != null) delete t.subs; return; }
  t.subs = t.subs
    .filter(s => s && typeof s.text === 'string' && s.text.trim())
    .map(s => ({ id: s.id || fid(), text: s.text.trim().slice(0, 200), done: !!s.done }));
  if (!t.subs.length) delete t.subs;
}
tasks.forEach(cleanSubs);

/* tarefas repetidas: a próxima ocorrência começa com as etapas desmarcadas e sem dividir a mesma lista */
{
  const prev = window.afterSave;
  window.afterSave = () => {
    const seen = new Map();
    for (const t of tasks) {
      if (!Array.isArray(t.subs)) continue;
      if (seen.has(t.subs)) t.subs = t.subs.map(s => ({ ...s, id: fid(), done: t.done ? s.done : false }));
      seen.set(t.subs, t);
    }
    if (prev) prev();
  };
}

/* ---------- desenho: etapas + foco + botões no menu ---------- */
let addingSubFor = null;
function decorate() {
  document.querySelectorAll('#lists .task').forEach(el => {
    const id = el.querySelector('[data-act="toggle"]')?.dataset.id;
    const t = id && findT(id);
    if (!t) return;
    const body = el.querySelector('.body');
    const meta = body.querySelector('.meta');
    const subs = t.subs || [];
    if (subs.length) {
      const n = subs.filter(s => s.done).length;
      const tag = document.createElement('span');
      tag.className = 'tag' + (n === subs.length ? ' sub-ok' : '');
      tag.textContent = `☑ ${n}/${subs.length}`;
      meta.prepend(tag);
    }
    if (t.focos) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.title = 'Sessões de foco';
      tag.textContent = `🍅 ${t.focos}`;
      meta.append(tag);
    }
    if (subs.length || addingSubFor === t.id) {
      const box = document.createElement('div');
      box.className = 'subs';
      box.innerHTML = subs.map(s => `<div class="sub ${s.done ? 'done' : ''}">
          <button class="sub-check" data-f="subtoggle" data-id="${t.id}" data-sub="${s.id}" aria-label="Marcar etapa"></button>
          <span>${esc(s.text)}</span>
          <button class="sub-del" data-f="subdel" data-id="${t.id}" data-sub="${s.id}" aria-label="Remover etapa">×</button>
        </div>`).join('') +
        (addingSubFor === t.id
          ? `<input class="sub-in" data-subadd="${t.id}" placeholder="Nova etapa… (Enter para adicionar)">`
          : (t.done ? '' : `<button class="sub-add" data-f="subnew" data-id="${t.id}">+ etapa</button>`));
      body.appendChild(box);
    }
    const menu = el.nextElementSibling;
    if (menu && menu.classList.contains('menu') && !menu.querySelector('[data-f]')) {
      const del = menu.querySelector('.del');
      const b1 = document.createElement('button');
      b1.dataset.f = 'subnew'; b1.dataset.id = t.id; b1.textContent = '☑ Etapas';
      const b2 = document.createElement('button');
      b2.dataset.f = 'foco'; b2.dataset.id = t.id; b2.textContent = '🍅 Focar 25 min';
      menu.insertBefore(b1, del); menu.insertBefore(b2, del);
    }
  });
  const inp = document.querySelector('[data-subadd]');
  if (inp) inp.focus();
}
{
  const prevRender = render;
  render = function () { prevRender(); try { decorate(); } catch (e) { console.error(e); } };
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  const t = findT(b.dataset.id);
  const f = b.dataset.f;
  if (f === 'subnew' && t) { addingSubFor = t.id; openMenu = null; render(); return; }
  if (f === 'subtoggle' && t) {
    const s = t.subs.find(x => x.id === b.dataset.sub);
    if (!s) return;
    s.done = !s.done;
    save(); render();
    if (t.subs.every(x => x.done) && !t.done) toast('Todas as etapas feitas! Toque no círculo para concluir a tarefa.');
    return;
  }
  if (f === 'subdel' && t) {
    const before = snapshot();
    t.subs = t.subs.filter(x => x.id !== b.dataset.sub);
    cleanSubs(t);
    save(); render();
    toast('Etapa removida', () => { tasks = before; });
    return;
  }
  if (f === 'foco' && t) { openMenu = null; render(); startFocus(t.id); }
});
document.addEventListener('keydown', e => {
  const inp = e.target.closest && e.target.closest('[data-subadd]');
  if (!inp) return;
  if (e.key === 'Escape') { addingSubFor = null; render(); return; }
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const t = findT(inp.dataset.subadd);
  const txt = inp.value.trim();
  if (!t) return;
  if (!txt) { addingSubFor = null; render(); return; }
  // aceita várias de uma vez separadas por vírgula ou ponto e vírgula
  const parts = txt.split(/\s*[;,]\s*/).filter(Boolean);
  t.subs = [...(t.subs || []), ...parts.map(p => ({ id: fid(), text: p, done: false }))];
  cleanSubs(t);
  save(); render();
});
document.addEventListener('focusout', e => {
  if (e.target.matches && e.target.matches('[data-subadd]') && !e.target.value.trim()) {
    setTimeout(() => { if (addingSubFor && !document.querySelector('[data-subadd]:focus')) { addingSubFor = null; render(); } }, 150);
  }
});

/* ---------- modo foco ---------- */
const FOCUS_KEY = 'rotina_foco';
const FOCO_MIN = 25, PAUSA_MIN = 5;
let foco = null;            // { id, kind:'foco'|'pausa', end, left (ms, se pausado) }
let focusTick = null;
try { foco = JSON.parse(localStorage.getItem(FOCUS_KEY)); } catch {}
const saveFocus = () => { try { foco ? localStorage.setItem(FOCUS_KEY, JSON.stringify(foco)) : localStorage.removeItem(FOCUS_KEY); } catch {} };

function startFocus(id, kind = 'foco') {
  const mins = kind === 'foco' ? FOCO_MIN : PAUSA_MIN;
  foco = { id, kind, end: Date.now() + mins * 60000, left: null };
  saveFocus();
  askNotify(false);
  showFocus();
}
function remaining() { return foco.left != null ? foco.left : Math.max(0, foco.end - Date.now()); }
function fmt(ms) { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

function showFocus() {
  if (!foco) return;
  let ov = $('focusOv');
  if (!ov) { ov = document.createElement('div'); ov.id = 'focusOv'; ov.className = 'foco-ov'; document.body.appendChild(ov); }
  const t = findT(foco.id);
  const paused = foco.left != null;
  ov.className = 'foco-ov ' + foco.kind;
  ov.innerHTML = `<div class="foco-box">
    <div class="foco-kind">${foco.kind === 'foco' ? '🍅 Foco' : '☕ Pausa'}</div>
    <div class="foco-title">${t ? esc(t.title) : ''}</div>
    <div class="foco-time" id="focusTime">${fmt(remaining())}</div>
    <div class="foco-btns">
      <button data-fo="pause">${paused ? 'Continuar' : 'Pausar'}</button>
      ${foco.kind === 'foco' && t && !t.done ? '<button data-fo="done" class="pri">Concluí a tarefa</button>' : ''}
      <button data-fo="stop">Parar</button>
    </div>
    <div class="foco-hint">${foco.kind === 'foco' ? 'Só esta tarefa até o tempo acabar. O resto espera.' : 'Levante, beba água, respire.'}</div>
  </div>`;
  clearInterval(focusTick);
  focusTick = setInterval(tickFocus, 500);
  document.title = `${fmt(remaining())} · Rotina`;
}
function hideFocus() { clearInterval(focusTick); $('focusOv')?.remove(); document.title = 'Rotina'; }

function tickFocus() {
  if (!foco) return hideFocus();
  const ms = remaining();
  const el = $('focusTime');
  if (el) el.textContent = fmt(ms);
  document.title = `${fmt(ms)} · Rotina`;
  if (ms > 0 || foco.left != null) return;
  // acabou
  const t = findT(foco.id);
  beep();
  if (foco.kind === 'foco') {
    if (t) { t.focos = (t.focos || 0) + 1; save(); render(); }
    notify('🍅 Foco concluído', t ? `"${t.title}" — hora de uma pausa de ${PAUSA_MIN} min` : 'Hora de uma pausa');
    startFocus(foco.id, 'pausa');
  } else {
    notify('☕ Pausa acabou', 'Bora para a próxima?');
    foco = null; saveFocus(); hideFocus();
    toast('Pausa acabou. Toque em ⋯ → Focar para outra rodada.');
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-fo]');
  if (!b || !foco) return;
  const a = b.dataset.fo;
  if (a === 'pause') {
    if (foco.left != null) { foco.end = Date.now() + foco.left; foco.left = null; }
    else { foco.left = remaining(); }
    saveFocus(); showFocus();
  } else if (a === 'stop') {
    foco = null; saveFocus(); hideFocus();
  } else if (a === 'done') {
    const t = findT(foco.id);
    foco = null; saveFocus(); hideFocus();
    if (t && !t.done) document.querySelector(`[data-act="toggle"][data-id="${t.id}"]`)?.click();
  }
});

let audioCtx = null;
function beep() {
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach(at => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + at + 0.25);
      o.start(audioCtx.currentTime + at); o.stop(audioCtx.currentTime + at + 0.3);
    });
  } catch {}
}

/* ---------- lembretes ---------- */
const REM_KEY = 'rotina_lembretes';       // 'on' | 'off'
const SENT_KEY = 'rotina_lembretes_enviados';
const canNotify = 'Notification' in window;
let sent = new Set();
try { sent = new Set(JSON.parse(localStorage.getItem(SENT_KEY)) || []); } catch {}
const remOn = () => { try { return localStorage.getItem(REM_KEY) === 'on' && canNotify && Notification.permission === 'granted'; } catch { return false; } };

async function notify(title, body, tag) {
  if (!canNotify || Notification.permission !== 'granted') return;
  const opts = { body, tag: tag || title, icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [200, 100, 200] };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(title, opts); return; }
  } catch {}
  try { new Notification(title, opts); } catch {}
}
async function askNotify(explicit) {
  if (!canNotify) { if (explicit) toast('Este navegador não permite notificações.'); return false; }
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  if (Notification.permission !== 'granted') { if (explicit) toast('Notificações bloqueadas. Libere nas configurações do navegador.'); return false; }
  return true;
}

// verifica a cada 20s: avisa 10 min antes e na hora
function checkReminders() {
  if (!remOn()) return;
  const now = new Date();
  const td = iso(today());
  for (const t of tasks) {
    if (t.done || !t.time || t.due !== td) continue;
    const [h, m] = t.time.split(':').map(Number);
    const at = new Date(); at.setHours(h, m, 0, 0);
    const diff = at - now;
    const k1 = `${t.id}|${t.due}|${t.time}|antes`, k2 = `${t.id}|${t.due}|${t.time}|hora`;
    if (diff <= 10 * 60000 && diff > 60000 && !sent.has(k1)) { sent.add(k1); notify(`⏰ Em 10 min: ${t.title}`, `Às ${t.time}`, k1); }
    if (diff <= 0 && diff > -15 * 60000 && !sent.has(k2)) { sent.add(k2); sent.add(k1); notify(`⏰ Agora: ${t.title}`, `Marcado para ${t.time}`, k2); }
  }
  // limpa registros antigos
  const keep = [...sent].filter(k => k.split('|')[1] >= td);
  sent = new Set(keep);
  try { localStorage.setItem(SENT_KEY, JSON.stringify(keep)); } catch {}
}
setInterval(checkReminders, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); if (foco) showFocus(); } });

function updateRemButton() {
  const b = $('btnRem');
  if (b) b.textContent = remOn() ? '🔔 Lembretes ligados' : '🔕 Ligar lembretes';
}
{
  const b = document.createElement('button');
  b.id = 'btnRem';
  b.addEventListener('click', async () => {
    if (remOn()) { try { localStorage.setItem(REM_KEY, 'off'); } catch {} updateRemButton(); toast('Lembretes desligados'); return; }
    if (!(await askNotify(true))) return;
    try { localStorage.setItem(REM_KEY, 'on'); } catch {}
    updateRemButton();
    toast('Lembretes ligados: aviso 10 min antes e na hora das tarefas com horário.');
    notify('🔔 Lembretes ligados', 'É assim que os avisos vão aparecer.', 'teste');
    checkReminders();
  });
  $('btnSync').after(b);
  updateRemButton();
}

/* ---------- aviso de nova versão ---------- */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return;
    shown = true;
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = '<span>Nova versão do app disponível.</span><button>Atualizar</button>';
    bar.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(bar);
  });
}

/* ---------- início ---------- */
render();
if (foco) {
  if (!findT(foco.id)) { foco = null; saveFocus(); } else showFocus();
}
checkReminders();
