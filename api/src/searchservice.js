'use strict'

const SEARXNG_BASE_URL = (process.env.SEARXNG_URL || 'https://askdatasearchengine.nicesky-18da433c.centralindia.azurecontainerapps.io').replace(/\/+$/, '')
const SEARXNG_TIMEOUT_MS = parseInt(process.env.SEARXNG_TIMEOUT_MS || '18000', 10)

const STRIP_PREFIXES = /^(what\s+(is|are|was|were)\s+(the\s+)?(definition\s+(of|for)\s+)?|define\s+|explain\s+|tell\s+me\s+(about\s+)?|how\s+(is|are|do\s+you\s+)?calculate(\s+the)?\s+|describe\s+|meaning\s+of\s+)/i

function cleanQueryText(text) {
  return (text || '').trim().replace(STRIP_PREFIXES, '').replace(/[?!.]+$/, '').trim()
}

function generateExampleSearchQuery(question, answer) {
  const base = cleanQueryText(question)
  return base ? `${base} example` : 'example'
}

async function fetchSearXNG(query, timeoutMs) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language: 'en',
    safesearch: '0',
    categories: 'general',
  })

  const url = `${SEARXNG_BASE_URL}/search?${params.toString()}`
  console.log(`[searchService] URL: ${url}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AskData-RAG-Bot/1.0',
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`SearXNG returned HTTP ${res.status}: ${body.slice(0, 200)}`)
    }

    const data = await res.json()
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function searchExamples(query) {
  console.log(`[searchService] Querying SearXNG: "${query}"`)

  let lastErr
  // Try twice — first attempt may hit a cold-start on Azure Container App
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await fetchSearXNG(query, SEARXNG_TIMEOUT_MS)
      const results = parseSearXNGResults(data)
      console.log(`[searchService] Got ${results.length} results for: "${query}" (attempt ${attempt})`)
      return results
    } catch (err) {
      if (err.name === 'AbortError') {
        lastErr = new Error(`SearXNG timed out after ${SEARXNG_TIMEOUT_MS}ms (attempt ${attempt})`)
      } else {
        lastErr = new Error(`SearXNG request failed: ${err.message}`)
      }
      console.warn(`[searchService] Attempt ${attempt} failed: ${lastErr.message}`)
      // Only retry on timeout, not on HTTP errors
      if (err.name !== 'AbortError') break
      // Wait 2s before retry
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
    }
  }

  throw lastErr
}

function parseSearXNGResults(data) {
  if (!data || !Array.isArray(data.results)) return []

  return data.results
    .filter(r => r.url && r.title)
    .slice(0, 5)
    .map(r => ({
      title:   (r.title   || '').trim(),
      url:     (r.url     || '').trim(),
      content: (r.content || r.snippet || '').trim(),
    }))
}

module.exports = { searchExamples, generateExampleSearchQuery }
