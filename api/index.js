require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ObjectId } = require('mongodb')
const { BlobServiceClient } = require('@azure/storage-blob')
const pdfParse = require('pdf-parse')
const mammoth = require('mammoth')
const XLSX = require('xlsx')
const Papa = require('papaparse')
const stringSimilarity = require('string-similarity')
const crypto = require('crypto')
const { DOMParser } = require('@xmldom/xmldom')
const { resolveIntent } = require('./src/ed')
const app = express()
const allowedOrigins = [
'http://localhost:8080','http://localhost:3000','https://app.powerbi.com',
'https://msit.powerbi.com','https://anuritchat.vercel.app','https://askdatatest.vercel.app',
'https://ragadminpanel.vercel.app','https://df.powerbi.com','https://www.anuritinnovation.com/',
'https://api.powerbi.com',
]
const originAllowed = o => !o || o === 'null' || allowedOrigins.includes(o) || /\.(powerbi|microsoft|office)\.com$/.test(o)
const corsOpts = { origin: (o, cb) => cb(null, originAllowed(o)), methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-session-id'], credentials: true }
app.use(cors(corsOpts))
app.options('*', cors({ ...corsOpts, origin: (o, cb) => cb(null, true) }))
app.use(express.json())
const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB = process.env.MONGODB_DB || 'clientcreds'
const CHAT_HISTORY_URI = process.env.CHAT_HISTORY_URI
const CHAT_HISTORY_DB = process.env.CHAT_HISTORY_DB || 'chathistory'
const AZURE_CONNECTION_STRING = process.env.AZURE_CONNECTION_STRING || ''
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'vectordbforrag'
const ADMIN_API_KEY = process.env.ADMIN_API_KEY
const KEY_CHECK_INTERVAL_MS = parseInt(process.env.KEY_CHECK_INTERVAL_MS || '300000', 10)
const ASKDATA_ENDPOINT = process.env.ASKDATA_ENDPOINT || ''
const ASKDATA_KEY = process.env.ASKDATA_KEY || ''
const ASKDATA_MODEL = process.env.ASKDATA_MODEL || 'ASKDATA'
const ASKDATA_TIMEOUT_MS = parseInt(process.env.ASKDATA_TIMEOUT_MS || '30000', 10)
const ASKDATA2_ENDPOINT = process.env.ASKDATA2_ENDPOINT || ''
const ASKDATA2_KEY = process.env.ASKDATA2_KEY || ''
const ASKDATA2_MODEL = process.env.ASKDATA2_MODEL || 'ASKDATA2'
const ASKDATA2_TIMEOUT_MS = parseInt(process.env.ASKDATA2_TIMEOUT_MS || '30000', 10)
const ASKDATA2_REWRITE_TIMEOUT_MS = parseInt(process.env.ASKDATA2_REWRITE_TIMEOUT_MS || '8000', 10)
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '60000', 10)
const WARMUP_CLIENT_IDS = (process.env.WARMUP_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
const RAW_PREFIX = 'raw'
const CHUNK_SIZE = 1800
const CHUNK_OVERLAP = 200
const POLICY_CHUNK_SIZE = 1200
const POLICY_CHUNK_OVERLAP = 150
const RESEARCH_CHUNK_SIZE = 1500
const RESEARCH_CHUNK_OVERLAP = 180
const LEGAL_CHUNK_SIZE = 1000
const LEGAL_CHUNK_OVERLAP = 120
const TECH_CHUNK_SIZE = 1600
const TECH_CHUNK_OVERLAP = 180
const MAX_TOKENS_PER_CHUNK = 2000
const BLOB_CONCURRENCY = parseInt(process.env.BLOB_CONCURRENCY || '8', 10)
const CHUNK_CACHE_TTL = parseInt(process.env.CHUNK_CACHE_TTL_MS || '300000', 10)
const MAX_HITS_GLOBAL = 20
const CONTEXT_CHAR_LIMIT = 5000
const RELATED_KEYWORDS_COUNT = 5
const RELATED_KEYWORDS_MIN_SCORE = 1
const blobServiceClient = AZURE_CONNECTION_STRING ? BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING) : null
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx', '.json', '.txt', '.csv'])
const RESPONSE_CACHE = new Map()
const RESPONSE_CACHE_TTL = 10 * 60 * 1000
const RESPONSE_CACHE_MAX = 1000
function responseCacheGet(key) {
const e = RESPONSE_CACHE.get(key)
if (!e) return null
if (Date.now() - e.ts > RESPONSE_CACHE_TTL) { RESPONSE_CACHE.delete(key); return null }
return e.value
}
function responseCacheSet(key, value) {
if (RESPONSE_CACHE.size >= RESPONSE_CACHE_MAX) RESPONSE_CACHE.delete(RESPONSE_CACHE.keys().next().value)
RESPONSE_CACHE.set(key, { value, ts: Date.now() })
}
const SYNONYM_PAIRS = [
[/\bapp(lication)?s?\s+(count|volume|number)\b/i, 'application count'],
[/\b(total|submitted)\s+app(lication)?s?\b/i, 'application count'],
[/\bnumber\s+of\s+app(lication)?s\b/i, 'application count'],
[/\bocc(upancy)?\s+(rate|formula)\b/i, m => `occupancy ${m.match(/formula/i) ? 'formula' : 'rate'}`],
[/\blead\s+(acq\w*\s+)?cost\b/i, 'lead acquisition cost'],
[/\bsec\.?\s*(dep\w*)?\b/i, 'security deposit'],
[/\brent\s+inc\b/i, 'rent increase'],
[/\bnotice\s+(per|req)\w*\b/i, m => m.match(/req/i) ? 'notice requirement' : 'notice period'],
[/\blate\s+fee\b/i, 'late payment fee'],
[/\bpenalty\s+clause\b/i, 'penalty clause'],
[/\bterm\w*\s+clause\b/i, 'termination clause'],
[/\beviction\s+proc\w*\b/i, 'eviction procedure'],
[/\bmaint\w*\s+resp\w*\b/i, 'maintenance responsibility'],
]
function applySynonyms(q) {
for (const [pat, rep] of SYNONYM_PAIRS) {
if (typeof rep === 'function') q = q.replace(pat, rep)
else q = q.replace(pat, rep)
}
return q
}
const TYPO_MAP = {
ehat:'what',waht:'what',whta:'what',whar:'what',hwo:'how',hoe:'how',
difine:'define',definr:'define',defien:'define',defne:'define',
expain:'explain',expalin:'explain',explian:'explain',
wht:'what',shwo:'show',lsit:'list',lits:'list',
polcy:'policy',policiy:'policy',poilcy:'policy',
tennant:'tenant',tennat:'tenant',tentant:'tenant',
lanlord:'landlord',landord:'landlord',
rentel:'rental',rentl:'rental',leas:'lease',laese:'lease',
deposite:'deposit',depoist:'deposit',notise:'notice',noice:'notice',
terminaton:'termination',termiantion:'termination',
maintenence:'maintenance',maintanence:'maintenance',
}
function applyTypos(q) {
return q.split(/\s+/).map(w => TYPO_MAP[w.toLowerCase()] || w).join(' ')
}
function levenshteinSimilarity(a, b) {
if (!a && !b) return 1
if (!a || !b) return 0
a = a.toLowerCase(); b = b.toLowerCase()
const m = a.length, n = b.length
const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i===0?j:j===0?i:0))
for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1])
return 1 - dp[m][n] / Math.max(m, n)
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '' }
function normalizeQuery(q) {
return applySynonyms(q).toLowerCase().trim()
.replace(/\bweek\s+(\d)\b/g, (_, n) => `week 0${n}`)
.replace(/[?!.]+$/, '').replace(/\s+/g, ' ')
}
function normalizeQueryForCache(q) {
return normalizeQuery(q)
.replace(/^(what\s+is\s+(the\s+)?(definition|meaning)\s+(of|for|to)\s+)/i, '')
.replace(/^(define|explain|tell\s+me\s+about|what\s+are|what\s+is|how\s+(do\s+you\s+|is\s+|are\s+)?calculate|describe|meaning\s+of)\s+(the\s+)?/i, '')
.replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
}
function getCacheKey(clientId, q) { return `${clientId}:${normalizeQueryForCache(q)}` }
function validateQuery(q) {
if (!q || typeof q !== 'string') return { valid: false, message: 'Please enter a complete question.' }
const words = q.trim().split(/\s+/).filter(Boolean)
if (words.length < 2) return { valid: false, message: 'Please enter a more detailed question.' }
return { valid: true }
}
function detectDocumentType(chunks) {
if (!chunks?.length) return 'mixed'
let policy=0, dict=0, research=0, legal=0, tech=0
for (const c of chunks.slice(0, 50)) {
const t = (c.text||'').toLowerCase()
if (c.metadata?.measure || c.metadata?.formula !== undefined) dict += 3
if (/\b(shall|must|tenant|landlord|lessee|lessor|clause|policy|agreement|pursuant|notwithstanding|whereas|hereby)\b/.test(t)) policy++
if (/\b(rent|lease|deposit|notice|termination|eviction|maintenance|penalty|breach|obligation)\b/.test(t)) policy++
if (/\b(is defined as|formula|calculated as|measure|attribute|kpi|metric)\b/.test(t)) dict++
if (/^(section|article|clause|\d+\.\d+)/im.test(c.text||'')) policy += 2
if (/\b(abstract|introduction|methodology|conclusion|accuracy|precision|recall|epoch|neural|dataset|training|classification|algorithm)\b/.test(t)) research++
if (/\b(figure\s+\d|table\s+\d|et\s+al|doi:|references?|ieee|arxiv)\b/.test(t)) research += 2
if (/\b(whereas|indemnif|hereinafter|jurisdiction|arbitration|governing\s+law|force\s+majeure|intellectual\s+property|confidential)\b/.test(t)) legal += 3
if (/\b(api|endpoint|function|parameter|configuration|module|sdk|interface|code|syntax|install|deploy|server|client|request|response)\b/.test(t)) tech++
}
if (research > policy*2 && research > dict*2 && research > legal) return 'research'
if (legal > policy*1.5 && legal > research*1.5) return 'legal'
if (tech > policy*2 && tech > research*1.5) return 'technical'
if (policy > dict*1.5 && policy > research*1.5) return 'policy'
if (dict > policy*1.5 && dict > research*1.5) return 'dictionary'
return 'mixed'
}
function detectQueryIntent(q) {
const n = normalizeQuery(q)
if (/^(hi|hello|hey|howdy|greetings|good\s+(morning|afternoon|evening)|how\s+are\s+you)\b/.test(n)) return 'greeting'
if (/\b(url|link|dashboard|power\s*bi|report\s+url)\b/.test(n)) return 'url_lookup'
if (/\b(formula|equation|calculate|calculation|calculated|computed|derived)\b/i.test(n) ||
/how\s+(is|are|was|were)\s+.+\s+(calculated|computed|determined|derived)/i.test(n) ||
/what\s+is\s+the\s+(formula|calculation)\s+for/i.test(n) ||
/how\s+do\s+you\s+(calculate|compute)/i.test(n)) return 'calculation'
if (/\b(what\s+(happens|is\s+the\s+penalty|are\s+the\s+consequences)|penalty|consequence|breach|violation|non.compliance)\b/i.test(n)) return 'policy_consequence'
if (/\b(allowed|permitted|can\s+(tenant|landlord|i)|is\s+it\s+allowed|may\s+(tenant|landlord)|right\s+to|entitled\s+to)\b/i.test(n)) return 'policy_permission'
if (/\b(how\s+(many|much|long|often)|duration|period|days|months|amount|limit|maximum|minimum|deadline)\b/i.test(n) &&
/\b(notice|deposit|rent|fee|penalty|maintenance|payment)\b/i.test(n)) return 'policy_numeric'
if (/\b(policy|clause|rule|requirement|condition|obligation|responsibility|procedure)\b/i.test(n)) return 'policy_lookup'
if (/^(what\s+is\s+(the\s+)?(definition|meaning)|define|what\s+(is|are)|explain|tell\s+me\s+about|describe|meaning\s+of)/i.test(n) ||
/\b(definition|meaning)\b/i.test(n)) return 'definition'
if (/\b(vs|versus|difference|compare|between)\b/.test(n)) return 'comparison'
return 'general'
}
function detectMultiTopicQuery(q) {
const stops = new Set(['is','are','was','were','it','this','that','its','my','your'])
const diffPats = [
/^(?:what\s+is\s+the\s+)?difference\s+between\s+(.+?)\s+and\s+(.+?)[\s?]*$/i,
/^compare\s+(.+?)\s+(?:vs\.?|versus|and)\s+(.+?)[\s?]*$/i,
/^(.+?)\s+vs\.?\s+(.+?)[\s?]*$/i,
]
const andPats = [
/^what\s+(?:is|are)\s+(.+?)\s+and\s+(.+?)[\s?]*$/i,
/^(?:define|explain|tell\s+me\s+about)\s+(.+?)\s+and\s+(.+?)[\s?]*$/i,
/^(.+?)\s+and\s+(.+?)[\s?]*$/i,
]
for (const p of diffPats) {
const m = q.match(p)
if (m) {
const [a,b] = [m[1],m[2]].map(s => s.trim().replace(/^(what\s+is\s+|the\s+)/i,'').trim())
if (a.length > 1 && b.length > 1) return { isMulti:true, topics:[a,b], mode:'comparison' }
}
}
for (const p of andPats) {
const m = q.match(p)
if (m) {
const [a,b] = [m[1],m[2]].map(s => s.trim().replace(/^(what\s+is\s+|what\s+are\s+|define\s+|the\s+)/i,'').trim())
if (a.length>1 && b.length>1 && !stops.has(a.toLowerCase()) && !stops.has(b.toLowerCase()))
return { isMulti:true, topics:[a,b], mode:'multi_definition' }
}
}
return { isMulti:false, topics:[], mode:null }
}
function extractSubject(q) {
const n = normalizeQuery(applySynonyms(q))
const pats = [
/^what\s+(?:is|are)\s+(?:the\s+)?(?:definition|meaning)\s+(?:of|for|to)\s+(?:an?\s+|the\s+)?(.+)$/i,
/^define\s+(?:an?\s+|the\s+)?(.+)$/i,
/^explain\s+(?:an?\s+|the\s+)?how\s+(.+?)\s+(?:is\s+)?calculated$/i,
/^explain\s+(?:an?\s+|the\s+)?(.+)$/i,
/^tell\s+me\s+about\s+(?:an?\s+|the\s+)?(.+)$/i,
/^describe\s+(?:me\s+)?(?:an?\s+|the\s+)?(.+)$/i,
/^meaning\s+of\s+(?:an?\s+|the\s+)?(.+)$/i,
/^how\s+(?:is|are)\s+(.+?)\s+(?:calculated|defined|measured|computed)$/i,
/^what\s+is\s+the\s+formula\s+for\s+(?:calculating\s+)?(?:an?\s+|the\s+)?(.+)$/i,
/^how\s+(?:do\s+you\s+)?calculate\s+(?:an?\s+|the\s+)?(.+)$/i,
/^(.+?)\s+(?:formula|equation|calculation)$/i,
/^what\s+(?:is|are)\s+(?:an?\s+|the\s+)?(.+)$/i,
/^(?:what\s+is\s+)?(.+)$/i,
]
for (const p of pats) {
const m = n.match(p)
if (m) { const s = m[1].trim().replace(/[?!.]+$/, '').trim(); if (s.length > 0) return s }
}
return n.replace(/[?!.]+$/, '').trim()
}
function extractUrlKeywords(q) {
const stops = new Set(['power','bi','report','url','link','for','the','a','an','of','in','get','me','show','give','find','fetch'])
return q.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !stops.has(w))
}
function fixBrokenUrls(t) { return t.replace(/https:\/\/[^\s]+(\s+[^\s]+)/g, m => m.replace(/\s/g,'')) }
function normalizeTerms(t) {
const l = t.toLowerCase().trim(), v = new Set([l])
if (l.endsWith('s')) v.add(l.slice(0,-1)); else v.add(l+'s')
if (l.endsWith('ies')) v.add(l.slice(0,-3)+'y')
if (l.endsWith('y')) v.add(l.slice(0,-1)+'ies')
return [...v]
}
function trimToCompleteSentence(text, maxLen=1200) {
if (!text || text.length <= maxLen) return text
const t = text.slice(0, maxLen)
const last = Math.max(t.lastIndexOf('. '), t.lastIndexOf('.\n'), t.lastIndexOf('.'))
if (last > maxLen*0.5) return t.slice(0,last+1).trim()
const ls = t.lastIndexOf(' ')
return (ls > maxLen*0.7 ? t.slice(0,ls) : t).trim()
}
function trimPreviewToSentence(text, maxLen=200) {
if (!text || text.length <= maxLen) return text.trim()
const t = text.slice(0,maxLen)
const end = Math.max(t.lastIndexOf('. '),t.lastIndexOf('.\n'),t.lastIndexOf('! '),t.lastIndexOf('? '))
if (end > maxLen*0.4) return t.slice(0,end+1).trim()
const ls = t.lastIndexOf(' ')
return (ls > maxLen*0.6 ? t.slice(0,ls).trim()+'...' : t.trim()+'...')
}
function ensureSinglePeriod(t) { return t ? t.replace(/\.{2,}/g,'.').replace(/\.\s*\./g,'.').trim() : '' }
function extractFormulaFromText(text) {
if (!text) return ''
for (const p of [
/formula\s*:\s*([^\n.]+)/i, /calculated\s+as\s+([^\n.]+)/i, /computed\s+as\s+([^\n.]+)/i,
/([a-z0-9\s%()#]+\s*\/\s*[a-z0-9\s%()#]+)/i, /([a-z0-9\s%()#]+\s*=\s*[a-z0-9\s%()#+\-*/]+)/i,
]) {
const m = text.match(p)
if (m?.[1]?.trim().length > 3) return m[1].trim()
}
return ''
}
const NEGATIVE_PAIRS = [
['non-recurring','recurring'],['non recurring','recurring'],['denied','approved'],
['inactive','active'],['rejected','accepted'],['unpaid','paid'],['cancelled','active'],
['delinquent','current'],['non-',''],
]
function computeNegativePenalty(subj, text) {
const qs = subj.toLowerCase(), ct = text.toLowerCase()
let penalty = 0
for (const [neg, pos] of NEGATIVE_PAIRS) {
if (!pos) continue
const qHasPos = pos.length > 0 && new RegExp(`\\b${escapeRegex(pos)}\\b`,'i').test(qs)
const qHasNeg = new RegExp(`\\b${escapeRegex(neg)}\\b`,'i').test(qs)
if (qHasPos && !qHasNeg && new RegExp(`\\b${escapeRegex(neg)}\\b`,'i').test(ct)) penalty += 30
if (qHasNeg && pos.length > 0 && !new RegExp(`\\b${escapeRegex(neg)}\\b`,'i').test(ct) && new RegExp(`\\b${escapeRegex(pos)}\\b`,'i').test(ct)) penalty += 20
}
return penalty
}
function buildVocabulary(chunks) {
const vocab = new Set()
const stops = new Set(['is','the','a','an','of','in','for','to','at','by','as','on','or','and','be','it','its','with','that','this','from','are','was','were'])
for (const c of chunks) {
const words = (c.text||'').toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/)
for (const w of words) if (w.length >= 3 && !stops.has(w)) vocab.add(w)
if (c.metadata?.measure) {
for (const w of c.metadata.measure.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/))
if (w.length >= 3 && !stops.has(w)) vocab.add(w)
}
}
return [...vocab]
}
const DOMAIN_SHORT_SAFELIST = new Set([
'count','rate','rent','cost','date','type','name','unit','term','area','base','gross','net',
'avg','sum','min','max','ytd','mtd','per','fee','tax','due','paid','void','open','loss','gain',
'flow','days','beds','bath','sqft','tier','band','code','flag','rank','sort','key','ref',
'clause','rule','policy','lease','notice','deposit','penalty','breach',
'cnn','rnn','lstm','gru','svm','mlp','knn','pca','gan','vgg',
])
function fuzzyCorrectQuery(q, chunks) {
if (!chunks?.length) return q
const vocab = buildVocabulary(chunks)
if (!vocab.length) return q
const stops = new Set(['what','is','are','how','the','a','an','of','in','for','to','at','by','as','on','or','and','define','explain','show','find','get','list','give'])
return q.split(/\s+/).map(w => {
const l = w.toLowerCase()
if (stops.has(l) || DOMAIN_SHORT_SAFELIST.has(l) || l.length < 6 || vocab.includes(l)) return w
const { bestMatch } = stringSimilarity.findBestMatch(l, vocab)
const score = bestMatch.rating*0.6 + levenshteinSimilarity(l, bestMatch.target)*0.4
if (score >= 0.72 && bestMatch.target !== l) return bestMatch.target
return w
}).join(' ')
}
function needsQueryRewrite(q) {
const words = q.trim().split(/\s+/).filter(Boolean)
if (words.length <= 2) return true
if (/[^\x00-\x7F]/.test(q) && words.length < 5) return true
if (/(.)\1{3,}/.test(q)) return true
if (words.length < 4 && !/\b(what|how|define|explain|formula|calculate|list|show|find|url|link)\b/i.test(q)) return true
if (!/\b(is|are|was|were|what|how|why|when|where|who|define|explain|calculate|show|list|find|get|give|tell)\b/i.test(q) && words.length < 6) return true
return false
}
async function rewriteQueryWithAskdata2(q) {
if (!ASKDATA2_ENDPOINT || !ASKDATA2_KEY) return q
try {
const r = await fetchWithTimeout(ASKDATA2_ENDPOINT, {
method:'POST',
headers:{'Content-Type':'application/json','Authorization':`Bearer ${ASKDATA2_KEY}`,'Accept':'application/json'},
body:JSON.stringify({
model:ASKDATA2_MODEL,
messages:[
{role:'system',content:'Fix spelling, grammar, and structure of this RAG query. Expand abbreviations. Return ONLY the rewritten query. If already correct, return unchanged.'},
{role:'user',content:q}
],
max_tokens:80,temperature:0.0,top_p:1.0,stream:false,
}),
}, ASKDATA2_REWRITE_TIMEOUT_MS)
if (!r.ok) return q
const data = await r.json()
const out = (data.choices?.[0]?.message?.content||'').trim().replace(/^["']|["']$/g,'').trim()
return (!out || out.length < 3 || out.length > q.length*4) ? q : out
} catch { return q }
}
async function preprocessQuery(q) {
return needsQueryRewrite(q) ? rewriteQueryWithAskdata2(q) : q
}
function expandQueryForPolicy(q) {
const l = q.toLowerCase()
const exp = []
if (/\bsecurity\s+deposit\b/.test(l)) exp.push('security deposit refund return conditions deduction')
if (/\bnotice\s+(period|to\s+(vacate|quit|terminate))\b/.test(l)) exp.push('notice period days written termination vacate')
if (/\blate\s+(fee|payment|rent)\b/.test(l)) exp.push('late fee penalty grace period overdue')
if (/\b(termination|end\s+of\s+lease)\b/.test(l)) exp.push('termination clause early termination penalty break lease')
if (/\b(maintenance|repair)\b/.test(l)) exp.push('maintenance repair responsibility landlord tenant')
if (/\beviction\b/.test(l)) exp.push('eviction process procedure notice breach non-payment')
if (/\b(rent\s+increase|escalation)\b/.test(l)) exp.push('rent increase escalation annual percentage notice')
if (/\bpet\b/.test(l)) exp.push('pet policy allowed permitted deposit fee')
if (/\b(sublease|sublet)\b/.test(l)) exp.push('sublease sublet permission consent landlord')
if (/\brenewal\b/.test(l)) exp.push('lease renewal term extension option notice')
return exp.length ? q + ' ' + exp.join(' ') : q
}
function computeBM25Score(terms, text, avgLen, k1=1.5, b=0.75) {
const words = text.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/)
const dl = words.length
const tf = {}
for (const w of words) tf[w] = (tf[w]||0)+1
let score = 0
for (const t of terms) {
const f = tf[t]||0
if (!f) continue
score += 1.5 * (f*(k1+1)) / (f + k1*(1-b+b*dl/avgLen))
}
return score
}
function computePolicyRelevanceScore(q, text, intent) {
const t = text.toLowerCase()
let score = 0
const signals = ['shall','must','may','tenant','landlord','lessee','lessor','pursuant','hereby','thereof','herein','notwithstanding','whereas','obligation','liability','clause','section','article']
score += signals.filter(s => t.includes(s)).length * 2
if (intent === 'policy_consequence' && /\b(penalty|consequence|liable|breach|default|eviction|forfeit|charge|fine)\b/.test(t)) score += 20
if (intent === 'policy_permission' && /\b(permitted|allowed|may|shall\s+not|must\s+not|prohibited|forbidden|cannot|restricted)\b/.test(t)) score += 20
if (intent === 'policy_numeric' && /\b\d+\s*(days?|months?|years?|percent|%)\b/.test(t)) score += 25
if (/^(section|article|clause|\d+\.\d+)/im.test(text)) score += 10
return score
}
function lightweightRerank(q, chunks, intent, docType) {
if (!chunks.length) return chunks
const ql = q.toLowerCase()
const terms = ql.replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length > 2)
const totalLen = chunks.reduce((s,c) => s + (c.text||'').split(/\s+/).length, 0)
const avgLen = totalLen / chunks.length || 100
const isPolicy = ['policy_lookup','policy_consequence','policy_permission','policy_numeric'].includes(intent)
return chunks.map(c => {
const text = c.text||''
let score = computeBM25Score(terms, text, avgLen) * 10
if (isPolicy || docType === 'policy' || docType === 'legal') score += computePolicyRelevanceScore(q, text, intent)
if (c.metadata?.section_heading) {
const hl = (c.metadata.section_heading||'').toLowerCase()
score += terms.filter(t => hl.includes(t)).length * 8
}
if (c.metadata?.is_definition_chunk && intent === 'definition') score += 12
if (c.metadata?.measure) {
const ml = (c.metadata.measure||'').toLowerCase().trim()
if (ml === terms.join(' ').trim()) score += 80
}
if (c.metadata?.is_clause_chunk && (isPolicy || docType === 'legal')) score += 12
if (c.metadata?.is_results_section && /\b(accuracy|precision|recall|f1|score|epoch|result)\b/i.test(ql)) score += 20
if (c.metadata?.contains_table) score += 8
if (new RegExp(escapeRegex(ql.slice(0,30)),'i').test(text)) score += 8
return { ...c, _rerankScore: score, _score: (c._score||0) + score*0.3 }
}).sort((a,b) => (b._score - a._score) || (b._rerankScore - a._rerankScore))
}
function buildInvertedIndex(chunks) {
const idx = new Map()
for (let i=0; i<chunks.length; i++) {
const words = (chunks[i].text||'').toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/)
for (const w of words) {
if (w.length < 2) continue
if (!idx.has(w)) idx.set(w, new Set())
idx.get(w).add(i)
}
}
return idx
}
function keywordSearch(q, chunks, topK, intent, invertedIndex) {
const subject = extractSubject(q)
const subjectWords = subject.toLowerCase().split(/\s+/).filter(w => w.length > 1)
const qLower = normalizeQuery(q)
const subjectRegex = subjectWords.length > 1
? new RegExp(escapeRegex(subject.toLowerCase()), 'i')
: new RegExp(`\\b${escapeRegex(subject.toLowerCase())}\\b`, 'i')
let candidateSet
if (invertedIndex) {
const union = new Set()
const words = intent === 'url_lookup' ? extractUrlKeywords(q) : subjectWords
for (const w of words) {
for (const i of (invertedIndex.get(w)||new Set())) union.add(i)
for (const v of normalizeTerms(w)) for (const i of (invertedIndex.get(v)||new Set())) union.add(i)
}
if (intent === 'url_lookup') for (const w of ['url','link','https','powerbi']) for (const i of (invertedIndex.get(w)||new Set())) union.add(i)
candidateSet = union
}
const source = candidateSet ? [...candidateSet].map(i => chunks[i]).filter(Boolean) : chunks.slice(0,200)
return source.map(c => {
const text = (c.text||'').toLowerCase()
let score = 0
if (intent === 'url_lookup') {
if (!text.includes('http')) return {...c, _score:0}
const kws = extractUrlKeywords(q)
const matched = kws.filter(w => text.includes(w)).length
if (!matched) return {...c, _score:0}
score += matched * 10
} else {
if (subjectRegex.test(c.text||'')) {
score += subjectWords.length * 6
if (/\b(is defined as|is calculated as|formula:|shall|must|means)/i.test((c.text||'').slice(0, (c.text||'').toLowerCase().indexOf(subject.toLowerCase())+100))) score += subjectWords.length * 8
}
score += subjectWords.filter(w => new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(c.text||'')).length * 2
if (new RegExp(`\\b${escapeRegex(qLower)}\\b`,'i').test(c.text||'')) score += 3
if (intent === 'calculation') {
if (/\b(formula|calculated\s+as|computed\s+as|how\s+to\s+calculate|formula\s+for)\b/i.test(text)) score += 15
if (text.includes('=') || text.includes('/')) score += 5
}
if (intent === 'policy_consequence' && /\b(penalty|consequence|liable|breach|default|eviction|forfeit)\b/i.test(text)) score += 20
if (intent === 'policy_permission' && /\b(permitted|allowed|may\s+(not)?|shall\s+not|must\s+not|prohibited|forbidden)\b/i.test(text)) score += 20
if (intent === 'policy_numeric' && /\b\d+\s*(days?|months?|years?|percent|%)\b/i.test(text)) score += 20
if (c.metadata?.section_heading && subjectWords.some(w => (c.metadata.section_heading||'').toLowerCase().includes(w))) score += 25
if (c.metadata?.measure) {
const ml = (c.metadata.measure||'').toLowerCase().trim()
if (ml === subject.toLowerCase().trim()) score += 100
else if (subjectWords.some(w => new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(ml))) score += 10
}
score -= computeNegativePenalty(subject, c.text||'')
}
return {...c, _score: score}
}).filter(c => c._score > 0).sort((a,b) => b._score - a._score).slice(0, topK)
}
function relaxedKeywordSearch(q, chunks, topK, invertedIndex) {
const subject = extractSubject(q)
const words = [...new Set([
...subject.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length > 1),
...q.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length > 2),
])]
const union = new Set()
if (invertedIndex) {
for (const w of words) {
for (const i of (invertedIndex.get(w)||new Set())) union.add(i)
for (const v of normalizeTerms(w)) for (const i of (invertedIndex.get(v)||new Set())) union.add(i)
}
}
const source = union.size ? [...union].map(i => chunks[i]).filter(Boolean) : chunks.slice(0,300)
return source.map(c => {
const text = (c.text||'').toLowerCase()
const matched = words.filter(w => new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(text)).length
const subjectMatch = subject.length > 2 && new RegExp(`\\b${escapeRegex(subject.toLowerCase())}\\b`,'i').test(text) ? 5 : 0
let meta = 0
if (c.metadata?.measure) {
const ml = c.metadata.measure.toLowerCase()
if (ml === subject.toLowerCase().trim()) meta += 50
else meta += words.filter(w => new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(ml)).length * 3
}
if (c.metadata?.section_heading) meta += words.filter(w => (c.metadata.section_heading||'').toLowerCase().includes(w)).length * 5
const penalty = computeNegativePenalty(subject, c.text||'')
return {...c, _score: Math.max(0, matched + subjectMatch + meta - penalty)}
}).filter(c => c._score > 0).sort((a,b) => b._score - a._score).slice(0, topK)
}
async function retrieveChunks(q, chunks, topK, invertedIndex, docType, _retry=false) {
const intent = detectQueryIntent(q)
const isPolicy = ['policy_lookup','policy_consequence','policy_permission','policy_numeric'].includes(intent)
let sq = normalizeQuery(q).replace(/[^\w\s]/g,' ').replace(/\s+/g,' ')
if (isPolicy || docType === 'policy' || docType === 'legal' || docType === 'mixed') sq = expandQueryForPolicy(sq)
if (intent === 'all_urls') return chunks.filter(c => /https?:\/\/\S+/.test(c.text||'')).slice(0,100)
const candidates = keywordSearch(sq, chunks, Math.min(80, chunks.length), intent, invertedIndex)
const pool = candidates.length ? candidates : chunks.slice(0,80)
const topScore = pool[0]?._score || 0
let top = []
if (topScore >= 6) top = pool.slice(0, Math.min(MAX_HITS_GLOBAL, pool.length))
else if ((intent === 'definition' || intent === 'calculation') && topScore >= 3) top = pool.slice(0, Math.min(MAX_HITS_GLOBAL, pool.length))
else if (isPolicy && topScore >= 2) top = pool.slice(0, Math.min(MAX_HITS_GLOBAL, pool.length))
else if (topScore >= 2) top = pool.slice(0, Math.min(10, pool.length))
if (!top.length && !_retry) {
const corrected = fuzzyCorrectQuery(q, chunks)
if (corrected.toLowerCase() !== q.toLowerCase()) return retrieveChunks(corrected, chunks, topK, invertedIndex, docType, true)
}
if (!top.length) top = relaxedKeywordSearch(sq, chunks, Math.min(topK*2, 32), invertedIndex).slice(0, Math.min(topK, MAX_HITS_GLOBAL))
if (top.length > 1) top = lightweightRerank(q, top, intent, docType)
const effectiveTopK = intent === 'definition' ? 4 : intent === 'calculation' ? 4 : isPolicy ? 5 : 5
return top.slice(0, Math.min(effectiveTopK, MAX_HITS_GLOBAL))
}
function estimateTokens(text) {
return Math.ceil((text||'').length / 3.8)
}
function buildContext(hits, docType) {
const seen = new Set()
const deduped = []
for (const h of hits) {
if (h.metadata?._expansionRow) continue
const fp = (h.text||'').trim().slice(0,80).toLowerCase()
if (!seen.has(fp)) { seen.add(fp); deduped.push(h) }
if (deduped.length >= 6) break
}
const maxTokens = 2200
let totalTokens = 0
const parts = []
for (let i=0; i<deduped.length; i++) {
const tokenBudget = i === 0 ? Math.min(900, maxTokens - totalTokens) : Math.min(650, maxTokens - totalTokens)
if (tokenBudget < 30) break
let header = `[S${i+1}]`
if (deduped[i].metadata?.section_heading) header += `[${deduped[i].metadata.section_heading.slice(0,50)}]`
if (deduped[i].metadata?.doc_type_hint) header += `[${deduped[i].metadata.doc_type_hint}]`
const charBudget = tokenBudget * 3.8
const text = (deduped[i].text||'').trim().slice(0, charBudget)
const usedTokens = estimateTokens(text)
parts.push(`${header}\n${text}`)
totalTokens += usedTokens + 5
}
return parts.join('\n---\n')
}
function buildSystemPrompt(intent, docType) {
const isPolicy = docType === 'policy' || ['policy_lookup','policy_consequence','policy_permission','policy_numeric'].includes(intent)
const isLegal = docType === 'legal'
if (isLegal) {
return `You are a legal document expert. Answer from context only. Be precise about obligations, penalties, dates, amounts, and conditions. 2-4 sentences. No source references. State exact numbers and timeframes.`
}
if (isPolicy) {
const rule = intent==='policy_consequence' ? 'State exact penalty, amount, timeframe, or procedure.' :
intent==='policy_permission' ? 'State clearly if permitted or prohibited and any conditions.' :
intent==='policy_numeric' ? 'State the exact number (days/months/amount/%). Do not approximate.' :
'Explain the relevant rule or requirement plainly.'
return `You are an HR/policy expert. Answer from context only. Plain language. 2-4 sentences max. No source references. If not found say so.\n${rule}`
}
if (docType === 'research') {
return `You are a research paper analyst. Answer from context only. State exact accuracy percentages, model names, and metrics. Be factual and precise. 2-4 sentences. No source references. Do not invent numbers.`
}
if (docType === 'technical') {
return `You are a technical documentation expert. Answer from context only. Be precise about APIs, configurations, and code. 2-4 sentences. No source references.`
}
const rule = intent==='definition' ? 'One sentence definition only. Bold name. No formula.' :
intent==='calculation' ? 'Output only: "**Formula for [Name]:** [formula]." Nothing else.' :
intent==='comparison' ? 'Bold each name. One definition each. End with "**Key Difference:**" sentence from context.' :
'Answer directly in 2-4 sentences.'
return `You are a document analysis expert. Answer from context only. Bold subject. Complete sentences. No source refs. If not found say so.\n${rule}`
}
function buildUserMessage(q, hits, intent, docType) {
const context = buildContext(hits, docType)
const subject = extractSubject(q)
const isPolicy = ['policy_lookup','policy_consequence','policy_permission','policy_numeric'].includes(intent)
let inst = ''
if (intent === 'definition' && docType !== 'policy' && docType !== 'research' && docType !== 'legal')
inst = `\nOne-sentence definition of "${subject}". Bold name. No formula.`
else if (intent === 'calculation')
inst = `\nReturn only: "**Formula for ${capFirst(subject)}:** [formula]."`
else if (intent === 'url_lookup')
inst = `\nReturn only the URL for "${extractUrlKeywords(q).join(' ')}".`
else if (intent === 'comparison')
inst = `\nCompare: ${q}. Bold each. Short definition each. "**Key Difference:**" at end.`
else if (isPolicy || docType === 'policy')
inst = `\nAnswer this policy question: "${q}". Specific and direct. State exact values. 2-4 sentences.`
else if (docType === 'legal')
inst = `\nAnswer this legal question: "${q}". State exact obligations, amounts, timeframes. 2-4 sentences.`
else if (docType === 'research')
inst = `\nAnswer from the research context: "${q}". State exact model names and accuracy percentages from the data. 2-4 sentences.`
else if (docType === 'technical')
inst = `\nAnswer from the technical documentation: "${q}". Be precise. 2-4 sentences.`
else
inst = `\nAnswer: ${q}. Only what was asked. 2-4 sentences.`
return `CONTEXT:\n${context}${inst}`
}
function isWeakAnswer(a) {
if (!a || a.trim().length < 15) return true
const weak = ['i could not find','no relevant information','not found in','i don\'t have','i don\'t see','unable to find','not mentioned','not present in','no information about','cannot find','does not contain','not available in','i couldn\'t find']
const l = a.toLowerCase().trim()
return weak.some(p => l.startsWith(p) || (l.length < 80 && l.includes(p)))
}
function extractAllUrlsFromChunks(chunks) {
const results = [], seen = new Set()
const urlRe = /https?:\/\/[^\s"'<>]+/g
for (const c of chunks) {
for (const line of (c.text||'').split('\n')) {
const urls = line.match(urlRe)
if (!urls) continue
for (const url of urls) {
const clean = url.replace(/[.,;)]+$/,'').trim()
if (!clean.startsWith('http') || seen.has(clean)) continue
seen.add(clean)
let name = 'Report'
const m = line.match(/^(?:Report URL|Power BI link)\s+for\s+(.+?)(?:\s*\([^)]+\))?\s*:\s*https?:/i)
if (m) name = m[1].trim()
else {
const before = line.slice(0, line.indexOf('http')).trim().replace(/\.\s*URL\s*:?\s*$/i,'').replace(/\s*:\s*$/,'').replace(/^(URL|Link|Dashboard|Report)\s*:?\s*/i,'').trim()
if (before.length > 1 && before.length < 120) name = before
}
results.push({name, url:clean})
}
}
}
return results
}
function buildFallbackAnswer(q, hits, intent, docType) {
if (!hits?.length) return "I could not find relevant information about this in your documents."
const subject = extractSubject(q)
const esc = escapeRegex(subject.toLowerCase())
const isPolicy = docType === 'policy' || docType === 'legal' || ['policy_lookup','policy_consequence','policy_permission','policy_numeric'].includes(intent)
if (intent === 'all_urls') {
const entries = extractAllUrlsFromChunks(hits)
return entries.length ? entries.map(e => `**${e.name}:** ${e.url}`).join('\n') : "No URLs found."
}
if (intent === 'url_lookup') {
const urlRe = /https?:\/\/[^\s"'<>]+/
const kws = extractUrlKeywords(q)
for (const h of hits) for (const line of (h.text||'').split('\n')) {
if (!urlRe.test(line)) continue
if (kws.some(w => line.toLowerCase().includes(w))) {
const m = line.match(urlRe)
if (m) return m[0].replace(/[.,;)]+$/,'').trim()
}
}
for (const h of hits) for (const line of (h.text||'').split('\n')) {
const m = line.match(urlRe)
if (m) return m[0].replace(/[.,;)]+$/,'').trim()
}
return "No matching URL found."
}
if (isPolicy || docType === 'research' || docType === 'technical') {
const lines = []
for (const h of hits) {
for (const line of (h.text||'').split(/\n+/)) {
if (line.trim().length < 20) continue
const relevant = docType === 'research'
? /\b(\d+\.?\d*\s*%?|accuracy|precision|recall|model|result)\b/i.test(line)
: /\b(shall|must|may|tenant|landlord|days?|months?|\d+|notice|deposit|rent|fee|penalty)\b/i.test(line)
if (relevant || new RegExp(`\\b${esc}\\b`,'i').test(line)) lines.push(line.trim())
}
}
if (lines.length) return ensureSinglePeriod(trimToCompleteSentence([...new Set(lines)].slice(0,3).join(' '), 600))
const excerpt = trimToCompleteSentence((hits[0]?.text||'').trim(), 500)
return excerpt.length > 30 ? ensureSinglePeriod(excerpt) : "I could not find specific information in your documents."
}
if (intent === 'calculation') {
for (const h of hits) {
if (h.metadata?.formula && new RegExp(`\\b${esc}\\b`,'i').test(h.metadata.measure||''))
return ensureSinglePeriod(`**Formula for ${capFirst(h.metadata.measure)}:** ${h.metadata.formula}.`)
for (const pat of [`how to calculate ${esc}:\\s*([^\\n]+)`, `formula for ${esc}:\\s*([^\\n]+)`]) {
const m = (h.text||'').match(new RegExp(pat,'im'))
if (m) return ensureSinglePeriod(`**Formula for ${capFirst(subject)}:** ${trimToCompleteSentence(m[1].trim(),300)}.`)
}
}
for (const h of hits) {
if (!new RegExp(`\\b${esc}\\b`,'i').test(h.text||'')) continue
const f = extractFormulaFromText(h.text||'')
if (f) return ensureSinglePeriod(`**Formula for ${capFirst(subject)}:** ${f}.`)
}
return `I could not find a formula for ${capFirst(subject)} in your documents.`
}
for (const h of hits) {
if (!h.metadata?.measure) continue
const ml = (h.metadata.measure||'').toLowerCase().trim()
if (ml === subject.toLowerCase() || new RegExp(`\\b${esc}\\b`,'i').test(ml)) {
const cap = capFirst(h.metadata.measure)
if (h.metadata.description) return ensureSinglePeriod(`**${cap}** is defined as: ${h.metadata.description}.`)
}
}
const synPat = new RegExp(`${esc}[^\\n]*is defined as:\\s*([^.\\n]+(?:\\.[^.\\n]+)?)(?:\\.\\s*Formula:\\s*([^.\\n]+))?`,'im')
for (const h of hits) {
const m = (h.text||'').match(synPat)
if (m) {
const desc = trimToCompleteSentence((m[1]||'').trim(), 500)
let ans = `**${capFirst(subject)}** is ${desc}`
if (!ans.endsWith('.')) ans += '.'
if (intent !== 'definition' && m[2]) ans += `\n\n**Formula:** ${m[2].trim().slice(0,300)}.`
return ensureSinglePeriod(ans)
}
}
const lines = []
for (const h of hits) for (const line of (h.text||'').split('\n')) {
if (!new RegExp(`\\b${esc}\\b`,'i').test(line) || line.trim().length <= 20) continue
if ((line.match(/\|/g)||[]).length > 2) continue
lines.push(line.trim().replace(/\(from\s+[A-Za-z\s]+\)/g,'').trim())
}
if (lines.length) return ensureSinglePeriod(`**${capFirst(subject)}:** ${trimToCompleteSentence([...new Set(lines)].slice(0,3).join(' '),600)}.`)
return "I could not find that specific information in your documents."
}
function cleanAnswer(raw) {
if (!raw) return ''
let c = fixBrokenUrls(raw)
.replace(/^\s*\[S?\s*\d+\][^\n]*\n?/gm, '')
.replace(/^[^\n]*(\|[^\n]*){3,}$/gm, '')
.replace(/=== .+ ===\s*/gm, '')
.replace(/\(from\s+[A-Za-z\s]+\)\s*/g, '')
.replace(/\n{3,}/g, '\n\n')
.replace(/\.{2,}/g, '.').replace(/\.\s*\./g, '.').trim()
const lastIdx = Math.max(c.lastIndexOf('. '),c.lastIndexOf('.\n'),c.lastIndexOf('! '),c.lastIndexOf('? '))
if (lastIdx > c.length*0.5) { const t = c.slice(0,lastIdx+1).trim(); if (t.length > 20) c = t }
if (c.length > 0 && !/[.!?]$/.test(c)) c += '.'
return ensureSinglePeriod(c)
}
const IN_FLIGHT = new Map()
let askedataActiveCount = 0
const ASKDATA_MAX_CONCURRENT = 3
const askedataQueue = []
function runWithAskedataLimit(fn) {
return new Promise((res, rej) => {
function tryRun() {
if (askedataActiveCount < ASKDATA_MAX_CONCURRENT) {
askedataActiveCount++
Promise.resolve().then(fn).then(
r => { askedataActiveCount--; drainAskedataQueue(); res(r) },
e => { askedataActiveCount--; drainAskedataQueue(); rej(e) }
)
} else askedataQueue.push(tryRun)
}
tryRun()
})
}
function drainAskedataQueue() { if (askedataQueue.length > 0 && askedataActiveCount < ASKDATA_MAX_CONCURRENT) askedataQueue.shift()() }
let askedataFailures = 0, askedataBlockedUntil = 0
function askedataCircuitOpen() {
if (Date.now() < askedataBlockedUntil) return true
if (askedataBlockedUntil > 0) { askedataBlockedUntil = 0; askedataFailures = 0 }
return false
}
function askedataRecordSuccess() { askedataFailures = 0; askedataBlockedUntil = 0 }
function askedataRecordFailure() { if (++askedataFailures >= 3) { askedataBlockedUntil = Date.now()+30000 } }
async function fetchWithTimeout(url, opts, ms) {
const ctrl = new AbortController()
const t = setTimeout(() => ctrl.abort(), ms)
try { return await fetch(url, {...opts, signal:ctrl.signal}) }
catch (e) { if (e.name==='AbortError') throw new Error(`Timed out after ${ms}ms`); throw e }
finally { clearTimeout(t) }
}
function withRequestTimeout(fn, ms=REQUEST_TIMEOUT_MS) {
return async (req, res, next) => {
let done = false
const t = setTimeout(() => { if (!done) { done=true; if (!res.headersSent) res.status(503).json({error:'Request timed out.'}) } }, ms)
try { await fn(req,res,next) } catch(e) { if (!done) next(e) } finally { done=true; clearTimeout(t) }
}
}
async function callASKDATA(sys, user, maxTokens=512) {
if (!ASKDATA_ENDPOINT || !ASKDATA_KEY) throw new Error('ASKDATA not configured')
if (askedataCircuitOpen()) throw new Error('ASKDATA circuit open')
return runWithAskedataLimit(async () => {
try {
const r = await fetchWithTimeout(ASKDATA_ENDPOINT, {
method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${ASKDATA_KEY}`},
body:JSON.stringify({model:ASKDATA_MODEL, messages:[{role:'system',content:sys},{role:'user',content:user}], temperature:0.1, max_tokens:maxTokens}),
}, ASKDATA_TIMEOUT_MS)
if (!r.ok) { const t=await r.text(); throw new Error(`ASKDATA ${r.status}: ${t}`) }
const d = await r.json(); askedataRecordSuccess()
return d.choices?.[0]?.message?.content || ''
} catch(e) { askedataRecordFailure(); throw e }
})
}
async function callASKDATA2(sys, user, maxTokens=512) {
if (!ASKDATA2_ENDPOINT || !ASKDATA2_KEY) throw new Error('ASKDATA2 not configured')
const r = await fetchWithTimeout(ASKDATA2_ENDPOINT, {
method:'POST',
headers:{'Content-Type':'application/json','Authorization':`Bearer ${ASKDATA2_KEY}`,'Accept':'application/json'},
body:JSON.stringify({model:ASKDATA2_MODEL, messages:[{role:'system',content:sys},{role:'user',content:user}], max_tokens:maxTokens, temperature:0.1, top_p:1.0, stream:false}),
}, ASKDATA2_TIMEOUT_MS)
if (!r.ok) { const t=await r.text(); throw new Error(`ASKDATA2 ${r.status}: ${t}`) }
const d = await r.json()
return d.choices?.[0]?.message?.content || ''
}
async function callBestAvailableEngine(sys, user, maxTokens=512) {
if (ASKDATA_ENDPOINT && ASKDATA_KEY && !askedataCircuitOpen()) {
try { const r = await callASKDATA(sys, user, maxTokens); if (r?.trim().length >= 15) return r } catch(e) { console.warn(`[ASKDATA] ${e.message}`) }
}
if (ASKDATA2_ENDPOINT && ASKDATA2_KEY) {
try { const r = await callASKDATA2(sys, user, maxTokens); if (r?.trim().length >= 15) return r } catch(e) { console.error(`[ASKDATA2] ${e.message}`) }
}
return ''
}
async function generateAnswerWithFallback(q, hits, intent, docType, chunks, invertedIndex, topK) {
const sys = buildSystemPrompt(intent, docType)
const user = buildUserMessage(q, hits, intent, docType)
let raw = ''
try { raw = await Promise.race([callBestAvailableEngine(sys, user, 500), new Promise((_,r) => setTimeout(() => r(new Error('timeout')), 40000))]) }
catch(e) { console.warn(`[genAnswer] ${e.message}`) }
if (!isWeakAnswer(raw)) return cleanAnswer(raw)
const exQ = (docType === 'policy' || docType === 'legal') ? expandQueryForPolicy(q) : q
let fbHits = await retrieveChunks(exQ, chunks, Math.min(topK*2, 14), invertedIndex, docType)
if (!fbHits.length) fbHits = relaxedKeywordSearch(exQ, chunks, 20, invertedIndex)
if (!fbHits.length) fbHits = hits
const fbSys = sys + '\nRECOVERY: Use semantically related terms. Synthesize from any relevant context.'
let fbRaw = ''
try { fbRaw = await Promise.race([callBestAvailableEngine(fbSys, buildUserMessage(q, fbHits, intent, docType), 500), new Promise((_,r) => setTimeout(() => r(new Error('timeout')), 25000))]) }
catch(e) { console.warn(`[genAnswer fallback] ${e.message}`) }
if (!isWeakAnswer(fbRaw)) return cleanAnswer(fbRaw)
const rule = buildFallbackAnswer(q, fbHits, intent, docType)
if (rule && !rule.toLowerCase().includes('could not find')) return rule
if (!isWeakAnswer(raw)) return cleanAnswer(raw)
return buildFallbackAnswer(q, hits, intent, docType)
}
async function generateAnswerForTopic(topic, chunks, topK, invertedIndex, docType) {
const tq = `what is ${topic}`
let hits = await retrieveChunks(tq, chunks, topK, invertedIndex, docType)
if (!hits.length) hits = relaxedKeywordSearch(tq, chunks, 20, invertedIndex)
if (!hits.length) return null
const ans = await generateAnswerWithFallback(tq, hits, 'definition', docType, chunks, invertedIndex, topK)
return ans && !/[.!?]$/.test(ans) ? ans+'.' : ans
}
async function generateComparisonAnswer(a, b, chunks, topK, invertedIndex, docType) {
const [hA, hB] = await Promise.all([
retrieveChunks(`what is ${a}`, chunks, topK, invertedIndex, docType),
retrieveChunks(`what is ${b}`, chunks, topK, invertedIndex, docType),
])
const seen = new Set(), deduped = []
for (const h of [...hA,...hB]) { const fp=(h.text||'').trim().slice(0,80).toLowerCase(); if (!seen.has(fp)) { seen.add(fp); deduped.push(h) } }
if (!deduped.length) return null
const ans = await generateAnswerWithFallback(`difference between ${a} and ${b}`, deduped, 'comparison', docType, chunks, invertedIndex, topK)
if (ans?.trim().length >= 15) return ans
const [ansA, ansB] = await Promise.all([generateAnswerForTopic(a,chunks,topK,invertedIndex,docType), generateAnswerForTopic(b,chunks,topK,invertedIndex,docType)])
return [
`**${capFirst(a)}:** ${ansA && !ansA.includes('could not find') ? ansA : `Not found.`}`,
`**${capFirst(b)}:** ${ansB && !ansB.includes('could not find') ? ansB : `Not found.`}`,
].join('\n\n')
}
async function handleMultiTopicQuery(topics, mode, chunks, topK, invertedIndex, docType) {
if (mode === 'comparison' && topics.length === 2) {
const ans = await generateComparisonAnswer(topics[0], topics[1], chunks, topK, invertedIndex, docType)
if (ans) return ans
}
const results = await Promise.all(topics.map(async t => ({t, ans: await generateAnswerForTopic(t,chunks,topK,invertedIndex,docType)})))
return results.map(({t,ans}) => {
const cap = capFirst(t)
return `**${cap}:**\n${(!ans || ans.includes('could not find')) ? `Not found for "${cap}".` : ans}`
}).join('\n\n')
}
async function extractPdf(buffer) { const r = await pdfParse(buffer); return r.text||'' }
function parseDocxXmlStructure(xmlBuffer) {
try {
const xmlStr = xmlBuffer.toString('utf-8')
const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const parser = new DOMParser()
const doc = parser.parseFromString(xmlStr, 'application/xml')
const body = doc.getElementsByTagNameNS(WNS, 'body')[0]
if (!body) return null
const paragraphs = []
const paras = body.getElementsByTagNameNS(WNS, 'p')
for (let i = 0; i < paras.length; i++) {
const p = paras[i]
const pPr = p.getElementsByTagNameNS(WNS, 'pPr')[0]
const pStyle = pPr ? pPr.getElementsByTagNameNS(WNS, 'pStyle')[0] : null
const styleVal = pStyle ? pStyle.getAttributeNS(WNS, 'val') || '' : ''
const runs = p.getElementsByTagNameNS(WNS, 'r')
let fullText = ''
let boldCount = 0
let totalRuns = 0
let maxSz = 12
for (let j = 0; j < runs.length; j++) {
const run = runs[j]
const tEls = run.getElementsByTagNameNS(WNS, 't')
let runText = ''
for (let k = 0; k < tEls.length; k++) runText += tEls[k].textContent || ''
if (!runText.trim()) continue
fullText += runText
totalRuns++
const rPr = run.getElementsByTagNameNS(WNS, 'rPr')[0]
if (rPr) {
const bEl = rPr.getElementsByTagNameNS(WNS, 'b')[0]
if (bEl) boldCount++
const szEl = rPr.getElementsByTagNameNS(WNS, 'sz')[0]
if (szEl) {
const szVal = parseInt(szEl.getAttributeNS(WNS, 'val') || '0') / 2
if (szVal > maxSz) maxSz = szVal
}
}
}
const text = fullText.trim()
if (!text) continue
const isAllBold = totalRuns > 0 && boldCount === totalRuns
const isMostlyBold = totalRuns > 0 && boldCount / totalRuns >= 0.75
const isNumberedSection = /^(\d+\.)+\s+\S|^[A-Z]\.\s+\S|^[IVX]+\.\s+\S/.test(text)
const isUpperCase = text.length > 3 && text === text.toUpperCase() && /[A-Z]/.test(text)
let headingLevel = 0
let headingReason = ''
if (/^heading(\d?)$/i.test(styleVal)) {
const lvl = parseInt(styleVal.replace(/heading/i,'')) || 1
headingLevel = lvl
headingReason = 'word_style'
} else if (/^title$/i.test(styleVal)) {
headingLevel = 1
headingReason = 'word_style_title'
} else if (/^subtitle$/i.test(styleVal)) {
headingLevel = 2
headingReason = 'word_style_subtitle'
} else if (maxSz >= 18 && isAllBold) {
headingLevel = 1
headingReason = 'font_size_bold'
} else if (maxSz >= 14 && isAllBold && text.length <= 120) {
headingLevel = 2
headingReason = 'font_size_bold'
} else if (maxSz >= 14 && isMostlyBold && text.length <= 100) {
headingLevel = 2
headingReason = 'font_size_mostly_bold'
} else if (isNumberedSection && (isAllBold || maxSz >= 13)) {
headingLevel = 3
headingReason = 'numbered_bold'
} else if (isUpperCase && text.length <= 80 && (maxSz >= 13 || isAllBold)) {
headingLevel = 2
headingReason = 'uppercase'
} else if (isNumberedSection && text.length <= 150) {
headingLevel = 3
headingReason = 'numbered_pattern'
}
paragraphs.push({ text, styleVal, maxSz, isAllBold, isMostlyBold, headingLevel, headingReason, isNumberedSection })
}
return paragraphs
} catch (e) {
console.warn('[parseDocxXmlStructure] error:', e.message)
return null
}
}
function structuredChunksFromParsedDocx(paragraphs, sourceFile, docTypeHint) {
const chunks = []
let chunkIndex = 0
const sections = []
let currentSection = { heading: '', headingLevel: 0, blocks: [] }
for (const para of paragraphs) {
if (para.headingLevel > 0) {
if (currentSection.blocks.length > 0 || currentSection.heading) {
sections.push(currentSection)
}
currentSection = { heading: para.text, headingLevel: para.headingLevel, blocks: [] }
} else {
currentSection.blocks.push(para.text)
}
}
if (currentSection.blocks.length > 0 || currentSection.heading) {
sections.push(currentSection)
}
const chunkSize = docTypeHint === 'research' ? RESEARCH_CHUNK_SIZE :
docTypeHint === 'legal' ? LEGAL_CHUNK_SIZE :
docTypeHint === 'policy' ? POLICY_CHUNK_SIZE :
docTypeHint === 'technical' ? TECH_CHUNK_SIZE : CHUNK_SIZE
const chunkOverlap = docTypeHint === 'research' ? RESEARCH_CHUNK_OVERLAP :
docTypeHint === 'legal' ? LEGAL_CHUNK_OVERLAP :
docTypeHint === 'policy' ? POLICY_CHUNK_OVERLAP :
docTypeHint === 'technical' ? TECH_CHUNK_OVERLAP : CHUNK_OVERLAP
const isResearchSection = (h) => /\b(abstract|introduction|background|methodology|method|result|discussion|conclusion|reference|literature|related\s+work|data\s+collection|preprocessing|training|evaluation|comparison)\b/i.test(h)
const isResultsSection = (h) => /\b(result|discussion|comparison|accuracy|performance|evaluation|model)\b/i.test(h)
for (let si = 0; si < sections.length; si++) {
const sec = sections[si]
const sectionText = [sec.heading, ...sec.blocks].filter(Boolean).join('\n\n').trim()
if (sectionText.length < 15) continue
const position = si < 3 ? 'early' : si > sections.length - 3 ? 'late' : 'middle'
const hasTable = /\|.*\|/.test(sectionText) || /S\.No|Sr\.No/i.test(sectionText)
const containsNumbers = /\b\d+\.?\d*\s*%/.test(sectionText)
const isDefinitionChunk = /\b(is defined as|means|refers to|is a|are a)\b/i.test(sectionText)
const isClauseChunk = /\b(shall|must|hereby|pursuant|notwithstanding|whereas|obligation)\b/i.test(sectionText)
const baseMetadata = {
section_heading: sec.heading || '',
heading_level: sec.headingLevel,
chunk_position: position,
is_definition_chunk: isDefinitionChunk,
is_clause_chunk: isClauseChunk,
is_results_section: isResultsSection(sec.heading),
is_research_section: isResearchSection(sec.heading),
contains_table: hasTable,
contains_numbers: containsNumbers,
doc_type_hint: docTypeHint || '',
source_file: sourceFile,
}
const tokenCount = estimateTokens(sectionText)
if (sectionText.length <= chunkSize && tokenCount <= MAX_TOKENS_PER_CHUNK) {
chunks.push({
text: sectionText,
source_file: sourceFile,
chunk_index: chunkIndex++,
embedding: [],
metadata: { ...baseMetadata }
})
} else {
const subChunks = semanticSplitWithOverlap(sectionText, chunkSize, chunkOverlap, sec.heading)
for (const sub of subChunks) {
if (estimateTokens(sub) > MAX_TOKENS_PER_CHUNK) {
const hardSubs = hardSplitByTokens(sub, MAX_TOKENS_PER_CHUNK)
for (const hs of hardSubs) {
chunks.push({
text: hs,
source_file: sourceFile,
chunk_index: chunkIndex++,
embedding: [],
metadata: { ...baseMetadata }
})
}
} else {
chunks.push({
text: sub,
source_file: sourceFile,
chunk_index: chunkIndex++,
embedding: [],
metadata: { ...baseMetadata }
})
}
}
}
}
return chunks
}
function semanticSplitWithOverlap(text, maxSize, overlap, sectionHeading) {
if (!text || text.length <= maxSize) return text.trim().length > 15 ? [text.trim()] : []
const tableBlocks = []
const tableRe = /(?:\|[^\n]+\|\n?){2,}/g
let tableMatch
const nonTableParts = []
let lastIdx = 0
while ((tableMatch = tableRe.exec(text)) !== null) {
if (tableMatch.index > lastIdx) {
nonTableParts.push({ type: 'text', content: text.slice(lastIdx, tableMatch.index), idx: lastIdx })
}
tableBlocks.push({ type: 'table', content: tableMatch[0].trim(), idx: tableMatch.index })
lastIdx = tableMatch.index + tableMatch[0].length
}
if (lastIdx < text.length) nonTableParts.push({ type: 'text', content: text.slice(lastIdx), idx: lastIdx })
const allParts = [...nonTableParts, ...tableBlocks].sort((a, b) => a.idx - b.idx)
const sentences = []
for (const part of allParts) {
if (part.type === 'table') {
sentences.push({ text: part.content, isTable: true })
} else {
const rawSents = part.content.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [part.content]
for (const s of rawSents) {
const t = s.trim()
if (t.length > 5) sentences.push({ text: t, isTable: false })
}
}
}
const out = []
let cur = sectionHeading ? [sectionHeading] : []
let curLen = sectionHeading ? sectionHeading.length + 2 : 0
let curTokens = sectionHeading ? estimateTokens(sectionHeading) : 0
for (const sent of sentences) {
const sLen = sent.text.length
const sTok = estimateTokens(sent.text)
const wouldExceedSize = curLen + sLen > maxSize
const wouldExceedTokens = curTokens + sTok > MAX_TOKENS_PER_CHUNK
if (sent.isTable) {
if (cur.length > 0) { out.push(cur.join('\n')); cur = sectionHeading ? [sectionHeading] : []; curLen = sectionHeading ? sectionHeading.length : 0; curTokens = sectionHeading ? estimateTokens(sectionHeading) : 0 }
const tableTokens = estimateTokens(sent.text)
if (tableTokens <= MAX_TOKENS_PER_CHUNK) {
out.push(sent.text)
} else {
out.push(sent.text.slice(0, MAX_TOKENS_PER_CHUNK * 3))
}
continue
}
if ((wouldExceedSize || wouldExceedTokens) && cur.length > 0) {
out.push(cur.join('\n'))
const overlapSents = []
let overlapLen = 0
for (let i = cur.length - 1; i >= 0; i--) {
const ol = cur[i].length
if (overlapLen + ol <= overlap) { overlapSents.unshift(cur[i]); overlapLen += ol }
else break
}
cur = sectionHeading ? [sectionHeading, ...overlapSents] : [...overlapSents]
curLen = cur.reduce((s, x) => s + x.length + 1, 0)
curTokens = estimateTokens(cur.join('\n'))
}
cur.push(sent.text)
curLen += sLen + 1
curTokens += sTok
}
if (cur.length > 0) {
const joined = cur.join('\n').trim()
if (joined.length > 15) out.push(joined)
}
return out.filter(s => s.trim().length > 15)
}
function hardSplitByTokens(text, maxTokens) {
const maxChars = maxTokens * 3.8
if (text.length <= maxChars) return [text]
const parts = []
let start = 0
while (start < text.length) {
let end = start + maxChars
if (end >= text.length) { parts.push(text.slice(start)); break }
const slice = text.slice(start, end)
const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'))
if (lastPeriod > maxChars * 0.5) end = start + lastPeriod + 1
else {
const lastSpace = slice.lastIndexOf(' ')
if (lastSpace > maxChars * 0.7) end = start + lastSpace
}
parts.push(text.slice(start, end).trim())
start = end
}
return parts.filter(p => p.trim().length > 15)
}
function detectDocTypeFromText(text, fileName) {
const name = (fileName||'').toLowerCase()
const s = text.slice(0, 5000).toLowerCase()
if (isResearchDocument(text, fileName)) return 'research'
if (isLegalDocument(text, fileName)) return 'legal'
if (isPolicyDocument(text, fileName)) return 'policy'
if (isTechnicalDocument(text, fileName)) return 'technical'
return 'general'
}
function isResearchDocument(text, fileName) {
const name = (fileName||'').toLowerCase()
if (/research|paper|study|survey|journal|conference|thesis|dissertation|preprint/i.test(name)) return true
const s = text.slice(0, 5000).toLowerCase()
let sig = 0
if (/\b(abstract|introduction|methodology|related\s+work|literature\s+review)\b/.test(s)) sig += 4
if (/\b(accuracy|precision|recall|f1.score|auc|roc|confusion\s+matrix)\b/.test(s)) sig += 4
if (/\b(neural\s+network|deep\s+learning|machine\s+learning|convolutional|classification|detection)\b/.test(s)) sig += 3
if (/\b(dataset|training\s+set|test\s+set|validation|epoch|batch\s+size)\b/.test(s)) sig += 3
if (/\b(et\s+al|doi:|arxiv|ieee|figure\s+\d|table\s+\d|references)\b/.test(s)) sig += 3
if (/\b(result|discussion|comparison)\b/.test(s)) sig += 2
if (/\b(model|algorithm|experiment|evaluation|performance)\b/.test(s)) sig += 2
return sig >= 7
}
function isLegalDocument(text, fileName) {
const name = (fileName||'').toLowerCase()
if (/contract|agreement|nda|mou|deed|lease|tenancy|license\s+agreement|service\s+agreement/i.test(name)) return true
const s = text.slice(0, 4000).toLowerCase()
let sig = 0
if (/\b(whereas|indemnif|hereinafter|jurisdiction|arbitration|governing\s+law|force\s+majeure)\b/.test(s)) sig += 4
if (/\b(party|parties|licensor|licensee|indemnify|warranty|representation|covenant)\b/.test(s)) sig += 3
if (/\b(intellectual\s+property|confidential|non.disclosure|limitation\s+of\s+liability)\b/.test(s)) sig += 3
if (/\b(executed|counterpart|entire\s+agreement|severability|waiver)\b/.test(s)) sig += 2
return sig >= 5
}
function isPolicyDocument(text, fileName) {
const name = (fileName||'').toLowerCase()
if (/policy|lease|terms|conditions|rules|manual|handbook|sop|compliance|procedure|offer|letter|hr|employee/i.test(name)) return true
const s = text.slice(0, 3000).toLowerCase()
let sig = 0
if (/\b(shall|must|hereby|pursuant|notwithstanding|whereas|thereof|herein)\b/.test(s)) sig += 3
if (/\b(tenant|landlord|lessee|lessor|party|parties|employee|employer)\b/.test(s)) sig += 2
if (/\b(clause|exhibit|addendum|schedule|section|article)\b/.test(s)) sig += 2
if (/\b(agreement|contract|policy|lease|terms|offer|salary|compensation|joining|probation)\b/.test(s)) sig += 2
if (/\b(security deposit|notice period|termination|eviction|maintenance|late fee|probation|benefits|ctc|gross\s+salary)\b/.test(s)) sig += 3
if (/^(section|article|clause|\d+\.\d+)\s/im.test(text.slice(0, 5000))) sig += 3
if (/\b(abstract|methodology|conclusion|accuracy|precision|recall|epoch|neural|figure|table\s+\d)\b/.test(s)) sig -= 3
return sig >= 4
}
function isTechnicalDocument(text, fileName) {
const name = (fileName||'').toLowerCase()
if (/api|sdk|readme|documentation|technical|spec|interface|module|library/i.test(name)) return true
const s = text.slice(0, 3000).toLowerCase()
let sig = 0
if (/\b(api|endpoint|function|parameter|configuration|module|sdk)\b/.test(s)) sig += 3
if (/\b(install|deploy|server|client|request|response|authentication|token)\b/.test(s)) sig += 2
if (/```|`[^`]+`|\bcode\b|\bsyntax\b/.test(s)) sig += 3
if (/\bget\b|\bpost\b|\bput\b|\bdelete\b|\bjson\b|\bhttp\b/i.test(s)) sig += 2
return sig >= 5
}
async function extractWordWithHeadings(buffer) {
const styleMap = [
"p[style-name='Heading 1'] => h1:fresh",
"p[style-name='Heading 2'] => h2:fresh",
"p[style-name='Heading 3'] => h3:fresh",
"p[style-name='Heading 4'] => h4:fresh",
"p[style-name='Title'] => h1:fresh",
"p[style-name='Subtitle'] => h2:fresh",
"p[style-name='heading 1'] => h1:fresh",
"p[style-name='heading 2'] => h2:fresh",
"p[style-name='heading 3'] => h3:fresh",
]
try {
const r = await mammoth.convertToHtml({ buffer, styleMap })
return { html: r.value||'', hasHeadings: /<h[1-4]>/i.test(r.value) }
} catch {
const r = await mammoth.extractRawText({ buffer })
return { html: r.value||'', hasHeadings: false }
}
}
async function parseDocxBuffer(buffer, fileName) {
const AdmZip = require('adm-zip')
try {
const zip = new AdmZip(buffer)
const docEntry = zip.getEntry('word/document.xml')
if (!docEntry) return null
const xmlBuffer = docEntry.getData()
return parseDocxXmlStructure(xmlBuffer)
} catch (e) {
console.warn('[parseDocxBuffer] zip parse failed:', e.message)
return null
}
}
async function chunkDocxBuffer(buffer, fileName) {
const paragraphs = await parseDocxBuffer(buffer, fileName)
if (paragraphs && paragraphs.length > 0) {
const fullText = paragraphs.map(p => p.text).join('\n')
const docTypeHint = detectDocTypeFromText(fullText, fileName)
const headingCount = paragraphs.filter(p => p.headingLevel > 0).length
if (headingCount >= 2) {
console.log(`[chunkDocx] xml-parse path: ${fileName} (${paragraphs.length} paras, ${headingCount} headings, type=${docTypeHint})`)
const chunks = structuredChunksFromParsedDocx(paragraphs, fileName, docTypeHint)
if (chunks.length > 0) return chunks
}
}
const { html, hasHeadings } = await extractWordWithHeadings(buffer)
if (!html?.trim()) return []
if (hasHeadings) {
console.log(`[chunkDocx] mammoth heading path: ${fileName}`)
const chunks = htmlToStructuredChunks(html, fileName)
if (chunks.length > 0) return chunks
}
const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
if (!plainText) return []
const docTypeHint2 = detectDocTypeFromText(plainText, fileName)
console.log(`[chunkDocx] plain-text fallback: ${fileName} (type=${docTypeHint2})`)
if (docTypeHint2 === 'research') return chunkResearchDocument(plainText, fileName)
if (docTypeHint2 === 'legal') return chunkPlainText(plainText, fileName, LEGAL_CHUNK_SIZE, LEGAL_CHUNK_OVERLAP, true)
if (docTypeHint2 === 'policy') return chunkPlainText(plainText, fileName, POLICY_CHUNK_SIZE, POLICY_CHUNK_OVERLAP, true)
if (docTypeHint2 === 'technical') return chunkPlainText(plainText, fileName, TECH_CHUNK_SIZE, TECH_CHUNK_OVERLAP, false)
return chunkPlainText(plainText, fileName, CHUNK_SIZE, CHUNK_OVERLAP, false)
}
function htmlToStructuredChunks(html, sourceFile) {
const chunks = []
let chunkIndex = 0
const headingRe = /<(h[1-4])>(.*?)<\/h[1-4]>/gi
const tagStripRe = /<[^>]+>/g
const decode = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(n)).replace(/&quot;/g,'"')
let lastIndex = 0, currentHeading = '', currentLevel = 0
let match
headingRe.lastIndex = 0
const sections = []
while ((match = headingRe.exec(html)) !== null) {
if (lastIndex < match.index) sections.push({ heading: currentHeading, level: currentLevel, content: html.slice(lastIndex, match.index) })
currentHeading = decode(match[2].replace(tagStripRe,'').trim())
currentLevel = parseInt(match[1][1])
lastIndex = match.index + match[0].length
}
if (lastIndex < html.length) sections.push({ heading: currentHeading, level: currentLevel, content: html.slice(lastIndex) })
const plainText = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')
const docTypeHint = detectDocTypeFromText(plainText, sourceFile)
const chunkSize = docTypeHint === 'research' ? RESEARCH_CHUNK_SIZE :
docTypeHint === 'legal' ? LEGAL_CHUNK_SIZE :
docTypeHint === 'policy' ? POLICY_CHUNK_SIZE :
docTypeHint === 'technical' ? TECH_CHUNK_SIZE : CHUNK_SIZE
const chunkOverlap = docTypeHint === 'research' ? RESEARCH_CHUNK_OVERLAP :
docTypeHint === 'legal' ? LEGAL_CHUNK_OVERLAP :
docTypeHint === 'policy' ? POLICY_CHUNK_OVERLAP :
docTypeHint === 'technical' ? TECH_CHUNK_OVERLAP : CHUNK_OVERLAP
for (const sec of sections) {
const text = decode(sec.content.replace(/<\/?(p|li|br|div|ul|ol|td|tr)[^>]*>/gi,'\n').replace(tagStripRe,'').replace(/\n{3,}/g,'\n\n').trim())
if (text.length < 20) continue
const fullText = sec.heading ? `${sec.heading}\n${text}` : text
const isResultsSec = /\b(result|discussion|comparison|accuracy|performance|evaluation)\b/i.test(sec.heading)
const isResearchSec = /\b(abstract|introduction|background|methodology|method|result|discussion|conclusion|reference|literature)\b/i.test(sec.heading)
const hasTable = /\|.*\|/.test(fullText)
if (estimateTokens(fullText) <= MAX_TOKENS_PER_CHUNK && fullText.length <= chunkSize) {
chunks.push({ text: fullText, source_file: sourceFile, chunk_index: chunkIndex++, embedding: [], metadata: { section_heading: sec.heading||'', heading_level: sec.level, is_definition_chunk: /\b(is defined as|means|refers to)\b/i.test(fullText), is_results_section: isResultsSec, is_research_section: isResearchSec, contains_table: hasTable, doc_type_hint: docTypeHint, chunk_position: chunkIndex < 3 ? 'early' : 'middle' } })
} else {
const subs = semanticSplitWithOverlap(fullText, chunkSize, chunkOverlap, sec.heading)
for (const sub of subs) {
if (estimateTokens(sub) > MAX_TOKENS_PER_CHUNK) {
for (const hs of hardSplitByTokens(sub, MAX_TOKENS_PER_CHUNK)) {
chunks.push({ text: hs, source_file: sourceFile, chunk_index: chunkIndex++, embedding: [], metadata: { section_heading: sec.heading||'', heading_level: sec.level, is_definition_chunk: /\b(is defined as|means|refers to)\b/i.test(hs), is_results_section: isResultsSec, is_research_section: isResearchSec, contains_table: hasTable, doc_type_hint: docTypeHint, chunk_position: 'middle' } })
}
} else {
chunks.push({ text: sub, source_file: sourceFile, chunk_index: chunkIndex++, embedding: [], metadata: { section_heading: sec.heading||'', heading_level: sec.level, is_definition_chunk: /\b(is defined as|means|refers to)\b/i.test(sub), is_results_section: isResultsSec, is_research_section: isResearchSec, contains_table: hasTable, doc_type_hint: docTypeHint, chunk_position: 'middle' } })
}
}
}
}
return chunks
}
function chunkPlainText(text, sourceFile, chunkSize, overlap, isPolicy) {
const chunks = [], blocks = text.replace(/\r\n/g,'\n').split(/\n{2,}/).map(b=>b.trim()).filter(b=>b.length>0)
let buf=[], bufLen=0, bufTokens=0, idx=0
function flush() {
const s = buf.join('\n\n')
if (s.length >= 30 && estimateTokens(s) <= MAX_TOKENS_PER_CHUNK) {
chunks.push({ text:s, source_file:sourceFile, chunk_index:idx++, embedding:[], metadata:{ is_definition_chunk:/\b(is defined as|means|refers to)\b/i.test(s), is_clause_chunk:/\b(shall|must|hereby|pursuant)\b/i.test(s), contains_table:/\|.*\|/.test(s), chunk_position:chunks.length<3?'early':'middle' } })
} else if (estimateTokens(s) > MAX_TOKENS_PER_CHUNK) {
for (const hs of hardSplitByTokens(s, MAX_TOKENS_PER_CHUNK)) {
chunks.push({ text:hs, source_file:sourceFile, chunk_index:idx++, embedding:[], metadata:{ is_definition_chunk:/\b(is defined as|means|refers to)\b/i.test(hs), chunk_position:'middle' } })
}
}
buf=[]; bufLen=0; bufTokens=0
}
for (const block of blocks) {
const blockTok = estimateTokens(block)
if (block.length > chunkSize*1.5 || blockTok > MAX_TOKENS_PER_CHUNK) {
if (buf.length) flush()
const subs = semanticSplitWithOverlap(block, chunkSize, overlap, '')
for (const sub of subs) {
if (estimateTokens(sub) > MAX_TOKENS_PER_CHUNK) {
for (const hs of hardSplitByTokens(sub, MAX_TOKENS_PER_CHUNK)) {
chunks.push({text:hs,source_file:sourceFile,chunk_index:idx++,embedding:[],metadata:{chunk_position:'middle'}})
}
} else {
chunks.push({text:sub,source_file:sourceFile,chunk_index:idx++,embedding:[],metadata:{chunk_position:'middle'}})
}
}
continue
}
const proj = bufLen + (bufLen?2:0) + block.length
const projTok = bufTokens + blockTok
if (buf.length && (proj > chunkSize || projTok > MAX_TOKENS_PER_CHUNK)) {
const last=buf[buf.length-1]||''; flush()
if(last){buf.push(last);bufLen=last.length;bufTokens=estimateTokens(last)}
}
buf.push(block); bufLen+=(bufLen?2:0)+block.length; bufTokens+=blockTok
}
if (buf.length) flush()
return chunks
}
function chunkResearchDocument(text, sourceFile) {
const secPat = /^(?:(?:Abstract|Introduction|Background|Related\s+Work|Literature\s+Review|Methodology|Methods?|Proposed\s+(?:Method|Model|Approach|Framework)|(?:Experimental\s+)?(?:Results?|Evaluation|Discussion)|Conclusion|References?|Acknowledgements?|Appendix)\s*\n|(?:\d+\.?\s+[A-Z][A-Za-z\s]{3,})\n)/gm
const matches=[]
let m
while ((m=secPat.exec(text))!==null) matches.push({index:m.index,heading:m[0].trim()})
if (matches.length < 2) return chunkPlainText(text, sourceFile, RESEARCH_CHUNK_SIZE, RESEARCH_CHUNK_OVERLAP, false)
const chunks=[]
let idx=0
for (let i=0;i<matches.length;i++) {
const start=matches[i].index, end=i+1<matches.length?matches[i+1].index:text.length
const sec=text.slice(start,end).trim()
if (sec.length<30) continue
const pos=i<2?'early':i>matches.length-2?'late':'middle'
const isResultsSec = /\b(result|discussion|comparison|accuracy|evaluation)\b/i.test(matches[i].heading)
if (estimateTokens(sec) <= MAX_TOKENS_PER_CHUNK && sec.length <= RESEARCH_CHUNK_SIZE) {
chunks.push({text:sec,source_file:sourceFile,chunk_index:idx++,embedding:[],metadata:{section_heading:matches[i].heading,is_research_section:true,is_results_section:isResultsSec,contains_table:/\|.*\|/.test(sec),chunk_position:pos}})
} else {
for (const sub of semanticSplitWithOverlap(sec, RESEARCH_CHUNK_SIZE, RESEARCH_CHUNK_OVERLAP, matches[i].heading)) {
if (estimateTokens(sub) > MAX_TOKENS_PER_CHUNK) {
for (const hs of hardSplitByTokens(sub, MAX_TOKENS_PER_CHUNK)) {
chunks.push({text:hs,source_file:sourceFile,chunk_index:idx++,embedding:[],metadata:{section_heading:matches[i].heading,is_research_section:true,is_results_section:isResultsSec,chunk_position:pos}})
}
} else {
chunks.push({text:sub,source_file:sourceFile,chunk_index:idx++,embedding:[],metadata:{section_heading:matches[i].heading,is_research_section:true,is_results_section:isResultsSec,contains_table:/\|.*\|/.test(sub),chunk_position:pos}})
}
}
}
}
return chunks.length ? chunks : chunkPlainText(text, sourceFile, RESEARCH_CHUNK_SIZE, RESEARCH_CHUNK_OVERLAP, false)
}
async function chunkPdfBuffer(buffer, fileName) {
const text = await extractPdf(buffer)
if (!text?.trim()) return []
const docTypeHint = detectDocTypeFromText(text, fileName)
console.log(`[chunkPdf] ${fileName} type=${docTypeHint}`)
if (docTypeHint === 'research') return chunkResearchDocument(text, fileName)
if (docTypeHint === 'legal') return chunkPlainText(text, fileName, LEGAL_CHUNK_SIZE, LEGAL_CHUNK_OVERLAP, true)
if (docTypeHint === 'policy') return chunkPlainText(text, fileName, POLICY_CHUNK_SIZE, POLICY_CHUNK_OVERLAP, true)
if (docTypeHint === 'technical') return chunkPlainText(text, fileName, TECH_CHUNK_SIZE, TECH_CHUNK_OVERLAP, false)
return chunkPlainText(text, fileName, CHUNK_SIZE, CHUNK_OVERLAP, false)
}
function extractSpreadsheet(buffer) {
const wb = XLSX.read(buffer, {type:'buffer',cellNF:true})
const rows = []
for (const sheetName of wb.SheetNames) {
const sheet = wb.Sheets[sheetName]
const raw = XLSX.utils.sheet_to_json(sheet, {defval:'',header:1,raw:false})
if (!raw.length) continue
let hIdx = -1
for (let i=0;i<Math.min(15,raw.length);i++) {
const cells = raw[i].map(c=>String(c).trim()).filter(Boolean)
if (cells.length >= 2 && cells.filter(c=>c.length<=60).length >= 2) { hIdx=i; break }
}
if (hIdx===-1) hIdx=0
const rawH = raw[hIdx].map(h=>String(h).trim())
const headers = []
let lastNB = ''
for (const h of rawH) { if(h!==''){lastNB=h;headers.push(h)} else headers.push(lastNB||`Col${headers.length+1}`) }
const scoreH = (h, pats) => { const l=h.toLowerCase().trim(); for(const [r,s] of pats) if(r.test(l)) return s; return 0 }
const hPats = {
name: [[/\b(measure|attribute|field|metric|kpi)\s*name\b/,100],[/^name$/,90],[/\bname\b/,70]],
table: [[/\b(table|module|category|group|domain|section)\b/,100],[/^table$/,90]],
description: [[/\b(description|desc|definition|about|summary)\b/,100]],
formula: [[/\b(formula|calculation|calc|how\s+calculated|computed\s+as)\b/,100]],
url: [[/\b(url|link|href|report\s+link|dashboard)\b/,100]],
additional: [[/\b(additional|extra|notes?|info|configuration)\b/,100]],
}
const colIdx = {}
for (const [field,pats] of Object.entries(hPats)) {
const best = headers.map((h,i)=>({i,s:scoreH(h,pats)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s)[0]
if (best) colIdx[field]=best.i
}
let emitted=0
for (let i=hIdx+1;i<raw.length;i++) {
const row=raw[i]
if (!row.some(c=>String(c).trim()!=='')) continue
const cells=row.map(c=>String(c||'').replace(/\r?\n/g,' ').trim())
const name=colIdx.name!==undefined?(cells[colIdx.name]||'').trim():''
const table=colIdx.table!==undefined?(cells[colIdx.table]||'').trim():sheetName
const desc=colIdx.description!==undefined?(cells[colIdx.description]||'').trim():''
const url=colIdx.url!==undefined?(cells[colIdx.url]||'').trim():''
const add=colIdx.additional!==undefined?(cells[colIdx.additional]||'').trim():''
let formula=colIdx.formula!==undefined?(cells[colIdx.formula]||'').trim():''
if (!formula && desc) {
for (const p of [/(.*?\/.*?)/i,/(=.*?)/i,/(calculated\s+as.*)/i,/(divided\s+by.*)/i,/(sum\s+of.*)/i]) {
const m=desc.match(p); if(m?.[0]?.trim().length>3){formula=m[0].trim();break}
}
}
if (name) {
let syn=`${name}`
if(table&&table!==sheetName) syn+=` (${table})`
if(desc) syn+=` is defined as: ${desc}`
if(formula&&!desc.toLowerCase().includes(formula.toLowerCase())) syn+=`. Formula: ${formula}`
if(add) syn+=`. Additional Info: ${add}`
if(url) syn+=`. URL: ${url}`
rows.push({text:syn,metadata:{measure:name,table:table||sheetName,formula:formula||'',description:desc||'',url:url||'',sourceSheet:sheetName,_expansionRow:false}})
if(formula) {
rows.push({text:`How to calculate ${name}: ${formula}`,metadata:{measure:name,table:table||sheetName,formula,description:desc||'',url:'',sourceSheet:sheetName,_expansionRow:true}})
rows.push({text:`Formula for ${name}: ${formula}`,metadata:{measure:name,table:table||sheetName,formula,description:desc||'',url:'',sourceSheet:sheetName,_expansionRow:true}})
}
if(url) {
rows.push({text:`Report URL for ${name}: ${url}`,metadata:{measure:name,table:table||sheetName,formula:'',description:'',url,sourceSheet:sheetName,_expansionRow:true}})
rows.push({text:`Power BI link for ${name}: ${url}`,metadata:{measure:name,table:table||sheetName,formula:'',description:'',url,sourceSheet:sheetName,_expansionRow:true}})
}
emitted++
} else if(desc) {
rows.push({text:desc,metadata:{measure:'',table:table||sheetName,formula:'',description:desc,url:'',sourceSheet:sheetName,_expansionRow:false}})
}
}
if (!emitted) {
for (let i=hIdx+1;i<raw.length;i++) {
const cells=raw[i].map(c=>String(c||'').trim()).filter(Boolean)
if(cells.length) rows.push({text:cells.join(' | '),metadata:{measure:'',table:sheetName,formula:'',description:'',url:'',sourceSheet:sheetName,_expansionRow:false}})
}
}
}
return rows
}
async function extractTextFromBuffer(buffer, fileName) {
const ext = ('.'+fileName.split('.').pop()).toLowerCase()
if (ext==='.pdf') return extractPdf(buffer)
if (ext==='.csv') { const t=buffer.toString('utf-8'); const r=Papa.parse(t,{header:true,skipEmptyLines:true}); return r.data?.length ? r.data.map((row,i)=>`Row ${i+1}: `+Object.entries(row).map(([k,v])=>`${k}=${v}`).join(' | ')).join('\n') : t }
if (ext==='.json') { try{return JSON.stringify(JSON.parse(buffer.toString('utf-8')),null,2)}catch{return buffer.toString('utf-8')} }
if (ext==='.txt') return buffer.toString('utf-8')
return ''
}
async function downloadBlobAsBuffer(containerClient, blobName) {
const dl = await containerClient.getBlobClient(blobName).download()
const parts = []
for await (const c of dl.readableStreamBody) parts.push(Buffer.isBuffer(c)?c:Buffer.from(c))
return Buffer.concat(parts)
}
async function _doLoadChunks(clientId) {
if (!blobServiceClient) throw new Error('AZURE_CONNECTION_STRING not set')
const container = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME)
const prefix = `${RAW_PREFIX}/${clientId}/`
const blobNames = []
for await (const blob of container.listBlobsFlat({prefix})) {
const ext=('.'+blob.name.split('.').pop()).toLowerCase()
if (SUPPORTED_EXTENSIONS.has(ext)) blobNames.push(blob.name)
}
const allChunks = []
let offset = 0
for (let i=0; i<blobNames.length; i+=BLOB_CONCURRENCY) {
const batch = blobNames.slice(i, i+BLOB_CONCURRENCY)
const results = await Promise.allSettled(batch.map(async blobName => {
const fileName = blobName.split('/').pop()
const ext = ('.'+fileName.split('.').pop()).toLowerCase()
const buffer = await downloadBlobAsBuffer(container, blobName)
if (ext==='.xlsx') {
return extractSpreadsheet(buffer).map((r,idx)=>({text:r.text,source_file:fileName,chunk_index:idx,embedding:[],metadata:r.metadata||null}))
}
if (ext==='.docx') {
return chunkDocxBuffer(buffer, fileName)
}
if (ext==='.pdf') {
return chunkPdfBuffer(buffer, fileName)
}
const text = await extractTextFromBuffer(buffer, fileName)
if (!text?.trim()) return []
const docTypeHint = detectDocTypeFromText(text, fileName)
if (docTypeHint === 'research') return chunkResearchDocument(text, fileName)
if (docTypeHint === 'legal') return chunkPlainText(text, fileName, LEGAL_CHUNK_SIZE, LEGAL_CHUNK_OVERLAP, true)
if (docTypeHint === 'policy') return chunkPlainText(text, fileName, POLICY_CHUNK_SIZE, POLICY_CHUNK_OVERLAP, true)
if (docTypeHint === 'technical') return chunkPlainText(text, fileName, TECH_CHUNK_SIZE, TECH_CHUNK_OVERLAP, false)
return chunkPlainText(text, fileName, CHUNK_SIZE, CHUNK_OVERLAP, false)
}))
for (const r of results) {
if (r.status==='fulfilled') { r.value.forEach((c,i)=>{c.chunk_index=offset+i}); offset+=r.value.length; allChunks.push(...r.value) }
else console.warn('[loadChunks] blob failed:', r.reason?.message)
}
}
return allChunks
}
const CHUNK_CACHE = new Map()
async function loadChunksForClient(clientId) {
const now = Date.now()
const cached = CHUNK_CACHE.get(clientId)
if (cached?.chunks) {
if (now - cached.ts <= CHUNK_CACHE_TTL) return cached
if (!cached.loading) {
const p = _doLoadChunks(clientId).then(chunks => {
const invertedIndex=buildInvertedIndex(chunks), docType=detectDocumentType(chunks)
CHUNK_CACHE.set(clientId,{chunks,invertedIndex,docType,ts:Date.now(),loading:null})
}).catch(e => { const ex=CHUNK_CACHE.get(clientId); if(ex) CHUNK_CACHE.set(clientId,{...ex,loading:null}); console.warn(`[cache refresh] ${clientId}: ${e.message}`) })
CHUNK_CACHE.set(clientId,{...cached,loading:p})
}
return cached
}
if (cached?.loading) { await cached.loading; return CHUNK_CACHE.get(clientId) }
const p = _doLoadChunks(clientId).then(chunks => {
const invertedIndex=buildInvertedIndex(chunks), docType=detectDocumentType(chunks)
CHUNK_CACHE.set(clientId,{chunks,invertedIndex,docType,ts:Date.now(),loading:null})
return chunks
}).catch(e => { CHUNK_CACHE.set(clientId,{chunks:null,invertedIndex:null,docType:'mixed',ts:0,loading:null}); throw e })
CHUNK_CACHE.set(clientId,{chunks:null,invertedIndex:null,docType:'mixed',ts:0,loading:p})
await p
return CHUNK_CACHE.get(clientId)
}
function invalidateChunkCache(clientId) { CHUNK_CACHE.delete(clientId) }
function warmupChunkCaches() {
if (!WARMUP_CLIENT_IDS.length || !blobServiceClient) return
for (const id of WARMUP_CLIENT_IDS) loadChunksForClient(id).then(({chunks})=>console.log(`[warmup] ${id}: ${chunks.length} chunks`)).catch(e=>console.warn(`[warmup] ${id}: ${e.message}`))
}
function computeKeywordRelevanceScore(subjectWords, chunk) {
const measure=(chunk.metadata?.measure||'').toLowerCase()
const desc=(chunk.metadata?.description||'').toLowerCase()
const text=(chunk.text||'').toLowerCase()
const sp=subjectWords.join(' ')
if (measure===sp) return 0
let s=0
s+=subjectWords.filter(w=>new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(measure)).length*15
if (subjectWords.every(w=>new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(measure))&&measure!==sp) s+=20
s+=subjectWords.filter(w=>new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(desc)).length*3
s+=subjectWords.filter(w=>new RegExp(`\\b${escapeRegex(w)}\\b`,'i').test(text)).length
return s
}
function buildRelatedKeywords(subject, hits, chunks, invertedIndex, topN=RELATED_KEYWORDS_COUNT) {
const sl=subject.toLowerCase().trim()
const sw=sl.replace(/[^\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2)
if (!sw.length) return []
const primaryKeys=new Set(hits.map(h=>h.metadata?.measure?.toLowerCase().trim()).filter(Boolean))
const cands=new Map(), seen=new Set([sl])
for (const c of chunks) {
if (!c.metadata?.measure||c.metadata._expansionRow) continue
const ml=c.metadata.measure.trim().toLowerCase()
if (seen.has(ml)) continue
seen.add(ml)
const score=computeKeywordRelevanceScore(sw,c)
if (score<RELATED_KEYWORDS_MIN_SCORE) continue
const ex=cands.get(ml)
if (!ex||score>ex.score) cands.set(ml,{keyword:c.metadata.measure,score,table:c.metadata.table||'',description:c.metadata.description||'',formula:c.metadata.formula||'',isPrimary:primaryKeys.has(ml)})
}
const sorted=[...cands.values()].sort((a,b)=>b.isPrimary!==a.isPrimary?(b.isPrimary?1:-1):b.score-a.score).slice(0,topN)
const max=sorted[0]?.score||1
return sorted.map(item=>({keyword:item.keyword,table:item.table,description:item.description?trimPreviewToSentence(item.description,120):'',formula:item.formula?trimPreviewToSentence(item.formula,100):'',confidenceScore:Math.min(100,Math.round(item.score/Math.max(max,1)*100)),isPrimaryHit:item.isPrimary}))
}
let db=null
async function getDb() {
if (db) return db
const client=new MongoClient(MONGODB_URI)
await client.connect()
db=client.db(MONGODB_DB)
await db.collection('clients').createIndex({apiKey:1},{unique:true,sparse:true})
return db
}
let chatDb=null
async function getChatDb() {
if (chatDb) return chatDb
const client=new MongoClient(CHAT_HISTORY_URI||MONGODB_URI)
await client.connect()
chatDb=client.db(CHAT_HISTORY_DB)
return chatDb
}
const CLIENT_CACHE=new Map(), CACHE_TTL_MS=5*60*1000
function getCached(k) { const e=CLIENT_CACHE.get(k); if(!e||Date.now()-e.cachedAt>CACHE_TTL_MS){if(e)CLIENT_CACHE.delete(k);return null}; return e }
function setCache(k,d) { CLIENT_CACHE.set(k,{...d,cachedAt:Date.now()}) }
function evictCache(k) { if(k) CLIENT_CACHE.delete(k) }
async function verifyApiKey(apiKey) {
if (!apiKey?.startsWith('rak_')) return null
const cached=getCached(apiKey)
if (cached) return {clientId:cached.clientId,name:cached.name}
const database=await getDb()
const client=await database.collection('clients').findOne({apiKey},{projection:{clientId:1,name:1,_id:0}})
if (!client) return null
setCache(apiKey,{clientId:client.clientId,name:client.name})
return {clientId:client.clientId,name:client.name}
}
function startApiKeyHealthChecker() {
if (!MONGODB_URI) return
setInterval(async () => {
const keys=[...CLIENT_CACHE.keys()]
if (!keys.length) return
try {
const database=await getDb()
const valid=new Set((await database.collection('clients').find({apiKey:{$in:keys}},{projection:{apiKey:1,_id:0}}).toArray()).map(d=>d.apiKey))
for (const k of keys) if(!valid.has(k)) evictCache(k)
} catch {}
}, KEY_CHECK_INTERVAL_MS)
}
function extractApiKey(req) { const h=req.headers['authorization']||''; return h.startsWith('Bearer ')?h.slice(7).trim():null }
async function requireClientKey(req,res,next) {
const k=extractApiKey(req)||req.body?.apiKey
if (!k) return res.status(401).json({error:'Missing API key'})
const client=await verifyApiKey(k)
if (!client) return res.status(401).json({error:'Invalid or expired API key'})
req.client=client; next()
}
function requireAdminKey(req,res,next) {
const k=extractApiKey(req)
if (!k||k!==ADMIN_API_KEY) return res.status(401).json({error:'Unauthorized'})
next()
}
function generateApiKey() { return `rak_${crypto.randomBytes(32).toString('hex')}` }
function generateTitle(q) { const c=q.trim().replace(/[?!.]+$/,''); return c.length>50?c.slice(0,50)+'...':c }
async function saveConversationMessage(clientId, conversationId, q, answer, sources) {
try {
const db2=await getChatDb(), col=db2.collection('conversations'), now=new Date()
const userMsg={role:'user',content:q,timestamp:now}
const aMsg={role:'assistant',content:answer,sources:sources.map(s=>({source_file:s.source_file,score:s.score})),timestamp:now}
let activeId=conversationId||null
if (activeId) {
const upd=await col.findOneAndUpdate({_id:new ObjectId(activeId),clientId},{$push:{messages:{$each:[userMsg,aMsg]}},$set:{updatedAt:now}},{returnDocument:'after',projection:{_id:1}})
if (!upd) activeId=null
}
if (!activeId) {
const r=await col.insertOne({clientId,title:generateTitle(q),messages:[userMsg,aMsg],createdAt:now,updatedAt:now})
activeId=r.insertedId.toString()
}
return activeId
} catch(e) { console.warn('[saveConversationMessage]',e.message); return conversationId||null }
}
function buildDedupedSources(hits) {
const seen=new Set(), out=[]
for (const h of hits) {
if (h.metadata?._expansionRow) continue
const key = h.metadata?.measure ? `measure:${h.metadata.measure.toLowerCase().trim()}` :
h.metadata?.url ? `url:${h.metadata.url.toLowerCase().trim()}` :
`text:${(h.text||'').trim().slice(0,80).toLowerCase()}`
if (seen.has(key)) continue
seen.add(key)
out.push({source_file:h.source_file||'unknown',chunk_index:h.chunk_index??0,score:typeof h._score==='number'?parseFloat(h._score.toFixed(4)):null,measure:h.metadata?.measure||null,table:h.metadata?.table||null,preview:trimPreviewToSentence(h.text||'',200)})
}
return out
}
app.get('/health', (req,res) => res.json({ok:true,service:'ask-data',chunkCacheSize:CHUNK_CACHE.size,responseCacheSize:RESPONSE_CACHE.size,circuitOpen:askedataCircuitOpen()}))
app.post('/client/verify', async (req,res) => {
try {
const k=extractApiKey(req)||req.body?.apiKey
if (!k) return res.status(400).json({valid:false,error:'apiKey required'})
const client=await verifyApiKey(k)
if (!client) return res.status(401).json({valid:false,error:'Invalid key'})
res.json({valid:true,client})
} catch(e){res.status(500).json({valid:false,error:e.message})}
})
app.post('/admin/clients', requireAdminKey, async (req,res) => {
try {
let {name,clientId,apiKey}=req.body
if (!name||!clientId) return res.status(400).json({error:'name and clientId required'})
if (!apiKey) apiKey=generateApiKey()
else if (!apiKey.startsWith('rak_')) return res.status(400).json({error:'apiKey must start with "rak_"'})
const database=await getDb(), col=database.collection('clients')
const existing=await col.findOne({$or:[{clientId},{apiKey}]})
if (existing) return res.status(409).json({error:`Conflict on ${existing.clientId===clientId?'clientId':'apiKey'}`})
const now=new Date().toISOString()
const doc={name:name.trim(),clientId:clientId.trim().toLowerCase(),apiKey,apiKeyRotatedAt:now,folderLink:'',sourceType:'google-drive',status:'idle',documentsCount:0,autoSync:false,watchIntervalMs:300000,lastRunAt:null,lastError:null,createdAt:now,updatedAt:now}
const r=await col.insertOne(doc)
res.status(201).json({...doc,_id:r.insertedId})
} catch(e){res.status(500).json({error:e.message})}
})
app.get('/admin/clients', requireAdminKey, async (req,res) => {
try { const db2=await getDb(); res.json({clients:await db2.collection('clients').find({},{projection:{apiKey:0}}).sort({createdAt:-1}).toArray()}) }
catch(e){res.status(500).json({error:e.message})}
})
app.get('/admin/clients/:clientId', requireAdminKey, async (req,res) => {
try {
const db2=await getDb(), client=await db2.collection('clients').findOne({clientId:req.params.clientId})
if (!client) return res.status(404).json({error:'Not found'})
res.json(client)
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/admin/clients/:clientId/regenerate-key', requireAdminKey, async (req,res) => {
try {
const db2=await getDb(), col=db2.collection('clients')
const old=await col.findOne({clientId:req.params.clientId},{projection:{apiKey:1}})
if (!old) return res.status(404).json({error:'Not found'})
const newKey=generateApiKey(), now=new Date().toISOString()
if (old.apiKey) evictCache(old.apiKey)
await col.findOneAndUpdate({clientId:req.params.clientId},{$set:{apiKey:newKey,apiKeyRotatedAt:now,updatedAt:now}})
res.json({success:true,clientId:req.params.clientId,newApiKey:newKey,apiKeyRotatedAt:now})
} catch(e){res.status(500).json({error:e.message})}
})
app.patch('/admin/clients/:clientId', requireAdminKey, async (req,res) => {
try {
const db2=await getDb()
const updates={...req.body,updatedAt:new Date().toISOString()}
if (updates.apiKey!==undefined) {
if (!updates.apiKey.startsWith('rak_')) return res.status(400).json({error:'apiKey must start with "rak_"'})
const old=await db2.collection('clients').findOne({clientId:req.params.clientId},{projection:{apiKey:1}})
if (old?.apiKey) evictCache(old.apiKey)
updates.apiKeyRotatedAt=new Date().toISOString()
}
const r=await db2.collection('clients').findOneAndUpdate({clientId:req.params.clientId},{$set:updates},{returnDocument:'after'})
if (!r) return res.status(404).json({error:'Not found'})
res.json(r)
} catch(e){res.status(500).json({error:e.message})}
})
app.delete('/admin/clients/:clientId', requireAdminKey, async (req,res) => {
try {
const {clientId}=req.params, db2=await getDb()
const client=await db2.collection('clients').findOne({clientId})
if (!client) return res.status(404).json({error:'Not found'})
if (client.apiKey) evictCache(client.apiKey)
await db2.collection('clients').deleteOne({clientId})
invalidateChunkCache(clientId)
const deleted=[], failed=[]
if (blobServiceClient) {
try {
const container=blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME)
for (const pfx of [`raw/${clientId}/`,`meta/${clientId}/`]) {
for await (const blob of container.listBlobsFlat({prefix:pfx})) {
try { await container.deleteBlob(blob.name); deleted.push(blob.name) }
catch(e){ failed.push({name:blob.name,error:e.message}) }
}
}
} catch(e){ failed.push({name:'azure',error:e.message}) }
}
res.json({ok:true,deleted:clientId,blobsDeleted:deleted.length,blobsFailed:failed.length?failed:undefined})
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/admin/clients/:clientId/invalidate-cache', requireAdminKey, (req,res) => {
invalidateChunkCache(req.params.clientId)
RESPONSE_CACHE.clear()
res.json({ok:true,clientId:req.params.clientId})
})
app.post('/client/login', async (req,res) => {
try {
const k=extractApiKey(req)||req.body?.apiKey
if (!k) return res.status(400).json({error:'apiKey required'})
const client=await verifyApiKey(k)
if (!client) return res.status(401).json({error:'Invalid key'})
if (blobServiceClient) loadChunksForClient(client.clientId).catch(e=>console.warn(`[login warmup] ${e.message}`))
res.json({ok:true,client})
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/login', async (req,res) => {
try {
const k=extractApiKey(req)||req.body?.apiKey
if (!k) return res.status(400).json({error:'apiKey required'})
const client=await verifyApiKey(k)
if (!client) return res.status(401).json({error:'Invalid key'})
if (blobServiceClient) loadChunksForClient(client.clientId).catch(e=>console.warn(`[chat/login warmup] ${e.message}`))
res.json({ok:true,client})
} catch(e){res.status(500).json({error:e.message})}
})
app.get('/client/me', requireClientKey, async (req,res) => {
try {
const db2=await getDb(), client=await db2.collection('clients').findOne({clientId:req.client.clientId},{projection:{apiKey:0}})
if (!client) return res.status(404).json({error:'Not found'})
res.json(client)
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/conversations', requireClientKey, async (req,res) => {
try {
const db2=await getChatDb(), now=new Date()
const conv={clientId:req.client.clientId,title:req.body.title||'New Conversation',messages:[],createdAt:now,updatedAt:now}
const r=await db2.collection('conversations').insertOne(conv)
res.status(201).json({...conv,_id:r.insertedId})
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/conversations/list', requireClientKey, async (req,res) => {
try {
const db2=await getChatDb()
res.json({conversations:await db2.collection('conversations').find({clientId:req.client.clientId},{projection:{messages:0}}).sort({updatedAt:-1}).toArray()})
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/conversations/get', requireClientKey, async (req,res) => {
try {
const {conversationId}=req.body
if (!conversationId) return res.status(400).json({error:'conversationId required'})
const db2=await getChatDb()
const conv=await db2.collection('conversations').findOne({_id:new ObjectId(conversationId),clientId:req.client.clientId})
if (!conv) return res.status(404).json({error:'Not found'})
res.json(conv)
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/conversations/rename', requireClientKey, async (req,res) => {
try {
const {conversationId,title}=req.body
if (!conversationId||!title) return res.status(400).json({error:'conversationId and title required'})
const db2=await getChatDb()
const r=await db2.collection('conversations').findOneAndUpdate({_id:new ObjectId(conversationId),clientId:req.client.clientId},{$set:{title:title.trim(),updatedAt:new Date()}},{returnDocument:'after',projection:{messages:0}})
if (!r) return res.status(404).json({error:'Not found'})
res.json(r)
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/conversations/delete', requireClientKey, async (req,res) => {
try {
const {conversationId}=req.body
if (!conversationId) return res.status(400).json({error:'conversationId required'})
const db2=await getChatDb()
const r=await db2.collection('conversations').deleteOne({_id:new ObjectId(conversationId),clientId:req.client.clientId})
if (r.deletedCount===0) return res.status(404).json({error:'Not found'})
res.json({ok:true,deleted:conversationId})
} catch(e){res.status(500).json({error:e.message})}
})
app.post('/chat/message', requireClientKey, withRequestTimeout(async (req,res) => {
try {
const {query, topK=5, conversationId}=req.body
if (!query?.trim()) return res.status(400).json({error:'query required'})
const {clientId,name}=req.client
const intentResult=resolveIntent(query.trim())
if (intentResult) {
const cid=await saveConversationMessage(clientId,conversationId||null,query.trim(),intentResult.response,[])
return res.json({answer:intentResult.response,sources:[],relatedKeywords:[],conversationId:cid,client:{clientId,name}})
}
const val=validateQuery(query)
if (!val.valid) return res.json({answer:val.message,sources:[],relatedKeywords:[],conversationId:conversationId||null,client:{clientId,name}})
const cacheKey=getCacheKey(clientId,query)
const cached=responseCacheGet(cacheKey)
if (cached) {
const cid=await saveConversationMessage(clientId,conversationId||null,query.trim(),cached.answer,cached.sources||[])
return res.json({...cached,cached:true,conversationId:cid})
}
if (IN_FLIGHT.has(cacheKey)) {
try { const r=await IN_FLIGHT.get(cacheKey); const cid=await saveConversationMessage(clientId,conversationId||null,query.trim(),r.answer,r.sources||[]); return res.json({...r,conversationId:cid}) } catch {}
}
const reqPromise=(async()=>{
const {chunks,invertedIndex,docType}=await loadChunksForClient(clientId)
if (!chunks?.length) return {answer:'No documents found. Please ingest documents first.',sources:[],relatedKeywords:[],client:{clientId,name}}
let pq=applyTypos(query.trim())
pq=applySynonyms(pq)
pq=fuzzyCorrectQuery(pq,chunks)
pq=await preprocessQuery(pq)
const eDocType=docType||'mixed'
const eIntent=detectQueryIntent(pq)
if (eIntent==='all_urls') {
const uc=chunks.filter(c=>/https?:\/\/\S+/.test(c.text||''))
const entries=extractAllUrlsFromChunks(uc)
return {answer:entries.length?entries.map(e=>`**${e.name}:** ${e.url}`).join('\n'):'No URLs found.',sources:buildDedupedSources(uc.slice(0,5)),relatedKeywords:[],client:{clientId,name}}
}
const multi=detectMultiTopicQuery(pq)
if (multi.isMulti) {
const answer=await handleMultiTopicQuery(multi.topics,multi.mode,chunks,Math.min(topK,MAX_HITS_GLOBAL),invertedIndex,eDocType)
return {answer,sources:[],relatedKeywords:[],client:{clientId,name}}
}
let hits=await retrieveChunks(pq,chunks,Math.min(topK,MAX_HITS_GLOBAL),invertedIndex,eDocType)
if (!hits.length) hits=relaxedKeywordSearch(pq,chunks,32,invertedIndex)
if (!hits.length) return {answer:'I could not find relevant information. Try rephrasing your question.',sources:[],relatedKeywords:[],client:{clientId,name}}
const answer=await generateAnswerWithFallback(pq,hits,eIntent,eDocType,chunks,invertedIndex,Math.min(topK,MAX_HITS_GLOBAL))
const sources=buildDedupedSources(hits)
const related=buildRelatedKeywords(extractSubject(pq),hits,chunks,invertedIndex,RELATED_KEYWORDS_COUNT)
return {answer,sources,relatedKeywords:related,client:{clientId,name}}
})()
IN_FLIGHT.set(cacheKey,reqPromise)
let result
try { result=await reqPromise } finally { IN_FLIGHT.delete(cacheKey) }
if (result.answer?.length>15) responseCacheSet(cacheKey,result)
const cid=await saveConversationMessage(clientId,conversationId||null,query.trim(),result.answer,result.sources||[])
res.json({...result,conversationId:cid})
} catch(e){ console.error('[chat/message]',e.message); if(!res.headersSent) res.status(500).json({error:e.message}) }
}))
app.use((err,req,res,next) => { console.error('[global error]',err); if(!res.headersSent) res.status(500).json({error:'Unexpected error.'}) })
if (process.env.VERCEL!=='1') {
const PORT=process.env.PORT||4000
app.listen(PORT,()=>{
console.log(`Service on port ${PORT}`)
startApiKeyHealthChecker()
warmupChunkCaches()
})
} else {
console.log('Running on Vercel')
}
module.exports = app
