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
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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
