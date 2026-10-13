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
    lease = main.consumeTreeViewSelection({ selectedPaths: () => [__filename] });
    spyOn(main, "copyPaths").and.resolveTo();
    await lumine.commands.dispatch(button, "native-clip:copy");
    expect(main.copyPaths).toHaveBeenCalledOnceWith([__filename]);
  });
  it("explains an empty tree selection and leaves the clipboard untouched", async () => {
    lease = main.consumeTreeViewSelection({ selectedPaths: () => [] });
    spyOn(main, "copyPaths").and.resolveTo();
    spyOn(lumine.notifications, "addWarning");
    await lumine.commands.dispatch(button, "native-clip:copy");
    expect(lumine.notifications.addWarning).toHaveBeenCalledWith(
      "Select a tree-view file or directory first.",
    );
    expect(main.copyPaths).not.toHaveBeenCalled();
  });
  it("explains why a file clipboard command needs Tree View", async () => {
    spyOn(lumine.notifications, "addWarning");
    await lumine.commands.dispatch(button, "native-clip:paste");
    expect(lumine.notifications.addWarning).toHaveBeenCalledWith(
      "Tree View is unavailable for file clipboard commands.",
    );
  });
});
