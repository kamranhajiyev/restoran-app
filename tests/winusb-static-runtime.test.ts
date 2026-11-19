// The exe's printer-driver addon must load on a PC without Visual C++
// (Xan İzqara 2, 2026-11-19: "load failed: The specified module could not be
// found", no driver prompt, USB printer never paired).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sharedRuntimeImports, staticRuntime } from '@/scripts/winusb/static-runtime.mjs';

// binding.gyp of winusb-driver-generator@2.1.10, the version build-winusb.mjs pins.
const gyp = readFileSync(new URL('./fixtures/winusb-binding.gyp', import.meta.url), 'utf8');

describe('printer-driver addon C runtime', () => {
  it('the pinned package builds with the shared runtime, which is what broke', () => {
    expect(gyp).toContain('"/MD"');
  });

  it('the build switches it to the static runtime', () => {
    const out = staticRuntime(gyp);
    expect(out).not.toContain('"/MD"');
    expect(out).toContain('"/MT"');
    expect(out.replace('"/MT"', '"/MD"')).toBe(gyp);
  });

  it('refuses a binding.gyp it does not recognise rather than build the wrong thing', () => {
    expect(() => staticRuntime(gyp.replace('"/MD"', '"/MX"'))).toThrow(/MD/);
  });

  it('build-winusb applies it before compiling', () => {
    const script = readFileSync(new URL('../scripts/build-winusb.mjs', import.meta.url), 'utf8');
    const patch = script.indexOf('staticRuntime(');
    expect(patch).toBeGreaterThan(-1);
    expect(patch).toBeLessThan(script.indexOf("'node-gyp', 'rebuild'"));
    expect(script).toContain('sharedRuntimeImports(');
  });

  it('spots a binary that imports the Visual C++ DLLs', () => {
    const bin = Buffer.from('MZ\0\0KERNEL32.dll\0VCRUNTIME140.dll\0MSVCP140.dll\0SETUPAPI.dll\0', 'latin1');
    expect(sharedRuntimeImports(bin).sort()).toEqual(['msvcp140.dll', 'vcruntime140.dll']);
  });

  it('passes a binary that needs only Windows itself', () => {
    const bin = Buffer.from('MZ\0\0KERNEL32.dll\0SETUPAPI.dll\0ucrtbase.dll\0', 'latin1');
    expect(sharedRuntimeImports(bin)).toEqual([]);
  });
});
