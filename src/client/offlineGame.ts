import {
  TICK_HZ,
  applyDir,
  applySpace,
  makeBall,
  physicsStep,
  type Ball,
  type DirKey,
  type Slot,
} from "../shared";
import { botTick, makeBotState, resetBotState } from "../bot";
import {
  ballMats,
  ballMeshes,
  arrows,
  updateArrow,
  fx,
  FLASH_DECAY,
  PUNCH_DECAY,
  PUNCH_MAX_SCALE,
  P_COLORS,
  P_CHARGE,
} from "./balls";
import { burstBlood, clearBlood } from "./particles";
import { addShake } from "./scene";
import { playHitThud, tickChargeSound, playDeath, tickWallSound } from "./audio";
const FIXED_DT = 1 / TICK_HZ;
const RESET_MS = 5000;

export function createOfflineGame() {
  let balls: Ball[] = [makeBall(0), makeBall(1)];
  const botState = makeBotState();
  let status: "playing" | "ended" = "playing";
  let winner: Slot | undefined;
  let endedAt = 0;
  let hitstopUntil = 0;
  let accum = 0;
  let active = false;

  function reset() {
    balls = [makeBall(0), makeBall(1)];
    resetBotState(botState);
    status = "playing";
    winner = undefined;
    endedAt = 0;
    hitstopUntil = 0;
    accum = 0;
    for (const m of ballMeshes) {
      m.visible = true;
      m.scale.setScalar(1);
    }
    for (const a of arrows) a.visible = false;
    for (const f of fx) {
      f.flash = 0;
      f.punch = 0;
    }
    clearBlood();
  }

  function show() {
    active = true;
    reset();
  }

  function hide() {
    active = false;
  }

  function input(name: DirKey | "space", shift: boolean) {
    if (!active || status !== "playing") return;
    const b = balls[0]!;
    if (b.hp <= 0) return;
    if (name === "space") applySpace(b);
    else applyDir(b, name, shift);
  }

  function update(dt: number) {
    if (!active) return;

    if (status === "ended" && Date.now() - endedAt > RESET_MS) reset();

    if (Date.now() >= hitstopUntil) {
      accum += dt;
      while (accum >= FIXED_DT) {
        if (status === "playing") {
          botTick(balls[1]!, balls[0]!, botState, FIXED_DT);
        }
        const hit = physicsStep(balls, FIXED_DT);
        if (hit) {
          playHitThud(hit.closing);
          if (hit.dmg > 0) {
            fx[hit.victim].flash = 1;
            fx[hit.attacker].punch = Math.max(
              fx[hit.attacker].punch,
              Math.min(1, hit.dmg / 12),
            );
            hitstopUntil = Date.now() + Math.min(20 + hit.dmg * 4, 120);
            addShake(Math.min(0.6, 0.12 + hit.dmg * 0.03));
          }
        }
        if (status === "playing") {
          const dead0 = balls[0]!.hp <= 0;
          const dead1 = balls[1]!.hp <= 0;
          if (dead0 || dead1) {
            status = "ended";
            winner = dead0 && dead1 ? 0 : dead0 ? 1 : 0;
            endedAt = Date.now();
            const loser: Slot = winner === 0 ? 1 : 0;
            burstBlood(balls[loser]!.x, balls[loser]!.y);
            playDeath();
            addShake(1);
            ballMeshes[loser].visible = false;
            arrows[loser].visible = false;
          }
        }
        accum -= FIXED_DT;
      }
    }

    for (let i = 0; i < 2; i++) {
      const b = balls[i]!;
      const mesh = ballMeshes[i];
      mesh.position.set(b.x, b.y, 0);
      const f = fx[i];
      if (f.flash > 0) f.flash = Math.max(0, f.flash - dt / FLASH_DECAY);
      if (f.punch > 0) f.punch = Math.max(0, f.punch - dt / PUNCH_DECAY);
      const base = b.charging ? P_CHARGE[i] : P_COLORS[i];
      const mat = ballMats[i];
      mat.color.setHex(base);
      mat.emissiveIntensity = f.flash * 3;
      mesh.scale.setScalar(1 + f.punch * PUNCH_MAX_SCALE);

      updateArrow(i, mesh.position, b.cx, b.cy, b.charging && mesh.visible);
      tickChargeSound(`off:${i}`, b.charging, b.cx, b.cy);
      tickWallSound(`off:${i}`, b.x, b.y, b.vx, b.vy);
    }

  }

  function getHps(): [number, number] {
    return [balls[0]!.hp, balls[1]!.hp];
  }

  function getStatus() {
    return {
      phase: status,
      winner,
      endedAt,
      resetMs: RESET_MS,
    };
  }

  return {
    show,
    hide,
    input,
    update,
    isActive: () => active,
    getHps,
    getStatus,
  };
}
