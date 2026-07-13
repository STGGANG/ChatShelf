export type MessageRole = 'user' | 'assistant' | 'system'

export type LanguageMode = 'translated' | 'original' | 'both'

export type ReadMode = 'scroll' | 'page'

export type TagDisplayMode = 'collapsed' | 'expanded' | 'hidden'

export type CoverImageMode = 'grayscale' | 'dark' | 'original'

export type HomeCardLayoutMode = 'basic' | 'simple'

export type HomeCardImageMode = 'cover' | 'avatar'

export type AssetDisplayMode = 'default' | 'framed'

export type DriveImageMode = 'local' | 'drive'

export interface AvatarCrop {
  x: number
  y: number
  scale: number
}

export interface ThemePalette {
  bg: string
  surface: string
  surfaceSoft: string
  surfaceMuted: string
  ink: string
  inkSoft: string
  inkMuted: string
  line: string
  lineStrong: string
  accent: string
  accentSoft: string
  onAccent: string
}

export interface ThemeDefinition {
  id: string
  name: string
  palette: ThemePalette
  builtin?: boolean
}

export interface FontOption {
  id: string
  name: string
  fontFamily: string
}

export interface ParsedTag {
  id: string
  name: string
  raw: string
  body: string
  fields: Record<string, string>
}

export interface TextParts {
  body: string
  tags: ParsedTag[]
  segments: Array<
    | {
        id: string
        type: 'text'
        text: string
      }
    | {
        id: string
        type: 'tag'
        tag: ParsedTag
      }
  >
}

export interface MessageMetadata {
  sendDate?: string
  genStarted?: string
  genFinished?: string
  model?: string
  api?: string
  tokenCount?: number
  swipeCount?: number
  swipeId?: number
}

export interface MessageSwipe {
  id: string
  index: number
  rawOriginal: string
  rawTranslated?: string
  reasoning?: string
  metadata: MessageMetadata
}

export interface ViewerMessage {
  id: string
  index: number
  role: MessageRole
  name?: string
  rawOriginal: string
  rawTranslated?: string
  reasoning?: string
  swipes: MessageSwipe[]
  hiddenByST: boolean
  bookmarked: boolean
  metadata: MessageMetadata
}

export interface ChatAsset {
  id: string
  filename: string
  type: string
  dataUrl: string
  thumbnailDataUrl?: string
  blobKey?: string
  blobStored?: boolean
  bundleId?: string
  bundleName?: string
  storage?: DriveImageMode
  driveFileId?: string
  addedAt: string
}

export interface MessageNote {
  id: string
  messageId: string
  messageIndex: number
  text: string
  createdAt: string
  updatedAt: string
}

export interface MessageHighlight {
  id: string
  messageId: string
  messageIndex: number
  text: string
  color?: string
  createdAt: string
}

export interface WordMaskRule {
  id: string
  source: string
  replacement: string
}

export interface ViewerChat {
  id: string
  title: string
  folder: string
  sourceFileName: string
  userName?: string
  characterName?: string
  thumbnail?: string
  coverImage?: string
  characterAvatar?: string
  userAvatar?: string
  characterAvatarCrop?: AvatarCrop
  userAvatarCrop?: AvatarCrop
  favorite?: boolean
  messages: ViewerMessage[]
  assets: ChatAsset[]
  assetIds?: string[]
  notes: MessageNote[]
  highlights: MessageHighlight[]
  wordMaskEnabled: boolean
  wordMaskApplyToCopy: boolean
  wordMaskRules: WordMaskRule[]
  assetDisplayMode?: AssetDisplayMode
  sortOrder: number
  createdAt: string
  importedAt: string
  updatedAt: string
}

export interface ViewerSettings {
  fontId: string
  fontFamily: string
  fontWeight: number
  uiFontId: string
  uiFontFamily: string
  uiFontScale: number
  uiFontWeight: number
  fonts: FontOption[]
  fontSize: number
  lineHeight: number
  paragraphSpacing: number
  messageWidth: number
  languageMode: LanguageMode
  includeHidden: boolean
  readMode: ReadMode
  scrollWindowSize: number
  themeId: string
  customPalette: ThemePalette
  customThemes: ThemeDefinition[]
  showCoverImage: boolean
  coverHeight: number
  coverPosition: number
  coverImageMode: CoverImageMode
  tagModes: Record<string, TagDisplayMode>
  highlightColors: string[]
  defaultHighlightColor: string
  keyboardShortcutsEnabled: boolean
  showProgressBar: boolean
  showAvatars: boolean
  showRoleBadges: boolean
  notesEnabled: boolean
  highlightEnabled: boolean
  showMessageMeta: boolean
  hideAiThinking: boolean
  autoHideTopbar: boolean
  homeTitle: string
  homeBannerCoverHeight: number
  homeBannerCoverPosition: number
  homeCardMaxColumns: number
  homeCardCoverHeight: number
  homeCardLayoutMode: HomeCardLayoutMode
  homeCardImageMode: HomeCardImageMode
}

export interface GoogleDriveState {
  connected: boolean
  lastBackupAt?: string
  lastBackupFileId?: string
  lastLocalRevisionAt?: string
  lastBackupLocalRevisionAt?: string
  pausedForRemoteBackupId?: string
}

export interface ViewerBackup {
  app: 'st-chat-viewer'
  version: 1
  exportedAt: string
  localRevisionAt?: string
  assetsExcluded?: boolean
  chats: ViewerChat[]
  assetLibrary?: ChatAsset[]
  settings: ViewerSettings
  readingPositions?: Record<string, number>
  homeBanner?: string
  homeLogo?: string
}
