import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Check,
  ChevronDown,
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
  normalizeCoverPosition,
  normalizeHomeBannerCoverHeight,
  normalizeHomeCardCoverHeight,
  resolvePalette,
  saveReadingPositions,
  saveSettings,
} from './lib/defaults'
import {
  backupToBlob,
  downloadBlob,
  readFileAsDataUrl,
  readFileAsText,
} from './lib/files'
import {
  applyHighlightsToElement,
  renderMarkdown,
  stripMarkdownForSnippet,
} from './lib/markdown'
import { parseSillyTavernJsonl } from './lib/parser'
import {
  clearAllChats,
  deleteChat,
  deleteMeta,
  getChats,
  getMeta,
  replaceChats,
  saveChat,
  saveChats,
  setMeta,
} from './lib/storage'
import { collectTagNames, splitTaggedText } from './lib/tags'
import type {
  ChatAsset,
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
} from './types'

const backupVersion = 1

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`
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

function normalizeCharacterName(value?: string) {
  return value?.trim().toLocaleLowerCase() ?? ''
}

function normalizeChat(chat: ViewerChat): ViewerChat {
  return {
    ...chat,
    folder: chat.folder ?? '',
    assets: chat.assets ?? [],
    notes: chat.notes ?? [],
    highlights: chat.highlights ?? [],
    messages: chat.messages.map((message) => ({
      ...message,
      swipes: message.swipes ?? [],
    })),
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
  const [chats, setChats] = useState<ViewerChat[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [settings, setSettings] = useState<ViewerSettings>(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const [shareAssetsByCharacter, setShareAssetsByCharacter] = useState(false)
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

  useEffect(() => {
    getChats().then((items) => {
      const ordered = sameChatOrder(items.map(normalizeChat))
      setChats(ordered)
      const lastId = localStorage.getItem('st-chat-viewer:lastChat') ?? undefined
      const restored = ordered.find((chat) => chat.id === lastId)?.id
      setSelectedId((current) => current ?? restored ?? ordered[0]?.id)
    })
  }, [])

  useEffect(() => {
    void getMeta<string>('homeBanner').then((value) => {
      if (value) setHomeBanner(value)
    })
    void getMeta<string>('homeLogo').then((value) => {
      if (value) setHomeLogo(value)
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
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const buildBackup = useCallback(
    (): ViewerBackup => ({
      app: 'st-chat-viewer',
      version: backupVersion,
      exportedAt: new Date().toISOString(),
      chats,
      settings,
      readingPositions,
      homeBanner,
      homeLogo,
    }),
    [chats, settings, readingPositions, homeBanner, homeLogo],
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
  const selectedCharacterKey = normalizeCharacterName(selectedChat?.characterName)
  const sameCharacterChatCount = useMemo(
    () =>
      selectedCharacterKey
        ? chats.filter(
            (chat) => normalizeCharacterName(chat.characterName) === selectedCharacterKey,
          ).length
        : 0,
    [chats, selectedCharacterKey],
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

  useEffect(() => {
    if (!selectedCharacterKey && shareAssetsByCharacter) {
      setShareAssetsByCharacter(false)
    }
  }, [selectedCharacterKey, shareAssetsByCharacter])

  const updateSettings = (patch: Partial<ViewerSettings>) => {
    setSettings((current) => normalizedSettings({ ...current, ...patch }))
  }

  const updateChat = async (chat: ViewerChat) => {
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
    setDraggedChatId(undefined)
    setChats(next)
    await saveChats(next)
  }

  const removeSelectedChat = async () => {
    if (!selectedChat) return
    const ok = window.confirm(`"${selectedChat.title}" 채팅을 보관함에서 삭제할까요?`)
    if (!ok) return
    await deleteChat(selectedChat.id)
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
    await updateChat({ ...selectedChat, characterAvatar: dataUrl })
    if (charAvatarInputRef.current) charAvatarInputRef.current.value = ''
  }

  const importUserAvatar = async (files: FileList | null) => {
    if (!files?.[0] || !selectedChat) return
    const dataUrl = await readFileAsDataUrl(files[0])
    await updateChat({ ...selectedChat, userAvatar: dataUrl })
    if (userAvatarInputRef.current) userAvatarInputRef.current.value = ''
  }

  const importHomeBanner = async (files: FileList | null) => {
    if (!files?.[0]) return
    const dataUrl = await readFileAsDataUrl(files[0])
    setHomeBanner(dataUrl)
    await setMeta('homeBanner', dataUrl)
    if (bannerInputRef.current) bannerInputRef.current.value = ''
    setNotice('홈 배너를 등록했습니다.')
  }

  const removeHomeBanner = async () => {
    setHomeBanner(undefined)
    await deleteMeta('homeBanner')
  }

  const importHomeLogo = async (files: FileList | null) => {
    if (!files?.[0]) return
    const dataUrl = await readFileAsDataUrl(files[0])
    setHomeLogo(dataUrl)
    await setMeta('homeLogo', dataUrl)
    if (logoInputRef.current) logoInputRef.current.value = ''
    setNotice('로고 이미지를 등록했습니다.')
  }

  const removeHomeLogo = async () => {
    setHomeLogo(undefined)
    await deleteMeta('homeLogo')
  }

  const toggleFavorite = async (chat: ViewerChat) => {
    await updateChat({ ...chat, favorite: !chat.favorite })
  }

  const importAssets = async (files: FileList | null) => {
    if (!files?.length || !selectedChat) return
    const assets: ChatAsset[] = []
    for (const file of Array.from(files)) {
      if (file.name.toLocaleLowerCase().endsWith('.zip')) {
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(file)
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !/\.(png|jpe?g|gif|webp|avif)$/i.test(entry.name)) continue
          const blob = await entry.async('blob')
          const imageFile = new File([blob], entry.name.split('/').pop() ?? entry.name, {
            type: blob.type || 'image/*',
          })
          assets.push({
            id: makeId('asset'),
            filename: imageFile.name,
            type: imageFile.type,
            dataUrl: await readFileAsDataUrl(imageFile),
            addedAt: new Date().toISOString(),
          })
        }
        continue
      }

      if (file.type.startsWith('image/')) {
        assets.push({
          id: makeId('asset'),
          filename: file.name,
          type: file.type,
          dataUrl: await readFileAsDataUrl(file),
          addedAt: new Date().toISOString(),
        })
      }
    }
    if (!assets.length) return
    if (shareAssetsByCharacter && selectedCharacterKey) {
      const targetIds = new Set(
        chats
          .filter(
            (chat) => normalizeCharacterName(chat.characterName) === selectedCharacterKey,
          )
          .map((chat) => chat.id),
      )
      const updatedTargets: ViewerChat[] = []
      const now = new Date().toISOString()
      const nextChats = sameChatOrder(
        chats.map((chat) => {
          if (!targetIds.has(chat.id)) return chat
          const copiedAssets = assets.map((asset) => ({
            ...asset,
            id: makeId('asset'),
            addedAt: now,
          }))
          const updated = normalizeChat({
            ...chat,
            assets: [...chat.assets, ...copiedAssets],
            updatedAt: now,
          })
          updatedTargets.push(updated)
          return updated
        }),
      )
      setChats(nextChats)
      await saveChats(updatedTargets)
      setNotice(
        updatedTargets.length > 1
          ? `${assets.length}개 이미지를 같은 캐릭터의 ${updatedTargets.length}개 채팅에 연결했습니다.`
          : `${assets.length}개 이미지를 이 채팅에 연결했습니다.`,
      )
    } else {
      await updateChat({ ...selectedChat, assets: [...selectedChat.assets, ...assets] })
      setNotice(`${assets.length}개 이미지를 이 채팅에 연결했습니다.`)
    }
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
    await downloadBlob(
      `chatshelf-backup-${stamp}.json`,
      backupToBlob(buildBackup()),
    )
    setNotice('백업 파일을 저장했습니다.')
  }


  const restoreBackup = async (files: FileList | null) => {
    if (!files?.[0]) return
    try {
      const raw = await readFileAsText(files[0])
      const backup = JSON.parse(raw) as ViewerBackup
      if (backup.app !== 'st-chat-viewer' || !Array.isArray(backup.chats)) {
        throw new Error('챗서랍 백업 파일이 아닙니다.')
      }
      const restoredChats = sameChatOrder(backup.chats.map(normalizeChat))
      await replaceChats(restoredChats)
      setChats(restoredChats)
      setSettings(normalizedSettings(backup.settings ?? defaultSettings))
      if (backup.readingPositions) setReadingPositions(backup.readingPositions)
      if (backup.homeBanner) {
        setHomeBanner(backup.homeBanner)
        await setMeta('homeBanner', backup.homeBanner)
      }
      if (backup.homeLogo) {
        setHomeLogo(backup.homeLogo)
        await setMeta('homeLogo', backup.homeLogo)
      }
      openedChatRef.current = undefined
      setSelectedId(restoredChats[0]?.id)
      setNotice('백업을 복원했습니다.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '백업 복원 실패')
    }
    if (backupInputRef.current) backupInputRef.current.value = ''
  }

  const resetSettings = () => {
    const ok = window.confirm(
      '글꼴, 색상, 보기 옵션 등 모든 설정을 기본값으로 되돌릴까요? (채팅과 메모, 하이라이트는 유지됩니다.)',
    )
    if (!ok) return
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
    saveReadingPositions({})
    await deleteMeta('homeBanner')
    await deleteMeta('homeLogo')
    setHomeBanner(undefined)
    setHomeLogo(undefined)
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

  const renderChatCard = (chat: ViewerChat, options?: { draggable?: boolean }) => {
    const percent = readingPercent(chat)
    const cover = chat.coverImage
    return (
      <article
        key={chat.id}
        className="chat-card"
        draggable={options?.draggable}
        onClick={() => openChat(chat.id)}
        onDragStart={
          options?.draggable ? () => setDraggedChatId(chat.id) : undefined
        }
        onDragOver={options?.draggable ? (event) => event.preventDefault() : undefined}
        onDrop={options?.draggable ? () => void reorderChat(chat.id) : undefined}
      >
        <div className="card-cover">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <span className="card-initial">{chat.title.slice(0, 1)}</span>
          )}
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
          {percent > 0 && (
            <span className="card-progress">
              {percent === 100 ? '읽음' : `${percent}%`}
            </span>
          )}
        </div>
        <div className="card-info">
          <strong>{chat.title}</strong>
          <small>
            {chat.characterName ?? '캐릭터 미상'} · {chat.messages.length}개
          </small>
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
        <div className="home">
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
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={16} />
                <span className="btn-accent-label">채팅 추가</span>
              </button>
              <button
                type="button"
                className="icon-button"
                title="백업"
                onClick={() => void exportBackup()}
              >
                <Download size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                title="백업 불러오기(복원)"
                onClick={() => backupInputRef.current?.click()}
              >
                <Import size={18} />
              </button>
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

          <div className="home-body">
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
                  onClick={() => fileInputRef.current?.click()}
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
                    <div className="card-grid">
                      {favoriteChats.map((chat) => renderChatCard(chat))}
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
                  chat={selectedChat}
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
              <div className="stacked-buttons">
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
                <button
                  type="button"
                  onClick={() => charAvatarInputRef.current?.click()}
                >
                  <ImageUp size={16} />
                  캐릭터 아바타 등록
                </button>
                <button
                  type="button"
                  onClick={() => userAvatarInputRef.current?.click()}
                >
                  <ImageUp size={16} />
                  유저 아바타 등록
                </button>
                <button type="button" onClick={() => assetInputRef.current?.click()}>
                  <Image size={16} />
                  이미지 에셋 (Zip) 등록
                </button>
                <label
                  className={
                    selectedCharacterKey
                      ? 'check-row asset-share-check'
                      : 'check-row asset-share-check is-disabled'
                  }
                  title={
                    selectedCharacterKey
                      ? `${sameCharacterChatCount}개 채팅에 적용 가능`
                      : '캐릭터 이름이 있는 채팅에서 사용할 수 있습니다.'
                  }
                >
                  <input
                    type="checkbox"
                    checked={shareAssetsByCharacter}
                    disabled={!selectedCharacterKey}
                    onChange={(event) =>
                      setShareAssetsByCharacter(event.currentTarget.checked)
                    }
                  />
                  <span>동일한 이름의 캐릭터 전부 공통으로 에셋 적용</span>
                </label>
                <button type="button" onClick={() => void removeSelectedChat()}>
                  <Trash2 size={16} />
                  채팅 삭제
                </button>
              </div>
              <details className="file-detail">
                <summary>원본 파일 정보</summary>
                <p>{selectedChat.sourceFileName}</p>
              </details>
              <p className="muted">
                이미지 자료 {selectedChat.assets.length}개 · {'{{img::파일명}}'} 치환
                지원
              </p>
            </>
          ) : (
            <p className="muted">선택된 채팅이 없습니다.</p>
          )}
        </section>

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

      {highlightModalOpen && selectedChat && (
        <HighlightModal
          chat={selectedChat}
          highlights={highlights}
          defaultHighlightColor={settings.defaultHighlightColor}
          onClose={() => setHighlightModalOpen(false)}
          onDelete={(highlightId) => void removeHighlight(highlightId)}
          onGoOriginal={(highlight) => {
            updateSettings({ languageMode: 'original' })
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
              const label = message.name ?? roleLabel
              return (
                <span className={`avatar avatar-${message.role}`} aria-hidden="true">
                  {avatar ? <img src={avatar} alt="" /> : label.slice(0, 1)}
                </span>
              )
            })()}
          <span className="message-name">
            <span className="role-pill">{roleLabel}</span>
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

  if (settings.languageMode === 'both' && hasTranslated) {
    return (
      <div className="dual-body">
        <TextBlock
          label="번역"
          text={message.rawTranslated ?? ''}
          assets={chat.assets}
          settings={settings}
          highlights={highlights}
          tone="translated"
        />
        <TextBlock
          label="원문"
          text={message.rawOriginal}
          assets={chat.assets}
          settings={settings}
          highlights={highlights}
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
      label={settings.languageMode === 'original' ? '원문' : hasTranslated ? '번역' : '본문'}
      text={text}
      assets={chat.assets}
      settings={settings}
      highlights={highlights}
    />
  )
}

function TextBlock({
  label,
  text,
  assets,
  settings,
  highlights,
  tone,
}: {
  label: string
  text: string
  assets: ChatAsset[]
  settings: ViewerSettings
  highlights: MessageHighlight[]
  tone?: 'translated' | 'original'
}) {
  const parts = useMemo(() => splitTaggedText(text), [text])
  const segments = parts.segments.length
    ? parts.segments
    : [{ id: 'body', type: 'text' as const, text }]

  return (
    <section className={tone ? `text-block ${tone}` : 'text-block'}>
      <span className="text-label">{label}</span>
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
}: {
  text: string
  assets: ChatAsset[]
  settings: ViewerSettings
  highlights: MessageHighlight[]
}) {
  const html = useMemo(
    () => renderMarkdown(text, assets),
    [assets, text],
  )
  const bodyRef = useRef<HTMLDivElement>(null)
  const highlightSignature = useMemo(
    () => highlights.map((item) => `${item.id}:${item.color ?? ''}:${item.text}`).join('|'),
    [highlights],
  )

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.innerHTML = html
    if (highlights.length) {
      applyHighlightsToElement(el, highlights, settings.defaultHighlightColor)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, highlightSignature, settings.defaultHighlightColor])

  if (!text.trim()) return null

  return <div ref={bodyRef} className="markdown-body" />
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
  onGoOriginal,
}: {
  chat: ViewerChat
  highlights: MessageHighlight[]
  defaultHighlightColor: string
  onClose: () => void
  onDelete: (highlightId: string) => void
  onGoOriginal: (highlight: MessageHighlight) => void
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
                      <button type="button" onClick={() => onGoOriginal(highlight)}>
                        원문으로
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
              홈배너 커버 위치(%) {settings.homeBannerCoverPosition}%
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
              카드 커버 이미지 높이 {settings.homeCardCoverHeight}px
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
              스크롤 표시 개수 {settings.scrollWindowSize === 0 ? '전체' : `${settings.scrollWindowSize}개`}
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
              채팅창 커버 위치(%) {settings.coverPosition}%
              <input
                type="range"
                min={0}
                max={100}
                value={settings.coverPosition}
                disabled={!settings.showCoverImage}
                onChange={(event) =>
                  onUpdate({ coverPosition: Number(event.currentTarget.value) })
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
                <option value="blur">흐리게</option>
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
