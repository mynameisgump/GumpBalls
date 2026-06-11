import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
} from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { Slot } from "../shared";
import { scene } from "./scene";
import { makeSpacedText } from "./text3d";
import { P_COLORS } from "./balls";

const WIN_OPTS = {
  size: 1.1,
  depth: 0.32,
  curveSegments: 6,
  bevelEnabled: true,
  bevelThickness: 0.05,
  bevelSize: 0.04,
  bevelSegments: 2,
};

const COUNTDOWN_OPTS = {
  size: 0.55,
  depth: 0.16,
  curveSegments: 5,
  bevelEnabled: true,
  bevelThickness: 0.025,
  bevelSize: 0.02,
  bevelSegments: 2,
};

function disposeGroup(g: Group | null) {
  if (!g) return;
  g.traverse((obj) => {
    if (obj instanceof Mesh) {
      const geo = obj.geometry as BufferGeometry;
      geo.dispose?.();
    }
  });
  g.parent?.remove(g);
}

export function createWinScreen(font: Font) {
  const root = new Group();
  root.position.set(0, 0.8, 5);
  root.visible = false;
  scene.add(root);

  const winMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.2,
    metalness: 0.4,
    roughness: 0.4,
  });
  const countdownMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x222222,
    emissiveIntensity: 0.5,
    metalness: 0.3,
    roughness: 0.5,
  });

  let winGroup: Group | null = null;
  let countdownGroup: Group | null = null;
  let lastSecs = -1;
  let visible = false;
  let t = 0;

  function show(winner: Slot, opts?: { accent?: number; name?: string }) {
    const accent = opts?.accent ?? P_COLORS[winner];
    winMat.color.setHex(accent);
    winMat.emissive.setHex(accent);

    disposeGroup(winGroup);
    const label = opts?.name ? `${opts.name} WINS` : `P${winner + 1} WINS`;
    const text = makeSpacedText(
      label,
      { font, ...WIN_OPTS },
      winMat,
      0.2,
      0.6,
    );
    winGroup = text.group;
    winGroup.position.y = 1.2;
    root.add(winGroup);

    lastSecs = -1;
    visible = true;
    root.visible = true;
    t = 0;
  }

  function update(remainingMs: number, dt: number) {
    if (!visible) return;
    t += dt;

    // Pulse winner text
    winMat.emissiveIntensity = 1.0 + Math.sin(t * 5) * 0.5;
    if (winGroup) {
      winGroup.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    }

    const secs = Math.max(0, Math.ceil(remainingMs / 1000));
    if (secs !== lastSecs) {
      lastSecs = secs;
      disposeGroup(countdownGroup);
      const text = makeSpacedText(
        `NEXT MATCH IN ${secs}`,
        { font, ...COUNTDOWN_OPTS },
        countdownMat,
        0.12,
        0.55,
      );
      countdownGroup = text.group;
      countdownGroup.position.y = -0.6;
      root.add(countdownGroup);
    }
  }

  function hide() {
    visible = false;
    root.visible = false;
    disposeGroup(winGroup);
    disposeGroup(countdownGroup);
    winGroup = null;
    countdownGroup = null;
    lastSecs = -1;
  }

  return { show, update, hide };
}

export type WinScreen = ReturnType<typeof createWinScreen>;
