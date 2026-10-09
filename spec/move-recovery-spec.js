const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
describe("Native Clip overwrite failure recovery", () => {
  let main, directory, editor;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    // The dependency resolves its backend only on use. Stub every exported
    // system-clipboard primitive before package activation, including clear.
    const clipboard = require("@lumine-code/clipboard-files");
    spyOn(clipboard, "readFilePaths").and.resolveTo([]);
    spyOn(clipboard, "readDropEffect").and.resolveTo(0);
    spyOn(clipboard, "writeFilePaths").and.resolveTo();
    spyOn(clipboard, "clear").and.resolveTo();
    main = (await lumine.packages.activatePackage("native-clip")).mainModule;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "native-clip-owned-recovery-"));
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("native-clip");
    await lumine.fileWatchClient.settlePendingTeardown();
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("native-clip-owned-recovery-")
    )
      throw Error("Unsafe native-clip fixture cleanup");
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  for (const kind of ["file", "directory"]) {
    it(`preserves the existing ${kind} and live source editor when native rename fails`, async () => {
      const source = path.join(directory, "source"),
        destination = path.join(directory, "destination");
      if (kind === "directory") {
        await fs.mkdir(source);
        await fs.mkdir(destination);
      }
      const sourceFile = kind === "directory" ? path.join(source, "owned.txt") : source;
      const destinationFile =
        kind === "directory" ? path.join(destination, "retained.txt") : destination;
      await fs.writeFile(sourceFile, "Source bytes");
      await fs.writeFile(destinationFile, "Retained destination bytes");
      editor = await lumine.workspace.open(sourceFile);
      editor.insertText("Unsaved ");
      const text = editor.getText();
      const rename = fs.rename.bind(fs);
      const failure = Object.assign(new Error("Owned source rename denied"), { code: "EACCES" });
      spyOn(fs, "rename").and.callFake((from, to) =>
        from === source ? Promise.reject(failure) : rename(from, to),
      );
      await expectAsync(main.moveEntry(source, destination, true)).toBeRejectedWith(failure);
      const retained = await fs.readFile(destinationFile, "utf8").catch((error) => error.code);
      expect(retained).toBe("Retained destination bytes");
      expect(await fs.readFile(sourceFile, "utf8")).toBe("Source bytes");
      expect(editor.getPath()).toBe(sourceFile);
      expect(editor.getText()).toBe(text);
      expect((await fs.readdir(directory)).sort()).toEqual(["destination", "source"]);
    });
  }

  it("keeps ordinary atomic file overwrite and current Core source identity", async () => {
    const source = path.join(directory, "source"),
      destination = path.join(directory, "destination");
    await fs.writeFile(source, "Source bytes");
    await fs.writeFile(destination, "Old bytes");
    editor = await lumine.workspace.open(source);
    editor.insertText("Unsaved ");
    const text = editor.getText();
    await main.moveEntry(source, destination, true);
    expect(await fs.readFile(destination, "utf8")).toBe("Source bytes");
    expect(editor.getPath()).toBe(destination);
    expect(editor.getText()).toBe(text);
    expect((await fs.readdir(directory)).sort()).toEqual(["destination"]);
  });

  it("replaces a nonempty directory without moving its destination buffer into recovery storage", async () => {
    const source = path.join(directory, "source"),
      destination = path.join(directory, "destination");
    await fs.mkdir(source);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(source, "owned.txt"), "Source bytes");
    const file = path.join(destination, "owned.txt");
    await fs.writeFile(file, "Old bytes");
    editor = await lumine.workspace.open(file);
    editor.insertText("Unsaved ");
    const text = editor.getText();
    const changes = [];
    const lease = editor.onDidChangePath((value) => changes.push(value));
    try {
      await main.moveEntry(source, destination, true);
      expect(await fs.readFile(file, "utf8")).toBe("Source bytes");
      expect(editor.getPath()).toBe(file);
      expect(editor.getText()).toBe(text);
      expect(changes).toEqual([]);
      expect((await fs.readdir(directory)).sort()).toEqual(["destination"]);
    } finally {
      lease.dispose();
    }
  });

  it("does not overwrite destination bytes when a staged cross-device copy fails", async () => {
    const source = path.join(directory, "source"),
      destination = path.join(directory, "destination");
    await fs.writeFile(source, "Source bytes");
    await fs.writeFile(destination, "Retained bytes");
    const rename = fs.rename.bind(fs),
      copy = fs.cp.bind(fs);
    const failure = Object.assign(new Error("Owned staged copy failed"), { code: "EIO" });
    spyOn(fs, "rename").and.callFake((from, to) =>
      from === source
        ? Promise.reject(Object.assign(new Error("Owned cross-device move"), { code: "EXDEV" }))
        : rename(from, to),
    );
    spyOn(fs, "cp").and.callFake(async (from, to, options) => {
      if (from !== source) return copy(from, to, options);
      const relative = path.relative(directory, to);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw Error("Escaping controlled copy");
      await fs.writeFile(to, "Partial copy");
      throw failure;
    });
    await expectAsync(main.moveEntry(source, destination, true)).toBeRejectedWith(failure);
    expect(await fs.readFile(destination, "utf8")).toBe("Retained bytes");
    expect(await fs.readFile(source, "utf8")).toBe("Source bytes");
    expect((await fs.readdir(directory)).sort()).toEqual(["destination", "source"]);
  });

  it("preserves the complete published directory and partial Core receipt if source removal fails", async () => {
    const source = path.join(directory, "source"),
      destination = path.join(directory, "destination");
    await fs.mkdir(source);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(source, "first.txt"), "First bytes");
    await fs.writeFile(path.join(source, "second.txt"), "Second bytes");
    await fs.writeFile(path.join(destination, "retained.txt"), "Old bytes");
    editor = await lumine.workspace.open(path.join(source, "first.txt"));
    editor.insertText("Unsaved ");
    const text = editor.getText();
    const rename = fs.rename.bind(fs),
      remove = fs.rm.bind(fs),
      failure = Object.assign(new Error("Owned partial source deletion denied"), {
        code: "EACCES",
      });
    spyOn(fs, "rename").and.callFake((from, to) =>
      from === source
        ? Promise.reject(Object.assign(new Error("Owned cross-device move"), { code: "EXDEV" }))
        : rename(from, to),
    );
    spyOn(fs, "rm").and.callFake(async (target, options) => {
      if (target !== source) return remove(target, options);
      await remove(path.join(source, "first.txt"));
      throw failure;
    });
    await expectAsync(main.moveEntry(source, destination, true)).toBeRejectedWith(failure);
    expect(await fs.readFile(path.join(destination, "first.txt"), "utf8")).toBe("First bytes");
    expect(await fs.readFile(path.join(destination, "second.txt"), "utf8")).toBe("Second bytes");
    expect(await fs.readFile(path.join(source, "second.txt"), "utf8")).toBe("Second bytes");
    expect(editor.getPath()).toBe(path.join(destination, "first.txt"));
    expect(editor.getText()).toBe(text);
    expect((await fs.readdir(directory)).sort()).toEqual(["destination", "source"]);
  });

  it("retains original recovery data and releases the Core transaction when restoration is denied", async () => {
    const source = path.join(directory, "source"),
      destination = path.join(directory, "destination");
    await fs.mkdir(source);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(source, "owned.txt"), "Source bytes");
    await fs.writeFile(path.join(destination, "retained.txt"), "Retained bytes");
    editor = await lumine.workspace.open(path.join(source, "owned.txt"));
    const rename = fs.rename.bind(fs),
      failure = Object.assign(new Error("Owned source rename denied"), { code: "EACCES" }),
      restore = Object.assign(new Error("Owned restore denied"), { code: "EPERM" });
    spyOn(fs, "rename").and.callFake((from, to) => {
      if (from === source) return Promise.reject(failure);
      if (
        path.basename(from) === "destination" &&
        path.basename(path.dirname(from)).startsWith(".native-clip-recovery-")
      )
        return Promise.reject(restore);
      return rename(from, to);
    });
    let error;
    try {
      await main.moveEntry(source, destination, true);
    } catch (value) {
      error = value;
    }
    expect(error instanceof AggregateError).toBe(true);
    expect(error?.errors).toEqual([failure, restore]);
    const retained = (await fs.readdir(directory)).find((name) =>
      name.startsWith(".native-clip-recovery-"),
    );
    expect(retained).toBeDefined();
    if (retained) {
      expect(
        await fs.readFile(path.join(directory, retained, "destination/retained.txt"), "utf8"),
      ).toBe("Retained bytes");
      expect(error.message).toContain(path.join(directory, retained, "destination"));
    }
    expect(editor.getPath()).toBe(path.join(source, "owned.txt"));
    editor.insertText("Still editable ");
    expect(editor.getText()).toBe("Still editable Source bytes");
  });
});
