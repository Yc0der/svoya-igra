// Порядок выбирается по уже округлённому числу, а не по сырому. Иначе 999 500
// остаётся в «k» и печатается как «1000k»: четыре разряда вместо трёх, на которые
// рассчитаны колонки таблицы сессий, и читается хуже, чем «1.0M».
export function fmtTokens(n) {
  const value = Number(n) || 0;
  const g = `${(value / 1e9).toFixed(1)}G`;
  const m = `${(value / 1e6).toFixed(1)}M`;
  const k = Math.round(value / 1e3);
  if (value >= 1e9) return g;
  if (value >= 1e6) return parseFloat(m) >= 1000 ? g : m;
  if (value >= 1e3) return k >= 1000 ? m : `${k}k`;
  return String(Math.round(value));
}

const MAX_SESSION_ROWS = 8;

export function formatReport({ cap, current, project, sessions }) {
  const lines = [];

  lines.push(`Текущая сессия ${current.id}`);
  lines.push(`  контекст сейчас     ${fmtTokens(current.contextNow)}`);
  lines.push(`  запросов к модели   ${current.requests}`);
  lines.push(`  сожжено             ${fmtTokens(current.burned)}`);
  lines.push(`  автокомпактов       ${current.compacts}`);
  const top =
    current.topTools.length === 0
      ? '—'
      : current.topTools
          .slice(0, 3)
          .map((t) => `${t.tool} ${fmtTokens(t.tokens)}`)
          .join(' · ');
  lines.push(`  дороже всего несут  ${top}`);

  lines.push('');
  lines.push(
    `Проект: сессий ${project.sessions}, запросов ${project.requests}`,
  );
  lines.push(`  сожжено всего       ${fmtTokens(project.burned)}`);
  lines.push(`  средний контекст    ${fmtTokens(project.avgContext)}`);
  lines.push(`  доля >300k / >500k  ${project.over300}% / ${project.over500}%`);

  lines.push('');
  lines.push('Последние сессии            запросов   ср. контекст   сожжено');
  if (sessions.length === 0) {
    lines.push('  —');
  }
  for (const s of sessions.slice(0, MAX_SESSION_ROWS)) {
    lines.push(
      `  ${s.date} ${s.id.padEnd(8)} ${String(s.requests).padStart(8)}` +
        `   ${fmtTokens(s.avgContext).padStart(12)}   ${fmtTokens(s.burned).padStart(7)}`,
    );
  }

  lines.push('');
  const saved =
    project.burned === 0
      ? 0
      : Math.round((1 - project.capped / project.burned) * 100);
  lines.push(
    `При потолке ${fmtTokens(cap)}: ${fmtTokens(project.capped)} вместо ` +
      `${fmtTokens(project.burned)} (−${saved}%)`,
  );

  return lines;
}
