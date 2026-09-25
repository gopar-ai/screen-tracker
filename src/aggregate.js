import 'dotenv/config';

// Un hueco mayor a esto no es trabajo: la maquina estuvo suspendida o el tracker
// caido. Se corta para no inflar el total con tiempo que nunca ocurrio.
const MAX_GAP_MINUTES = Number(process.env.MAX_GAP_MINUTES) || 5;

// Filas que el motor de vision escribia cuando la llamada a la API fallaba.
// Quedaron guardadas como "no productivas" y cuentan como tiempo real de
// distraccion si no se excluyen: son 624 de las 3050 filas historicas.
const isFailedAnalysis = (s) => s.source !== 'window' && s.task === 'Analysis failed';

function medianGapMinutes(times) {
  if (times.length < 2) return 1;
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) {
    gaps.push((times[i] - times[i - 1]) / 60000);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 1;
}

/**
 * Reparte el tiempo real entre apps, categorias y tareas a partir de la
 * distancia entre capturas consecutivas, no del conteo de filas.
 *
 * `active` significa cosas distintas segun el motor y por eso no se mezclan:
 * en `window` es que hubo teclado o raton; en `vision` era el juicio del modelo
 * sobre si la pantalla mostraba trabajo productivo.
 */
export function aggregate(snapshots) {
  const usable = snapshots.filter((s) => !isFailedAnalysis(s));
  const discarded = snapshots.length - usable.length;

  if (!usable.length) {
    return {
      engine: 'none', totalMinutes: 0, activeMinutes: 0, idleMinutes: 0,
      pct: 0, discarded, count: 0, apps: [], categories: [], tasks: [],
    };
  }

  const rows = usable
    .map((s) => ({ ...s, at: new Date(s.captured_at).getTime() }))
    .sort((a, b) => a.at - b.at);

  const engines = new Set(rows.map((s) => s.source || 'vision'));
  const engine = engines.size === 1 ? [...engines][0] : 'mixed';
  const tailMinutes = Math.min(medianGapMinutes(rows.map((r) => r.at)), MAX_GAP_MINUTES);

  const apps = new Map();
  const categories = new Map();
  const tasks = new Map();
  let totalMinutes = 0;
  let activeMinutes = 0;

  rows.forEach((row, i) => {
    const next = rows[i + 1];
    const minutes = next
      ? Math.min((next.at - row.at) / 60000, MAX_GAP_MINUTES)
      : tailMinutes;

    const isActive = row.productive === 1;
    totalMinutes += minutes;
    if (isActive) activeMinutes += minutes;

    const appName = row.app || 'Unknown';
    const app = apps.get(appName) || { name: appName, minutes: 0, activeMinutes: 0 };
    app.minutes += minutes;
    if (isActive) app.activeMinutes += minutes;
    apps.set(appName, app);

    let category = 'sin categoria';
    try {
      category = JSON.parse(row.raw_analysis || '{}').category || 'sin categoria';
    } catch { /* fila sin analisis: el motor de ventanas no genera categorias */ }
    categories.set(category, (categories.get(category) || 0) + minutes);

    const taskName = row.task || 'Sin titulo';
    tasks.set(taskName, (tasks.get(taskName) || 0) + minutes);
  });

  const byMinutes = (a, b) => b.minutes - a.minutes;
  const round = (n) => Math.round(n);

  return {
    engine,
    count: rows.length,
    discarded,
    totalMinutes: round(totalMinutes),
    activeMinutes: round(activeMinutes),
    idleMinutes: round(totalMinutes - activeMinutes),
    pct: totalMinutes ? Math.round((activeMinutes / totalMinutes) * 100) : 0,
    apps: [...apps.values()]
      .map((a) => ({
        name: a.name,
        minutes: round(a.minutes),
        // Proporcion real, no la etiqueta de la primera captura del dia.
        activePct: a.minutes ? Math.round((a.activeMinutes / a.minutes) * 100) : 0,
      }))
      .sort(byMinutes),
    categories: [...categories.entries()]
      .map(([name, minutes]) => ({ name, minutes: round(minutes) }))
      .sort(byMinutes),
    tasks: [...tasks.entries()]
      .map(([name, minutes]) => ({ name, minutes: round(minutes) }))
      .sort(byMinutes),
  };
}

// El mismo numero significa cosas distintas segun el motor, asi que la etiqueta
// tiene que cambiar con el: llamarle "productividad" al tiempo con teclado seria
// inventar un dato que nadie midio.
export function labelsFor(engine) {
  if (engine === 'window') {
    return { active: 'Tiempo activo', inactive: 'Inactivo', ratio: 'Actividad', note: 'teclado o raton' };
  }
  if (engine === 'vision') {
    return { active: 'Productivo', inactive: 'Distraccion', ratio: 'Productividad', note: 'juicio del modelo' };
  }
  return { active: 'Activo', inactive: 'Inactivo', ratio: 'Actividad', note: 'mezcla de dos motores, no comparable' };
}
