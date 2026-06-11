#!/usr/bin/env bun
import { type KeyEvent } from "@opentui/core";
import { renderer, scene, engine, fb, updateShake } from "./client/scene";
import "./client/audio";
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
import { createWinScreen } from "./client/winScreen";
import { createCountdown } from "./client/countdown";
import type { DirKey, Slot } from "./shared";

const ONLINE_RESET_MS = 5000;

const font = await loadFont();
const title = createTitleScreen(font);
const offline = createOfflineGame();
const hpDisplay = createHpDisplay(font);
const winScreen = createWinScreen(font);
const countdown = createCountdown(font);

let winShownEndedAt = 0;
// Tracks fight-start transitions so we fire one countdown per round.
let offlineCounting = false;
let onlinePlaying = false;

type Screen = "title" | "online" | "offline";
let screen: Screen = "title";

title.show();

function showGame() {
  for (const m of ballMeshes) m.visible = true;
  for (const a of arrows) a.visible = false;
  hpDisplay.reset();
  hpDisplay.show();
  winScreen.hide();
  countdown.hide();
  winShownEndedAt = 0;
  offlineCounting = false;
  onlinePlaying = false;
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

function syncWinScreen(
  ended: boolean,
  winner: Slot | undefined,
  endedAt: number,
  resetMs: number,
  dt: number,
) {
  if (ended && winner !== undefined) {
    if (winShownEndedAt !== endedAt) {
      winShownEndedAt = endedAt;
      winScreen.show(winner);
    }
    const remaining = resetMs - (Date.now() - endedAt);
    winScreen.update(remaining, dt);
  } else if (winShownEndedAt !== 0) {
    winScreen.hide();
    winShownEndedAt = 0;
  }
}

renderer.setFrameCallback(async (deltaMs: number) => {
  const dt = deltaMs / 1000;
  updateShake(dt);
  if (screen === "title") {
    title.update(dt);
  } else if (screen === "offline") {
    // Run the "3..2..1..GO!" overlay before unfreezing the fight.
    const st = offline.getStatus();
    if (st.phase === "starting") {
      if (!offlineCounting) {
        countdown.start();
        offlineCounting = true;
      }
      if (!countdown.update(dt)) offline.beginPlay();
    } else {
      offlineCounting = false;
    }
    offline.update(dt);
    updateParticles(dt);
    const [h1, h2] = offline.getHps();
    hpDisplay.update(h1, h2);
    syncWinScreen(st.phase === "ended", st.winner, st.endedAt, st.resetMs, dt);
  } else {
    updateServerScene(dt);
    // Visual-only countdown when a fresh online match goes live.
    const playing = netState.serverStatus === "playing";
    if (playing && !onlinePlaying) countdown.start();
    onlinePlaying = playing;
    if (countdown.isActive()) countdown.update(dt);
    updateParticles(dt);
    if (netState.lastSnap) {
      hpDisplay.update(
        netState.lastSnap[0].hp,
        netState.lastSnap[1].hp,
      );
    }
    syncWinScreen(
      netState.serverStatus === "ended",
      netState.winner,
      netState.endedAt,
      ONLINE_RESET_MS,
      dt,
    );
  }
  await engine.drawScene(scene, fb.frameBuffer, deltaMs);
});
