# Bitácora automática de actividad

Registra en qué trabajas durante el día sin que lo anotes, y al cerrar la jornada escribe un resumen en tu bitácora de Obsidian y lo manda a tu DM de Slack. Sin capturas de pantalla y sin costo de API en la captura.

## Para qué sirve

Contesta tres preguntas que normalmente quedan en la intuición:

- **En qué se fue el día** — no por app, sino por documento, página y cliente, separando el tiempo frente al teclado del de una ventana abierta sin nadie enfrente.
- **Si una tarea está tomando de más** — comparada contra tus propias sesiones anteriores, no contra una expectativa inventada.
- **Qué trabajo repetitivo vale la pena automatizar** — se vuelve visible cuando queda escrito día tras día.

Y deja la bitácora ya redactada para cuando toque reportar avance.

## Demo

Estados del ícono en la bandeja del sistema:

![Estados del ícono](docs/screenshots/estados-icono.png)

El color cambia con el estado porque el modo de falla real de un tracker es quedarse vivo sin guardar nada: si se ve igual que uno sano, nadie lo nota.

## Cómo funciona

```
Cada minuto
     │
     ▼
Ventana activa (Win32 API vía PowerShell)
     ├─► proceso + título de ventana
     └─► segundos desde el último teclado o ratón
     │
     ▼
SQLite local
     │
     ▼
06:00 — cierre de jornada
     │
     ├─► Reporte HTML            ──► correo
     └─► Una llamada a Claude    ──► resumen narrativo
                                        ├─► nota del día en Obsidian
                                        └─► DM de Slack
```

El título de ventana identifica app, documento y cliente sin modelo de por medio: `Campañas - Cliente - Google Ads - Google Chrome` es más específico que cualquier clasificación automática, y cuesta cero. La IA entra una sola vez al día, solo a redactar.

---

## La jornada va de 6 a 6

El día natural parte el trabajo real: una sesión de 22:00 a 02:00 cae en dos reportes y ninguno la describe. La jornada corre de las 06:00 a las 05:59 del día siguiente y se etiqueta con la fecha en que empezó. Se ajusta con `DAY_CUTOFF_HOUR`.

El caso límite importa: cuando el cron suena a las 06:00 en punto, lo que hay que resumir son las 24 horas anteriores, no la jornada que arranca en ese instante.

## Cómo se escribe en Obsidian

El resumen vive entre marcadores propios dentro de la nota del día, así que convive con lo que ya esté ahí de otras fuentes sin pisarlo:

```markdown
## ⏱️ Tiempo por actividad
<!-- screen-tracker:inicio -->
🕐 1h 10min registrados · ⚡ 1h 10min de tiempo activo (100%)

📝 Casi todo el bloque de código ocurrió dentro de un mismo workspace
   (≈37 min), repartido entre documentos distintos.

⚡ 70 min de actividad continua, pero muy fragmentados: 20 ventanas distintas
   y solo una superó los 10 minutos seguidos.
<!-- screen-tracker:fin -->
```

## Los dos motores de captura

| | `window` | `vision` |
|---|---|---|
| Qué lee | Título de ventana y proceso | Captura de pantalla analizada por un modelo |
| Costo | Cero | Una llamada por captura |
| Precisión de la app | Exacta, nombre canónico | Texto libre, se fragmenta en variantes |
| Identifica cliente | Sí, si el título lo trae | Rara vez |
| Ve contenido | No | Sí |

La columna `source` distingue el origen de cada fila porque `productive` significa cosas distintas en cada motor: en `window` es que hubo teclado o ratón, en `vision` era el juicio del modelo. Sumarlas sin distinguir daría números falsos.

## Cómo se mide el tiempo

De la distancia real entre capturas consecutivas, no del conteo de filas por el intervalo — con el tracker caído seis horas y diez capturas sueltas, contar filas reportaría diez minutos de trabajo. Los huecos mayores a `MAX_GAP_MINUTES` se cortan: ahí la máquina estaba suspendida.

## Privacidad

No se guarda ninguna imagen. El modo `window` no toma capturas: lee el título de la ventana y ya. El modo `vision` escribía el jpg, lo mandaba a la API y lo borraba en la misma operación. Todo vive en una base SQLite local.

---

## Setup

```bash
cp .env.example .env
npm install
npm run tray           # bandeja + captura
npm run build:win      # instalador con arranque automático
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run tray` | Bandeja del sistema con la captura corriendo |
| `npm start` | Solo la captura, sin bandeja |
| `npm run report` | Reporte de la jornada en curso |
| `node src/report.js 2026-09-24` | Reporte de una jornada concreta |
| `node src/daily-summary.js 2026-09-24` | Resumen narrativo a Obsidian y Slack |

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CAPTURE_MODE` | `window` (título de ventana, sin costo) o `vision` (captura + modelo) |
| `CAPTURE_INTERVAL_MINUTES` | Minutos entre capturas (default: `5`) |
| `IDLE_THRESHOLD_SECONDS` | Sin teclado ni ratón por este tiempo, cuenta como inactivo (default: `120`) |
| `DAY_CUTOFF_HOUR` | Hora de corte de la jornada (default: `6`) |
| `MAX_GAP_MINUTES` | Hueco máximo que cuenta como trabajo (default: `5`) |
| `REPORT_HOUR` | Hora del cierre de jornada |
| `OBSIDIAN_VAULT_PATH` | Carpeta del vault donde vive `Resumen YYYY-MM-DD.md` |
| `SLACK_BOT_TOKEN` | Con el token el resumen llega al DM; sin él, al canal del webhook |
| `SLACK_USER_ID` | Usuario que recibe el DM |
| `SLACK_WEBHOOK_URL` | Alternativa al token |
| `ANTHROPIC_API_KEY` | Solo para `CAPTURE_MODE=vision` |
| `ANALYSIS_MODEL` | Modelo del modo visión (default: `claude-haiku-4-5`) |
| `EMAIL_USER` / `EMAIL_PASS` / `EMAIL_TO` | Envío del reporte HTML por correo |
| `DB_PATH` | Base SQLite (default: `./data/tracker.db`) |

---

## Tech stack

- **PowerShell + Win32 API** — `GetForegroundWindow` y `GetLastInputInfo` dan app, documento y tiempo inactivo sin dependencias nativas ni permisos especiales
- **Node.js (ESM)** — la captura y la orquestación son lógica simple, no hace falta framework
- **SQLite** (`node-sqlite3-wasm`) — base local sin binario nativo que compilar por plataforma
- **Electron** — la bandeja supervisa el proceso hijo y lo relanza con backoff; sin eso, una caída deja el ícono visible y la captura muerta
- **electron-builder** — instalador de Windows que se registra solo en el arranque
- **Claude Code en modo headless** — una llamada al día para redactar, autenticada con suscripción en vez de crédito de API
- **Slack Web API** — `conversations.open` para el DM directo, no un webhook a canal fijo
