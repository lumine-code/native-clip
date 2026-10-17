describe("native-clip initialization cleanup", () => {
  let pack;

  beforeEach(async () => {
    if (lumine.packages.getLoadedPackage("native-clip"))
      await lumine.packages.unloadPackage("native-clip", { serialize: false });
    pack = lumine.packages.loadPackage("native-clip");
    pack.initializeForExternalUse("initialization cleanup spec");
    expect(pack.mainActivationStarted).toBe(false);
  });

  afterEach(async () => {
    if (lumine.packages.getLoadedPackage("native-clip"))
      await lumine.packages.unloadPackage("native-clip", { serialize: false });
  });

  it("deactivates before activation and can activate afterwards", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    await expectAsync(pack.deactivate()).toBeResolved();
    expect(scope.disposed).toBe(true);
    const active = await lumine.packages.activatePackage("native-clip");
    expect(active.mainActivated).toBe(true);
    expect(active.lifecycleContext.subscriptions.disposed).toBe(false);
  });

  it("unloads an initialized main before activation", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    await expectAsync(
      lumine.packages.unloadPackage("native-clip", { serialize: false }),
    ).toBeResolved();
    expect(scope.disposed).toBe(true);
    expect(lumine.packages.getLoadedPackage("native-clip")).toBeUndefined();
  });
});
