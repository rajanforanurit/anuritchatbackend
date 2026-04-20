require('dotenv').config()
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const { MongoClient, ObjectId } = require('mongodb')

const app = express()
app.use(cors())
app.use(express.json())

const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB  = process.env.MONGODB_DB || 'clientcreds'
const JWT_SECRET  = process.env.JWT_SECRET  || 'rag-client-jwt-secret'

let db = null

async function getDb() {
  if (db) return db
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(MONGODB_DB)
  console.log('Connected to MongoDB')
  return db
}

// ── Auth middleware ──────────────────────────────────────────────────────────
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

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'rag-client-auth' })
})

// ────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — called from admin panel (uses RAG_API_KEY header)
// ────────────────────────────────────────────────────────────────────────────
function requireAdminKey(req, res, next) {
  const header = req.headers['authorization'] || ''
  const key = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// Create client
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

// Get all clients
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

// Get single client
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

// Update client (folder link, status, docs count, etc.)
app.patch('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const updates = { ...req.body, updatedAt: new Date().toISOString() }

    // Never allow overwriting password via this route
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

// Delete client
app.delete('/admin/clients/:clientId', requireAdminKey, async (req, res) => {
  try {
    const database = await getDb()
    const result = await database.collection('clients').deleteOne({ clientId: req.params.clientId })
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Client not found' })
    res.json({ ok: true, deleted: req.params.clientId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// CLIENT ROUTES — called from chat panel
// ────────────────────────────────────────────────────────────────────────────

// Client login — returns JWT
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

// Get own profile (chat panel uses this to confirm identity + get clientId)
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

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`rag-client-auth running on port ${PORT}`))

module.exports = app