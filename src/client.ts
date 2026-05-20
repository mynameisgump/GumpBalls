#!/usr/bin/env bun
import { type KeyEvent } from "@opentui/core";
import { renderer, scene, engine, fb } from "./client/scene";
import { loadFont } from "./client/font";
import { ballMeshes, arrows } from "./client/balls";
import { updateParticles } from "./client/particles";
import {
  connect,
  netState,
  sendDir,
  sendSpace,
  updateServerScene,
} from "./client/net";
import { createTitleScreen } from "./client/titleScreen";
import { createOfflineGame } from "./client/offlineGame";
import { createHpDisplay } from "./client/hpDisplay";
import type { DirKey } from "./shared";

const font = await loadFont();
const title = createTitleScreen(font);
const offline = createOfflineGame();
const hpDisplay = createHpDisplay(font);

type Screen = "title" | "online" | "offline";
let screen: Screen = "title";

title.show();

function showGame() {
  for (const m of ballMeshes) m.visible = true;
  for (const a of arrows) a.visible = false;
  hpDisplay.reset();
  hpDisplay.show();
}

function startOnline() {
  screen = "online";
  title.hide();
  showGame();
  connect();
}

function startOffline() {
  screen = "offline";
  title.hide();
  showGame();
  offline.show();
}

function quit() {
  renderer.destroy();
  process.exit(0);
}

const DIR_NAMES: Record<string, DirKey> = {
  left: "left",
  right: "right",
  up: "up",
  down: "down",
  a: "a",
  d: "d",
  w: "w",
  s: "s",
  q: "q",
  e: "e",
  z: "z",
  c: "c",
};

renderer.keyInput.on("keypress", (k: KeyEvent) => {
  if (k.eventType === "repeat") return;
  netState.lastKey = `${k.name ?? "?"}${k.shift ? "+S" : ""}${k.ctrl ? "+C" : ""}`;

  if (k.ctrl && (k.name === "c" || k.name === "q")) {
    quit();
  }

  if (screen === "title") {
    const choice = title.onKey(k.name);
    if (choice === "single") startOffline();
    else if (choice === "multi") startOnline();
    else if (choice === "quit") quit();
    return;
  }

  if (screen === "offline") {
    if (k.name === "space") offline.input("space", false);
    else {
      const name = k.name ? DIR_NAMES[k.name] : undefined;
      if (name) offline.input(name, !!k.shift);
    }
    return;
  }

  // online
  if (k.name === "space") {
    sendSpace();
    return;
  }
  const name = k.name ? DIR_NAMES[k.name] : undefined;
  if (name) sendDir(name, !!k.shift);
});

renderer.setFrameCallback(async (deltaMs: number) => {
  const dt = deltaMs / 1000;
  if (screen === "title") {
    title.update(dt);
  } else if (screen === "offline") {
    offline.update(dt);
    updateParticles(dt);
    const [h1, h2] = offline.getHps();
    hpDisplay.update(h1, h2);
  } else {
    updateServerScene(dt);
    updateParticles(dt);
    if (netState.lastSnap) {
      hpDisplay.update(
        netState.lastSnap[0].hp,
        netState.lastSnap[1].hp,
      );
    }
  }
  await engine.drawScene(scene, fb.frameBuffer, deltaMs);
});
