import Dexie, { type Table } from 'dexie'
import type { ViewerChat } from '../types'

interface MetaEntry {
  key: string
  value: unknown
}

export interface AssetBlobRecord {
  id: string
  blob: Blob
  type: string
  updatedAt: string
}

class ViewerDatabase extends Dexie {
  chats!: Table<ViewerChat, string>
  meta!: Table<MetaEntry, string>
  assetBlobs!: Table<AssetBlobRecord, string>

  constructor() {
    super('SillyTavernChatViewer')
    this.version(1).stores({
      chats: 'id, title, folder, sortOrder, importedAt, updatedAt',
    })
    this.version(2).stores({
      chats: 'id, title, folder, sortOrder, importedAt, updatedAt',
      meta: 'key',
    })
    this.version(3).stores({
      chats: 'id, title, folder, sortOrder, importedAt, updatedAt',
      meta: 'key',
      assetBlobs: 'id, updatedAt',
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
    assetIds: chat.assetIds ?? [],
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

export async function getAssetBlob(id: string) {
  return db.assetBlobs.get(id)
}

export async function putAssetBlob(id: string, blob: Blob, type?: string) {
  await db.assetBlobs.put({
    id,
    blob,
    type: type || blob.type || 'application/octet-stream',
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteAssetBlobs(ids: string[]) {
  if (!ids.length) return
  await db.assetBlobs.bulkDelete(ids)
}

export async function clearAssetBlobs() {
  await db.assetBlobs.clear()
}
