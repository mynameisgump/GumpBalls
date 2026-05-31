import {
  Mesh,
  SphereGeometry,
  Vector3,
  ArrowHelper,
} from "three";
import { TextureUtils } from "@opentui/three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  positionLocal,
  normalLocal,
  uniform,
  time,
  mx_noise_float,
} from "three/tsl";
import { BALL_MIN_Y, BALL_R } from "../shared";
import { scene } from "./scene";

export const P_COLORS = [0xff5533, 0x33ff66];
export const P_CHARGE = [0x33aaff, 0xffcc33];

const BALL_TEX = new URL("../../public/ball/", import.meta.url).pathname;
const ballDiff = await TextureUtils.fromFile(
  `${BALL_TEX}Skin_05_basecolor.jpg`,
);

const noiseFreq = uniform(6.0);
const noiseSpeed = uniform(1.5);
const noiseIntensity = uniform(0.06);

function makeBallMat(color: number) {
  const mat = new MeshStandardNodeMaterial({
    map: ballDiff ?? undefined,
    metalness: 0.2,
    roughness: 0.5,
  });
  mat.color.setHex(color);
  mat.emissive.setHex(0xffffff);
  mat.emissiveIntensity = 0;
  const n = mx_noise_float(
    positionLocal.mul(noiseFreq).add(time.mul(noiseSpeed)),
  );
  mat.positionNode = positionLocal.add(normalLocal.mul(n).mul(noiseIntensity));
  return mat;
}

export const ballMats = P_COLORS.map((c) => makeBallMat(c));
export const ballMeshes = ballMats.map((m) => {
  const mesh = new Mesh(new SphereGeometry(BALL_R, 32, 24), m);
  mesh.position.set(0, BALL_MIN_Y, 0);
  scene.add(mesh);
  return mesh;
});

export const arrows = [0, 1].map((i) => {
  const a = new ArrowHelper(
    new Vector3(1, 0, 0),
    new Vector3(),
    0.001,
    P_CHARGE[i],
    0.4,
    0.25,
  );
  a.visible = false;
  scene.add(a);
  return a;
});

const tmpDir = new Vector3();
export function updateArrow(
  i: number,
  pos: Vector3,
  cx: number,
  cy: number,
  visible: boolean,
) {
  const a = arrows[i];
  const len = Math.hypot(cx, cy);
  if (!visible || len < 1e-3) {
    a.visible = false;
    return;
  }
  a.visible = true;
  const raw = Math.min(len / 28, 1);
  const ramp = Math.max(0, (raw - 0.65) / 0.35);
  const ratio = ramp * ramp;
  const t = performance.now() * 0.001;
  const shakeAmp = ratio * 0.025;
  const freq = 45 + ratio * 20;
  const sx = (Math.sin(t * freq) + Math.sin(t * freq * 2.3) * 0.5) * shakeAmp;
  const sy = (Math.cos(t * freq * 1.37) + Math.cos(t * freq * 2.7) * 0.5) * shakeAmp;
  a.position.set(pos.x + sx, pos.y + sy, pos.z);
  const wobble = ratio * 0.015;
  const baseAng = Math.atan2(cy, cx);
  const ang = baseAng + Math.sin(t * freq * 1.1) * wobble;
  tmpDir.set(Math.cos(ang), Math.sin(ang), 0);
  a.setDirection(tmpDir);
  const visLen = Math.min(len * 0.18, 5);
  a.setLength(
    visLen,
    Math.min(0.5, visLen * 0.25),
    Math.min(0.3, visLen * 0.18),
  );
}

// Rolling: a ball moving in the screen plane rolls with angular speed v/r.
// Horizontal motion → spin about Z, vertical motion → tumble about X. A faint
// idle spin keeps them alive when at rest / charging.
const SPIN_X = new Vector3(1, 0, 0);
const SPIN_Y = new Vector3(0, 1, 0);
const SPIN_Z = new Vector3(0, 0, 1);
const IDLE_SPIN = 0.35;

export function spinBall(i: number, vx: number, vy: number, dt: number) {
  const mesh = ballMeshes[i];
  const inv = dt / BALL_R;
  mesh.rotateOnWorldAxis(SPIN_Z, -vx * inv);
  mesh.rotateOnWorldAxis(SPIN_X, vy * inv);
  mesh.rotateOnWorldAxis(SPIN_Y, IDLE_SPIN * dt);
}

export const fx = [
  { flash: 0, punch: 0 },
  { flash: 0, punch: 0 },
];
export const FLASH_DECAY = 0.07;
export const PUNCH_DECAY = 0.09;
export const PUNCH_MAX_SCALE = 0.55;

export function resetFx() {
  for (const f of fx) {
    f.flash = 0;
    f.punch = 0;
  }
  for (const m of ballMeshes) m.scale.setScalar(1);
}
