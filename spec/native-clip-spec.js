const fs = require("fs");
const os = require("os");
const path = require("path");
const mainModule = require("../lib/main");

describe("native-clip", () => {
  describe("getCopyName", () => {
    it("returns the original path for index 0", () => {
      const dst = path.join("C:", "tmp", "file.txt");
      expect(mainModule.getCopyName(dst, 0)).toBe(dst);
    });

    it("appends the copy suffix for later indices", () => {
      const dst = path.join("C:", "tmp", "file.txt");
      expect(mainModule.getCopyName(dst, 1)).toBe(path.join("C:", "tmp", "file - Copy.txt"));
      expect(mainModule.getCopyName(dst, 3)).toBe(path.join("C:", "tmp", "file - Copy (3).txt"));
    });
  });

  describe("findName", () => {
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-clip-"));
    });

    afterEach(() => {
      // Retries because Windows keeps a directory non-empty until the last handle on a
      // child closes, and `force` swallows only ENOENT.
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });

    it("returns the path unchanged when nothing exists", async () => {
      const dst = path.join(dir, "a.txt");
      expect(await mainModule.findName(dst)).toBe(dst);
    });

    it("skips over existing copies", async () => {
      const dst = path.join(dir, "a.txt");
      fs.writeFileSync(dst, "x");
      fs.writeFileSync(path.join(dir, "a - Copy.txt"), "x");
      expect(await mainModule.findName(dst)).toBe(path.join(dir, "a - Copy (2).txt"));
    });
  });

  describe("treePaste", () => {
    let dir, srcDir, dstDir, fakePaths, fakeEffect, cleared;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-clip-"));
      srcDir = path.join(dir, "src");
      dstDir = path.join(dir, "dst");
      fs.mkdirSync(srcDir);
      fs.mkdirSync(dstDir);
      fs.writeFileSync(path.join(srcDir, "file.txt"), "content");

      fakePaths = [path.join(srcDir, "file.txt")];
      fakeEffect = 1; // DROP_EFFECT_COPY
      cleared = false;
      mainModule.treeView = { selectedPaths: () => [dstDir] };
      spyOn(mainModule, "getFilepaths").and.callFake(() => fakePaths);
      spyOn(mainModule, "getDropEffect").and.callFake(() => fakeEffect);
      spyOn(mainModule, "clearClipboard").and.callFake(() => {
        cleared = true;
      });
      // Answered per test; the default skips so an unexpected conflict can
      // never hang the suite on a real notification.
      spyOn(mainModule, "promptConflict").and.resolveTo({ choice: "skip", all: false });
      spyOn(lumine.notifications, "addSuccess").and.callThrough();
    });

    afterEach(() => {
      mainModule.treeView = null;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });

    it("copies clipboard files into the selected directory", async () => {
      await mainModule.treePaste();
      expect(fs.readFileSync(path.join(dstDir, "file.txt"), "utf8")).toBe("content");
      expect(fs.existsSync(path.join(srcDir, "file.txt"))).toBe(true);
      expect(mainModule.promptConflict).not.toHaveBeenCalled();
      expect(cleared).toBe(false);
      expect(lumine.notifications.addSuccess).toHaveBeenCalled();
    });

    it("replaces on collision when the prompt says so", async () => {
      fs.writeFileSync(path.join(dstDir, "file.txt"), "old");
      mainModule.promptConflict.and.resolveTo({ choice: "replace", all: false });
      await mainModule.treePaste();
      expect(mainModule.promptConflict).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(path.join(dstDir, "file.txt"), "utf8")).toBe("content");
    });

    it("keeps both on collision when the prompt says so", async () => {
      fs.writeFileSync(path.join(dstDir, "file.txt"), "old");
      mainModule.promptConflict.and.resolveTo({ choice: "keep-both", all: false });
      await mainModule.treePaste();
      expect(fs.readFileSync(path.join(dstDir, "file.txt"), "utf8")).toBe("old");
      expect(fs.readFileSync(path.join(dstDir, "file - Copy.txt"), "utf8")).toBe("content");
    });

    it("skips on collision when the prompt is dismissed", async () => {
      fs.writeFileSync(path.join(dstDir, "file.txt"), "old");
      await mainModule.treePaste();
      expect(fs.readFileSync(path.join(dstDir, "file.txt"), "utf8")).toBe("old");
      expect(fs.existsSync(path.join(dstDir, "file - Copy.txt"))).toBe(false);
    });

    it("applies a sticky answer to every remaining conflict", async () => {
      fs.writeFileSync(path.join(srcDir, "other.txt"), "content2");
      fs.writeFileSync(path.join(dstDir, "file.txt"), "old");
      fs.writeFileSync(path.join(dstDir, "other.txt"), "old2");
      fakePaths = [path.join(srcDir, "file.txt"), path.join(srcDir, "other.txt")];
      mainModule.promptConflict.and.resolveTo({ choice: "replace", all: true });
      await mainModule.treePaste();
      expect(mainModule.promptConflict).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(path.join(dstDir, "file.txt"), "utf8")).toBe("content");
      expect(fs.readFileSync(path.join(dstDir, "other.txt"), "utf8")).toBe("content2");
    });

    it("moves files and clears the clipboard for a cut", async () => {
      fakeEffect = 2; // DROP_EFFECT_MOVE
      await mainModule.treePaste();
      expect(fs.readFileSync(path.join(dstDir, "file.txt"), "utf8")).toBe("content");
      expect(fs.existsSync(path.join(srcDir, "file.txt"))).toBe(false);
      expect(cleared).toBe(true);
    });

    it("keeps the clipboard when every entry of a cut is skipped", async () => {
      fakeEffect = 2; // DROP_EFFECT_MOVE
      fs.writeFileSync(path.join(dstDir, "file.txt"), "old");
      await mainModule.treePaste();
      expect(fs.existsSync(path.join(srcDir, "file.txt"))).toBe(true);
      expect(cleared).toBe(false);
    });

    it("duplicates without a prompt when pasting into the source's own folder", async () => {
      const folder = path.join(dir, "folder");
      fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, "inner.txt"), "x");
      fakePaths = [folder];
      mainModule.treeView = { selectedPaths: () => [folder] };
      await mainModule.treePaste();
      expect(mainModule.promptConflict).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(dir, "folder - Copy", "inner.txt"))).toBe(true);
    });

    it("copies directories recursively", async () => {
      const tree = path.join(srcDir, "tree");
      fs.mkdirSync(path.join(tree, "nested"), { recursive: true });
      fs.writeFileSync(path.join(tree, "nested", "deep.txt"), "deep");
      fakePaths = [tree];
      await mainModule.treePaste();
      expect(fs.readFileSync(path.join(dstDir, "tree", "nested", "deep.txt"), "utf8")).toBe("deep");
    });
  });

  describe("provided service", () => {
    it("exposes the constants, the primitives and the high-level operations", () => {
      const service = mainModule.provideNativeClip();
      expect(service.DROP_EFFECT_NONE).toBe(0);
      expect(service.DROP_EFFECT_COPY).toBe(1);
      expect(service.DROP_EFFECT_MOVE).toBe(2);
      expect(service.DROP_EFFECT_LINK).toBe(4);
      for (const member of [
        "readFilePaths",
        "readDropEffect",
        "writeFilePaths",
        "clear",
        "cutPaths",
        "copyPaths",
        "pasteInto",
      ]) {
        expect(typeof service[member]).toBe("function");
      }
    });
  });

  describe("cutPaths and copyPaths", () => {
    beforeEach(() => {
      spyOn(mainModule, "setFilepaths").and.resolveTo();
      spyOn(lumine.notifications, "addSuccess").and.callThrough();
    });

    it("writes a move and confirms", async () => {
      await mainModule.cutPaths(["/a/b.txt"]);
      expect(mainModule.setFilepaths).toHaveBeenCalledWith(["/a/b.txt"], 2);
      expect(lumine.notifications.addSuccess).toHaveBeenCalled();
    });

    it("writes a copy and confirms", async () => {
      await mainModule.copyPaths(["/a/b.txt", "/a/c.txt"]);
      expect(mainModule.setFilepaths).toHaveBeenCalledWith(["/a/b.txt", "/a/c.txt"], 1);
      expect(lumine.notifications.addSuccess).toHaveBeenCalled();
    });

    it("does nothing for an empty selection", async () => {
      await mainModule.cutPaths([]);
      await mainModule.copyPaths();
      expect(mainModule.setFilepaths).not.toHaveBeenCalled();
    });
  });

  // Runs against the real clipboard through @lumine-code/clipboard-files on
  // the natively backed platforms. On Linux the backend is Electron's
  // clipboard, whose selection reads do not answer in a hidden CI window —
  // the library's own CI covers the Linux formats through a real xclip
  // round-trip instead.
  const roundTripSuite = process.platform === "linux" ? () => {} : describe;

  roundTripSuite("clipboard round-trip", () => {
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-clip-native-"));
    });

    afterEach(async () => {
      await mainModule.clearClipboard();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });

    it("round-trips file paths and the drop effect", async () => {
      const file = path.join(dir, "roundtrip.txt");
      fs.writeFileSync(file, "x");

      await mainModule.setFilepaths([file], 2);
      expect(await mainModule.getFilepaths()).toEqual([file]);
      expect(await mainModule.getDropEffect()).toBe(2);

      await mainModule.clearClipboard();
      expect(await mainModule.getFilepaths()).toEqual([]);
    });
  });
});
