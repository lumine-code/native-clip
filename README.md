# native-clip

Cut, copy and paste files between the tree view and the system clipboard.

## Features

- **System clipboard**: file paths travel on the real clipboard, so cut and copied files interoperate with Explorer, Finder, Nautilus and Dolphin in both directions.
- **Cut/Copy/Paste**: full clipboard operations from the tree view, with the cut/copy distinction each platform expresses.
- **Conflict prompts**: pasting over an existing entry asks — Replace, Keep Both or Skip, with All variants when several entries collide.
- **Busy signal**: long pastes report progress on the status bar's busy indicator.
- **Service**: provides the clipboard primitives and the shared cut/copy/paste operations to other packages.

## Installation

To install `native-clip` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/native-clip`.

## Commands

Commands available in `lumine-workspace`:

- `native-clip:cut`: cut selected files/folders to the system clipboard,
- `native-clip:copy`: copy selected files/folders to the system clipboard,
- `native-clip:paste`: paste from the system clipboard into the selected folder.

## Services

- [`native-clip`](docs/native-clip.md): provided to expose system clipboard access for file paths — the raw primitives plus the shared `cutPaths()`, `copyPaths()` and `pasteInto()` operations.
- `tree-view.selection`: consumed to read the selected files and folders for clipboard operations.
- `busy-signal`: consumed to report paste progress on the status bar.

## Usage

Cut or copied files land on the platform clipboard in its native file format, so they paste into the system file manager and files cut or copied there paste into the tree view. On macOS the pasteboard has no cut marker of its own — Finder decides move-versus-copy at paste time (⌘V copies, ⌘⌥V moves), and a cut made here still moves when pasted back inside the editor. Pasting an entry over an existing one asks what to do; pasting an entry into its own folder duplicates it under a `<name> - Copy (n)` name.

## Contributing

Local tests leave the system clipboard untouched. The native clipboard round-trip runs only when `LUMINE_TEST_SYSTEM_CLIPBOARD=true`; CI enables it on its disposable runners.

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
