import { sb } from './supabase.js';
import { ctx, q, today, addDays, weekStart, br, dloc, fmtMin, getSubjects, form, run, empty, chip, pct, bar } from './core.js';
import { $, esc, icon } from './ui.js';
import { loadRaw, windowOf, measure, summary, activeDays, ACH, MISSIONS, missionKey } from './gamify.js';
import { levelInfo, LEVELS } from './xp.js';
import { cols, line } from './charts.js';

const PER = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' }, MET = { topics: 'conteúdos concluídos', questions: 'questões', minutes: 'minutos de estudo' };

export async function metas(view) {
  const [subs, goals, r] = await Promise.all([getSubjects(), q(sb.from('goals').select('*').order('created_at', { ascending: false })), loadRaw()]);
  const sm = Object.fromEntries(subs.map(s => [s.id, s])), t = today();
  const active = goals.filter(g => !g.valid_to || g.valid_to >= t), past = goals.filter(g => g.valid_to && g.valid_to < t);
  const times = (g) => r.xp.filter(e => e.ref_id === g.id).length;
  const label = (g) => `${PER[g.period]}: ${g.target} ${MET[g.metric]}${g.subject_id ? ' em ' + (sm[g.subject_id]?.name || 'matéria') : ''}`;
  view.innerHTML = `<div class="row between"><h1>Metas</h1><button class="btn primary" id="add" style="width:auto">Nova meta</button></div>
  <h3>Em andamento</h3>${active.length ? active.map(g => { const v = measure(r, g.metric, windowOf(g.period, t), g.subject_id), p = pct(v, g.target);
    return `<article class="card"><div class="row between"><b>${esc(label(g))}</b><span class="muted">${v} de ${g.target}${p >= 100 ? ' · cumprida' : ''}</span></div>${bar(p, p >= 100 ? 'var(--green)' : '')}
    <div class="row"><span class="muted">Cumprida ${times(g)} vez(es) desde ${br(g.valid_from)}</span><button class="btn sm" data-a="edit" data-id="${g.id}">Editar</button><button class="btn sm danger" data-a="end" data-id="${g.id}">Encerrar</button></div></article>`; }).join('')
    : empty('Nenhuma meta ativa', 'Defina uma meta diária, semanal ou mensal para acompanhar seu ritmo.')}
  <h3>Histórico</h3>${past.length ? past.map(g => `<article class="card item"><div class="grow"><b>${esc(label(g))}</b><div class="muted">${br(g.valid_from)} a ${br(g.valid_to)} · cumprida ${times(g)} vez(es)</div></div></article>`).join('') : '<p class="muted">Metas encerradas ou editadas aparecem aqui, com o histórico preservado.</p>'}`;
  const fields = (g) => [
    { name: 'period', label: 'Período', type: 'select', options: Object.entries(PER).map(([k, v]) => [k, v]) },
    { name: 'metric', label: 'O que medir', type: 'select', options: Object.entries(MET) },
    { name: 'target', label: 'Quantidade desejada', type: 'number', required: true, min: 1 },
    { name: 'subject_id', label: 'Matéria (opcional)', type: 'select', options: [['', '— Todas —'], ...subs.map(s => [s.id, s.name])] }];
  const reload = () => metas(view);
  $('#add', view).onclick = async () => { const v = await form('Nova meta', fields(), { period: 'daily', metric: 'minutes' }); if (v && await run(() => q(sb.from('goals').insert(v)), 'Meta criada.')) reload(); };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const g = goals.find(x => x.id === b.dataset.id);
    if (b.dataset.a === 'edit') {
      const v = await form('Editar meta', fields(g), g); if (!v) return;
      // Editar encerra a meta antiga e cria uma nova, preservando o histórico.
      const ok = await run(async () => { if (g.valid_from >= t) await q(sb.from('goals').update(v).eq('id', g.id)); else { await q(sb.from('goals').update({ valid_to: addDays(t, -1) }).eq('id', g.id)); await q(sb.from('goals').insert(v)); } }, 'Meta atualizada. O histórico anterior foi mantido.');
      if (ok) reload();
    }
    if (b.dataset.a === 'end' && confirm('Encerrar esta meta? O histórico dela continua salvo.')) { if (await run(() => g.valid_from >= t ? q(sb.from('goals').delete().eq('id', g.id)) : q(sb.from('goals').update({ valid_to: addDays(t, -1) }).eq('id', g.id)), 'Meta encerrada.')) reload(); }
  };
}

export async function conquistas(view) {
  const [r, subs] = await Promise.all([loadRaw(), getSubjects()]), s = summary(r), lv = levelInfo(ctx.profile.xp), t = today(), got = Object.fromEntries(r.un.map(u => [u.code, u.unlocked_at]));
  const days = new Set(s.days), start = addDays(weekStart(t), -77);
  const ev = [{ d: dloc(ctx.profile.created_at), t: 'Você começou sua jornada no StudyVerse' }];
  const first = (arr, f, txt) => { const d = arr.map(f).filter(Boolean).sort()[0]; if (d) ev.push({ d, t: txt }); };
  first(r.topics.filter(x => x.status === 'done'), x => x.completed_at && dloc(x.completed_at), 'Primeiro conteúdo concluído');
  first(r.ex, x => x.done_on, 'Primeiros exercícios registrados'); first(r.ses, x => dloc(x.started_at), 'Primeira sessão de estudo'); first(r.revs, x => x.done_at && dloc(x.done_at), 'Primeira revisão concluída');
  r.un.forEach(u => ev.push({ d: dloc(u.unlocked_at), t: `Conquista: ${ACH.find(a => a.code === u.code)?.name ?? u.code}` }));
  let acc = 0, L = 1; [...r.xp].sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(x => { acc += x.amount; const n = levelInfo(acc).n; while (L < n) { L++; ev.push({ d: dloc(x.created_at), t: `Chegou ao nível ${L}: ${LEVELS[L - 1].name}` }); } });
  ev.sort((a, b) => a.d.localeCompare(b.d));
  view.innerHTML = `<h1>Conquistas</h1>
  <section class="card"><div class="row between"><b>Nível ${lv.n} · ${lv.name}</b><span class="muted">${ctx.profile.xp} XP</span></div>${bar(lv.pct)}<span class="muted">${lv.next ? `Faltam ${lv.toNext} XP para ${lv.next.name}` : 'Nível máximo alcançado'}</span></section>
  <div class="grid"><div class="card stat"><b>${s.current}</b><span>sequência atual (dias)</span></div><div class="card stat"><b>${s.best}</b><span>maior sequência</span></div><div class="card stat"><b>${s.days.length}</b><span>dias estudados no total</span></div></div>
  <section class="card"><h3>Calendário de atividade</h3><div class="heat" aria-label="Últimas 12 semanas">${Array.from({ length: 84 }, (_, i) => { const d = addDays(start, i); return `<i class="${days.has(d) ? 'on' : ''} ${d > t ? 'fut' : ''}" title="${br(d)}${days.has(d) ? ' · ativo' : ''}"></i>`; }).join('')}</div>
  <p class="muted">Um dia de descanso entre dois dias ativos não quebra a sequência.</p></section>
  <h3>Missões</h3><div class="grid">${MISSIONS.map(m => { const v = measure(r, m.metric, windowOf(m.period, t)), d = v >= m.target || r.xp.some(e => e.reason === missionKey(m, t));
    return `<article class="card"><div class="row between"><b>${m.label}</b><span class="muted">${m.period === 'daily' ? 'Hoje' : 'Semana'} · +${m.xp} XP</span></div>${bar(pct(v, m.target), d ? 'var(--green)' : '')}<span class="muted">${Math.min(v, m.target)} de ${m.target}${d ? ' · concluída' : ''}</span></article>`; }).join('')}</div>
  <h3>Galeria</h3><div class="grid">${ACH.map(a => `<article class="card ach ${got[a.code] ? 'on' : ''}"><div class="medal">${icon(a.icon)}</div><b>${a.name}</b><p class="muted">${a.desc}</p><span class="muted">${got[a.code] ? 'Desbloqueada em ' + new Date(got[a.code]).toLocaleDateString('pt-BR') : 'Bloqueada'}</span></article>`).join('')}</div>
  <h3>Linha do tempo</h3><ol class="timeline">${ev.map(x => `<li><b>${br(x.d)}</b> ${esc(x.t)}</li>`).join('')}</ol>`;
}

const X = { period: '30', subject: '' };
export async function estatisticas(view) {
  const [subs, r, goals] = await Promise.all([getSubjects(), loadRaw(), q(sb.from('goals').select('*'))]);
  const t = today(), cut = X.period ? addDays(t, -Number(X.period)) : '0000-00-00', sid = X.subject, inP = (d) => d >= cut, sub = (x) => !sid || x.subject_id === sid;
  const ses = r.ses.filter(x => inP(dloc(x.started_at)) && sub(x)), ex = r.ex.filter(x => inP(x.done_on) && sub(x)), done = r.topics.filter(x => x.status === 'done' && x.completed_at && inP(dloc(x.completed_at)) && sub(x));
  const mins = (a) => Math.round(a.reduce((s, x) => s + x.seconds, 0) / 60), allSes = r.ses.filter(sub);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(weekStart(t), -7 * (7 - i)));
  const wk = weeks.map(w => ({ label: br(w).slice(0, 5), value: +(mins(allSes.filter(x => { const d = dloc(x.started_at); return d >= w && d <= addDays(w, 6); })) / 60).toFixed(1) }));
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d.toLocaleDateString('sv').slice(0, 7); });
  const mo = months.map(m => ({ label: m.slice(5) + '/' + m.slice(2, 4), value: +(mins(allSes.filter(x => dloc(x.started_at).slice(0, 7) === m)) / 60).toFixed(1) }));
  const dow = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((l, i) => ({ label: l, value: mins(ses.filter(x => (new Date(x.started_at).getDay() + 6) % 7 === i)) }));
  const xpw = weeks.map(w => ({ label: br(w).slice(0, 5), value: r.xp.filter(x => { const d = dloc(x.created_at); return d >= w && d <= addDays(w, 6); }).reduce((s, x) => s + x.amount, 0) }));
  const byDay = {}; ex.forEach(x => { const d = (byDay[x.done_on] ||= { t: 0, c: 0 }); d.t += x.total; d.c += x.correct; });
  const pts = Object.keys(byDay).sort().slice(-30).map(d => ({ label: br(d), value: pct(byDay[d].c, byDay[d].t) }));
  const tot = ex.reduce((s, x) => s + x.total, 0), ok = ex.reduce((s, x) => s + x.correct, 0);
  const hist = [...ses.map(x => ({ d: dloc(x.started_at), t: `Sessão de estudo: ${fmtMin(Math.round(x.seconds / 60))}` })), ...ex.map(x => ({ d: x.done_on, t: `Exercícios: ${x.total} questões (${pct(x.correct, x.total)}%)` })), ...done.map(x => ({ d: dloc(x.completed_at), t: 'Conteúdo concluído' }))].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 12);
  const act = goals.filter(g => !g.valid_to || g.valid_to >= t);
  const opts = (arr, cur, all) => (all ? `<option value="">${all}</option>` : '') + arr.map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  view.innerHTML = `<h1>Estatísticas</h1><div class="row" style="margin:12px 0"><select id="xp" aria-label="Período">${opts([['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Último ano'], ['', 'Todo o período']], X.period)}</select>
  <select id="xs" aria-label="Matéria">${opts(subs.map(s => [s.id, s.name]), X.subject, 'Todas as matérias')}</select></div>
  <div class="grid"><div class="card stat"><b>${fmtMin(mins(ses))}</b><span>estudados no período</span></div><div class="card stat"><b>${done.length}</b><span>conteúdos concluídos</span></div><div class="card stat"><b>${tot}</b><span>questões realizadas</span></div><div class="card stat"><b>${pct(ok, tot)}%</b><span>aproveitamento</span></div></div>
  <div class="grid wide"><section class="card"><h3>Horas por semana</h3>${cols(wk, v => v + 'h')}</section><section class="card"><h3>Horas por mês</h3>${cols(mo, v => v + 'h')}</section>
  <section class="card"><h3>Dias mais produtivos (min)</h3>${cols(dow)}</section><section class="card"><h3>XP por semana</h3>${cols(xpw)}</section>
  <section class="card"><h3>Conteúdos concluídos por matéria</h3>${cols(subs.map(s => ({ label: s.name, value: done.filter(x => x.subject_id === s.id).length, color: s.color })))}</section>
  <section class="card"><h3>Aproveitamento nas questões</h3>${line(pts)}</section></div>
  <section class="card"><h3>Evolução por matéria</h3>${subs.map(s => { const a = r.topics.filter(x => x.subject_id === s.id), d = a.filter(x => x.status === 'done').length; return `<div class="row between"><span>${chip(s)}</span><span class="muted">${d} de ${a.length} · ${pct(d, a.length)}%</span></div>${bar(pct(d, a.length), s.color)}`; }).join('') || '<p class="muted">Crie matérias para acompanhar o progresso.</p>'}</section>
  <section class="card" style="margin-top:16px"><h3>Cumprimento de metas (período atual)</h3>${act.length ? act.map(g => { const v = measure(r, g.metric, windowOf(g.period, t), g.subject_id); return `<div class="row between"><span>${PER[g.period]}: ${g.target} ${MET[g.metric]}</span><span class="muted">${v} de ${g.target}</span></div>${bar(pct(v, g.target), pct(v, g.target) >= 100 ? 'var(--green)' : '')}`; }).join('') : '<p class="muted">Nenhuma meta ativa.</p>'}</section>
  <section class="card" style="margin-top:16px"><h3>Histórico de atividades</h3>${hist.length ? hist.map(x => `<p><b>${br(x.d)}</b> <span class="muted">${esc(x.t)}</span></p>`).join('') : '<p class="muted">Sem atividades no período.</p>'}</section>`;
  $('#xp', view).onchange = (e) => { X.period = e.target.value; estatisticas(view); }; $('#xs', view).onchange = (e) => { X.subject = e.target.value; estatisticas(view); };
}
