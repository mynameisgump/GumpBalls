import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
} from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { scene } from "./scene";
import { makeSpacedText } from "./text3d";
import { playCountdownTick, playCountdownGo } from "./audio";

const NUM_OPTS = {
  size: 1.4,
  depth: 0.45,
  curveSegments: 6,
  bevelEnabled: true,
  bevelThickness: 0.06,
  bevelSize: 0.05,
  bevelSegments: 2,
};

// Mario-kart flavor: each light has its own hue, GO! goes green.
type Step = { label: string; color: number; ms: number; go?: boolean };
const STEPS: Step[] = [
  { label: "3", color: 0xff3a3a, ms: 0.75 },
  { label: "2", color: 0xffa53a, ms: 0.75 },
  { label: "1", color: 0xffe23a, ms: 0.75 },
  { label: "GO!", color: 0x3aff5a, ms: 0.9, go: true },
];
const TOTAL = STEPS.reduce((a, s) => a + s.ms, 0);

// Cumulative end-time of each step so we can map elapsed -> step index.
const ENDS = STEPS.reduce<number[]>((acc, s) => {
  acc.push((acc[acc.length - 1] ?? 0) + s.ms);
  return acc;
}, []);

// ease-out-back: overshoot then settle — gives the number a "slam in" pop.
function outBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = x - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

function disposeGroup(g: Group | null) {
  if (!g) return;
  g.traverse((obj) => {
    if (obj instanceof Mesh) (obj.geometry as BufferGeometry).dispose?.();
  });
  g.parent?.remove(g);
}

export function createCountdown(font: Font) {
  const root = new Group();
  // Centered on the camera's look target, pulled toward the camera so it
  // reads as a big screen-space overlay floating in front of the arena.
  root.position.set(0, 0.75, 7);
  root.visible = false;
  scene.add(root);

  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.4,
    metalness: 0.3,
    roughness: 0.35,
    transparent: true,
    opacity: 1,
  });

  let group: Group | null = null;
  let t = 0;
  let stepIdx = -1;
  let running = false;

  function buildStep(i: number) {
    const step = STEPS[i];
    disposeGroup(group);
    mat.color.setHex(step.color);
    mat.emissive.setHex(step.color);
    const text = makeSpacedText(step.label, { font, ...NUM_OPTS }, mat, 0.2, 0.6);
    group = text.group;
    root.add(group);
    if (step.go) playCountdownGo();
    else playCountdownTick();
  }

  function start() {
    t = 0;
    stepIdx = 0;
    running = true;
    root.visible = true;
    mat.opacity = 1;
    buildStep(0);
  }

  // Returns true while the countdown is still running.
  function update(dt: number): boolean {
    if (!running) return false;
    t += dt;

    if (t >= TOTAL) {
      hide();
      return false;
    }

    // Advance to the step matching elapsed time (plays sound on entry).
    let i = 0;
    while (i < ENDS.length - 1 && t >= ENDS[i]) i++;
    if (i !== stepIdx) {
      stepIdx = i;
      buildStep(i);
    }

    const step = STEPS[stepIdx];
    const st = t - (ENDS[stepIdx] - step.ms); // time within this step
    if (!group) return true;

    // Pop-in slam with overshoot.
    const POP = 0.3;
    const popP = Math.min(1, st / POP);
    const from = 2.4;
    const scale = step.go
      ? 1 + outBack(popP) * 1.1 // GO! punches outward
      : from + (1 - from) * outBack(popP);
    group.scale.setScalar(scale);

    // Quick settle wobble + idle hum.
    group.rotation.z = Math.sin(st * 20) * 0.22 * Math.exp(-st * 5);
    mat.emissiveIntensity = 1.0 + Math.max(0, 1.6 - st * 3) + Math.sin(t * 8) * 0.2;

    // Fade out the tail of each step so swaps/finish read cleanly.
    const fade = step.go ? 0.45 : 0.18;
    const left = step.ms - st;
    mat.opacity = left < fade ? Math.max(0, left / fade) : 1;

    return true;
  }

  function hide() {
    running = false;
    root.visible = false;
    disposeGroup(group);
    group = null;
    stepIdx = -1;
  }

  return { start, update, isActive: () => running, hide };
}

export type Countdown = ReturnType<typeof createCountdown>;
