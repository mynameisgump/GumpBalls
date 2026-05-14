export const ROOM_W = 16
export const ROOM_H = 10
export const WALL_T = 0.5
export const BALL_R = 0.5

export const GRAVITY = -10
export const HORIZ_FRICTION = 3.5
export const CHARGE_STEP = 3.5
export const SHIFT_MULT = 2.5
export const BURST_SCALE = 0.55

export const FLOOR_Y = -ROOM_H / 2 + WALL_T / 2
export const CEIL_Y = ROOM_H / 2 - WALL_T / 2
export const LEFT_X = -ROOM_W / 2 + WALL_T / 2
export const RIGHT_X = ROOM_W / 2 - WALL_T / 2
export const BALL_MIN_Y = FLOOR_Y + WALL_T / 2 + BALL_R
export const BALL_MAX_Y = CEIL_Y - WALL_T / 2 - BALL_R
export const BALL_MIN_X = LEFT_X + WALL_T / 2 + BALL_R
export const BALL_MAX_X = RIGHT_X - WALL_T / 2 - BALL_R

export const TICK_HZ = 60
export const SNAP_HZ = 30
export const MAX_HP = 100
export const DMG_THRESHOLD = 3
export const DMG_K = 2.5
export const PORT = 7777

export type Slot = 0 | 1

export type BallSnap = {
  x: number
  y: number
  vx: number
  vy: number
  hp: number
  charging: boolean
  cx: number
  cy: number
}

export type ServerMsg =
  | { t: "slot"; n: Slot | -1 }
  | { t: "snap"; tick: number; balls: BallSnap[]; status: "waiting" | "playing" | "ended"; winner?: Slot }
  | { t: "end"; winner: Slot }

export type DirKey =
  | "left"
  | "right"
  | "up"
  | "down"
  | "a"
  | "d"
  | "w"
  | "s"
  | "q"
  | "e"
  | "z"
  | "c"

export type ClientMsg =
  | { t: "hello" }
  | { t: "dir"; name: DirKey; shift: boolean }
  | { t: "space" }
