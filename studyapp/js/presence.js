import { sb } from './supabase.js';
// Presença: o servidor guarda o último sinal. Passou de 2 min sem sinal = offline.
// Aba aberta e parada não conta: sem interação por 10 min (ou aba oculta) o sinal para.
const EVERY = 40000, IDLE = 10 * 60 * 1000;
let timer = null, last = Date.now(), studying = false, bound = false;
const active = () => studying || (document.visibilityState === 'visible' && Date.now() - last < IDLE);
async function beat() { if (!timer || !active()) return; try { await sb.rpc('heartbeat', { p_studying: studying }); } catch {} }
export function startPresence() {
  if (!bound) {
    bound = true; const mark = () => { last = Date.now(); };
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(e => addEventListener(e, mark, { passive: true }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { mark(); beat(); } });
  }
  clearInterval(timer); timer = setInterval(beat, EVERY); last = Date.now(); beat();
}
export function setStudying(v) { if (studying !== v) { studying = v; last = Date.now(); beat(); } }
export async function stopPresence(graceful) {
  clearInterval(timer); timer = null; studying = false;
  if (graceful) { try { await sb.rpc('go_offline'); } catch {} }
}
