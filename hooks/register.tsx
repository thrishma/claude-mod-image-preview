import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Preview } from '../types'

// Image preview: when an image lands in the prompt box as "[Image #N]", show
// which image it is BEFORE you press Enter.
//
// Claude Code doesn't hand a mod the image until the message is sent, so the
// mod works out which file you just dropped or pasted, in this order:
//   1. a screenshot dragged from the macOS thumbnail (a temp file, minutes old)
//   2. the image selected in Finder (what a Finder drag drags)
//   3. an image saved to Desktop or Downloads in the last 3 minutes
//   4. an image on the clipboard (a Ctrl+V paste)
// Nothing is kept: previews are temp PNGs, cleared when the box is emptied.

const PANE = 'image-preview'
const PREVIEW_DIR = '.claude/image-preview'

const previews = atom({ plugin: 'image-preview', key: 'previews' } as const, [] as Preview[])
const selected = atom({ plugin: 'image-preview', key: 'selected' } as const, null as number | null)

// $1: N. Prints "source<TAB>via<TAB>png<TAB>width<TAB>height". Arguments go in
// as $1, never spliced into the script.
const GUESS = `
n="$1"; out="$HOME/${PREVIEW_DIR}"; mkdir -p "$out"
newest() { find "$@" -maxdepth 2 -type f \\( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.heic' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.tiff' \\) -mmin -3 -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-; }
via=""; src=""
t="\${TMPDIR:-/tmp}"; t="\${t%/}/TemporaryItems"
if [ -d "$t" ]; then src=$(newest "$t"); [ -n "$src" ] && via=screenshot; fi
if [ -z "$src" ]; then
  src=$(osascript -e 'tell application "Finder" to set s to selection as alias list' -e 'repeat with a in s' -e 'set p to POSIX path of a' -e 'if p ends with ".png" or p ends with ".jpg" or p ends with ".jpeg" or p ends with ".heic" or p ends with ".gif" or p ends with ".webp" or p ends with ".tiff" or p ends with ".PNG" or p ends with ".JPG" or p ends with ".JPEG" or p ends with ".HEIC" then return p' -e 'end repeat' -e 'return ""' 2>/dev/null)
  if [ -n "$src" ] && [ -f "$src" ]; then via=finder; else src=""; fi
fi
if [ -z "$src" ]; then src=$(newest "$HOME/Desktop" "$HOME/Downloads"); [ -n "$src" ] && via=recent; fi
png="$out/image-$n.png"; rm -f "$png"
if [ -n "$src" ]; then
  sips -s format png -Z 1600 "$src" --out "$png" >/dev/null 2>&1 || png=""
else
  osascript -e 'on run argv' -e 'set f to open for access POSIX file (item 1 of argv) with write permission' -e 'try' -e 'write (the clipboard as «class PNGf») to f' -e 'end try' -e 'close access f' -e 'end run' "$png" >/dev/null 2>&1
  if [ -s "$png" ]; then via=clipboard; src="Clipboard image"; else rm -f "$png"; png=""; via=none; fi
fi
w=0; h=0
if [ -n "$png" ]; then
  w=$(sips -g pixelWidth "$png" 2>/dev/null | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$png" 2>/dev/null | awk '/pixelHeight/{print $2}')
fi
printf '%s\\t%s\\t%s\\t%s\\t%s' "$src" "$via" "$png" "\${w:-0}" "\${h:-0}"`

const run = ($: EngineInterface, script: string, args: string[]) =>
  $.process.run(['/bin/sh', '-c', script, 'image-preview', ...args], { timeoutMs: 20_000 })

// The N of every "[Image #N]" in the box.
function placeholders(text: string): number[] {
  return [...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1]))
}

// Numbers being worked out right now, so a burst of changes guesses once.
const pending = new Set<number>()

async function sync($: EngineInterface, text: string) {
  const now = placeholders(text)
  const have = await read($, previews)
  const kept = have.filter(p => now.includes(p.n))
  if (kept.length !== have.length) await update($, previews, () => kept)

  if (now.length === 0) {
    if (have.length) await $.ui.close({ id: PANE }).catch(() => undefined)
    return
  }

  for (const n of now) {
    if (kept.some(p => p.n === n) || pending.has(n)) continue
    pending.add(n)
    try {
      const r = await run($, GUESS, [String(n)])
      const [source = '', via = 'none', png = '', w = '0', h = '0'] = r.stdout.split('\t')
      const p: Preview = { n, source, via, png, width: Number(w), height: Number(h) }
      await update($, previews, list => [...list.filter(x => x.n !== n), p].sort((a, b) => a.n - b.n))
      await update($, selected, () => n)
      await $.ui.open({ id: PANE, title: 'Image preview' })
    } finally {
      pending.delete(n)
    }
  }
}

const VIA: Record<string, string> = {
  screenshot: 'the screenshot you just took',
  finder: 'selected in Finder',
  recent: 'added to Desktop/Downloads in the last few minutes',
  clipboard: 'from the clipboard',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, previews, () => [])
    return started
  })

  // Dropping or pasting an image changes the box as the engine, not as typing.
  on('prompt.change', async ($, e, next) => {
    void sync($, e.text).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Deleting an "[Image #N]" by hand drops its preview.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (e.text.includes('[Image #')) void sync($, box.text).catch(() => undefined)
    return box
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Image } = $.ui.resolve(e) as any
    const list = await read($, previews)
    const selN = await read($, selected)
    const sel = list.find(p => p.n === selN) ?? list[list.length - 1]
    const cols = Math.max(20, (e.viewport?.columns ?? 60) - 2)
    const rows = Math.max(10, e.viewport?.rows ?? 30)

    if (!sel) return <Text dimColor>Drop or paste an image into the prompt to preview it here.</Text>

    const name = sel.source ? sel.source.split('/').pop() : '(unknown)'
    const room = Math.max(4, Math.min(255, rows - (list.length > 1 ? list.length : 0) - 5))
    let imgCols = Math.min(255, cols)
    let imgRows = sel.width > 0 ? Math.round((imgCols * sel.height) / sel.width / 2) : room
    if (imgRows > room) {
      imgCols = Math.max(1, Math.round((imgCols * room) / imgRows))
      imgRows = room
    }
    imgRows = Math.max(1, Math.min(255, imgRows))

    return (
      <Box flexDirection="column">
        {list.length > 1 &&
          list.map((p, i) => (
            <Button
              key={`n-${p.n}`}
              plain
              {...(i < 9 ? { hotkey: String(i + 1) } : {})}
              dimColor={p.n !== sel.n}
              onPress={() => void update($, selected, () => p.n)}
            >
              {p.n === sel.n ? '▸ ' : '  '}Image #{p.n} {p.source ? p.source.split('/').pop() : '(unknown)'}
            </Button>
          ))}
        <Text bold>
          Image #{sel.n}: {name}
        </Text>
        {sel.png ? (
          <Box flexDirection="column">
            <Text dimColor>Best guess: {VIA[sel.via] ?? sel.via}</Text>
            <Image source={{ file: sel.png, format: 'png' }} columns={imgCols} rows={imgRows} alt={name} />
            {sel.via !== 'clipboard' && (
              <Button key="open" hotkey="o" onPress={() => void $.process.run(['/usr/bin/open', '-a', 'Preview', sel.source])}>
                Open large
              </Button>
            )}
          </Box>
        ) : (
          <Text dimColor>
            Couldn't tell which file this is. Select it in Finder before dragging, or drop a fresh screenshot.
          </Text>
        )}
      </Box>
    )
  })
}
