'use strict';
/* ================= datas ================= */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((fromIso(a) - fromIso(b)) / 864e5);
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DOW_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function nextWeekday(dow, forceNext) {
  const t = today();
  let delta = (dow - t.getDay() + 7) % 7;
  if (forceNext && delta === 0) delta = 7;
  return addDays(t, delta);
}

/* ================= interpretador de texto ================= */
const END = '(?=$|[\\s,.;:!?)])';
const S = '(^|\\s)';
const WD = { 'domingo': 0, 'segunda': 1, 'terca': 2, 'terça': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'sábado': 6 };
const WD_RE = '(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)(?:-feira)?';
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CATS = [
  { id: 'Trabalho', kw: ['reuniao', 'email', 'e-mail', 'cliente', 'relatorio', 'projeto', 'apresentacao', 'planilha', 'chefe', 'trabalho', 'entregar', 'proposta', 'call', 'meet', 'enviar', 'responder', 'orcamento', 'contrato'] },
  { id: 'Finanças', kw: ['pagar', 'boleto', 'conta ', 'contas', 'fatura', 'pix', 'banco', 'imposto', 'irpf', 'cartao', 'transferir', 'aluguel', 'condominio', 'dinheiro', 'cobrar', 'nota fiscal'] },
  { id: 'Saúde', kw: ['medico', 'dentista', 'academia', 'remedio', 'exame', 'consulta', 'treino', 'treinar', 'correr', 'corrida', 'caminhar', 'yoga', 'terapia', 'psicolog', 'vacina', 'farmacia', 'beber agua', 'dormir', 'nutri'] },
  { id: 'Estudos', kw: ['estudar', 'prova', 'curso', 'aula', 'livro', 'ler ', 'leitura', 'faculdade', 'trabalho da', 'tcc', 'revisar', 'exercicio', 'ingles', 'idioma'] },
  { id: 'Casa', kw: ['limpar', 'lavar', 'mercado', 'compras', 'comprar', 'cozinhar', 'roupa', 'louca', 'lixo', 'arrumar', 'consertar', 'faxina', 'casa', 'passar roupa', 'regar', 'cachorro', 'gato', 'pet'] },
];

function guessCategory(title) {
  const t = ' ' + norm(title) + ' ';
  let best = null, bestScore = 0;
  for (const c of CATS) {
    let score = 0;
    for (const k of c.kw) if (t.includes(' ' + k) || t.includes(k + ' ')) score++;
    if (score > bestScore) { best = c.id; bestScore = score; }
  }
  return best || 'Pessoal';
}

function parse(raw) {
  let s = ' ' + raw.trim() + ' ';
  const out = { due: null, time: null, priority: 'normal', category: null, recur: null };
  const take = (re, fn) => {
    s = s.replace(new RegExp(re, 'iu'), (...m) => { fn(m); return ' '; });
  };
  const t = today();

  // números por extenso (comum quando vem de áudio)
  const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30 };
  s = s.replace(/(^|\s)(um|uma|dois|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta)(?=\s+(dias?|horas?|da|de|e meia)\b)/giu,
    (_, a, w) => a + NUM[w.toLowerCase()]);
  s = s.replace(/(^|\s)(?:ao\s+)?meio[- ]dia(?:\s+e\s+meia)?(?=$|[\s,.;:!?)])/giu, (m, a) => a + (/meia/i.test(m) ? '12:30' : '12h'));
  s = s.replace(/(^|\s)meia[- ]noite(?=$|[\s,.;:!?)])/giu, (_, a) => a + '0h');
  // "3 da tarde", "8 da noite", "9 da manhã", "às 3 e meia da tarde", "15 horas"
  s = s.replace(/(^|\s)(?:([àa]s|a partir das)\s+)?(\d{1,2})(?:\s*(?:horas?|h))?(\s+e\s+meia|:(\d{2}))?\s+(?:horas?\s+)?(da|de)\s+(manh[ãa]|tarde|noite|madrugada)(?=$|[\s,.;:!?)])/giu,
    (_, a, as, h, extra, mins, __, per) => {
      let hh = +h; const p = norm(per);
      if ((p === 'tarde' || p === 'noite') && hh < 12) hh += 12;
      const mm = extra ? (mins || '30') : '00';
      return `${a}${pad(hh)}:${mm}`;
    });
  s = s.replace(/(^|\s)(\d{1,2})\s+horas?(?:\s+e\s+meia)?(?=$|[\s,.;:!?)])/giu, (m, a, h) => `${a}${pad(+h)}:${/meia/i.test(m) ? '30' : '00'}`);
  s = s.replace(/(^|\s)(\d{1,2})\s+e\s+meia(?=$|[\s,.;:!?)])/giu, (_, a, h) => `${a}${pad(+h)}:30`);

  // recorrência
  take(S + '(todo dia|todos os dias|diariamente|di[áa]rio)' + END, () => { out.recur = { type: 'daily' }; });
  take(S + '(?:toda|todo|todas as|todos os)\\s+' + WD_RE + 's?' + END, m => {
    const dow = WD[norm(m[2])] ?? WD[m[2].toLowerCase()];
    out.recur = { type: 'weekly', dow }; out.due = iso(nextWeekday(dow));
  });
  take(S + '(toda semana|todas as semanas|semanalmente)' + END, () => { out.recur = { type: 'weekly' }; });
  take(S + '(todo m[êe]s|todos os meses|mensalmente)' + END, () => { out.recur = { type: 'monthly' }; });
  take(S + '(dias [úu]teis|seg(?:unda)? a sex(?:ta)?)' + END, () => { out.recur = { type: 'weekdays' }; });

  // datas relativas
  take(S + '(depois de amanh[ãa])' + END, () => { out.due = iso(addDays(t, 2)); });
  take(S + '(amanh[ãa])' + END, () => { out.due = iso(addDays(t, 1)); });
  take(S + '(hoje|hj|agora)' + END, () => { out.due = iso(t); });
  take(S + '(ontem)' + END, () => { out.due = iso(addDays(t, -1)); });
  take(S + '(semana que vem|pr[óo]xima semana)' + END, () => { out.due = iso(nextWeekday(1, true)); });
  take(S + '((?:no |neste |nesse |este |esse )?fim de semana|(?:no |neste |nesse )?fds)' + END, () => { out.due = iso(nextWeekday(6)); });
  take(S + '(m[êe]s que vem|pr[óo]ximo m[êe]s)' + END, () => { out.due = iso(new Date(t.getFullYear(), t.getMonth() + 1, 1)); });
  take(S + '(?:(pr[óo]xim[ao])\\s+|(?:na|no|nesta|neste|nessa|nesse|esta|este|essa|esse)\\s+)?' + WD_RE + END, m => {
    const dow = WD[norm(m[3])];
    out.due = iso(nextWeekday(dow, !!m[2]));
  });
  // dd/mm(/aaaa)
  take(S + '(?:dia\\s+)?(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?' + END, m => {
    const d = +m[2], mo = +m[3] - 1;
    let y = m[4] ? +m[4] : t.getFullYear();
    if (y < 100) y += 2000;
    let dt = new Date(y, mo, d);
    if (!m[4] && (t - dt) > 60 * 864e5) dt = new Date(y + 1, mo, d);
    if (dt.getDate() === d) out.due = iso(dt);
  });
  // "dia 15"
  take(S + 'dia\\s+(\\d{1,2})' + END, m => {
    const d = +m[2];
    if (d < 1 || d > 31) return;
    let dt = new Date(t.getFullYear(), t.getMonth(), d);
    if (dt < t || dt.getDate() !== d) dt = new Date(t.getFullYear(), t.getMonth() + 1, d);
    out.due = iso(dt);
  });
  // "em 3 dias"
  take(S + '(?:em|daqui a)\\s+(\\d{1,3})\\s+dias?' + END, m => { out.due = iso(addDays(t, +m[2])); });

  // horário: 14h, 14h30, 14:30, às 9
  take(S + '(?:(?:[àa]s|a partir das)\\s+(\\d{1,2})(?:(?:h|:)(\\d{2})?)?|(\\d{1,2})(?:h(\\d{2})?|:(\\d{2})))' + END, m => {
    const h = +(m[2] ?? m[4]), mi = +(m[3] ?? m[5] ?? m[6] ?? 0);
    if (h <= 23 && mi <= 59) out.time = `${pad(h)}:${pad(mi)}`;
  });

  // prioridade
  if (/!/.test(s)) { out.priority = 'alta'; s = s.replace(/!+/g, ' '); }
  take(S + '(é urgente|urgente|important[ei]|prioridade alta|prioridade|asap)' + END, () => { out.priority = 'alta'; });
  take(S + '(quando der|sem pressa|algum dia|baixa prioridade)' + END, () => { out.priority = 'baixa'; });

  // categoria explícita
  take(S + '#([\\p{L}\\d_-]+)', m => {
    const v = m[2];
    const found = CATS.find(c => norm(c.id) === norm(v)) || (norm(v) === 'pessoal' && { id: 'Pessoal' });
    out.category = found ? found.id : v.charAt(0).toUpperCase() + v.slice(1);
  });

  let title = s.replace(/\s+/g, ' ').trim().replace(/^[-–•*]\s*/, '').replace(/\s+(e|de|para|pra|no|na|até|ate)$/i, '');
  if (!title) title = raw.trim();
  out.title = title.charAt(0).toUpperCase() + title.slice(1);
  if (!out.category) out.category = guessCategory(out.title);
  if (out.time && !out.due) out.due = iso(t);
  if (out.recur && !out.due) {
    if (out.recur.type === 'weekdays') { let d = t; while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1); out.due = iso(d); }
    else out.due = iso(t);
  }
  if (out.recur && out.recur.type === 'weekly' && out.recur.dow == null) out.recur.dow = fromIso(out.due).getDay();
  return out;
}

function nextOccurrence(task) {
  const r = task.recur, base = fromIso(task.due || iso(today()));
  let d;
  if (r.type === 'daily') d = addDays(base, 1);
  else if (r.type === 'weekly') d = addDays(base, 7);
  else if (r.type === 'monthly') d = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
  else if (r.type === 'weekdays') { d = addDays(base, 1); while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1); }
  // se ficou no passado, avança até hoje ou depois
  const t = today();
  while (d < t) {
    if (r.type === 'daily') d = addDays(d, 1);
    else if (r.type === 'weekly') d = addDays(d, 7);
    else if (r.type === 'monthly') d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    else { d = addDays(d, 1); while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1); }
  }
  return iso(d);
}

/* ================= rótulos ================= */
function dateLabel(due) {
  const td = iso(today()), n = diffDays(due, td), d = fromIso(due);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n < 0) return `há ${-n} dias`;
  if (n < 7) return DOW_FULL[d.getDay()];
  return `${DOW[d.getDay()]}, ${d.getDate()} ${MES[d.getMonth()]}`;
}
function recurLabel(r) {
  if (!r) return '';
  if (r.type === 'daily') return 'todo dia';
  if (r.type === 'weekdays') return 'dias úteis';
  if (r.type === 'monthly') return 'todo mês';
  return 'toda ' + DOW_FULL[r.dow];
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

