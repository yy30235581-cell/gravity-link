export enum GameStatus {
  START = 'START',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAMEOVER = 'GAMEOVER',
  WIN = 'WIN',
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Particle {
  pos: Vec2;
  vel: Vec2;
  color: string;
  life: number;
  size?: number;
}

export interface Player {
  pos: Vec2;
  vel: Vec2;
  energy: number;
  health: number;
  invulnerableTimer: number;
  isHooked: boolean;
  hookPos: Vec2 | null;
  anchorId: string | null;
  ropeLength: number;
  jumpCount: number;
  trail: Vec2[];
  particles: Particle[];
  exploded: boolean;
}

export enum EntityType {
  ANCHOR = 'ANCHOR',
  TIMED_ANCHOR = 'TIMED_ANCHOR',
  HAZARD = 'HAZARD', // top / bottom red columns (level 1+)
  FALLING_HAZARD = 'FALLING_HAZARD', // level 4 falling red columns
  LASER = 'LASER', // level 2 laser beam
  PORTAL = 'PORTAL', // level 1 -> 2 transition gate
  WIN_PLATFORM = 'WIN_PLATFORM', // final extraction platform
  UFO = 'UFO', // final win UFO
}

export interface Entity {
  id: string;
  type: EntityType;
  pos: Vec2;
  width?: number;
  height?: number;
  radius?: number;
  timer?: number;
  maxTimer?: number;
  vel?: Vec2;
  isActive: boolean;
  // for laser warning -> active sequence
  warningTimer?: number;
  activeTimer?: number;
}
