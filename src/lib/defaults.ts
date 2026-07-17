import type {
  FontOption,
  ThemeDefinition,
  ThemePalette,
  ViewerSettings,
} from '../types'

export const pretendardFont: FontOption = {
  id: 'pretendard',
  name: 'Pretendard',
  fontFamily:
    'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif',
}

const sans = (fam: string) =>
  `"${fam}", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif`
const serif = (fam: string) => `"${fam}", "Nanum Myeongjo", serif`

export const builtinFonts: FontOption[] = [
  pretendardFont,
  { id: 'suit', name: 'SUIT', fontFamily: sans('Suit') },
  { id: 'suite', name: 'SUITE', fontFamily: sans('Sweet') },
  { id: 'wanted', name: 'Wanted Sans', fontFamily: sans('Wanted Sans Variable') },
  { id: 'presentation', name: 'Freesentation', fontFamily: sans('Presentation') },
  { id: 'nanumneo', name: '나눔스퀘어 네오', fontFamily: sans('NanumSquareNeo') },
  { id: 'nanumround', name: '나눔스퀘어 라운드', fontFamily: sans('NanumSquareRound') },
  { id: 'a2z', name: '에이투지체', fontFamily: sans('A2z') },
  { id: 'nexon', name: '넥슨 Lv.2 고딕', fontFamily: sans('NexonLv2Gothic') },
  { id: 'paperozi', name: '페이퍼로지', fontFamily: sans('Paperozi') },
  { id: 'onestore', name: '원스토어 모바일고딕 제목', fontFamily: sans('OneStoreMobileGothicTitleFont') },
  { id: 'wave', name: '웨이브 파도체', fontFamily: sans('Wave') },
  { id: 'alice', name: '앨리스 디지털배움체', fontFamily: sans('AliceDigitalLearning') },
  { id: 'tmoney', name: '티머니 둥근바람', fontFamily: sans('TMoneyDungunbaram') },
  { id: 'schoolsafe', name: '학교안심 우주체', fontFamily: sans('SchoolSafeUniverse') },
  { id: 'ridibatang', name: '리디바탕', fontFamily: serif('Ridibatang') },
  { id: 'gounbatang', name: '고운바탕', fontFamily: serif('GounBatang') },
  { id: 'maruburi', name: '마루부리', fontFamily: serif('MaruBuri') },
  { id: 'nanummyeongjo', name: '나눔명조', fontFamily: serif('Nanum Myeongjo') },
  { id: 'chosun', name: '조선일보명조', fontFamily: serif('ChosunIlboMyungjo') },
  { id: 'nanumpen', name: '나눔바른펜', fontFamily: sans('NanumBarunPen') },
  { id: 'diary', name: '다이어리체', fontFamily: sans('Diary') },
  { id: 'isyun', name: '이서윤체', fontFamily: sans('IsYun') },
]

function mergeFonts(saved?: FontOption[]): FontOption[] {
  void saved
  return builtinFonts
}

function resolveFont(fonts: FontOption[], id?: string): FontOption {
  return fonts.find((font) => font.id === id) ?? fonts[0] ?? pretendardFont
}

export const builtinThemes: ThemeDefinition[] = [
  {
    id: 'light',
    name: '라이트',
    builtin: true,
    palette: {
      bg: '#f7f6f3',
      surface: '#ffffff',
      surfaceSoft: '#f2f1ed',
      surfaceMuted: '#e9e7e1',
      ink: '#33322f',
      inkSoft: '#63615c',
      inkMuted: '#96938c',
      line: '#e8e5df',
      lineStrong: '#d7d3cb',
      accent: '#a8867a',
      accentSoft: '#efe6e1',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'dark',
    name: '다크',
    builtin: true,
    palette: {
      bg: '#16171b',
      surface: '#202228',
      surfaceSoft: '#1a1c21',
      surfaceMuted: '#2b2e35',
      ink: '#e8e7e3',
      inkSoft: '#aeaca6',
      inkMuted: '#77756f',
      line: '#2e3138',
      lineStrong: '#3e424b',
      accent: '#b3a0cc',
      accentSoft: '#2c2836',
      onAccent: '#1a1621',
    },
  },
  {
    id: 'mono',
    name: '모노',
    builtin: true,
    palette: {
      bg: '#f4f4f4',
      surface: '#ffffff',
      surfaceSoft: '#efefef',
      surfaceMuted: '#e4e4e4',
      ink: '#1c1c1c',
      inkSoft: '#565656',
      inkMuted: '#8c8c8c',
      line: '#e2e2e2',
      lineStrong: '#c9c9c9',
      accent: '#3a3a3a',
      accentSoft: '#e6e6e6',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'sepia',
    name: '세피아',
    builtin: true,
    palette: {
      bg: '#e6ded2',
      surface: '#f5f0e8',
      surfaceSoft: '#ddd5c9',
      surfaceMuted: '#d0c5b6',
      ink: '#3f3a32',
      inkSoft: '#625b50',
      inkMuted: '#8e8476',
      line: '#d6cdbf',
      lineStrong: '#b9ad9b',
      accent: '#887263',
      accentSoft: '#dbcec2',
      onAccent: '#fffaf2',
    },
  },
  {
    id: 'green',
    name: '그린',
    builtin: true,
    palette: {
      bg: '#edeae3',
      surface: '#f6f3ee',
      surfaceSoft: '#e6e2da',
      surfaceMuted: '#dbd5cb',
      ink: '#3d3830',
      inkSoft: '#635d52',
      inkMuted: '#918a7d',
      line: '#ddd8ce',
      lineStrong: '#c9c2b4',
      accent: '#8a9670',
      accentSoft: '#e2e0d2',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'pink',
    name: '핑크',
    builtin: true,
    palette: {
      bg: '#f5ece8',
      surface: '#fcf5f2',
      surfaceSoft: '#f2e6e0',
      surfaceMuted: '#ead9d2',
      ink: '#4a3b37',
      inkSoft: '#6f5c56',
      inkMuted: '#a68f88',
      line: '#edddd6',
      lineStrong: '#dfc6bb',
      accent: '#c48e83',
      accentSoft: '#f4e1db',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'blue',
    name: '블루',
    builtin: true,
    palette: {
      bg: '#e7edf3',
      surface: '#f3f7fb',
      surfaceSoft: '#e1eaf2',
      surfaceMuted: '#d0ddea',
      ink: '#303c47',
      inkSoft: '#566472',
      inkMuted: '#879aa8',
      line: '#d7e2ec',
      lineStrong: '#bbccdb',
      accent: '#7d9db8',
      accentSoft: '#dde7f0',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'purple',
    name: '퍼플',
    builtin: true,
    palette: {
      bg: '#ebe8f3',
      surface: '#f5f2fb',
      surfaceSoft: '#e7e1f2',
      surfaceMuted: '#d8d0e9',
      ink: '#3b3546',
      inkSoft: '#5f586e',
      inkMuted: '#938ca4',
      line: '#e0d8ee',
      lineStrong: '#c8bbe0',
      accent: '#9384bf',
      accentSoft: '#e6def4',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'pocari',
    name: '포카리',
    builtin: true,
    palette: {
      bg: '#f6f9fc',
      surface: '#ffffff',
      surfaceSoft: '#eef5fb',
      surfaceMuted: '#ddeaf5',
      ink: '#263746',
      inkSoft: '#526879',
      inkMuted: '#8aa1b2',
      line: '#dbe7f1',
      lineStrong: '#bfd3e4',
      accent: '#2589ec',
      accentSoft: '#e1f0ff',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'hawaii',
    name: '하와이',
    builtin: true,
    palette: {
      bg: '#eef4ee',
      surface: '#fffaf0',
      surfaceSoft: '#e5f0e8',
      surfaceMuted: '#d6e6de',
      ink: '#2f3c39',
      inkSoft: '#536963',
      inkMuted: '#84988f',
      line: '#d7e4db',
      lineStrong: '#bdd2c6',
      accent: '#c98973',
      accentSoft: '#f0ded5',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'mint-soda',
    name: '민트소다',
    builtin: true,
    palette: {
      bg: '#f2f5f6',
      surface: '#ffffff',
      surfaceSoft: '#e7f1f2',
      surfaceMuted: '#d6e8e7',
      ink: '#3b4248',
      inkSoft: '#5a666c',
      inkMuted: '#8b9aa0',
      line: '#dde7ea',
      lineStrong: '#bfd4d8',
      accent: '#63abc9',
      accentSoft: '#dff0f4',
      onAccent: '#ffffff',
    },
  },
  {
    id: 'lemon-butter',
    name: '레몬사와',
    builtin: true,
    palette: {
      bg: '#f7f5e8',
      surface: '#fffdf2',
      surfaceSoft: '#eaf3f0',
      surfaceMuted: '#dcebe8',
      ink: '#393d35',
      inkSoft: '#626a59',
      inkMuted: '#929a82',
      line: '#e4e5cd',
      lineStrong: '#ccd3ac',
      accent: '#d7b84d',
      accentSoft: '#f6edc5',
      onAccent: '#fffefa',
    },
  },
  {
    id: 'berry-matcha',
    name: '베리말차',
    builtin: true,
    palette: {
      bg: '#f3eee7',
      surface: '#fff9f5',
      surfaceSoft: '#e9e6d5',
      surfaceMuted: '#dcd6c3',
      ink: '#403a34',
      inkSoft: '#665d52',
      inkMuted: '#948a7d',
      line: '#e4d8cf',
      lineStrong: '#cbbdb0',
      accent: '#b88992',
      accentSoft: '#f0dedf',
      onAccent: '#ffffff',
    },
  },
]

export const defaultPalette = builtinThemes[0].palette

export function resolvePalette(settings: ViewerSettings): ThemePalette {
  if (settings.themeId === 'custom') return settings.customPalette
  const found =
    builtinThemes.find((theme) => theme.id === settings.themeId) ??
    settings.customThemes.find((theme) => theme.id === settings.themeId)
  return found?.palette ?? defaultPalette
}

export const defaultHighlightColors = ['#FCE29A', '#F6B8C4', '#B4E1C6', '#AFC7E8']

export const defaultSettings: ViewerSettings = {
  fontId: pretendardFont.id,
  fontFamily: pretendardFont.fontFamily,
  fontWeight: 400,
  fontWeightBoost: 0,
  uiFontId: pretendardFont.id,
  uiFontFamily: pretendardFont.fontFamily,
  uiFontScale: 1,
  uiFontWeight: 400,
  fonts: builtinFonts,
  fontSize: 16,
  lineHeight: 1.75,
  paragraphSpacing: 14,
  messageWidth: 720,
  languageMode: 'both',
  includeHidden: true,
  readMode: 'scroll',
  scrollWindowSize: 10,
  themeId: 'light',
  customPalette: defaultPalette,
  customThemes: [],
  showCoverImage: true,
  coverHeight: 200,
  coverPosition: 50,
  coverImageMode: 'original',
  tagModes: {},
  highlightColors: defaultHighlightColors,
  defaultHighlightColor: defaultHighlightColors[0],
  keyboardShortcutsEnabled: true,
  showProgressBar: true,
  showAvatars: true,
  showRoleBadges: true,
  notesEnabled: true,
  highlightEnabled: true,
  showMessageMeta: true,
  hideAiThinking: false,
  autoHideTopbar: false,
  homeTitle: '나의 서랍',
  homeBannerCoverHeight: 220,
  homeBannerCoverPosition: 50,
  homeCardMaxColumns: 6,
  homeCardCoverHeight: 150,
  homeCardLayoutMode: 'basic',
  homeCardImageMode: 'cover',
}

export function normalizeCoverPosition(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.min(Math.max(Math.round(value), 0), 100)
}

export function normalizeHomeBannerCoverHeight(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultSettings.homeBannerCoverHeight
  }
  return Math.min(Math.max(Math.round(value), 120), 420)
}

export function normalizeHomeCardCoverHeight(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultSettings.homeCardCoverHeight
  }
  return Math.min(Math.max(Math.round(value), 110), 260)
}

export function normalizeHomeCardMaxColumns(value?: number, legacyWidth?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (typeof legacyWidth === 'number' && Number.isFinite(legacyWidth)) {
      if (legacyWidth <= 180) return 7
      if (legacyWidth <= 220) return 6
      if (legacyWidth <= 270) return 5
      return 4
    }
    return defaultSettings.homeCardMaxColumns
  }
  return Math.min(Math.max(Math.round(value), 3), 7)
}

export function normalizeFontWeightBoost(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultSettings.fontWeightBoost
  }
  return Math.min(Math.max(Math.round(value * 10) / 10, 0), 0.4)
}

export function resolveReaderFontWeight(baseWeight?: number, boost?: number) {
  const base =
    typeof baseWeight === 'number' && Number.isFinite(baseWeight)
      ? baseWeight
      : defaultSettings.fontWeight
  return Math.min(Math.max(Math.round(base + normalizeFontWeightBoost(boost) * 1000), 300), 900)
}

export function normalizeCoverImageMode(value?: string) {
  return value === 'dark' || value === 'grayscale' || value === 'original'
    ? value
    : defaultSettings.coverImageMode
}

type LegacyHomeCardDisplayMode =
  | 'cover'
  | 'avatar'
  | 'simple-avatar'
  | 'simple-text'

function legacyHomeCardDisplayMode(value?: string): LegacyHomeCardDisplayMode | undefined {
  return value === 'cover' ||
    value === 'avatar' ||
    value === 'simple-avatar' ||
    value === 'simple-text'
    ? value
    : undefined
}

export function normalizeHomeCardLayoutMode(
  value?: string,
  legacyDisplayMode?: string,
) {
  if (value === 'basic' || value === 'simple') return value
  const legacy = legacyHomeCardDisplayMode(legacyDisplayMode)
  if (legacy === 'simple-avatar' || legacy === 'simple-text') return 'simple'
  return defaultSettings.homeCardLayoutMode
}

export function normalizeHomeCardImageMode(
  value?: string,
  legacyDisplayMode?: string,
) {
  if (value === 'cover' || value === 'avatar') return value
  const legacy = legacyHomeCardDisplayMode(legacyDisplayMode)
  if (legacy === 'avatar' || legacy === 'simple-avatar') return 'avatar'
  return defaultSettings.homeCardImageMode
}

export const settingsKey = 'st-chat-viewer:settings'

export function loadSettings(): ViewerSettings {
  try {
    const raw = localStorage.getItem(settingsKey)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<ViewerSettings> & {
      homeCardDisplayMode?: string
      homeCardWidth?: number
    }
    const fonts = mergeFonts(parsed.fonts)
    const readingFont = resolveFont(fonts, parsed.fontId)
    const uiFont = resolveFont(fonts, parsed.uiFontId)
    return {
      ...defaultSettings,
      ...parsed,
      fonts,
      fontId: readingFont.id,
      fontFamily: readingFont.fontFamily,
      uiFontId: uiFont.id,
      uiFontFamily: uiFont.fontFamily,
      themeId: parsed.themeId ?? defaultSettings.themeId,
      languageMode:
        parsed.languageMode === 'translated' ||
        parsed.languageMode === 'original' ||
        parsed.languageMode === 'both'
          ? parsed.languageMode
          : defaultSettings.languageMode,
      customPalette: {
        ...defaultPalette,
        ...parsed.customPalette,
      },
      customThemes: parsed.customThemes ?? [],
      highlightColors: parsed.highlightColors?.length
        ? parsed.highlightColors
        : defaultHighlightColors,
      defaultHighlightColor:
        parsed.defaultHighlightColor ?? defaultSettings.defaultHighlightColor,
      keyboardShortcutsEnabled:
        parsed.keyboardShortcutsEnabled ?? defaultSettings.keyboardShortcutsEnabled,
      fontWeight: parsed.fontWeight ?? defaultSettings.fontWeight,
      fontWeightBoost: normalizeFontWeightBoost(parsed.fontWeightBoost),
      uiFontScale: parsed.uiFontScale ?? defaultSettings.uiFontScale,
      uiFontWeight: parsed.uiFontWeight ?? defaultSettings.uiFontWeight,
      notesEnabled: parsed.notesEnabled ?? defaultSettings.notesEnabled,
      highlightEnabled: parsed.highlightEnabled ?? defaultSettings.highlightEnabled,
      showMessageMeta: parsed.showMessageMeta ?? defaultSettings.showMessageMeta,
      showRoleBadges: parsed.showRoleBadges ?? defaultSettings.showRoleBadges,
      hideAiThinking: parsed.hideAiThinking ?? defaultSettings.hideAiThinking,
      autoHideTopbar: parsed.autoHideTopbar ?? defaultSettings.autoHideTopbar,
      homeTitle:
        parsed.homeTitle && parsed.homeTitle !== '챗서랍'
          ? parsed.homeTitle
          : defaultSettings.homeTitle,
      coverPosition: normalizeCoverPosition(parsed.coverPosition),
      coverImageMode: normalizeCoverImageMode(parsed.coverImageMode),
      homeBannerCoverHeight: normalizeHomeBannerCoverHeight(
        parsed.homeBannerCoverHeight,
      ),
      homeBannerCoverPosition: normalizeCoverPosition(
        parsed.homeBannerCoverPosition,
      ),
      homeCardCoverHeight: normalizeHomeCardCoverHeight(
        parsed.homeCardCoverHeight,
      ),
      homeCardMaxColumns: normalizeHomeCardMaxColumns(
        parsed.homeCardMaxColumns,
        parsed.homeCardWidth,
      ),
      homeCardLayoutMode: normalizeHomeCardLayoutMode(
        parsed.homeCardLayoutMode,
        parsed.homeCardDisplayMode,
      ),
      homeCardImageMode: normalizeHomeCardImageMode(
        parsed.homeCardImageMode,
        parsed.homeCardDisplayMode,
      ),
    }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: ViewerSettings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings))
}

export const readingKey = 'st-chat-viewer:reading'

export function loadReadingPositions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(readingKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveReadingPositions(positions: Record<string, number>) {
  localStorage.setItem(readingKey, JSON.stringify(positions))
}
