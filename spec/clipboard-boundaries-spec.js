const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

describe("Native Clip clipboard and provider boundaries", () => {
  let main, clipboard, directory, leases;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    clipboard = require("@lumine-code/clipboard-files");
    spyOn(clipboard, "readFilePaths").and.resolveTo([]);
    spyOn(clipboard, "readDropEffect").and.resolveTo(2);
    spyOn(clipboard, "writeFilePaths").and.resolveTo();
    spyOn(clipboard, "clear").and.resolveTo();
    main = (await lumine.packages.activatePackage("native-clip")).mainModule;
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "native-clip-owned-boundary-"));
    leases = [];
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    await lumine.packages.deactivatePackage("native-clip");
    await lumine.fileWatchClient.settlePendingTeardown();
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("native-clip-owned-boundary-")
    )
      throw Error("Unsafe native-clip fixture cleanup");
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  for (const outcome of ["skip", "failure", "success"]) {
    it(`keeps only pending cut files after partial ${outcome}`, async () => {
      const source = path.join(directory, "source");
      const destination = path.join(directory, "destination");
      await fs.mkdir(source);
      await fs.mkdir(destination);
      const first = path.join(source, "first.txt");
      const second = path.join(source, "second.txt");
      await fs.writeFile(first, "First bytes");
      await fs.writeFile(second, "Second bytes");
      clipboard.readFilePaths.and.resolveTo([first, second]);
      if (outcome === "skip") {
        await fs.writeFile(path.join(destination, "second.txt"), "Retained bytes");
        spyOn(main, "promptConflict").and.resolveTo({ choice: "skip", all: false });
      }
      if (outcome === "failure") {
        const move = main.moveEntry.bind(main);
        spyOn(main, "moveEntry").and.callFake((src, dst, overwrite) =>
          src === second ? Promise.reject(new Error("Owned failure")) : move(src, dst, overwrite),
        );
      }
      await main.provideNativeClip().pasteInto([destination]);
      expect(await fs.readFile(path.join(destination, "first.txt"), "utf8")).toBe("First bytes");
      expect(await fs.stat(first).catch(() => null)).toBeNull();
      if (outcome === "success") {
        expect(clipboard.clear).toHaveBeenCalled();
        expect(clipboard.writeFilePaths).not.toHaveBeenCalled();
      } else {
        expect(await fs.readFile(second, "utf8")).toBe("Second bytes");
        expect(clipboard.clear).not.toHaveBeenCalled();
        expect(clipboard.writeFilePaths).toHaveBeenCalledOnceWith([second], 2);
      }
    });
  }
  for (const contract of ["tree-view.selection", "busy-signal"]) {
    function offer(label) {
      const provider = {
        add: jasmine.createSpy(label + " add"),
        remove: jasmine.createSpy(label + " remove"),
        dispose: jasmine.createSpy(label + " dispose"),
      };
      const api =
        contract === "tree-view.selection"
          ? {
              selectedPaths: jasmine
                .createSpy(label)
                .and.returnValue([path.join(directory, label)]),
            }
          : { create: jasmine.createSpy(label).and.returnValue(provider) };
      const lease = lumine.packages.serviceHub.provide(contract, "1.0.0", api);
      leases.push(lease);
      return { api, provider, lease };
    }
    async function act() {
      if (contract === "tree-view.selection") await main.treeCopy();
      else await main.withBusy("owned operation", async () => {});
    }
    for (const withdrawing of ["older", "newer"]) {
      it(`uses the remaining ${contract} edge after ${withdrawing} withdraws`, async () => {
        const older = offer("older");
        const newer = offer("newer");
        if (contract === "busy-signal") await act();
        const removed = withdrawing === "older" ? older : newer;
        const remaining = withdrawing === "older" ? newer : older;
        removed.lease.dispose();
        await act();
        if (contract === "tree-view.selection") {
          expect(remaining.api.selectedPaths).toHaveBeenCalled();
          expect(removed.api.selectedPaths).not.toHaveBeenCalled();
        } else {
          expect(remaining.api.create).toHaveBeenCalled();
          expect(remaining.provider.add).toHaveBeenCalledWith("owned operation");
          if (withdrawing === "older") expect(newer.provider.dispose).not.toHaveBeenCalled();
          else expect(newer.provider.dispose).toHaveBeenCalledTimes(1);
        }
      });
    }
    it(`uses the latest ${contract} edge for an ordinary action`, async () => {
      const older = offer("older");
      const newer = offer("newer");
      await act();
      const method = contract === "tree-view.selection" ? "selectedPaths" : "create";
      expect(newer.api[method]).toHaveBeenCalledTimes(1);
      expect(older.api[method]).not.toHaveBeenCalled();
    });
  }
});
