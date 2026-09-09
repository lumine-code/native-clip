const { CompositeDisposable, Disposable } = require("lumine");
const fs = require("fs/promises");
const path = require("path");

/**
 * Drop effect constants matching the Windows DROPEFFECT values, which the
 * clipboard-files library speaks on every platform.
 */
const DROP_EFFECT_NONE = 0;
const DROP_EFFECT_COPY = 1;
const DROP_EFFECT_MOVE = 2;
const DROP_EFFECT_LINK = 4;

// Loaded lazily so the package can be required before its dependencies are
// installed, e.g. by a spec runner that stubs the clipboard entirely.
let clipboardLib = null;
function clipboard() {
  if (!clipboardLib) {
    clipboardLib = require("@lumine-code/clipboard-files");
  }
  return clipboardLib;
}

async function pathExists(pth) {
  try {
    await fs.access(pth);
    return true;
  } catch {
    return false;
  }
}

/**
 * Native Clip Package
 * File cut/copy/paste through the system clipboard, interoperating with the
 * platform file manager. Owns the tree-view commands and provides the same
 * operations as a service for other packages' surfaces.
 */
module.exports = {
  activate() {
    this.disposables = new CompositeDisposable();
    this.busySignal = null;
    this.busyProvider = null;
    this.disposables.add(
      lumine.commands.add(".tree-view", {
        "native-clip:cut": {
          description: "Cut the selected entries to the system clipboard.",
          didDispatch: () => this.treeCut(),
        },
        "native-clip:copy": {
          description: "Copy the selected entries to the system clipboard.",
          didDispatch: () => this.treeCopy(),
        },
        "native-clip:paste": {
          description: "Paste the system clipboard into the selected folder.",
          didDispatch: () => this.treePaste(),
        },
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
    if (this.busyProvider) {
      this.busyProvider.dispose();
      this.busyProvider = null;
    }
  },

  // ===== Services ===== //

  /**
   * Provides the system clipboard service: the raw clipboard primitives plus
   * the high-level cut/copy/paste operations with their Lumine UI.
   * @returns {Object} Service object with clipboard methods and constants
   */
  provideNativeClip() {
    return {
      DROP_EFFECT_NONE,
      DROP_EFFECT_COPY,
      DROP_EFFECT_MOVE,
      DROP_EFFECT_LINK,

      readFilePaths: () => this.getFilepaths(),
      readDropEffect: () => this.getDropEffect(),
      writeFilePaths: (filePaths, dropEffect = DROP_EFFECT_COPY) =>
        this.setFilepaths(filePaths, dropEffect),
      clear: () => this.clearClipboard(),

      cutPaths: (filePaths) => this.cutPaths(filePaths),
      copyPaths: (filePaths) => this.copyPaths(filePaths),
      pasteInto: (destDirs) => this.pasteInto(destDirs),
    };
  },

  consumeTreeViewSelection(treeView) {
    this.treeView = treeView;
    return new Disposable(() => {
      this.treeView = null;
    });
  },

  consumeBusySignal(busySignal) {
    this.busySignal = busySignal;
    return new Disposable(() => {
      if (this.busyProvider) {
        this.busyProvider.dispose();
      }
      this.busyProvider = null;
      this.busySignal = null;
    });
  },

  // ===== Clipboard primitives ===== //

  /** @returns {Promise<string[]>} File paths on the system clipboard */
  getFilepaths() {
    return clipboard().readFilePaths();
  },

  /** @returns {Promise<number>} Drop effect constant (NONE=0, COPY=1, MOVE=2, LINK=4) */
  getDropEffect() {
    return clipboard().readDropEffect();
  },

  /**
   * Writes file paths to the system clipboard with a drop effect.
   * @param {string[]} filePaths - Array of file paths to write
   * @param {number} dropEffect - Drop effect constant (default: COPY)
   */
  setFilepaths(filePaths, dropEffect = DROP_EFFECT_COPY) {
    return clipboard().writeFilePaths(filePaths, dropEffect);
  },

  /** Clears the system clipboard. */
  clearClipboard() {
    return clipboard().clear();
  },

  // ===== High-level operations ===== //

  /**
   * Cuts paths to the system clipboard and confirms with a notification.
   * @param {string[]} filePaths - Absolute paths to cut
   */
  async cutPaths(filePaths) {
    if (!filePaths || filePaths.length === 0) {
      return;
    }
    await this.setFilepaths(filePaths, DROP_EFFECT_MOVE);
    lumine.notifications.addSuccess(this.describeEntries("Cut", filePaths), {
      detail: filePaths.join("\n"),
    });
  },

  /**
   * Copies paths to the system clipboard and confirms with a notification.
   * @param {string[]} filePaths - Absolute paths to copy
   */
  async copyPaths(filePaths) {
    if (!filePaths || filePaths.length === 0) {
      return;
    }
    await this.setFilepaths(filePaths, DROP_EFFECT_COPY);
    lumine.notifications.addSuccess(this.describeEntries("Copied", filePaths), {
      detail: filePaths.join("\n"),
    });
  },

  describeEntries(verb, filePaths) {
    const what =
      filePaths.length === 1 ? `"${path.basename(filePaths[0])}"` : `${filePaths.length} entries`;
    return `${verb} ${what} to the system clipboard`;
  },

  /**
   * Pastes the system clipboard into the given directories. Collisions ask
   * what to do through a notification; progress shows on the busy signal.
   * @param {string[]} destDirs - Destination directories
   */
  async pasteInto(destDirs) {
    const dirs = [...new Set((destDirs || []).filter(Boolean).map((dir) => path.normalize(dir)))];
    if (dirs.length === 0) {
      return;
    }

    const srcs = await this.getFilepaths();
    if (srcs.length === 0) {
      lumine.notifications.addInfo("Nothing to paste", {
        detail: "The system clipboard holds no files.",
      });
      return;
    }

    const dropEffect = await this.getDropEffect();
    // Moving to several destinations at once would have to pick one winner,
    // so a multi-destination paste of a cut copies instead.
    const isMove = dropEffect === DROP_EFFECT_MOVE && dirs.length === 1;

    const jobs = [];
    for (const dstDir of dirs) {
      for (const src of srcs) {
        const srcNorm = path.normalize(src);
        let effectiveDstDir = dstDir;
        // Pasting a folder into itself or below itself lands next to the
        // source instead, matching what the file managers do.
        if (dstDir === srcNorm || dstDir.startsWith(srcNorm + path.sep)) {
          effectiveDstDir = path.dirname(srcNorm);
        }
        jobs.push({ src: srcNorm, dst: path.join(effectiveDstDir, path.basename(srcNorm)) });
      }
    }

    // Counted up front only to decide whether the prompt offers "All"
    // buttons; each entry re-checks the disk when its turn comes.
    let expectedConflicts = 0;
    for (const job of jobs) {
      if (job.dst !== job.src && (await pathExists(job.dst))) {
        expectedConflicts += 1;
      }
    }

    let pasted = 0;
    let skipped = 0;
    let failed = 0;
    let sticky = null;

    const title = `native-clip: pasting ${jobs.length === 1 ? "1 entry" : `${jobs.length} entries`}`;
    await this.withBusy(title, async () => {
      for (const job of jobs) {
        let dst = job.dst;
        let overwrite = false;
        if (dst === job.src) {
          // A duplicate in place: never a prompt, always a fresh name.
          dst = await this.findName(dst);
        } else if (await pathExists(dst)) {
          let choice = sticky;
          if (!choice) {
            const answer = await this.promptConflict(dst, expectedConflicts > 1);
            if (answer.all) {
              sticky = answer.choice;
            }
            choice = answer.choice;
          }
          if (choice === "skip") {
            skipped += 1;
            continue;
          }
          if (choice === "keep-both") {
            dst = await this.findName(dst);
          }
          if (choice === "replace") {
            overwrite = true;
          }
        }
        try {
          if (isMove) {
            await this.moveEntry(job.src, dst, overwrite);
          } else {
            await fs.cp(job.src, dst, {
              recursive: true,
              force: overwrite,
              errorOnExist: !overwrite,
            });
          }
          pasted += 1;
        } catch (error) {
          failed += 1;
          lumine.notifications.addError(
            `Failed to ${isMove ? "move" : "copy"} "${path.basename(job.src)}"`,
            {
              detail: `${job.src}\n${dst}\n\n${error.message}`,
              dismissable: true,
            },
          );
        }
      }
    });

    if (isMove && pasted > 0) {
      // The sources moved; what the clipboard names no longer exists.
      await this.clearClipboard();
    }
    if (pasted > 0) {
      const asides = [];
      if (skipped > 0) {
        asides.push(`${skipped} skipped`);
      }
      if (failed > 0) {
        asides.push(`${failed} failed`);
      }
      const count = pasted === 1 ? "1 entry" : `${pasted} entries`;
      const aside = asides.length > 0 ? ` (${asides.join(", ")})` : "";
      lumine.notifications.addSuccess(`${isMove ? "Moved" : "Pasted"} ${count}${aside}`);
    }
  },

  /**
   * Asks what a paste should do with an entry that already exists.
   * @param {string} conflictPath - The destination that is already taken
   * @param {boolean} offerAll - Whether to offer answers for all conflicts
   * @returns {Promise<{choice: string, all: boolean}>} replace, keep-both or skip
   */
  promptConflict(conflictPath, offerAll) {
    return new Promise((resolve) => {
      const finish = (choice, all) => {
        resolve({ choice, all });
        notification.dismiss();
      };
      const buttons = [
        { text: "Replace", onDidClick: () => finish("replace", false) },
        { text: "Keep Both", onDidClick: () => finish("keep-both", false) },
        { text: "Skip", onDidClick: () => finish("skip", false) },
      ];
      if (offerAll) {
        buttons.push(
          { text: "Replace All", onDidClick: () => finish("replace", true) },
          { text: "Keep Both All", onDidClick: () => finish("keep-both", true) },
          { text: "Skip All", onDidClick: () => finish("skip", true) },
        );
      }
      const notification = lumine.notifications.addWarning(
        `"${path.basename(conflictPath)}" already exists`,
        {
          detail: conflictPath,
          description: "Choose what the paste should do with it.",
          dismissable: true,
          buttons,
        },
      );
      // Closing the notification without choosing skips the entry.
      notification.onDidDismiss(() => resolve({ choice: "skip", all: false }));
    });
  },

  /**
   * Runs an operation with a message on the busy signal, when the service is
   * around; without it the operation simply runs unannounced.
   */
  async withBusy(title, fn) {
    if (this.busySignal && !this.busyProvider) {
      this.busyProvider = this.busySignal.create();
    }
    const provider = this.busyProvider;
    if (provider) {
      provider.add(title);
    }
    try {
      return await fn();
    } finally {
      if (provider) {
        provider.remove(title);
      }
    }
  },

  // ===== tree-view ===== //

  /** Cuts the tree-view selection to the system clipboard. */
  async treeCut() {
    if (!this.treeView) {
      return;
    }
    const paths = this.treeView.selectedPaths();
    if (paths.length > 0) {
      await this.cutPaths(paths);
    }
  },

  /** Copies the tree-view selection to the system clipboard. */
  async treeCopy() {
    if (!this.treeView) {
      return;
    }
    const paths = this.treeView.selectedPaths();
    if (paths.length > 0) {
      await this.copyPaths(paths);
    }
  },

  /** Pastes the system clipboard into the directories the tree has selected. */
  async treePaste() {
    if (!this.treeView) {
      return;
    }
    const dstDirs = [];
    for (let sel of this.treeView.selectedPaths()) {
      try {
        if (!(await fs.lstat(sel)).isDirectory()) {
          sel = path.dirname(sel);
        }
        if (!dstDirs.includes(sel)) {
          dstDirs.push(sel);
        }
      } catch (error) {
        lumine.notifications.addError(`Failed to read the selected entry`, {
          detail: `${sel}\n\n${error.message}`,
          dismissable: true,
        });
      }
    }
    if (dstDirs.length > 0) {
      await this.pasteInto(dstDirs);
    }
  },

  // ===== Tools ===== //

  /**
   * Moves a file or directory, replacing the destination when requested.
   * Falls back to copy + delete when the rename crosses devices.
   * @param {string} src - The source path
   * @param {string} dst - The destination path
   * @param {boolean} overwrite - Whether to replace an existing destination
   */
  async moveEntry(src, dst, overwrite) {
    const isDirectory = (await fs.lstat(src)).isDirectory();
    const rename = { oldPath: src, newPath: dst, isDirectory };
    const transaction = lumine.workspace.beginFileMove([rename]);
    let moved = false;
    try {
      if (await pathExists(dst)) {
        if (!overwrite) throw new Error(`Destination already exists: ${dst}`);
        await fs.rm(dst, { recursive: true, force: true });
      }
      try {
        await fs.rename(src, dst);
      } catch (err) {
        if (err.code !== "EXDEV") throw err;
        await fs.cp(src, dst, { recursive: true });
        await fs.rm(src, { recursive: true, force: true });
      }
      moved = true;
    } finally {
      await transaction.complete(moved ? [rename] : []);
    }
  },

  /**
   * Finds a unique filename for the destination, avoiding collisions.
   * @param {string} dst - The desired destination path
   * @returns {Promise<string>} A unique path that doesn't exist
   */
  async findName(dst) {
    for (let i = 0; ; i++) {
      const pth = this.getCopyName(dst, i);
      if (!(await pathExists(pth))) {
        return pth;
      }
    }
  },

  /**
   * Generates a copy name for a file, `<name> - Copy (n)<ext>`.
   * @param {string} dst - The original destination path
   * @param {number} i - The copy index (0 = original, 1 = "- Copy", 2+ = "- Copy (n)")
   * @returns {string} The formatted path with copy suffix
   */
  getCopyName(dst, i) {
    if (i > 0) {
      const pth = path.parse(dst);
      const num = i === 1 ? "" : ` (${i})`;
      return `${pth.dir}${path.sep}${pth.name} - Copy${num}${pth.ext}`;
    } else {
      return dst;
    }
  },
};
