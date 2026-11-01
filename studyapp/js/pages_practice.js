import { sb } from './supabase.js';
import { ctx, q, today, addDays, br, dloc, fmtMin, getSubjects, form, run, empty, info, chip, pct, bar } from './core.js';
import { $, esc, toast } from './ui.js';
import { award, refresh } from './gamify.js';
import { line } from './charts.js';
import { setStudying } from './presence.js';

const E = { subject: '', period: '' };
export async function exercicios(view) {
  const [subs, topics, all] = await Promise.all([getSubjects(), q(sb.from('topics').select('id,title,subject_id')),
    q(sb.from('exercises').select('*').order('done_on', { ascending: false }).order('created_at', { ascending: false }))]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), tm = Object.fromEntries(topics.map(x => [x.id, x])), cut = E.period ? addDays(today(), -Number(E.period)) : null;
  const list = all.filter(x => (!E.subject || x.subject_id === E.subject) && (!cut || x.done_on >= cut));
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0), tot = sum(list, 'total'), ok = sum(list, 'correct'), bad = sum(list, 'wrong');
  const byDay = {}; list.forEach(x => { const d = (byDay[x.done_on] ||= { t: 0, c: 0 }); d.t += x.total; d.c += x.correct; });
  const pts = Object.keys(byDay).sort().slice(-30).map(d => ({ label: br(d), value: pct(byDay[d].c, byDay[d].t) }));
  const opts = (arr, cur, all) => `<option value="">${all}</option>` + arr.map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  view.innerHTML = `<div class="row between"><h1>Exercícios</h1><button class="btn primary" id="add" style="width:auto">Registrar exercícios</button></div>
  <div class="row" style="margin:12px 0"><select id="fs" aria-label="Matéria">${opts(subs.map(s => [s.id, s.name]), E.subject, 'Todas as matérias')}</select>
  <select id="fp" aria-label="Período">${opts([['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']], E.period, 'Todo o período')}</select></div>
  <div class="grid"><div class="card stat"><b>${tot}</b><span>questões realizadas</span></div><div class="card stat"><b>${ok}</b><span>acertos</span></div><div class="card stat"><b>${bad}</b><span>erros</span></div>
  <div class="card stat"><b>${pct(ok, tot)}%</b><span>aproveitamento (acertos ÷ questões)</span></div></div>
  <section class="card"><h3>Evolução do aproveitamento</h3>${line(pts)}</section>
  <section class="card" style="margin-top:16px"><h3>Por matéria</h3>${subs.map(s => { const l = list.filter(x => x.subject_id === s.id); if (!l.length) return ''; const t = sum(l, 'total'), c = sum(l, 'correct');
    return `<div><div class="row between"><span>${chip(s)} ${l.length} registro(s) · ${t} questões</span><b>${pct(c, t)}%</b></div>${bar(pct(c, t), s.color)}</div>`; }).join('') || '<p class="muted">Sem registros ainda.</p>'}</section>
  <h3>Histórico</h3>${list.length ? list.map(x => `<article class="card item"><div class="grow"><b>${br(x.done_on)}</b> ${chip(sm[x.subject_id])} ${x.topic_id && tm[x.topic_id] ? `<span class="muted">${esc(tm[x.topic_id].title)}</span>` : ''}
    <div class="muted">${x.total} questões · ${x.correct} acertos · ${x.wrong} erros${x.skipped ? ` · ${x.skipped} sem resposta` : ''} · ${pct(x.correct, x.total)}%${x.source ? ' · ' + esc(x.source) : ''}</div>${x.notes ? `<p class="muted">${esc(x.notes)}</p>` : ''}</div>
    <button class="btn sm" data-a="edit" data-id="${x.id}">Editar</button><button class="btn sm danger" data-a="del" data-id="${x.id}">Excluir</button></article>`).join('') : empty('Nenhum exercício registrado', 'Registrar a prática é diferente de concluir um conteúdo. Cada um conta do seu jeito.')}`;
  const fields = [
    { name: 'subject_id', label: 'Matéria', type: 'select', required: true, options: subs.map(s => [s.id, s.name]) },
    { name: 'topic_id', label: 'Conteúdo relacionado (opcional)', type: 'select', options: [['', '— Nenhum —'], ...topics.map(x => [x.id, `${sm[x.subject_id]?.name} · ${x.title}`])] },
    { name: 'done_on', label: 'Data', type: 'date', required: true, def: today() },
    { name: 'total', label: 'Questões realizadas', type: 'number', required: true, min: 1 }, { name: 'correct', label: 'Acertos', type: 'number', required: true, min: 0 },
    { name: 'wrong', label: 'Erros', type: 'number', required: true, min: 0 }, { name: 'source', label: 'Fonte (apostila, plataforma, prova, simulado…)' }, { name: 'notes', label: 'Observações', type: 'textarea' },
  ];
  const valid = (v) => v.correct + v.wrong > v.total ? 'Acertos + erros não podem passar do total de questões.' : (v.topic_id && tm[v.topic_id]?.subject_id !== v.subject_id ? 'O conteúdo escolhido não pertence à matéria selecionada.' : '');
  const row = (v) => ({ ...v, skipped: v.total - v.correct - v.wrong });
  const reload = () => exercicios(view);
  $('#add', view).onclick = async () => {
    if (!subs.length) return toast('Crie uma matéria primeiro, em Minhas matérias.', 'error');
    const v = await form('Registrar exercícios', fields, { subject_id: E.subject }, valid); if (!v) return;
    const ok2 = await run(async () => { const id = (await q(sb.from('exercises').insert(row(v)).select('id').single())).id; await award('exercise', 10, id, 3); await refresh(); }, 'Exercícios registrados.');
    if (ok2) reload();
  };
  $('#fs', view).onchange = (e) => { E.subject = e.target.value; reload(); };
  $('#fp', view).onchange = (e) => { E.period = e.target.value; reload(); };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const x = all.find(y => y.id === b.dataset.id);
    if (b.dataset.a === 'edit') { const v = await form('Editar registro', fields, x, valid); if (v && await run(async () => { await q(sb.from('exercises').update(row(v)).eq('id', x.id)); await refresh(); }, 'Registro atualizado.')) reload(); }
    if (b.dataset.a === 'del' && confirm('Excluir este registro de exercícios?')) { if (await run(() => q(sb.from('exercises').delete().eq('id', x.id)), 'Registro excluído.')) reload(); }
  };
}

// Estado do cronômetro fica no módulo: continua rodando ao trocar de página.
const T = { run: false, started: null, mode: 'free', last: 0, study: 0, phaseMs: 0, phase: 'work', subject_id: null, topic_id: null, work: 25, brk: 5, timer: null };
try { const p = JSON.parse(localStorage.getItem('sv-pomo')); if (p?.work) { T.work = p.work; T.brk = p.brk; } } catch {}
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function paint() {
  const el = document.getElementById('clock'); if (!el) return;
  const pomo = T.mode === 'pomodoro';
  el.textContent = pomo ? mmss((T.phase === 'work' ? T.work : T.brk) * 60000 - T.phaseMs) : mmss(T.study);
  const ph = document.getElementById('phase'); if (ph) ph.textContent = !T.started ? 'Pronto para começar' : !T.run ? 'Pausado' : pomo ? (T.phase === 'work' ? 'Foco' : 'Pausa') : 'Estudando';
  const st = document.getElementById('studied'); if (st) st.textContent = `Tempo estudado: ${fmtMin(Math.floor(T.study / 60000))}`;
}
function tick() {
  const n = Date.now(), d = n - T.last; T.last = n; if (!T.run) return;
  if (T.mode === 'free' || T.phase === 'work') T.study += d;
  T.phaseMs += d;
  if (T.mode === 'pomodoro' && T.phaseMs >= (T.phase === 'work' ? T.work : T.brk) * 60000) {
    T.phaseMs = 0; T.phase = T.phase === 'work' ? 'break' : 'work';
    toast(T.phase === 'break' ? 'Hora de uma pausa!' : 'Pausa encerrada. Vamos voltar ao foco.'); document.title = T.phase === 'break' ? 'Pausa · StudyVerse' : 'Foco · StudyVerse';
  }
  paint();
}

export async function sessoes(view) {
  const [subs, topics, ses] = await Promise.all([getSubjects(), q(sb.from('topics').select('id,title,subject_id')), q(sb.from('study_sessions').select('*').order('started_at', { ascending: false }))]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), tm = Object.fromEntries(topics.map(x => [x.id, x])), t = today();
  const mins = (arr) => Math.round(arr.reduce((s, x) => s + x.seconds, 0) / 60), ws = addDays(t, -((new Date(t + 'T12:00').getDay() + 6) % 7));
  const act = T.started !== null, loc = (x) => dloc(x.started_at);
  view.innerHTML = `<h1>Sessões de estudo</h1>
  <section class="card timer"><div class="row"><label style="flex:1;margin:0">Matéria<select id="ss" ${act ? 'disabled' : ''}><option value="">— Livre —</option>${subs.map(s => `<option value="${s.id}" ${s.id === T.subject_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
  <label style="flex:1;margin:0">Conteúdo<select id="st" ${act ? 'disabled' : ''}></select></label></div>
  <div class="row" style="margin:14px 0"><label style="margin:0">Modo<select id="sm" ${act ? 'disabled' : ''}><option value="free" ${T.mode === 'free' ? 'selected' : ''}>Livre</option><option value="pomodoro" ${T.mode === 'pomodoro' ? 'selected' : ''}>Pomodoro</option></select></label>
  <label style="margin:0">Foco (min)<input id="sw" type="number" min="1" max="120" value="${T.work}" ${act ? 'disabled' : ''}></label><label style="margin:0">Pausa (min)<input id="sb" type="number" min="1" max="60" value="${T.brk}" ${act ? 'disabled' : ''}></label></div>
  <div class="clock" id="clock" role="timer">00:00</div><p class="muted" id="phase" style="text-align:center;margin:0"></p><p class="muted" id="studied" style="text-align:center"></p>
  <div class="row" style="justify-content:center"><button class="btn primary" id="go" style="width:auto">${T.run ? 'Pausar' : act ? 'Retomar' : 'Iniciar'}</button><button class="btn" id="end" style="width:auto" ${act ? '' : 'disabled'}>Finalizar</button></div></section>
  <div class="grid"><div class="card stat"><b>${fmtMin(mins(ses.filter(x => loc(x) === t)))}</b><span>hoje</span></div><div class="card stat"><b>${fmtMin(mins(ses.filter(x => loc(x) >= ws)))}</b><span>esta semana</span></div>
  <div class="card stat"><b>${fmtMin(mins(ses))}</b><span>total</span></div><div class="card stat"><b>${ses.length ? fmtMin(Math.round(mins(ses) / ses.length)) : '0min'}</b><span>média por sessão (${ses.length})</span></div></div>
  <h3>Histórico</h3>${ses.length ? ses.slice(0, 15).map(x => `<article class="card item"><div class="grow"><b>${new Date(x.started_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</b> ${chip(sm[x.subject_id])} ${x.topic_id && tm[x.topic_id] ? `<span class="muted">${esc(tm[x.topic_id].title)}</span>` : ''}
  <div class="muted">${fmtMin(Math.round(x.seconds / 60))} · ${x.mode === 'pomodoro' ? 'Pomodoro' : 'Livre'}</div></div><button class="btn sm danger" data-del="${x.id}">Excluir</button></article>`).join('') : empty('Nenhuma sessão ainda', 'Inicie o cronômetro para registrar seu tempo de estudo automaticamente.')}`;
  const fill = () => { const sid = $('#ss', view).value; $('#st', view).innerHTML = '<option value="">— Nenhum —</option>' + topics.filter(x => !sid || x.subject_id === sid).map(x => `<option value="${x.id}" ${x.id === T.topic_id ? 'selected' : ''}>${esc(x.title)}</option>`).join(''); };
  fill(); paint(); $('#ss', view).onchange = fill;
  const reload = () => sessoes(view);
  $('#go', view).onclick = async () => {
    if (!T.started) {
      const w = Number($('#sw', view).value), bk = Number($('#sb', view).value);
      if (!(w >= 1 && w <= 120 && bk >= 1 && bk <= 60)) return toast('Informe tempos válidos para o Pomodoro (foco 1–120, pausa 1–60 min).', 'error');
      Object.assign(T, { started: new Date().toISOString(), study: 0, phaseMs: 0, phase: 'work', mode: $('#sm', view).value, subject_id: $('#ss', view).value || null, topic_id: $('#st', view).value || null, work: w, brk: bk });
      try { localStorage.setItem('sv-pomo', JSON.stringify({ work: w, brk: bk })); } catch {}
      const { error: se } = await sb.rpc('start_study_session', { p_subject: T.subject_id, p_topic: T.topic_id, p_mode: T.mode });
      if (se) { T.started = null; return toast('Não foi possível iniciar a sessão. Verifique a conexão e se o social.sql foi executado.', 'error'); }
    }
    if (T.run) { tick(); T.run = false; setStudying(false); } else { T.run = true; T.last = Date.now(); clearInterval(T.timer); T.timer = setInterval(tick, 500); setStudying(true); }
    reload();
  };
  $('#end', view).onclick = async () => {
    tick(); T.run = false; setStudying(false); clearInterval(T.timer); const secs = Math.round(T.study / 1000);
    if (secs < 60 && !confirm('Sessões com menos de 1 minuto não são registradas. Descartar esta sessão?')) { T.run = true; T.last = Date.now(); T.timer = setInterval(tick, 500); setStudying(true); return; }
    if (secs < 60) await sb.rpc('cancel_study_session');
    let xp = 0;
    if (secs >= 60) {
      const ok = await run(async () => {
        const id = await q(sb.rpc('finish_study_session', { p_seconds: secs })); if (!id) throw new Error('sessão curta');
        if (T.topic_id) { const tp = await q(sb.from('topics').select('minutes_spent').eq('id', T.topic_id).single()); await q(sb.from('topics').update({ minutes_spent: tp.minutes_spent + Math.round(secs / 60) }).eq('id', T.topic_id)); }
        if (secs >= 300) { const b = ctx.profile.xp; await award('session', 10, id, 5); xp = ctx.profile.xp - b; }
        await refresh();
      });
      if (!ok) { T.run = false; return reload(); }
      await info('Sessão concluída', `<p><b>${fmtMin(Math.round(secs / 60))}</b> de estudo${T.subject_id ? ` em ${esc(sm[T.subject_id]?.name)}` : ''}.</p><p class="muted">${xp ? `+${xp} XP conquistados.` : 'Sessões a partir de 5 minutos rendem XP.'}</p>`);
    }
    Object.assign(T, { started: null, study: 0, phaseMs: 0 }); document.title = 'StudyVerse'; reload();
  };
  view.onclick = async (e) => { const id = e.target.dataset?.del; if (id && confirm('Excluir esta sessão?')) { if (await run(() => q(sb.from('study_sessions').delete().eq('id', id)), 'Sessão excluída.')) reload(); } };
}
