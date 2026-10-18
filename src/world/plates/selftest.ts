// ?platetest=1: decode known pixels through the plate loader's exact path (fetch -> createImageBitmap with
// premultiplyAlpha / colorSpaceConversion 'none' -> copyExternalImageToTexture premultipliedAlpha:false) and read
// them back from the GPU. Shows whether this browser keeps colour under partial alpha (RGBM / packed data rely on it
// for the old format) and leaves RGB untouched (no colour-space conversion).
const BASE = `${import.meta.env.BASE_URL}world/plates/_selftest/`;
const CASES: [string, number[][]][] = [
  ['rgba.webp', [[200, 100, 50, 255], [200, 100, 50, 128], [200, 100, 50, 32], [10, 20, 30, 0]]],
  ['rgb.webp', [[200, 100, 50, 255], [17, 34, 51, 255], [1, 2, 3, 255], [255, 128, 0, 255]]],
];

export async function plateDecodeSelfTest(): Promise<string[]> {
  const out: string[] = [];
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  const adapter = await gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) return ['no WebGPU device: test skipped'];
  for (const [file, want] of CASES) {
    const blob = await (await fetch(BASE + file)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' } as ImageBitmapOptions);
    const tex = device.createTexture({ size: [bmp.width, bmp.height], format: 'rgba8unorm', usage: 2 | 1 | 16 | 4 /* COPY_DST | COPY_SRC | RENDER_ATTACHMENT | TEXTURE_BINDING */ });
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex, premultipliedAlpha: false }, [bmp.width, bmp.height]);
    const buf = device.createBuffer({ size: 256, usage: 8 | 1 /* COPY_DST | MAP_READ */ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: 256 }, [bmp.width, 1]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(1 /* GPUMapMode.READ */);
    const got = Array.from(new Uint8Array(buf.getMappedRange().slice(0, bmp.width * 4)));
    buf.unmap();
    const rows = want.map((w, i) => ({ w, g: got.slice(i * 4, i * 4 + 4) }));
    // compare colour only where alpha > 0 (a fully transparent pixel's colour may legitimately be dropped)
    const bad = rows.filter((r) => r.w[3] > 0 && r.w.some((v, k) => Math.abs(v - r.g[k]) > 1));
    out.push(`${file}: ${bad.length ? 'WRONG' : 'ok'} ${rows.map((r) => `[${r.g.join(',')}]`).join(' ')}`);
  }
  device.destroy();
  return out;
}
