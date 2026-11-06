import { CanvasTexture, SRGBColorSpace, TextureLoader } from 'three';
import type { TileMaterial } from '../types';

// A texture describes one tile. Its physical size and cropping come from layout geometry.
export function createTileTexture(material: TileMaterial, onLoad: () => void) {
  if (material.image) {
    const texture = new TextureLoader().load(material.image, onLoad);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(128, 128);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const noise = ((i * 16807 + 12345) % 251) / 251;
    const value = material.texture === 'plain' ? 255 : material.texture === 'stone' ? 218 + noise * 37 : 235 + noise * 20;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  return texture;
}
