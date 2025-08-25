// Helper: Update AvWPP (Q) column for a candidate after sending a main message
async function updateAvWPP(phone, code) {
  try {
    const sheets = await getSheetsClient();
    // Fetch all candidates to find the row
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Z10000`
    });
    const rows = res.data.values || [];
    if (!rows.length) return;
    // Find the row index (1-based for Sheets API)
    const phoneCol = COL.phone - 1;
    const qCol = 16; // Q = 17th column, 0-based index is 16
    let foundRow = -1;
    for (let i = 1; i < rows.length; ++i) {
      const rowPhone = (rows[i][phoneCol] || '').replace(/\s+/g, '');
      if (normalizePhoneE164(rowPhone) === normalizePhoneE164(phone)) {
        foundRow = i + 1; // +1 for header row, +1 for 1-based
        break;
      }
    }
    if (foundRow === -1) return;
    // Get current value in Q
    let current = (rows[foundRow-1][qCol] || '').trim();
    // Append code if not already present
    let codes = current ? current.split(' , ').map(x => x.trim()).filter(Boolean) : [];
    // Only append if not already present as the last code
    if (codes.length === 0 || codes[codes.length - 1] !== code) {
      // Remove all previous occurrences of this code (to avoid duplicates)
      codes = codes.filter(c => c !== code);
      codes.push(code);
    }
    // Ensure codes are always in the order of FLOW
    const FLOW_ORDER = ['11','12','13','14','21','22','23','24','31','33','41','NF','Des'];
    codes = codes.filter(c => FLOW_ORDER.includes(c));
    codes.sort((a, b) => FLOW_ORDER.indexOf(a) - FLOW_ORDER.indexOf(b));
    // Only keep up to and including the current code
    const idx = codes.indexOf(code);
    const newVal = codes.slice(0, idx + 1).join(' , ');
    // Update the cell
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!Q${foundRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newVal]] }
    });
    console.log(`[SHEET] Updated AvWPP for ${phone}: ${newVal}`);
  } catch (e) {
    console.error('[SHEET] Error updating AvWPP:', e?.message || e);
  }
}
// index.js
// Flow principal: 11 → (reply=next) o (2h→NF) → (reply=next) o (2h→Des)
// Programados por fecha de proceso (por candidato):
//   21 (2 días antes 16:00)  • 22 (2 días antes 16:05)
//   23 (1 día antes 09:00)   • 24 (1 día antes 16:26)
//   41 (1 día después 16:00)

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const QRCode = require('qrcode');
// ================== QR WEB SERVER ==================
let latestQR = null;
let qrTimestamp = 0;
const qrListeners = [];

const app = express();
const PORT = process.env.PORT || 3000;

// Endpoint para mostrar el QR como imagen y refrescar automáticamente
app.get('/qr', async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let html = `<!DOCTYPE html><html><head><title>WhatsApp QR</title>
    <meta name='viewport' content='width=device-width,initial-scale=1'>
    <style>body{font-family:sans-serif;text-align:center;background:#f9f9f9}#qr{margin:2em auto;max-width:90vw;}h1{color:#25d366}#refresh{color:#888;font-size:0.9em}</style>
    <script>
      function pollQR() {
        fetch('/qr-data').then(r => r.json()).then(data => {
          if (data.qr && data.qr !== window.lastQR) {
            document.getElementById('qrimg').src = 'data:image/png;base64,' + data.img;
            window.lastQR = data.qr;
            document.getElementById('refresh').textContent = 'Actualizado: ' + new Date(data.ts).toLocaleTimeString();
          }
          setTimeout(pollQR, 2000);
        });
      }
      window.onload = pollQR;
    </script>
  </head><body>
    <h1>Escanea el QR de WhatsApp</h1>
    <div id='qr'>
      <img id='qrimg' src='' alt='QR' style='width:320px;max-width:90vw;background:#fff;padding:8px;border-radius:8px;box-shadow:0 2px 8px #0001'>
    </div>
    <div id='refresh'>Cargando QR...</div>
    <p>Abre WhatsApp y escanea este código para iniciar sesión.</p>
  </body></html>`;
  res.end(html);
});

// Endpoint para obtener el QR y la imagen en base64 (para AJAX)
app.get('/qr-data', async (req, res) => {
  if (!latestQR) return res.json({ qr: null });
  try {
    const img = await QRCode.toDataURL(latestQR, { margin: 2, width: 320 });
    res.json({ qr: latestQR, img: img.replace(/^data:image\/png;base64,/, ''), ts: qrTimestamp });
  } catch (e) {
    res.json({ qr: latestQR, img: null, ts: qrTimestamp });
  }
});

app.get('/', (req, res) => res.redirect('/qr'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Express escuchando en http://localhost:${PORT}/qr`);
});
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
  const jsonPath = path.join(__dirname, 'service-account.json');
  fs.writeFileSync(
    jsonPath,
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
  );
}
// Ahora puedes usar service-account.json normalmente

/* ================== CONFIG ================== */

// ---- Google Sheets (AppSheet escribe aquí) ----
const SPREADSHEET_ID = process.env.SHEET_ID || '1ZW__7IeXpwzTu9TDzA8IToKwFpiq3q_gtvgYwDnhbKg'; // SOLO el ID
const SHEET_RANGE    = process.env.SHEET_RANGE || 'Mensajes!A:B'; // A: Code, B: Message (no esencial, usamos A1:Z)
const SA_FILE        = process.env.SA_FILE || 'service-account.json';

// ---- WhatsApp ----
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'inquilinos-bot' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

// ---- Tiempos de NF / Des ---- (ajusta a producción: 2h = 2 * 60 * 60 * 1000)
const TIME_NF_MS  = 1 * 60 * 1000; // 1 min (testing)
const TIME_DES_MS = 1 * 60 * 1000; // 1 min (testing)

// ---- Hoja "Candidatos contactados" (A=1) ----
const SHEET_NAME = 'Candidatos contactados';
const COL = {
  process: 1,  // A: Procesos (p.ej., 21ago25)
  phone:   4,  // D: Número
  name:    7   // G: Nombre
};

// Default country code for local numbers (change as needed)
const DEFAULT_CC = '34'; // Spain
const DRY_RUN = false; // true para pruebas sin enviar

// ---- Zona horaria recomendada ----
const TZ = 'Europe/Madrid';

/* ================== HELPERS ================== */

function readServiceAccount() {
  const p = path.resolve(SA_FILE);
  const raw = fs.readFileSync(p, 'utf8');
  const sa = JSON.parse(raw);
  if (sa.private_key && sa.private_key.includes('\\n')) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa;
}

async function getSheetsClient() {
  const sa = readServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// now() en Madrid (sin dependencias externas)
function nowMadrid() {
  const now = new Date();
  // "sv-SE" (YYYY-MM-DD HH:mm:ss) evita ambigüedad de toLocaleString
  const s = now.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
  return new Date(s);
}

// Parsea "26ago25" → Date
function parseProcesoDate(str) {
  if (!str) return null;
  const months = {
    'ene': 0, 'feb': 1, 'mar': 2, 'abr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'ago': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11
  };
  const m = str.match(/(\d{1,2})([a-z]{3})(\d{2,4})/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = months[m[2].toLowerCase()];
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (isNaN(day) || isNaN(mon) || isNaN(year)) return null;
  const d = new Date(Date.UTC(year, mon, day, 0, 0, 0));
  // conviértela a hora local Madrid a medianoche
  const s = d.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
  return new Date(s);
}

function onlyDigits(s) { return (s || '').replace(/\D+/g, ''); }

function normalizePhoneE164(input) {
  if (!input) return '';
  let s = input.replace(/\s+/g, '');
  s = s.replace(/[^\d+]/g, '');
  // If already in + format and at least 8 digits, accept as is
  if (/^\+\d{8,}$/.test(s)) return s;
  // If starts with 00, convert to +
  if (/^00\d{8,}$/.test(s)) return `+${s.slice(2)}`;
  // If 9 digits, assume Spain (+34)
  if (/^\d{9}$/.test(s)) return `+34${s}`;
  // If 10+ digits, assume international (missing +)
  if (/^\d{10,}$/.test(s)) return `+${s}`;
  // If nothing matches, return empty
  return '';
}

function toWhatsAppJid(e164) {
  const digits = onlyDigits(e164);
  return `${digits}@c.us`;
}

function fillVars(text, ctx) {
  if (typeof text !== 'string') text = '';
  const firstName = (ctx && ctx.name ? ctx.name.split(' ')[0] : '') || '';
  return text.replace(/\{\{name\}\}/g, firstName);
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function isIndividualJid(jid) {
  return jid.endsWith('@c.us');
}

async function sendWhatsApp(jid, body) {
  if (DRY_RUN) {
    console.log(`[DRY] → ${jid}: ${body}`);
    return;
  }
  try {
    await client.sendMessage(jid, body);
  } catch (e) {
    console.error(`[WA SEND ERROR] to ${jid}:`, e?.message || e);
    // Reintento simple
    await sleep(1000);
    await client.sendMessage(jid, body);
  }
}

// Rango semanal (Lunes–Domingo) — opcional
function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Dom,1=Lun
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);
  return { monday, sunday };
}

function atTime(baseDate, hour, minute=0) {
  const d = new Date(baseDate);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function minusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}

function plusDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ¿Está dentro de ±windowMin minutos?
function isWithinWindow(now, target, windowMin = 10) {
  const diff = Math.abs(now.getTime() - target.getTime());
  return diff <= windowMin * 60 * 1000;
}

/* ================== TEMPLATES ================== */

// Mensajes y PROCESS_KEY
let TEMPLATES = {};
let PROCESS_KEY = '';

// Carga mensajería y PROCESS_KEY desde la hoja "Mensajes"
async function loadTemplates() {
  const sheets = await getSheetsClient();
  const range = `Mensajes!A1:Z100`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range
  });
  const rows = res.data.values || [];
  const headerRow = rows[0] || [];

  // Buscar PROCESS_KEY en cualquier celda del header (e.g., "PROCESS_KEY=21ago25")
  for (const cell of headerRow) {
    if (typeof cell === 'string' && cell.startsWith('PROCESS_KEY=')) {
      PROCESS_KEY = cell.split('=')[1].trim();
      break;
    }
  }

  // Detectar columnas Code y Message
  const header = headerRow.map(h => (h || '').toString().trim().toLowerCase());
  const codeIdx = header.findIndex(h => h === 'code');
  const msgIdx  = header.findIndex(h => h === 'message');
  if (codeIdx === -1 || msgIdx === -1) {
    console.error('Header row recibido de Mensajes:', header);
    throw new Error('La hoja Mensajes debe tener columnas: Code, Message (en la fila 1).');
  }

  const messages = {};
  for (const row of rows.slice(1)) {
    const code = (row[codeIdx] || '').trim();
    const msg  = (row[msgIdx]  || '').trim();
    if (code && msg) messages[code] = msg;
  }
  TEMPLATES = messages;
  console.log('🗂️  Plantillas:', Object.keys(TEMPLATES), 'PROCESS_KEY:', PROCESS_KEY || '(vacío)');
}

// Alternativa: leer PROCESS_KEY desde C1 con formato "PROCESS_KEY=..."
async function getCurrentProcesoKey() {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Mensajes!C1`,
    });
    const val = (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
    const m = val.match(/PROCESS_KEY\s*=\s*(\S+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/* ================== DATA (Candidatos) ================== */

async function fetchCandidates() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:Z10000`
  });
  const rows = res.data.values || [];
  if (!rows.length) return [];
  const out = [];
  // Column S = 19 (0-based index 18)
  for (const r of rows.slice(1)) {
    const estatus = (r[18] || '').trim().toLowerCase();
    if (estatus === 'inactivo') continue;
    out.push({
      process: (r[COL.process - 1] || '').trim(), // ej. 21ago25
      phone:   (r[COL.phone   - 1] || '').trim(),
      name:    (r[COL.name    - 1] || '').trim(),
      estatus
    });
  }
  return out;
}

/* ================== FLOW ENGINE (11–14 + NF/Des) ================== */

const CONFIRM_REGEX = /(hola[, ]*)?confirm(o|amos)([^\w]|$)|confirmo asistencia([^\w]|$)|sí([^\w]|$)|de acuerdo([^\w]|$)|adelante([^\w]|$)|list[ao]([^\w]|$)|interesad[oa]([^\w]|$)|me apunto([^\w]|$)|quiero([^\w]|$)|perfecto([^\w]|$)|yes([^\w]|$)|confirm([^\w]|$)/i;
const UNINTERESTED_REGEX = /no (quiero|me interesa|puedo|continuar|asistir|seguir|interesa|voy|gracias|estoy interesado|participar|seguir|asistir|interesad[oa]|confirmo)|no confirmo|yo no me interesa|no gracias|no, gracias|no puedo|no voy|no asistir|no participo|no deseo|no deseo continuar|no deseo seguir|no deseo participar|no deseo asistir|no deseo seguir/i;

const FLOW = ['11','12','13','14'];
const NF_CODE  = 'NF';
const DES_CODE = 'Des';
const state = Object.create(null);

function clearTimers(jid) {
  const s = state[jid];
  if (!s) return;
  if (s.nfTimer)  clearTimeout(s.nfTimer);
  if (s.desTimer) clearTimeout(s.desTimer);
  state[jid].nfTimer = null;
  state[jid].desTimer = null;
}

async function sendMainStep(jid, name) {
  const s = state[jid] || {};
  const idx = s.step || 0;
  if (idx >= FLOW.length) return;
  const code = FLOW[idx];
  const body = fillVars(TEMPLATES[code], { name });
  // Update AvWPP in sheet (Q column) for this candidate BEFORE sending WhatsApp
  const phone = (jid || '').replace(/@c\.us$/, '');
  await updateAvWPP(phone, code);
  await sendWhatsApp(jid, body);
  console.log(`✅ Sent (${code}) to ${jid}`);
  clearTimers(jid);
  if (idx + 1 >= FLOW.length) {
    state[jid] = { ...s, step: idx + 1, phase: 'done', nfTimer: null, desTimer: null };
  } else {
    state[jid] = { ...s, step: idx + 1, phase: 'wait_reply',
      nfTimer: setTimeout(() => sendNF(jid, name), TIME_NF_MS) };
  }
}

async function sendNF(jid, name) {
  const s = state[jid] || {};
  if (!['wait_reply'].includes(s.phase)) return;
  const body = fillVars(TEMPLATES[NF_CODE], { name });
  await sendWhatsApp(jid, body);
  console.log(`⏰ Sent NF to ${jid}`);
  clearTimers(jid);
  state[jid] = { ...s, phase: 'wait_nf',
    desTimer: setTimeout(() => sendDes(jid, name), TIME_DES_MS) };
}

async function sendDes(jid, name) {
  const s = state[jid] || {};
  if (s.phase !== 'wait_des' && s.phase !== 'wait_nf' && s.phase !== 'awaiting_confirmation') {
    // Igual enviamos como cierre si ya no interesa
  }
  const body = fillVars(TEMPLATES[DES_CODE], { name });
  await sendWhatsApp(jid, body);
  console.log(`⏰ Sent Des to ${jid}`);
  clearTimers(jid);
  state[jid] = { ...s, phase: 'done' };
}

// Antes lo llamabas dentro del handler, aquí va arriba y único
function isStrongUninterested(text) {
  const trimmed = String(text || '').trim().toLowerCase();
  if (/^no[.!?\s]*$/i.test(trimmed)) return false; // "no" solo, no dispara
  return UNINTERESTED_REGEX.test(trimmed);
}

/* ================== PROGRAMADOS 21/22/23/24/41 ================== */

// Definición precisa
const SCHEDULED_FLOW = [
  { codes: ['21'], offsetDays: 2, hour: 16, minute: 0  }, // 2 días antes 16:00
  { codes: ['22'], offsetDays: 2,  hour: 16, minute: 5  }, // 2 días antes 16:05
  { codes: ['23'], offsetDays: 1,  hour: 9,  minute: 0  }, // 1 día  antes 09:00
  { codes: ['24'], offsetDays: 1,  hour: 16, minute: 26 }, // 1 día  antes 16:26
  { codes: ['31', '33'], offsetDays: 0, hour: 18, minute: 0  }, // On proceso day at 16:00
  { codes: ['41'], offsetDays: -1, hour: 16, minute: 0  }, // 1 día  después 16:00
];

// Enviar si toca (NO depende del flujo 11–14)
async function checkAndSendScheduled(jid, name, procesoDate) {
  const now = nowMadrid();

  // Opcional limitar a semana actual (comentado para no perder disparos por ventanas)
  // const { monday, sunday } = getWeekRange(now);
  // if (procesoDate < monday || procesoDate > sunday) return;

  state[jid] = state[jid] || {};
  state[jid].scheduled = state[jid].scheduled || {};

  for (const block of SCHEDULED_FLOW) {
    for (const code of block.codes) {
      if (state[jid].scheduled[code]) continue;

      // offsetDays: positivo = días antes, negativo = después
      const when = new Date(procesoDate);
      when.setDate(when.getDate() - block.offsetDays);
      when.setHours(block.hour, block.minute, 0, 0);

      console.log(`[SCHEDULED] jid=${jid} code=${code} when=${when.toISOString()} now=${now.toISOString()}`);

      if (isWithinWindow(now, when, 10)) { // ventana ±10 min
        const body = fillVars(TEMPLATES[code], { name });
        await sendWhatsApp(jid, body);
        state[jid].scheduled[code] = true;
        console.log(`✅ Sent (${code}) to ${jid} (scheduled)`);
        await sleep(300);
      }
    }
  }
}

async function runScheduledBlocks() {
  try {
    const candidates = await fetchCandidates();

    // Asegura PROCESS_KEY desde header o C1
    if (!PROCESS_KEY) {
      const pk = await getCurrentProcesoKey();
      if (pk) PROCESS_KEY = pk;
    }
    if (!PROCESS_KEY) {
      console.log('[SCHEDULED] Sin PROCESS_KEY, no se programan envíos.');
      return;
    }

    for (const c of candidates) {
      if (!c.phone || !c.process) continue;
      if (c.process.toLowerCase() !== PROCESS_KEY.toLowerCase()) continue;
      const e164 = normalizePhoneE164(c.phone);
      const jid = toWhatsAppJid(e164);
      const name = c.name || 'Candidato';
      const procesoDate = parseProcesoDate(c.process);
      if (!procesoDate) continue;
      if (!canSendScheduled(jid)) {
        // Debug: show why skipping
        // console.log(`[SCHEDULED] Skipping ${jid}: main flow not finished`);
        continue;
      }
      await checkAndSendScheduled(jid, name, procesoDate);
    }
  } catch (e) {
    console.error('[SCHEDULED ERROR]', e?.message || e);
  }
}

/* ================== MAIN ================== */

client.on('qr', (qr) => {
  latestQR = qr;
  qrTimestamp = Date.now();
  qrcode.generate(qr, { small: true }); // sigue mostrando en consola
  // Notificar listeners (si algún día se usan SSE/websockets)
  qrListeners.forEach(fn => fn(qr));
});

client.on('authenticated', () => {
  console.log('✅ Cliente autenticado');
});

client.on('ready', async () => {
  console.log('✅ Cliente listo');
  try {
    await loadTemplates();
    // refrescar plantillas y PROCESS_KEY cada 5 min
    setInterval(loadTemplates, 5 * 60 * 1000);
  } catch (e) {
    console.error('Error al cargar plantillas:', e);
  }
  // verificar programados cada 5 min
  setInterval(runScheduledBlocks, 5 * 60 * 1000);
});

client.on('message', async (msg) => {
  const jid  = msg.from;
  const text = String(msg.body || '').trim();

  // Intentar obtener un nombre legible
  let name = 'Candidato';
  if (msg.notifyName) {
    name = msg.notifyName;
  } else if (msg._data && msg._data.notifyName) {
    name = msg._data.notifyName;
  } else if (msg.sender && msg.sender.pushname) {
    name = msg.sender.pushname;
  }

  // Buscar al candidato por su teléfono
  const all = await fetchCandidates();
  const candidate = all.find(c => toWhatsAppJid(normalizePhoneE164(c.phone)) === jid);
  if (!candidate) {
    console.log(`[SKIP] Message from non-candidate: ${jid}`);
    return;
  }

  // Validar que coincide con PROCESS_KEY activo
  const procesoKey = PROCESS_KEY || (await getCurrentProcesoKey());
  if (!procesoKey || candidate.process.toLowerCase() !== procesoKey.toLowerCase()) {
    console.log(`[SKIP] Candidate ${jid} no coincide con PROCESS_KEY (${procesoKey})`);
    return;
  }

  // Estado inicial
  let s = state[jid] || {};
  if (!s.phase) s.phase = 'awaiting_confirmation';
  if (s.phase === 'done') return;

  // Esperando confirmación
  if (s.phase === 'awaiting_confirmation') {
    if (CONFIRM_REGEX.test(text)) {
      if (typeof s.step === 'number' && s.step > 0) {
        console.log(`[FLOW] Already confirmed for ${jid}`);
        return;
      }
      console.log(`✅ Confirmación de ${jid}: ${text}`);
      state[jid] = { step: 0, phase: 'wait_reply' };
      await sendMainStep(jid, name);
    } else if (isStrongUninterested(text)) {
      state[jid] = { ...s, phase: 'done' };
      await sendDes(jid, name);
      console.log(`🚫 Usuario no interesado (${jid}): ${text}`);
    } else {
      console.log(`[WAIT] Awaiting confirmation from ${jid}`);
    }
    return;
  }

  // Flujo principal en marcha
  if (s.phase === 'wait_reply' || s.phase === 'wait_nf') {
    if (isStrongUninterested(text)) {
      state[jid] = { ...s, phase: 'done' };
      await sendDes(jid, name);
      console.log(`🚫 Usuario no interesado (${jid}): ${text}`);
      return;
    }
    if (typeof s.step !== 'number') s.step = 0;
    if (s.step >= FLOW.length) {
      console.log(`[FLOW] Already finished for ${jid}`);
      return;
    }
    await sendMainStep(jid, name);
    return;
  }
});

client.initialize();

function canSendScheduled(jid) {
  const s = state[jid];
  return s && (s.step || 0) >= FLOW.length && s.phase === 'done';
}
