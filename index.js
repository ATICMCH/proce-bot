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
    const FLOW_ORDER = ['11','12','13','14','21','22','23','24','31','33','41','NF','2NF'];
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

// Helper: Update status from Active to Inactive when 2NF is sent
async function updateStatusToInactive(phone) {
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
    const statusCol = 18; // S = 19th column, 0-based index is 18
    let foundRow = -1;
    
    for (let i = 1; i < rows.length; ++i) {
      const rowPhone = (rows[i][phoneCol] || '').replace(/\s+/g, '');
      if (normalizePhoneE164(rowPhone) === normalizePhoneE164(phone)) {
        foundRow = i + 1; // +1 for header row, +1 for 1-based
        break;
      }
    }
    if (foundRow === -1) return;
    
    // Update the status cell to "Inactivo"
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!S${foundRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Inactivo']] }
    });
    console.log(`[SHEET] Updated status to Inactivo for ${phone}`);
  } catch (e) {
    console.error('[SHEET] Error updating status:', e?.message || e);
  }
}

// Helper: Update Notes column (column I = index 8)
async function updateNotes(phone, note) {
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
    const notesCol = 8; // I = 9th column, 0-based index is 8
    let foundRow = -1;
    
    for (let i = 1; i < rows.length; ++i) {
      const rowPhone = (rows[i][phoneCol] || '').replace(/\s+/g, '');
      if (normalizePhoneE164(rowPhone) === normalizePhoneE164(phone)) {
        foundRow = i + 1; // +1 for header row, +1 for 1-based
        break;
      }
    }
    if (foundRow === -1) return;
    
    // Get current notes and append new note
    let currentNotes = (rows[foundRow-1][notesCol] || '').trim();
    let newNotes = currentNotes ? `${currentNotes} | ${note}` : note;
    
    // Update the notes cell
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!I${foundRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newNotes]] }
    });
    console.log(`[SHEET] Updated Notes for ${phone}: ${note}`);
  } catch (e) {
    console.error('[SHEET] Error updating Notes:', e?.message || e);
  }
}

// index.js
// Flow principal: 11 → (reply=next) o (2h→NF) → (reply=next) o (2h→2NF)
// Programados por fecha de proceso (por candidato):
//   21 (2 días antes 11:00)  • 22 (en respuesta al 21)
//   23 (1 día antes 11:00)   • 24 (en respuesta al 23)
//   31 (0 día antes 12:00)   • 33 (en respuesta al 31)
//   41 (1 día después 19:00)

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/* ================== CONFIG ================== */

// ---- Google Sheets (AppSheet escribe aquí) ----
const SPREADSHEET_ID = process.env.SHEET_ID || '1ataoMxpKoOTdoQWDEAX0vO2k7icEoPtz8TDvY51G5Fc'; // SOLO el ID
const SHEET_RANGE    = process.env.SHEET_RANGE || 'Mensajes!A:B'; // A: Code, B: Message (no esencial, usamos A1:Z)
const SA_FILE        = process.env.SA_FILE || 'service-account.json';

// ---- WhatsApp ----
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'inquilinos-bot' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

// ---- Tiempos de NF / 2NF ---- (ajusta a producción: 2h = 2 * 60 * 60 * 1000)
const TIME_NF_MS  = 20 * 60 * 1000; // 20 minutos
const TIME_2NF_MS = 20 * 60 * 1000; // 20 minutos
// const TIME_NF_MS  = 1 * 60 * 1000; // 1 min (testing)
// const TIME_2NF_MS = 1 * 60 * 1000; // 1 min (testing)

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

// ---- Express Server para QR ----
const app = express();
const PORT = process.env.PORT || 3000;
let currentQR = null;

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
    const estatus = (r[18] || '').trim();
    const procesoStatus = (r[15] || '').trim();
    
    if (estatus !== 'Activo') continue;
    if (procesoStatus !== 'Proceso' && procesoStatus !== 'Examen') continue;
    out.push({
      process: (r[COL.process - 1] || '').trim(), 
      phone:   (r[COL.phone   - 1] || '').trim(),
      name:    (r[COL.name    - 1] || '').trim(),
      estatus,
      procesoStatus
    });
  }
  return out;
}

/* ================== FLOW ENGINE (11–14 + NF/Des) ================== */

const CONFIRM_REGEX = /(hola[, ]*)?confirm(o|amos)([^\w]|$)|confirmo asistencia([^\w]|$)|sí([^\w]|$)|de acuerdo([^\w]|$)|adelante([^\w]|$)|list[ao]([^\w]|$)|interesad[oa]([^\w]|$)|me apunto([^\w]|$)|quiero([^\w]|$)|perfecto([^\w]|$)|yes([^\w]|$)|confirm([^\w]|$)/i;
const UNINTERESTED_REGEX = /no (quiero|me interesa|puedo|continuar|asistir|seguir|interesa|voy|gracias|estoy interesado|participar|seguir|asistir|interesad[oa]|confirmo)|no confirmo|yo no me interesa|no gracias|no, gracias|no puedo|no voy|no asistir|no participo|no deseo|no deseo continuar|no deseo seguir|no deseo participar|no deseo asistir|no deseo seguir/i;

const FLOW = ['11','12','13','14'];
const NF_CODE  = 'NF';
const DES_CODE = '2NF';
const UNINTERESTED_CODE = 'DES'; // ← Nueva constante para mensajes de desinterés
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
  // Permitir NF tanto para flujo principal como para mensajes programados
  if (!['wait_reply'].includes(s.phase) && !s.lastScheduledSent) return;
  
  const body = fillVars(TEMPLATES[NF_CODE], { name });
  
  // Actualizar columna de Notas para NF (no AvWPP)
  const phone = (jid || '').replace(/@c\.us$/, '');
  await updateNotes(phone, NF_CODE);
  
  await sendWhatsApp(jid, body);
  console.log(`⏰ Sent NF to ${jid}`);
  clearTimers(jid);
  state[jid] = { ...s, phase: 'wait_nf',
    desTimer: setTimeout(() => send2NF(jid, name), TIME_2NF_MS) };
}

async function send2NF(jid, name) {
  const s = state[jid] || {};
  if (s.phase !== 'wait_des' && s.phase !== 'wait_nf' && s.phase !== 'awaiting_confirmation') {
    // Igual enviamos como cierre si ya no interesa
  }
  const body = fillVars(TEMPLATES[DES_CODE], { name });
  
  // Actualizar sheet: agregar 2NF a AvWPP, cambiar estatus a Inactivo y agregar a notas
  const phone = (jid || '').replace(/@c\.us$/, '');
  await updateStatusToInactive(phone);
  await updateNotes(phone, DES_CODE);
  
  await sendWhatsApp(jid, body);
  console.log(`⏰ Sent 2NF to ${jid}`);
  clearTimers(jid);
  state[jid] = { ...s, phase: 'done' };
}

// Nueva función para enviar mensaje DES
async function sendDES(jid, name) {
  const body = fillVars(TEMPLATES[UNINTERESTED_CODE], { name });
  const phone = (jid || '').replace(/@c\.us$/, '');
  await updateStatusToInactive(phone);
  await updateNotes(phone, UNINTERESTED_CODE);
  await sendWhatsApp(jid, body);
  console.log(`🚫 Sent DES to ${jid}`);
  clearTimers(jid);
  state[jid] = { ...state[jid], phase: 'done' };
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
  { codes: ['21'], offsetDays: 2, hour: 11, minute: 0 }, // 2 días antes 11:00
  { codes: ['23'], offsetDays: 1,  hour: 11,  minute: 0 }, // 1 día  antes 11:00
  { codes: ['31'], offsetDays: 0, hour: 12, minute: 0 }, // En el día del proceso a las 12:00
  { codes: ['41'], offsetDays: -1, hour: 19, minute: 30 }, // 1 día  después 19:30
];

// Definir pares de respuesta: cuando responden al primer código, se envía el segundo
const RESPONSE_PAIRS = {
  '21': '22', // Cuando responden al 21, enviar 22
  '23': '24', // Cuando responden al 23, enviar 24
  '31': '33'  // Cuando responden al 31, enviar 33
};

// Definir dependencias: qué mensaje requiere respuesta del anterior
const RESPONSE_DEPENDENCIES = {
  '23': '22', // 23 solo se envía si respondió al 22
  '31': '24', // 31 solo se envía si respondió al 24
  '41': '33'  // 41 solo se envía si respondió al 33
};

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

      // Verificar dependencias: si este código requiere respuesta previa
      const requiredResponse = RESPONSE_DEPENDENCIES[code];
      if (requiredResponse) {
        const hasResponded = state[jid].responses && state[jid].responses[requiredResponse];
        if (!hasResponded) {
          console.log(`[SCHEDULED] Skipping ${code} for ${jid}: no response to ${requiredResponse}`);
          continue;
        }
      }

      // offsetDays: positivo = días antes, negativo = después
      const when = new Date(procesoDate);
      when.setDate(when.getDate() - block.offsetDays);
      when.setHours(block.hour, block.minute, 0, 0);

      console.log(`[SCHEDULED] jid=${jid} code=${code} when=${when.toISOString()} now=${now.toISOString()}`);

      if (isWithinWindow(now, when, 10)) { // ventana ±10 min
        const body = fillVars(TEMPLATES[code], { name });
        const phone = (jid || '').replace(/@c\.us$/, '');
        // Actualizar sheet antes de enviar
        await updateAvWPP(phone, code);
  
        await sendWhatsApp(jid, body);
        state[jid].scheduled[code] = true;
  
        // NUEVO: Rastrear el último mensaje programado enviado
        state[jid].lastScheduledSent = code;
        
        // Programar NF para mensajes programados que no son de respuesta automática
        if (
          !RESPONSE_PAIRS[Object.keys(RESPONSE_PAIRS).find(key => RESPONSE_PAIRS[key] === code)]
          && code !== '41' // ← No programar NF para 41
        ) {
          clearTimers(jid); // Limpiar timers existentes
          state[jid].nfTimer = setTimeout(() => sendNF(jid, name), TIME_NF_MS);
        }
  
        console.log(`✅ Sent (${code}) to ${jid} (scheduled)`);
        await sleep(300);
      }
    }
  }
}

// Detectar respuestas positivas
function isPositiveResponse(text) {
  const positiveRegex = /(gracias|perfecto|genial|excelente|ok|vale|bien|entendido|recibido|de acuerdo|correcto|sí|si|okey|okay|👍|✅)/i;
  return positiveRegex.test(text);
}

// Verificar si se debe enviar mensaje de respuesta
async function checkAndSendResponseMessage(jid, name, receivedText) {
  if (!state[jid] || !state[jid].lastScheduledSent) return false;
  
  const lastSent = state[jid].lastScheduledSent;
  const responseCode = RESPONSE_PAIRS[lastSent];
  
  if (!responseCode) return false;
  
  // Verificar que no se haya enviado ya este código de respuesta
  if (state[jid].scheduled && state[jid].scheduled[responseCode]) {
    return false;
  }
  
  // Verificar que sea una respuesta positiva/confirmación
  if (CONFIRM_REGEX.test(receivedText) || isPositiveResponse(receivedText)) {
    const body = fillVars(TEMPLATES[responseCode], { name });
    const phone = (jid || '').replace(/@c\.us$/, '');
    
    // Actualizar sheet antes de enviar
    await updateAvWPP(phone, responseCode);
    
    await sendWhatsApp(jid, body);
    
    // Marcar como enviado
    if (!state[jid].scheduled) state[jid].scheduled = {};
    state[jid].scheduled[responseCode] = true;
    
    // CRUCIAL: Actualizar lastScheduledSent para que el usuario pueda responder al nuevo mensaje
    state[jid].lastScheduledSent = responseCode;
    
    // Programar NF para los mensajes de respuesta automática también
    clearTimers(jid); // Limpiar timers existentes
    state[jid].nfTimer = setTimeout(() => sendNF(jid, name), TIME_NF_MS);
    
    console.log(`✅ Sent response message (${responseCode}) to ${jid} after receiving response to ${lastSent}`);
    return true;
  }
  
  return false;
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
      if (!(await canSendScheduled(jid))) {
        // Debug: show why skipping
        console.log(`[SCHEDULED] Skipping ${jid}: main flow not finished`);
        continue;
      }
      await checkAndSendScheduled(jid, name, procesoDate);
    }
  } catch (e) {
    console.error('[SCHEDULED ERROR]', e?.message || e);
  }
}

/* ================== WEB SERVER ================== */

// Ruta para mostrar el QR
app.get('/', (req, res) => {
  if (!currentQR) {
    res.send(`
      <html>
        <head><title>WhatsApp Bot QR</title></head>
        <body style="text-align: center; font-family: Arial;">
          <h1>WhatsApp Bot</h1>
          <p>Esperando código QR...</p>
          <script>setTimeout(() => location.reload(), 5000);</script>
        </body>
      </html>
    `);
    return;
  }

  res.send(`
    <html>
      <head><title>WhatsApp Bot QR</title></head>
      <body style="text-align: center; font-family: Arial;">
        <h1>Escanea este código QR con WhatsApp</h1>
        <img src="${currentQR}" alt="QR Code" style="border: 1px solid #ccc;" />
        <p>Una vez escaneado, el bot estará listo para funcionar</p>
        <script>setTimeout(() => location.reload(), 10000);</script>
      </body>
    </html>
  `);
});

// Ruta para obtener solo el QR en formato imagen
app.get('/qr', (req, res) => {
  if (!currentQR) {
    res.status(404).send('QR no disponible');
    return;
  }
  
  // Extraer los datos base64 y enviar la imagen
  const base64Data = currentQR.replace(/^data:image\/png;base64,/, '');
  const img = Buffer.from(base64Data, 'base64');
  
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': img.length
  });
  res.end(img);
});

// Iniciar servidor Express
app.listen(PORT, () => {
  console.log(`🌐 Servidor web ejecutándose en puerto ${PORT}`);
  console.log(`🔗 QR disponible en: http://localhost:${PORT}`);
});

/* ================== WHATSAPP CLIENT ================== */

client.on('qr', async (qr) => {
  console.log('📱 Código QR generado');
  qrcode.generate(qr, { small: true });
  
  try {
    // Generar QR como imagen base64 para la web
    currentQR = await QRCode.toDataURL(qr);
    console.log('🌐 QR disponible en el servidor web');
  } catch (err) {
    console.error('Error generando QR para web:', err);
  }
});

client.on('authenticated', () => {
  console.log('✅ Cliente autenticado');
  currentQR = null; // Limpiar QR una vez autenticado
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

  // NUEVO: Verificar si debe enviar mensaje de respuesta a mensajes programados
  const sentResponseMessage = await checkAndSendResponseMessage(jid, candidate.name || name, text);
  if (sentResponseMessage) {
    // Si se envió un mensaje de respuesta, no procesar el flujo principal
    return;
  }

  // Marcar respuestas a mensajes programados y cancelar timers NF/2NF
  if (isPositiveResponse(text) || CONFIRM_REGEX.test(text)) {
    if (!state[jid]) state[jid] = {};
    if (!state[jid].responses) state[jid].responses = {};
    
    // Cancelar timers cuando hay respuesta a mensajes programados
    const lastSent = state[jid].lastScheduledSent;
    if (['21', '22', '23', '24', '31', '33', '41'].includes(lastSent)) {
      clearTimers(jid); // Cancelar NF/2NF porque respondió
      console.log(`[RESPONSE] User ${jid} responded to scheduled message ${lastSent}, timers cleared`);
    }
    
    // Verificar si el último mensaje enviado fue 22, 24, o 33 para habilitar siguientes
    if (['22', '24', '33'].includes(lastSent)) {
      state[jid].responses[lastSent] = true;
      console.log(`[RESPONSE] User ${jid} responded to ${lastSent}, enabling next message`);
    }
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
      await sendDES(jid, name); // ← Envía DES en vez de 2NF
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
      await sendDES(jid, name); // ← Envía DES en vez de 2NF
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

async function canSendScheduled(jid) {
  try {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Q10000`
    });
    
    const rows = res.data.values || [];
    const phoneCol = COL.phone - 1;
    const qCol = 16; // Columna Q (AvWPP)
    
    // Buscar fila del usuario
    for (let i = 1; i < rows.length; i++) {
      const rowPhone = (rows[i][phoneCol] || '').replace(/\s+/g, '');
      if (normalizePhoneE164(rowPhone) === normalizePhoneE164(jid.replace('@c.us', ''))) {
        const avWPP = (rows[i][qCol] || '').trim();
        // Si contiene "14", el flujo principal está completo
        return avWPP.includes('14');
      }
    }
    return false;
  } catch (e) {
    console.error('[canSendScheduled ERROR]', e);
    return false;
  }
}
//Si necesitas mas dudas puedes preguntar a Didara
