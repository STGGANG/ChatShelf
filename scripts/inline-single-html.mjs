import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist-single')
const releaseDir = path.join(root, 'release')
const outputPath = path.join(releaseDir, 'ChatShelf.html')
const iconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#f4efe8"/><path fill="#aa897c" d="M28 32h22a18 18 0 0 1 14 6.7A18 18 0 0 1 78 32h22a8 8 0 0 1 8 8v58a8 8 0 0 1-8 8H78a18 18 0 0 0-12.6 5.2 2 2 0 0 1-2.8 0A18 18 0 0 0 50 106H28a8 8 0 0 1-8-8V40a8 8 0 0 1 8-8Zm6 16v42h16a33 33 0 0 1 8 1V51a10 10 0 0 0-8-3H34Zm60 0H78a10 10 0 0 0-8 3v40a33 33 0 0 1 8-1h16V48Z"/></svg>'
const iconUrl = `data:image/svg+xml,${encodeURIComponent(iconSvg)}`

const resolveDistPath = (href) =>
  path.join(distDir, decodeURIComponent(href.replace(/^\.?\//, '')))

let html = await readFile(path.join(distDir, 'index.html'), 'utf8')

html = html
  .replaceAll('href="./favicon.png"', `href="${iconUrl}"`)
  .replaceAll('href="./favicon.svg"', `href="${iconUrl}"`)
  .replace(/\s*<link\s+rel="apple-touch-icon"[^>]*>\n?/g, '\n')
  .replace(/\s*<link\s+rel="manifest"[^>]*>\n?/g, '\n')

for (const match of [
  ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g),
]) {
  const [tag, href] = match
  const css = await readFile(resolveDistPath(href), 'utf8')
  html = html.replace(
    tag,
    () => `<style data-inline="${path.basename(href)}">\n${css.replaceAll(
      '</style',
      '<\\/style',
    )}\n</style>`,
  )
}

for (const match of [...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)><\/script>/g)]) {
  const [tag, before, src, after] = match
  if (!`${before} ${after}`.includes('type="module"')) continue
  const js = await readFile(resolveDistPath(src), 'utf8')
  html = html.replace(
    tag,
    () => `<script type="module" data-inline="${path.basename(src)}">\n${js.replaceAll(
      '</script',
      '<\\/script',
    )}\n</script>`,
  )
}

await rm(releaseDir, { recursive: true, force: true })
await mkdir(releaseDir, { recursive: true })
await writeFile(outputPath, html, 'utf8')

const sizeKb = Math.round(Buffer.byteLength(html, 'utf8') / 1024)
console.log(`Created ${path.relative(root, outputPath)} (${sizeKb} KB)`)
