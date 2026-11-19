// The printer-driver addon must load on a till that has no Visual C++ installed.
//
// winusb-driver-generator's binding.gyp builds Generator.node with /MD, which
// makes it need VCRUNTIME140.dll at load time. A fresh Windows (an ex-Clopos
// till at Xan İzqara 2, 2026-11-19) does not have it: the addon failed with
// "The specified module could not be found", the till never offered the
// driver, and the USB printer could not be paired. /MT puts the runtime inside
// the .node file instead, the same as libwdi and its installers already get.

/** binding.gyp with the Generator target switched from /MD to /MT. Throws if /MD is gone. */
export function staticRuntime(gyp) {
  const shared = /"\/MD"/g;
  if (!shared.test(gyp)) {
    throw new Error('binding.gyp no longer sets "/MD" — check how it picks the C runtime before building');
  }
  return gyp.replace(shared, '"/MT"');
}

// The DLLs of the shared Visual C++ runtime. A .node file that names one of
// them in its imports will not load on a PC without the redistributable.
// (ucrtbase.dll is left out: Windows 10 and later ship it themselves.)
const SHARED_RUNTIME = [/vcruntime\d+(_\d+)?\.dll/i, /msvcp\d+(_\w+)?\.dll/i];

/** Names of shared Visual C++ runtime DLLs the built binary imports; empty when it needs none. */
export function sharedRuntimeImports(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const found = new Set();
  for (const re of SHARED_RUNTIME) {
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) found.add(m[0].toLowerCase());
  }
  return [...found];
}
