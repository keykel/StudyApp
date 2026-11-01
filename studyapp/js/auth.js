import { sb } from './supabase.js';
import { $, toast, busy } from './ui.js';

const msgs = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'User already registered': 'Este e-mail já está cadastrado. Tente entrar.',
  'Email not confirmed': 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
};
const tr = (e) => msgs[e.message] || (e.message?.includes('Password') ? 'A senha precisa ter pelo menos 8 caracteres.' : 'Não foi possível concluir. Verifique os dados e tente de novo.');

export function mountAuth(mode = 'login') {
  const box = $('#auth-card');
  const views = {
    login: `<h1>Entrar</h1><form id="f" novalidate>
      <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
      <label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="err" id="err" role="alert"></p><button class="btn primary">Entrar</button></form>
      <p class="alt"><a href="#" data-m="forgot">Esqueci minha senha</a> · <a href="#" data-m="signup">Criar conta</a></p>`,
    signup: `<h1>Criar conta</h1><form id="f" novalidate>
      <label>Nome<input name="name" autocomplete="name" required></label>
      <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
      <label>Senha (mín. 8 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="err" id="err" role="alert"></p><button class="btn primary">Criar conta</button></form>
      <p class="alt">Já tem conta? <a href="#" data-m="login">Entrar</a></p>`,
    forgot: `<h1>Recuperar senha</h1><form id="f" novalidate>
      <label>E-mail<input name="email" type="email" required></label>
      <p class="err" id="err" role="alert"></p><button class="btn primary">Enviar link</button></form>
      <p class="alt"><a href="#" data-m="login">Voltar</a></p>`,
    reset: `<h1>Nova senha</h1><form id="f" novalidate>
      <label>Nova senha (mín. 8 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="err" id="err" role="alert"></p><button class="btn primary">Salvar senha</button></form>`,
  };
  box.innerHTML = views[mode];
  box.querySelectorAll('[data-m]').forEach(a => a.onclick = (e) => { e.preventDefault(); mountAuth(a.dataset.m); });
  const f = $('#f', box), btn = $('button', f), label = btn.textContent;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f)), err = $('#err');
    err.textContent = '';
    if (v.email !== undefined && !/^\S+@\S+\.\S+$/.test(v.email)) return err.textContent = 'Informe um e-mail válido.';
    if (mode === 'signup' && !v.name.trim()) return err.textContent = 'Informe seu nome.';
    if (v.password !== undefined && mode !== 'login' && v.password.length < 8) return err.textContent = 'A senha precisa ter pelo menos 8 caracteres.';
    busy(btn, true, label);
    let r;
    if (mode === 'login') r = await sb.auth.signInWithPassword({ email: v.email, password: v.password });
    if (mode === 'signup') {
      r = await sb.auth.signUp({ email: v.email, password: v.password, options: { data: { display_name: v.name.trim() } } });
      if (!r.error && !r.data.session) { toast('Conta criada! Confirme seu e-mail para entrar.'); mountAuth('login'); return; }
    }
    if (mode === 'forgot') {
      r = await sb.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin });
      if (!r.error) { toast('Se o e-mail existir, você receberá o link em instantes.'); mountAuth('login'); return; }
    }
    if (mode === 'reset') {
      r = await sb.auth.updateUser({ password: v.password });
      if (!r.error) toast('Senha atualizada.');
    }
    busy(btn, false, label);
    if (r?.error) err.textContent = tr(r.error);
  };
}
