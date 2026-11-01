import { sb } from './supabase.js';
import { ctx, q, today, br, fmtMin, form, run, empty, bar, pct } from './core.js';
import { levelInfo } from './xp.js';
import { loadRaw, summary, windowOf, measure, ACH } from './gamify.js';
import { $, esc, toast, busy } from './ui.js';

const FRASES = ['Pequenos passos todos os dias levam longe.', 'Consistência vale mais que intensidade.', 'Descansar também faz parte de aprender.', 'Hoje é um bom dia para avançar um pouco.', 'Cada atividade registrada é progresso real.'];
const MET = { topics: 'conteúdos', questions: 'questões', minutes: 'min de estudo' };

export async function dashboard(view) {
  const p = ctx.profile, t = today();
  const [r, goals, notes, next] = await Promise.all([loadRaw(), q(sb.from('goals').select('*').eq('period', 'daily').lte('valid_from', t)),
    q(sb.from('notifications').select('*').eq('read', false).order('created_at', { ascending: false }).limit(5)),
    q(sb.from('activities').select('id,title,scheduled_for,start_time').eq('done', false).gte('scheduled_for', t).order('scheduled_for').order('start_time').limit(5))]);
  const s = summary(r), lv = levelInfo(p.xp), hour = new Date().getHours(), hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const todayMin = measure(r, 'minutes', [t, t]), todayQ = measure(r, 'questions', [t, t]);
  const tail = lv.next ? ` Faltam ${lv.toNext} XP para o nível ${lv.n + 1}.` : ' Você está no nível máximo.';
  const msg = p.xp === 0 && !s.days.length ? 'Sua jornada começa aqui. Registre a primeira atividade para ganhar seu primeiro XP.'
    : s.days.includes(t) ? `Hoje você já avançou: ${fmtMin(todayMin)} de estudo e ${todayQ} questões.${tail}`
    : s.current > 0 ? `Sua sequência está em ${s.current} dia(s). Uma atividade pequena hoje mantém o ritmo.${tail}`
    : `Retomar faz parte da jornada. Você já acumulou ${p.xp} XP, e uma atividade pequena já conta.${tail}`;
  const dgoals = goals.filter(g => !g.valid_to || g.valid_to >= t);
  const recent = [...r.un].sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at)).slice(0, 3);
  view.innerHTML = `<h1>${hello}, ${esc(p.display_name)}</h1><p class="muted">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${FRASES[new Date().getDate() % FRASES.length]}</p>
  <section class="card hero"><h3>${esc(msg)}</h3></section>
  <section class="card" style="margin-top:16px"><div class="row between"><b>Nível ${lv.n} · ${lv.name}</b><span class="muted">${p.xp} XP</span></div>${bar(lv.pct)}<span class="muted">${lv.next ? `${lv.pct}% até ${lv.next.name}` : 'Nível máximo'}</span></section>
  <div class="grid"><div class="card stat"><b>${s.days.length}</b><span>dias de atividade</span></div><div class="card stat"><b>${fmtMin(s.minutes)}</b><span>tempo de estudo</span></div><div class="card stat"><b>${s.topicsDone}</b><span>conteúdos concluídos</span></div>
  <div class="card stat"><b>${s.questions}</b><span>questões realizadas</span></div><div class="card stat"><b>${s.current}</b><span>sequência atual (maior: ${s.best})</span></div></div>
  <div class="grid wide"><section class="card"><h3>Metas diárias</h3>${dgoals.length ? dgoals.map(g => { const v = measure(r, g.metric, [t, t], g.subject_id); return `<div class="row between"><span>${g.target} ${MET[g.metric]}</span><span class="muted">${v} de ${g.target}</span></div>${bar(pct(v, g.target), pct(v, g.target) >= 100 ? 'var(--green)' : '')}`; }).join('') : '<p class="muted">Nenhuma meta diária. Crie uma em Metas.</p>'}</section>
  <section class="card"><h3>Próximas atividades</h3>${next.length ? next.map(a => `<p>${esc(a.title)} <span class="muted">· ${br(a.scheduled_for)}${a.start_time ? ' ' + a.start_time.slice(0, 5) : ''}</span></p>`).join('') : '<p class="muted">Nada agendado. Planeje no Calendário.</p>'}</section>
  <section class="card"><h3>Conquistas recentes</h3>${recent.length ? recent.map(u => `<p><b>${esc(ACH.find(a => a.code === u.code)?.name ?? u.code)}</b> <span class="muted">· ${new Date(u.unlocked_at).toLocaleDateString('pt-BR')}</span></p>`).join('') : '<p class="muted">As conquistas desbloqueadas aparecem aqui.</p>'}</section>
  <section class="card"><div class="row between"><h3>Notificações</h3>${notes.length ? '<button class="btn sm" id="read">Marcar como lidas</button>' : ''}</div>${notes.length ? notes.map(n => `<p>${esc(n.message)}</p>`).join('') : '<p class="muted">Tudo em dia.</p>'}</section></div>`;
  const rd = $('#read', view); if (rd) rd.onclick = async () => { if (await run(() => q(sb.from('notifications').update({ read: true }).eq('read', false)))) dashboard(view); };
}

const PREFS = { atividades: 'Atividades próximas', metas: 'Metas pendentes', conquistas: 'Conquistas e novos níveis', revisoes: 'Revisões programadas', resumo: 'Resumo semanal' };
export function profilePage(view) {
  const p = ctx.profile, colors = ['#7c5cff', '#3d7bff', '#22d3ee', '#b79cff', '#34d399'], np = p.notif_prefs || {};
  const okAvatar = /^https:\/\//.test(p.avatar_url || '');
  view.innerHTML = `<h1>Perfil e configurações</h1><form class="card" id="pf" novalidate>
  <div class="row" style="margin-bottom:14px">${okAvatar ? `<img class="avatar" src="${esc(p.avatar_url)}" alt="Foto de perfil">` : `<span class="avatar">${esc(p.display_name.slice(0, 1).toUpperCase())}</span>`}<span class="muted">Nível ${levelInfo(p.xp).n} · ${p.xp} XP</span></div>
  <label>Nome de exibição<input name="name" value="${esc(p.display_name)}" maxlength="60" required></label>
  <label>Foto de perfil (endereço https de uma imagem)<input name="avatar" type="url" value="${esc(p.avatar_url || '')}" placeholder="https://…"></label>
  <label>Tema<select name="theme"><option value="dark" ${p.theme === 'dark' ? 'selected' : ''}>Escuro</option><option value="light" ${p.theme === 'light' ? 'selected' : ''}>Claro</option></select></label>
  <p class="muted" style="margin:0 0 6px">Cor de destaque</p><div class="row swatches" id="sw">${colors.map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Cor ${c}" aria-pressed="${c === p.accent}"></button>`).join('')}</div>
  <label style="margin-top:14px">Horários disponíveis para estudar<textarea name="hours" rows="2" maxlength="300">${esc(p.available_hours?.texto || '')}</textarea></label>
  <p class="muted" style="margin:0 0 6px">Notificações internas</p>${Object.entries(PREFS).map(([k, l]) => `<label class="chk"><input type="checkbox" name="n_${k}" ${np[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}
  <p class="err" id="perr" role="alert" style="margin-top:12px"></p><button class="btn primary" style="width:auto">Salvar alterações</button></form>
  <section class="card" style="margin-top:16px"><h3>Conta</h3><div class="row"><button class="btn" id="out">Sair</button><button class="btn danger" id="del">Excluir conta e dados</button></div></section>`;
  let accent = p.accent;
  $('#sw', view).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; accent = b.dataset.c; $('#sw', view).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); ctx.applyTheme(p.theme, accent); };
  $('#pf', view).onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target), name = f.get('name').trim(), av = f.get('avatar').trim(), btn = $('#pf .btn.primary', view), err = $('#perr', view);
    err.textContent = ''; if (!name) return err.textContent = 'Informe um nome de exibição.'; if (av && !/^https:\/\/\S+$/.test(av)) return err.textContent = 'O endereço da foto precisa começar com https://.';
    const row = { display_name: name, avatar_url: av || null, theme: f.get('theme'), accent, available_hours: { texto: f.get('hours').trim() }, notif_prefs: Object.fromEntries(Object.keys(PREFS).map(k => [k, f.get('n_' + k) !== null])) };
    busy(btn, true, 'Salvar alterações'); const { error } = await sb.from('profiles').update(row).eq('id', p.id); busy(btn, false, 'Salvar alterações');
    if (error) return err.textContent = 'Não foi possível salvar. Tente novamente.';
    Object.assign(p, row); ctx.applyTheme(p.theme, p.accent); toast('Alterações salvas.'); profilePage(view);
  };
  $('#out', view).onclick = () => sb.auth.signOut();
  $('#del', view).onclick = async () => {
    if (!confirm('Excluir sua conta e TODOS os seus dados? Isso não pode ser desfeito.')) return;
    const { error } = await sb.rpc('delete_my_account'); if (error) return toast('Não foi possível excluir a conta.', 'error'); await sb.auth.signOut();
  };
}
