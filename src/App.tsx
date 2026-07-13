import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  Eye,
  FileText,
  Folder,
  Image,
  ImageUp,
  Import,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  StepBack,
  StepForward,
  StickyNote,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import {
  builtinFonts,
  builtinThemes,
  defaultHighlightColors,
  defaultPalette,
  defaultSettings,
  loadReadingPositions,
  loadSettings,
  normalizeCoverImageMode,
  normalizeCoverPosition,
  normalizeHomeBannerCoverHeight,
  normalizeHomeCardCoverHeight,
  normalizeHomeCardImageMode,
  normalizeHomeCardLayoutMode,
  normalizeHomeCardMaxColumns,
  resolvePalette,
  saveReadingPositions,
  saveSettings,
} from './lib/defaults'
import {
  backupToBlob,
  blobToDataUrl,
  dataUrlToBlob,
  downloadBlob,
  makeImageThumbnailDataUrl,
  readFileAsDataUrl,
  readFileAsText,
} from './lib/files'
import {
  applyHighlightsToElement,
  renderMarkdown,
  selectImagePlaceholderAssets,
  stripMarkdownForSnippet,
} from './lib/markdown'
import { parseSillyTavernJsonl } from './lib/parser'
import {
  clearAllChats,
  clearAssetBlobs,
  deleteChat,
  deleteAssetBlobs,
  deleteMeta,
  getAssetBlob,
  getChats,
  getMeta,
  putAssetBlob,
  replaceChats,
  saveChat,
  saveChats,
  setMeta,
} from './lib/storage'
import { collectTagNames, splitTaggedText } from './lib/tags'
import type {
  AvatarCrop,
  ChatAsset,
  GoogleDriveState,
  MessageHighlight,
  MessageNote,
  ParsedTag,
  TagDisplayMode,
  ThemeDefinition,
  ThemePalette,
  ViewerBackup,
  ViewerChat,
  ViewerMessage,
  ViewerSettings,
  WordMaskRule,
} from './types'

const backupVersion = 1
const driveStateKey = 'st-chat-viewer:googleDrive'
const isSingleFileBuild = import.meta.env.VITE_CHATSHELF_SINGLE === 'true'

type DriveBackupFile = import('./lib/googleDrive').DriveBackupFile

async function loadGoogleDriveApi() {
  if (isSingleFileBuild) {
    throw new Error('단일 HTML 버전에서는 이 기능을 사용할 수 없습니다.')
  }
  return import('./lib/googleDrive')
}

const defaultGoogleDriveState: GoogleDriveState = {
  connected: false,
}

const defaultAvatarCrop: AvatarCrop = {
  x: 50,
  y: 50,
  scale: 1,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
}

function normalizeAvatarCrop(value?: Partial<AvatarCrop>): AvatarCrop {
  return {
    x: clamp(Math.round(value?.x ?? defaultAvatarCrop.x), 0, 100),
    y: clamp(Math.round(value?.y ?? defaultAvatarCrop.y), 0, 100),
    scale: clamp(Number(value?.scale ?? defaultAvatarCrop.scale), 1, 2.6),
  }
}

function avatarImageStyle(crop?: AvatarCrop): CSSProperties {
  const normalized = normalizeAvatarCrop(crop)
  return {
    objectPosition: `${normalized.x}% ${normalized.y}%`,
    transform: `scale(${normalized.scale})`,
  }
}

function loadGoogleDriveState(): GoogleDriveState {
  try {
    const parsed = JSON.parse(localStorage.getItem(driveStateKey) ?? '{}') as
      Partial<GoogleDriveState>
    return {
      ...defaultGoogleDriveState,
      ...parsed,
      connected: false,
    }
  } catch {
    return defaultGoogleDriveState
  }
}

function isValidBackup(backup: ViewerBackup) {
  return backup.app === 'st-chat-viewer' && Array.isArray(backup.chats)
}

function newestDate(...values: Array<string | undefined>) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value as string).getTime())
    .filter((value) => Number.isFinite(value))
  if (!dates.length) return undefined
  return new Date(Math.max(...dates)).toISOString()
}

function formatDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function sameChatOrder(chats: ViewerChat[]) {
  return [...chats].sort((a, b) => a.sortOrder - b.sortOrder)
}

function normalizeWordMaskRules(rules?: WordMaskRule[]) {
  return (rules ?? []).map((rule) => ({
    id: rule.id || makeId('mask'),
    source: rule.source ?? '',
    replacement: rule.replacement ?? '',
  }))
}

function normalizeAsset(asset: ChatAsset): ChatAsset {
  return {
    ...asset,
    id: asset.id || makeId('asset'),
    filename: asset.filename || 'image',
    type: asset.type || 'image/*',
    dataUrl: asset.dataUrl ?? '',
    addedAt: asset.addedAt || new Date().toISOString(),
  }
}

function normalizeAssetDisplayMode(
  value?: string,
): NonNullable<ViewerChat['assetDisplayMode']> {
  return value === 'framed' || value === 'flush' ? 'framed' : 'default'
}

interface AssetBundle {
  id: string
  name: string
  assets: ChatAsset[]
  addedAt: string
}

interface AssetRegistration {
  asset: ChatAsset
  blob?: Blob
}

function assetBundleKey(asset: ChatAsset) {
  if (asset.bundleId) return asset.bundleId
  if (asset.addedAt) return `legacy-${asset.addedAt}`
  return asset.id
}

function buildAssetBundles(assets: ChatAsset[]): AssetBundle[] {
  const bundles = new Map<string, AssetBundle>()
  for (const asset of assets) {
    const id = assetBundleKey(asset)
    const current = bundles.get(id)
    if (current) {
      current.assets.push(asset)
      continue
    }
    bundles.set(id, {
      id,
      name: asset.bundleName || asset.filename,
      assets: [asset],
      addedAt: asset.addedAt,
    })
  }

  return [...bundles.values()]
    .map((bundle) => {
      const [firstAsset] = bundle.assets
      return {
        ...bundle,
        name:
          firstAsset.bundleName ||
          (bundle.assets.length > 1
            ? `${firstAsset.filename} 외 ${bundle.assets.length - 1}개`
            : firstAsset.filename),
      }
    })
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

async function createAssetRegistration({
  blob,
  filename,
  type,
  bundleId,
  bundleName,
  addedAt,
}: {
  blob: Blob
  filename: string
  type?: string
  bundleId: string
  bundleName: string
  addedAt: string
}): Promise<AssetRegistration> {
  const assetId = makeId('asset')
  const safeType = type || blob.type || 'image/*'
  const storedBlob = blob.type ? blob : blob.slice(0, blob.size, safeType)
  return {
    asset: {
      id: assetId,
      filename,
      type: safeType,
      dataUrl: '',
      thumbnailDataUrl: await makeImageThumbnailDataUrl(storedBlob),
      blobKey: assetId,
      blobStored: true,
      bundleId,
      bundleName,
      storage: 'local',
      addedAt,
    },
    blob: storedBlob,
  }
}

async function storeAssetPayloads(assets: ChatAsset[]) {
  let changed = false
  const storedAssets: ChatAsset[] = []

  for (const asset of assets.map(normalizeAsset)) {
    const key = asset.blobKey || asset.id
    if (asset.dataUrl) {
      try {
        const blob = dataUrlToBlob(asset.dataUrl)
        await putAssetBlob(key, blob, asset.type || blob.type)
        storedAssets.push({
          ...asset,
          type: asset.type || blob.type || 'image/*',
          dataUrl: '',
          thumbnailDataUrl:
            asset.thumbnailDataUrl || (await makeImageThumbnailDataUrl(blob)),
          blobKey: key,
          blobStored: true,
          storage: 'local',
        })
        changed = true
        continue
      } catch {
        storedAssets.push(asset)
        continue
      }
    }
    storedAssets.push(asset)
  }

  return { assets: storedAssets, changed }
}

async function hydrateAssetsForBackup(assets: ChatAsset[]) {
  const backupAssets: ChatAsset[] = []

  for (const asset of assets.map(normalizeAsset)) {
    if (asset.dataUrl) {
      backupAssets.push(asset)
      continue
    }

    const blobRecord = await getAssetBlob(asset.blobKey || asset.id)
    if (!blobRecord) {
      backupAssets.push(asset)
      continue
    }

    backupAssets.push({
      ...asset,
      dataUrl: await blobToDataUrl(blobRecord.blob),
    })
  }

  return backupAssets
}

async function storeChatAssetPayloads(chats: ViewerChat[]) {
  let changed = false
  const storedChats: ViewerChat[] = []

  for (const chat of chats) {
    const stored = await storeAssetPayloads(chat.assets)
    changed = changed || stored.changed
    storedChats.push({ ...chat, assets: stored.assets })
  }

  return { chats: storedChats, changed }
}

async function hydrateChatsForBackup(chats: ViewerChat[]) {
  const backupChats: ViewerChat[] = []

  for (const chat of chats) {
    backupChats.push({
      ...chat,
      assets: await hydrateAssetsForBackup(chat.assets),
    })
  }

  return backupChats
}

function stripImageAssetsForBackup(chats: ViewerChat[]) {
  return chats.map((chat) => ({
    ...chat,
    assets: [],
    assetIds: [],
  }))
}

function normalizeChat(chat: ViewerChat): ViewerChat {
  return {
    ...chat,
    folder: chat.folder ?? '',
    assets: (chat.assets ?? []).map(normalizeAsset),
    assetIds: chat.assetIds ?? [],
    notes: chat.notes ?? [],
    highlights: chat.highlights ?? [],
    wordMaskEnabled: chat.wordMaskEnabled ?? false,
    wordMaskApplyToCopy: chat.wordMaskApplyToCopy ?? false,
    wordMaskRules: normalizeWordMaskRules(chat.wordMaskRules),
    assetDisplayMode: normalizeAssetDisplayMode(chat.assetDisplayMode),
    characterAvatarCrop: normalizeAvatarCrop(chat.characterAvatarCrop),
    userAvatarCrop: normalizeAvatarCrop(chat.userAvatarCrop),
    messages: chat.messages.map((message) => ({
      ...message,
      swipes: message.swipes ?? [],
    })),
  }
}

function activeWordMaskRules(chat?: ViewerChat, options?: { forCopy?: boolean }) {
  if (!chat?.wordMaskEnabled) return []
  if (options?.forCopy && !chat.wordMaskApplyToCopy) return []
  return chat.wordMaskRules.filter((rule) => rule.source.length > 0)
}

function applyWordMasksToText(text: string, rules: WordMaskRule[]) {
  if (!text || !rules.length) return text
  return rules.reduce(
    (masked, rule) => masked.split(rule.source).join(rule.replacement),
    text,
  )
}

function applyWordMasksToElement(root: HTMLElement, rules: WordMaskRule[]) {
  if (!rules.length) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node = walker.nextNode()

  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  for (const textNode of textNodes) {
    textNode.nodeValue = applyWordMasksToText(textNode.nodeValue ?? '', rules)
  }
}

function normalizedSettings(settings: Partial<ViewerSettings>) {
  const fonts = builtinFonts
  const readingFont =
    fonts.find((font) => font.id === settings.fontId) ?? fonts[0]
  const uiFont =
    fonts.find((font) => font.id === settings.uiFontId) ?? fonts[0]
  return {
    ...defaultSettings,
    ...settings,
    fonts,
    fontId: readingFont.id,
    fontFamily: readingFont.fontFamily,
    uiFontId: uiFont.id,
    uiFontFamily: uiFont.fontFamily,
    customPalette: {
      ...defaultPalette,
      ...settings.customPalette,
    },
    customThemes: settings.customThemes ?? [],
    coverImageMode: normalizeCoverImageMode(settings.coverImageMode),
    coverPosition: normalizeCoverPosition(settings.coverPosition),
    homeBannerCoverHeight: normalizeHomeBannerCoverHeight(
      settings.homeBannerCoverHeight,
    ),
    homeBannerCoverPosition: normalizeCoverPosition(
      settings.homeBannerCoverPosition,
    ),
    homeCardCoverHeight: normalizeHomeCardCoverHeight(
      settings.homeCardCoverHeight,
    ),
    homeCardMaxColumns: normalizeHomeCardMaxColumns(
      settings.homeCardMaxColumns,
    ),
    homeCardLayoutMode: normalizeHomeCardLayoutMode(
      settings.homeCardLayoutMode,
    ),
    homeCardImageMode: normalizeHomeCardImageMode(
      settings.homeCardImageMode,
    ),
  }
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const assetInputRef = useRef<HTMLInputElement>(null)
  const charAvatarInputRef = useRef<HTMLInputElement>(null)
  const userAvatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectionPopupRef = useRef<HTMLDivElement>(null)
  const selectionScanTimerRef = useRef<number | null>(null)
  const searchFlashTimerRef = useRef<number | null>(null)
  const readingSaveTimerRef = useRef<number | null>(null)
  const openedChatRef = useRef<string>(undefined)
  const prependAnchorRef = useRef<number | null>(null)
  const favoriteRailRef = useRef<HTMLDivElement>(null)
  const [chats, setChats] = useState<ViewerChat[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [settings, setSettings] = useState<ViewerSettings>(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [driveModalOpen, setDriveModalOpen] = useState(false)
  const [importChoiceOpen, setImportChoiceOpen] = useState(false)
  const [backupChoiceOpen, setBackupChoiceOpen] = useState(false)
  const [assetGalleryOpen, setAssetGalleryOpen] = useState(false)
  const [highlightModalOpen, setHighlightModalOpen] = useState(false)
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [winStart, setWinStart] = useState(0)
  const [winEnd, setWinEnd] = useState(10)
  const [readerTopbarVisible, setReaderTopbarVisible] = useState(true)
  const [jumpValue, setJumpValue] = useState('')
  const [notice, setNotice] = useState('')
  const [focusedMessageId, setFocusedMessageId] = useState<string>()
  const [draggedChatId, setDraggedChatId] = useState<string>()
  const [view, setView] = useState<'home' | 'reader'>('home')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [homeBanner, setHomeBanner] = useState<string>()
  const [homeLogo, setHomeLogo] = useState<string>()
  const [continueTarget, setContinueTarget] = useState<number | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem('st-chat-viewer:folders') ?? '{}')
      } catch {
        return {}
      }
    },
  )
  const [homeQuery, setHomeQuery] = useState('')
  const [homeSelectionMode, setHomeSelectionMode] = useState(false)
  const [selectedHomeChatIds, setSelectedHomeChatIds] = useState<string[]>([])
  const [bulkFolderValue, setBulkFolderValue] = useState('')
  const [excludeImageAssetsFromBackup, setExcludeImageAssetsFromBackup] =
    useState(false)
  const [favoriteScrollState, setFavoriteScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  })
  const [assetLibrary, setAssetLibrary] = useState<ChatAsset[]>([])
  const [searchFlash, setSearchFlash] = useState<MessageHighlight>()
  const [readingPositions, setReadingPositions] = useState<Record<string, number>>(
    () => loadReadingPositions(),
  )
  const [currentReadIndex, setCurrentReadIndex] = useState(0)
  const [selectionPopup, setSelectionPopup] = useState<{
    messageId: string
    text: string
    x: number
    y: number
  } | null>(null)
  const [driveState, setDriveState] = useState<GoogleDriveState>(() =>
    loadGoogleDriveState(),
  )
  const [driveBusy, setDriveBusy] = useState(false)
  const [remoteBackup, setRemoteBackup] = useState<DriveBackupFile | null>(null)
  const [driveBackups, setDriveBackups] = useState<DriveBackupFile[]>([])
  const [driveBackupsLoaded, setDriveBackupsLoaded] = useState(false)

  const openChatImport = () => {
    if (isSingleFileBuild) {
      fileInputRef.current?.click()
      return
    }
    setImportChoiceOpen(true)
  }

  useEffect(() => {
    getChats().then(async (items) => {
      const ordered = sameChatOrder(items.map(normalizeChat))
      const stored = await storeChatAssetPayloads(ordered)
      const normalizedChats = stored.chats
      if (stored.changed) await saveChats(normalizedChats)
      setChats(normalizedChats)
      const localRevisionAt = newestDate(
        ...normalizedChats.map((chat) => chat.updatedAt ?? chat.importedAt),
      )
      if (localRevisionAt) {
        setDriveState((current) =>
          current.lastLocalRevisionAt
            ? current
            : { ...current, lastLocalRevisionAt: localRevisionAt },
        )
      }
      const lastId = localStorage.getItem('st-chat-viewer:lastChat') ?? undefined
      const restored = normalizedChats.find((chat) => chat.id === lastId)?.id
      setSelectedId((current) => current ?? restored ?? normalizedChats[0]?.id)
    })
  }, [])

  useEffect(() => {
    void getMeta<string>('homeBanner').then((value) => {
      if (value) setHomeBanner(value)
    })
    void getMeta<string>('homeLogo').then((value) => {
      if (value) setHomeLogo(value)
    })
    void getMeta<ChatAsset[]>('assetLibrary').then(async (value) => {
      const stored = await storeAssetPayloads(value ?? [])
      setAssetLibrary(stored.assets)
      if (stored.changed) await setMeta('assetLibrary', stored.assets)
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('st-chat-viewer:folders', JSON.stringify(collapsedFolders))
  }, [collapsedFolders])

  useEffect(() => {
    if (selectedId) localStorage.setItem('st-chat-viewer:lastChat', selectedId)
  }, [selectedId])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * settings.uiFontScale}px`
  }, [settings.uiFontScale])

  useEffect(() => {
    saveReadingPositions(readingPositions)
  }, [readingPositions])

  useEffect(() => {
    localStorage.setItem(driveStateKey, JSON.stringify(driveState))
  }, [driveState])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const buildBackup = useCallback(
    async (
      options?: string | { localRevisionAt?: string; excludeImageAssets?: boolean },
    ): Promise<ViewerBackup> => {
      const localRevisionAt =
        typeof options === 'string' ? options : options?.localRevisionAt
      const excludeImageAssets =
        typeof options === 'string' ? false : Boolean(options?.excludeImageAssets)
      const [backupChats, backupAssets] = excludeImageAssets
        ? [stripImageAssetsForBackup(chats), []]
        : await Promise.all([
            hydrateChatsForBackup(chats),
            hydrateAssetsForBackup(assetLibrary),
          ])

      return {
        app: 'st-chat-viewer',
        version: backupVersion,
        exportedAt: new Date().toISOString(),
        assetsExcluded: excludeImageAssets || undefined,
        localRevisionAt:
          localRevisionAt ?? driveState.lastLocalRevisionAt ?? new Date().toISOString(),
        chats: backupChats,
        settings,
        readingPositions,
        homeBanner,
        homeLogo,
        assetLibrary: backupAssets,
      }
    },
    [
      chats,
      settings,
      readingPositions,
      homeBanner,
      homeLogo,
      assetLibrary,
      driveState.lastLocalRevisionAt,
    ],
  )

  useEffect(
    () => () => {
      if (searchFlashTimerRef.current) {
        window.clearTimeout(searchFlashTimerRef.current)
      }
      if (selectionScanTimerRef.current) {
        window.clearTimeout(selectionScanTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!selectionPopup) return

    const closePopup = () => setSelectionPopup(null)

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection?.toString().trim()) closePopup()
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (selectionPopupRef.current?.contains(event.target as Node)) return
      closePopup()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', closePopup, true)
    window.addEventListener('resize', closePopup)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', closePopup, true)
      window.removeEventListener('resize', closePopup)
    }
  }, [selectionPopup])

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedId),
    [chats, selectedId],
  )
  const assetLibraryMap = useMemo(
    () => new Map(assetLibrary.map((asset) => [asset.id, asset])),
    [assetLibrary],
  )
  const displaySelectedChat = useMemo(() => {
    if (!selectedChat) return undefined
    const linkedAssets = (selectedChat.assetIds ?? [])
      .map((id) => assetLibraryMap.get(id))
      .filter((asset): asset is ChatAsset => Boolean(asset))
    return {
      ...selectedChat,
      assets: [
        ...selectedChat.assets.filter(
          (asset) => asset.storage !== 'drive' || Boolean(asset.dataUrl),
        ),
        ...linkedAssets,
      ],
    }
  }, [assetLibraryMap, selectedChat])
  const selectedAssetIds = selectedChat?.assetIds ?? []
  const currentAssets = useMemo(
    () => displaySelectedChat?.assets ?? [],
    [displaySelectedChat],
  )
  const currentAssetBundles = useMemo(
    () => buildAssetBundles(currentAssets),
    [currentAssets],
  )

  const folderOptions = useMemo(
    () =>
      [...new Set(chats.map((chat) => chat.folder.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [chats],
  )

  const tagNames = useMemo(() => {
    if (!selectedChat) return []
    return collectTagNames(
      selectedChat.messages.flatMap((message) => [
        message.rawOriginal,
        message.rawTranslated,
      ]),
    )
  }, [selectedChat])

  const visibleMessages = useMemo(() => {
    const messages = selectedChat?.messages ?? []
    return settings.includeHidden
      ? messages
      : messages.filter((message) => !message.hiddenByST)
  }, [selectedChat, settings.includeHidden])

  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []

    return visibleMessages.filter((message) =>
      [
        message.rawOriginal,
        message.rawTranslated,
      ]
        .filter(Boolean)
        .join('\n')
        .toLocaleLowerCase()
        .includes(needle),
    )
  }, [query, visibleMessages])

  const pageCount = Math.max(1, visibleMessages.length)
  const showAll = settings.scrollWindowSize === 0
  const displayMessages = useMemo(() => {
    if (settings.readMode === 'page') {
      const safePage = clamp(page, 0, pageCount - 1)
      return visibleMessages[safePage] ? [visibleMessages[safePage]] : []
    }

    if (showAll) return visibleMessages

    const total = visibleMessages.length
    const start = clamp(winStart, 0, Math.max(0, total - 1))
    const end = clamp(winEnd, start + 1, total)
    return visibleMessages.slice(start, end)
  }, [page, pageCount, winStart, winEnd, settings.readMode, visibleMessages, showAll])

  const hasMoreAbove = !showAll && winStart > 0
  const hasMoreBelow = !showAll && winEnd < visibleMessages.length

  const resetScrollWindow = useCallback(
    (total: number) => {
      if (settings.scrollWindowSize === 0) {
        setWinStart(0)
        setWinEnd(total)
        return
      }
      const chunk = Math.max(1, settings.scrollWindowSize)
      setWinStart(0)
      setWinEnd(Math.min(chunk, total))
    },
    [settings.scrollWindowSize],
  )

  const loadMoreAbove = () => {
    const chunk = Math.max(1, settings.scrollWindowSize || 10)
    const delta = Math.min(chunk, winStart)
    prependAnchorRef.current = delta
    setWinStart(winStart - delta)
  }

  const loadMoreBelow = () => {
    const chunk = Math.max(1, settings.scrollWindowSize || 10)
    setWinEnd(Math.min(visibleMessages.length, winEnd + chunk))
  }

  const activeMessage = displayMessages[0]
  const bookmarkedMessages = useMemo(
    () => selectedChat?.messages.filter((message) => message.bookmarked) ?? [],
    [selectedChat],
  )
  const notes = selectedChat?.notes ?? []
  const highlights = selectedChat?.highlights ?? []
  const lastIndex = visibleMessages[visibleMessages.length - 1]?.index ?? 0
  const readPercent = clamp((currentReadIndex / (lastIndex || 1)) * 100, 0, 100)
  const currentMessage = visibleMessages.find(
    (message) => message.index === currentReadIndex,
  )

  useEffect(() => {
    setPage((current) => clamp(current, 0, pageCount - 1))
  }, [pageCount])

  useEffect(() => {
    if (view !== 'reader') return
    if (settings.readMode !== 'page' || !activeMessage) return
    window.requestAnimationFrame(() => {
      document
        .getElementById(activeMessage.id)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }, [activeMessage, page, settings.readMode, view])

  useEffect(() => {
    if (!focusedMessageId) return
    const id = focusedMessageId
    const timer = window.setTimeout(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setFocusedMessageId(undefined)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [displayMessages, focusedMessageId])

  useEffect(() => {
    const anchorOffset = prependAnchorRef.current
    if (anchorOffset === null) return
    prependAnchorRef.current = null
    const anchor = displayMessages[anchorOffset]
    if (!anchor) return
    requestAnimationFrame(() => {
      document.getElementById(anchor.id)?.scrollIntoView({ block: 'start' })
    })
  }, [winStart, displayMessages])

  useEffect(() => {
    if (settings.readMode !== 'scroll') return
    setWinEnd((current) => Math.min(current, visibleMessages.length))
    setWinStart((current) =>
      Math.min(current, Math.max(0, visibleMessages.length - 1)),
    )
  }, [visibleMessages.length, settings.readMode])

  useEffect(() => {
    if (view === 'reader' && settings.autoHideTopbar) {
      setReaderTopbarVisible(false)
    } else {
      setReaderTopbarVisible(true)
    }
  }, [view, selectedChat?.id, settings.autoHideTopbar])

  const markImportantChange = useCallback(() => {
    const now = new Date().toISOString()
    setDriveState((current) => ({
      ...current,
      lastLocalRevisionAt: now,
    }))
    return now
  }, [])

  const updateSettings = (patch: Partial<ViewerSettings>) => {
    markImportantChange()
    setSettings((current) => normalizedSettings({ ...current, ...patch }))
  }

  const updateChat = async (chat: ViewerChat) => {
    markImportantChange()
    const updated = normalizeChat({ ...chat, updatedAt: new Date().toISOString() })
    setChats((current) =>
      sameChatOrder(
        current.map((item) => (item.id === updated.id ? updated : item)),
      ),
    )
    await saveChat(updated)
  }

  const importChatFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const imported: ViewerChat[] = []
    const parseWarnings: string[] = []
    const maxOrder = Math.max(0, ...chats.map((chat) => chat.sortOrder))

    for (const [offset, file] of Array.from(files).entries()) {
      if (!file.name.toLocaleLowerCase().endsWith('.jsonl')) continue
      try {
        const text = await readFileAsText(file)
        const { chat, errors } = parseSillyTavernJsonl(file.name, text)
        chat.sortOrder = maxOrder + offset + 1
        imported.push(normalizeChat(chat))
        await saveChat(normalizeChat(chat))
        if (errors.length) {
          parseWarnings.push(`${file.name}: ${errors.length}개 줄을 건너뜀`)
        }
      } catch (error) {
        parseWarnings.push(
          `${file.name}: ${
            error instanceof Error ? error.message : '불러오기 실패'
          }`,
        )
      }
    }

    if (imported.length) {
      markImportantChange()
      const nextChats = sameChatOrder([...chats, ...imported])
      setChats(nextChats)
      setSelectedId(imported[imported.length - 1].id)
      setNotice(`${imported.length}개 채팅을 보관함에 추가했습니다.`)
    }

    if (parseWarnings.length) setNotice(parseWarnings.join(' · '))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const positionForMessage = (
    message: ViewerMessage,
    options?: { includeHiddenIfNeeded?: boolean },
  ) => {
    if (!selectedChat) return
    let list = visibleMessages
    let visibleIndex = list.findIndex((item) => item.id === message.id)
    if (visibleIndex < 0 && options?.includeHiddenIfNeeded) {
      list = selectedChat.messages
      visibleIndex = list.findIndex((item) => item.id === message.id)
      updateSettings({ includeHidden: true })
    }
    if (visibleIndex < 0) return

    if (settings.readMode === 'page') {
      setPage(visibleIndex)
    } else {
      const step = Math.max(1, settings.scrollWindowSize)
      const start = Math.max(0, visibleIndex - 1)
      setWinStart(start)
      setWinEnd(Math.min(list.length, start + step + 1))
    }
    setFocusedMessageId(message.id)
  }

  const rememberReading = useCallback(
    (index: number) => {
      setCurrentReadIndex(index)
      const id = selectedId
      if (!id) return
      if (readingSaveTimerRef.current) {
        window.clearTimeout(readingSaveTimerRef.current)
      }
      readingSaveTimerRef.current = window.setTimeout(() => {
        setReadingPositions((current) =>
          current[id] === index ? current : { ...current, [id]: index },
        )
      }, 500)
    },
    [selectedId],
  )

  useEffect(() => {
    if (view !== 'reader') return
    if (settings.readMode !== 'scroll' || !displayMessages.length) return
    const handleScroll = () => {
      const threshold = 120
      let best = displayMessages[0]
      for (const message of displayMessages) {
        const el = document.getElementById(message.id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= threshold) best = message
        else break
      }
      rememberReading(best.index)
    }
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [view, displayMessages, settings.readMode, rememberReading])

  useEffect(() => {
    if (view !== 'reader') return
    if (settings.readMode !== 'page' || !activeMessage) return
    rememberReading(activeMessage.index)
  }, [view, activeMessage, settings.readMode, rememberReading])

  useEffect(() => {
    if (view !== 'reader' || !selectedChat) return
    if (openedChatRef.current === selectedChat.id) return
    openedChatRef.current = selectedChat.id

    const firstIndex = visibleMessages[0]?.index ?? 0
    setPage(0)
    resetScrollWindow(visibleMessages.length)
    setFocusedMessageId(undefined)
    setCurrentReadIndex(firstIndex)
    window.scrollTo({ top: 0 })

    const saved = readingPositions[selectedChat.id]
    setContinueTarget(saved !== undefined && saved > firstIndex ? saved : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedChat, readingPositions, visibleMessages])

  useEffect(() => {
    if (!settings.keyboardShortcutsEnabled) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }
      if (settingsOpen || highlightModalOpen || notesModalOpen) return

      if (event.key === '/') {
        event.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      const dir = event.key === 'ArrowRight' ? 1 : -1
      if (settings.readMode === 'page') {
        setPage((current) => clamp(current + dir, 0, pageCount - 1))
        return
      }
      const idx = visibleMessages.findIndex(
        (message) => message.index === currentReadIndex,
      )
      const base = idx < 0 ? 0 : idx
      const targetMsg =
        visibleMessages[clamp(base + dir, 0, visibleMessages.length - 1)]
      if (targetMsg) positionForMessage(targetMsg)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.keyboardShortcutsEnabled,
    settings.readMode,
    settingsOpen,
    highlightModalOpen,
    notesModalOpen,
    pageCount,
    visibleMessages,
    currentReadIndex,
  ])

  const showSearchResult = (message: ViewerMessage) => {
    positionForMessage(message)
    const term = query.trim()
    if (!term) return

    if (searchFlashTimerRef.current) {
      window.clearTimeout(searchFlashTimerRef.current)
    }

    setSearchFlash({
      id: `search-${message.id}-${Date.now()}`,
      messageId: message.id,
      messageIndex: message.index,
      text: term,
      createdAt: new Date().toISOString(),
    })

    searchFlashTimerRef.current = window.setTimeout(() => {
      setSearchFlash(undefined)
      searchFlashTimerRef.current = null
    }, 4500)
  }

  const jumpToIndex = (index: number) => {
    const target =
      selectedChat?.messages.find((message) => message.index >= index) ??
      selectedChat?.messages[selectedChat.messages.length - 1]
    if (target) positionForMessage(target, { includeHiddenIfNeeded: true })
  }

  const changeSelectedChat = (id: string) => {
    if (id === selectedId) return
    setSelectedId(id)
    setFocusedMessageId(undefined)
    setSelectionPopup(null)
    setSearchFlash(undefined)
    setJumpValue('')
  }

  const updateSelectedChatFields = (patch: Partial<ViewerChat>) => {
    if (!selectedChat) return
    void updateChat({ ...selectedChat, ...patch })
  }

  const reorderChat = async (targetId: string) => {
    if (!draggedChatId || draggedChatId === targetId) return
    const ordered = sameChatOrder(chats)
    const dragged = ordered.find((chat) => chat.id === draggedChatId)
    if (!dragged) return
    const withoutDragged = ordered.filter((chat) => chat.id !== draggedChatId)
    const targetIndex = withoutDragged.findIndex((chat) => chat.id === targetId)
    withoutDragged.splice(targetIndex, 0, dragged)
    const next = withoutDragged.map((chat, index) => ({
      ...chat,
      sortOrder: index + 1,
    }))
    markImportantChange()
    setDraggedChatId(undefined)
    setChats(next)
    await saveChats(next)
  }

  const removeSelectedChat = async () => {
    if (!selectedChat) return
    const ok = window.confirm(`"${selectedChat.title}" 채팅을 보관함에서 삭제할까요?`)
    if (!ok) return
    await deleteChat(selectedChat.id)
    markImportantChange()
    const next = chats.filter((chat) => chat.id !== selectedChat.id)
    setChats(next)
    setSelectedId(next[0]?.id)
    setToolsOpen(false)
    setView('home')
    setNotice('채팅을 삭제했습니다.')
  }

  const importCoverImage = async (files: FileList | null) => {
    if (!files?.[0] || !selectedChat) return
    const dataUrl = await readFileAsDataUrl(files[0])
    await updateChat({ ...selectedChat, coverImage: dataUrl })
    if (coverInputRef.current) coverInputRef.current.value = ''
  }

  const removeCoverImage = async () => {
    if (!selectedChat) return
    await updateChat({ ...selectedChat, coverImage: undefined })
  }

  const importCharacterAvatar = async (files: FileList | null) => {
    if (!files?.[0] || !selectedChat) return
    const dataUrl = await readFileAsDataUrl(files[0])
    await updateChat({
      ...selectedChat,
      characterAvatar: dataUrl,
      characterAvatarCrop: defaultAvatarCrop,
    })
    if (charAvatarInputRef.current) charAvatarInputRef.current.value = ''
  }

  const importUserAvatar = async (files: FileList | null) => {
    if (!files?.[0] || !selectedChat) return
    const dataUrl = await readFileAsDataUrl(files[0])
    await updateChat({
      ...selectedChat,
      userAvatar: dataUrl,
      userAvatarCrop: defaultAvatarCrop,
    })
    if (userAvatarInputRef.current) userAvatarInputRef.current.value = ''
  }

  const importHomeBanner = async (files: FileList | null) => {
    if (!files?.[0]) return
    const dataUrl = await readFileAsDataUrl(files[0])
    markImportantChange()
    setHomeBanner(dataUrl)
    await setMeta('homeBanner', dataUrl)
    if (bannerInputRef.current) bannerInputRef.current.value = ''
    setNotice('홈 배너를 등록했습니다.')
  }

  const removeHomeBanner = async () => {
    markImportantChange()
    setHomeBanner(undefined)
    await deleteMeta('homeBanner')
  }

  const importHomeLogo = async (files: FileList | null) => {
    if (!files?.[0]) return
    const dataUrl = await readFileAsDataUrl(files[0])
    markImportantChange()
    setHomeLogo(dataUrl)
    await setMeta('homeLogo', dataUrl)
    if (logoInputRef.current) logoInputRef.current.value = ''
    setNotice('로고 이미지를 등록했습니다.')
  }

  const removeHomeLogo = async () => {
    markImportantChange()
    setHomeLogo(undefined)
    await deleteMeta('homeLogo')
  }

  const toggleFavorite = async (chat: ViewerChat) => {
    await updateChat({ ...chat, favorite: !chat.favorite })
  }

  const linkAssetIdsToSelectedChat = async (assetIds: string[]) => {
    if (!selectedChat || !assetIds.length) return
    const nextIds = [...new Set([...(selectedChat.assetIds ?? []), ...assetIds])]
    await updateChat({ ...selectedChat, assetIds: nextIds })
  }

  const registerAssetsToLibrary = async (registrations: AssetRegistration[]) => {
    if (!selectedChat || !registrations.length) return
    const libraryAssets = registrations.map(({ asset }) =>
      normalizeAsset({
        ...asset,
        id: asset.id || makeId('asset'),
        bundleId: asset.bundleId || makeId('bundle'),
        bundleName: asset.bundleName || asset.filename,
        storage: 'local',
        driveFileId: undefined,
      }),
    )
    await Promise.all(
      registrations.map(async ({ blob }, index) => {
        if (!blob) return
        const asset = libraryAssets[index]
        await putAssetBlob(asset.blobKey || asset.id, blob, asset.type)
      }),
    )
    const bundleCount = buildAssetBundles(libraryAssets).length
    const nextLibrary = [...assetLibrary, ...libraryAssets]
    setAssetLibrary(nextLibrary)
    await setMeta('assetLibrary', nextLibrary)
    await linkAssetIdsToSelectedChat(libraryAssets.map((asset) => asset.id))
    setNotice(
      `${bundleCount}개 에셋 묶음(${libraryAssets.length}개 이미지)을 챗서랍에 저장하고 이 채팅에 연결했습니다.`,
    )
  }

  const importAssets = async (files: FileList | null) => {
    if (!files?.length || !selectedChat) return
    const assets: AssetRegistration[] = []
    const now = new Date().toISOString()
    for (const file of Array.from(files)) {
      if (file.name.toLocaleLowerCase().endsWith('.zip')) {
        const bundleId = makeId('bundle')
        const bundleName = file.name
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(file)
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !/\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name)) continue
          const blob = await entry.async('blob')
          const imageFile = new File([blob], entry.name.split('/').pop() ?? entry.name, {
            type: blob.type || 'image/*',
          })
          assets.push(await createAssetRegistration({
            blob,
            filename: imageFile.name,
            type: imageFile.type,
            bundleId,
            bundleName,
            addedAt: now,
          }))
        }
        continue
      }

      if (file.type.startsWith('image/')) {
        const bundleId = makeId('bundle')
        assets.push(await createAssetRegistration({
          blob: file,
          filename: file.name,
          type: file.type,
          bundleId,
          bundleName: file.name,
          addedAt: now,
        }))
      }
    }
    await registerAssetsToLibrary(assets)
    if (assetInputRef.current) assetInputRef.current.value = ''
  }

  const toggleBookmark = async (messageId: string) => {
    if (!selectedChat) return
    const nextChat = {
      ...selectedChat,
      messages: selectedChat.messages.map((message) =>
        message.id === messageId
          ? { ...message, bookmarked: !message.bookmarked }
          : message,
      ),
    }
    await updateChat(nextChat)
  }

  const saveMessageNote = async (message: ViewerMessage, text: string) => {
    if (!selectedChat) return
    const trimmed = text.trim()
    const now = new Date().toISOString()
    const existing = selectedChat.notes.find((note) => note.messageId === message.id)
    const notes = trimmed
      ? existing
        ? selectedChat.notes.map((note) =>
            note.id === existing.id
              ? { ...note, text: trimmed, updatedAt: now }
              : note,
          )
        : [
            ...selectedChat.notes,
            {
              id: makeId('note'),
              messageId: message.id,
              messageIndex: message.index,
              text: trimmed,
              createdAt: now,
              updatedAt: now,
            },
          ]
      : selectedChat.notes.filter((note) => note.messageId !== message.id)
    await updateChat({ ...selectedChat, notes })
  }

  const addHighlight = async (
    message: ViewerMessage,
    selectedText: string,
    color: string,
  ) => {
    if (!selectedChat) return
    const text = selectedText.replace(/\s+/g, ' ').trim()
    if (!text || text.length < 2) return
    const existing = selectedChat.highlights.find(
      (highlight) => highlight.messageId === message.id && highlight.text === text,
    )
    const highlights = existing
      ? selectedChat.highlights.map((highlight) =>
          highlight.id === existing.id ? { ...highlight, color } : highlight,
        )
      : [
          ...selectedChat.highlights,
          {
            id: makeId('highlight'),
            messageId: message.id,
            messageIndex: message.index,
            text,
            color,
            createdAt: new Date().toISOString(),
          },
        ]
    await updateChat({ ...selectedChat, highlights })
    setNotice(
      existing
        ? `하이라이트 색을 변경했습니다: #${message.index}`
        : `하이라이트를 저장했습니다: #${message.index}`,
    )
  }

  const removeHighlight = async (highlightId: string) => {
    if (!selectedChat) return
    await updateChat({
      ...selectedChat,
      highlights: selectedChat.highlights.filter(
        (highlight) => highlight.id !== highlightId,
      ),
    })
  }

  const jumpByNumber = () => {
    const number = Number(jumpValue)
    if (!Number.isFinite(number)) return
    jumpToIndex(number)
  }

  const stepMessage = (dir: number) => {
    const idx = visibleMessages.findIndex(
      (message) => message.index === currentReadIndex,
    )
    const base = idx < 0 ? 0 : idx
    const target =
      visibleMessages[clamp(base + dir, 0, visibleMessages.length - 1)]
    if (target) positionForMessage(target)
  }

  const exportBackup = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    const backup = await buildBackup({
      excludeImageAssets: excludeImageAssetsFromBackup,
    })
    await downloadBlob(
      `chatshelf-backup-${stamp}.json`,
      backupToBlob(backup),
    )
    setNotice('백업 파일을 저장했습니다.')
  }

  const applyBackup = async (
    backup: ViewerBackup,
    options?: { driveFile?: DriveBackupFile; markLocalChange?: boolean },
  ) => {
    if (!isValidBackup(backup)) {
      throw new Error('챗서랍 백업 파일이 아닙니다.')
    }
    const restoredChats = sameChatOrder(backup.chats.map(normalizeChat))
    await clearAssetBlobs()
    const storedChats = await storeChatAssetPayloads(restoredChats)
    const storedAssets = await storeAssetPayloads(backup.assetLibrary ?? [])
    await replaceChats(storedChats.chats)
    setChats(storedChats.chats)
    setAssetLibrary(storedAssets.assets)
    setSettings(normalizedSettings(backup.settings ?? defaultSettings))
    setReadingPositions(backup.readingPositions ?? {})
    setHomeBanner(backup.homeBanner)
    setHomeLogo(backup.homeLogo)
    if (backup.homeBanner) await setMeta('homeBanner', backup.homeBanner)
    else await deleteMeta('homeBanner')
    if (backup.homeLogo) await setMeta('homeLogo', backup.homeLogo)
    else await deleteMeta('homeLogo')
    if (storedAssets.assets.length) await setMeta('assetLibrary', storedAssets.assets)
    else await deleteMeta('assetLibrary')
    openedChatRef.current = undefined
    setSelectedId(storedChats.chats[0]?.id)
    setRemoteBackup(null)

    const driveFile = options?.driveFile
    if (driveFile) {
      const revisionAt =
        backup.localRevisionAt ?? backup.exportedAt ?? driveFile.createdTime
      setDriveState((current) => ({
        ...current,
        connected: true,
        pausedForRemoteBackupId: undefined,
        lastBackupAt: backup.exportedAt ?? driveFile.createdTime,
        lastBackupFileId: driveFile.id,
        lastLocalRevisionAt: revisionAt,
        lastBackupLocalRevisionAt: revisionAt,
      }))
    } else if (options?.markLocalChange ?? true) {
      markImportantChange()
    }
  }

  const restoreBackup = async (files: FileList | null) => {
    if (!files?.[0]) return
    try {
      const raw = await readFileAsText(files[0])
      const backup = JSON.parse(raw) as ViewerBackup
      await applyBackup(backup)
      setNotice('백업을 복원했습니다.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '백업 복원 실패')
    }
    if (backupInputRef.current) backupInputRef.current.value = ''
  }

  const checkDriveBackupFreshness = async () => {
    const { listDriveBackups } = await loadGoogleDriveApi()
    const backups = await listDriveBackups()
    setDriveBackups(backups)
    setDriveBackupsLoaded(true)
    const latest = backups[0]
    if (!latest) {
      setRemoteBackup(null)
      return false
    }
    const localRevisionAt = driveState.lastLocalRevisionAt
    const latestTime = new Date(latest.createdTime).getTime()
    const localTime = localRevisionAt ? new Date(localRevisionAt).getTime() : 0
    const isKnownBackup = latest.id === driveState.lastBackupFileId

    if (!isKnownBackup && latestTime > localTime) {
      setRemoteBackup(latest)
      setDriveState((current) => ({
        ...current,
        pausedForRemoteBackupId: latest.id,
      }))
      return true
    }
    setRemoteBackup(null)
    return false
  }

  const connectGoogleDrive = async () => {
    setDriveBusy(true)
    setDriveBackupsLoaded(false)
    try {
      const { requestGoogleDriveToken } = await loadGoogleDriveApi()
      await requestGoogleDriveToken({ forcePrompt: true })
      await checkDriveBackupFreshness()
      setDriveState((current) => ({ ...current, connected: true }))
      setNotice('Google Drive를 연결했습니다.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google Drive 연결 실패')
    } finally {
      setDriveBusy(false)
    }
  }

  const disconnectGoogleDrive = () => {
    if (!isSingleFileBuild) {
      void loadGoogleDriveApi().then(({ forgetGoogleDriveToken }) => {
        forgetGoogleDriveToken()
      })
    }
    setRemoteBackup(null)
    setDriveBackupsLoaded(false)
    setDriveState((current) => ({
      ...current,
      connected: false,
      pausedForRemoteBackupId: undefined,
    }))
    setNotice('Google Drive 연결을 해제했습니다.')
  }

  const saveDriveBackup = async () => {
    if (driveBusy) return
    const revisionAt = driveState.lastLocalRevisionAt ?? new Date().toISOString()
    setDriveBusy(true)
    try {
      const { listDriveBackups, requestGoogleDriveToken, uploadDriveBackup } =
        await loadGoogleDriveApi()
      await requestGoogleDriveToken()
      const backup = await buildBackup({
        localRevisionAt: revisionAt,
        excludeImageAssets: excludeImageAssetsFromBackup,
      })
      const uploaded = await uploadDriveBackup(backup)
      const backups = await listDriveBackups()
      setDriveBackups(backups)
      setDriveBackupsLoaded(true)
      setRemoteBackup(null)
      setDriveState((current) => ({
        ...current,
        connected: true,
        pausedForRemoteBackupId: undefined,
        lastBackupAt: backup.exportedAt,
        lastBackupFileId: uploaded.id,
        lastLocalRevisionAt: revisionAt,
        lastBackupLocalRevisionAt: revisionAt,
      }))
      setNotice(`Google Drive에 백업을 저장했습니다. (${uploaded.name})`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google Drive 백업 실패')
    } finally {
      setDriveBusy(false)
    }
  }

  const restoreDriveBackup = async (file?: DriveBackupFile) => {
    setDriveBusy(true)
    try {
      const { downloadDriveBackup, listDriveBackups, requestGoogleDriveToken } =
        await loadGoogleDriveApi()
      await requestGoogleDriveToken()
      const backups = driveBackups.length ? driveBackups : await listDriveBackups()
      setDriveBackups(backups)
      setDriveBackupsLoaded(true)
      const target = file ?? remoteBackup ?? backups[0]
      if (!target) throw new Error('복원할 Google Drive 백업이 없습니다.')
      const backup = await downloadDriveBackup(target.id)
      await applyBackup(backup, { driveFile: target, markLocalChange: false })
      setNotice('Google Drive 백업을 복원했습니다.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google Drive 복원 실패')
    } finally {
      setDriveBusy(false)
    }
  }

  const importDriveJsonl = async () => {
    setDriveBusy(true)
    try {
      const { downloadDriveText, pickDriveFiles, requestGoogleDriveToken } =
        await loadGoogleDriveApi()
      await requestGoogleDriveToken()
      setDriveState((current) => ({ ...current, connected: true }))
      const picked = await pickDriveFiles({ multiple: true })
      if (!picked.length) return
      const imported: ViewerChat[] = []
      const warnings: string[] = []
      const maxOrder = Math.max(0, ...chats.map((chat) => chat.sortOrder))

      for (const [offset, file] of picked.entries()) {
        if (!file.name.toLocaleLowerCase().endsWith('.jsonl')) {
          warnings.push(`${file.name}: .jsonl 파일이 아닙니다.`)
          continue
        }
        try {
          const text = await downloadDriveText(file.id)
          const { chat, errors } = parseSillyTavernJsonl(file.name, text)
          chat.sortOrder = maxOrder + offset + 1
          const normalized = normalizeChat(chat)
          imported.push(normalized)
          await saveChat(normalized)
          if (errors.length) {
            warnings.push(`${file.name}: ${errors.length}개 줄을 건너뜀`)
          }
        } catch (error) {
          warnings.push(
            `${file.name}: ${
              error instanceof Error ? error.message : '불러오기 실패'
            }`,
          )
        }
      }

      if (imported.length) {
        markImportantChange()
        const nextChats = sameChatOrder([...chats, ...imported])
        setChats(nextChats)
        setSelectedId(imported[imported.length - 1].id)
        setNotice(`${imported.length}개 Drive 채팅을 보관함에 추가했습니다.`)
      }
      if (warnings.length) setNotice(warnings.join(' · '))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Drive 파일 가져오기 실패')
    } finally {
      setDriveBusy(false)
    }
  }

  const importDriveAssets = async () => {
    if (!selectedChat) return
    setDriveBusy(true)
    try {
      const { downloadDriveFileAsBlob, pickDriveFiles, requestGoogleDriveToken } =
        await loadGoogleDriveApi()
      await requestGoogleDriveToken()
      setDriveState((current) => ({ ...current, connected: true }))
      const picked = await pickDriveFiles({ multiple: true })
      if (!picked.length) return
      const now = new Date().toISOString()
      const assets: AssetRegistration[] = []
      for (const file of picked) {
        const lowerName = file.name.toLocaleLowerCase()
        const isZip =
          lowerName.endsWith('.zip') ||
          file.mimeType === 'application/zip' ||
          file.mimeType === 'application/x-zip-compressed'
        if (isZip) {
          const bundleId = makeId('bundle')
          const bundleName = file.name
          const { default: JSZip } = await import('jszip')
          const blob = await downloadDriveFileAsBlob(file.id)
          const zip = await JSZip.loadAsync(blob)
          for (const entry of Object.values(zip.files)) {
            if (entry.dir || !/\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name)) continue
            const imageBlob = await entry.async('blob')
            const imageFile = new File(
              [imageBlob],
              entry.name.split('/').pop() ?? entry.name,
              { type: imageBlob.type || 'image/*' },
            )
            assets.push(await createAssetRegistration({
              blob: imageBlob,
              filename: imageFile.name,
              type: imageFile.type,
              bundleId,
              bundleName,
              addedAt: now,
            }))
          }
          continue
        }

        const isImage =
          file.mimeType?.startsWith('image/') ||
          /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name)
        if (!isImage) continue

        const bundleId = makeId('bundle')
        const imageBlob = await downloadDriveFileAsBlob(file.id)
        assets.push(await createAssetRegistration({
          blob: imageBlob,
          filename: file.name,
          type: file.mimeType ?? imageBlob.type ?? 'image/*',
          bundleId,
          bundleName: file.name,
          addedAt: now,
        }))
      }
      await registerAssetsToLibrary(assets)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Drive 에셋 가져오기 실패')
    } finally {
      setDriveBusy(false)
    }
  }

  const unlinkAssetBundleFromSelectedChat = async (bundle: AssetBundle) => {
    if (!selectedChat) return
    const bundleAssetIds = new Set(bundle.assets.map((asset) => asset.id))
    await updateChat({
      ...selectedChat,
      assetIds: (selectedChat.assetIds ?? []).filter(
        (id) => !bundleAssetIds.has(id),
      ),
      assets: selectedChat.assets.filter((asset) => !bundleAssetIds.has(asset.id)),
    })
    setNotice('이 채팅에서 에셋 묶음 연결을 해제했습니다.')
  }

  const deleteLibraryAssets = async (assetIds: string[]) => {
    if (!assetIds.length) return
    const assetIdSet = new Set(assetIds)
    const nextLibrary = assetLibrary.filter((asset) => !assetIdSet.has(asset.id))
    const updatedChats = chats
      .filter((chat) => chat.assetIds?.some((id) => assetIdSet.has(id)))
      .map((chat) => ({
        ...chat,
        assetIds: (chat.assetIds ?? []).filter((id) => !assetIdSet.has(id)),
        updatedAt: new Date().toISOString(),
      }))

    markImportantChange()
    setAssetLibrary(nextLibrary)
    await setMeta('assetLibrary', nextLibrary)
    await deleteAssetBlobs(
      assetLibrary
        .filter((asset) => assetIdSet.has(asset.id))
        .map((asset) => asset.blobKey || asset.id),
    )

    if (updatedChats.length) {
      const updatedMap = new Map(updatedChats.map((chat) => [chat.id, chat]))
      setChats((current) =>
        sameChatOrder(
          current.map((chat) => updatedMap.get(chat.id) ?? chat),
        ),
      )
      await saveChats(updatedChats)
    }
    setNotice('챗서랍 에셋 묶음을 삭제했습니다.')
  }

  const resetSettings = () => {
    const ok = window.confirm(
      '글꼴, 색상, 보기 옵션 등 모든 설정을 기본값으로 되돌릴까요? (채팅과 메모, 하이라이트는 유지됩니다.)',
    )
    if (!ok) return
    markImportantChange()
    setSettings(defaultSettings)
    setNotice('설정을 기본값으로 되돌렸습니다.')
  }

  const resetEverything = async () => {
    const ok = window.confirm(
      '보관함의 모든 채팅과 메모, 하이라이트, 설정, 읽기 위치가 영구히 삭제됩니다. 되돌릴 수 없습니다. 정말 진행할까요?',
    )
    if (!ok) return
    const confirmText = window.prompt(
      '확인을 위해 삭제 라고 입력해 주세요.',
      '',
    )
    if (confirmText?.trim() !== '삭제') {
      setNotice('전체 초기화를 취소했습니다.')
      return
    }
    await clearAllChats()
    markImportantChange()
    saveReadingPositions({})
    await deleteMeta('homeBanner')
    await deleteMeta('homeLogo')
    await deleteMeta('assetLibrary')
    await clearAssetBlobs()
    setHomeBanner(undefined)
    setHomeLogo(undefined)
    setAssetLibrary([])
    setChats([])
    setReadingPositions({})
    setSettings(defaultSettings)
    openedChatRef.current = undefined
    setSelectedId(undefined)
    setSelectionPopup(null)
    setSearchFlash(undefined)
    setQuery('')
    setSettingsOpen(false)
    setNotice('모든 데이터를 초기화했습니다.')
  }

  const copyMessageText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice('메시지를 복사했습니다.')
    } catch {
      setNotice('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  const palette = useMemo(() => resolvePalette(settings), [settings])
  const homeCardGapSpace = `${Number(
    ((settings.homeCardMaxColumns - 1) * 1.1).toFixed(2),
  )}rem`

  const appStyle = {
    '--bg': palette.bg,
    '--surface': palette.surface,
    '--surface-soft': palette.surfaceSoft,
    '--surface-muted': palette.surfaceMuted,
    '--ink': palette.ink,
    '--ink-soft': palette.inkSoft,
    '--ink-muted': palette.inkMuted,
    '--line': palette.line,
    '--line-strong': palette.lineStrong,
    '--accent': palette.accent,
    '--accent-soft': palette.accentSoft,
    '--on-accent': palette.onAccent,
    '--ui-font': settings.uiFontFamily,
    '--ui-font-weight': String(settings.uiFontWeight),
    '--reader-font': settings.fontFamily,
    '--reader-font-weight': String(settings.fontWeight),
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': String(settings.lineHeight),
    '--paragraph-spacing': `${settings.paragraphSpacing}px`,
    '--message-width': `${settings.messageWidth}px`,
    '--cover-height': `${settings.coverHeight}px`,
    '--cover-position': `${settings.coverPosition}%`,
    '--home-banner-cover-height': `${settings.homeBannerCoverHeight}px`,
    '--home-banner-cover-position': `${settings.homeBannerCoverPosition}%`,
    '--home-card-width': `max(170px, calc((100% - ${homeCardGapSpace}) / ${settings.homeCardMaxColumns}))`,
    '--home-card-cover-height': `${settings.homeCardCoverHeight}px`,
  } as React.CSSProperties

  const openChat = (id: string) => {
    openedChatRef.current = undefined
    setView('reader')
    setToolsOpen(false)
    if (id !== selectedId) changeSelectedChat(id)
  }

  const goHome = () => {
    setView('home')
    setToolsOpen(false)
    setSelectionPopup(null)
    setContinueTarget(null)
  }

  const readingPercent = (chat: ViewerChat) => {
    const last = chat.messages[chat.messages.length - 1]?.index || 1
    const pos = readingPositions[chat.id]
    if (pos === undefined) return 0
    return clamp(Math.round((pos / last) * 100), 0, 100)
  }

  const homeGroups = useMemo(() => {
    const needle = homeQuery.trim().toLocaleLowerCase()
    const groups = new Map<string, ViewerChat[]>()
    for (const chat of sameChatOrder(chats)) {
      const folder = chat.folder.trim() || '폴더 없음'
      if (
        needle &&
        !chat.title.toLocaleLowerCase().includes(needle) &&
        !folder.toLocaleLowerCase().includes(needle)
      ) {
        continue
      }
      groups.set(folder, [...(groups.get(folder) ?? []), chat])
    }
    return [...groups.entries()]
  }, [chats, homeQuery])

  const favoriteChats = useMemo(() => {
    const needle = homeQuery.trim().toLocaleLowerCase()
    return sameChatOrder(chats).filter(
      (chat) =>
        chat.favorite &&
        (!needle || chat.title.toLocaleLowerCase().includes(needle)),
    )
  }, [chats, homeQuery])

  const visibleHomeChatIds = useMemo(
    () => [...new Set(homeGroups.flatMap(([, items]) => items.map((chat) => chat.id)))],
    [homeGroups],
  )
  const selectedHomeChats = useMemo(
    () => chats.filter((chat) => selectedHomeChatIds.includes(chat.id)),
    [chats, selectedHomeChatIds],
  )

  useEffect(() => {
    setSelectedHomeChatIds((current) =>
      current.filter((id) => chats.some((chat) => chat.id === id)),
    )
  }, [chats])

  const toggleHomeSelectionMode = () => {
    setHomeSelectionMode((current) => {
      if (current) {
        setSelectedHomeChatIds([])
        setBulkFolderValue('')
      }
      return !current
    })
  }

  const toggleHomeChatSelection = (id: string) => {
    setSelectedHomeChatIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  }

  const selectAllVisibleHomeChats = () => {
    setSelectedHomeChatIds((current) =>
      current.length === visibleHomeChatIds.length ? [] : visibleHomeChatIds,
    )
  }

  const moveSelectedHomeChats = async () => {
    if (!selectedHomeChatIds.length) return
    const folder = bulkFolderValue.trim()
    const now = new Date().toISOString()
    const selectedSet = new Set(selectedHomeChatIds)
    const next = sameChatOrder(
      chats.map((chat) =>
        selectedSet.has(chat.id) ? { ...chat, folder, updatedAt: now } : chat,
      ),
    )
    markImportantChange()
    setChats(next)
    await saveChats(next.filter((chat) => selectedSet.has(chat.id)))
    setSelectedHomeChatIds([])
    setBulkFolderValue('')
    setNotice(
      folder
        ? `${selectedSet.size}개 채팅을 폴더로 이동했습니다.`
        : `${selectedSet.size}개 채팅의 폴더를 해제했습니다.`,
    )
  }

  const deleteSelectedHomeChats = async () => {
    if (!selectedHomeChatIds.length) return
    const count = selectedHomeChatIds.length
    const ok = window.confirm(`선택한 ${count}개 채팅을 삭제할까요?`)
    if (!ok) return
    const selectedSet = new Set(selectedHomeChatIds)
    await Promise.all(selectedHomeChatIds.map((id) => deleteChat(id)))
    const next = chats.filter((chat) => !selectedSet.has(chat.id))
    markImportantChange()
    setChats(next)
    if (selectedId && selectedSet.has(selectedId)) setSelectedId(next[0]?.id)
    setSelectedHomeChatIds([])
    setBulkFolderValue('')
    setNotice(`${count}개 채팅을 삭제했습니다.`)
  }

  const updateFavoriteScrollState = useCallback(() => {
    const rail = favoriteRailRef.current
    if (!rail) {
      setFavoriteScrollState({ canScrollLeft: false, canScrollRight: false })
      return
    }
    const edgeTolerance = 12
    const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth)
    const next = {
      canScrollLeft: rail.scrollLeft > edgeTolerance,
      canScrollRight:
        maxLeft > edgeTolerance && rail.scrollLeft < maxLeft - edgeTolerance,
    }
    setFavoriteScrollState((current) =>
      current.canScrollLeft === next.canScrollLeft &&
      current.canScrollRight === next.canScrollRight
        ? current
        : next,
    )
  }, [])

  useEffect(() => {
    const rail = favoriteRailRef.current
    if (!rail) {
      setFavoriteScrollState({ canScrollLeft: false, canScrollRight: false })
      return
    }

    const frame = window.requestAnimationFrame(() => {
      rail.scrollLeft = 0
      updateFavoriteScrollState()
    })
    rail.addEventListener('scroll', updateFavoriteScrollState, { passive: true })
    window.addEventListener('resize', updateFavoriteScrollState)

    return () => {
      window.cancelAnimationFrame(frame)
      rail.removeEventListener('scroll', updateFavoriteScrollState)
      window.removeEventListener('resize', updateFavoriteScrollState)
    }
  }, [
    favoriteChats,
    homeSelectionMode,
    settings.homeCardImageMode,
    settings.homeCardLayoutMode,
    updateFavoriteScrollState,
  ])

  const scrollFavoriteRail = (direction: -1 | 1) => {
    const rail = favoriteRailRef.current
    if (!rail) return
    rail.scrollBy({
      left: direction * Math.max(260, rail.clientWidth * 0.72),
      behavior: 'smooth',
    })
    window.setTimeout(updateFavoriteScrollState, 260)
  }

  const renderChatCard = (
    chat: ViewerChat,
    options?: {
      imageMode?: ViewerSettings['homeCardImageMode']
      layoutMode?: ViewerSettings['homeCardLayoutMode']
      draggable?: boolean
    },
  ) => {
    const percent = readingPercent(chat)
    const progressLabel = percent === 100 ? '읽음' : `${percent}%`
    const layoutMode = options?.layoutMode ?? settings.homeCardLayoutMode
    const imageMode = options?.imageMode ?? settings.homeCardImageMode
    const simpleMode = layoutMode === 'simple'
    const showAvatarCover = imageMode === 'avatar'
    const cover = showAvatarCover ? chat.characterAvatar : chat.coverImage
    const selected = selectedHomeChatIds.includes(chat.id)
    const canDrag = Boolean(options?.draggable && !homeSelectionMode)
    return (
      <article
        key={chat.id}
        className={[
          'chat-card',
          simpleMode ? 'chat-card-simple' : '',
          selected ? 'selected' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        draggable={canDrag}
        onClick={() =>
          homeSelectionMode ? toggleHomeChatSelection(chat.id) : openChat(chat.id)
        }
        onDragStart={
          canDrag ? () => setDraggedChatId(chat.id) : undefined
        }
        onDragOver={canDrag ? (event) => event.preventDefault() : undefined}
        onDrop={canDrag ? () => void reorderChat(chat.id) : undefined}
      >
        {homeSelectionMode && (
          <span className="card-select-indicator" aria-hidden="true">
            {selected ? <Check size={14} /> : null}
          </span>
        )}
        <div className={simpleMode ? 'card-avatar-cover' : 'card-cover'}>
          {cover ? (
            <img
              src={cover}
              alt=""
              style={
                showAvatarCover
                  ? avatarImageStyle(chat.characterAvatarCrop)
                  : undefined
              }
            />
          ) : (
            <span className="card-initial">{chat.title.slice(0, 1)}</span>
          )}
        </div>
        <div className="card-body">
          <button
            type="button"
            className={chat.favorite ? 'card-fav active' : 'card-fav'}
            title={chat.favorite ? '즐겨찾기 해제' : '즐겨찾기'}
            onClick={(event) => {
              event.stopPropagation()
              void toggleFavorite(chat)
            }}
          >
            <Star size={15} fill={chat.favorite ? 'currentColor' : 'none'} />
          </button>
          {!simpleMode && percent > 0 && (
            <span className="card-progress">
              {progressLabel}
            </span>
          )}
          <div className="card-info">
            <strong>{chat.title}</strong>
            <small>
              {chat.characterName ?? '캐릭터 미상'} · {chat.messages.length}개
              {simpleMode && percent > 0 && (
                <span className="card-progress-inline">{progressLabel}</span>
              )}
            </small>
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="app-root" style={appStyle}>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        onChange={(event) => void importChatFiles(event.currentTarget.files)}
      />
      <input
        ref={backupInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void restoreBackup(event.currentTarget.files)}
      />
      <input
        ref={coverInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => void importCoverImage(event.currentTarget.files)}
      />
      <input
        ref={assetInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,.zip,application/zip"
        multiple
        onChange={(event) => void importAssets(event.currentTarget.files)}
      />
      <input
        ref={charAvatarInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => void importCharacterAvatar(event.currentTarget.files)}
      />
      <input
        ref={userAvatarInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => void importUserAvatar(event.currentTarget.files)}
      />
      <input
        ref={bannerInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => void importHomeBanner(event.currentTarget.files)}
      />
      <input
        ref={logoInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => void importHomeLogo(event.currentTarget.files)}
      />

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}

      {view === 'home' && (
        <div className={homeSelectionMode ? 'home selecting' : 'home'}>
          {homeBanner && (
            <div className="home-banner">
              <img src={homeBanner} alt="" />
              <div className="home-banner-actions">
                <button
                  type="button"
                  className="icon-button"
                  title="배너 변경"
                  onClick={() => bannerInputRef.current?.click()}
                >
                  <ImageUp size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="배너 삭제"
                  onClick={() => void removeHomeBanner()}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
          <header className="home-top">
            <div className="brand">
              <button
                type="button"
                className={homeLogo ? 'brand-mark has-logo' : 'brand-mark'}
                title="로고 이미지 변경"
                onClick={() => logoInputRef.current?.click()}
              >
                {homeLogo ? (
                  <img src={homeLogo} alt="" />
                ) : (
                  <Sparkles size={18} />
                )}
              </button>
              <div>
                <span className="eyebrow">SILLYTAVERN</span>
                <h1>{settings.homeTitle || '나의 서랍'}</h1>
              </div>
            </div>
            <label className="home-search">
              <Search size={16} />
              <input
                value={homeQuery}
                onChange={(event) => setHomeQuery(event.currentTarget.value)}
                placeholder="채팅 제목·폴더 검색"
              />
            </label>
            <div className="home-actions">
              <button
                type="button"
                className="btn-accent"
                title="채팅 추가"
                onClick={openChatImport}
              >
                <Plus size={16} />
                <span className="btn-accent-label">채팅 추가</span>
              </button>
              <button
                type="button"
                className="icon-button"
                title={homeSelectionMode ? '일괄 관리 닫기' : '채팅 일괄 관리'}
                onClick={toggleHomeSelectionMode}
              >
                {homeSelectionMode ? <X size={18} /> : <Check size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                title="기기 백업"
                onClick={() => setBackupChoiceOpen(true)}
              >
                <Download size={18} />
              </button>
              {!isSingleFileBuild && (
                <button
                  type="button"
                  className={
                    driveState.connected
                      ? 'icon-button drive-home active'
                      : 'icon-button drive-home'
                  }
                  title="Google Drive"
                  onClick={() => setDriveModalOpen(true)}
                >
                  <Cloud size={18} />
                </button>
              )}
              {!homeBanner && (
                <button
                  type="button"
                  className="icon-button"
                  title="홈 배너 등록"
                  onClick={() => bannerInputRef.current?.click()}
                >
                  <ImageUp size={18} />
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                title="설정"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={18} />
              </button>
            </div>
          </header>

          {homeSelectionMode && (
            <section className="bulk-toolbar" aria-label="채팅 일괄 관리">
              <div>
                <strong>{selectedHomeChats.length}개 선택</strong>
                <span>삭제하거나 폴더를 한 번에 바꿀 수 있습니다.</span>
              </div>
              <div className="bulk-actions">
                <div className="bulk-action-row">
                  <button
                    type="button"
                    className="bulk-select-all"
                    onClick={selectAllVisibleHomeChats}
                  >
                    {selectedHomeChatIds.length === visibleHomeChatIds.length
                      ? '전체 해제'
                      : '전체 선택'}
                  </button>
                  <button
                    type="button"
                    className="danger-action bulk-delete"
                    onClick={() => void deleteSelectedHomeChats()}
                    disabled={!selectedHomeChatIds.length}
                  >
                    <Trash2 size={15} />
                    삭제
                  </button>
                </div>
                <div className="bulk-action-row">
                  <input
                    value={bulkFolderValue}
                    className="bulk-folder-select"
                    aria-label="이동할 폴더 이름"
                    list="bulk-folder-options"
                    placeholder="폴더 없음"
                    onChange={(event) => setBulkFolderValue(event.currentTarget.value)}
                  />
                  <datalist id="bulk-folder-options">
                    {folderOptions.map((folder) => (
                      <option key={folder} value={folder}>
                        {folder}
                      </option>
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className="bulk-apply-folder"
                    onClick={() => void moveSelectedHomeChats()}
                    disabled={!selectedHomeChatIds.length}
                  >
                    <Folder size={15} />
                    폴더 적용
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className={`home-body home-card-${settings.homeCardLayoutMode}`}>
            {chats.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <FileText size={40} />
                </span>
                <h2>서재가 비어 있어요</h2>
                <p>
                  SillyTavern에서 내보낸 <code>.jsonl</code> 채팅 파일을
                  <br />
                  추가하면 이곳에 예쁘게 정리됩니다.
                </p>
                <button
                  type="button"
                  className="btn-accent"
                  onClick={openChatImport}
                >
                  <Plus size={16} />
                  첫 채팅 불러오기
                </button>
              </div>
            ) : homeGroups.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <Search size={36} />
                </span>
                <h2>검색 결과가 없어요</h2>
                <p>다른 제목이나 폴더 이름으로 찾아보세요.</p>
              </div>
            ) : (
              <>
                {favoriteChats.length > 0 && (
                  <section className="shelf shelf-fav">
                    <div className="shelf-head shelf-head-static">
                      <Star size={16} className="fav-star" />
                      <h2>즐겨찾기</h2>
                      <span className="shelf-count">{favoriteChats.length}</span>
                    </div>
                    <div
                      className={[
                        'favorite-scroll',
                        favoriteScrollState.canScrollLeft ? 'has-more-left' : '',
                        favoriteScrollState.canScrollRight ? 'has-more-right' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {favoriteScrollState.canScrollLeft && (
                        <button
                          type="button"
                          className="favorite-nav favorite-nav-prev"
                          title="이전 즐겨찾기"
                          onClick={() => scrollFavoriteRail(-1)}
                        >
                          <ChevronLeft size={18} />
                        </button>
                      )}
                      <div className="favorite-rail" ref={favoriteRailRef}>
                        {favoriteChats.map((chat) =>
                          renderChatCard(chat, { layoutMode: 'basic' }),
                        )}
                      </div>
                      {favoriteScrollState.canScrollRight && (
                        <button
                          type="button"
                          className="favorite-nav favorite-nav-next"
                          title="다음 즐겨찾기"
                          onClick={() => scrollFavoriteRail(1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      )}
                    </div>
                  </section>
                )}
                {homeGroups.map(([folder, items]) => {
                  const collapsed = collapsedFolders[folder]
                  return (
                    <section className="shelf" key={folder}>
                      <button
                        type="button"
                        className="shelf-head"
                        onClick={() =>
                          setCollapsedFolders((current) => ({
                            ...current,
                            [folder]: !current[folder],
                          }))
                        }
                      >
                        <ChevronDown
                          size={16}
                          className={collapsed ? 'chevron collapsed' : 'chevron'}
                        />
                        <Folder size={16} />
                        <h2>{folder}</h2>
                        <span className="shelf-count">{items.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="card-grid">
                          {items.map((chat) =>
                            renderChatCard(chat, { draggable: true }),
                          )}
                        </div>
                      )}
                    </section>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {view === 'reader' && selectedChat && (
        <div
          className={`reader-screen ${settings.autoHideTopbar ? 'auto-hide-topbar' : ''} ${
            settings.autoHideTopbar && !readerTopbarVisible ? 'topbar-collapsed' : ''
          }`}
        >
          {settings.autoHideTopbar && !readerTopbarVisible && (
            <button
              type="button"
              className="topbar-reveal-strip"
              aria-label="읽기 메뉴 열기"
              onMouseEnter={() => setReaderTopbarVisible(true)}
              onClick={() => setReaderTopbarVisible(true)}
            />
          )}
          <header
            className={`reader-topbar ${
              settings.autoHideTopbar && !readerTopbarVisible ? 'is-collapsed' : ''
            }`}
            onMouseEnter={() => settings.autoHideTopbar && setReaderTopbarVisible(true)}
            onMouseLeave={() => settings.autoHideTopbar && setReaderTopbarVisible(false)}
          >
            <div className="topbar-row">
              <button
                type="button"
                className="icon-button"
                title="서재로"
                onClick={goHome}
              >
                <ArrowLeft size={18} />
              </button>
              <div className="topbar-title">
                <strong>{selectedChat.title}</strong>
                <span>
                  {currentMessage?.name ? `${currentMessage.name} · ` : ''}#
                  {currentReadIndex} / {lastIndex}
                </span>
              </div>
              <div className="topbar-actions">
                <button
                  type="button"
                  className="icon-button"
                  title="검색"
                  onClick={() => searchInputRef.current?.focus()}
                >
                  <Search size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="설정"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings size={18} />
                </button>
                <button
                  type="button"
                  className="btn-ghost tools-toggle"
                  onClick={() => setToolsOpen(true)}
                >
                  <SlidersHorizontal size={16} />
                  <span className="tools-label">도구</span>
                </button>
              </div>
            </div>
            {settings.showProgressBar && visibleMessages.length > 0 && (
              <div
                className="reader-progress-bar"
                title={`#${currentReadIndex} / ${lastIndex} · ${Math.round(readPercent)}%`}
              >
                <div
                  className="reader-progress-fill"
                  style={{ width: `${readPercent}%` }}
                />
              </div>
            )}
          </header>

          {continueTarget !== null && (
            <button
              type="button"
              className="continue-chip"
              onClick={() => {
                jumpToIndex(continueTarget)
                setContinueTarget(null)
              }}
            >
              <BookOpen size={15} />
              마지막으로 읽은 위치 #{continueTarget}로 이동
              <X
                size={14}
                onClick={(event) => {
                  event.stopPropagation()
                  setContinueTarget(null)
                }}
              />
            </button>
          )}

          <div className="reader-body">
            <header
              className={
                selectedChat.coverImage && settings.showCoverImage
                  ? `reader-header with-cover cover-${settings.coverImageMode}`
                  : 'reader-header'
              }
            >
              {selectedChat.coverImage && settings.showCoverImage && (
                <img className="cover-image" src={selectedChat.coverImage} alt="" />
              )}
              <div className="cover-controls">
                <button
                  type="button"
                  className="icon-button"
                  title={selectedChat.coverImage ? '커버 변경' : '커버 등록'}
                  onClick={() => coverInputRef.current?.click()}
                >
                  <ImageUp size={15} />
                </button>
                {selectedChat.coverImage && (
                  <button
                    type="button"
                    className="icon-button"
                    title="커버 삭제"
                    onClick={() => void removeCoverImage()}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="reader-title">
                <span className="eyebrow">
                  {visibleMessages.length} readable / {selectedChat.messages.length} total
                </span>
                <h2>{selectedChat.title}</h2>
                <p>
                  {selectedChat.characterName ?? 'No character metadata'}
                </p>
              </div>
            </header>

            <div className="search-bar">
              <Search size={17} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="본문/번역 검색"
              />
              <span>{query ? `${searchResults.length}개` : '검색'}</span>
            </div>

            {query && searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.slice(0, 8).map((message) => (
                  <button
                    type="button"
                    key={message.id}
                    onClick={() => showSearchResult(message)}
                  >
                    {selectedChat.title} #{message.index} ·{' '}
                    {stripMarkdownForSnippet(
                      message.rawTranslated ?? message.rawOriginal,
                    ).slice(0, 80)}
                  </button>
                ))}
              </div>
            )}

            <div className="message-list">
              {settings.readMode === 'scroll' && hasMoreAbove && (
                <button
                  type="button"
                  className="load-more-zone load-more-above"
                  onClick={loadMoreAbove}
                >
                  ↑ 위쪽 {Math.min(settings.scrollWindowSize, winStart)}개 더 보기
                </button>
              )}
              {displayMessages.map((message) => (
                <MessageCard
                  key={message.id}
                  chat={displaySelectedChat ?? selectedChat}
                  message={message}
                  note={notes.find((item) => item.messageId === message.id)}
                  settings={settings}
                  highlights={[
                    ...highlights.filter(
                      (highlight) => highlight.messageId === message.id,
                    ),
                    ...(searchFlash?.messageId === message.id ? [searchFlash] : []),
                  ]}
                  onBookmark={() => void toggleBookmark(message.id)}
                  onCopy={(text) => void copyMessageText(text)}
                  onSaveNote={(text) => void saveMessageNote(message, text)}
                  onSelectText={(text, point) => {
                    setSelectionPopup({
                      messageId: message.id,
                      text,
                      x: point.x,
                      y: point.y,
                    })
                  }}
                />
              ))}
              {settings.readMode === 'scroll' && hasMoreBelow && (
                <button
                  type="button"
                  className="load-more-zone load-more-below"
                  onClick={loadMoreBelow}
                >
                  ↓ 아래 {Math.min(settings.scrollWindowSize, visibleMessages.length - winEnd)}개 더 보기
                </button>
              )}
            </div>
          </div>

          <div className="reader-dock">
            {settings.readMode === 'page' ? (
              <>
                <button type="button" title="처음" onClick={() => setPage(0)}>
                  <SkipBack size={18} />
                </button>
                <button
                  type="button"
                  title="이전"
                  onClick={() =>
                    setPage((current) => clamp(current - 1, 0, pageCount - 1))
                  }
                >
                  <StepBack size={18} />
                </button>
                <span className="dock-status">
                  {page + 1}/{pageCount}
                </span>
                <button
                  type="button"
                  title="다음"
                  onClick={() =>
                    setPage((current) => clamp(current + 1, 0, pageCount - 1))
                  }
                >
                  <StepForward size={18} />
                </button>
                <button
                  type="button"
                  title="끝"
                  onClick={() => setPage(pageCount - 1)}
                >
                  <SkipForward size={18} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  title="맨 위"
                  onClick={() => {
                    resetScrollWindow(visibleMessages.length)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  <SkipBack size={18} />
                </button>
                <button type="button" title="이전" onClick={() => stepMessage(-1)}>
                  <StepBack size={18} />
                </button>
                <span className="dock-status">
                  #{currentReadIndex}/{lastIndex}
                </span>
                <button type="button" title="다음" onClick={() => stepMessage(1)}>
                  <StepForward size={18} />
                </button>
                <button
                  type="button"
                  title="맨 아래"
                  onClick={() => {
                    const total = visibleMessages.length
                    const chunk = Math.max(1, settings.scrollWindowSize)
                    setWinStart(Math.max(0, total - chunk))
                    setWinEnd(total)
                    window.setTimeout(
                      () =>
                        window.scrollTo({
                          top: document.body.scrollHeight,
                          behavior: 'smooth',
                        }),
                      60,
                    )
                  }}
                >
                  <SkipForward size={18} />
                </button>
              </>
            )}
            <span className="dock-divider" aria-hidden="true" />
            <input
              className="dock-jump"
              type="number"
              min={1}
              value={jumpValue}
              placeholder="번호"
              aria-label="이동할 메시지 번호"
              title="번호 입력 후 Enter"
              onChange={(event) => setJumpValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') jumpByNumber()
              }}
            />
          </div>

          {toolsOpen && (
            <button
              type="button"
              className="drawer-backdrop"
              aria-label="도구 닫기"
              onClick={() => setToolsOpen(false)}
            />
          )}
          <aside
            className={toolsOpen ? 'tools-drawer open' : 'tools-drawer'}
            aria-label="채팅 도구"
          >
            <div className="drawer-head">
              <h2>
                <SlidersHorizontal size={16} />
                도구
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setToolsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <section className="panel">
              <h2>
                <BookOpen size={16} />
                채팅 정보
              </h2>
          {selectedChat ? (
            <>
              <label>
                제목
                <input
                  value={selectedChat.title}
                  onChange={(event) =>
                    updateSelectedChatFields({ title: event.currentTarget.value })
                  }
                />
              </label>
              <FolderField
                value={selectedChat.folder}
                folderOptions={folderOptions}
                onChange={(folder) => updateSelectedChatFields({ folder })}
              />
              <div className="stacked-buttons chat-info-actions">
                <button type="button" onClick={() => void toggleFavorite(selectedChat)}>
                  <Star
                    size={16}
                    fill={selectedChat.favorite ? 'currentColor' : 'none'}
                  />
                  {selectedChat.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                </button>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                >
                  <Image size={16} />
                  커버 이미지 등록
                </button>
                {selectedChat.coverImage && (
                  <label className="tool-inline-control">
                    채팅창 커버 위치(%) {settings.coverPosition}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings.coverPosition}
                      disabled={!settings.showCoverImage}
                      onChange={(event) =>
                        updateSettings({
                          coverPosition: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => charAvatarInputRef.current?.click()}
                >
                  <ImageUp size={16} />
                  캐릭터 아바타 등록
                </button>
                {selectedChat.characterAvatar && (
                  <AvatarAdjuster
                    title="캐릭터 아바타 위치"
                    image={selectedChat.characterAvatar}
                    crop={selectedChat.characterAvatarCrop}
                    onChange={(crop) =>
                      updateSelectedChatFields({ characterAvatarCrop: crop })
                    }
                  />
                )}
                <button
                  type="button"
                  onClick={() => userAvatarInputRef.current?.click()}
                >
                  <ImageUp size={16} />
                  유저 아바타 등록
                </button>
                {selectedChat.userAvatar && (
                  <AvatarAdjuster
                    title="유저 아바타 위치"
                    image={selectedChat.userAvatar}
                    crop={selectedChat.userAvatarCrop}
                    onChange={(crop) =>
                      updateSelectedChatFields({ userAvatarCrop: crop })
                    }
                  />
                )}
                <button type="button" onClick={() => void removeSelectedChat()}>
                  <Trash2 size={16} />
                  채팅 삭제
                </button>
              </div>
              <details className="file-detail">
                <summary>원본 파일 정보</summary>
                <p>{selectedChat.sourceFileName}</p>
              </details>
            </>
          ) : (
            <p className="muted">선택된 채팅이 없습니다.</p>
          )}
        </section>

        <section className="panel">
          <h2>
            <Image size={16} />
            이미지 에셋
          </h2>
          {selectedChat ? (
            <>
              <div className="stacked-buttons">
                <button type="button" onClick={() => assetInputRef.current?.click()}>
                  <Image size={16} />
                  기기에서 등록
                </button>
                {!isSingleFileBuild && (
                  <button
                    type="button"
                    onClick={() => void importDriveAssets()}
                    disabled={!driveState.connected || driveBusy}
                    title={
                      driveState.connected
                        ? 'Google Drive에서 이미지 또는 zip을 선택합니다.'
                        : 'Google Drive 연결 후 사용할 수 있습니다.'
                    }
                  >
                    <Cloud size={16} />
                    Drive에서 등록
                  </button>
                )}
                <button type="button" onClick={() => setAssetGalleryOpen(true)}>
                  <BookOpen size={16} />
                  챗서랍에서 연동
                </button>
              </div>
              <label>
                에셋 표시 방식
                <select
                  value={selectedChat.assetDisplayMode ?? 'default'}
                  onChange={(event) =>
                    updateSelectedChatFields({
                      assetDisplayMode:
                        event.currentTarget
                          .value as ViewerChat['assetDisplayMode'],
                    })
                  }
                >
                  <option value="default">기본</option>
                  <option value="framed">테두리</option>
                </select>
              </label>
              <div className="asset-list">
                <span className="asset-list-title">
                  현재 채팅에 연결된 에셋
                </span>
                {currentAssetBundles.length ? (
                  <div className="asset-summary">
                    <p>
                      <strong>{currentAssetBundles.length}개 묶음</strong>
                      <span>이미지 {currentAssets.length}개</span>
                    </p>
                    {currentAssetBundles.map((bundle) => (
                      <div className="asset-summary-row" key={bundle.id}>
                        <span title={bundle.name}>{bundle.name}</span>
                        <small>{bundle.assets.length}개</small>
                        <button
                          type="button"
                          title="에셋 묶음 연결 해제"
                          onClick={() => void unlinkAssetBundleFromSelectedChat(bundle)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">연결된 이미지 에셋이 없습니다.</p>
                )}
              </div>
              <p className="muted">{'{{img::파일명}}'} 치환 지원</p>
            </>
          ) : (
            <p className="muted">선택된 채팅이 없습니다.</p>
          )}
        </section>

        <WordMaskPanel
          chat={selectedChat}
          onUpdate={updateSelectedChatFields}
        />

        <section className="panel">
          <h2>
            <StepForward size={16} />
            보기 방식
          </h2>
          <label>
            보기 방식
            <select
              value={settings.readMode}
              onChange={(event) =>
                updateSettings({
                  readMode: event.currentTarget.value as ViewerSettings['readMode'],
                })
              }
            >
              <option value="scroll">스크롤</option>
              <option value="page">페이지</option>
            </select>
          </label>
        </section>

        <section className="panel">
          <h2>
            <Eye size={16} />
            태그 표시
          </h2>
          {tagNames.length ? (
            tagNames.map((name) => (
              <label key={name}>
                &lt;{name}&gt;
                <select
                  value={settings.tagModes[name] ?? 'collapsed'}
                  onChange={(event) =>
                    updateSettings({
                      tagModes: {
                        ...settings.tagModes,
                        [name]: event.currentTarget.value as TagDisplayMode,
                      },
                    })
                  }
                >
                  <option value="collapsed">접어서 표시</option>
                  <option value="expanded">펼쳐서 표시</option>
                  <option value="hidden">숨김</option>
                </select>
              </label>
            ))
          ) : (
            <p className="muted">감지된 태그가 없습니다.</p>
          )}
        </section>

        <section className="panel">
          <h2>
            <Bookmark size={16} />
            북마크
          </h2>
          {bookmarkedMessages.length ? (
            <div className="bookmark-list">
              {bookmarkedMessages.map((message) => (
                <button
                  key={message.id}
                  type="button"
                  onClick={() =>
                    positionForMessage(message, { includeHiddenIfNeeded: true })
                  }
                >
                  {selectedChat?.title} #{message.index}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">아직 북마크가 없습니다.</p>
          )}
        </section>

        {settings.notesEnabled && (
          <section className="panel">
            <h2>
              <StickyNote size={16} />
              메모
            </h2>
            <button type="button" onClick={() => setNotesModalOpen(true)}>
              <StickyNote size={16} />
              메모 모아보기
            </button>
            <p className="muted">
              {notes.length
                ? `${notes.length}개 메모가 저장되어 있습니다.`
                : '메시지의 메모 버튼으로 포스트잇을 남길 수 있습니다.'}
            </p>
          </section>
        )}

        {settings.highlightEnabled && (
          <section className="panel">
            <h2>
              <Palette size={16} />
              하이라이트
            </h2>
            <button type="button" onClick={() => setHighlightModalOpen(true)}>
              <Palette size={16} />
              하이라이트 모아보기
            </button>
            <p className="muted">
              {highlights.length
                ? `${highlights.length}개 문장이 저장되어 있습니다.`
                : '메시지 문장을 드래그한 뒤 뜨는 버튼을 누르면 저장됩니다.'}
            </p>
          </section>
        )}

            </aside>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          homeLogo={homeLogo}
          onHomeLogoPick={() => logoInputRef.current?.click()}
          onHomeLogoRemove={() => void removeHomeLogo()}
          onClose={() => setSettingsOpen(false)}
          onUpdate={updateSettings}
          onResetSettings={resetSettings}
          onResetAll={() => void resetEverything()}
        />
      )}

      {importChoiceOpen && (
        <ImportChoiceModal
          driveConnected={driveState.connected}
          driveBusy={driveBusy}
          onClose={() => setImportChoiceOpen(false)}
          onPickLocal={() => {
            setImportChoiceOpen(false)
            fileInputRef.current?.click()
          }}
          onPickDrive={() => {
            setImportChoiceOpen(false)
            void importDriveJsonl()
          }}
          onOpenDriveSettings={() => {
            setImportChoiceOpen(false)
            setDriveModalOpen(true)
          }}
        />
      )}

      {backupChoiceOpen && (
        <BackupChoiceModal
          excludeImageAssets={excludeImageAssetsFromBackup}
          onExcludeImageAssetsChange={setExcludeImageAssetsFromBackup}
          onClose={() => setBackupChoiceOpen(false)}
          onExport={() => {
            setBackupChoiceOpen(false)
            void exportBackup()
          }}
          onImport={() => {
            setBackupChoiceOpen(false)
            backupInputRef.current?.click()
          }}
        />
      )}

      {assetGalleryOpen && selectedChat && (
        <AssetGalleryModal
          assets={assetLibrary}
          linkedIds={selectedAssetIds}
          onClose={() => setAssetGalleryOpen(false)}
          onLink={(assetIds) => {
            setAssetGalleryOpen(false)
            void linkAssetIdsToSelectedChat(assetIds)
          }}
          onDelete={(assetIds) => void deleteLibraryAssets(assetIds)}
        />
      )}

      {!isSingleFileBuild && driveModalOpen && (
        <DriveModal
          driveState={driveState}
          driveBusy={driveBusy}
          remoteBackup={remoteBackup}
          driveBackups={driveBackups}
          driveBackupsLoaded={driveBackupsLoaded}
          excludeImageAssets={excludeImageAssetsFromBackup}
          onClose={() => setDriveModalOpen(false)}
          onExcludeImageAssetsChange={setExcludeImageAssetsFromBackup}
          onDriveConnect={() => void connectGoogleDrive()}
          onDriveDisconnect={disconnectGoogleDrive}
          onDriveBackupNow={() => void saveDriveBackup()}
          onDriveRestoreLatest={() => void restoreDriveBackup()}
          onDriveDismissRemote={() => {
            if (!remoteBackup) return
            setDriveState((current) => ({
              ...current,
              pausedForRemoteBackupId: remoteBackup.id,
            }))
            setRemoteBackup(null)
            setNotice('Drive 복원을 나중에 다시 확인할 수 있습니다.')
          }}
        />
      )}

      {highlightModalOpen && selectedChat && (
        <HighlightModal
          chat={selectedChat}
          highlights={highlights}
          defaultHighlightColor={settings.defaultHighlightColor}
          onClose={() => setHighlightModalOpen(false)}
          onDelete={(highlightId) => void removeHighlight(highlightId)}
          onGoMessage={(highlight) => {
            jumpToIndex(highlight.messageIndex)
            setHighlightModalOpen(false)
          }}
        />
      )}

      {notesModalOpen && selectedChat && (
        <NotesModal
          chat={selectedChat}
          notes={notes}
          onClose={() => setNotesModalOpen(false)}
          onSave={(messageId, text) => {
            const message = selectedChat.messages.find((item) => item.id === messageId)
            if (message) void saveMessageNote(message, text)
          }}
          onGoMessage={(note) => {
            jumpToIndex(note.messageIndex)
            setNotesModalOpen(false)
          }}
        />
      )}

        {selectionPopup && settings.highlightEnabled && (
          <div
            ref={selectionPopupRef}
            className="selection-toolbar"
            style={{ left: `${selectionPopup.x}px`, top: `${selectionPopup.y}px` }}
          >
            {settings.highlightColors.map((color) => (
              <button
                key={color}
                type="button"
                className="highlight-swatch"
                title={`${color} 색으로 하이라이트`}
                style={{ backgroundColor: color }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const message = selectedChat?.messages.find(
                    (item) => item.id === selectionPopup.messageId,
                  )
                  if (message) void addHighlight(message, selectionPopup.text, color)
                  setSelectionPopup(null)
                  window.getSelection()?.removeAllRanges()
                }}
              />
            ))}
          </div>
        )}
    </div>
  )
}

interface MessageCardProps {
  chat: ViewerChat
  message: ViewerMessage
  note?: MessageNote
  settings: ViewerSettings
  highlights: MessageHighlight[]
  onBookmark: () => void
  onCopy: (text: string) => void
  onSaveNote: (text: string) => void
  onSelectText: (
    text: string,
    point: { x: number; y: number },
  ) => void
}

function MessageCard({
  chat,
  message,
  note,
  settings,
  highlights,
  onBookmark,
  onCopy,
  onSaveNote,
  onSelectText,
}: MessageCardProps) {
  const [swipeIndex, setSwipeIndex] = useState(message.metadata.swipeId ?? 0)
  const hasMultipleSwipes = message.swipes.length > 1
  const activeSwipe = hasMultipleSwipes ? message.swipes[swipeIndex] : undefined
  const displayMessage = activeSwipe
    ? {
        rawOriginal: activeSwipe.rawOriginal,
        rawTranslated: activeSwipe.rawTranslated,
        reasoning: activeSwipe.reasoning,
        metadata: activeSwipe.metadata,
      }
    : message
  const roleLabel =
    message.role === 'user'
      ? 'User'
      : message.role === 'system'
        ? 'System'
        : 'AI'
  const scanSelection = useCallback(
    (container: HTMLElement) => {
      if (!settings.highlightEnabled) return
      const selection = window.getSelection()
      const selectedText = selection?.toString().trim()
      if (!selectedText) return
      const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
      if (!range || !container.contains(range.commonAncestorContainer)) return
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      )
      const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
      if (!rect || (rect.width <= 0 && rect.height <= 0)) return
      const x = clamp(rect.left + rect.width / 2, 22, window.innerWidth - 22)
      const y = clamp(rect.top - 10, 54, window.innerHeight - 12)
      onSelectText(selectedText, { x, y })
    },
    [onSelectText, settings.highlightEnabled],
  )
  const scheduleSelectionScan = useCallback(
    (container: HTMLElement, delay = 120) => {
      window.setTimeout(() => scanSelection(container), delay)
    },
    [scanSelection],
  )

  return (
    <article
      id={message.id}
      data-message-index={message.index}
      className={`message-card role-${message.role}`}
      onMouseUp={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return
        scanSelection(event.currentTarget)
      }}
      onTouchEnd={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return
        scheduleSelectionScan(event.currentTarget, 120)
        scheduleSelectionScan(event.currentTarget, 360)
      }}
    >
      <div className="message-head">
        <div className="message-who">
          {settings.showAvatars &&
            (() => {
              const avatar =
                message.role === 'user' ? chat.userAvatar : chat.characterAvatar
              const crop =
                message.role === 'user'
                  ? chat.userAvatarCrop
                  : chat.characterAvatarCrop
              const label = message.name ?? roleLabel
              return (
                <span className={`avatar avatar-${message.role}`} aria-hidden="true">
                  {avatar ? (
                    <img src={avatar} alt="" style={avatarImageStyle(crop)} />
                  ) : (
                    label.slice(0, 1)
                  )}
                </span>
              )
            })()}
          <span className="message-name">
            {settings.showRoleBadges && (
              <span className="role-pill">{roleLabel}</span>
            )}
            <strong>{message.name ?? roleLabel}</strong>
          </span>
        </div>
        <div className="message-tools">
          <button
            type="button"
            title={message.bookmarked ? '북마크 해제' : '북마크'}
            onClick={onBookmark}
          >
            {message.bookmarked ? (
              <BookmarkCheck size={16} />
            ) : (
              <Bookmark size={16} />
            )}
          </button>
          <button
            type="button"
            title="메시지 전체 복사"
            onClick={() => {
              const original = displayMessage.rawOriginal ?? ''
              const translated = displayMessage.rawTranslated
              let text = translated ?? original
              if (settings.languageMode === 'original') text = original
              else if (settings.languageMode === 'both' && translated)
                text = `${translated}\n\n${original}`
              text = applyWordMasksToText(
                text,
                activeWordMaskRules(chat, { forCopy: true }),
              )
              onCopy(text)
            }}
          >
            <Copy size={16} />
          </button>
        </div>
      </div>

      {hasMultipleSwipes && (
        <div className="swipe-switcher">
          <button
            type="button"
            title="이전 응답"
            onClick={() =>
              setSwipeIndex((current) => clamp(current - 1, 0, message.swipes.length - 1))
            }
          >
            <StepBack size={15} />
          </button>
          <span>
            {swipeIndex + 1}/{message.swipes.length}
          </span>
          <button
            type="button"
            title="다음 응답"
            onClick={() =>
              setSwipeIndex((current) => clamp(current + 1, 0, message.swipes.length - 1))
            }
          >
            <StepForward size={15} />
          </button>
        </div>
      )}

      {displayMessage.reasoning && !settings.hideAiThinking && (
        <details className="reasoning">
          <summary>AI 추론 표시</summary>
          <pre>{displayMessage.reasoning}</pre>
        </details>
      )}

      <MessageBodies
        chat={chat}
        message={{
          ...message,
          rawOriginal: displayMessage.rawOriginal,
          rawTranslated: displayMessage.rawTranslated,
        }}
        settings={settings}
        highlights={highlights}
      />

      {settings.notesEnabled && <NoteEditor note={note} onSave={onSaveNote} />}

      <footer className="message-meta">
        <span>#{message.index}</span>
        {message.hiddenByST && <span>ST hidden</span>}
        {settings.showMessageMeta && (
          <>
            {displayMessage.metadata.sendDate && (
              <span>{formatDate(displayMessage.metadata.sendDate)}</span>
            )}
            {displayMessage.metadata.model && (
              <span>{displayMessage.metadata.model}</span>
            )}
            {displayMessage.metadata.api && <span>{displayMessage.metadata.api}</span>}
            {displayMessage.metadata.tokenCount && (
              <span>{displayMessage.metadata.tokenCount} tokens</span>
            )}
            {displayMessage.metadata.swipeCount && (
              <span>
                swipe {(displayMessage.metadata.swipeId ?? 0) + 1}/
                {displayMessage.metadata.swipeCount}
              </span>
            )}
          </>
        )}
      </footer>
    </article>
  )
}

function MessageBodies({
  chat,
  message,
  settings,
  highlights,
}: {
  chat: ViewerChat
  message: ViewerMessage
  settings: ViewerSettings
  highlights: MessageHighlight[]
}) {
  const hasTranslated = Boolean(message.rawTranslated)
  const maskRules = activeWordMaskRules(chat)

  if (settings.languageMode === 'both' && hasTranslated) {
    return (
      <div className="dual-body">
        <TextBlock
          label="번역"
          text={message.rawTranslated ?? ''}
          assets={chat.assets}
          settings={settings}
          highlights={highlights}
          maskRules={maskRules}
          assetDisplayMode={chat.assetDisplayMode ?? 'default'}
          tone="translated"
        />
        <TextBlock
          label="원문"
          text={message.rawOriginal}
          assets={chat.assets}
          settings={settings}
          highlights={highlights}
          maskRules={maskRules}
          assetDisplayMode={chat.assetDisplayMode ?? 'default'}
          tone="original"
        />
      </div>
    )
  }

  const text =
    settings.languageMode === 'original'
      ? message.rawOriginal
      : message.rawTranslated ?? message.rawOriginal

  return (
    <TextBlock
      label={
        settings.languageMode === 'original'
          ? '원문'
          : hasTranslated
            ? '번역'
            : undefined
      }
      text={text}
      assets={chat.assets}
      settings={settings}
      highlights={highlights}
      maskRules={maskRules}
      assetDisplayMode={chat.assetDisplayMode ?? 'default'}
    />
  )
}

function TextBlock({
  label,
  text,
  assets,
  settings,
  highlights,
  maskRules,
  assetDisplayMode,
  tone,
}: {
  label?: string
  text: string
  assets: ChatAsset[]
  settings: ViewerSettings
  highlights: MessageHighlight[]
  maskRules: WordMaskRule[]
  assetDisplayMode: ViewerChat['assetDisplayMode']
  tone?: 'translated' | 'original'
}) {
  const parts = useMemo(() => splitTaggedText(text), [text])
  const segments = parts.segments.length
    ? parts.segments
    : [{ id: 'body', type: 'text' as const, text }]

  return (
    <section className={tone ? `text-block ${tone}` : 'text-block'}>
      {label && <span className="text-label">{label}</span>}
      <div className="text-flow">
        {segments.map((segment) =>
          segment.type === 'tag' ? (
            <TagPanel key={segment.id} tag={segment.tag} settings={settings} />
          ) : (
            <MarkdownChunk
              key={segment.id}
              text={segment.text}
              assets={assets}
              settings={settings}
              highlights={highlights}
              maskRules={maskRules}
              assetDisplayMode={assetDisplayMode}
            />
          ),
        )}
      </div>
    </section>
  )
}

function MarkdownChunk({
  text,
  assets,
  settings,
  highlights,
  maskRules,
  assetDisplayMode,
}: {
  text: string
  assets: ChatAsset[]
  settings: ViewerSettings
  highlights: MessageHighlight[]
  maskRules: WordMaskRule[]
  assetDisplayMode: ViewerChat['assetDisplayMode']
}) {
  const placeholderAssets = useMemo(
    () => selectImagePlaceholderAssets(text, assets),
    [assets, text],
  )
  const [runtimeAssets, setRuntimeAssets] = useState<ChatAsset[]>([])

  useEffect(() => {
    let cancelled = false
    const objectUrls: string[] = []

    const loadAssets = async () => {
      if (!placeholderAssets.length) {
        if (!cancelled) {
          setRuntimeAssets((current) => (current.length ? [] : current))
        }
        return
      }

      const loadedAssets = await Promise.all(
        placeholderAssets.map(async (asset) => {
          if (asset.dataUrl) return asset
          const blobRecord = await getAssetBlob(asset.blobKey || asset.id)
          if (!blobRecord) return asset
          const objectUrl = URL.createObjectURL(blobRecord.blob)
          objectUrls.push(objectUrl)
          return { ...asset, dataUrl: objectUrl }
        }),
      )

      if (cancelled) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url))
        return
      }
      setRuntimeAssets(loadedAssets)
    }

    void loadAssets()

    return () => {
      cancelled = true
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [placeholderAssets])

  const html = useMemo(
    () => renderMarkdown(text, runtimeAssets),
    [runtimeAssets, text],
  )
  const bodyRef = useRef<HTMLDivElement>(null)
  const highlightSignature = useMemo(
    () => highlights.map((item) => `${item.id}:${item.color ?? ''}:${item.text}`).join('|'),
    [highlights],
  )
  const maskSignature = useMemo(
    () => maskRules.map((rule) => `${rule.id}:${rule.source}:${rule.replacement}`).join('|'),
    [maskRules],
  )

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.innerHTML = html
    if (highlights.length) {
      applyHighlightsToElement(el, highlights, settings.defaultHighlightColor)
    }
    if (maskRules.length) {
      applyWordMasksToElement(el, maskRules)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightSignature, maskSignature, settings.defaultHighlightColor])

  if (!text.trim()) return null

  return (
    <div
      ref={bodyRef}
      className={`markdown-body asset-display-${assetDisplayMode ?? 'default'}`}
    />
  )
}

function TagPanel({
  tag,
  settings,
}: {
  tag: ParsedTag
  settings: ViewerSettings
}) {
  const mode = settings.tagModes[tag.name] ?? 'collapsed'
  if (mode === 'hidden') return null
  return (
    <details className="tag-panel" open={mode === 'expanded'}>
      <summary>&lt;{tag.name}&gt;</summary>
      <pre>{tag.raw}</pre>
    </details>
  )
}

function NoteEditor({
  note,
  onSave,
}: {
  note?: MessageNote
  onSave: (text: string) => void
}) {
  const [draft, setDraft] = useState(note?.text ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(note?.text ?? '')
    setSaved(false)
  }, [note?.text])

  const hasText = draft.trim().length > 0

  return (
    <details className="message-note" open={Boolean(note?.text)}>
      <summary>
        <StickyNote size={15} />
        메모
      </summary>
      <textarea
        value={draft}
        placeholder="이 메시지에 남길 메모"
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          setSaved(false)
        }}
      />
      {hasText && !saved && (
        <div className="note-actions">
          <button
            type="button"
            onClick={() => {
              onSave(draft)
              setSaved(true)
            }}
          >
            저장
          </button>
          {note?.text && (
            <button
              type="button"
              onClick={() => {
                setDraft('')
                onSave('')
              }}
            >
              삭제
            </button>
          )}
        </div>
      )}
    </details>
  )
}

function HighlightModal({
  chat,
  highlights,
  defaultHighlightColor,
  onClose,
  onDelete,
  onGoMessage,
}: {
  chat: ViewerChat
  highlights: MessageHighlight[]
  defaultHighlightColor: string
  onClose: () => void
  onDelete: (highlightId: string) => void
  onGoMessage: (highlight: MessageHighlight) => void
}) {
  const [activeColor, setActiveColor] = useState<string>('all')
  const colorGroups = useMemo(() => {
    const groups = new Map<string, MessageHighlight[]>()
    for (const highlight of highlights) {
      const color = highlight.color ?? defaultHighlightColor
      groups.set(color, [...(groups.get(color) ?? []), highlight])
    }
    return [...groups.entries()].map(([color, items]) => ({ color, items }))
  }, [defaultHighlightColor, highlights])
  const visibleHighlights =
    activeColor === 'all'
      ? highlights
      : highlights.filter(
          (highlight) => (highlight.color ?? defaultHighlightColor) === activeColor,
        )

  useEffect(() => {
    if (
      activeColor !== 'all' &&
      !colorGroups.some((group) => group.color === activeColor)
    ) {
      setActiveColor('all')
    }
  }, [activeColor, colorGroups])

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal highlight-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <span className="eyebrow">{chat.title}</span>
            <h2>하이라이트 모아보기</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {highlights.length ? (
          <>
            <div className="highlight-filter-bar" aria-label="하이라이트 색상 필터">
              <button
                type="button"
                className={activeColor === 'all' ? 'active' : ''}
                onClick={() => setActiveColor('all')}
              >
                전체 {highlights.length}
              </button>
              {colorGroups.map((group) => (
                <button
                  type="button"
                  key={group.color}
                  className={activeColor === group.color ? 'active' : ''}
                  style={{
                    '--filter-color': group.color,
                  } as CSSProperties}
                  onClick={() => setActiveColor(group.color)}
                >
                  <span aria-hidden="true" />
                  {group.items.length}
                </button>
              ))}
            </div>
            <div className="highlight-modal-list">
              {visibleHighlights.map((highlight) => {
                const message = chat.messages.find(
                  (item) => item.id === highlight.messageId,
                )
                const color = highlight.color ?? defaultHighlightColor
                return (
                  <article
                    className="highlight-card"
                    key={highlight.id}
                    style={{ '--highlight-card-color': color } as CSSProperties}
                  >
                    <div>
                      <span className="eyebrow">
                        #{highlight.messageIndex}
                        {message?.name ? ` · ${message.name}` : ''}
                      </span>
                      <p>{highlight.text}</p>
                    </div>
                    <div className="highlight-card-actions">
                      <button type="button" onClick={() => onGoMessage(highlight)}>
                        메시지로
                      </button>
                      <button
                        type="button"
                        title="하이라이트 삭제"
                        onClick={() => onDelete(highlight.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        ) : (
          <div className="empty-modal-state">
            <Palette size={34} />
            <p>아직 저장된 하이라이트가 없습니다.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function NotesModal({
  chat,
  notes,
  onClose,
  onSave,
  onGoMessage,
}: {
  chat: ViewerChat
  notes: MessageNote[]
  onClose: () => void
  onSave: (messageId: string, text: string) => void
  onGoMessage: (note: MessageNote) => void
}) {
  const ordered = [...notes].sort((a, b) => a.messageIndex - b.messageIndex)

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal highlight-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <span className="eyebrow">{chat.title}</span>
            <h2>메모 모아보기</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {ordered.length ? (
          <div className="highlight-modal-list">
            {ordered.map((note) => {
              const message = chat.messages.find((item) => item.id === note.messageId)
              return (
                <NotesModalCard
                  key={note.id}
                  note={note}
                  name={message?.name}
                  onSave={onSave}
                  onGoMessage={onGoMessage}
                />
              )
            })}
          </div>
        ) : (
          <div className="empty-modal-state">
            <StickyNote size={34} />
            <p>아직 저장된 메모가 없습니다.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function NotesModalCard({
  note,
  name,
  onSave,
  onGoMessage,
}: {
  note: MessageNote
  name?: string
  onSave: (messageId: string, text: string) => void
  onGoMessage: (note: MessageNote) => void
}) {
  const [draft, setDraft] = useState(note.text)

  useEffect(() => {
    setDraft(note.text)
  }, [note.text])

  return (
    <article className="highlight-card note-modal-card">
      <div>
        <span className="eyebrow">
          #{note.messageIndex}
          {name ? ` · ${name}` : ''}
        </span>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <div className="note-modal-actions">
          <button type="button" onClick={() => onSave(note.messageId, draft)}>
            저장
          </button>
          <button type="button" onClick={() => onGoMessage(note)}>
            메시지로
          </button>
          <button
            type="button"
            title="메모 삭제"
            onClick={() => onSave(note.messageId, '')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}

function FolderField({
  value,
  folderOptions,
  onChange,
}: {
  value: string
  folderOptions: string[]
  onChange: (folder: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const hasOptions = folderOptions.length > 0

  useEffect(() => {
    setAdding(false)
    setDraft('')
  }, [value])

  const saveDraft = () => {
    const next = draft.trim()
    if (!next) return
    onChange(next)
    setAdding(false)
    setDraft('')
  }

  return (
    <div className="folder-field">
      <span className="field-label">폴더</span>
      {adding ? (
        <div className={hasOptions ? 'folder-row with-cancel' : 'folder-row'}>
          <input
            value={draft}
            placeholder="새 폴더 이름"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveDraft()
            }}
          />
          <button type="button" onClick={saveDraft} disabled={!draft.trim()}>
            추가
          </button>
          {hasOptions && (
            <button
              type="button"
              className="folder-icon-button"
              title="취소"
              onClick={() => {
                setAdding(false)
                setDraft('')
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      ) : (
        <div className="folder-row">
          {hasOptions ? (
            <select
              value={value}
              onChange={(event) => onChange(event.currentTarget.value)}
            >
              <option value="">폴더 없음</option>
              {folderOptions.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          ) : (
            <span className="folder-empty">폴더 없음</span>
          )}
          <button type="button" onClick={() => setAdding(true)}>
            <Plus size={15} />
            추가
          </button>
        </div>
      )}
    </div>
  )
}

function AvatarAdjuster({
  title,
  image,
  crop,
  onChange,
}: {
  title: string
  image: string
  crop?: AvatarCrop
  onChange: (crop: AvatarCrop) => void
}) {
  const normalized = normalizeAvatarCrop(crop)
  const updateCrop = (patch: Partial<AvatarCrop>) => {
    onChange(normalizeAvatarCrop({ ...normalized, ...patch }))
  }

  return (
    <div className="avatar-adjuster">
      <div className="avatar-adjuster-head">
        <span className="avatar-preview">
          <img src={image} alt="" style={avatarImageStyle(normalized)} />
        </span>
        <strong>{title}</strong>
      </div>
      <label>
        상하 위치 {normalized.y}%
        <input
          type="range"
          min={0}
          max={100}
          value={normalized.y}
          onChange={(event) => updateCrop({ y: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        확대 {normalized.scale.toFixed(1)}x
        <input
          type="range"
          min={1}
          max={2.6}
          step={0.1}
          value={normalized.scale}
          onChange={(event) =>
            updateCrop({ scale: Number(event.currentTarget.value) })
          }
        />
      </label>
    </div>
  )
}

function WordMaskPanel({
  chat,
  onUpdate,
}: {
  chat?: ViewerChat
  onUpdate: (patch: Partial<ViewerChat>) => void
}) {
  const [source, setSource] = useState('')
  const [replacement, setReplacement] = useState('')

  useEffect(() => {
    setSource('')
    setReplacement('')
  }, [chat?.id])

  if (!chat) {
    return (
      <section className="panel">
        <h2>
          <Eye size={16} />
          단어 마스킹
        </h2>
        <p className="muted">선택된 채팅이 없습니다.</p>
      </section>
    )
  }

  const rules = chat.wordMaskRules

  const addRule = () => {
    const nextSource = source.trim()
    if (!nextSource) return
    onUpdate({
      wordMaskRules: [
        ...rules,
        {
          id: makeId('mask'),
          source: nextSource,
          replacement,
        },
      ],
    })
    setSource('')
    setReplacement('')
  }

  const updateRule = (id: string, patch: Partial<WordMaskRule>) => {
    onUpdate({
      wordMaskRules: rules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    })
  }

  const removeRule = (id: string) => {
    onUpdate({
      wordMaskRules: rules.filter((rule) => rule.id !== id),
    })
  }

  return (
    <section className="panel">
      <h2>
        <Eye size={16} />
        단어 마스킹
      </h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={chat.wordMaskEnabled}
          onChange={(event) =>
            onUpdate({ wordMaskEnabled: event.currentTarget.checked })
          }
        />
        <span>이 채팅방에서 마스킹 사용</span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={chat.wordMaskApplyToCopy}
          disabled={!chat.wordMaskEnabled}
          onChange={(event) =>
            onUpdate({ wordMaskApplyToCopy: event.currentTarget.checked })
          }
        />
        <span>복사할 때도 마스킹 적용</span>
      </label>
      <div className="mask-add-row">
        <input
          value={source}
          placeholder="단어"
          onChange={(event) => setSource(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addRule()
          }}
        />
        <input
          value={replacement}
          placeholder="대체 표시"
          onChange={(event) => setReplacement(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addRule()
          }}
        />
        <button
          type="button"
          title="마스킹 단어 추가"
          onClick={addRule}
          disabled={!source.trim()}
        >
          <Plus size={15} />
        </button>
      </div>
      {rules.length > 0 ? (
        <div className="mask-rule-list">
          {rules.map((rule) => (
            <div className="mask-rule-row" key={rule.id}>
              <input
                value={rule.source}
                aria-label="마스킹할 단어"
                onChange={(event) =>
                  updateRule(rule.id, { source: event.currentTarget.value })
                }
              />
              <span aria-hidden="true">→</span>
              <input
                value={rule.replacement}
                aria-label="대체 표시"
                onChange={(event) =>
                  updateRule(rule.id, {
                    replacement: event.currentTarget.value,
                  })
                }
              />
              <button
                type="button"
                title="삭제"
                onClick={() => removeRule(rule.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">등록된 마스킹 단어가 없습니다.</p>
      )}
    </section>
  )
}

function GoogleDrivePanel({
  driveState,
  driveBusy,
  remoteBackup,
  driveBackups,
  driveBackupsLoaded,
  excludeImageAssets,
  onDriveConnect,
  onDriveDisconnect,
  onDriveBackupNow,
  onDriveRestoreLatest,
  onDriveDismissRemote,
  onExcludeImageAssetsChange,
}: {
  driveState: GoogleDriveState
  driveBusy: boolean
  remoteBackup: DriveBackupFile | null
  driveBackups: DriveBackupFile[]
  driveBackupsLoaded: boolean
  excludeImageAssets: boolean
  onDriveConnect: () => void
  onDriveDisconnect: () => void
  onDriveBackupNow: () => void
  onDriveRestoreLatest: () => void
  onDriveDismissRemote: () => void
  onExcludeImageAssetsChange: (value: boolean) => void
}) {
  const latestBackup = driveBackups[0]
  const backupLabel = !driveState.connected
    ? '연결 후 확인'
    : !driveBackupsLoaded
      ? '확인 중'
      : latestBackup
        ? `${formatDate(latestBackup.modifiedTime)} · ${driveBackups.length}개`
        : '백업 없음'

  return (
    <section className="panel drive-panel">
      <h2>
        <Cloud size={16} />
        Google Drive
      </h2>
      <p className="setting-note">
        Google Drive를 연결하면 수동 백업 저장 및 복원, Drive 내 파일 가져오기를
        사용할 수 있습니다.
        <br />
        브라우저를 다시 열거나 새로고침하면 Google Drive 연결이 다시 필요합니다.
      </p>

      <div className="drive-summary">
        <div className="drive-status-card">
          <span>
            <span>연결 상태</span>
            <strong>{driveState.connected ? '연결됨' : '연결 안 됨'}</strong>
          </span>
          {driveState.connected ? (
            <button type="button" onClick={onDriveDisconnect} disabled={driveBusy}>
              <X size={15} />
              연결 해제
            </button>
          ) : (
            <button type="button" onClick={onDriveConnect} disabled={driveBusy}>
              <Cloud size={15} />
              Google Drive 연결
            </button>
          )}
        </div>
        <div>
          <span>Drive 백업</span>
          <strong>{backupLabel}</strong>
        </div>
      </div>

      {driveBusy && <p className="drive-busy">Google Drive 작업 처리 중...</p>}

      {remoteBackup && (
        <div className="drive-alert">
          <div>
            <strong>Google Drive에 더 최신 백업이 있습니다.</strong>
            <span>최신 데이터로 복원을 권장합니다.</span>
          </div>
          <div className="drive-actions drive-actions-pair">
            <button type="button" onClick={onDriveRestoreLatest} disabled={driveBusy}>
              <Import size={16} />
              복원하기
            </button>
            <button type="button" onClick={onDriveDismissRemote} disabled={driveBusy}>
              나중에
            </button>
          </div>
        </div>
      )}

      <div className="drive-actions">
        <button
          type="button"
          onClick={onDriveBackupNow}
          disabled={driveBusy || !driveState.connected}
        >
          <Download size={16} />
          Drive에 백업 저장
        </button>
        <button
          type="button"
          onClick={onDriveRestoreLatest}
          disabled={driveBusy || !driveState.connected}
        >
          <Import size={16} />
          Drive 백업 복원
        </button>
      </div>

      <label className="check-row backup-option">
        <input
          type="checkbox"
          checked={excludeImageAssets}
          onChange={(event) =>
            onExcludeImageAssetsChange(event.currentTarget.checked)
          }
        />
        <span className="check-copy">
          이미지 에셋 제외 백업
          <span className="shortcut-hint">
            이미지 에셋을 제외하면 백업 용량 및 시간이 단축됩니다.
          </span>
        </span>
      </label>

      <p className="setting-note">
        개인정보처리방침:{' '}
        <a href="./privacy.html" target="_blank" rel="noreferrer">
          privacy.html
        </a>
      </p>
    </section>
  )
}

function ImportChoiceModal({
  driveConnected,
  driveBusy,
  onClose,
  onPickLocal,
  onPickDrive,
  onOpenDriveSettings,
}: {
  driveConnected: boolean
  driveBusy: boolean
  onClose: () => void
  onPickLocal: () => void
  onPickDrive: () => void
  onOpenDriveSettings: () => void
}) {
  return (
    <div className="modal-backdrop compact-backdrop" role="presentation">
      <section className="settings-modal choice-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <span className="eyebrow">IMPORT</span>
            <h2>채팅 추가</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="choice-actions">
          <button type="button" onClick={onPickLocal}>
            <FileText size={18} />
            <span>
              <strong>기기에서 선택</strong>
              <small>.jsonl 파일을 직접 불러옵니다.</small>
            </span>
          </button>
          {!isSingleFileBuild && (
            <button type="button" onClick={onPickDrive} disabled={driveBusy}>
              <Cloud size={18} />
              <span>
                <strong>Google Drive에서 선택</strong>
                <small>
                  {driveConnected
                    ? 'Drive 파일 선택 창을 엽니다.'
                    : '처음 한 번 Google 권한 확인이 필요합니다.'}
                </small>
              </span>
            </button>
          )}
        </div>
        {!isSingleFileBuild && (
          <button
            type="button"
            className="choice-link"
            onClick={onOpenDriveSettings}
          >
            Google Drive 설정
          </button>
        )}
      </section>
    </div>
  )
}

function BackupChoiceModal({
  excludeImageAssets,
  onClose,
  onExport,
  onImport,
  onExcludeImageAssetsChange,
}: {
  excludeImageAssets: boolean
  onClose: () => void
  onExport: () => void
  onImport: () => void
  onExcludeImageAssetsChange: (value: boolean) => void
}) {
  return (
    <div className="modal-backdrop compact-backdrop" role="presentation">
      <section className="settings-modal choice-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <span className="eyebrow">BACKUP</span>
            <h2>기기 백업</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="choice-actions">
          <button type="button" onClick={onExport}>
            <Download size={18} />
            <span>
              <strong>백업 파일 저장</strong>
              <small>현재 챗서랍 데이터를 기기에 저장합니다.</small>
            </span>
          </button>
          <button type="button" onClick={onImport}>
            <Import size={18} />
            <span>
              <strong>백업 파일 불러오기</strong>
              <small>저장해 둔 챗서랍 백업을 복원합니다.</small>
            </span>
          </button>
        </div>
        <label className="check-row backup-option">
          <input
            type="checkbox"
            checked={excludeImageAssets}
            onChange={(event) =>
              onExcludeImageAssetsChange(event.currentTarget.checked)
            }
          />
          <span className="check-copy">
            이미지 에셋 제외 백업
            <span className="shortcut-hint">
              이미지 에셋을 제외하면 백업 용량 및 시간이 단축됩니다.
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}

function AssetGalleryModal({
  assets,
  linkedIds,
  onClose,
  onLink,
  onDelete,
}: {
  assets: ChatAsset[]
  linkedIds: string[]
  onClose: () => void
  onLink: (assetIds: string[]) => void
  onDelete: (assetIds: string[]) => void
}) {
  const linkedSet = useMemo(() => new Set(linkedIds), [linkedIds])
  const bundles = useMemo(() => buildAssetBundles(assets), [assets])
  const [selectedBundleIds, setSelectedBundleIds] = useState<string[]>([])
  const selectedBundleSet = useMemo(
    () => new Set(selectedBundleIds),
    [selectedBundleIds],
  )
  const selectableBundles = bundles.filter((bundle) =>
    bundle.assets.some((asset) => !linkedSet.has(asset.id)),
  )

  const toggleBundle = (bundleId: string) => {
    setSelectedBundleIds((current) =>
      current.includes(bundleId)
        ? current.filter((id) => id !== bundleId)
        : [...current, bundleId],
    )
  }

  const selectedAssetIds = bundles
    .filter((bundle) => selectedBundleSet.has(bundle.id))
    .flatMap((bundle) =>
      bundle.assets
        .filter((asset) => !linkedSet.has(asset.id))
        .map((asset) => asset.id),
    )

  return (
    <div className="modal-backdrop compact-backdrop" role="presentation">
      <section
        className="settings-modal asset-gallery-modal"
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">ASSETS</span>
            <h2>챗서랍에서 연동</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {bundles.length ? (
          <div className="asset-gallery-list">
            {bundles.map((bundle) => {
              const coverAsset = bundle.assets.find(
                (asset) => asset.thumbnailDataUrl || asset.dataUrl,
              )
              const linkedCount = bundle.assets.filter((asset) =>
                linkedSet.has(asset.id),
              ).length
              const linked = linkedCount === bundle.assets.length
              const partial = linkedCount > 0 && !linked
              const selected = selectedBundleSet.has(bundle.id)
              return (
                <article
                  className={
                    selected
                      ? 'asset-gallery-card selected'
                      : linked
                        ? 'asset-gallery-card linked'
                        : 'asset-gallery-card'
                  }
                  key={bundle.id}
                >
                  <button
                    type="button"
                    className="asset-gallery-main"
                    disabled={linked}
                    onClick={() => toggleBundle(bundle.id)}
                  >
                    <span className="asset-gallery-thumb">
                      {coverAsset?.thumbnailDataUrl || coverAsset?.dataUrl ? (
                        <img
                          src={coverAsset.thumbnailDataUrl || coverAsset.dataUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="asset-thumb-empty">
                          <Image size={18} />
                        </span>
                      )}
                    </span>
                    <span className="asset-gallery-info">
                      <strong title={bundle.name}>{bundle.name}</strong>
                      <small>
                        {bundle.assets.length}개 이미지 ·{' '}
                        {linked
                          ? '연동됨'
                          : selected
                            ? '선택됨'
                            : partial
                              ? `${linkedCount}개 연동됨`
                              : '미연동'}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="asset-gallery-delete"
                    title="삭제"
                    onClick={() => {
                      setSelectedBundleIds((current) =>
                        current.filter((id) => id !== bundle.id),
                      )
                      onDelete(bundle.assets.map((asset) => asset.id))
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="muted">아직 저장된 이미지 에셋이 없습니다.</p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => onLink(selectedAssetIds)}
            disabled={!selectedAssetIds.length || !selectableBundles.length}
          >
            <Check size={16} />
            선택한 에셋 연동
          </button>
        </div>
      </section>
    </div>
  )
}

function DriveModal({
  driveState,
  driveBusy,
  remoteBackup,
  driveBackups,
  driveBackupsLoaded,
  excludeImageAssets,
  onClose,
  onDriveConnect,
  onDriveDisconnect,
  onDriveBackupNow,
  onDriveRestoreLatest,
  onDriveDismissRemote,
  onExcludeImageAssetsChange,
}: {
  driveState: GoogleDriveState
  driveBusy: boolean
  remoteBackup: DriveBackupFile | null
  driveBackups: DriveBackupFile[]
  driveBackupsLoaded: boolean
  excludeImageAssets: boolean
  onClose: () => void
  onDriveConnect: () => void
  onDriveDisconnect: () => void
  onDriveBackupNow: () => void
  onDriveRestoreLatest: () => void
  onDriveDismissRemote: () => void
  onExcludeImageAssetsChange: (value: boolean) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal drive-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <span className="eyebrow">CHATSHELF</span>
            <h2>Google Drive</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <GoogleDrivePanel
          driveState={driveState}
          driveBusy={driveBusy}
          remoteBackup={remoteBackup}
          driveBackups={driveBackups}
          driveBackupsLoaded={driveBackupsLoaded}
          excludeImageAssets={excludeImageAssets}
          onDriveConnect={onDriveConnect}
          onDriveDisconnect={onDriveDisconnect}
          onDriveBackupNow={onDriveBackupNow}
          onDriveRestoreLatest={onDriveRestoreLatest}
          onDriveDismissRemote={onDriveDismissRemote}
          onExcludeImageAssetsChange={onExcludeImageAssetsChange}
        />
      </section>
    </div>
  )
}

function SettingsModal({
  settings,
  homeLogo,
  onHomeLogoPick,
  onHomeLogoRemove,
  onClose,
  onUpdate,
  onResetSettings,
  onResetAll,
}: {
  settings: ViewerSettings
  homeLogo?: string
  onHomeLogoPick: () => void
  onHomeLogoRemove: () => void
  onClose: () => void
  onUpdate: (patch: Partial<ViewerSettings>) => void
  onResetSettings: () => void
  onResetAll: () => void
}) {
  const selectFont = (id: string) => {
    const font = settings.fonts.find((item) => item.id === id)
    if (!font) return
    onUpdate({ fontId: font.id, fontFamily: font.fontFamily })
  }

  const selectUiFont = (id: string) => {
    const font = settings.fonts.find((item) => item.id === id)
    if (!font) return
    onUpdate({ uiFontId: font.id, uiFontFamily: font.fontFamily })
  }

  const allThemes: ThemeDefinition[] = [...builtinThemes, ...settings.customThemes]
  const activePalette = resolvePalette(settings)
  const paletteFields: { key: keyof ThemePalette; label: string }[] = [
    { key: 'bg', label: '배경' },
    { key: 'surface', label: '카드' },
    { key: 'surfaceSoft', label: '표면(연함)' },
    { key: 'surfaceMuted', label: '표면(진함)' },
    { key: 'ink', label: '글자' },
    { key: 'inkSoft', label: '글자(보조)' },
    { key: 'inkMuted', label: '글자(흐림)' },
    { key: 'line', label: '경계선' },
    { key: 'lineStrong', label: '경계선(진함)' },
    { key: 'accent', label: '포인트' },
    { key: 'accentSoft', label: '포인트(연함)' },
    { key: 'onAccent', label: '포인트 위 글자' },
  ]

  const editColor = (key: keyof ThemePalette, value: string) => {
    onUpdate({ themeId: 'custom', customPalette: { ...activePalette, [key]: value } })
  }

  const savePreset = () => {
    const name = window.prompt('저장할 테마 이름을 입력하세요.', '내 테마')?.trim()
    if (!name) return
    const id = makeId('theme')
    onUpdate({
      customThemes: [...settings.customThemes, { id, name, palette: activePalette }],
      themeId: id,
    })
  }

  const deletePreset = (id: string) => {
    onUpdate({
      customThemes: settings.customThemes.filter((theme) => theme.id !== id),
      themeId: settings.themeId === id ? 'light' : settings.themeId,
    })
  }

  const addHighlightColor = (color: string) => {
    const nextColor = color.toUpperCase()
    onUpdate({
      highlightColors: [...settings.highlightColors, nextColor],
      defaultHighlightColor: settings.defaultHighlightColor || nextColor,
    })
  }

  const removeHighlightColor = (index: number) => {
    const removed = settings.highlightColors[index]
    const next = settings.highlightColors.filter((_, itemIndex) => itemIndex !== index)
    const fallback = next[0] ?? defaultHighlightColors[0]
    onUpdate({
      highlightColors: next.length ? next : [fallback],
      defaultHighlightColor:
        settings.defaultHighlightColor === removed
          ? fallback
          : settings.defaultHighlightColor,
    })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <span className="eyebrow">CHATSHELF</span>
            <h2>기본 설정</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="modal-grid settings-grid">
          <section className="panel settings-wide settings-single">
            <h2>
              <Sparkles size={16} />
              홈 화면
            </h2>
            <label>
              타이틀 작성
              <input
                value={settings.homeTitle}
                placeholder="나의 서랍"
                onChange={(event) =>
                  onUpdate({ homeTitle: event.currentTarget.value })
                }
              />
            </label>
            <div className="settings-button-row logo-buttons">
              <button type="button" onClick={onHomeLogoPick}>
                <ImageUp size={16} />
                {homeLogo ? '로고 이미지 변경' : '로고 이미지 등록'}
              </button>
              {homeLogo && (
                <button type="button" onClick={onHomeLogoRemove}>
                  <X size={16} />
                  로고 이미지 제거
                </button>
              )}
            </div>
            <label className="settings-span">
              홈 배너 커버 높이 {settings.homeBannerCoverHeight}px
              <input
                type="range"
                min={120}
                max={420}
                step={10}
                value={settings.homeBannerCoverHeight}
                onChange={(event) =>
                  onUpdate({
                    homeBannerCoverHeight: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label className="settings-span">
              홈 배너 커버 위치(%) {settings.homeBannerCoverPosition}%
              <input
                type="range"
                min={0}
                max={100}
                value={settings.homeBannerCoverPosition}
                onChange={(event) =>
                  onUpdate({
                    homeBannerCoverPosition: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label className="settings-span">
              채팅방 카드 레이아웃 표시방법
              <select
                value={settings.homeCardLayoutMode}
                onChange={(event) =>
                  onUpdate({
                    homeCardLayoutMode:
                      event.currentTarget
                        .value as ViewerSettings['homeCardLayoutMode'],
                  })
                }
              >
                <option value="basic">기본</option>
                <option value="simple">심플</option>
              </select>
            </label>
            <label className="settings-span settings-desktop-only">
              {settings.homeCardLayoutMode === 'simple'
                ? '하나의 행에 보여질 최대 카드 수 (즐겨찾기)'
                : '하나의 행에 보여질 최대 카드 수'}{' '}
              {settings.homeCardMaxColumns}개
              <input
                type="range"
                min={3}
                max={7}
                step={1}
                value={settings.homeCardMaxColumns}
                onChange={(event) =>
                  onUpdate({
                    homeCardMaxColumns: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <label className="settings-span">
              채팅방 커버 이미지 표시 방법
              <select
                value={settings.homeCardImageMode}
                onChange={(event) =>
                  onUpdate({
                    homeCardImageMode:
                      event.currentTarget.value as ViewerSettings['homeCardImageMode'],
                  })
                }
              >
                <option value="cover">커버 이미지</option>
                <option value="avatar">캐릭터 아바타 이미지</option>
              </select>
            </label>
            <label className="settings-span">
              채팅방 커버 이미지 높이 {settings.homeCardCoverHeight}px
              <input
                type="range"
                min={110}
                max={260}
                step={10}
                value={settings.homeCardCoverHeight}
                onChange={(event) =>
                  onUpdate({
                    homeCardCoverHeight: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
          </section>

          <section className="panel">
            <h2>
              <Type size={16} />
              UI 글꼴
            </h2>
            <p className="setting-note">일부 폰트는 굵기 적용이 안될 수 있습니다.</p>
            <label>
              UI 글꼴
              <select
                value={settings.uiFontId}
                onChange={(event) => selectUiFont(event.currentTarget.value)}
              >
                {settings.fonts.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="dual-field">
              <label>
                UI 글자 크기
                <select
                  value={String(settings.uiFontScale)}
                  onChange={(event) =>
                    onUpdate({ uiFontScale: Number(event.currentTarget.value) })
                  }
                >
                  <option value="0.9">작게</option>
                  <option value="1">보통</option>
                  <option value="1.12">크게</option>
                </select>
              </label>
              <label>
                UI 글자 굵기
                <select
                  value={String(settings.uiFontWeight)}
                  onChange={(event) =>
                    onUpdate({ uiFontWeight: Number(event.currentTarget.value) })
                  }
                >
                  <option value="300">얇게</option>
                  <option value="400">보통</option>
                  <option value="600">굵게</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel">
            <h2>
              <Type size={16} />
              채팅 글꼴
            </h2>
            <label>
              채팅 글꼴
              <select
                value={settings.fontId}
                onChange={(event) => selectFont(event.currentTarget.value)}
              >
                {settings.fonts.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              읽기 글자 굵기
              <select
                value={String(settings.fontWeight)}
                onChange={(event) =>
                  onUpdate({ fontWeight: Number(event.currentTarget.value) })
                }
              >
                <option value="300">얇게</option>
                <option value="400">보통</option>
                <option value="500">약간 굵게</option>
                <option value="700">굵게</option>
              </select>
            </label>
            <label>
              글자 크기 {settings.fontSize}px
              <input
                type="range"
                min={13}
                max={24}
                value={settings.fontSize}
                onChange={(event) =>
                  onUpdate({ fontSize: Number(event.currentTarget.value) })
                }
              />
            </label>
            <label>
              줄간격 {settings.lineHeight.toFixed(2)}
              <input
                type="range"
                min={1.3}
                max={2.2}
                step={0.02}
                value={settings.lineHeight}
                onChange={(event) =>
                  onUpdate({ lineHeight: Number(event.currentTarget.value) })
                }
              />
            </label>
            <label>
              메시지 폭 {settings.messageWidth}px
              <input
                type="range"
                min={520}
                max={920}
                step={10}
                value={settings.messageWidth}
                onChange={(event) =>
                  onUpdate({ messageWidth: Number(event.currentTarget.value) })
                }
              />
            </label>
            <label>
              메시지 표시 개수 (스크롤){' '}
              {settings.scrollWindowSize === 0 ? '전체' : `${settings.scrollWindowSize}개`}
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={settings.scrollWindowSize}
                onChange={(event) =>
                  onUpdate({ scrollWindowSize: Number(event.currentTarget.value) })
                }
              />
              <span className="shortcut-hint">
                0은 전체 표시이며, 장기 채팅에서는 느려질 수 있습니다.
              </span>
            </label>
          </section>

          <section className="panel settings-wide settings-single">
            <h2>
              <SlidersHorizontal size={16} />
              기능 · 표시
            </h2>
            <label>
              언어
              <select
                value={settings.languageMode}
                onChange={(event) =>
                  onUpdate({
                    languageMode:
                      event.currentTarget.value as ViewerSettings['languageMode'],
                  })
                }
              >
                <option value="translated">번역</option>
                <option value="original">원문</option>
                <option value="both">원문 + 번역</option>
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showProgressBar}
                onChange={(event) =>
                  onUpdate({ showProgressBar: event.currentTarget.checked })
                }
              />
              읽기 진행바 표시
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!settings.autoHideTopbar}
                onChange={(event) =>
                  onUpdate({ autoHideTopbar: !event.currentTarget.checked })
                }
              />
              읽기 모드일 때 탑바 표시
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={!settings.hideAiThinking}
                onChange={(event) =>
                  onUpdate({ hideAiThinking: !event.currentTarget.checked })
                }
              />
              AI 추론 표시
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showMessageMeta}
                onChange={(event) =>
                  onUpdate({ showMessageMeta: event.currentTarget.checked })
                }
              />
              <span className="check-copy">
                메시지 부가정보 표시
                <span className="shortcut-hint">
                  타임스탬프, 모델, 토큰 수, 현재 스와이프 번호
                </span>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.includeHidden}
                onChange={(event) =>
                  onUpdate({ includeHidden: event.currentTarget.checked })
                }
              />
              ST 숨김 메시지 표시
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.notesEnabled}
                onChange={(event) =>
                  onUpdate({ notesEnabled: event.currentTarget.checked })
                }
              />
              메모 기능 사용
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.highlightEnabled}
                onChange={(event) =>
                  onUpdate({ highlightEnabled: event.currentTarget.checked })
                }
              />
              하이라이트 기능 사용
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.keyboardShortcutsEnabled}
                onChange={(event) =>
                  onUpdate({ keyboardShortcutsEnabled: event.currentTarget.checked })
                }
              />
              <span className="check-copy">
                키보드 단축키 사용
                <span className="shortcut-hint">/ 검색, ← 이전, → 다음</span>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showRoleBadges}
                onChange={(event) =>
                  onUpdate({ showRoleBadges: event.currentTarget.checked })
                }
              />
              채팅방 SYS/AI/USER 뱃지 표시
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showAvatars}
                onChange={(event) =>
                  onUpdate({ showAvatars: event.currentTarget.checked })
                }
              />
              채팅방 프로필 아바타 표시
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.showCoverImage}
                onChange={(event) =>
                  onUpdate({ showCoverImage: event.currentTarget.checked })
                }
              />
              채팅창 커버 이미지 표시
            </label>
            <label>
              채팅창 커버 이미지 높이 {settings.coverHeight}px
              <input
                type="range"
                min={120}
                max={420}
                step={8}
                value={settings.coverHeight}
                disabled={!settings.showCoverImage}
                onChange={(event) =>
                  onUpdate({ coverHeight: Number(event.currentTarget.value) })
                }
              />
            </label>
            <label>
              채팅창 커버 효과
              <select
                value={settings.coverImageMode}
                disabled={!settings.showCoverImage}
                onChange={(event) =>
                  onUpdate({
                    coverImageMode:
                      event.currentTarget.value as ViewerSettings['coverImageMode'],
                  })
                }
              >
                <option value="original">원본</option>
                <option value="dark">어둡게</option>
                <option value="grayscale">흑백</option>
              </select>
            </label>
          </section>

          <section className="panel settings-wide">
            <h2>
              <Palette size={16} />
              컬러 테마
            </h2>
            <div className="theme-gallery">
              {allThemes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={
                    settings.themeId === theme.id
                      ? 'theme-swatch active'
                      : 'theme-swatch'
                  }
                  onClick={() => onUpdate({ themeId: theme.id })}
                >
                  <span
                    className="sw-preview"
                    style={{ background: theme.palette.bg }}
                  >
                    <i style={{ background: theme.palette.surface }} />
                    <i style={{ background: theme.palette.accent }} />
                    <i style={{ background: theme.palette.ink }} />
                  </span>
                  <span className="sw-name">
                    {theme.name}
                    {settings.themeId === theme.id && <Check size={13} />}
                  </span>
                  {!theme.builtin && (
                    <span
                      className="sw-del"
                      role="button"
                      tabIndex={0}
                      title="이 테마 삭제"
                      onClick={(event) => {
                        event.stopPropagation()
                        deletePreset(theme.id)
                      }}
                    >
                      <X size={12} />
                    </span>
                  )}
                </button>
              ))}
              {settings.themeId === 'custom' && (
                <span className="theme-swatch active custom-live">
                  <span
                    className="sw-preview"
                    style={{ background: activePalette.bg }}
                  >
                    <i style={{ background: activePalette.surface }} />
                    <i style={{ background: activePalette.accent }} />
                    <i style={{ background: activePalette.ink }} />
                  </span>
                  <span className="sw-name">
                    편집 중 <Check size={13} />
                  </span>
                </span>
              )}
            </div>

            <div className="settings-subhead">색상 직접 조정</div>
            <div className="theme-editor">
              {paletteFields.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <input
                    type="color"
                    value={activePalette[key]}
                    onChange={(event) => editColor(key, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
            <div className="stacked-buttons">
              <button type="button" onClick={savePreset}>
                <Check size={15} />이 색 조합을 프리셋으로 저장
              </button>
            </div>

            <div className="settings-subhead">하이라이트 색상</div>
            <div className="highlight-color-editor">
              {settings.highlightColors.map((color, index) => (
                <div key={`highlight-color-${index}`} className="highlight-color-item">
                  <input
                    aria-label={`하이라이트 색상 ${index + 1}`}
                    type="color"
                    value={color}
                    onChange={(event) => {
                      const next = [...settings.highlightColors]
                      const previous = next[index]
                      next[index] = event.currentTarget.value
                      onUpdate({
                        highlightColors: next,
                        defaultHighlightColor:
                          settings.defaultHighlightColor === previous
                            ? event.currentTarget.value
                            : settings.defaultHighlightColor,
                      })
                    }}
                  />
                  {settings.highlightColors.length > 1 && (
                    <button
                      type="button"
                      className="highlight-color-remove"
                      title="이 색상 삭제"
                      onClick={() => removeHighlightColor(index)}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              <label
                className="highlight-color-add"
                title="하이라이트 색상 추가"
              >
                <Plus size={18} />
                <input
                  aria-label="하이라이트 색상 추가"
                  type="color"
                  value={
                    settings.highlightColors[settings.highlightColors.length - 1] ??
                    defaultHighlightColors[0]
                  }
                  onChange={(event) => addHighlightColor(event.currentTarget.value)}
                />
              </label>
            </div>
            <div className="stacked-buttons">
              <button
                type="button"
                onClick={() =>
                  onUpdate({
                    highlightColors: [...defaultHighlightColors],
                    defaultHighlightColor: defaultHighlightColors[0],
                  })
                }
              >
                <RotateCcw size={15} />
                기본 색상으로 되돌리기
              </button>
            </div>
          </section>

          <section className="panel danger-zone settings-wide">
            <h2>
              <RotateCcw size={16} />
              초기화
            </h2>
            <div className="stacked-buttons">
              <button type="button" onClick={onResetSettings}>
                <RotateCcw size={16} />
                설정만 기본값으로 초기화
              </button>
              <button type="button" className="danger-button" onClick={onResetAll}>
                <Trash2 size={16} />
                전체 데이터 초기화 (채팅·메모·하이라이트·설정 삭제)
              </button>
            </div>
            <p className="muted">
              전체 초기화는 되돌릴 수 없습니다. 중요한 보관함은 먼저 백업 파일을 저장해
              두세요.
            </p>
          </section>
        </div>
      </section>
    </div>
  )
}

export default App
