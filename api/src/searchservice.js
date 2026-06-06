'use strict'

const DDGO_TIMEOUT_MS = parseInt(process.env.DDGO_TIMEOUT_MS || '8000', 10)

const STRIP_PREFIXES = /^(what\s+(is|are|was|were)\s+(the\s+)?(definition\s+(of|for)\s+)?|define\s+|explain\s+|tell\s+me\s+(about\s+)?|how\s+(is|are|do\s+you\s+)?calculate(\s+the)?\s+|describe\s+|meaning\s+of\s+)/i

function cleanQueryText(text) {
  return (text || '').trim().replace(STRIP_PREFIXES, '').replace(/[?!.]+$/, '').trim()
}

function generateExampleSearchQuery(question) {
  const base = cleanQueryText(question)
  return base ? `${base} example` : 'example'
}

async function searchExamples(query) {
  console.log(`[searchService] Querying DuckDuckGo HTML: "${query}"`)

  const params = new URLSearchParams({
    q: query,
    kl: 'us-en',
    kp: '-1',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DDGO_TIMEOUT_MS)

  let html = ''
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Referer': 'https://duckduckgo.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    })

    if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`)
    html = await res.text()
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`DuckDuckGo timed out after ${DDGO_TIMEOUT_MS}ms`)
    throw new Error(`DuckDuckGo request failed: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }

  const results = parseDDGHtml(html)
  console.log(`[searchService] Got ${results.length} results for: "${query}"`)
  return results
}

function parseDDGHtml(html) {
  const results = []

  // Each result block: <div class="result results_links...">
  const resultBlockRe = /<div[^>]+class="[^"]*result[^"]*results_links[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi
  // Fallback simpler block pattern
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i
  const urlDisplayRe = /<span[^>]+class="[^"]*result__url[^"]*"[^>]*>([\s\S]*?)<\/span>/i

  // Primary approach: find all result__title links + adjacent snippets
  const titleMatches = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]

  for (const match of titleMatches) {
    if (results.length >= 5) break

    let url = (match[1] || '').trim()
    const rawTitle = (match[2] || '').replace(/<[^>]+>/g, '').trim()

    // DDG sometimes wraps URLs in a redirect — extract real URL
    if (url.includes('//duckduckgo.com/l/?')) {
      const uddMatch = url.match(/uddg=([^&]+)/)
      if (uddMatch) {
        try { url = decodeURIComponent(uddMatch[1]) } catch { /* keep original */ }
      }
    }

    if (!url.startsWith('http') || !rawTitle) continue

    // Try to grab snippet from nearby HTML
    const matchIndex = match.index || 0
    const nearby = html.slice(matchIndex, matchIndex + 1500)
    const snippetMatch = nearby.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
      : ''

    results.push({
      title: rawTitle.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
      url,
      content: snippet,
    })
  }

  return results.slice(0, 5)
}

module.exports = { searchExamples, generateExampleSearchQuery }
