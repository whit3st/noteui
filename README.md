# noteui

A tiny terminal note-taking app built with [OpenTUI](https://github.com/anomalyco/opentui).

## What it does

- Lists all your markdown notes in a sidebar
- Opens the selected note in **neovim**
- When you quit neovim, you're back at the sidebar
- Create and delete notes without leaving the terminal

## Install (local dev)

```bash
cd /path/to/noteui
bun install
```

## Usage

```bash
# Run directly
bun index.ts

# Or use the wrapper
./noteui
```

## Install as a command

```bash
# one-time global install from npm (after publish)
npm i -g noteui

# then run from anywhere
noteui
```

For local testing before publish:

```bash
npm link
noteui
```

### Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate notes |
| `Enter` | Open selected note in nvim |
| `n` | Create new note |
| `d` | Delete note (press twice to confirm) |
| `r` | Refresh list |
| `q` | Quit |

When creating a new note, type the filename and press `Enter`. The `.md` extension is added automatically if omitted. Press `Esc` to cancel.

## Configuration

### Notes directory

By default, notes are stored in `~/notes`. Override with:

```bash
NOTEUI_DIR=~/my-notes bun index.ts
```

### Git auto-sync in neovim

Add this to your nvim config to auto-commit and push on every save:

```lua
-- Auto-sync notes on save
vim.api.nvim_create_autocmd("BufWritePost", {
  pattern = { "*/notes/*.md", "*/noteui/*.md" },
  callback = function()
    local dir = vim.fn.expand("%:p:h")
    local file = vim.fn.expand("%:t")
    vim.fn.system({"git", "-C", dir, "add", file})
    vim.fn.system({"git", "-C", dir, "commit", "-m", "update: " .. file})
    vim.fn.system({"git", "-C", dir, "push"})
  end,
})
```

> Make sure your notes directory is a git repository.

## Tech stack

- [Bun](https://bun.sh)
- [OpenTUI](https://opentui.com) — terminal UI library
- Neovim — editor

## License

MIT
