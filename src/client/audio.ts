import { setupAudio, type AudioSound, type AudioVoice } from "@opentui/core";
import {
  BALL_MIN_X,
  BALL_MAX_X,
  BALL_MIN_Y,
  BALL_MAX_Y,
} from "../shared";

const THUD_PATH = new URL("../../public/Thud.wav", import.meta.url).pathname;
const MENU_MUSIC_PATH = new URL(
  "../../public/NewMenu.wav",
  import.meta.url,
).pathname;
const BATTLE_MUSIC_PATH = new URL(
  "../../public/BattleTrack.wav",
  import.meta.url,
).pathname;
const DEATH_MUSIC_PATH = new URL(
  "../../public/DeathTrack.wav",
  import.meta.url,
).pathname;
const MENU_TICK_PATH = new URL(
  "../../public/MenuTick.wav",
  import.meta.url,
).pathname;
const ARROW_PRESS_PATH = new URL(
  "../../public/ArrowPress.wav",
  import.meta.url,
).pathname;
const DEATH_PATH = new URL("../../public/Dead.wav", import.meta.url).pathname;
const WALL_HIT_PATH = new URL(
  "../../public/WallHit.wav",
  import.meta.url,
).pathname;
const COUNTDOWN_TICK_PATH = new URL(
  "../../public/StartingCountDown.wav",
  import.meta.url,
).pathname;
const COUNTDOWN_GO_PATH = new URL(
  "../../public/StartingCountDownStart.wav",
  import.meta.url,
).pathname;

const audio = setupAudio({ autoStart: true });

let thud: AudioSound | null = null;
audio.loadSoundFile(THUD_PATH).then((s) => {
  thud = s;
});

let menuTick: AudioSound | null = null;
audio.loadSoundFile(MENU_TICK_PATH).then((s) => {
  menuTick = s;
});

let arrowPress: AudioSound | null = null;
audio.loadSoundFile(ARROW_PRESS_PATH).then((s) => {
  arrowPress = s;
});

let death: AudioSound | null = null;
audio.loadSoundFile(DEATH_PATH).then((s) => {
  death = s;
});

let wallHit: AudioSound | null = null;
audio.loadSoundFile(WALL_HIT_PATH).then((s) => {
  wallHit = s;
});

let countdownTick: AudioSound | null = null;
audio.loadSoundFile(COUNTDOWN_TICK_PATH).then((s) => {
  countdownTick = s;
});

let countdownGo: AudioSound | null = null;
audio.loadSoundFile(COUNTDOWN_GO_PATH).then((s) => {
  countdownGo = s;
});

// Music tracks. Exactly one (or none) loops at a time; switchMusic() crossfades
// by hard-stopping the old voice and starting the new looped track.
export type MusicTrack = "menu" | "battle" | "death" | "none";
const MUSIC_VOL: Record<Exclude<MusicTrack, "none">, number> = {
  menu: 0.8,
  battle: 0.8,
  death: 0.85,
};
const musicSounds: Record<Exclude<MusicTrack, "none">, AudioSound | null> = {
  menu: null,
  battle: null,
  death: null,
};
let musicVoice: AudioVoice | null = null;
let currentTrack: MusicTrack = "menu";

function startTrack(track: Exclude<MusicTrack, "none">) {
  const s = musicSounds[track];
  if (s === null) return; // not loaded yet; load handler will pick it up
  musicVoice = audio.play(s, { volume: MUSIC_VOL[track], loop: true });
}

export function switchMusic(track: MusicTrack) {
  if (track === currentTrack && (track === "none" || musicVoice !== null)) return;
  currentTrack = track;
  if (musicVoice !== null) {
    audio.stopVoice(musicVoice);
    musicVoice = null;
  }
  if (track !== "none") startTrack(track);
}

audio.loadSoundFile(MENU_MUSIC_PATH).then((s) => {
  musicSounds.menu = s;
  if (currentTrack === "menu" && musicVoice === null) startTrack("menu");
});
audio.loadSoundFile(BATTLE_MUSIC_PATH).then((s) => {
  musicSounds.battle = s;
  if (currentTrack === "battle" && musicVoice === null) startTrack("battle");
});
audio.loadSoundFile(DEATH_MUSIC_PATH).then((s) => {
  musicSounds.death = s;
  if (currentTrack === "death" && musicVoice === null) startTrack("death");
});

let muted = false;

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  audio.setMasterVolume(muted ? 0 : 1);
  return muted;
}

// Don't bother with imperceptible taps; avoids spam on resting jitter.
const MIN_CLOSING = 0.4;

export function playHitThud(closing: number) {
  if (muted || thud === null || closing < MIN_CLOSING) return;
  const volume = Math.min(1, 0.15 + closing * 0.08);
  audio.play(thud, { volume });
}

export function playMenuTick() {
  if (muted || menuTick === null) return;
  audio.play(menuTick, { volume: 0.6 });
}

export function playArrowPress() {
  if (muted || arrowPress === null) return;
  audio.play(arrowPress, { volume: 0.7 });
}

export function playDeath() {
  if (muted || death === null) return;
  audio.play(death, { volume: 1 });
}

export function playCountdownTick() {
  if (muted || countdownTick === null) return;
  audio.play(countdownTick, { volume: 0.9 });
}

export function playCountdownGo() {
  if (muted || countdownGo === null) return;
  audio.play(countdownGo, { volume: 1 });
}

function playWallHit(impact: number) {
  if (muted || wallHit === null) return;
  audio.play(wallHit, { volume: Math.min(1, 0.2 + impact * 0.06) });
}

// Per-ball wall detection: a bounce clamps the ball to the boundary and flips
// the velocity component in the same physics step, so we catch it by a
// sign reversal while sitting on a wall. Speed floor skips resting/settling.
const WALL_EPS = 0.05;
const WALL_MIN_SPEED = 2.5;
const WALL_COOLDOWN = 80;

type WallState = { vx: number; vy: number; lastPlay: number };
const wallStates = new Map<string, WallState>();

export function tickWallSound(
  key: string,
  x: number,
  y: number,
  vx: number,
  vy: number,
) {
  const prev = wallStates.get(key);
  if (prev) {
    let impact = 0;
    if (x <= BALL_MIN_X + WALL_EPS && prev.vx < 0)
      impact = Math.max(impact, -prev.vx);
    else if (x >= BALL_MAX_X - WALL_EPS && prev.vx > 0)
      impact = Math.max(impact, prev.vx);
    if (y <= BALL_MIN_Y + WALL_EPS && prev.vy < 0)
      impact = Math.max(impact, -prev.vy);
    else if (y >= BALL_MAX_Y - WALL_EPS && prev.vy > 0)
      impact = Math.max(impact, prev.vy);

    const now = performance.now();
    if (impact > WALL_MIN_SPEED && now - prev.lastPlay > WALL_COOLDOWN) {
      playWallHit(impact);
      prev.lastPlay = now;
    }
    prev.vx = vx;
    prev.vy = vy;
  } else {
    wallStates.set(key, { vx, vy, lastPlay: 0 });
  }
}

// Per-ball charge tracking: fire ArrowPress whenever a ball's charge vector
// changes while charging — works for self and enemy alike (local input,
// bot input, or server snapshots all just move cx/cy).
type ChargeState = { cx: number; cy: number; charging: boolean };
const chargeStates = new Map<string, ChargeState>();

export function tickChargeSound(
  key: string,
  charging: boolean,
  cx: number,
  cy: number,
) {
  const prev = chargeStates.get(key);
  if (
    prev &&
    prev.charging &&
    charging &&
    (cx !== prev.cx || cy !== prev.cy)
  ) {
    playArrowPress();
  }
  chargeStates.set(key, { cx, cy, charging });
}
