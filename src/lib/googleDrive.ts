import type { ViewerBackup } from '../types'

export const googleDriveConfig = {
  clientId:
    '603627252416-863fuo74accv3l1ne31qigj60vif18ks.apps.googleusercontent.com',
  apiKey: 'AIzaSyC26yHckx-iNL759oIRvrE0cL-xJImWCQU',
  appId: '603627252416',
  scope: 'https://www.googleapis.com/auth/drive.file',
  backupFolderName: 'ChatShelf Backups',
}

export interface DrivePickedFile {
  id: string
  name: string
  mimeType?: string
}

export interface DriveBackupFile {
  id: string
  name: string
  createdTime: string
  modifiedTime: string
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleDriveWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string
          scope: string
          callback: (response: TokenResponse) => void
          error_callback?: (error: { type?: string; message?: string }) => void
        }) => TokenClient
      }
    }
    picker?: {
      Action: { PICKED: string; CANCEL: string }
      Feature: { MULTISELECT_ENABLED: string }
      DocsView: new (viewId?: string) => {
        setMimeTypes: (mimeTypes: string) => unknown
        setIncludeFolders: (value: boolean) => unknown
        setSelectFolderEnabled: (value: boolean) => unknown
      }
      PickerBuilder: new () => {
        setAppId: (appId: string) => unknown
        setDeveloperKey: (key: string) => unknown
        setOAuthToken: (token: string) => unknown
        addView: (view: unknown) => unknown
        enableFeature: (feature: string) => unknown
        setCallback: (callback: (data: PickerResponse) => void) => unknown
        build: () => { setVisible: (visible: boolean) => void }
      }
      ViewId: {
        DOCS: string
      }
    }
  }
  gapi?: {
    load: (name: string, callback: () => void) => void
  }
}

interface PickerResponse {
  action?: string
  docs?: Array<{
    id?: string
    name?: string
    mimeType?: string
  }>
}

let tokenClient: TokenClient | undefined
let currentToken: string | undefined
let tokenExpiresAt = 0
let pendingTokenRequest:
  | {
      resolve: (token: string) => void
      reject: (error: Error) => void
    }
  | undefined
let scriptsReady: Promise<void> | undefined
let pickerReady: Promise<void> | undefined

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    )
    if (existing?.dataset.ready === 'true') {
      resolve()
      return
    }
    const script = existing ?? document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => {
      script.dataset.ready = 'true'
      resolve()
    }
    script.onerror = () => reject(new Error('Google 스크립트 로딩 실패'))
    if (!existing) document.head.appendChild(script)
  })
}

async function ensureScripts() {
  if (!scriptsReady) {
    scriptsReady = Promise.all([
      loadScript('https://accounts.google.com/gsi/client'),
      loadScript('https://apis.google.com/js/api.js'),
    ]).then(() => undefined)
  }
  await scriptsReady
}

async function ensurePicker() {
  if (!pickerReady) {
    pickerReady = ensureScripts().then(
      () =>
        new Promise<void>((resolve, reject) => {
          const api = window as GoogleDriveWindow
          if (!api.gapi?.load) {
            reject(new Error('Google Picker API를 불러오지 못했습니다.'))
            return
          }
          api.gapi.load('picker', resolve)
        }),
    )
  }
  await pickerReady
}

export async function requestGoogleDriveToken(options?: { forcePrompt?: boolean }) {
  await ensureScripts()
  const api = window as GoogleDriveWindow
  const oauth = api.google?.accounts?.oauth2
  if (!oauth) throw new Error('Google 로그인 모듈을 불러오지 못했습니다.')

  if (
    currentToken &&
    !options?.forcePrompt &&
    tokenExpiresAt > Date.now() + 60_000
  ) {
    return currentToken
  }

  return new Promise<string>((resolve, reject) => {
    pendingTokenRequest = {
      resolve,
      reject: (error) => {
        pendingTokenRequest = undefined
        reject(error)
      },
    }

    tokenClient =
      tokenClient ??
      oauth.initTokenClient({
        client_id: googleDriveConfig.clientId,
        scope: googleDriveConfig.scope,
        callback: (response) => {
          const pending = pendingTokenRequest
          pendingTokenRequest = undefined
          if (response.error || !response.access_token) {
            pending?.reject(
              new Error(
                response.error_description || 'Google Drive 연결을 완료하지 못했습니다.',
              ),
            )
            return
          }
          currentToken = response.access_token
          tokenExpiresAt =
            Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000
          pending?.resolve(response.access_token)
        },
        error_callback: (error) => {
          const pending = pendingTokenRequest
          pendingTokenRequest = undefined
          pending?.reject(
            new Error(
              error.message ||
                (error.type === 'popup_closed'
                  ? 'Google 연결 창이 닫혔습니다.'
                  : 'Google Drive 연결을 완료하지 못했습니다.'),
            ),
          )
        },
      })

    tokenClient.requestAccessToken({
      prompt: options?.forcePrompt ? 'consent' : '',
    })
  })
}

export function forgetGoogleDriveToken() {
  currentToken = undefined
  tokenExpiresAt = 0
  pendingTokenRequest = undefined
  tokenClient = undefined
}

export async function getGoogleDriveToken() {
  return currentToken ?? requestGoogleDriveToken()
}

async function driveFetch<T>(
  path: string,
  init?: RequestInit,
  options?: { upload?: boolean },
) {
  const token = await getGoogleDriveToken()
  const base = options?.upload
    ? 'https://www.googleapis.com/upload/drive/v3'
    : 'https://www.googleapis.com/drive/v3'
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Google Drive 요청 실패 (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function driveBlob(path: string) {
  const token = await getGoogleDriveToken()
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('Google Drive 파일을 읽지 못했습니다.')
  return response.blob()
}

function multipartBody(metadata: Record<string, unknown>, blob: Blob) {
  const boundary = `chatshelf-${crypto.randomUUID()}`
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  )
  return { body, contentType: body.type }
}

export async function ensureBackupFolder() {
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${googleDriveConfig.backupFolderName.replace(/'/g, "\\'")}'`,
    'trashed=false',
  ].join(' and ')
  const found = await driveFetch<{
    files: Array<{ id: string; name: string }>
  }>(
    `/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)&pageSize=1`,
  )
  if (found.files[0]?.id) return found.files[0].id

  const created = await driveFetch<{ id: string }>('/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: googleDriveConfig.backupFolderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  return created.id
}

export async function listDriveBackups() {
  const folderId = await ensureBackupFolder()
  const q = [
    `'${folderId}' in parents`,
    "name contains 'chatshelf-backup-'",
    'trashed=false',
  ].join(' and ')
  const result = await driveFetch<{ files: DriveBackupFile[] }>(
    `/files?q=${encodeURIComponent(
      q,
    )}&spaces=drive&fields=files(id,name,createdTime,modifiedTime)&orderBy=createdTime desc&pageSize=20`,
  )
  return result.files
}

export async function uploadDriveBackup(backup: ViewerBackup) {
  const folderId = await ensureBackupFolder()
  const stamp = backup.exportedAt.replace(/[:.]/g, '-')
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  })
  const { body, contentType } = multipartBody(
    {
      name: `chatshelf-backup-${stamp}.json`,
      mimeType: 'application/json',
      parents: [folderId],
    },
    blob,
  )
  const uploaded = await driveFetch<DriveBackupFile>(
    '/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime',
    {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    },
    { upload: true },
  )
  await pruneDriveBackups(3)
  return uploaded
}

export async function pruneDriveBackups(keep: number) {
  const backups = await listDriveBackups()
  await Promise.all(
    backups.slice(keep).map((file) =>
      driveFetch(`/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      }),
    ),
  )
}

export async function downloadDriveBackup(fileId: string) {
  const blob = await driveBlob(`/files/${fileId}?alt=media`)
  const text = await blob.text()
  return JSON.parse(text) as ViewerBackup
}

export async function downloadDriveText(fileId: string) {
  const blob = await driveBlob(`/files/${fileId}?alt=media`)
  return blob.text()
}

export async function downloadDriveFileAsDataUrl(file: DrivePickedFile) {
  const blob = await driveBlob(`/files/${file.id}?alt=media`)
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function downloadDriveFileAsBlob(fileId: string) {
  return driveBlob(`/files/${fileId}?alt=media`)
}

export async function pickDriveFiles(options?: { multiple?: boolean }) {
  await ensurePicker()
  const api = window as GoogleDriveWindow
  const picker = api.google?.picker
  if (!picker) throw new Error('Google Picker를 불러오지 못했습니다.')
  const token = await getGoogleDriveToken()

  return new Promise<DrivePickedFile[]>((resolve, reject) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
    view.setIncludeFolders(true)
    view.setSelectFolderEnabled(false)

    const builder = new picker.PickerBuilder()
    builder.setAppId(googleDriveConfig.appId)
    builder.setDeveloperKey(googleDriveConfig.apiKey)
    builder.setOAuthToken(token)
    builder.addView(view)
    if (options?.multiple) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED)
    builder.setCallback((data) => {
      if (data.action === picker.Action.CANCEL) {
        resolve([])
        return
      }
      if (data.action !== picker.Action.PICKED) return
      const docs = data.docs ?? []
      const picked = docs
        .map((doc) => ({
          id: doc.id ?? '',
          name: doc.name ?? 'Google Drive 파일',
          mimeType: doc.mimeType,
        }))
        .filter((doc) => doc.id)
      resolve(options?.multiple ? picked : picked.slice(0, 1))
    })

    try {
      builder.build().setVisible(true)
    } catch (error) {
      reject(error)
    }
  })
}
