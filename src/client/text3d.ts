import {
  Mesh,
  Group,
  type Material,
  type Box3,
} from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";

export type Text3DOpts = {
  font: Font;
  size: number;
  depth: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelSegments?: number;
};

/**
 * Build centered 3D text with explicit letter spacing.
 * One Mesh per glyph allows readable gaps that TextGeometry alone can't provide.
 */
export function makeSpacedText(
  text: string,
  opts: Text3DOpts,
  mat: Material,
  letterSpacing = 0.15,
  spaceWidthRatio = 0.5,
): { group: Group; width: number; height: number; meshes: Mesh[] } {
  const group = new Group();
  const meshes: Mesh[] = [];
  let cursor = 0;
  let maxY = 0;
  let minY = 0;

  for (const ch of text) {
    if (ch === " ") {
      cursor += opts.size * spaceWidthRatio + letterSpacing;
      continue;
    }
    const geo = new TextGeometry(ch, opts);
    geo.computeBoundingBox();
    const bb = geo.boundingBox as Box3;
    const w = bb.max.x - bb.min.x;
    if (bb.max.y > maxY) maxY = bb.max.y;
    if (bb.min.y < minY) minY = bb.min.y;
    const mesh = new Mesh(geo, mat);
    mesh.position.x = cursor - bb.min.x;
    group.add(mesh);
    meshes.push(mesh);
    cursor += w + letterSpacing;
  }

  const totalWidth = Math.max(0, cursor - letterSpacing);
  for (const m of meshes) m.position.x -= totalWidth / 2;
  return { group, width: totalWidth, height: maxY - minY, meshes };
}
