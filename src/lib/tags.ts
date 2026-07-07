import type { ParsedTag, TextParts } from '../types'

const tagPattern = /<([A-Za-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1>/g

function makeId() {
  return crypto.randomUUID?.() ?? `tag-${Date.now()}-${Math.random()}`
}

export function parseTagFields(body: string) {
  const fields: Record<string, string> = {}
  const chunks = body
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)

  for (const chunk of chunks) {
    const divider = chunk.indexOf('=')
    if (divider <= 0) continue
    const key = chunk.slice(0, divider).trim()
    const value = chunk.slice(divider + 1).trim()
    if (key) fields[key] = value
  }

  return fields
}

export function splitTaggedText(text: string): TextParts {
  const tags: ParsedTag[] = []
  const segments: TextParts['segments'] = []
  const bodyParts: string[] = []
  let cursor = 0

  for (const match of text.matchAll(tagPattern)) {
    const raw = match[0]
    const name = match[1]
    const index = match.index ?? cursor
    const before = text.slice(cursor, index)
    if (before) {
      bodyParts.push(before)
      if (before.trim()) {
        segments.push({
          id: makeId(),
          type: 'text',
          text: before,
        })
      }
    }

    const openTagEnd = raw.indexOf('>')
    const closeTagStart = raw.lastIndexOf(`</${name}>`)
    const tagBody =
      openTagEnd >= 0 && closeTagStart >= 0
        ? raw.slice(openTagEnd + 1, closeTagStart).trim()
        : ''

    const tag: ParsedTag = {
      id: makeId(),
      name,
      raw,
      body: tagBody,
      fields: parseTagFields(tagBody),
    }

    tags.push(tag)
    segments.push({
      id: tag.id,
      type: 'tag',
      tag,
    })
    bodyParts.push('\n\n')
    cursor = index + raw.length
  }

  const after = text.slice(cursor)
  if (after) {
    bodyParts.push(after)
    if (after.trim()) {
      segments.push({
        id: makeId(),
        type: 'text',
        text: after,
      })
    }
  }

  return {
    body: bodyParts.join('').replace(/\n{3,}/g, '\n\n').trim(),
    tags,
    segments,
  }
}

export function collectTagNames(texts: Array<string | undefined>) {
  const names = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    const matches = text.matchAll(tagPattern)
    for (const match of matches) names.add(match[1])
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}
