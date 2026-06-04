'use strict'

const axios = require('axios')

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://searchxngaskdata.jollywave-6f5db9ec.centralindia.azurecontainerapps.io'

const SEARXNG_TIMEOUT_MS = parseInt(process.env.SEARXNG_TIMEOUT_MS || '8000', 10)

const DOMAIN_EXPANSIONS = [
  { pattern: /\boccupancy\b/i, suffix: 'rate property management' },
  { pattern: /\bgl\s*activity\b/i, prefix: 'general ledger activity accounting' },
  { pattern: /\bgeneral\s*ledger\b/i, suffix: 'accounting entries' },
  { pattern: /\bkpi\b/i, suffix: 'key performance indicator examples' },
  { pattern: /\bebitda?\b/i, suffix: 'accounting formula examples' },
  { pattern: /\b(noi|net\s*operating\s*income)\b/i, suffix: 'real estate examples' },
  { pattern: /\b(arr|mrr)\b/i, suffix: 'recurring revenue saas examples' },
  { pattern: /\bcac\b/i, prefix: 'customer acquisition cost', suffix: 'marketing examples' },
  { pattern: /\bltv\b/i, prefix: 'customer lifetime value', suffix: 'examples' },
  { pattern: /\bchurn\b/i, suffix: 'rate calculation examples' },
  { pattern: /\bconversion\s*rate\b/i, suffix: 'marketing funnel examples' },
  { pattern: /\bpayroll\b/i, suffix: 'processing examples hr' },
  { pattern: /\b(capex|capital\s*expenditure)\b/i, suffix: 'accounting examples' },
  { pattern: /\b(opex|operating\s*expense)\b/i, suffix: 'business examples' },
  { pattern: /\brent\s*roll\b/i, suffix: 'property management report examples' },
  { pattern: /\bvacancy\b/i, suffix: 'rate real estate examples' },
  { pattern: /\b(p&l|profit\s*and\s*loss|income\s*statement)\b/i, suffix: 'report examples' },
  { pattern: /\bbalance\s*sheet\b/i, suffix: 'accounting examples' },
  { pattern: /\bcash\s*flow\b/i, suffix: 'statement examples' },
  { pattern: /\bdso\b/i, prefix: 'days sales outstanding', suffix: 'accounts receivable examples' },
  { pattern: /\bdpo\b/i, prefix: 'days payable outstanding', suffix: 'accounts payable examples' },
]

const STRIP_PREFIXES = /^(what\s+(is|are|was|were)\s+(the\s+)?(definition\s+(of|for)\s+)?|define\s+|explain\s+|tell\s+me\s+(about\s+)?|how\s+(is|are|do\s+you\s+)?calculate(\s+the)?\s+|describe\s+|meaning\s+of\s+)/i

function cleanQueryText(text) {
  return text.trim().replace(STRIP_PREFIXES, '').replace(/[?!.]+$/, '').trim()
}

function generateExampleSearchQuery(question, answer) {
  const base = cleanQueryText(question || '')

  for (const rule of DOMAIN_EXPANSIONS) {
    if (rule.pattern.test(base)) {
      const parts = []
      if (rule.prefix) parts.push(rule.prefix)
      else parts.push(base)
      parts.push(rule.suffix || 'examples')
      return parts.join(' ')
    }
  }

  if (answer && answer.length > 30) {
    const firstSentence = answer.split(/[.\n]/)[0] || ''
    const keyWords = firstSentence
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 4)
      .join(' ')

    if (keyWords.length > 5) {
      return `${base} ${keyWords} examples`.trim()
    }
  }

  return `${base} examples guide`
}

async function searchExamples(query) {
  console.log(`[searchService] Querying SearXNG: "${query}"`)

  const response = await axios.get(`${SEARXNG_URL}/search`, {
    params: {
      q: query,
      format: 'json',
    },
    timeout: SEARXNG_TIMEOUT_MS,
    headers: {
      Accept: 'application/json',
    },
  })

  const rawResults = response.data?.results || []

  const results = rawResults.slice(0, 5).map(item => ({
    title: (item.title || '').trim(),
    url: (item.url || '').trim(),
    content: (item.content || item.snippet || '').trim(),
  }))

  console.log(`[searchService] Got ${results.length} results for: "${query}"`)

  return results
}

module.exports = { searchExamples, generateExampleSearchQuery }
