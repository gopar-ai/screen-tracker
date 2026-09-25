import 'dotenv/config';

// La jornada no termina a medianoche. Una sesion de 22:00 a 02:00 es un solo dia
// de trabajo: partirla en dos reportes no describe nada. Con corte a las 6, todo
// lo ocurrido entre las 06:00 de un dia y las 05:59 del siguiente cuenta como el
// mismo dia, etiquetado con la fecha en que empezo.
const CUTOFF_HOUR = Number(process.env.DAY_CUTOFF_HOUR) || 6;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function windowFrom(start) {
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fecha: localDate(start), start, end, cutoffHour: CUTOFF_HOUR };
}

// La jornada en curso: la que ya empezo y todavia no cierra.
export function currentJornada(ref = new Date()) {
  const start = new Date(ref);
  start.setHours(CUTOFF_HOUR, 0, 0, 0);
  if (ref < start) start.setDate(start.getDate() - 1);
  return windowFrom(start);
}

// La jornada que acaba de cerrar. Es la que pide el cron del corte: cuando
// suena a las 06:00, lo que hay que resumir es lo de las 24 horas anteriores,
// no la jornada que arranca en ese mismo instante.
export function closingJornada(ref = new Date()) {
  const end = new Date(ref);
  end.setHours(CUTOFF_HOUR, 0, 0, 0);
  if (ref < end) end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return windowFrom(start);
}

// La jornada de una fecha concreta (YYYY-MM-DD), para pedirla a mano.
export function jornadaForDate(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  return windowFrom(new Date(y, m - 1, d, CUTOFF_HOUR, 0, 0, 0));
}

export function describeWindow({ start, end }) {
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${localDate(start)} ${hhmm(start)} → ${localDate(end)} ${hhmm(end)}`;
}
