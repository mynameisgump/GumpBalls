import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
} from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { CEIL_Y, ROOM_W, MAX_HP, type Slot } from "../shared";
import { scene } from "./scene";
import { makeSpacedText } from "./text3d";

const Y_POS = CEIL_Y + 0.8;
const X_OFFSET = ROOM_W * 0.22;
const LABEL_OPTS = {
  size: 0.7,
  depth: 0.16,
  curveSegments: 5,
  bevelEnabled: true,
  bevelThickness: 0.03,
  bevelSize: 0.025,
  bevelSegments: 2,
};

type SlotEntry = {
  name: string;
  baseX: number;
  group: Group;
  textGroup: Group | null;
  mat: MeshStandardMaterial;
  lastHp: number;
};

export function createHpDisplay(font: Font) {
  const slots: [SlotEntry, SlotEntry] = [
    makeSlot("P1", -X_OFFSET, 0xff5533),
    makeSlot("P2", X_OFFSET, 0x33ff66),
  ];

  function makeSlot(name: string, baseX: number, accent: number): SlotEntry {
    const mat = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: accent,
      emissiveIntensity: 0.35,
      metalness: 0.3,
      roughness: 0.5,
    });
    const group = new Group();
    group.position.set(baseX, Y_POS, 0);
    group.visible = false;
    scene.add(group);
    return { name, baseX, group, textGroup: null, mat, lastHp: -1 };
  }

  function disposeText(s: SlotEntry) {
    if (!s.textGroup) return;
    s.group.remove(s.textGroup);
    s.textGroup.traverse((obj) => {
      if (obj instanceof Mesh) {
        const g = obj.geometry as BufferGeometry;
        g.dispose?.();
      }
    });
    s.textGroup = null;
  }

  function rebuild(s: SlotEntry, hp: number) {
    disposeText(s);
    const label = `${s.name}  ${hp}`;
    const text = makeSpacedText(
      label,
      { font, ...LABEL_OPTS },
      s.mat,
      0.1,
      0.55,
    );
    s.textGroup = text.group;
    s.group.add(text.group);
  }

  function update(p1Hp: number, p2Hp: number) {
    const hps: [number, number] = [
      Math.max(0, Math.round(p1Hp)),
      Math.max(0, Math.round(p2Hp)),
    ];
    for (let i = 0; i < 2; i++) {
      const s = slots[i as Slot];
      if (s.lastHp !== hps[i]) {
        s.lastHp = hps[i];
        rebuild(s, hps[i]);
        const ratio = hps[i] / MAX_HP;
        s.mat.emissiveIntensity = 0.35 + (1 - ratio) * 0.8;
      }
    }
  }

  function show() {
    for (const s of slots) s.group.visible = true;
  }

  function hide() {
    for (const s of slots) s.group.visible = false;
  }

  function reset() {
    for (const s of slots) s.lastHp = -1;
    update(MAX_HP, MAX_HP);
  }

  return { show, hide, update, reset };
}

export type HpDisplay = ReturnType<typeof createHpDisplay>;
