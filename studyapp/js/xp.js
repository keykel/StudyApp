export const LEVELS = [
  { n: 1, name: 'Iniciante', min: 0 }, { n: 2, name: 'Explorador', min: 100 },
  { n: 3, name: 'Dedicado', min: 300 }, { n: 4, name: 'Estrategista', min: 600 },
  { n: 5, name: 'Especialista', min: 1000 }, { n: 6, name: 'Mestre do Conhecimento', min: 1600 },
];
export function levelInfo(xp) {
  let i = 0;
  LEVELS.forEach((l, k) => { if (xp >= l.min) i = k; });
  const cur = LEVELS[i], next = LEVELS[i + 1];
  const pct = next ? Math.round(((xp - cur.min) / (next.min - cur.min)) * 100) : 100;
  return { ...cur, next, pct, toNext: next ? next.min - xp : 0 };
}
