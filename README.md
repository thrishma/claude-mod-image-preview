# Image preview for Claude Code

When you drop or paste an image into the Claude Code prompt, the box only says `[Image #1]`. This mod opens a side pane that shows **which image that is, before you press Enter**, so you can check you're sending the right one.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install image-preview --marketplace thrishma/claude-mod-image-preview
```

Answer `y` to add the marketplace, then pick a scope (user is the default).

From a shell:

```
claude plugin install image-preview --marketplace thrishma/claude-mod-image-preview
```

## How it works

Claude Code doesn't hand a mod the image until the message is sent. So when a new `[Image #N]` appears in the prompt box, the mod works out which file it is, in this order:

1. A screenshot you just dragged from the macOS screenshot thumbnail
2. The image selected in Finder (what a Finder drag drags)
3. An image saved to your Desktop or Downloads in the last 3 minutes
4. An image on the clipboard (a Ctrl+V paste)

The pane shows the file name, how it was found, the picture, and an **Open large** button that opens it in Preview. With several images in the box, press 1–9 to switch between them. The preview goes away when you send or clear the message.

It's a best guess: it's reliable for screenshots and Finder drags. An image dragged from somewhere else (a browser, Slack) may show "couldn't tell" or, if an older image is still selected in Finder, that one.

## Requirements

- macOS (it uses Finder, `sips` and the macOS screenshot folder)
- A terminal that can draw images: kitty, Ghostty, iTerm2 3.5+, or Rex. Elsewhere the pane shows the file name without the picture.
- The first time, macOS may ask to let Claude Code control Finder. Allow it, or Finder drags can't be previewed.

Preview copies are written to `~/.claude/image-preview/` and replaced each time.

## License

MIT
