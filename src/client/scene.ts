import { createCliRenderer, FrameBufferRenderable, RGBA } from "@opentui/core";
import { ThreeCliRenderer, TextureUtils } from "@opentui/three";
import {
  Scene,
  PerspectiveCamera,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  AmbientLight,
  DirectionalLight,
  RepeatWrapping,
} from "three";
import {
  CEIL_Y,
  FLOOR_Y,
  LEFT_X,
  RIGHT_X,
  ROOM_H,
  ROOM_W,
  WALL_T,
} from "../shared";

export const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 60,
  useKittyKeyboard: { events: true, disambiguate: true, alternateKeys: true },
});
renderer.start();

export let W = renderer.terminalWidth;
export let H = renderer.terminalHeight;

export const fb = new FrameBufferRenderable(renderer, {
  id: "fb",
  width: W,
  height: H,
  zIndex: 1,
});
renderer.root.add(fb);

export const engine = new ThreeCliRenderer(renderer, {
  width: W,
  height: H,
  // Opaque clear: repaints every cell each frame. Transparent (alpha 0) left
  // stale pixels where moving/scaling geometry vacated cells (menu ghosting).
  backgroundColor: RGBA.fromValues(0, 0, 0, 1),
});
await engine.init();

export const scene = new Scene();
export const camera = new PerspectiveCamera(30, engine.aspectRatio, 0.1, 100);
camera.position.set(0, 1, 30);
camera.lookAt(0, 1, 0);
engine.setActiveCamera(camera);
scene.add(camera);

scene.add(new AmbientLight(0xffffff, 1.0));
const sun = new DirectionalLight(0xffffff, 2.5);
sun.position.set(5, 8, 10);
scene.add(sun);

const WALL_TEX = new URL("../../public/wall/", import.meta.url).pathname;
const [diffTex, normalTex, roughTex, metalTex] = await Promise.all([
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_diff_1k.jpg`),
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_nor_gl_1k.jpg`),
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_rough_1k.jpg`),
  TextureUtils.fromFile(`${WALL_TEX}metal_grate_rusty_metal_1k.jpg`),
]);
for (const tex of [diffTex, normalTex, roughTex, metalTex]) {
  if (!tex) continue;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  tex.needsUpdate = true;
}
const wallMat = new MeshStandardMaterial({
  map: diffTex ?? undefined,
  normalMap: normalTex ?? undefined,
  roughnessMap: roughTex ?? undefined,
  metalnessMap: metalTex ?? undefined,
  metalness: 0.8,
  roughness: 0.5,
});

const floor = new Mesh(new BoxGeometry(ROOM_W, WALL_T, 2), wallMat);
floor.position.y = FLOOR_Y;
const ceil = new Mesh(new BoxGeometry(ROOM_W, WALL_T, 2), wallMat);
ceil.position.y = CEIL_Y;
const leftWall = new Mesh(new BoxGeometry(WALL_T, ROOM_H, 2), wallMat);
leftWall.position.x = LEFT_X;
const rightWall = new Mesh(new BoxGeometry(WALL_T, ROOM_H, 2), wallMat);
rightWall.position.x = RIGHT_X;
const backWall = new Mesh(new BoxGeometry(ROOM_W, ROOM_H, WALL_T), wallMat);
backWall.position.z = -1 - WALL_T / 2;
scene.add(floor, ceil, leftWall, rightWall, backWall);

renderer.on("resize", (w: number, h: number) => {
  W = w;
  H = h;
  fb.frameBuffer.resize(w, h);
  engine.setSize(w, h);
  camera.aspect = engine.aspectRatio;
  camera.updateProjectionMatrix();
});
