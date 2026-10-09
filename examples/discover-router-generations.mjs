// Discovery only: verify receipts, runtime identity, getters and finality
// using the selected deployment before accepting a Programmable stamp.
const response = await fetch("https://developers.programmable.family/api/v2/manifests/1");
if (!response.ok) throw new Error(`Manifest unavailable: HTTP ${response.status}`);
const manifest = await response.json();
if (manifest.chainId !== 1) throw new Error("Expected Ethereum manifest");
const primary = manifest.launchStampRouter;
const inventory = manifest.extensions?.["programmable/launch-stamp-router-generations-v1"];
const additional = inventory?.routers ?? [];
const routers = [primary, ...additional.map(router => {
  if (router.verificationInterfacePointer !== "/launchStampRouter" ||
      router.abiUrl !== primary.abiUrl || router.abiSha256 !== primary.abiSha256) {
    throw new Error("Unsupported Router verification interface");
  }
  return { ...router, events: primary.events, getters: primary.getters,
    enumValues: primary.enumValues };
})];
console.log(JSON.stringify(routers, null, 2));
