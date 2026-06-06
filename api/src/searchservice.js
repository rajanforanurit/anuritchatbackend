'use strict'
const axios = require('axios')

const SEARXNG_URL = process.env.SEARXNG_URL || 'https://searchxngaskdata.jollywave-6f5db9ec.centralindia.azurecontainerapps.io'
const SEARXNG_TIMEOUT_MS = parseInt(process.env.SEARXNG_TIMEOUT_MS || '8000', 10)

const STRIP_PREFIXES = /^(what\s+(is|are|was|were)\s+(the\s+)?(definition\s+(of|for)\s+)?|define\s+|explain\s+|tell\s+me\s+(about\s+)?|how\s+(is|are|do\s+you\s+)?calculate(\s+the)?\s+|describe\s+|meaning\s+of\s+)/i

function cleanQueryText(text) {
  return (text || '').trim().replace(STRIP_PREFIXES, '').replace(/[?!.]+$/, '').trim()
}

// Simple: strip question wording, append " example"
function generateExampleSearchQuery(question /*, answer — unused */) {
  const base = cleanQueryText(question)
  return base ? `${base} example` : 'example'
}

async function searchExamples(query) {
  console.log(`[searchService] Querying SearXNG: "${query}"`)

  let response
  try {
    response = await axios.get(`${SEARXNG_URL}/search`, {
      params: {
        q: query,
        format: 'json',
        categories: 'general',
      },
      timeout: SEARXNG_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AskData/1.0',
      },
    })
  } catch (err) {
    const status = err.response?.status
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message
    const msg = status
      ? `SearXNG returned HTTP ${status}: ${detail}`
      : `SearXNG request failed: ${err.message}`
    console.error(`[searchService] ${msg}`)
    throw new Error(msg)
  }
  if (!response.data) {
    throw new Error('SearXNG returned an empty response body')
  }
  const rawResults = response.data.results || []
  const results = rawResults.slice(0, 5).map(item => ({
    title:   (item.title   || '').trim(),
    url:     (item.url     || '').trim(),
    content: (item.content || item.snippet || '').trim(),
  }))
  console.log(`[searchService] Got ${results.length} results for: "${query}"`)
  return results
}

module.exports = { searchExamples, generateExampleSearchQuery }
