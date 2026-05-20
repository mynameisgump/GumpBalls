#!/usr/bin/env bun
import { type KeyEvent } from "@opentui/core";
import { renderer, scene, engine, fb } from "./client/scene";
import { loadFont } from "./client/font";
import { ballMeshes, arrows } from "./client/balls";
import { updateParticles } from "./client/particles";
import { hud, banner } from "./client/hud";
import {
  connect,
  netState,
  sendDir,
  sendSpace,
  setBanner,
  updateServerScene,
} from "./client/net";
import { createTitleScreen } from "./client/titleScreen";
import type { DirKey } from "./shared";

const font = await loadFont();
const title = createTitleScreen(font);

type Screen = "title" | "playing";
let screen: Screen = "title";

hud.visible = false;
banner.visible = false;
title.show();

function startMatch() {
  screen = "playing";
  title.hide();
  hud.visible = true;
  banner.visible = true;
  for (const m of ballMeshes) m.visible = true;
  for (const a of arrows) a.visible = false;
  setBanner();
  connect();
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
    if (choice === "start") startMatch();
    else if (choice === "quit") quit();
    return;
  }

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
  } else {
    updateServerScene(dt);
    updateParticles(dt);
    if (netState.serverStatus === "ended") setBanner();
  }
  await engine.drawScene(scene, fb.frameBuffer, deltaMs);
});
