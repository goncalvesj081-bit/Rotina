'use strict';

/* ================= armazenamento ================= */
const KEY = 'rotina_tarefas_v1';
let tasks = [];
try { tasks = JSON.parse(localStorage.getItem(KEY)) || []; } catch { tasks = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch {} };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= estado da UI ================= */
let filter = 'Todas';
let openMenu = null;
let editing = null;

const $ = id => document.getElementById(id);
const entrada = $('entrada'), preview = $('preview'), btnAdd = $('btnAdd');

function bucket(t) {
  if (!t.due) return 'semdata';
  const td = iso(today()), n = diffDays(t.due, td);
  if (n < 0) return 'atrasadas';
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanha';
  const dow = today().getDay();
  const toSunday = dow === 0 ? 0 : 7 - dow;
  if (n <= toSunday) return 'semana';
  return 'depois';
}
const SECTIONS = [
  ['atrasadas', 'Atrasadas', 'late'],
  ['hoje', 'Hoje', 'hoje'],
  ['amanha', 'Amanhã', ''],
  ['semana', 'Esta semana', ''],
  ['depois', 'Próximas', ''],
  ['semdata', 'Sem data', ''],
];
const PRI = { alta: 0, normal: 1, baixa: 2 };
function sortTasks(a, b) {
  if (a.due !== b.due) return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
  if (a.priority !== b.priority) return PRI[a.priority] - PRI[b.priority];
  if (a.time !== b.time) return (a.time || '99') < (b.time || '99') ? -1 : 1;
  return a.created - b.created;
}

/* ================= render ================= */
function taskHTML(t, sec) {
  const tags = [];
  if (t.due && !t.done && sec !== 'hoje' && sec !== 'amanha') {
    tags.push(`<span class="tag ${sec === 'atrasadas' ? 'date-late' : ''}">${esc(dateLabel(t.due))}</span>`);
  }
  if (t.done && t.doneAt) tags.push(`<span class="tag">feito ${esc(dateLabel(t.doneAt))}</span>`);
  if (t.time) tags.push(`<span class="tag ${sec === 'hoje' ? 'date-today' : ''}">${t.time}</span>`);
  if (t.priority === 'alta') tags.push('<span class="tag alta">urgente</span>');
  if (t.priority === 'baixa') tags.push('<span class="tag baixa">sem pressa</span>');
  if (t.recur) tags.push(`<span class="tag rec">↻ ${esc(recurLabel(t.recur))}</span>`);
  tags.push(`<span class="tag">${esc(t.category)}</span>`);

  const titleHTML = editing === t.id
    ? `<input class="edit" data-edit="${t.id}" value="${esc(t.title)}">`
    : `<div class="title" data-act="edit" data-id="${t.id}">${esc(t.title)}</div>`;

  const menu = openMenu === t.id ? `<div class="menu">
      <button data-act="move" data-to="0" data-id="${t.id}">Hoje</button>
      <button data-act="move" data-to="1" data-id="${t.id}">Amanhã</button>
      <button data-act="move" data-to="week" data-id="${t.id}">Próx. semana</button>
      <button data-act="move" data-to="none" data-id="${t.id}">Sem data</button>
      <button data-act="prio" data-id="${t.id}">${t.priority === 'alta' ? 'Tirar urgência' : 'Marcar urgente'}</button>
      ${t.recur ? `<button data-act="norecur" data-id="${t.id}">Parar de repetir</button>` : ''}
      <button class="del" data-act="del" data-id="${t.id}">Excluir</button>
    </div>` : '';

  return `<div class="task p-${t.priority} ${t.done ? 'done' : ''}">
      <button class="check" data-act="toggle" data-id="${t.id}" aria-label="Concluir"></button>
      <div class="body">${titleHTML}<div class="meta">${tags.join('')}</div></div>
      <button class="more" data-act="menu" data-id="${t.id}" aria-label="Opções">⋯</button>
    </div>${menu}`;
}

function render() {
  const td = iso(today());
  const d = today();
  $('hojeLabel').textContent = `${DOW_FULL[d.getDay()]}, ${d.getDate()} de ${['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][d.getMonth()]}`;

  const pending = tasks.filter(t => !t.done);
  const nLate = pending.filter(t => bucket(t) === 'atrasadas').length;
  const nToday = pending.filter(t => bucket(t) === 'hoje').length;
  const nDoneToday = tasks.filter(t => t.done && t.doneAt === td).length;
  $('summary').innerHTML = tasks.length ? `
    <div class="stat"><b>${nToday}</b><span>para hoje</span></div>
    ${nLate ? `<div class="stat late"><b>${nLate}</b><span>atrasada${nLate > 1 ? 's' : ''}</span></div>` : ''}
    <div class="stat"><b>${pending.length}</b><span>pendentes</span></div>
    <div class="stat"><b>${nDoneToday}</b><span>feitas hoje</span></div>` : '';

  const cats = [...new Set(tasks.map(t => t.category))].sort();
  if (filter !== 'Todas' && !cats.includes(filter)) filter = 'Todas';
  $('filters').innerHTML = cats.length > 1
    ? ['Todas', ...cats].map(c => {
        const n = c === 'Todas' ? pending.length : pending.filter(t => t.category === c).length;
        return `<button class="chip ${filter === c ? 'on' : ''}" data-filter="${esc(c)}">${esc(c)} ${n ? '· ' + n : ''}</button>`;
      }).join('')
    : '';

  const visible = tasks.filter(t => filter === 'Todas' || t.category === filter);
  const vPending = visible.filter(t => !t.done).sort(sortTasks);
  const vDone = visible.filter(t => t.done).sort((a, b) => (b.doneTs || 0) - (a.doneTs || 0));

  let html = '';
  if (!tasks.length) {
    html = `<div class="empty"><b>Nada por aqui ainda</b>Escreva suas tarefas acima — eu separo por dia, prioridade e assunto.</div>`;
  } else if (!vPending.length) {
    html = `<div class="empty"><b>Tudo em dia ✓</b>Nenhuma tarefa pendente${filter !== 'Todas' ? ' em ' + esc(filter) : ''}.</div>`;
  }
  for (const [key, label, cls] of SECTIONS) {
    const items = vPending.filter(t => bucket(t) === key);
    if (!items.length) continue;
    const extra = key === 'atrasadas' && items.length > 1
      ? `<button data-act="lateToday">Mover todas p/ hoje</button>` : '';
    html += `<section><div class="sec-h ${cls}">${label} <span class="n">${items.length}</span>${extra}</div>
      <div class="list">${items.map(t => taskHTML(t, key)).join('')}</div></section>`;
  }
  if (vDone.length) {
    const shown = vDone.slice(0, 30);
    html += `<details class="done-box" ${doneOpen ? 'open' : ''}><summary>Concluídas · ${vDone.length}</summary>
      <div class="list">${shown.map(t => taskHTML(t, 'done')).join('')}</div></details>`;
  }
  $('lists').innerHTML = html;

  const ed = document.querySelector('[data-edit]');
  if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
}
let doneOpen = false;
document.addEventListener('toggle', e => { if (e.target.classList?.contains('done-box')) doneOpen = e.target.open; }, true);

/* ================= entrada ================= */
const lines = () => entrada.value.split('\n').map(l => l.trim()).filter(Boolean);

function updatePreview() {
  entrada.style.height = 'auto';
  entrada.style.height = entrada.scrollHeight + 'px';
  const ls = lines();
  btnAdd.disabled = !ls.length;
  btnAdd.textContent = ls.length > 1 ? `Adicionar ${ls.length}` : 'Adicionar';
  if (ls.length !== 1) { preview.innerHTML = ls.length > 1 ? `<span>${ls.length} tarefas</span>` : ''; return; }
  const p = parse(ls[0]);
  const bits = [];
  bits.push(p.due ? dateLabel(p.due) : 'sem data');
  if (p.time) bits.push(p.time);
  if (p.priority === 'alta') bits.push('urgente');
  if (p.priority === 'baixa') bits.push('sem pressa');
  if (p.recur) bits.push('↻ ' + recurLabel(p.recur));
  bits.push(p.category);
  preview.innerHTML = '→ ' + bits.map(b => `<span class="tag">${esc(b)}</span>`).join('');
}

function addFromInput() {
  const ls = lines();
  if (!ls.length) return;
  const now = Date.now();
  ls.forEach((l, i) => {
    const p = parse(l);
    tasks.push({ id: uid(), title: p.title, due: p.due, time: p.time, priority: p.priority, category: p.category, recur: p.recur, done: false, created: now + i });
  });
  save();
  entrada.value = '';
  updatePreview();
  render();
  toast(ls.length > 1 ? `${ls.length} tarefas adicionadas` : 'Tarefa adicionada');
}

entrada.addEventListener('input', updatePreview);
entrada.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addFromInput(); }
});
btnAdd.addEventListener('click', () => { addFromInput(); entrada.focus(); });
