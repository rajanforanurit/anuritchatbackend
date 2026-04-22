require('dotenv').config()
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
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
const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB  = process.env.MONGODB_DB || 'clientcreds'
const CHAT_HISTORY_URI = process.env.CHAT_HISTORY_URI
const CHAT_HISTORY_DB = process.env.CHAT_HISTORY_DB || 'chathistory'
const JWT_SECRET = process.env.JWT_SECRET || 'rag-client-jwt-secret'
const AZURE_CONNECTION_STRING = process.env.AZURE_CONNECTION_STRING || ''
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'vectordbforrag'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const RAW_PREFIX = 'raw'
const CHUNK_SIZE = 500
const CHUNK_OVERLAP = 2
const SYSTEM_PROMPT = `You are a knowledgeable assistant helping users understand their business documents.
Answer the user's question in a clear, direct, and conversational tone — like a helpful human colleague explaining something to a coworker.

Rules you must follow without exception:
- Use ONLY the provided document context to answer.
- The context may contain spreadsheet data where column names look like "__EMPTY_2" or "Column3" — this is normal. Read ALL cell values carefully regardless of what the column is named. A term like "GL Activity" may appear as a cell value, not a heading.
- Do NOT add citation numbers like [1], [2], [3], [4] anywhere in your response. Never reference source numbers.
- Do NOT mention file names or source names in your answer text.
- Do NOT say phrases like "the context does not define", "not mentioned in the context", "the provided context does not contain" — if related data exists anywhere in the context, find it and explain it.
- If a term appears as a value in any row, column, or cell in the context, treat it as available information and explain it naturally.
- If and ONLY if absolutely no related information exists anywhere in the context after careful reading, say exactly: "I couldn't find that in your documents. Try rephrasing your question or asking about it differently."
- Write in plain, readable English. No robotic phrasing. No bullet points unless listing multiple distinct items. No markdown headers.
- Keep answers concise but complete — answer what was asked, nothing more.`

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
let db = null
async function getDb() {
  if (db) return db
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(MONGODB_DB)
  return db
}
let chatDb = null
async function getChatDb() {
  if (chatDb) return chatDb
  const uri    = CHAT_HISTORY_URI || MONGODB_URI
  const client = new MongoClient(uri)
  await client.connect()
  chatDb = client.db(CHAT_HISTORY_DB)
  return chatDb
}

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })
  try { req.client = jwt.verify(token, JWT_SECRET); next() }
  catch { res.status(401).json({ error: 'Invalid or expired token' }) }
}

function requireAdminKey(req, res, next) {
  const header = req.headers['authorization'] || ''
  const key    = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!key || key !== process.env.ADMIN_API_KEY)
    return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, service: 'rag-client-auth' }))

// ── Admin CRUD ─────────────────────────────────────────────────────────────────
app.post('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const { name, clientId, clientUsername, clientPassword } = req.body
    if (!name || !clientId || !clientUsername || !clientPassword)
      return res.status(400).json({ error: 'name, clientId, clientUsername, clientPassword are all required' })
    const database = await getDb()
    const col      = database.collection('clients')
    const existing = await col.findOne({ clientId })
    if (existing) return res.status(409).json({ error: `Client "${clientId}" already exists` })
    const hashedPassword = await bcrypt.hash(clientPassword, 10)
    const now = new Date().toISOString()
    const doc = {
      name: name.trim(),
      clientId: clientId.trim().toLowerCase(),
      clientUsername: clientUsername.trim(),
      clientPassword: hashedPassword,
      folderLink: '', sourceType: 'google-drive', status: 'idle',
      documentsCount: 0, autoSync: false, watchIntervalMs: 300000,
      lastRunAt: null, lastError: null, createdAt: now, updatedAt: now,
    }
    const result = await col.insertOne(doc)
    res.status(201).json({ ...doc, _id: result.insertedId, clientPassword: undefined })
  } catch (err) {
    console.error('POST /admin/clients:', err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const clients  = await database.collection('clients')
      .find({}, { projection: { clientPassword: 0 } })
      .sort({ createdAt: -1 }).toArray()
    res.json({ clients })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const client   = await database.collection('clients').findOne(
      { clientId: req.params.clientId }, { projection: { clientPassword: 0 } })
    if (!client) return res.status(404).json({ error: 'Client not found' })
    res.json(client)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const updates  = { ...req.body, updatedAt: new Date().toISOString() }
    delete updates.clientPassword
    const result = await database.collection('clients').findOneAndUpdate(
      { clientId: req.params.clientId },
      { $set: updates },
      { returnDocument: 'after', projection: { clientPassword: 0 } }
    )
    if (!result) return res.status(404).json({ error: 'Client not found' })
    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const { clientId } = req.params
    const database     = await getDb()
    const client       = await database.collection('clients').findOne({ clientId })
    if (!client) return res.status(404).json({ error: 'Client not found' })
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

// ── Client auth endpoints ──────────────────────────────────────────────────────
app.post('/client/login', async (req, res) => {
  try {
    const { clientUsername, clientPassword } = req.body
    if (!clientUsername || !clientPassword)
      return res.status(400).json({ error: 'clientUsername and clientPassword are required' })
    const database = await getDb()
    const client   = await database.collection('clients').findOne({ clientUsername })
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    const valid = await bcrypt.compare(clientPassword, client.clientPassword)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
    const token = jwt.sign(
      { clientId: client.clientId, clientUsername: client.clientUsername, name: client.name },
      JWT_SECRET, { expiresIn: '24h' }
    )
    res.json({ token, client: { clientId: client.clientId, name: client.name, clientUsername: client.clientUsername } })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/client/me', requireAuth, async (req, res) => {
  try {
    const database = await getDb()
    const client   = await database.collection('clients').findOne(
      { clientId: req.client.clientId }, { projection: { clientPassword: 0 } })
    if (!client) return res.status(404).json({ error: 'Client not found' })
    res.json(client)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

async function verifyClientCreds(clientId, clientPassword) {
  if (!clientId || !clientPassword) return null
  const database = await getDb()
  const client   = await database.collection('clients').findOne({
    clientId: clientId.trim().toLowerCase(),
  })
  if (!client) return null
  const valid = await bcrypt.compare(clientPassword, client.clientPassword)
  if (!valid) return null
  return { clientId: client.clientId, name: client.name, clientUsername: client.clientUsername }
}

app.post('/chat/conversations', async (req, res) => {
  try {
    const { clientId, clientPassword, title } = req.body
    if (!clientId || !clientPassword)
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    const database = await getChatDb()
    const now = new Date()
    const conversation = {
      clientId: client.clientId,
      title: title || 'New Conversation',
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

app.post('/chat/conversations/list', async (req, res) => {
  try {
    const { clientId, clientPassword } = req.body
    if (!clientId || !clientPassword)
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    const database = await getChatDb()
    const conversations = await database.collection('conversations')
      .find({ clientId: client.clientId }, { projection: { messages: 0 } })
      .sort({ updatedAt: -1 })
      .toArray()
    res.json({ conversations })
  } catch (err) {
    console.error('POST /chat/conversations/list:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/chat/conversations/get', async (req, res) => {
  try {
    const { clientId, clientPassword, conversationId } = req.body
    if (!clientId || !clientPassword || !conversationId)
      return res.status(400).json({ error: 'clientId, clientPassword, conversationId are required' })
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    const database = await getChatDb()
    const conversation = await database.collection('conversations').findOne({
      _id: new ObjectId(conversationId),
      clientId: client.clientId,
    })
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' })
    res.json(conversation)
  } catch (err) {
    console.error('POST /chat/conversations/get:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/chat/conversations/rename', async (req, res) => {
  try {
    const { clientId, clientPassword, conversationId, title } = req.body
    if (!clientId || !clientPassword || !conversationId || !title)
      return res.status(400).json({ error: 'clientId, clientPassword, conversationId, title are required' })
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    const database = await getChatDb()
    const result = await database.collection('conversations').findOneAndUpdate(
      { _id: new ObjectId(conversationId), clientId: client.clientId },
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

app.post('/chat/conversations/delete', async (req, res) => {
  try {
    const { clientId, clientPassword, conversationId } = req.body
    if (!clientId || !clientPassword || !conversationId)
      return res.status(400).json({ error: 'clientId, clientPassword, conversationId are required' })
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    const database = await getChatDb()
    const result = await database.collection('conversations').deleteOne({
      _id: new ObjectId(conversationId),
      clientId: client.clientId,
    })
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Conversation not found' })
    res.json({ ok: true, deleted: conversationId })
  } catch (err) {
    console.error('POST /chat/conversations/delete:', err)
    res.status(500).json({ error: err.message })
  }
})

// ════════════════════════════════════════════════════════════════════════════
//  TEXT EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

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
  const parts = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]

    // Raw array output — each row is an array of cell values
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 })
    if (!rawRows.length) continue

    parts.push(`=== Sheet: ${sheetName} ===`)

    // Find the first row that has at least one non-empty cell — treat as headers
    let headerRowIdx = 0
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
      if (rawRows[i].some(cell => String(cell).trim() !== '')) {
        headerRowIdx = i
        break
      }
    }

    const headers = rawRows[headerRowIdx].map(h => String(h).trim())

    // Emit each data row as "Header: Value | Header: Value" pairs
    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i]

      // Skip completely empty rows
      if (!row.some(cell => String(cell).trim() !== '')) continue

      const pairs = []
      for (let j = 0; j < Math.max(headers.length, row.length); j++) {
        const val = String(row[j] || '').trim()
        if (!val) continue
        // If the header is blank/generic, just emit the value with its position context
        const key = headers[j] && headers[j] !== '' ? headers[j] : `Field${j + 1}`
        pairs.push(`${key}: ${val}`)
      }

      if (pairs.length > 0) {
        parts.push(pairs.join(' | '))
      }
    }

    // Also emit a second pass: for each unique value in the sheet, emit
    // "value is listed under [header]" so the model can match by value search
    const valueIndex = []
    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i]
      for (let j = 0; j < row.length; j++) {
        const val = String(row[j] || '').trim()
        if (!val) continue
        const key = headers[j] && headers[j] !== '' ? headers[j] : `Field${j + 1}`
        // Emit in both directions: value → key and key → value
        valueIndex.push(`${val} is a ${key}`)
      }
    }
    if (valueIndex.length > 0) {
      parts.push('\n[Value Index for this sheet]')
      parts.push(...valueIndex)
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
  let index = 0
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
  let buffer = []
  for (const line of lines) {
    const projectedLength = buffer.join('\n').length + (buffer.length ? 1 : 0) + line.length
    if (buffer.length > 0 && projectedLength > CHUNK_SIZE) {
      const chunkTextStr = buffer.join('\n')
      if (chunkTextStr.length > 30) {
        chunks.push({ text: chunkTextStr, source_file: sourceFile, chunk_index: index++, embedding: [] })
      }
      buffer = buffer.slice(-CHUNK_OVERLAP)
    }
    buffer.push(line)
  }
  if (buffer.length > 0) {
    const chunkTextStr = buffer.join('\n')
    if (chunkTextStr.length > 30) {
      chunks.push({ text: chunkTextStr, source_file: sourceFile, chunk_index: index++, embedding: [] })
    }
  }
  return chunks
}

// ════════════════════════════════════════════════════════════════════════════
//  AZURE BLOB
// ════════════════════════════════════════════════════════════════════════════

async function downloadBlobAsBuffer(containerClient, blobName) {
  const download = await containerClient.getBlobClient(blobName).download()
  const parts = []
  for await (const chunk of download.readableStreamBody)
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(parts)
}

async function loadChunksForClient(clientId) {
  if (!AZURE_CONNECTION_STRING) throw new Error('AZURE_CONNECTION_STRING not set')
  const containerClient = BlobServiceClient
    .fromConnectionString(AZURE_CONNECTION_STRING)
    .getContainerClient(AZURE_CONTAINER_NAME)
  const prefix = `${RAW_PREFIX}/${clientId}/`
  console.log(`[loadChunks] Scanning: "${prefix}"`)
  const allChunks = []
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    const fileName = blob.name.split('/').pop()
    const ext      = ('.' + fileName.split('.').pop()).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.log(`[loadChunks] Skipping unsupported: ${fileName}`)
      continue
    }
    console.log(`[loadChunks] Processing: ${fileName}`)
    try {
      const buffer = await downloadBlobAsBuffer(containerClient, blob.name)
      const text   = await extractTextFromBuffer(buffer, fileName)
      if (!text?.trim()) { console.warn(`[loadChunks] Empty text: ${fileName}`); continue }
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

// ── FIXED: keywordSearch ──────────────────────────────────────────────────────
// Now normalizes BOTH query and chunk text to lowercase for matching,
// and scores partial word matches too (e.g. "gl" matches "GL Activity").
// Also raised candidate pool from 50 → 100 for better recall on sparse docs.
function keywordSearch(query, chunks, topK) {
  // Normalize query — split into individual words, all lowercase
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // replace punctuation with space
    .split(/\s+/)
    .filter(w => w.length > 1) // skip single chars

  return chunks
    .map(c => {
      const chunkLower = (c.text || '').toLowerCase()
      // Score: count how many query words appear in the chunk (case-insensitive)
      const score = words.reduce((acc, w) => acc + (chunkLower.includes(w) ? 1 : 0), 0)
      // Bonus: if the entire query phrase appears verbatim, boost the score
      const phraseBonus = chunkLower.includes(query.toLowerCase()) ? words.length : 0
      return { ...c, _score: score + phraseBonus }
    })
    .filter(c => c._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topK)
}

async function embedQueryGemini(query) {
  const ai  = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const res = await ai.models.embedContent({
    model: 'text-embedding-004',
    contents: query,
  })
  return res.embeddings[0].values
}

// ── FIXED: retrieveChunks ─────────────────────────────────────────────────────
// Key changes:
//  1. Normalizes query to lowercase BEFORE keyword search and embedding
//     so "GL Activity" / "gl activity" / "GL ACTIVITY" all match the same chunks
//  2. Raised candidate pool from 50 → 100 for better recall
//  3. Normalizes chunk text to lowercase before embedding for consistent similarity
//  4. topK ceiling raised from 15 → 20
async function retrieveChunks(query, chunks, topK = 6) {
  // Normalize query — this is the critical fix for case-insensitive matching
  const normalizedQuery = query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')

  // Keyword pass — wider candidate pool for sparse spreadsheet data
  const candidates = keywordSearch(normalizedQuery, chunks, Math.min(100, chunks.length))
  const pool       = candidates.length > 0 ? candidates : chunks.slice(0, 100)

  if (GEMINI_API_KEY) {
    try {
      // Embed normalized query
      const queryVec = await embedQueryGemini(normalizedQuery)
      const ai       = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const scored   = []

      for (const c of pool) {
        try {
          // Normalize chunk text before embedding for symmetric comparison
          const chunkTextNorm = (c.text || '').toLowerCase()
          const r = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: chunkTextNorm,
          })
          scored.push({ ...c, _score: cosineSim(queryVec, r.embeddings[0].values) })
        } catch {
          // Fallback to keyword score if embedding fails for this chunk
          scored.push({ ...c, _score: c._score || 0 })
        }
      }

      return scored
        .sort((a, b) => b._score - a._score)
        .slice(0, Math.min(topK, 20))

    } catch (err) {
      console.warn('[retrieveChunks] Gemini embed failed, keyword fallback:', err.message)
    }
  }

  return pool.slice(0, Math.min(topK, 20))
}

// ── FIXED: buildContext ───────────────────────────────────────────────────────
// Old version used [1], [2], [3] numbering which the model would echo back
// in its answer as citation references. Now uses plain document separators
// with no numbers, so the model has no numbers to cite.
function buildContext(hits) {
  return hits
    .map(h => `--- From: ${h.source_file || 'document'} ---\n${(h.text || '').trim()}`)
    .join('\n\n')
}

async function answerWithGemini(query, context) {
  const ai  = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `${SYSTEM_PROMPT}\n\nDocument Context:\n${context}\n\nUser Question: ${query}`,
    config: {
      temperature: 0.3,  // slightly raised from 0.2 for more natural language
      maxOutputTokens: 1024,
    },
  })
  return res.text
}

// ── Helper: auto-generate conversation title from first message ───────────────
function generateTitle(query) {
  const cleaned = query.trim().replace(/[?!.]+$/, '')
  return cleaned.length > 50 ? cleaned.slice(0, 50) + '…' : cleaned
}

// ════════════════════════════════════════════════════════════════════════════
//  CHAT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

app.post('/chat/login', async (req, res) => {
  try {
    const { clientId, clientPassword } = req.body
    if (!clientId || !clientPassword)
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    res.json({ ok: true, client })
  } catch (err) {
    console.error('POST /chat/login:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── FIXED: /chat/message ──────────────────────────────────────────────────────
// Key changes:
//  1. Normalizes incoming query to lowercase before retrieval
//     so "GL Activity", "gl activity", "GL ACTIVITY" all hit the same chunks
//  2. topK ceiling raised from 15 → 20
//  3. buildContext no longer uses numbered references
app.post('/chat/message', async (req, res) => {
  try {
    const { clientId, clientPassword, query, topK = 6, conversationId } = req.body

    if (!clientId || !clientPassword)
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    if (!query?.trim())
      return res.status(400).json({ error: 'query is required' })

    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })

    // Normalize query — case-insensitive matching fix
    const normalizedQuery = query.trim().toLowerCase()

    const chunks = await loadChunksForClient(clientId)
    if (chunks.length === 0) {
      return res.json({
        answer: 'No documents found for your account. Please ensure your documents have been ingested first.',
        sources: [],
        client,
      })
    }

    const hits = await retrieveChunks(normalizedQuery, chunks, Math.min(topK, 20))
    if (hits.length === 0) {
      return res.json({
        answer: "I couldn't find that in your documents. Try rephrasing your question or asking about it differently.",
        sources: [],
        client,
      })
    }

    // Answer using normalized query so model gets clean input
    const answer  = await answerWithGemini(normalizedQuery, buildContext(hits))
    const sources = hits.map(h => ({
      source_file: h.source_file || 'unknown',
      chunk_index: h.chunk_index ?? 0,
      score:       typeof h._score === 'number' ? parseFloat(h._score.toFixed(4)) : null,
      preview:     (h.text || '').slice(0, 300),
    }))

    // ── Save to chat history ─────────────────────────────────────────────────
    try {
      const chatDatabase = await getChatDb()
      const col = chatDatabase.collection('conversations')
      const now = new Date()

      // Store original (user-typed) query in history for readability
      const userMsg = { role: 'user', content: query.trim(), timestamp: now }
      const assistantMsg = {
        role: 'assistant',
        content: answer,
        sources: sources.map(s => ({ source_file: s.source_file, score: s.score })),
        timestamp: now,
      }

      if (conversationId) {
        await col.updateOne(
          { _id: new ObjectId(conversationId), clientId: client.clientId },
          {
            $push: { messages: { $each: [userMsg, assistantMsg] } },
            $set:  { updatedAt: now },
          }
        )
        res.json({ answer, sources, client, conversationId })
      } else {
        // New conversation — title from original query (readable casing)
        const title  = generateTitle(query.trim())
        const result = await col.insertOne({
          clientId: client.clientId,
          title,
          messages: [userMsg, assistantMsg],
          createdAt: now,
          updatedAt: now,
        })
        res.json({ answer, sources, client, conversationId: result.insertedId.toString() })
      }
    } catch (histErr) {
      console.warn('[chat/message] History save failed (non-fatal):', histErr.message)
      res.json({ answer, sources, client, conversationId: conversationId || null })
    }

  } catch (err) {
    console.error('POST /chat/message:', err)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`rag-client-auth running on port ${PORT}`))
module.exports = app
