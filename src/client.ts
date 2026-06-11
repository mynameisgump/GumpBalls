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
import { switchMusic } from "./client/audio";
import { createTitleScreen } from "./client/titleScreen";
import { createOfflineGame } from "./client/offlineGame";
import { createHpDisplay } from "./client/hpDisplay";
import { createWinScreen } from "./client/winScreen";
import { createCountdown } from "./client/countdown";
import { createNameEntry } from "./client/nameEntry";
import { createTournamentUi } from "./client/tournamentUi";
import type { DirKey, Slot } from "./shared";

const ONLINE_RESET_MS = 5000;

const font = await loadFont();
const title = createTitleScreen(font);
const offline = createOfflineGame();
const hpDisplay = createHpDisplay(font);
const winScreen = createWinScreen(font);
const countdown = createCountdown(font);
const nameEntry = createNameEntry(font);
const tournamentUi = createTournamentUi(font);

let winShownEndedAt = 0;
// Tracks fight-start transitions so we fire one countdown per round.
let offlineCounting = false;
let onlineStarting = false;

type Screen = "title" | "name" | "online" | "offline";
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
  onlineStarting = false;
}

function startNameEntry() {
  screen = "name";
  title.hide();
  nameEntry.show();
}

function startOnline(name: string) {
  screen = "online";
  nameEntry.hide();
  showGame();
  tournamentUi.show();
  connect(name);
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
    else if (choice === "multi") startNameEntry();
    else if (choice === "quit") quit();
    return;
  }

  if (screen === "name") {
    const r = nameEntry.onKey(k.name, !!k.shift);
    if (r) startOnline(r.submit);
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
    switchMusic("menu");
    title.update(dt);
  } else if (screen === "name") {
    switchMusic("menu");
    nameEntry.update(dt);
  } else if (screen === "offline") {
    // Music: silence during the countdown, battle once live, death track on KO.
    const st = offline.getStatus();
    switchMusic(
      st.phase === "starting" ? "none" : st.phase === "ended" ? "death" : "battle",
    );
    // Run the "3..2..1..GO!" overlay before unfreezing the fight.
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
    // Music tracks server phase: silence during the countdown, battle once
    // live, death on KO, menu in the lobby.
    switchMusic(
      netState.serverStatus === "starting"
        ? "none"
        : netState.serverStatus === "playing"
          ? "battle"
          : netState.serverStatus === "ended"
            ? "death"
            : "menu",
    );
    // Server owns the countdown phase; fire the overlay when it begins.
    const starting = netState.serverStatus === "starting";
    if (starting && !onlineStarting) countdown.start();
    onlineStarting = starting;
    if (countdown.isActive()) countdown.update(dt);
    tournamentUi.update(
      netState.roster,
      netState.myId,
      netState.serverStatus,
      dt,
    );
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
