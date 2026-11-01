import { esc } from './ui.js';
export function cols(items, fmt = (v) => v) {
  if (!items.length || items.every(i => !i.value)) return '<p class="muted">Ainda não há dados neste período.</p>';
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="cols">${items.map(i => `<div class="col" title="${esc(i.label)}: ${esc(fmt(i.value))}"><span class="v">${esc(fmt(i.value))}</span><i style="height:${Math.round(i.value / max * 100)}%;${i.color ? `background:${esc(i.color)}` : ''}"></i><span class="l">${esc(i.label)}</span></div>`).join('')}</div>`;
}
export function line(points) {
  if (points.length < 2) return '<p class="muted">Registre ao menos dois dias para ver a evolução.</p>';
  const W = 600, H = 150, st = W / (points.length - 1), y = (v) => (H - v / 100 * H + 8).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="line" role="img" aria-label="Evolução do aproveitamento"><polyline points="${points.map((p, i) => `${(i * st).toFixed(1)},${y(p.value)}`).join(' ')}" fill="none" stroke="var(--cyan)" stroke-width="3" stroke-linejoin="round"/>${points.map((p, i) => `<circle cx="${(i * st).toFixed(1)}" cy="${y(p.value)}" r="4" fill="var(--accent)"><title>${esc(p.label)}: ${p.value}%</title></circle>`).join('')}</svg>`;
}
