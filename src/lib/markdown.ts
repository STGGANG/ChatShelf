import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { ChatAsset, MessageHighlight } from '../types'

marked.use({
  breaks: true,
  gfm: true,
})

function escapeMarkdownText(value: string) {
  return value.replace(/[[\]\\]/g, '\\$&')
}

export function withImagePlaceholders(text: string, assets: ChatAsset[]) {
  if (!assets.length) return text

  const assetMap = new Map(
    assets.map((asset) => [asset.filename.toLocaleLowerCase(), asset]),
  )

  return text.replace(/\{\{img::([^}]+)\}\}/g, (raw, fileName: string) => {
    const cleanName = String(fileName).trim()
    const asset =
      assetMap.get(cleanName.toLocaleLowerCase()) ??
      assetMap.get(cleanName.split('/').pop()?.toLocaleLowerCase() ?? '')

    if (!asset) return raw

    return `\n\n![${escapeMarkdownText(cleanName)}](${asset.dataUrl})\n\n`
  })
}

export function renderMarkdown(text: string, assets: ChatAsset[]) {
  const prepared = withImagePlaceholders(text, assets)
  const html = marked.parse(prepared, { async: false }) as string

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  })
}

export function stripMarkdownForSnippet(text: string) {
  return text
    .replace(/\{\{img::([^}]+)\}\}/g, '$1')
    .replace(/```/g, '')
    .replace(/[#*_`>\-[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface TextNodePosition {
  node: Text
  start: number
  end: number
}

/**
 * Collect the rendered text of an element and remember which text node each
 * character came from. We skip characters that already sit inside a highlight
 * mark we created so multiple highlights do not stack on top of each other.
 */
function collectTextNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const positions: TextNodePosition[] = []
  let full = ''

  let current = walker.nextNode()
  while (current) {
    const textNode = current as Text
    let insideManagedMark = false
    let ancestor: Node | null = textNode.parentNode
    while (ancestor && ancestor !== root) {
      if (
        ancestor instanceof HTMLElement &&
        ancestor.dataset.hlManaged === 'true'
      ) {
        insideManagedMark = true
        break
      }
      ancestor = ancestor.parentNode
    }

    if (!insideManagedMark) {
      const value = textNode.nodeValue ?? ''
      positions.push({
        node: textNode,
        start: full.length,
        end: full.length + value.length,
      })
      full += value
    }
    current = walker.nextNode()
  }

  return { positions, full }
}

/**
 * Build a whitespace-free version of the rendered text plus a map back to the
 * original character offsets. Ignoring whitespace entirely lets a highlight
 * match even when the selection crossed line breaks, <br> tags, or markdown
 * markers, where the rendered DOM has no matching whitespace character.
 */
function buildStripped(full: string) {
  let norm = ''
  const startMap: number[] = []
  const endMap: number[] = []

  for (let i = 0; i < full.length; i += 1) {
    const char = full[i]
    if (/\s/.test(char)) continue
    norm += char
    startMap.push(i)
    endMap.push(i + 1)
  }

  return { norm, startMap, endMap }
}

/**
 * Pick a readable text color (near-black or near-white) for a given highlight
 * background so bright highlights get dark text and dark highlights get light
 * text automatically.
 */
export function readableTextColor(background: string) {
  let hex = background.trim().replace('#', '')
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (hex.length !== 6) return '#1c1c1c'
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const toLinear = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  return luminance > 0.5 ? '#1c1c1c' : '#f7f5f0'
}

function wrapRange(
  positions: TextNodePosition[],
  fullStart: number,
  fullEnd: number,
  makeMark: () => HTMLElement,
) {
  let wrapped = false
  for (const position of positions) {
    const overlapStart = Math.max(fullStart, position.start)
    const overlapEnd = Math.min(fullEnd, position.end)
    if (overlapStart >= overlapEnd) continue

    const localStart = overlapStart - position.start
    const localEnd = overlapEnd - position.start
    const range = document.createRange()
    try {
      range.setStart(position.node, localStart)
      range.setEnd(position.node, localEnd)
      range.surroundContents(makeMark())
      wrapped = true
    } catch {
      // The text node may be invalid in rare cases; skip rather than throw.
    }
  }
  return wrapped
}

export function applyHighlightsToElement(
  root: HTMLElement,
  highlights: MessageHighlight[],
  fallbackColor: string,
) {
  const prepared = highlights
    .map((highlight) => ({
      ...highlight,
      needle: highlight.text.replace(/\s+/g, '').toLocaleLowerCase(),
    }))
    .filter((highlight) => highlight.needle.length >= 1)
    .sort((a, b) => b.needle.length - a.needle.length)

  for (const highlight of prepared) {
    const needle = highlight.needle
    const isSearch = highlight.id.startsWith('search-')
    const color = highlight.color ?? fallbackColor

    // Highlight one occurrence at a time, re-scanning after each wrap so that
    // repeated phrases and overlapping highlights don't corrupt the DOM.
    let guard = 0
    while (guard < 500) {
      guard += 1
      const { positions, full } = collectTextNodes(root)
      if (!full) break
      const { norm, startMap, endMap } = buildStripped(full)
      const found = norm.toLocaleLowerCase().indexOf(needle)
      if (found < 0) break
      const fullStart = startMap[found]
      const fullEnd = endMap[found + needle.length - 1]
      if (fullStart === undefined || fullEnd === undefined) break

      const wrapped = wrapRange(positions, fullStart, fullEnd, () => {
        const mark = document.createElement('mark')
        mark.dataset.hlManaged = 'true'
        if (isSearch) {
          mark.className = 'search-hit'
        } else {
          mark.style.backgroundColor = color
          mark.style.color = readableTextColor(color)
        }
        return mark
      })
      if (!wrapped) break
    }
  }
}
