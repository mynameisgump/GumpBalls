import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
} from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { CEIL_Y, ROOM_W, BALL_R, playerColor, type MatchStatus } from "../shared";
import type { Roster } from "./net";
import { scene } from "./scene";
import { ballMeshes } from "./balls";
import { makeSpacedText } from "./text3d";

const BANNER_Y = CEIL_Y + 2.0;
const LIST_X = ROOM_W / 2 - 1.6;
const LIST_TOP_Y = 2.4;
const LIST_STEP = 0.7;
const LIST_MAX = 8;

const GOLD = 0xffd23a;
const SILVER = 0xcfd2d6;
const DIM = 0x8893a0;

const BANNER_OPTS = {
  size: 0.42,
  depth: 0.1,
  curveSegments: 4,
  bevelEnabled: true,
  bevelThickness: 0.02,
  bevelSize: 0.015,
  bevelSegments: 1,
};
const LIST_OPTS = {
  size: 0.34,
  depth: 0.08,
  curveSegments: 4,
  bevelEnabled: false,
};
const TAG_OPTS = {
  size: 0.42,
  depth: 0.1,
  curveSegments: 4,
  bevelEnabled: true,
  bevelThickness: 0.02,
  bevelSize: 0.015,
  bevelSegments: 1,
};

function disposeGroup(g: Group | null) {
  if (!g) return;
  g.traverse((o) => {
    if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose?.();
  });
  g.parent?.remove(g);
}

function mat(hex: number, emissive = 0.6) {
  return new MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: emissive,
    metalness: 0.3,
    roughness: 0.45,
  });
}

export function createTournamentUi(font: Font) {
  const root = new Group();
  scene.add(root);

  // Banner is built from independently-colored segments (champion name, "VS",
  // challenger name) so each name can carry its own player color.
  const bannerRoot = new Group();
  bannerRoot.position.y = BANNER_Y;
  root.add(bannerRoot);
  const bannerMats: MeshStandardMaterial[] = [];

  // Next-up list lives in its own subtree so we can wipe/rebuild it wholesale.
  const listRoot = new Group();
  root.add(listRoot);
  const listMats: MeshStandardMaterial[] = [];

  // Per-ball name tags, shown only during the countdown.
  const tagMats: [MeshStandardMaterial, MeshStandardMaterial] = [
    mat(GOLD, 0.8),
    mat(SILVER, 0.8),
  ];
  const tagGroups: [Group | null, Group | null] = [null, null];
  const tagNames: [string, string] = ["", ""];

  let sig = "";
  let t = 0;
  let visible = false;

  function clearBanner() {
    bannerRoot.traverse((o) => {
      if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose?.();
    });
    bannerRoot.clear();
    bannerMats.length = 0;
  }

  function rebuildBanner(roster: Roster | null) {
    clearBanner();
    const champ = roster?.champion;
    const chall = roster?.challenger;
    const segs = [
      {
        text: champ ? `${champ.name} W${roster!.streak}` : "NO CHAMPION",
        color: champ ? playerColor(champ.name).base : 0xffffff,
      },
      { text: "VS", color: 0xffffff },
      {
        text: chall ? chall.name : "WAITING",
        color: chall ? playerColor(chall.name).base : DIM,
      },
    ];
    const GAP = 0.5;
    const groups: Group[] = [];
    let cursor = 0;
    for (const s of segs) {
      const m = mat(s.color, 0.7);
      bannerMats.push(m);
      const t = makeSpacedText(s.text, { font, ...BANNER_OPTS }, m, 0.1, 0.5);
      t.group.position.x = cursor + t.width / 2;
      cursor += t.width + GAP;
      bannerRoot.add(t.group);
      groups.push(t.group);
    }
    const total = cursor - GAP;
    for (const g of groups) g.position.x -= total / 2; // center the row
  }

  function clearList() {
    listRoot.traverse((o) => {
      if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose?.();
    });
    listRoot.clear();
    listMats.length = 0;
  }

  function addListLine(label: string, hex: number, y: number) {
    const m = mat(hex, 0.5);
    listMats.push(m);
    const text = makeSpacedText(label, { font, ...LIST_OPTS }, m, 0.07, 0.5);
    text.group.position.set(LIST_X, y, 0);
    listRoot.add(text.group);
  }

  function rebuildList(roster: Roster | null, myId: number) {
    clearList();
    const q = roster?.queue ?? [];
    if (q.length === 0) return;
    addListLine("NEXT UP", 0xffffff, LIST_TOP_Y);
    const shown = Math.min(q.length, LIST_MAX);
    for (let i = 0; i < shown; i++) {
      const p = q[i];
      const me = p.id === myId;
      const label = `${i + 1}. ${p.name}${me ? " (YOU)" : ""}`;
      // Each queued name in its own username color, matching their ball.
      addListLine(label, playerColor(p.name).base, LIST_TOP_Y - LIST_STEP * (i + 1));
    }
    if (q.length > shown) {
      addListLine(`+${q.length - shown} MORE`, DIM, LIST_TOP_Y - LIST_STEP * (shown + 1));
    }
  }

  function rebuildTag(slot: 0 | 1, name: string) {
    disposeGroup(tagGroups[slot]);
    tagGroups[slot] = null;
    tagNames[slot] = name;
    if (!name) return;
    // Tag color matches the ball: derived from the player's username.
    const c = playerColor(name).base;
    tagMats[slot].color.setHex(c);
    tagMats[slot].emissive.setHex(c);
    const text = makeSpacedText(name, { font, ...TAG_OPTS }, tagMats[slot], 0.08, 0.5);
    tagGroups[slot] = text.group;
    root.add(text.group);
  }

  function show() {
    visible = true;
    root.visible = true;
  }

  function hide() {
    visible = false;
    root.visible = false;
  }

  function update(
    roster: Roster | null,
    myId: number,
    phase: MatchStatus,
    dt: number,
  ) {
    if (!visible) return;
    t += dt;

    // Rebuild text only when the roster actually changes (cheap signature).
    const champ = roster?.champion;
    const chall = roster?.challenger;
    const nextSig = JSON.stringify({
      c: champ ? [champ.id, champ.name] : null,
      h: chall ? [chall.id, chall.name] : null,
      s: roster?.streak ?? 0,
      q: roster?.queue.map((p) => [p.id, p.name]) ?? [],
      m: myId,
    });
    if (nextSig !== sig) {
      sig = nextSig;
      rebuildBanner(roster);
      rebuildList(roster, myId);
      if ((champ?.name ?? "") !== tagNames[0]) rebuildTag(0, champ?.name ?? "");
      if ((chall?.name ?? "") !== tagNames[1]) rebuildTag(1, chall?.name ?? "");
    }

    const pulse = 0.7 + Math.sin(t * 3) * 0.2;
    for (const m of bannerMats) m.emissiveIntensity = pulse;

    // Name tags float above their ball — only while the countdown is running.
    const showTags = phase === "starting";
    for (let i = 0; i < 2; i++) {
      const g = tagGroups[i];
      if (!g) continue;
      if (showTags && tagNames[i]) {
        g.visible = true;
        const p = ballMeshes[i].position;
        g.position.set(p.x, p.y + BALL_R + 0.85 + Math.sin(t * 2 + i) * 0.08, p.z);
      } else {
        g.visible = false;
      }
    }
  }

  return { show, hide, update };
}

export type TournamentUi = ReturnType<typeof createTournamentUi>;
