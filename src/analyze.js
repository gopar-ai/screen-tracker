import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.ANALYSIS_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 6000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un 4xx que no sea 429 está mal formado: reintentarlo da el mismo error y quema una captura.
const isRetryable = (err) => {
  const status = err?.status;
  if (status === undefined) return true; // error de red
  return status === 429 || status >= 500;
};

const SYSTEM_PROMPT = `You are a productivity analyst AI. Analyze screenshots and return ONLY a JSON object, no markdown.

Schema:
{
  "app": "primary app or website visible",
  "task": "brief description of specific task (max 80 chars)",
  "productive": true/false,
  "confidence": 0.0-1.0,
  "category": "coding|writing|design|communication|research|learning|admin|entertainment|social_media|idle|other",
  "notes": "optional context (max 100 chars)"
}`;

// Devuelve null si el análisis no se pudo completar: la captura se descarta en vez de
// guardarse como "Unknown / no productiva", que ensuciaba las métricas del día.
export async function analyzeScreenshot({ base64, mediaType = 'image/jpeg' }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Analyze this screenshot and return the JSON object.' }
          ]
        }]
      });
      const raw = response.content[0].text.trim();
      // Limpiar markdown fences si vienen
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(clean);
      return {
        app: parsed.app || 'Unknown',
        task: parsed.task || 'Unknown task',
        productive: Boolean(parsed.productive),
        confidence: Number(parsed.confidence) || 0.5,
        category: parsed.category || 'other',
        notes: parsed.notes || '',
        rawAnalysis: clean,
      };
    } catch (err) {
      // Un JSON malformado sí se reintenta: es salida del modelo, no un error de la petición.
      const retryable = err instanceof SyntaxError || isRetryable(err);
      if (attempt === MAX_ATTEMPTS || !retryable) {
        console.error(`❌  Análisis fallido tras ${attempt} intento(s):`, err.message);
        return null;
      }
      console.warn(`⚠️   Intento ${attempt}/${MAX_ATTEMPTS} falló (${err.message}) — reintentando...`);
      await sleep(BACKOFF_MS[attempt - 1]);
    }
  }
  return null;
}
