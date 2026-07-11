import type { ViewerBackup } from '../types'

export function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function readFileAsDataUrl(file: File) {
  return blobToDataUrl(file)
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, payload] = dataUrl.split(',')
  if (!header || !payload) {
    throw new Error('올바르지 않은 이미지 데이터입니다.')
  }
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime })
}

function waitImageLoad(image: HTMLImageElement) {
  return new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'))
  })
}

export async function makeImageThumbnailDataUrl(blob: Blob, maxSize = 320) {
  if (!blob.type.startsWith('image/')) return ''
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode().catch(() => waitImageLoad(image))

    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) return ''

    const scale = Math.min(1, maxSize / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return ''
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', 0.72)
  } catch {
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function saveWithPicker(fileName: string, blob: Blob) {
  const access = window as unknown as {
    showSaveFilePicker?: (options: {
      suggestedName?: string
      types?: Array<{
        description: string
        accept: Record<string, string[]>
      }>
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>
        close: () => Promise<void>
      }>
    }>
  }

  if (!access.showSaveFilePicker) return false

  const handle = await access.showSaveFilePicker({
    suggestedName: fileName,
    types: [
      {
        description: '챗서랍 백업',
        accept: { 'application/json': ['.json'] },
      },
    ],
  })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
  return true
}

export async function downloadBlob(fileName: string, blob: Blob) {
  try {
    const saved = await saveWithPicker(fileName, blob)
    if (saved) return
  } catch {
    // Fall back to a normal browser download when the picker is cancelled or unavailable.
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function backupToBlob(backup: ViewerBackup) {
  return new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  })
}
