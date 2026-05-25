export const GAME_WIDTH = 1024;
export const GAME_HEIGHT = 600;

export const INITIAL_ENERGY = 10;
export const ACTION_ENERGY_COST = 1;

export const GRAVITY = 0.4;
export const HOOK_SPEED = 15;
export const MAX_HOOK_DISTANCE = 620;
export const FRICTION = 0.99;
export const AIR_RESISTANCE = 0.995;

export const COLORS = {
  bg: '#050505',
  player: '#FFFFFF',
  hook: '#00FFFF',
  anchor: '#3a3a3a',
  anchorTimed: '#FF4E00',
  anchorActive: '#FFFFFF',
  hazard: '#FF4E00',
  laser: '#FF003C',
  portal: '#00FFFF',
  ufo: '#A8FFEF',
  platform: '#D8FFF7',
};

export const LEVEL_BREAKS = {
  L1_END: 3000,
  L2_START: 3000,
  L2_END: 7000,
  L3_START: 7000,
  L3_END: 12000,
  L4_START: 12000,
  WIN_AT: 20000,
};

export const MILESTONES: { distance: number; name: string }[] = [
  { distance: 0, name: '关卡 1 // 基础链路' },
  { distance: 3000, name: '关卡 2 // 激光封锁区' },
  { distance: 7000, name: '关卡 3 // 不稳定锚区' },
  { distance: 12000, name: '关卡 4 // 坍塌红柱区' },
  { distance: 20000, name: '终点 // 撤离平台' },
];
