import type {
  MessageMetadata,
  MessageRole,
  MessageSwipe,
  ViewerChat,
  ViewerMessage,
} from '../types'

type UnknownRecord = Record<string, unknown>

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function roleOf(raw: UnknownRecord): MessageRole {
  if (raw.is_user === true) return 'user'
  if (raw.is_system === true) return 'system'
  return 'assistant'
}

function readExtra(raw: UnknownRecord) {
  return isRecord(raw.extra) ? raw.extra : {}
}

function metadataFrom(raw: UnknownRecord, extra: UnknownRecord): MessageMetadata {
  return {
    sendDate: stringValue(raw.send_date),
    genStarted: stringValue(raw.gen_started),
    genFinished: stringValue(raw.gen_finished),
    model: stringValue(extra.model),
    api: stringValue(extra.api),
    tokenCount: numberValue(extra.token_count),
    swipeId: numberValue(raw.swipe_id),
  }
}

function fallbackTitle(fileName: string) {
  return fileName.replace(/\.jsonl$/i, '').trim() || 'Untitled chat'
}

function usableTitle(value: string | undefined) {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLocaleLowerCase() === 'unused') return undefined
  return trimmed
}

export function parseSillyTavernJsonl(fileName: string, content: string) {
  const parsed: UnknownRecord[] = []
  const errors: Array<{ line: number; reason: string }> = []

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const value = JSON.parse(trimmed)
      if (isRecord(value)) parsed.push(value)
    } catch (error) {
      errors.push({
        line: index + 1,
        reason: error instanceof Error ? error.message : 'Invalid JSON',
      })
    }
  })

  if (!parsed.length) {
    throw new Error('읽을 수 있는 JSONL 데이터가 없습니다.')
  }

  const header = parsed.find((item) => !Object.hasOwn(item, 'mes')) ?? parsed[0]
  const now = new Date().toISOString()
  const chatId = makeId('chat')
  const messages: ViewerMessage[] = parsed
    .filter((item) => Object.hasOwn(item, 'mes'))
    .map((raw, itemIndex) => {
      const extra = readExtra(raw)
      const swipes = Array.isArray(raw.swipes) ? raw.swipes : []
      const swipeInfo = Array.isArray(raw.swipe_info) ? raw.swipe_info : []
      const reasoning =
        stringValue(extra.reasoning_display_text) ?? stringValue(extra.reasoning)
      const translated = stringValue(extra.display_text)
      const original =
        stringValue(extra.original_text_for_translation) ??
        stringValue(raw.mes) ??
        ''
      const metadata = metadataFrom(raw, extra)
      const parsedSwipes: MessageSwipe[] = swipes
        .map((swipe, swipeIndex) => {
          const info = isRecord(swipeInfo[swipeIndex]) ? swipeInfo[swipeIndex] : {}
          const swipeExtra = isRecord(info.extra) ? info.extra : {}
          const swipeOriginal =
            stringValue(swipeExtra.original_text_for_translation) ??
            stringValue(swipe) ??
            ''
          const swipeTranslated = stringValue(swipeExtra.display_text)
          const swipeReasoning =
            stringValue(swipeExtra.reasoning_display_text) ??
            stringValue(swipeExtra.reasoning)

          return {
            id: `${chatId}-message-${itemIndex + 1}-swipe-${swipeIndex + 1}`,
            index: swipeIndex,
            rawOriginal: swipeOriginal,
            rawTranslated:
              swipeTranslated && swipeTranslated !== swipeOriginal
                ? swipeTranslated
                : undefined,
            reasoning: swipeReasoning,
            metadata: {
              ...metadata,
              model: stringValue(swipeExtra.model) ?? metadata.model,
              api: stringValue(swipeExtra.api) ?? metadata.api,
              tokenCount: numberValue(swipeExtra.token_count),
              swipeCount: swipes.length || undefined,
              swipeId: swipeIndex,
            },
          }
        })
        .filter((swipe) => swipe.rawOriginal.trim())

      return {
        id: `${chatId}-message-${itemIndex + 1}`,
        index: itemIndex + 1,
        role: roleOf(raw),
        name: stringValue(raw.name),
        rawOriginal: original,
        rawTranslated: translated && translated !== original ? translated : undefined,
        reasoning,
        swipes: parsedSwipes,
        hiddenByST: raw._summarizedHidden === true,
        bookmarked: false,
        metadata: {
          ...metadata,
          tokenCount: numberValue(extra.token_count),
          swipeCount: Math.max(swipes.length, swipeInfo.length) || undefined,
          swipeId: numberValue(raw.swipe_id),
        },
      }
    })

  const messageTitle =
    messages.find((message) => message.role === 'assistant')?.name ??
    messages.find((message) => message.name)?.name
  const title =
    usableTitle(stringValue(header.character_name)) ??
    usableTitle(stringValue(header.title)) ??
    usableTitle(messageTitle) ??
    fallbackTitle(fileName)

  const chat: ViewerChat = {
    id: chatId,
    title,
    folder: '',
    sourceFileName: fileName,
    userName: usableTitle(stringValue(header.user_name)),
    characterName: usableTitle(stringValue(header.character_name)) ?? messageTitle,
    messages,
    assets: [],
    notes: [],
    highlights: [],
    wordMaskEnabled: false,
    wordMaskApplyToCopy: false,
    wordMaskRules: [],
    sortOrder: Date.now(),
    createdAt: now,
    importedAt: now,
    updatedAt: now,
  }

  return { chat, errors }
}
