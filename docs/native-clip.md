# native-clip

System clipboard access for file paths — the cut/copy distinction included — plus the shared cut, copy and paste operations with their Lumine UI.

|             |                                                             |
| ----------- | ----------------------------------------------------------- |
| Version     | `1.0.0`                                                     |
| Provided by | `provideNativeClip()` returning the clipboard API           |
| Consumed by | `consumeNativeClip(clip)`                                   |
| Owner       | [`native-clip`](https://github.com/lumine-code/native-clip) |

The platform clipboard carries text, not files. This service is what lets a package copy files to the platform file manager, paste files from it, and tell a copy from a cut — none of which the built-in clipboard can express. The high-level operations exist so every surface pastes the same way: one conflict prompt, one busy-signal message, one set of notifications.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "native-clip": {
      "versions": { "^1.0.0": "consumeNativeClip" }
    }
  }
}
```

## Contract

```ts
type NativeClip = {
  readFilePaths(): Promise<string[]>;
  readDropEffect(): Promise<number>;
  writeFilePaths(filePaths: string[], dropEffect?: number): Promise<void>;
  clear(): Promise<void>;

  cutPaths(filePaths: string[]): Promise<void>;
  copyPaths(filePaths: string[]): Promise<void>;
  pasteInto(destDirs: string[]): Promise<void>;

  DROP_EFFECT_NONE: 0;
  DROP_EFFECT_COPY: 1;
  DROP_EFFECT_MOVE: 2;
  DROP_EFFECT_LINK: 4;
};
```

| Member                              | Description                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `readFilePaths()`                   | The file paths on the clipboard, or `[]`.                                      |
| `readDropEffect()`                  | Whether they were copied, cut, or linked. One of the constants.                |
| `writeFilePaths(paths, dropEffect)` | Puts paths on the clipboard. `dropEffect` defaults to `DROP_EFFECT_COPY`.      |
| `clear()`                           | Empties the clipboard.                                                         |
| `cutPaths(paths)`                   | Writes a cut and confirms with a success notification.                         |
| `copyPaths(paths)`                  | Writes a copy and confirms with a success notification.                        |
| `pasteInto(destDirs)`               | The full paste: conflict prompts, busy signal, move-or-copy, clear after move. |

## Minimal example

```js
const { Disposable } = require("lumine");

module.exports = {
  consumeNativeClip(clip) {
    this.clip = clip;
    return new Disposable(() => (this.clip = null));
  },

  cutSelection(paths) {
    return this.clip?.cutPaths(paths);
  },

  pasteHere(directory) {
    return this.clip?.pasteInto([directory]);
  },
};
```

## Behavior

**Guard on having received the service**, not on `process.platform` — the service is provided on every platform, but a consumer package can still be activated before this one.

**Prefer the high-level operations.** `pasteInto` asks the user about collisions (Replace / Keep Both / Skip, with All variants when several collide), reports progress through the `busy-signal` service, notifies successes and failures, and clears the clipboard after a completed move. If only some cut entries move, it keeps the skipped or failed entries on the clipboard for a retry. A package that pastes by hand re-implements all of that.

**Read `readDropEffect()` before acting on raw paths.** A cut and a copy put the same paths on the clipboard; only the drop effect distinguishes them, and ignoring it turns every cut into a copy.

Platform notes, all inherited from [`@lumine-code/clipboard-files`](https://github.com/lumine-code/clipboard-files):

- **Windows** — full fidelity: `CF_HDROP` plus the `Preferred DropEffect` format, exactly as Explorer writes them.
- **macOS** — paths are real pasteboard file URLs; Finder pastes them with ⌘V and moves them with ⌘⌥V. The pasteboard has no cut convention of its own, so the effect travels as a custom pasteboard type readable by anything that adopts it; content from other apps reads as a copy.
- **Linux** — `x-special/gnome-copied-files`, `text/uri-list` and the KDE cut marker, via Electron's clipboard. On Electron ≤ 43 only one format can be offered per write, so cross-desktop fidelity has limits until the transport moves to the Electron 44 API.

Use the constants rather than the numbers. They are the Windows values, and `DROP_EFFECT_LINK` is `4` rather than `3`, so counting will get it wrong.

`readFilePaths()` returns `[]` for a clipboard holding something else — text, an image — which is not distinguishable from an empty clipboard through this API.

Paths are whatever the clipboard carries and are not checked for existence.

## Teardown

Return a `Disposable` that drops your reference. The clipboard is system state — **do not `clear()` on teardown**, since its contents belong to the user, not to your package.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
