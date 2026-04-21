require('dotenv').config()
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { MongoClient } = require('mongodb')
const { BlobServiceClient } = require('@azure/storage-blob')
const { GoogleGenAI } = require('@google/genai')
const app = express()
app.use(cors())
app.use(express.json())
const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB = process.env.MONGODB_DB ||'clientcreds'
const JWT_SECRET = process.env.JWT_SECRET || 'rag-client-jwt-secret'
const AZURE_CONNECTION_STRING = process.env.AZURE_CONNECTION_STRING || ''
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'vectordbforrag'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const BLOB_CHUNKS_PREFIX = 'chunks/'
const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the user's question using ONLY " +
  'the provided context excerpts from their documents. ' +
  'If the answer is not in the context, say so clearly. ' +
  'Cite the source file in square brackets, e.g. [filename]. ' +
  'Be concise and accurate.'

let db = null

async function getDb() {
  if (db) return db
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(MONGODB_DB)
  return db
}
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })
  try {
    req.client = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
function requireAdminKey(req, res, next) {
  const header = req.headers['authorization'] || ''
  const key = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'rag-client-auth' })
})

app.post('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const { name, clientId, clientUsername, clientPassword } = req.body
    if (!name || !clientId || !clientUsername || !clientPassword) {
      return res.status(400).json({ error: 'name, clientId, clientUsername, clientPassword are all required' })
    }

    const database = await getDb()
    const col = database.collection('clients')

    const existing = await col.findOne({ clientId })
    if (existing) {
      return res.status(409).json({ error: `Client with clientId "${clientId}" already exists` })
    }

    const hashedPassword = await bcrypt.hash(clientPassword, 10)
    const now = new Date().toISOString()
    const doc = {
      name: name.trim(),
      clientId: clientId.trim().toLowerCase(),
      clientUsername: clientUsername.trim(),
      clientPassword: hashedPassword,
      folderLink: '',
      sourceType: 'google-drive',
      status: 'idle',
      documentsCount: 0,
      autoSync: false,
      watchIntervalMs: 300000,
      lastRunAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
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
    const clients = await database.collection('clients')
      .find({}, { projection: { clientPassword: 0 } })
      .sort({ createdAt: -1 })
      .toArray()
    res.json({ clients })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const client = await database.collection('clients').findOne(
      { clientId: req.params.clientId },
      { projection: { clientPassword: 0 } }
    )
    if (!client) return res.status(404).json({ error: 'Client not found' })
    res.json(client)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const updates = { ...req.body, updatedAt: new Date().toISOString() }
    delete updates.clientPassword

    const result = await database.collection('clients').findOneAndUpdate(
      { clientId: req.params.clientId },
      { $set: updates },
      { returnDocument: 'after', projection: { clientPassword: 0 } }
    )
    if (!result) return res.status(404).json({ error: 'Client not found' })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const { clientId } = req.params
    const database = await getDb()

    const client = await database.collection('clients').findOne({ clientId })
    if (!client) return res.status(404).json({ error: 'Client not found' })

    await database.collection('clients').deleteOne({ clientId })

    const blobsDeleted = []
    const blobsFailed = []

    if (AZURE_CONNECTION_STRING) {
      try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING)
        const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME)

        const prefixes = [
          `chunks/${clientId}/`,
          `raw/${clientId}/`,
          `faiss/${clientId}/`,
          `meta/${clientId}/`,
        ]

        for (const prefix of prefixes) {
          for await (const blob of containerClient.listBlobsFlat({ prefix })) {
            try {
              await containerClient.deleteBlob(blob.name)
              blobsDeleted.push(blob.name)
            } catch (blobErr) {
              blobsFailed.push({ name: blob.name, error: blobErr.message })
            }
          }
        }
      } catch (azureErr) {
        console.error(`Azure cleanup failed for client "${clientId}":`, azureErr.message)
        blobsFailed.push({ name: 'azure-connection', error: azureErr.message })
      }
    }

    res.json({
      ok: true,
      deleted: clientId,
      blobsDeleted: blobsDeleted.length,
      blobsFailed: blobsFailed.length > 0 ? blobsFailed : undefined,
    })
  } catch (err) {
    console.error('DELETE /admin/clients:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/client/login', async (req, res) => {
  try {
    const { clientUsername, clientPassword } = req.body
    if (!clientUsername || !clientPassword) {
      return res.status(400).json({ error: 'clientUsername and clientPassword are required' })
    }

    const database = await getDb()
    const client = await database.collection('clients').findOne({ clientUsername })
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(clientPassword, client.clientPassword)
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

    const token = jwt.sign(
      {
        clientId: client.clientId,
        clientUsername: client.clientUsername,
        name: client.name,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    )

    res.json({
      token,
      client: {
        clientId: client.clientId,
        name: client.name,
        clientUsername: client.clientUsername,
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/client/me', requireAuth, async (req, res) => {
  try {
    const database = await getDb()
    const client = await database.collection('clients').findOne(
      { clientId: req.client.clientId },
      { projection: { clientPassword: 0 } }
    )
    if (!client) return res.status(404).json({ error: 'Client not found' })
    res.json(client)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function verifyClientCreds(clientId, clientPassword) {
  if (!clientId || !clientPassword) return null
  const database = await getDb()
  const client = await database.collection('clients').findOne({
    clientId: clientId.trim().toLowerCase()
  })
  if (!client) return null
  const valid = await bcrypt.compare(clientPassword, client.clientPassword)
  if (!valid) return null
  return {
    clientId: client.clientId,
    name: client.name,
    clientUsername: client.clientUsername,
  }
}

async function loadChunksForClient(clientId) {
  if (!AZURE_CONNECTION_STRING) throw new Error('AZURE_CONNECTION_STRING not set')

  const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING)
  const containerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME)

  let prefix = `${BLOB_CHUNKS_PREFIX}${clientId}/`
  let blobs = []

  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    if (blob.name.endsWith('.jsonl')) blobs.push(blob.name)
  }

  if (blobs.length === 0) {
    prefix = BLOB_CHUNKS_PREFIX
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      if (blob.name.endsWith('.jsonl')) blobs.push(blob.name)
    }
  }

  const allChunks = []
  for (const blobName of blobs) {
    try {
      const blobClient = containerClient.getBlobClient(blobName)
      const download = await blobClient.download()
      const parts = []
      for await (const chunk of download.readableStreamBody) {
        parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const text = Buffer.concat(parts).toString('utf-8')
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          allChunks.push(JSON.parse(trimmed))
        } catch { }
      }
    } catch (err) {
      console.warn(`Failed to load blob ${blobName}:`, err.message)
    }
  }

  return allChunks
}

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
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return chunks
    .map(c => {
      const text = (c.text || '').toLowerCase()
      const score = words.reduce((acc, w) => acc + (text.includes(w) ? 1 : 0), 0)
      return { ...c, _score: score }
    })
    .filter(c => c._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topK)
}

async function embedQueryGemini(query) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const res = await ai.models.embedContent({
    model: 'text-embedding-004',
    contents: query,
  })
  return res.embeddings[0].values
}

async function retrieveChunks(query, chunks, topK = 5) {
  const withEmbeddings = chunks.filter(c => Array.isArray(c.embedding) && c.embedding.length > 0)

  if (withEmbeddings.length === 0) {
    return keywordSearch(query, chunks, topK)
  }

  let queryVec
  try {
    queryVec = await embedQueryGemini(query)
  } catch (err) {
    console.warn('Gemini embed failed, falling back to keyword search:', err.message)
    return keywordSearch(query, chunks, topK)
  }

  if (queryVec.length !== withEmbeddings[0].embedding.length) {
    console.warn(`Embedding dimension mismatch (query: ${queryVec.length}, stored: ${withEmbeddings[0].embedding.length}), falling back to keyword search`)
    return keywordSearch(query, chunks, topK)
  }

  return withEmbeddings
    .map(c => ({ ...c, _score: cosineSim(queryVec, c.embedding) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topK)
}

function buildContext(hits) {
  return hits.map((h, i) => {
    const score = typeof h._score === 'number' ? h._score.toFixed(4) : '—'
    const source = h.source_file || 'unknown'
    return `[${i + 1}] Source: ${source}  |  Score: ${score}\n${(h.text || '').trim()}`
  }).join('\n\n---\n\n')
}

async function answerWithGemini(query, context) {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const prompt = `${SYSTEM_PROMPT}\n\nContext:\n${context}\n\nQuestion: ${query}`
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { temperature: 0.2, maxOutputTokens: 1024 },
  })
  return res.text
}

app.post('/chat/login', async (req, res) => {
  try {
    const { clientId, clientPassword } = req.body
    if (!clientId || !clientPassword) {
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    }
    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })
    res.json({ ok: true, client })
  } catch (err) {
    console.error('POST /chat/login:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/chat/message', async (req, res) => {
  try {
    const { clientId, clientPassword, query, topK = 5 } = req.body

    if (!clientId || !clientPassword) {
      return res.status(400).json({ error: 'clientId and clientPassword are required' })
    }
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'query is required' })
    }

    const client = await verifyClientCreds(clientId, clientPassword)
    if (!client) return res.status(401).json({ error: 'Invalid credentials' })

    const chunks = await loadChunksForClient(clientId)
    if (chunks.length === 0) {
      return res.json({
        answer: 'No documents found for your account. Please ensure your documents have been ingested first.',
        sources: [],
        client,
      })
    }

    const hits = await retrieveChunks(query.trim(), chunks, Math.min(topK, 15))
    if (hits.length === 0) {
      return res.json({
        answer: 'No relevant content found in your documents for that question.',
        sources: [],
        client,
      })
    }
    const context = buildContext(hits)
    const answer = await answerWithGemini(query.trim(), context)
    const sources = hits.map(h => ({
      source_file: h.source_file || 'unknown',
      chunk_index: h.chunk_index ?? 0,
      score: typeof h._score === 'number' ? parseFloat(h._score.toFixed(4)) : null,
      preview: (h.text || '').slice(0, 300),
    }))
    res.json({ answer, sources, client })
  } catch (err) {
    console.error('POST /chat/message:', err)
    res.status(500).json({ error: err.message })
  }
})
const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`rag-client-auth running on port ${PORT}`))

module.exports = app
