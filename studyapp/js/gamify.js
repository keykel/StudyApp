import { sb } from './supabase.js';
import { ctx, q, today, dloc, addDays, weekStart, br } from './core.js';
import { levelInfo } from './xp.js';
import { toast, esc } from './ui.js';

export async function loadRaw() {
  const [topics, ex, ses, acts, revs, xp, un] = await Promise.all([
    q(sb.from('topics').select('id,subject_id,status,completed_at,studied_on,minutes_spent')),
    q(sb.from('exercises').select('id,subject_id,done_on,total,correct,wrong,skipped')),
    q(sb.from('study_sessions').select('id,subject_id,started_at,seconds')),
    q(sb.from('activities').select('id,subject_id,kind,done,done_at,scheduled_for')),
    q(sb.from('reviews').select('id,done_at,due_on')),
    q(sb.from('xp_events').select('reason,amount,ref_id,created_at')),
    q(sb.from('achievements_unlocked').select('code,unlocked_at')),
  ]);
  return { topics, ex, ses, acts, revs, xp, un };
}

const lastDay = (t) => { const d = new Date(t + 'T12:00'); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('sv'); };
export function windowOf(period, t = today()) {
  if (period === 'daily') return [t, t];
  if (period === 'weekly') { const s = weekStart(t); return [s, addDays(s, 6)]; }
  return [t.slice(0, 7) + '-01', lastDay(t)];
}
export function measure(r, metric, [a, b], subj) {
  const inw = (d) => d >= a && d <= b, sub = (x) => !subj || x.subject_id === subj;
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  if (metric === 'topics') return r.topics.filter(x => x.status === 'done' && x.completed_at && inw(dloc(x.completed_at)) && sub(x)).length;
  if (metric === 'questions') return sum(r.ex.filter(x => inw(x.done_on) && sub(x)), x => x.total);
  if (metric === 'sessions') return r.ses.filter(x => inw(dloc(x.started_at)) && sub(x)).length;
  if (metric === 'reviews') return r.revs.filter(x => x.done_at && inw(dloc(x.done_at))).length;
  return Math.round(sum(r.ses.filter(x => inw(dloc(x.started_at)) && sub(x)), x => x.seconds) / 60);
}

export function activeDays(r) {
  const s = new Set();
  r.ses.forEach(x => s.add(dloc(x.started_at))); r.ex.forEach(x => s.add(x.done_on));
  r.topics.forEach(x => x.completed_at && s.add(dloc(x.completed_at)));
  r.acts.forEach(x => x.done_at && s.add(dloc(x.done_at))); r.revs.forEach(x => x.done_at && s.add(dloc(x.done_at)));
  return [...s].sort();
}
// Um dia de descanso entre dois dias ativos não quebra a sequência.
export function streaks(days) {
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && (new Date(d) - new Date(prev)) / 864e5 <= 2 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const last = days[days.length - 1];
  const alive = last && (new Date(today()) - new Date(last)) / 864e5 <= 2;
  return { current: alive ? run : 0, best };
}
export function summary(r) {
  const days = activeDays(r);
  return { topicsDone: r.topics.filter(t => t.status === 'done').length, questions: r.ex.reduce((a, x) => a + x.total, 0), exCount: r.ex.length,
    minutes: Math.round(r.ses.reduce((a, x) => a + x.seconds, 0) / 60), days, ...streaks(days), reasons: r.xp.map(x => x.reason) };
}

export const ACH = [
  { code: 'first_step', name: 'Primeiro Passo', desc: 'Conclua seu primeiro conteúdo.', icon: 'check', test: s => s.topicsDone >= 1 },
  { code: 'good_start', name: 'Começando Bem', desc: 'Conclua 5 conteúdos.', icon: 'list', test: s => s.topicsDone >= 5 },
  { code: 'persistence', name: 'Persistência', desc: 'Estude em 5 dias diferentes.', icon: 'calendar', test: s => s.days.length >= 5 },
  { code: 'productive_week', name: 'Semana Produtiva', desc: 'Cumpra uma meta semanal.', icon: 'target', test: s => s.reasons.some(x => x.startsWith('goal_weekly:')) },
  { code: 'knowledge', name: 'Conhecimento Acumulado', desc: 'Conclua 50 conteúdos.', icon: 'book', test: s => s.topicsDone >= 50 },
  { code: 'practitioner', name: 'Praticante', desc: 'Registre seus primeiros exercícios.', icon: 'check', test: s => s.exCount >= 1 },
  { code: 'analytic', name: 'Mente Analítica', desc: 'Resolva 200 questões.', icon: 'chart', test: s => s.questions >= 200 },
  { code: 'organizer', name: 'Mestre da Organização', desc: 'Conclua todas as atividades de uma semana planejada (mín. 3).', icon: 'calendar', test: s => s.reasons.some(x => x.startsWith('week_plan:')) },
  { code: 'focus', name: 'Foco Total', desc: 'Acumule 10 horas em sessões de estudo.', icon: 'clock', test: s => s.minutes >= 600 },
  { code: 'streak7', name: 'Sequência de 7', desc: 'Alcance 7 dias ativos em sequência.', icon: 'trophy', test: s => s.best >= 7 },
];
export const MISSIONS = [
  { code: 'd_topics2', period: 'daily', label: 'Estudar dois conteúdos', metric: 'topics', target: 2, xp: 15 },
  { code: 'd_sessions3', period: 'daily', label: 'Completar três sessões de estudo', metric: 'sessions', target: 3, xp: 15 },
  { code: 'd_q20', period: 'daily', label: 'Resolver 20 questões', metric: 'questions', target: 20, xp: 15 },
  { code: 'w_review1', period: 'weekly', label: 'Revisar um conteúdo antigo', metric: 'reviews', target: 1, xp: 20 },
  { code: 'w_min120', period: 'weekly', label: 'Dedicar 2 horas ao estudo', metric: 'minutes', target: 120, xp: 25 },
];
const missionKey = (m, t = today()) => `mission:${m.code}:${m.period === 'daily' ? t : weekStart(t)}`;
export { missionKey };

export async function notify(kind, message, pref = kind) {
  if (ctx.profile.notif_prefs?.[pref] === false) return;
  await sb.from('notifications').insert({ kind, message });
}

function levelUp(lv) {
  const o = document.createElement('div'); o.className = 'levelup';
  o.innerHTML = `<div class="card"><div class="burst" aria-hidden="true"></div><h2>Nível ${lv.n}</h2><p>${esc(lv.name)}</p><button class="btn primary" style="width:auto">Continuar</button></div>`;
  o.querySelector('button').onclick = () => o.remove(); document.body.append(o);
  notify('nivel', `Você chegou ao nível ${lv.n}: ${lv.name}.`, 'conquistas');
}

// Concede XP pelo servidor. "cap" limita quantas vezes o mesmo tipo de ação rende XP por dia.
export async function award(reason, amount, ref = ctx.profile.id, cap = 0) {
  if (cap) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const { count } = await sb.from('xp_events').select('id', { count: 'exact', head: true }).eq('reason', reason).gte('created_at', start.toISOString());
    if (count >= cap) return;
  }
  const before = ctx.profile.xp;
  const { data, error } = await sb.rpc('award_xp', { p_reason: reason, p_amount: amount, p_ref: ref });
  if (error) throw error;
  if (data > before) {
    ctx.profile.xp = data; toast(`+${data - before} XP`);
    const a = levelInfo(before), b = levelInfo(data); if (b.n > a.n) levelUp(b);
  }
}

// Reavalia metas, planejamento semanal, missões e conquistas depois de qualquer registro.
export async function refresh() {
  try {
    const r = await loadRaw(), t = today(), has = (x) => r.xp.some(e => e.reason === x);
    const goals = await q(sb.from('goals').select('*').lte('valid_from', t));
    for (const g of goals) {
      if (g.valid_to && g.valid_to < t) continue;
      const w = windowOf(g.period, t), key = `goal_${g.period}:${w[0]}`;
      if (!has(key) && measure(r, g.metric, w, g.subject_id) >= g.target) {
        await award(key, { daily: 15, weekly: 30, monthly: 50 }[g.period], g.id);
        notify('metas', `Meta ${{ daily: 'diária', weekly: 'semanal', monthly: 'mensal' }[g.period]} cumprida. Bom trabalho!`);
      }
    }
    const ws = weekStart(t), wa = r.acts.filter(a => a.scheduled_for >= ws && a.scheduled_for <= addDays(ws, 6));
    if (wa.length >= 3 && wa.every(a => a.done) && !has(`week_plan:${ws}`)) await award(`week_plan:${ws}`, 25);
    for (const m of MISSIONS) {
      const key = missionKey(m, t);
      if (!has(key) && measure(r, m.metric, windowOf(m.period, t)) >= m.target) { await award(key, m.xp); toast(`Missão cumprida: ${m.label}`); }
    }
    const s = summary({ ...r, xp: await q(sb.from('xp_events').select('reason')) });
    const got = new Set(r.un.map(u => u.code));
    for (const a of ACH) {
      if (got.has(a.code) || !a.test(s)) continue;
      const { error } = await sb.from('achievements_unlocked').insert({ code: a.code });
      if (!error) { toast(`Conquista desbloqueada: ${a.name}`); notify('conquistas', `Conquista desbloqueada: ${a.name}.`); }
    }
  } catch (e) { console.error('refresh', e); }
}

export async function generateNotifications() {
  const p = ctx.profile.notif_prefs || {}, t = today(), tm = addDays(t, 1);
  const [acts, revs, old, goals] = await Promise.all([
    q(sb.from('activities').select('title,scheduled_for,start_time').eq('done', false).lte('scheduled_for', tm)),
    q(sb.from('reviews').select('id').is('done_at', null).lte('due_on', t)),
    q(sb.from('notifications').select('message').gte('created_at', new Date(Date.now() - 3 * 864e5).toISOString())),
    q(sb.from('goals').select('*').eq('period', 'daily').lte('valid_from', t)),
  ]);
  const seen = new Set(old.map(o => o.message)), out = [];
  if (p.atividades !== false) {
    acts.filter(a => a.scheduled_for === t).forEach(a => out.push(['atividades', `Hoje (${br(t)}): ${a.title}${a.start_time ? ' às ' + a.start_time.slice(0, 5) : ''}.`]));
    const n = acts.filter(a => a.scheduled_for === tm).length; if (n) out.push(['atividades', `Amanhã (${br(tm)}) você tem ${n} atividade(s) planejada(s).`]);
    const late = acts.filter(a => a.scheduled_for < t).length; if (late) out.push(['atividades', `${late} atividade(s) ficaram para trás. Que tal reagendar? (${br(t)})`]);
  }
  if (p.revisoes !== false && revs.length) out.push(['revisoes', `${revs.length} revisão(ões) disponível(is) hoje (${br(t)}).`]);
  const needRaw = (p.resumo !== false && new Date().getDay() === 1) || (p.metas !== false && new Date().getHours() >= 18 && goals.length);
  if (needRaw) {
    const r = await loadRaw();
    if (p.resumo !== false && new Date().getDay() === 1) {
      const w = [addDays(weekStart(t), -7), addDays(weekStart(t), -1)];
      out.push(['resumo', `Resumo da semana passada (${br(w[0])}): ${measure(r, 'minutes', w)} min de estudo, ${measure(r, 'topics', w)} conteúdo(s) e ${measure(r, 'questions', w)} questões.`]);
    }
    if (p.metas !== false && new Date().getHours() >= 18) goals.filter(g => !g.valid_to || g.valid_to >= t).forEach(g => {
      const v = measure(r, g.metric, [t, t], g.subject_id); if (v < g.target) out.push(['metas', `Meta diária em andamento (${br(t)}): ${v} de ${g.target}. Ainda dá tempo, no seu ritmo.`]);
    });
  }
  const fresh = out.filter(([, m]) => !seen.has(m));
  if (fresh.length) await sb.from('notifications').insert(fresh.map(([kind, message]) => ({ kind, message })));
}
