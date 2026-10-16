describe("Native Clip command availability", () => {
  let main, lease;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("native-clip")).mainModule;
  });
  afterEach(async () => {
    lease?.dispose();
    await lumine.packages.deactivatePackage("native-clip");
    lease = null;
  });
  it("uses a passive tree snapshot without reading clipboard or initializing the tree", () => {
    let count = 0;
    const service = {
      getSelectionSnapshot: () => ({ count }),
      selectedPaths: jasmine.createSpy("cold tree selection"),
    };
    lease = main.consumeTreeViewSelection(service);
    spyOn(main, "getFilepaths");
    const target = lumine.workspace.getElement();
    for (const command of ["native-clip:cut", "native-clip:copy", "native-clip:paste"])
      expect(lumine.commands.canDispatch(target, command)).toBe(false);
    count = 1;
    expect(lumine.commands.canDispatch(target, "native-clip:paste")).toBe(true);
    expect(service.selectedPaths).not.toHaveBeenCalled();
    expect(main.getFilepaths).not.toHaveBeenCalled();
  });
});
