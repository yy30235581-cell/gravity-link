import { Vec2 } from './types';

export const vecAdd = (v1: Vec2, v2: Vec2): Vec2 => ({ x: v1.x + v2.x, y: v1.y + v2.y });
export const vecSub = (v1: Vec2, v2: Vec2): Vec2 => ({ x: v1.x - v2.x, y: v1.y - v2.y });
export const vecMul = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });
export const vecDist = (v1: Vec2, v2: Vec2): number =>
  Math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2);
export const vecMag = (v: Vec2): number => Math.sqrt(v.x ** 2 + v.y ** 2);
export const vecNorm = (v: Vec2): Vec2 => {
  const m = vecMag(v);
  return m === 0 ? { x: 0, y: 0 } : vecMul(v, 1 / m);
};
export const vecDot = (v1: Vec2, v2: Vec2): number => v1.x * v2.x + v1.y * v2.y;