import { TextRenderable, RGBA } from "@opentui/core";
import { MAX_HP } from "../shared";
import { renderer } from "./scene";

export const hud = new TextRenderable(renderer, {
  id: "hud",
  content: "",
  zIndex: 10,
  position: "absolute",
  left: 1,
  top: 0,
  fg: RGBA.fromValues(1, 1, 1, 1),
});
renderer.root.add(hud);

export const banner = new TextRenderable(renderer, {
  id: "banner",
  content: "",
  zIndex: 11,
  position: "absolute",
  left: 1,
  top: 2,
  fg: RGBA.fromValues(1, 1, 1, 1),
});
renderer.root.add(banner);

export function hpBar(hp: number, width = 20) {
  const filled = Math.round((hp / MAX_HP) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}
