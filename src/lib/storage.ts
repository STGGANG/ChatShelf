import Dexie, { type Table } from 'dexie'
import type { ViewerChat } from '../types'

interface MetaEntry {
  key: string
  value: unknown
}

class ViewerDatabase extends Dexie {
  chats!: Table<ViewerChat, string>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('SillyTavernChatViewer')
    this.version(1).stores({
      chats: 'id, title, folder, sortOrder, importedAt, updatedAt',
    })
    this.version(2).stores({
      chats: 'id, title, folder, sortOrder, importedAt, updatedAt',
      meta: 'key',
    })
  }
}

export const db = new ViewerDatabase()

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const entry = await db.meta.get(key)
  return entry?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

export async function deleteMeta(key: string) {
  await db.meta.delete(key)
}

export async function getChats() {
  const chats = await db.chats.orderBy('sortOrder').toArray()
  return chats.map((chat) => ({
    ...chat,
    assets: chat.assets ?? [],
    notes: chat.notes ?? [],
    highlights: chat.highlights ?? [],
    messages: chat.messages.map((message) => ({
      ...message,
      swipes: message.swipes ?? [],
    })),
  }))
}

export async function saveChat(chat: ViewerChat) {
  await db.chats.put({ ...chat, updatedAt: new Date().toISOString() })
}

export async function saveChats(chats: ViewerChat[]) {
  await db.transaction('rw', db.chats, async () => {
    for (const chat of chats) {
      await db.chats.put({ ...chat, updatedAt: new Date().toISOString() })
    }
  })
}

export async function deleteChat(id: string) {
  await db.chats.delete(id)
}

export async function replaceChats(chats: ViewerChat[]) {
  await db.transaction('rw', db.chats, async () => {
    await db.chats.clear()
    await db.chats.bulkPut(chats)
  })
}

export async function clearAllChats() {
  await db.chats.clear()
}
