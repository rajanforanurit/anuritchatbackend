require('dotenv').config()
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt= require('bcryptjs')
const { MongoClient } = require('mongodb')
const { BlobServiceClient } = require('@azure/storage-blob')
const { GoogleGenAI } = require('@google/genai')
const pdfParse = require('pdf-parse')
const mammoth = require('mammoth')
const XLSX = require('xlsx')
const { parse: htmlParse } = require('node-html-parser')
const yaml = require('js-yaml')
const Papa = require('papaparse')
const { simpleParser } = require('mailparser')
const { parseOffice }  = require('officeparser')

const app = express()
app.use(cors())
app.use(express.json())

// ── Config ───────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB  = process.env.MONGODB_DB || 'clientcreds'
const JWT_SECRET = process.env.JWT_SECRET || 'rag-client-jwt-secret'
const AZURE_CONNECTION_STRING = process.env.AZURE_CONNECTION_STRING || ''
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'vectordbforrag'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

const RAW_PREFIX    = 'raw'
const CHUNK_SIZE    = 500   // characters per chunk
const CHUNK_OVERLAP = 80    // overlap between chunks

const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question using ONLY " +
  'the provided context excerpts from their documents. ' +
  'If the answer is not in the context, say so clearly. ' +
  'Cite the source file in square brackets, e.g. [filename]. ' +
  'Be concise and accurate.'

// ── Supported extensions (mirrors Python pipeline) ───────────────────────────
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

// ── MongoDB ──────────────────────────────────────────────────────────────────
let db = null
async function getDb() {
  if (db) return db
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(MONGODB_DB)
  return db
}

// ── Auth middleware ───────────────────────────────────────────────────────────
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

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, service: 'rag-client-auth' }))

// ── Admin CRUD ────────────────────────────────────────────────────────────────
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
      name: name.trim(), clientId: clientId.trim().toLowerCase(),
      clientUsername: clientUsername.trim(), clientPassword: hashedPassword,
      folderLink: '', sourceType: 'google-drive', status: 'idle',
      documentsCount: 0, autoSync: false, watchIntervalMs: 300000,
      lastRunAt: null, lastError: null, createdAt: now, updatedAt: now,
    }
    const result = await col.insertOne(doc)
    res.status(201).json({ ...doc, _id: result.insertedId, clientPassword: undefined })
  } catch (err) { console.error('POST /admin/clients:', err); res.status(500).json({ error: err.message }) }
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
    res.json({ ok: true, deleted: clientId, blobsDeleted: blobsDeleted.length,
      blobsFailed: blobsFailed.length > 0 ? blobsFailed : undefined })
  } catch (err) { console.error('DELETE /admin/clients:', err); res.status(500).json({ error: err.message }) }
})

// ── Client auth endpoints ─────────────────────────────────────────────────────
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
  const client   = await database.collection('clients').findOne({ clientId: clientId.trim().toLowerCase() })
  if (!client) return null
  const valid = await bcrypt.compare(clientPassword, client.clientPassword)
  if (!valid) return null
  return { clientId: client.clientId, name: client.name, clientUsername: client.clientUsername }
}

// ════════════════════════════════════════════════════════════════════════════
//  TEXT EXTRACTION  — one handler per format group
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
  return workbook.SheetNames
    .map(name => `=== Sheet: ${name} ===\n` + XLSX.utils.sheet_to_csv(workbook.Sheets[name], { FS: '\t' }))
    .join('\n\n')
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

/** Master dispatcher — routes buffer to correct extractor by file extension */
async function extractTextFromBuffer(buffer, fileName) {
  const ext = ('.' + fileName.split('.').pop()).toLowerCase()

  // Documents
  if (ext === '.pdf')                          return extractPdf(buffer)
  if (ext === '.docx' || ext === '.doc')       return extractWord(buffer)
  if (ext === '.odt'  || ext === '.rtf')       return extractOffice(buffer)

  // Spreadsheets
  if (['.xlsx', '.xls', '.ods'].includes(ext)) return extractSpreadsheet(buffer)
  if (ext === '.csv')                          return extractCsv(buffer, ',')
  if (ext === '.tsv')                          return extractCsv(buffer, '\t')

  // Presentations
  if (ext === '.pptx' || ext === '.ppt')       return extractOffice(buffer)

  // Web / Markup
  if (ext === '.html' || ext === '.htm')       return extractHtml(buffer)
  if (ext === '.xml')                          return extractXml(buffer)
  if (['.md', '.markdown', '.rst'].includes(ext)) return buffer.toString('utf-8')

  // Data formats
  if (ext === '.json')                         return extractJson(buffer)
  if (ext === '.jsonl')                        return extractJsonl(buffer)
  if (ext === '.yaml' || ext === '.yml')       return extractYaml(buffer)
  if (ext === '.toml')                         return buffer.toString('utf-8') // human-readable as-is

  // All code files + .txt — plain UTF-8
  const plainText = new Set([
    '.txt', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c',
    '.h', '.cs', '.go', '.rb', '.php', '.swift', '.kt', '.r', '.sql',
    '.sh', '.bash', '.ps1',
  ])
  if (plainText.has(ext))                      return buffer.toString('utf-8')

  // eBook / Email
  if (ext === '.epub')                         return extractEpub(buffer)
  if (ext === '.eml')                          return extractEml(buffer)

  console.warn(`[extractText] Unsupported extension: ${ext} (${fileName})`)
  return ''
}

// ════════════════════════════════════════════════════════════════════════════
//  CHUNKING
// ════════════════════════════════════════════════════════════════════════════
function chunkText(text, sourceFile) {
  const chunks = []
  let i = 0, index = 0
  text = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  while (i < text.length) {
    const fragment = text.slice(i, Math.min(i + CHUNK_SIZE, text.length)).trim()
    if (fragment.length > 30)
      chunks.push({ text: fragment, source_file: sourceFile, chunk_index: index++, embedding: [] })
    i += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return chunks
}

// ════════════════════════════════════════════════════════════════════════════
//  AZURE BLOB — load all supported files from raw/{clientId}/
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
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9)
}

function keywordSearch(query, chunks, topK) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return chunks
    .map(c => ({ ...c, _score: words.reduce((a, w) => a + ((c.text || '').toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter(c => c._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topK)
}

async function embedQueryGemini(query) {
  const ai  = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const res = await ai.models.embedContent({ model: 'text-embedding-004', contents: query })
  return res.embeddings[0].values
}

async function retrieveChunks(query, chunks, topK = 5) {
  // Keyword pre-filter → top 50 candidates
  const candidates = keywordSearch(query, chunks, Math.min(50, chunks.length))
  const pool       = candidates.length > 0 ? candidates : chunks.slice(0, 50)

  // Semantic re-ranking with Gemini
  if (GEMINI_API_KEY) {
    try {
      const queryVec = await embedQueryGemini(query)
      const ai       = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const scored   = []
      for (const c of pool) {
        try {
          const r = await ai.models.embedContent({ model: 'text-embedding-004', contents: c.text })
          scored.push({ ...c, _score: cosineSim(queryVec, r.embeddings[0].values) })
        } catch { scored.push({ ...c, _score: c._score || 0 }) }
      }
      return scored.sort((a, b) => b._score - a._score).slice(0, topK)
    } catch (err) {
      console.warn('[retrieveChunks] Gemini embed failed, keyword fallback:', err.message)
    }
  }
  return pool.slice(0, topK)
}

function buildContext(hits) {
  return hits
    .map((h, i) => `[${i + 1}] Source: ${h.source_file || 'unknown'}  |  Score: ${typeof h._score === 'number' ? h._score.toFixed(4) : '—'}\n${(h.text || '').trim()}`)
    .join('\n\n---\n\n')
}

async function answerWithGemini(query, context) {
  const ai  = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `${SYSTEM_PROMPT}\n\nContext:\n${context}\n\nQuestion: ${query}`,
    config: { temperature: 0.2, maxOutputTokens: 1024 },
  })
  return res.text
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
  } catch (err) { console.error('POST /chat/login:', err); res.status(500).json({ error: err.message }) }
})

app.post('/chat/message', async (req, res) => {
  try {
    const { clientId, clientPassword, query, topK = 5 } = req.body
    if (!clientId || !clientPassword)
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    if (!query?.trim())
      return res.status(400).json({ error: 'query is required' })

    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })

    const chunks = await loadChunksForClient(clientId)
    if (chunks.length === 0)
      return res.json({ answer: 'No documents found for your account. Please ensure your documents have been ingested first.', sources: [], client })

    const hits = await retrieveChunks(query.trim(), chunks, Math.min(topK, 15))
    if (hits.length === 0)
      return res.json({ answer: 'No relevant content found in your documents for that question.', sources: [], client })

    const answer  = await answerWithGemini(query.trim(), buildContext(hits))
    const sources = hits.map(h => ({
      source_file: h.source_file || 'unknown',
      chunk_index: h.chunk_index ?? 0,
      score:   typeof h._score === 'number' ? parseFloat(h._score.toFixed(4)) : null,
      preview: (h.text || '').slice(0, 300),
    }))
    res.json({ answer, sources, client })
  } catch (err) { console.error('POST /chat/message:', err); res.status(500).json({ error: err.message }) }
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`rag-client-auth running on port ${PORT}`))
module.exports = app
