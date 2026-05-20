import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";

const FONT_URL = new URL(
  "../../node_modules/three/examples/fonts/helvetiker_bold.typeface.json",
  import.meta.url,
).pathname;

let cached: Font | null = null;

export async function loadFont(): Promise<Font> {
  if (cached) return cached;
  const fontJson = JSON.parse(await Bun.file(FONT_URL).text());
  cached = new FontLoader().parse(fontJson);
  return cached;
}
