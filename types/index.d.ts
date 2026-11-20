export type Preview = {
  /** The N of "[Image #N]" in the prompt box. */
  n: number
  /** The file it most likely is, or '' when nothing was found. */
  source: string
  /** How it was found: screenshot, finder, recent, clipboard, none. */
  via: string
  /** A PNG copy for drawing, '' when nothing was found. */
  png: string
  width: number
  height: number
}

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      previews: Preview[]
      selected: number | null
    }
  }
}
