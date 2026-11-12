'use strict';
/* ================= voz ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const btnMic = $('btnMic');
if (SR) {
  btnMic.hidden = false;
  let rec = null, listening = false, baseText = '', finalText = '';
  // palavras que separam uma tarefa da outra quando você fala
  const SPLIT = /\s*\b(?:pr[óo]xima tarefa|outra tarefa|nova tarefa|ponto final|tamb[ée]m preciso|e tamb[ée]m)\b[,.]?\s*/giu;
  const toLines = txt => txt.replace(SPLIT, '\n').split('\n').map(l => l.trim().replace(/[.,]+$/, '')).filter(Boolean).join('\n');

  const show = interim => {
    const spoken = toLines(finalText + ' ' + interim);
    entrada.value = [baseText, spoken].filter(Boolean).join('\n');
    updatePreview();
  };
  const stop = () => {
    listening = false;
    btnMic.classList.remove('rec');
    $('ouvindo').classList.remove('on');
    try { rec && rec.stop(); } catch {}
    entrada.focus();
  };
  const start = () => {
    rec = new SR();
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;
    baseText = entrada.value.trim();
    finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += '\nnova tarefa ' + r[0].transcript; // cada pausa vira uma linha
        else interim += r[0].transcript;
      }
      show(interim);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Permita o uso do microfone no navegador');
      else if (e.error === 'no-speech') toast('Não ouvi nada. Tente de novo');
      else if (e.error !== 'aborted') toast('Erro no áudio: ' + e.error);
      stop();
    };
    // alguns navegadores param sozinhos depois de um tempo: reinicia enquanto estiver ligado
    rec.onend = () => {
      if (listening) { baseText = entrada.value.trim(); finalText = ''; try { rec.start(); } catch { stop(); } }
    };
    try { rec.start(); } catch { toast('Não consegui acessar o microfone'); return; }
    listening = true;
    btnMic.classList.add('rec');
    $('ouvindo').classList.add('on');
  };
  btnMic.addEventListener('click', () => listening ? stop() : start());
}

/* ================= ações ================= */
let undoFn = null, toastTimer = null;
function toast(msg, undo) {
  $('toastMsg').textContent = msg;
  undoFn = undo || null;
  $('toastUndo').style.display = undo ? '' : 'none';
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000);
}
$('toastUndo').addEventListener('click', () => {
  if (undoFn) { undoFn(); undoFn = null; save(); render(); }
  $('toast').classList.remove('show');
});

const find = id => tasks.find(t => t.id === id);
const snapshot = () => JSON.parse(JSON.stringify(tasks));

document.addEventListener('click', e => {
  const f = e.target.closest('[data-filter]');
  if (f) { filter = f.dataset.filter; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const t = find(el.dataset.id);
  const act = el.dataset.act;
  const before = snapshot();
  const undo = () => { tasks = before; };

  if (act === 'toggle' && t) {
    if (!t.done) {
      t.done = true; t.doneAt = iso(today()); t.doneTs = Date.now();
      if (t.recur) {
        tasks.push({ ...t, id: uid(), done: false, doneAt: null, doneTs: null, due: nextOccurrence(t), created: Date.now() });
        t.recur = null;
        toast('Feito! Próxima: ' + dateLabel(tasks[tasks.length - 1].due), undo);
      } else toast('Concluída ✓', undo);
    } else { t.done = false; t.doneAt = null; t.doneTs = null; }
    openMenu = null;
  } else if (act === 'menu') {
    openMenu = openMenu === t.id ? null : t.id;
    render(); return;
  } else if (act === 'edit' && t) {
    editing = t.id; openMenu = null; render(); return;
  } else if (act === 'move' && t) {
    const to = el.dataset.to;
    t.due = to === 'none' ? null : to === 'week' ? iso(nextWeekday(1, true)) : iso(addDays(today(), +to));
    if (!t.due) t.time = null;
    openMenu = null;
    toast('Movida para ' + (t.due ? dateLabel(t.due) : 'sem data'), undo);
  } else if (act === 'prio' && t) {
    t.priority = t.priority === 'alta' ? 'normal' : 'alta';
  } else if (act === 'norecur' && t) {
    t.recur = null; openMenu = null;
  } else if (act === 'del' && t) {
    tasks = tasks.filter(x => x.id !== t.id); openMenu = null;
    toast('Tarefa excluída', undo);
  } else if (act === 'lateToday') {
    const td = iso(today());
    tasks.forEach(x => { if (!x.done && bucket(x) === 'atrasadas') x.due = td; });
    toast('Atrasadas movidas para hoje', undo);
  } else return;
  save(); render();
});

function commitEdit(input) {
  const t = find(input.dataset.edit);
  editing = null;
  if (t) {
    const v = input.value.trim();
    if (v && v !== t.title) {
      const p = parse(v);
      t.title = p.title;
      if (p.due) t.due = p.due;
      if (p.time) t.time = p.time;
      if (p.priority !== 'normal') t.priority = p.priority;
      if (p.recur) t.recur = p.recur;
      if (/#/.test(v)) t.category = p.category;
      save();
    }
  }
  render();
}
document.addEventListener('keydown', e => {
  if (e.target.matches?.('[data-edit]')) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { editing = null; render(); }
  }
});
document.addEventListener('focusout', e => { if (e.target.matches?.('[data-edit]') && editing) commitEdit(e.target); });

/* ================= backup ================= */
$('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rotina-backup-${iso(today())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw 0;
    const before = snapshot();
    const ids = new Set(tasks.map(t => t.id));
    data.forEach(t => { if (t && t.id && t.title && !ids.has(t.id)) tasks.push(t); });
    save(); render();
    toast('Backup restaurado', () => { tasks = before; });
  } catch { toast('Arquivo inválido'); }
  e.target.value = '';
});
$('btnClearDone').addEventListener('click', () => {
  const n = tasks.filter(t => t.done).length;
  if (!n) { toast('Nenhuma concluída'); return; }
  const before = snapshot();
  tasks = tasks.filter(t => !t.done);
  save(); render();
  toast(`${n} concluída${n > 1 ? 's' : ''} apagada${n > 1 ? 's' : ''}`, () => { tasks = before; });
});

// atualiza ao virar o dia / voltar para a aba
let lastDay = iso(today());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && iso(today()) !== lastDay) { lastDay = iso(today()); render(); }
});

// app instalável + offline
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('btnInstall').hidden = true;
});
window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; toast('App instalado ✓'); });

window.__parse = parse; // útil para testes
render();
updatePreview();
