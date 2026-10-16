describe("Native Clip application menu", () => {
  let main, editor, button, lease;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("native-clip")).mainModule;
    editor = await lumine.workspace.open();
    button = document.createElement("button");
    lumine.workspace.getElement().appendChild(button);
    button.focus();
  });
  afterEach(async () => {
    lease?.dispose();
    lease = null;
    button.remove();
    editor.destroy();
    await lumine.packages.deactivatePackage("native-clip");
  });
  it("copies selected tree entries from another focused surface without duplicate dispatch", async () => {
    lease = main.consumeTreeViewSelection({
      selectedPaths: () => [__filename],
      getSelectionSnapshot: () => ({ count: 1, paths: [__filename] }),
    });
    spyOn(main, "copyPaths").and.resolveTo();
    await lumine.commands.dispatch(button, "native-clip:copy");
    expect(main.copyPaths).toHaveBeenCalledOnceWith([__filename]);
  });
  it("declines an empty tree selection silently and leaves the clipboard untouched", async () => {
    lease = main.consumeTreeViewSelection({
      selectedPaths: () => [],
      getSelectionSnapshot: () => ({ count: 0, paths: [] }),
    });
    spyOn(main, "copyPaths").and.resolveTo();
    spyOn(lumine.notifications, "addWarning");
    expect(lumine.commands.dispatch(button, "native-clip:copy")).toBeNull();
    expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
    expect(main.copyPaths).not.toHaveBeenCalled();
  });
  it("declines a file clipboard command without Tree View silently", async () => {
    spyOn(lumine.notifications, "addWarning");
    expect(lumine.commands.dispatch(button, "native-clip:paste")).toBeNull();
    expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
  });
});
