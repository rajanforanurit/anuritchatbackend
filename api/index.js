require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ObjectId } = require('mongodb')
const { BlobServiceClient } = require('@azure/storage-blob')
const { GoogleGenAI } = require('@google/genai')
const pdfParse = require('pdf-parse')
const mammoth = require('mammoth')
const XLSX = require('xlsx')
const { parse: htmlParse } = require('node-html-parser')
const yaml = require('js-yaml')
const Papa = require('papaparse')
const { simpleParser } = require('mailparser')
const { parseOffice } = require('officeparser')

const app = express()
app.use(cors())
app.use(express.json())

// ── Config ────────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB  = process.env.MONGODB_DB || 'clientcreds'
const CHAT_HISTORY_URI = process.env.CHAT_HISTORY_URI
const CHAT_HISTORY_DB = process.env.CHAT_HISTORY_DB || 'chathistory'
const AZURE_CONNECTION_STRING = process.env.AZURE_CONNECTION_STRING || ''
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'vectordbforrag'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY  || ''

const RAW_PREFIX    = 'raw'
const CHUNK_SIZE    = 500
const CHUNK_OVERLAP = 2

const SYSTEM_PROMPT = `
You are a helpful business document assistant.
Answer questions using only the provided document context.
Rules:
1. Treat all context as valid data, including tables, spreadsheets, lists, and key-value rows.
2. If a term appears anywhere in the context, it is present. Use nearby text to explain it.
3. Spreadsheet rows may act as definitions. Example:
"Category: GL Activity | Description: General Ledger transaction type"
means GL Activity is a General Ledger transaction type.
4. Match terms case-insensitively.
5. Check close variations (plural, abbreviation, reordered words) before saying missing.
6. If truly not found, reply exactly:
"I couldn't find specific information about that in your documents."
7. Do not mention sources, file names, chunks, metadata, or citations.
8. Do not use [1], [2], [3].
9. Be concise, clear, professional, and natural.
10. Answer only what was asked.
`;
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.txt', '.rtf', '.odt',
  '.xlsx', '.xls', '.ods', '.csv', '.tsv',
  '.pptx', '.ppt',
  '.html', '.htm', '.xml', '.md', '.markdown', '.rst',
  '.json', '.jsonl', '.yaml', '.yml', '.toml',
  '.py', '.js', '.ts', '.jsx', '.tsx',
  '.java', '.cpp', '.c', '.h', '.cs',
  '.go', '.rb', '.php', '.swift', '.kt',
  '.r', '.sql', '.sh', '.bash', '.ps1',
  '.epub', '.eml',
])
let db     = null
let chatDb = null
async function getDb() {
  if (db) return db
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(MONGODB_DB)
  await db.collection('clients').createIndex({ apiKey: 1 }, { unique: true, sparse: true })
  return db
}

async function getChatDb() {
  if (chatDb) return chatDb
  const uri    = CHAT_HISTORY_URI || MONGODB_URI
  const client = new MongoClient(uri)
  await client.connect()
  chatDb = client.db(CHAT_HISTORY_DB)
  return chatDb
}

// ── In-memory client cache (avoids repeated DB hits on every chat message) ────
//    Key: apiKey string → Value: { clientId, name, cachedAt }
//    TTL: 5 minutes — stale enough to be cheap, fresh enough to respect revocations
const CLIENT_CACHE     = new Map()
const CACHE_TTL_MS     = 5 * 60 * 1000   // 5 min

function getCached(apiKey) {
  const entry = CLIENT_CACHE.get(apiKey)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    CLIENT_CACHE.delete(apiKey)
    return null
  }
  return entry
}

function setCache(apiKey, clientData) {
  CLIENT_CACHE.set(apiKey, { ...clientData, cachedAt: Date.now() })
}

// Evict from cache when a key is regenerated or client is deleted
function evictCache(apiKey) {
  if (apiKey) CLIENT_CACHE.delete(apiKey)
}

// ── Core auth helper ──────────────────────────────────────────────────────────
//    Validates a client API key against MongoDB.
//    Returns { clientId, name } on success, null on failure.
async function verifyApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith('rak_')) return null

  // Check cache first
  const cached = getCached(apiKey)
  if (cached) return { clientId: cached.clientId, name: cached.name }

  const database = await getDb()
  const client   = await database.collection('clients').findOne(
    { apiKey },
    { projection: { clientId: 1, name: 1, _id: 0 } }
  )
  if (!client) return null

  setCache(apiKey, { clientId: client.clientId, name: client.name })
  return { clientId: client.clientId, name: client.name }
}

// ── Middleware: extract API key from Authorization header ─────────────────────
//    Expects: "Authorization: Bearer rak_..."
function extractApiKey(req) {
  const header = req.headers['authorization'] || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

// Client-facing routes: validate the rak_ API key
async function requireClientKey(req, res, next) {
  const apiKey = extractApiKey(req)
  if (!apiKey) return res.status(401).json({ error: 'Missing API key' })
  const client = await verifyApiKey(apiKey)
  if (!client) return res.status(401).json({ error: 'Invalid or expired API key' })
  req.client = client   // { clientId, name }
  next()
}

// Admin routes: validate the static ADMIN_API_KEY env var
function requireAdminKey(req, res, next) {
  const key = extractApiKey(req)
  if (!key || key !== process.env.ADMIN_API_KEY)
    return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, service: 'rag-client-auth' }))

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN CRUD — unchanged logic, updated to store apiKey instead of credentials
// ════════════════════════════════════════════════════════════════════════════

// POST /admin/clients — create client with name, clientId, apiKey
app.post('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const { name, clientId, apiKey } = req.body
    if (!name || !clientId || !apiKey)
      return res.status(400).json({ error: 'name, clientId, and apiKey are all required' })
    if (!apiKey.startsWith('rak_'))
      return res.status(400).json({ error: 'apiKey must start with "rak_"' })

    const database = await getDb()
    const col      = database.collection('clients')

    const existing = await col.findOne({ $or: [{ clientId }, { apiKey }] })
    if (existing) {
      const field = existing.clientId === clientId ? 'clientId' : 'apiKey'
      return res.status(409).json({ error: `A client with this ${field} already exists` })
    }

    const now = new Date().toISOString()
    const doc = {
      name:          name.trim(),
      clientId:      clientId.trim().toLowerCase(),
      apiKey,                           // stored in plain text (it IS the credential)
      apiKeyRotatedAt: now,
      folderLink:    '',
      sourceType:    'google-drive',
      status:        'idle',
      documentsCount: 0,
      autoSync:      false,
      watchIntervalMs: 300000,
      lastRunAt:     null,
      lastError:     null,
      createdAt:     now,
      updatedAt:     now,
    }
    const result = await col.insertOne(doc)
    // Never return apiKey in the GET/list responses — only on creation
    res.status(201).json({ ...doc, _id: result.insertedId })
  } catch (err) {
    console.error('POST /admin/clients:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /admin/clients — list all (apiKey masked)
app.get('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const clients  = await database.collection('clients')
      .find({}, { projection: { apiKey: 0 } })  // never expose keys in list
      .sort({ createdAt: -1 })
      .toArray()
    res.json({ clients })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /admin/clients/:clientId
app.get('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const client   = await database.collection('clients').findOne(
      { clientId: req.params.clientId },
      { projection: { apiKey: 0 } }
    )
    if (!client) return res.status(404).json({ error: 'Client not found' })
    res.json(client)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PATCH /admin/clients/:clientId — also handles API key rotation
app.patch('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const updates  = { ...req.body, updatedAt: new Date().toISOString() }

    // If a new apiKey is being set, validate its format and evict old cache entry
    if (updates.apiKey !== undefined) {
      if (!updates.apiKey.startsWith('rak_'))
        return res.status(400).json({ error: 'apiKey must start with "rak_"' })

      // Evict cached entry for the OLD key so it stops working immediately
      const old = await database.collection('clients').findOne(
        { clientId: req.params.clientId },
        { projection: { apiKey: 1 } }
      )
      if (old?.apiKey) evictCache(old.apiKey)

      updates.apiKeyRotatedAt = new Date().toISOString()
    }

    const result = await database.collection('clients').findOneAndUpdate(
      { clientId: req.params.clientId },
      { $set: updates },
      { returnDocument: 'after', projection: { apiKey: 0 } }
    )
    if (!result) return res.status(404).json({ error: 'Client not found' })
    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// DELETE /admin/clients/:clientId — also cleans up Azure blobs
app.delete('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const { clientId } = req.params
    const database     = await getDb()
    const client       = await database.collection('clients').findOne({ clientId })
    if (!client) return res.status(404).json({ error: 'Client not found' })

    // Evict from cache before deleting
    if (client.apiKey) evictCache(client.apiKey)

    await database.collection('clients').deleteOne({ clientId })

    const blobsDeleted = [], blobsFailed = []
    if (AZURE_CONNECTION_STRING) {
      try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING)
        const containerClient   = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME)
        for (const prefix of [`raw/${clientId}/`, `meta/${clientId}/`]) {
          for await (const blob of containerClient.listBlobsFlat({ prefix })) {
            try { await containerClient.deleteBlob(blob.name); blobsDeleted.push(blob.name) }
            catch (e) { blobsFailed.push({ name: blob.name, error: e.message }) }
          }
        }
      } catch (azureErr) {
        blobsFailed.push({ name: 'azure-connection', error: azureErr.message })
      }
    }

    res.json({
      ok: true, deleted: clientId,
      blobsDeleted: blobsDeleted.length,
      blobsFailed: blobsFailed.length > 0 ? blobsFailed : undefined,
    })
  } catch (err) {
    console.error('DELETE /admin/clients:', err)
    res.status(500).json({ error: err.message })
  }
})

// ════════════════════════════════════════════════════════════════════════════
//  CLIENT AUTH ENDPOINTS  (replaces JWT login + /client/me)
// ════════════════════════════════════════════════════════════════════════════

// POST /client/login — validate API key, return client info (no JWT issued)
app.post('/client/login', async (req, res) => {
  try {
    const apiKey = req.body.apiKey || extractApiKey(req)
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' })
    const client = await verifyApiKey(apiKey)
    if (!client) return res.status(401).json({ error: 'Invalid API key' })
    res.json({ ok: true, client })
  } catch (err) {
    console.error('POST /client/login:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /client/me — returns profile for the authenticated client key
app.get('/client/me', requireClientKey, async (req, res) => {
  try {
    const database = await getDb()
    const client   = await database.collection('clients').findOne(
      { clientId: req.client.clientId },
      { projection: { apiKey: 0 } }
    )
    if (!client) return res.status(404).json({ error: 'Client not found' })
    res.json(client)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ════════════════════════════════════════════════════════════════════════════
//  CHAT HISTORY ENDPOINTS  (apiKey replaces clientId+clientPassword everywhere)
// ════════════════════════════════════════════════════════════════════════════

// POST /chat/conversations — create new conversation
app.post('/chat/conversations', requireClientKey, async (req, res) => {
  try {
    const { title } = req.body
    const database  = await getChatDb()
    const now       = new Date()
    const conversation = {
      clientId: req.client.clientId,
      title:    title || 'New Conversation',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    const result = await database.collection('conversations').insertOne(conversation)
    res.status(201).json({ ...conversation, _id: result.insertedId })
  } catch (err) {
    console.error('POST /chat/conversations:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /chat/conversations/list
app.post('/chat/conversations/list', requireClientKey, async (req, res) => {
  try {
    const database      = await getChatDb()
    const conversations = await database.collection('conversations')
      .find({ clientId: req.client.clientId }, { projection: { messages: 0 } })
      .sort({ updatedAt: -1 })
      .toArray()
    res.json({ conversations })
  } catch (err) {
    console.error('POST /chat/conversations/list:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /chat/conversations/get
app.post('/chat/conversations/get', requireClientKey, async (req, res) => {
  try {
    const { conversationId } = req.body
    if (!conversationId)
      return res.status(400).json({ error: 'conversationId is required' })
    const database     = await getChatDb()
    const conversation = await database.collection('conversations').findOne({
      _id:      new ObjectId(conversationId),
      clientId: req.client.clientId,
    })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
    res.json(conversation)
  } catch (err) {
    console.error('POST /chat/conversations/get:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /chat/conversations/rename
app.post('/chat/conversations/rename', requireClientKey, async (req, res) => {
  try {
    const { conversationId, title } = req.body
    if (!conversationId || !title)
      return res.status(400).json({ error: 'conversationId and title are required' })
    const database = await getChatDb()
    const result   = await database.collection('conversations').findOneAndUpdate(
      { _id: new ObjectId(conversationId), clientId: req.client.clientId },
      { $set: { title: title.trim(), updatedAt: new Date() } },
      { returnDocument: 'after', projection: { messages: 0 } }
    )
    if (!result) return res.status(404).json({ error: 'Conversation not found' })
    res.json(result)
  } catch (err) {
    console.error('POST /chat/conversations/rename:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /chat/conversations/delete
app.post('/chat/conversations/delete', requireClientKey, async (req, res) => {
  try {
    const { conversationId } = req.body
    if (!conversationId)
      return res.status(400).json({ error: 'conversationId is required' })
    const database = await getChatDb()
    const result   = await database.collection('conversations').deleteOne({
      _id:      new ObjectId(conversationId),
      clientId: req.client.clientId,
    })
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Conversation not found' })
    res.json({ ok: true, deleted: conversationId })
  } catch (err) {
    console.error('POST /chat/conversations/delete:', err)
    res.status(500).json({ error: err.message })
  }
})
async function extractPdf(buffer) {
  const result = await pdfParse(buffer)
  return result.text || ''
}

async function extractWord(buffer) {
  const result = await mammoth.extractRawText({ buffer })
  return result.value || ''
}

function extractSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts    = []

  for (const sheetName of workbook.SheetNames) {
    const sheet   = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 })
    if (!rawRows.length) continue

    parts.push(`=== Sheet: ${sheetName} ===`)

    let headerRowIdx = 0
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
      if (rawRows[i].some(cell => String(cell).trim() !== '')) { headerRowIdx = i; break }
    }

    const headers = rawRows[headerRowIdx].map(h => String(h).trim())

    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i]
      if (!row.some(cell => String(cell).trim() !== '')) continue
      const pairs  = []
      const values = []
      for (let j = 0; j < Math.max(headers.length, row.length); j++) {
        const val = String(row[j] || '').trim()
        if (!val) continue
        const key = headers[j] && headers[j] !== '' ? headers[j] : `Field${j + 1}`
        pairs.push(`${key}: ${val}`)
        values.push(val)
      }
      if (pairs.length > 0) {
        parts.push(pairs.join(' | '))
        if (values.length >= 2) {
          const rest = pairs.slice(1).join(', ')
          parts.push(`${values[0]} is described as: ${rest}`)
        }
      }
    }

    parts.push('')
    parts.push('[All values in this sheet:]')
    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
      const row      = rawRows[i]
      const rowValues = row
        .map((cell, j) => {
          const val = String(cell || '').trim()
          if (!val) return ''
          const key = headers[j] && headers[j] !== '' ? headers[j] : `Field${j + 1}`
          return `${val} (${key})`
        })
        .filter(Boolean)
      if (rowValues.length) parts.push(rowValues.join(', '))
    }
  }

  return parts.join('\n')
}

function extractCsv(buffer, delimiter = ',') {
  const text   = buffer.toString('utf-8')
  const result = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter })
  if (!result.data?.length) return text
  return result.data
    .map((row, i) => `Row ${i + 1}: ` + Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' | '))
    .join('\n')
}

async function extractOffice(buffer) {
  return new Promise((resolve, reject) => {
    parseOffice(buffer, (text, err) => {
      if (err) reject(err)
      else resolve(text || '')
    }, { outputErrorToConsole: false })
  })
}

function extractHtml(buffer) {
  const root = htmlParse(buffer.toString('utf-8'))
  root.querySelectorAll('script, style').forEach(n => n.remove())
  return root.structuredText || root.innerText || root.rawText || ''
}

function extractXml(buffer) {
  return buffer.toString('utf-8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractJson(buffer) {
  try { return JSON.stringify(JSON.parse(buffer.toString('utf-8')), null, 2) }
  catch { return buffer.toString('utf-8') }
}

function extractJsonl(buffer) {
  return buffer.toString('utf-8').split('\n').filter(Boolean)
    .map(line => { try { return JSON.stringify(JSON.parse(line)) } catch { return line } })
    .join('\n')
}

function extractYaml(buffer) {
  try { return JSON.stringify(yaml.load(buffer.toString('utf-8')), null, 2) }
  catch { return buffer.toString('utf-8') }
}

async function extractEml(buffer) {
  const parsed = await simpleParser(buffer)
  const parts  = []
  if (parsed.subject) parts.push(`Subject: ${parsed.subject}`)
  if (parsed.from)    parts.push(`From: ${parsed.from.text}`)
  if (parsed.to)      parts.push(`To: ${parsed.to.text}`)
  if (parsed.date)    parts.push(`Date: ${parsed.date}`)
  if (parsed.text)    parts.push(`\n${parsed.text}`)
  else if (parsed.html) parts.push(`\n${extractHtml(Buffer.from(parsed.html))}`)
  return parts.join('\n')
}

async function extractEpub(buffer) {
  return new Promise((resolve) => {
    parseOffice(buffer, (text, err) => {
      resolve(err || !text ? '[EPUB: convert to PDF for best results]' : text)
    }, { outputErrorToConsole: false })
  })
}

async function extractTextFromBuffer(buffer, fileName) {
  const ext = ('.' + fileName.split('.').pop()).toLowerCase()
  if (ext === '.pdf')                             return extractPdf(buffer)
  if (ext === '.docx' || ext === '.doc')          return extractWord(buffer)
  if (ext === '.odt'  || ext === '.rtf')          return extractOffice(buffer)
  if (['.xlsx', '.xls', '.ods'].includes(ext))    return extractSpreadsheet(buffer)
  if (ext === '.csv')                             return extractCsv(buffer, ',')
  if (ext === '.tsv')                             return extractCsv(buffer, '\t')
  if (ext === '.pptx' || ext === '.ppt')          return extractOffice(buffer)
  if (ext === '.html' || ext === '.htm')          return extractHtml(buffer)
  if (ext === '.xml')                             return extractXml(buffer)
  if (['.md', '.markdown', '.rst'].includes(ext)) return buffer.toString('utf-8')
  if (ext === '.json')                            return extractJson(buffer)
  if (ext === '.jsonl')                           return extractJsonl(buffer)
  if (ext === '.yaml' || ext === '.yml')          return extractYaml(buffer)
  if (ext === '.toml')                            return buffer.toString('utf-8')
  const plainText = new Set([
    '.txt', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c',
    '.h', '.cs', '.go', '.rb', '.php', '.swift', '.kt', '.r', '.sql',
    '.sh', '.bash', '.ps1',
  ])
  if (plainText.has(ext))                         return buffer.toString('utf-8')
  if (ext === '.epub')                            return extractEpub(buffer)
  if (ext === '.eml')                             return extractEml(buffer)
  console.warn(`[extractText] Unsupported extension: ${ext} (${fileName})`)
  return ''
}

// ════════════════════════════════════════════════════════════════════════════
//  CHUNKING
// ════════════════════════════════════════════════════════════════════════════

function chunkText(text, sourceFile) {
  const chunks = []
  let index    = 0
  const lines  = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
  let buffer = []
  for (const line of lines) {
    const projectedLength = buffer.join('\n').length + (buffer.length ? 1 : 0) + line.length
    if (buffer.length > 0 && projectedLength > CHUNK_SIZE) {
      const str = buffer.join('\n')
      if (str.length > 30)
        chunks.push({ text: str, source_file: sourceFile, chunk_index: index++, embedding: [] })
      buffer = buffer.slice(-CHUNK_OVERLAP)
    }
    buffer.push(line)
  }
  if (buffer.length > 0) {
    const str = buffer.join('\n')
    if (str.length > 30)
      chunks.push({ text: str, source_file: sourceFile, chunk_index: index++, embedding: [] })
  }
  return chunks
}

// ════════════════════════════════════════════════════════════════════════════
//  AZURE BLOB
// ════════════════════════════════════════════════════════════════════════════

async function downloadBlobAsBuffer(containerClient, blobName) {
  const download = await containerClient.getBlobClient(blobName).download()
  const parts    = []
  for await (const chunk of download.readableStreamBody)
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(parts)
}

async function loadChunksForClient(clientId) {
  if (!AZURE_CONNECTION_STRING) throw new Error('AZURE_CONNECTION_STRING not set')
  const containerClient = BlobServiceClient
    .fromConnectionString(AZURE_CONNECTION_STRING)
    .getContainerClient(AZURE_CONTAINER_NAME)
  const prefix    = `${RAW_PREFIX}/${clientId}/`
  console.log(`[loadChunks] Scanning: "${prefix}"`)
  const allChunks = []
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    const fileName = blob.name.split('/').pop()
    const ext      = ('.' + fileName.split('.').pop()).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) { console.log(`[loadChunks] Skipping: ${fileName}`); continue }
    console.log(`[loadChunks] Processing: ${fileName}`)
    try {
      const buffer = await downloadBlobAsBuffer(containerClient, blob.name)
      const text   = await extractTextFromBuffer(buffer, fileName)
      if (!text?.trim()) { console.warn(`[loadChunks] Empty: ${fileName}`); continue }
      const chunks = chunkText(text, fileName)
      console.log(`[loadChunks]   ${fileName} → ${chunks.length} chunks`)
      allChunks.push(...chunks)
    } catch (err) {
      console.warn(`[loadChunks] Failed ${fileName}:`, err.message)
    }
  }
  console.log(`[loadChunks] Total: ${allChunks.length} chunks for "${clientId}"`)
  return allChunks
}

// ════════════════════════════════════════════════════════════════════════════
//  RETRIEVAL
// ════════════════════════════════════════════════════════════════════════════

function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9)
}

function keywordSearch(query, chunks, topK) {
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
  return chunks
    .map(c => {
      const lower       = (c.text || '').toLowerCase()
      const score       = words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0)
      const phraseBonus = lower.includes(query.toLowerCase()) ? words.length : 0
      return { ...c, _score: score + phraseBonus }
    })
    .filter(c => c._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topK)
}

async function embedQueryGemini(query) {
  const ai  = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const res = await ai.models.embedContent({ model: 'text-embedding-004', contents: query })
  return res.embeddings[0].values
}

async function retrieveChunks(query, chunks, topK = 6) {
  const normalizedQuery = query.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')
  const candidates      = keywordSearch(normalizedQuery, chunks, Math.min(100, chunks.length))
  const pool            = candidates.length > 0 ? candidates : chunks.slice(0, 100)

  if (GEMINI_API_KEY) {
    try {
      const queryVec = await embedQueryGemini(normalizedQuery)
      const ai       = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const scored   = []
      for (const c of pool) {
        try {
          const r = await ai.models.embedContent({
            model:    'text-embedding-004',
            contents: (c.text || '').toLowerCase(),
          })
          scored.push({ ...c, _score: cosineSim(queryVec, r.embeddings[0].values) })
        } catch {
          scored.push({ ...c, _score: c._score || 0 })
        }
      }
      return scored.sort((a, b) => b._score - a._score).slice(0, Math.min(topK, 20))
    } catch (err) {
      console.warn('[retrieveChunks] Gemini embed failed, using keyword fallback:', err.message)
    }
  }
  return pool.slice(0, Math.min(topK, 20))
}

function buildContext(hits) {
  return hits.map((h, i) => {
    const src            = h.source_file || 'document'
    const isSpreadsheet  = /\.(xlsx|xls|ods|csv|tsv)$/i.test(src)
    const hint           = isSpreadsheet
      ? '(spreadsheet data — each line is a record row; terms appearing as values are real data items)'
      : '(document excerpt)'
    return `[Excerpt ${i + 1} from ${src} ${hint}]\n${(h.text || '').trim()}`
  }).join('\n\n')
}

async function answerWithGemini(originalQuery, normalizedQuery, context) {
  const ai     = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const prompt = `${SYSTEM_PROMPT}

---DOCUMENT CONTEXT START---
${context}
---DOCUMENT CONTEXT END---

The user is asking: "${originalQuery}"

Before answering, scan the entire context above for any occurrence of the key terms in the question (case-insensitive). If you find it anywhere — as a row value, column value, label, or text — explain what the context says about it in plain English. Do not say it is missing if it appears anywhere in the data above.`

  const res = await ai.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: prompt,
    config:   { temperature: 0.4, maxOutputTokens: 1024 },
  })
  return res.text
}

function generateTitle(query) {
  const cleaned = query.trim().replace(/[?!.]+$/, '')
  return cleaned.length > 50 ? cleaned.slice(0, 50) + '…' : cleaned
}

// ════════════════════════════════════════════════════════════════════════════
//  CHAT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /chat/login — verify API key, return client info (no token issued)
app.post('/chat/login', async (req, res) => {
  try {
    const apiKey = req.body.apiKey || extractApiKey(req)
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' })
    const client = await verifyApiKey(apiKey)
    if (!client) return res.status(401).json({ error: 'Invalid API key' })
    res.json({ ok: true, client })
  } catch (err) {
    console.error('POST /chat/login:', err)
    res.status(500).json({ error: err.message })
  }
})

// POST /chat/message — main RAG endpoint
app.post('/chat/message', requireClientKey, async (req, res) => {
  try {
    const { query, topK = 6, conversationId } = req.body
    if (!query?.trim()) return res.status(400).json({ error: 'query is required' })

    const { clientId, name } = req.client
    const normalizedQuery    = query.trim().toLowerCase()

    const chunks = await loadChunksForClient(clientId)
    if (chunks.length === 0) {
      return res.json({
        answer: 'No documents found for your account. Please ensure your documents have been ingested first.',
        sources: [],
        client: { clientId, name },
      })
    }

    const hits = await retrieveChunks(normalizedQuery, chunks, Math.min(topK, 20))
    if (hits.length === 0) {
      return res.json({
        answer: "I couldn't find that in your documents. Try rephrasing your question or asking about it differently.",
        sources: [],
        client: { clientId, name },
      })
    }

    const answer  = await answerWithGemini(query.trim(), normalizedQuery, buildContext(hits))
    const sources = hits.map(h => ({
      source_file: h.source_file || 'unknown',
      chunk_index: h.chunk_index ?? 0,
      score:       typeof h._score === 'number' ? parseFloat(h._score.toFixed(4)) : null,
      preview:     (h.text || '').slice(0, 300),
    }))

    // Save to chat history (non-blocking on failure)
    try {
      const chatDatabase = await getChatDb()
      const col          = chatDatabase.collection('conversations')
      const now          = new Date()
      const userMsg      = { role: 'user',      content: query.trim(), timestamp: now }
      const assistantMsg = {
        role:    'assistant',
        content: answer,
        sources: sources.map(s => ({ source_file: s.source_file, score: s.score })),
        timestamp: now,
      }

      if (conversationId) {
        await col.updateOne(
          { _id: new ObjectId(conversationId), clientId },
          { $push: { messages: { $each: [userMsg, assistantMsg] } }, $set: { updatedAt: now } }
        )
        res.json({ answer, sources, client: { clientId, name }, conversationId })
      } else {
        const result = await col.insertOne({
          clientId,
          title:     generateTitle(query.trim()),
          messages:  [userMsg, assistantMsg],
          createdAt: now,
          updatedAt: now,
        })
        res.json({ answer, sources, client: { clientId, name }, conversationId: result.insertedId.toString() })
      }
    } catch (histErr) {
      console.warn('[chat/message] History save failed (non-fatal):', histErr.message)
      res.json({ answer, sources, client: { clientId, name }, conversationId: conversationId || null })
    }

  } catch (err) {
    console.error('POST /chat/message:', err)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`rag-client-auth running on port ${PORT}`))
module.exports = app
