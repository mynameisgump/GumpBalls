import { setupAudio, type AudioSound, type AudioVoice } from "@opentui/core";

const THUD_PATH = new URL("../../public/Thud.wav", import.meta.url).pathname;
const MUSIC_PATH = new URL(
  "../../public/ShittyMusic.wav",
  import.meta.url,
).pathname;
const MENU_TICK_PATH = new URL(
  "../../public/MenuTick.wav",
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

let musicVoice: AudioVoice | null = null;
audio.loadSoundFile(MUSIC_PATH).then((s) => {
  if (s !== null) musicVoice = audio.play(s, { volume: 0.8, loop: true });
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
