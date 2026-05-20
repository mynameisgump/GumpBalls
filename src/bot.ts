import { applyDir, applySpace, type Ball, type DirKey } from "./shared";

export type BotState = {
  mode: "wander" | "charge";
  t: number;
  chargeDur: number;
  inputCd: number;
};

export function makeBotState(): BotState {
  return { mode: "wander", t: 0, chargeDur: 0, inputCd: 0 };
}

export function resetBotState(st: BotState) {
  st.mode = "wander";
  st.t = 0;
  st.chargeDur = 0;
  st.inputCd = 0;
}

function aimDir(dx: number, dy: number): DirKey {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const diag = ax > 0.4 * ay && ay > 0.4 * ax;
  if (diag) {
    if (dx >= 0 && dy >= 0) return "e";
    if (dx < 0 && dy >= 0) return "q";
    if (dx >= 0 && dy < 0) return "c";
    return "z";
  }
  if (ax > ay) return dx > 0 ? "d" : "a";
  return dy > 0 ? "w" : "s";
}

export function botTick(me: Ball, opp: Ball, st: BotState, dt: number) {
  if (me.hp <= 0) return;
  st.t += dt;
  st.inputCd -= dt;
  const dx = opp.x - me.x;
  const dy = opp.y - me.y;

  if (st.mode === "wander") {
    if (st.t > 0.5 + Math.random() * 0.8) {
      applySpace(me);
      st.mode = "charge";
      st.t = 0;
      st.chargeDur = 0.5 + Math.random() * 0.8;
      st.inputCd = 0.05;
      return;
    }
    if (st.inputCd <= 0) {
      const r = Math.random();
      if (r < 0.35) applyDir(me, "w", Math.random() < 0.5);
      else if (r < 0.5) {
        const diag: DirKey = dx > 0 ? "e" : "q";
        applyDir(me, diag, Math.random() < 0.5);
      } else if (Math.abs(dx) > 0.6) {
        applyDir(me, dx > 0 ? "d" : "a", false);
      }
      st.inputCd = 0.12 + Math.random() * 0.18;
    }
  } else {
    if (st.inputCd <= 0) {
      let dir: DirKey;
      if (Math.random() < 0.2) {
        const choices: DirKey[] = ["q", "w", "e", "a", "d", "z", "c"];
        dir = choices[Math.floor(Math.random() * choices.length)]!;
      } else {
        const jx = (Math.random() - 0.5) * 3;
        const jy = (Math.random() - 0.5) * 3 + 2.5;
        dir = aimDir(dx + jx, dy + jy);
      }
      applyDir(me, dir, Math.random() < 0.75);
      st.inputCd = 0.1 + Math.random() * 0.1;
    }
    if (st.t >= st.chargeDur) {
      applySpace(me);
      st.mode = "wander";
      st.t = 0;
      st.inputCd = 0.2;
    }
  }
}
