'use strict'
const { search } = require('duck-duck-scrape')
const STRIP_PREFIXES = /^(what\s+(is|are|was|were)\s+(the\s+)?(definition\s+(of|for)\s+)?|define\s+|explain\s+|tell\s+me\s+(about\s+)?|how\s+(is|are|do\s+you\s+)?calculate(\s+the)?\s+|describe\s+|meaning\s+of\s+)/i
function cleanQueryText(text) {
  return (text || '').trim().replace(STRIP_PREFIXES, '').replace(/[?!.]+$/, '').trim()
}

function generateExampleSearchQuery(question /*, answer — unused */) {
  const base = cleanQueryText(question)
  return base ? `${base} example` : 'example'
}

async function searchExamples(query) {
  console.log(`[searchService] Querying DuckDuckGo: "${query}"`)

  let searchResults
  try {
    searchResults = await search(query, {
      safeSearch: 'MODERATE',
    })
  } catch (err) {
    const msg = `DuckDuckGo search failed: ${err.message}`
    console.error(`[searchService] ${msg}`)
    throw new Error(msg)
  }

  if (!searchResults || !searchResults.results) {
    throw new Error('DuckDuckGo returned an empty response')
  }

  const results = searchResults.results.slice(0, 5).map(item => ({
    title:   (item.title       || '').trim(),
    url:     (item.url         || '').trim(),
    content: (item.description || '').trim(),
  }))

  console.log(`[searchService] Got ${results.length} results for: "${query}"`)
  return results
}

module.exports = { searchExamples, generateExampleSearchQuery }
