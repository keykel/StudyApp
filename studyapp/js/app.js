import { sb, configured } from './supabase.js';
import { mountAuth } from './auth.js';
import { ctx } from './core.js';
import { dashboard, profilePage } from './pages.js';
import { materias, conteudos, revisoes } from './pages_study.js';
import { calendario } from './pages_calendar.js';
import { exercicios, sessoes } from './pages_practice.js';
import { metas, conquistas, estatisticas } from './pages_progress.js';
import { amigos } from './pages_social.js';
import { startPresence, stopPresence } from './presence.js';
import { generateNotifications } from './gamify.js';
import { $, icon, toast } from './ui.js';

const PAGES = [
  ['inicio', 'Início', 'home'], ['calendario', 'Calendário', 'calendar'], ['materias', 'Minhas matérias', 'book'],
  ['conteudos', 'Conteúdos', 'list'], ['exercicios', 'Exercícios', 'check'], ['sessoes', 'Sessões de estudo', 'clock'],
  ['metas', 'Metas', 'target'], ['conquistas', 'Conquistas', 'trophy'], ['amigos', 'Amigos', 'users'], ['estatisticas', 'Estatísticas', 'chart'],
  ['revisoes', 'Revisões', 'refresh'], ['perfil', 'Perfil e configurações', 'user'],
];
const REG = { inicio: dashboard, perfil: profilePage, calendario, materias, conteudos, exercicios, sessoes, metas, conquistas, amigos, estatisticas, revisoes };

function applyTheme(theme, accent) {
  document.documentElement.dataset.theme = theme;
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  try { localStorage.setItem('sv-theme', theme); } catch {}
}
ctx.applyTheme = applyTheme;
try { applyTheme(localStorage.getItem('sv-theme') || 'dark'); } catch {}

function show(id) { ['boot', 'auth', 'app'].forEach(x => $('#' + x).hidden = x !== id); }
function buildNav() {
  const html = PAGES.map(([id, label, ic]) => `<a class="nl" href="#/${id}" data-id="${id}">${icon(ic)}<span>${label}</span></a>`).join('');
  $('#nav-side').innerHTML = html; $('#nav-bottom').innerHTML = html;
}

async function route() {
  if (!ctx.profile) return;
  const id = location.hash.replace('#/', '') || 'inicio', page = REG[id] ? id : 'inicio';
  document.querySelectorAll('.nl').forEach(a => a.dataset.id === page ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  // Cada navegação usa um contêiner novo: uma página lenta nunca sobrescreve a página atual.
  const box = document.createElement('div'); box.innerHTML = '<p class="muted">Carregando…</p>'; $('#view').replaceChildren(box);
  try { await REG[page](box); }
  catch (e) {
    console.error(e);
    box.innerHTML = '<div class="card empty"><h3>Não foi possível carregar</h3><p>Verifique sua conexão e se o schema.sql foi executado no Supabase.</p><button class="btn" id="retry">Tentar novamente</button></div>';
    $('#retry', box).onclick = route;
  }
  $('#view').focus({ preventScroll: true });
}

async function enter(session) {
  show('boot');
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error || !data) { toast('Não foi possível carregar seu perfil.', 'error'); await sb.auth.signOut(); return; }
  ctx.profile = data; applyTheme(data.theme, data.accent);
  if (!$('#nav-side').children.length) buildNav();
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (z && data.tz !== undefined && z !== data.tz) { await sb.from('profiles').update({ tz: z }).eq('id', data.id); data.tz = z; } } catch {}
  startPresence();
  try { await generateNotifications(); } catch (e) { console.error(e); }
  show('app'); route();
}
window.addEventListener('hashchange', route);

if (!configured) {
  show('auth'); $('#auth-card').innerHTML = '<h1>Falta configurar</h1><p class="muted">Edite <code>js/config.js</code> com a URL e a chave anon do seu projeto Supabase. Os passos estão no README.</p>';
} else {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { show('auth'); mountAuth('reset'); return; }
    if (event === 'SIGNED_OUT' || !session) { ctx.profile = null; stopPresence(false); show('auth'); mountAuth('login'); return; }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(() => enter(session), 0);
  });
}
