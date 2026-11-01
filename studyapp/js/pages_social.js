import { sb } from './supabase.js';
import { ctx, q, fmtMin, empty, bar } from './core.js';
import { $, esc, toast } from './ui.js';
import { levelInfo } from './xp.js';
import { ACH } from './gamify.js';

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TABS = [['amigos', 'Meus amigos'], ['solic', 'Solicitações'], ['buscar', 'Buscar'], ['rank', 'Ranking'], ['priv', 'Privacidade']];
const PER = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' }, MET = { topics: 'conteúdos', questions: 'questões', minutes: 'min de estudo' };
const A = { tab: 'amigos', rk: 'xp', xpP: 'weekly', hP: 'weekly', term: '', found: null };
const STATUS = { online: '🟢 Online', studying: '📚 Estudando', offline: '⚪ Offline' };
const statusLabel = (s) => s ? `<span class="st ${s}">${STATUS[s]}</span>` : '<span class="muted">Status oculto</span>';
const avatar = (u, size = '') => /^https:\/\/\S+$/.test(u.avatar_url || '') ? `<img class="avatar ${size}" src="${esc(u.avatar_url)}" alt="">` : `<span class="avatar ${size}">${esc((u.display_name || '?').slice(0, 1).toUpperCase())}</span>`;
const mins = (s) => fmtMin(Math.floor((s || 0) / 60));
const who = (u) => `<div class="grow row" data-profile="${u.other_id || u.id}" style="cursor:pointer">${avatar(u, 'sm')}<div><b>${esc(u.display_name)}</b><div class="muted">@${esc(u.username)}</div></div></div>`;
const ERR = '<div class="card empty"><h3>Não foi possível carregar</h3><p>Verifique sua conexão e se o arquivo supabase/social.sql foi executado no Supabase.</p></div>';

let live = null, poll = null;
function stopLive() { if (live) { sb.removeChannel(live); live = null; } clearInterval(poll); poll = null; }
async function act(fn, ok) {
  try { await fn(); if (ok) toast(ok); return true; }
  catch (e) { toast(e.code === 'P0001' && e.message ? e.message : 'Não foi possível concluir a ação.', 'error'); return false; }
}

export async function amigos(view) {
  stopLive();
  let d = { rows: [], reqs: [] };
  const received = () => d.reqs.filter(r => r.direction === 'received').length;
  const shell = () => {
    view.innerHTML = `<h1>Amigos</h1><div class="row tabs" role="tablist">${TABS.map(([k, l]) => `<button class="btn sm ${A.tab === k ? 'on' : ''}" role="tab" aria-selected="${A.tab === k}" data-tab="${k}">${l}${k === 'solic' && received() ? ` (${received()})` : ''}</button>`).join('')}</div><div id="soc" style="margin-top:16px"></div>`;
  };

  const friendsTab = (box) => {
    const order = { studying: 0, online: 1, offline: 2 };
    const list = d.rows.filter(r => !r.is_me).sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.display_name.localeCompare(b.display_name));
    box.innerHTML = list.length ? `<div class="grid wide">${list.map(f => { const lv = f.xp != null ? levelInfo(f.xp) : null;
      return `<article class="card person" data-profile="${f.id}" tabindex="0" role="button" aria-label="Perfil de ${esc(f.display_name)}"><div class="row">${avatar(f)}<div class="grow"><b>${esc(f.display_name)}</b><div class="muted">@${esc(f.username)}</div></div></div>
      <div style="margin:8px 0">${statusLabel(f.status)}</div>
      ${lv ? `<div class="row between"><span>Nível ${lv.n} · ${lv.name}</span><span class="muted">${f.xp} XP</span></div>${bar(lv.pct)}` : '<p class="muted">Progresso oculto</p>'}
      ${f.today_s != null ? `<div class="row between muted"><span>Hoje ${mins(f.today_s)}</span><span>Semana ${mins(f.week_s)}</span></div>` : '<p class="muted">Estatísticas ocultas</p>'}</article>`; }).join('')}</div>`
      : empty('Você ainda não tem amigos', 'Use a aba Buscar para encontrar pessoas pelo nome ou pelo nome de usuário.');
  };

  const reqsTab = (box) => {
    const rc = d.reqs.filter(r => r.direction === 'received'), sn = d.reqs.filter(r => r.direction === 'sent');
    const row = (r, btns) => `<article class="card item">${who(r)}${btns}</article>`;
    box.innerHTML = `<h3>Recebidas</h3>${rc.length ? rc.map(r => row(r, `<button class="btn sm primary" data-act="accept" data-id="${r.id}">Aceitar</button><button class="btn sm" data-act="decline" data-id="${r.id}">Recusar</button>`)).join('') : '<p class="muted">Nenhuma solicitação recebida.</p>'}
    <h3>Enviadas</h3>${sn.length ? sn.map(r => row(r, `<button class="btn sm" data-act="cancel" data-id="${r.id}">Cancelar pedido</button>`)).join('') : '<p class="muted">Nenhuma solicitação enviada.</p>'}`;
  };

  const runSearch = async () => { A.found = A.term.trim().length < 2 ? null : await q(sb.rpc('search_users', { p_term: A.term })); };
  const resultBtns = (u) => ({
    none: `<button class="btn sm primary" data-act="add" data-id="${u.id}">Adicionar</button>`,
    sent: `<button class="btn sm" data-act="cancel" data-id="${u.friendship_id}">Cancelar pedido</button>`,
    received: `<button class="btn sm primary" data-act="accept" data-id="${u.friendship_id}">Aceitar</button><button class="btn sm" data-act="decline" data-id="${u.friendship_id}">Recusar</button>`,
    friend: '<span class="muted">Já são amigos</span>' }[u.relation]);
  const searchTab = (box) => {
    box.innerHTML = `<form id="sf" class="row" novalidate><input id="sq" style="flex:1;margin:0" placeholder="Nome ou @usuário (mínimo 2 letras)" value="${esc(A.term)}" aria-label="Buscar usuários"><button class="btn primary" style="width:auto">Buscar</button></form><div id="sr" style="margin-top:14px"></div>`;
    const draw = () => { $('#sr', box).innerHTML = A.found === null ? '<p class="muted">Digite ao menos 2 letras.</p>' : A.found.length ? A.found.map(u => `<article class="card item">${who(u)}${resultBtns(u)}</article>`).join('') : empty('Ninguém encontrado', 'Confira a grafia ou tente o nome de usuário.'); };
    $('#sf', box).onsubmit = async (e) => {
      e.preventDefault(); A.term = $('#sq', box).value; $('#sr', box).innerHTML = '<p class="muted">Buscando…</p>';
      try { await runSearch(); draw(); } catch (err) { console.error(err); $('#sr', box).innerHTML = ERR; }
    };
    draw();
  };

  const rankTab = (box) => {
    const isXp = A.rk === 'xp';
    const key = isXp ? (A.xpP === 'weekly' ? 'weekly_xp' : 'xp') : { daily: 'today_s', weekly: 'week_s', monthly: 'month_s', total: 'total_s' }[A.hP];
    const ok = d.rows.filter(r => r[key] != null).sort((a, b) => b[key] - a[key] || a.display_name.localeCompare(b.display_name)), hidden = d.rows.length - ok.length;
    const seg = (k, opts, cur) => `<div class="row seg">${opts.map(([v, l]) => `<button class="btn sm ${cur === v ? 'on' : ''}" data-seg="${k}:${v}">${l}</button>`).join('')}</div>`;
    box.innerHTML = `<div class="row">${seg('rk', [['xp', 'XP'], ['h', 'Horas estudadas']], A.rk)}${isXp ? seg('xpP', [['weekly', 'Semanal'], ['total', 'Geral']], A.xpP) : seg('hP', [['daily', 'Dia'], ['weekly', 'Semana'], ['monthly', 'Mês'], ['total', 'Geral']], A.hP)}</div>
    <div style="margin-top:14px">${ok.length > 1 || (ok.length === 1 && d.rows.length === 1) ? ok.map(r => { const pos = 1 + ok.filter(x => x[key] > r[key]).length, lv = r.xp != null ? levelInfo(r.xp) : null;
      return `<article class="card item rank ${pos <= 3 && r[key] > 0 ? 'top' + pos : ''} ${r.is_me ? 'me' : ''}" data-profile="${r.id}" tabindex="0" role="button"><span class="pos">${pos}</span>${avatar(r, 'sm')}
      <div class="grow"><b>${esc(r.display_name)}${r.is_me ? ' (você)' : ''}</b><div class="muted">@${esc(r.username)}</div>${isXp && lv ? `<div class="muted">Nível ${lv.n} · ${lv.name}</div>${bar(lv.pct)}` : ''}</div>
      <b class="val">${isXp ? `${r[key]} XP` : mins(r[key])}</b></article>`; }).join('') : empty('O ranking aparece com amigos', 'Adicione amigos para comparar XP e horas de estudo. Só amigos aceitos entram na lista.')}</div>
    ${hidden ? `<p class="muted">${hidden} pessoa(s) não compartilham ${isXp ? 'o progresso' : 'as estatísticas'} e ficam fora desta lista.</p>` : ''}`;
  };

  const privTab = async (box) => {
    const [ps, blocks] = await Promise.all([q(sb.from('privacy_settings').select('*').eq('user_id', ctx.profile.id).maybeSingle()), q(sb.rpc('my_blocks'))]);
    const s = { searchable: true, show_status: true, share_stats: true, show_progress: true, ...(ps || {}) };
    const T = [['searchable', 'Aparecer na busca de usuários'], ['show_status', 'Mostrar meu status (online, estudando) aos amigos'], ['share_stats', 'Compartilhar meu tempo de estudo e metas com amigos'], ['show_progress', 'Compartilhar XP, nível e conquistas com amigos']];
    box.innerHTML = `<section class="card"><h3>O que seus amigos veem</h3>${T.map(([k, l]) => `<label class="chk"><input type="checkbox" data-pv="${k}" ${s[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    <p class="muted">Só amigos aceitos veem essas informações. Quem desativa estatísticas ou progresso fica fora do ranking correspondente.</p></section>
    <section class="card" style="margin-top:16px"><h3>Nome de usuário</h3><form id="uf" class="row" novalidate><input name="u" value="${esc(ctx.profile.username || '')}" maxlength="20" style="flex:1;margin:0" aria-label="Nome de usuário"><button class="btn primary" style="width:auto">Salvar</button></form><p class="err" id="uerr" role="alert"></p></section>
    <section class="card" style="margin-top:16px"><h3>Usuários bloqueados</h3>${blocks.length ? blocks.map(b => `<div class="row between" style="margin-bottom:8px"><span class="row">${avatar(b, 'sm')}<span><b>${esc(b.display_name)}</b> <span class="muted">@${esc(b.username)}</span></span></span><button class="btn sm" data-act="unblock" data-id="${b.id}">Desbloquear</button></div>`).join('') : '<p class="muted">Você não bloqueou ninguém.</p>'}</section>`;
    box.onchange = async (e) => {
      const k = e.target.dataset?.pv; if (!k) return;
      const { error } = await sb.from('privacy_settings').upsert({ user_id: ctx.profile.id, [k]: e.target.checked, updated_at: new Date().toISOString() });
      if (error) { e.target.checked = !e.target.checked; toast('Não foi possível salvar.', 'error'); } else toast('Privacidade atualizada.');
    };
    $('#uf', box).onsubmit = async (e) => {
      e.preventDefault(); const v = new FormData(e.target).get('u').trim().toLowerCase(), err = $('#uerr', box); err.textContent = '';
      if (!/^[a-z0-9_]{3,20}$/.test(v)) return err.textContent = 'Use de 3 a 20 caracteres: letras minúsculas, números e _.';
      const { error } = await sb.from('profiles').update({ username: v }).eq('id', ctx.profile.id);
      if (error) return err.textContent = error.code === '23505' ? 'Esse nome de usuário já está em uso.' : 'Não foi possível salvar.';
      ctx.profile.username = v; toast('Nome de usuário atualizado.');
    };
  };

  const TAB_FN = { amigos: friendsTab, solic: reqsTab, buscar: searchTab, rank: rankTab, priv: privTab };
  const paint = async () => {
    shell(); const box = $('#soc', view);
    try { await TAB_FN[A.tab](box); } catch (e) { console.error(e); box.innerHTML = ERR; }
  };
  const reload = async (quiet = false) => {
    try { d = { rows: await q(sb.rpc('friends_overview', { p_tz: tz() })), reqs: await q(sb.rpc('my_requests')) }; }
    catch (e) { console.error(e); if (!quiet) { shell(); $('#soc', view).innerHTML = ERR; } return; }
    if (document.querySelector('dialog[open]')) return;
    await paint();
  };

  view.onclick = async (e) => {
    const t = e.target.closest('[data-tab],[data-seg],[data-profile],[data-act]'); if (!t) return;
    if (t.dataset.tab) { A.tab = t.dataset.tab; return ['priv', 'buscar'].includes(A.tab) ? paint() : reload(); }
    if (t.dataset.seg) { const [k, v] = t.dataset.seg.split(':'); A[k] = v; return paint(); }
    if (t.dataset.profile) return openProfile(t.dataset.profile, reload);
    const { act: a, id } = t.dataset;
    const fn = {
      add: () => act(() => q(sb.rpc('send_friend_request', { p_target: id })), 'Solicitação enviada.'),
      cancel: () => act(() => q(sb.rpc('remove_friendship', { p_id: id })), 'Solicitação cancelada.'),
      decline: () => act(() => q(sb.rpc('respond_friend_request', { p_id: id, p_accept: false })), 'Solicitação recusada.'),
      accept: () => act(() => q(sb.rpc('respond_friend_request', { p_id: id, p_accept: true })), 'Amizade aceita!'),
      unblock: () => act(() => q(sb.rpc('unblock_user', { p_target: id })), 'Usuário desbloqueado.'),
    }[a];
    if (fn && await fn()) { if (A.tab === 'buscar') { try { await runSearch(); } catch {} } await reload(); }
  };
  view.onkeydown = (e) => { const el = e.target.closest?.('[data-profile][role=button]'); if (el && e.key === 'Enter') openProfile(el.dataset.profile, reload); };

  shell(); $('#soc', view).innerHTML = '<p class="muted">Carregando…</p>';
  await reload();
  // Tempo real: mudanças de presença e de amizades (o RLS só entrega o que este usuário pode ver) + conferência a cada 30 s.
  let tm; const live2 = ['amigos', 'solic', 'rank'];
  const bump = () => { clearTimeout(tm); tm = setTimeout(() => { if (!view.isConnected) return stopLive(); if (live2.includes(A.tab)) reload(true); }, 500); };
  live = sb.channel('social-' + ctx.profile.id).on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, bump).on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, bump).subscribe();
  poll = setInterval(() => { if (!view.isConnected) return stopLive(); if (document.visibilityState === 'visible' && live2.includes(A.tab)) reload(true); }, 30000);
}

async function openProfile(id, after) {
  let p;
  try { p = await q(sb.rpc('friend_profile', { p_id: id, p_tz: tz() })); }
  catch (e) { return toast(e.code === 'P0001' && e.message ? e.message : 'Perfil indisponível.', 'error'); }
  const head = `<div class="row">${avatar(p, 'lg')}<div class="grow"><h3 style="margin:0">${esc(p.display_name)}${p.is_me ? ' (você)' : ''}</h3><div class="muted">@${esc(p.username)}</div>${p.is_friend ? `<div style="margin-top:4px">${statusLabel(p.status)}</div>` : ''}</div></div>`;
  let body;
  if (!p.is_friend) body = `<p class="muted">O perfil completo fica visível depois que vocês se tornarem amigos.</p><div class="row"><button class="btn primary" data-m="add" style="width:auto">Adicionar amigo</button><button class="btn danger" data-m="block">Bloquear</button></div>`;
  else {
    const lv = p.xp != null ? levelInfo(p.xp) : null, s = p.stats;
    body = (lv ? `<section class="card" style="margin-top:14px"><div class="row between"><b>Nível ${lv.n} · ${lv.name}</b><span class="muted">${p.xp} XP</span></div>${bar(lv.pct)}<span class="muted">${lv.next ? `Faltam ${lv.toNext} XP para ${lv.next.name}` : 'Nível máximo'}</span></section>`
      : '<p class="muted">Esta pessoa não compartilha XP, nível e conquistas.</p>')
      + (s ? `<div class="grid"><div class="card stat"><b>${mins(s.today_s)}</b><span>hoje</span></div><div class="card stat"><b>${mins(s.week_s)}</b><span>na semana</span></div><div class="card stat"><b>${mins(s.month_s)}</b><span>no mês</span></div><div class="card stat"><b>${mins(s.total_s)}</b><span>total estudado</span></div><div class="card stat"><b>${s.sessions}</b><span>sessões concluídas</span></div></div>`
        : '<p class="muted">Esta pessoa não compartilha estatísticas de estudo.</p>')
      + (s && p.goals?.length ? `<h4>Metas em andamento</h4>${p.goals.map(g => `<div class="row between"><span>${PER[g.period]}: ${g.target} ${MET[g.metric]}</span><span class="muted">${g.value} de ${g.target}</span></div>${bar(Math.round(g.value / g.target * 100), g.value >= g.target ? 'var(--green)' : '')}`).join('')}` : '')
      + (p.achievements ? `<h4>Conquistas</h4>${p.achievements.length ? `<div class="row">${p.achievements.map(a => { const m = ACH.find(x => x.code === a.code); return m ? `<span class="chip" style="--c:var(--accent)" title="${esc(m.desc)}">${esc(m.name)}</span>` : ''; }).join('')}</div>` : '<p class="muted">Nenhuma conquista ainda.</p>'}` : '')
      + (p.is_me ? '' : `<div class="row" style="margin-top:14px"><button class="btn danger sm" data-m="remove">Remover amigo</button><button class="btn danger sm" data-m="block">Bloquear</button></div>`);
  }
  const dlg = document.createElement('dialog'); dlg.className = 'dlg wide';
  dlg.innerHTML = head + body + '<div class="row" style="margin-top:14px"><button class="btn primary" data-m="close" style="width:auto">Fechar</button></div>';
  document.body.append(dlg); dlg.showModal();
  const close = () => { if (dlg.isConnected) { dlg.close(); dlg.remove(); } };
  dlg.addEventListener('cancel', close);
  dlg.onclick = async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return;
    if (m === 'close') return close();
    let ok = false;
    if (m === 'add') ok = await act(() => q(sb.rpc('send_friend_request', { p_target: id })), 'Solicitação enviada.');
    if (m === 'remove' && confirm(`Remover ${p.display_name} dos seus amigos?`)) ok = await act(() => q(sb.rpc('remove_friendship', { p_id: p.friendship_id })), 'Amizade removida.');
    if (m === 'block' && confirm(`Bloquear ${p.display_name}? A amizade será desfeita e vocês deixarão de se ver.`)) ok = await act(() => q(sb.rpc('block_user', { p_target: id })), 'Usuário bloqueado.');
    if (ok) { close(); after?.(); }
  };
}
