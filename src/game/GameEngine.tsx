import React, { useEffect, useRef } from 'react';
import { GameStatus, Player, Entity, EntityType } from './types';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  GRAVITY,
  COLORS,
  INITIAL_ENERGY,
  AIR_RESISTANCE,
  MAX_HOOK_DISTANCE,
  LEVEL_BREAKS,
  MILESTONES,
} from './constants';
import { vecDist, vecNorm, vecSub, vecAdd, vecMul, vecMag, vecDot } from './vector';
import { soundManager } from './sounds';

interface GameEngineProps {
  status: GameStatus;
  onGameOver: (score: number) => void;
  onWin: (score: number) => void;
  onUpdateHUD: (energy: number, score: number, level: number, health: number) => void;
  onMilestone: (name: string) => void;
}

interface ParallaxLayer {
  src: string;
  speed: number;
  opacity: number;
  image: HTMLImageElement | null;
  loaded: boolean;
}

type Level = 1 | 2 | 3 | 4;

const TIMED_ANCHOR_LIFETIME_SCALE = 2 / 3;
const LEVEL_3_TIMED_ANCHOR_LIFETIME = 1.35 * TIMED_ANCHOR_LIFETIME_SCALE;
const LEVEL_4_TIMED_ANCHOR_LIFETIME = 1.8 * TIMED_ANCHOR_LIFETIME_SCALE;
const LASER_SCREEN_MARGIN = GAME_WIDTH * 0.5;
const LASER_FULL_SCREEN_WIDTH = GAME_WIDTH + LASER_SCREEN_MARGIN * 2;
const LASER_ROPE_TARGET_RATIO = 0.55;
const LASER_HIT_HALF_HEIGHT = 6;
const LASER_COOLDOWN_AFTER_CUT = 3.2;
const LEVEL_2_HAZARD_SPACING = 560;
const MAX_HEALTH_PER_LEVEL = 3;
const DAMAGE_INVULNERABLE_TIME = 1.15;

const PARALLAX_LAYER_DEFS = [
  { src: '/assets/picture/parallax-far.png?v=20260525-user-bg', speed: 0.06, opacity: 1 },
  { src: '/assets/picture/parallax-mid.png?v=20260525-user-bg', speed: 0.16, opacity: 1 },
  { src: '/assets/picture/parallax-front.png?v=20260525-user-bg', speed: 0.34, opacity: 1 },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getLaserTargetY = (player: Player) => {
  if (player.isHooked && player.hookPos) {
    return clamp(
      player.pos.y + (player.hookPos.y - player.pos.y) * LASER_ROPE_TARGET_RATIO,
      40,
      GAME_HEIGHT - 90,
    );
  }

  return GAME_HEIGHT / 2;
};

const doesLaserHitRope = (player: Player, laser: Entity) => {
  if (!player.isHooked || !player.hookPos) return false;

  const a = player.pos;
  const b = player.hookPos;
  const laserY = laser.pos.y;
  const x1 = laser.pos.x;
  const x2 = laser.pos.x + (laser.width || 0);
  const minY = Math.min(a.y, b.y) - LASER_HIT_HALF_HEIGHT;
  const maxY = Math.max(a.y, b.y) + LASER_HIT_HALF_HEIGHT;

  if (laserY < minY || laserY > maxY) return false;

  if (Math.abs(a.y - b.y) <= LASER_HIT_HALF_HEIGHT) {
    const ropeMinX = Math.min(a.x, b.x);
    const ropeMaxX = Math.max(a.x, b.x);
    return ropeMaxX >= x1 && ropeMinX <= x2;
  }

  const t = (laserY - a.y) / (b.y - a.y);
  if (t < 0 || t > 1) return false;

  const ix = a.x + t * (b.x - a.x);
  return ix >= x1 && ix <= x2;
};

const GameEngine: React.FC<GameEngineProps> = ({
  status,
  onGameOver,
  onWin,
  onUpdateHUD,
  onMilestone,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const hudUpdateRef = useRef({
    elapsed: 0,
    energy: -1,
    score: -1,
    level: -1,
    health: -1,
  });

  const playerRef = useRef<Player>({
    pos: { x: 100, y: 400 },
    vel: { x: 0, y: 0 },
    energy: INITIAL_ENERGY,
    health: MAX_HEALTH_PER_LEVEL,
    invulnerableTimer: 0,
    isHooked: false,
    hookPos: null,
    anchorId: null,
    ropeLength: 0,
    jumpCount: 0,
    trail: [],
    particles: [],
    exploded: false,
  });

  const entitiesRef = useRef<Entity[]>([]);
  const scoreRef = useRef(0);
  const cameraX = useRef(0);
  const shakeRef = useRef(0);
  const parallaxLayers = useRef<ParallaxLayer[]>(
    PARALLAX_LAYER_DEFS.map((layer) => ({ ...layer, image: null, loaded: false })),
  );
  const milestonesHitRef = useRef<Set<number>>(new Set());
  const statusRef = useRef<GameStatus>(status);
  const currentLevelRef = useRef<Level>(1);
  const releasePerfectRef = useRef<number>(0);
  const lastChunkXRef = useRef<{ [key: number]: number }>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const laserTimerRef = useRef<number>(0); // countdown to next laser spawn
  const fallingTimerRef = useRef<number>(0); // countdown to next falling column
  const portalSpawnedRef = useRef<boolean>(false);
  const extractionSpawnedRef = useRef<boolean>(false);
  const winTriggeredRef = useRef<boolean>(false);

  const clearEndTimer = () => {
    if (endTimerRef.current) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  };

  const setShake = (val: number) => {
    shakeRef.current = Math.max(shakeRef.current, val);
  };

  const emitMilestone = (distance: number) => {
    if (milestonesHitRef.current.has(distance)) return;
    const milestone = MILESTONES.find((m) => m.distance === distance);
    milestonesHitRef.current.add(distance);
    if (milestone) {
      onMilestone(milestone.name);
      if (distance > 0) soundManager.playMilestone();
    }
  };

  const enterLevel = (level: Level) => {
    if (currentLevelRef.current >= level) return;
    currentLevelRef.current = level;
    const p = playerRef.current;
    p.isHooked = false;
    p.hookPos = null;
    p.anchorId = null;
    p.jumpCount = 0;
    p.health = MAX_HEALTH_PER_LEVEL;
    p.invulnerableTimer = 0;
    entitiesRef.current = [];
    const start = Math.max(getLevelStart(level), Math.floor(scoreRef.current));
    const end = getLevelEnd(level);
    const chunkEnd = Math.min(start + 1800, end);
    if (start < chunkEnd) {
      entitiesRef.current = generateLevelChunks(start, chunkEnd, level);
      lastChunkXRef.current[level] = chunkEnd;
    }
    if (level === 2) emitMilestone(LEVEL_BREAKS.L2_START);
    if (level === 3) emitMilestone(LEVEL_BREAKS.L3_START);
    if (level === 4) emitMilestone(LEVEL_BREAKS.L4_START);
    laserTimerRef.current = level === 2 ? 1.2 : laserTimerRef.current;
    fallingTimerRef.current = level === 4 ? 1.0 : fallingTimerRef.current;
  };

  const syncLevelToScore = () => {
    if (scoreRef.current >= LEVEL_BREAKS.L2_START) enterLevel(2);
    if (scoreRef.current >= LEVEL_BREAKS.L3_START) enterLevel(3);
    if (scoreRef.current >= LEVEL_BREAKS.L4_START) enterLevel(4);
  };

  // Level 1 teaches the basic loop: hook, release, bounce, hook again.
  const generateLevel1 = (start: number, end: number): Entity[] => {
    const out: Entity[] = [];
    for (let x = start; x < end; x += 240) {
      out.push({
        id: `a1-${x}-${Math.random().toString(36).slice(2, 7)}`,
        type: EntityType.ANCHOR,
        pos: { x: x + 110 + Math.random() * 45, y: 105 + Math.random() * 115 },
        radius: 12,
        isActive: true,
      });
    }
    return [...out, ...generateBoundaryHazards(start, end, 1)];
  };

  const generateBoundaryHazards = (start: number, end: number, level: 1 | 2 | 3 | 4): Entity[] => {
    const out: Entity[] = [];
    const offset = level === 1 ? 520 : level === 2 ? 260 : level === 3 ? 180 : 130;
    const spacing = level === 1 ? 680 : level === 2 ? LEVEL_2_HAZARD_SPACING : level === 3 ? 500 : 460;

    for (let x = start + offset; x < end; x += spacing) {
      const width = 42 + Math.random() * 22;
      const topHeight = (level === 1 ? 70 : 88) + Math.random() * (level === 1 ? 62 : 82);
      const bottomHeight = (level === 1 ? 86 : 110) + Math.random() * (level === 1 ? 74 : 96);
      const pillarX = x + Math.random() * 110;

      out.push({
        id: `h${level}-top-${x}-${Math.random().toString(36).slice(2, 7)}`,
        type: EntityType.HAZARD,
        pos: { x: pillarX, y: 0 },
        width,
        height: topHeight,
        isActive: true,
      });
      out.push({
        id: `h${level}-bottom-${x}-${Math.random().toString(36).slice(2, 7)}`,
        type: EntityType.HAZARD,
        pos: { x: pillarX + 95 + Math.random() * 80, y: GAME_HEIGHT - bottomHeight },
        width: width + Math.random() * 14,
        height: bottomHeight,
        isActive: true,
      });
    }

    return out;
  };

  // Level 2 adds front-facing lasers and upper/lower hazard pillars.
  const generateLevel2 = (start: number, end: number): Entity[] => {
    const out: Entity[] = [];
    for (let x = start; x < end; x += 245) {
      out.push({
        id: `a2-${x}-${Math.random().toString(36).slice(2, 7)}`,
        type: EntityType.ANCHOR,
        pos: { x: x + 95 + Math.random() * 80, y: 85 + Math.random() * 190 },
        radius: 11,
        isActive: true,
      });
    }
    return [...out, ...generateBoundaryHazards(start, end, 2)];
  };

  // Level 3 uses fast disappearing anchors with countdown rings.
  const generateLevel3 = (start: number, end: number): Entity[] => {
    const out: Entity[] = [];
    for (let x = start; x < end; x += 230) {
      const t = LEVEL_3_TIMED_ANCHOR_LIFETIME;
      out.push({
        id: `a3-${x}-${Math.random().toString(36).slice(2, 7)}`,
        type: EntityType.TIMED_ANCHOR,
        pos: { x: x + 90 + Math.random() * 75, y: 80 + Math.random() * 220 },
        radius: 11,
        isActive: true,
        timer: t,
        maxTimer: t,
      });
    }
    return [...out, ...generateBoundaryHazards(start, end, 3)];
  };

  // Level 4 keeps the swing path moving while red columns collapse from above.
  const generateLevel4 = (start: number, end: number): Entity[] => {
    const out: Entity[] = [];
    for (let x = start; x < end; x += 225) {
      const useTimed = Math.random() > 0.4;
      if (useTimed) {
        out.push({
          id: `a4-${x}-${Math.random().toString(36).slice(2, 7)}`,
          type: EntityType.TIMED_ANCHOR,
          pos: { x: x + 85 + Math.random() * 85, y: 80 + Math.random() * 205 },
          radius: 11,
          isActive: true,
          timer: LEVEL_4_TIMED_ANCHOR_LIFETIME,
          maxTimer: LEVEL_4_TIMED_ANCHOR_LIFETIME,
        });
      } else {
        out.push({
          id: `a4-${x}-${Math.random().toString(36).slice(2, 7)}`,
          type: EntityType.ANCHOR,
          pos: { x: x + 85 + Math.random() * 85, y: 80 + Math.random() * 205 },
          radius: 11,
          isActive: true,
        });
      }
    }
    return [...out, ...generateBoundaryHazards(start, end, 4)];
  };

  const generateLevelChunks = (start: number, end: number, level: number): Entity[] => {
    if (level === 1) return generateLevel1(start, end);
    if (level === 2) return generateLevel2(start, end);
    if (level === 3) return generateLevel3(start, end);
    return generateLevel4(start, end);
  };

  const initGame = () => {
    playerRef.current = {
      pos: { x: 200, y: 300 },
      vel: { x: 5, y: 0 },
      energy: INITIAL_ENERGY,
      health: MAX_HEALTH_PER_LEVEL,
      invulnerableTimer: 0,
      isHooked: false,
      hookPos: null,
      anchorId: null,
      ropeLength: 0,
      jumpCount: 0,
      trail: [],
      particles: [],
      exploded: false,
    };
    scoreRef.current = 0;
    cameraX.current = 0;
    milestonesHitRef.current.clear();
    currentLevelRef.current = 1;
    releasePerfectRef.current = 0;
    laserTimerRef.current = 3;
    fallingTimerRef.current = 2;
    portalSpawnedRef.current = false;
    extractionSpawnedRef.current = false;
    winTriggeredRef.current = false;
    hudUpdateRef.current = { elapsed: 0, energy: -1, score: -1, level: -1, health: -1 };
    clearEndTimer();
    lastChunkXRef.current = { 1: 0, 2: 0, 3: 0, 4: 0 };

    // Pre-generate L1
    const l1 = generateLevel1(0, LEVEL_BREAKS.L1_END);
    lastChunkXRef.current[1] = LEVEL_BREAKS.L1_END;
    entitiesRef.current = l1;

    // Trigger first milestone
    emitMilestone(0);

  };

  const explodePlayer = (color: string = '#FF0000') => {
    const p = playerRef.current;
    if (p.exploded) return;
    soundManager.playExplosion();
    setShake(30);
    p.particles = [];
    for (let i = 0; i < 28; i++) {
      p.particles.push({
        pos: { ...p.pos },
        vel: { x: (Math.random() - 0.5) * 18, y: (Math.random() - 0.5) * 18 },
        color: i % 2 === 0 ? color : '#FFA500',
        life: 1.0,
        size: 5,
      });
    }
    p.exploded = true;
    clearEndTimer();
    endTimerRef.current = window.setTimeout(() => onGameOver(scoreRef.current), 800);
  };

  const damagePlayer = (color: string = '#FF4E00', recoverPosition: boolean = false) => {
    const p = playerRef.current;
    if (p.exploded || p.invulnerableTimer > 0 || winTriggeredRef.current) return;

    if (p.health <= 1) {
      explodePlayer(color);
      return;
    }

    p.health -= 1;
    p.invulnerableTimer = DAMAGE_INVULNERABLE_TIME;
    p.isHooked = false;
    p.hookPos = null;
    p.anchorId = null;
    p.jumpCount = 0;
    if (recoverPosition) {
      p.pos = {
        x: Math.max(p.pos.x, cameraX.current + 220),
        y: GAME_HEIGHT * 0.45,
      };
    }
    p.vel.x = Math.max(p.vel.x, 7);
    p.vel.y = -7;
    soundManager.playExplosion();
    setShake(16);
    for (let i = 0; i < 14; i++) {
      p.particles.push({
        pos: { ...p.pos },
        vel: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 },
        color: i % 2 === 0 ? color : '#00FFFF',
        life: 0.75,
        size: 3,
      });
    }
  };

  const triggerWin = () => {
    if (winTriggeredRef.current) return;
    winTriggeredRef.current = true;
    soundManager.playMilestone();
    setShake(8);
    clearEndTimer();
    endTimerRef.current = window.setTimeout(() => onWin(scoreRef.current), 1500);
  };

  const update = (dt: number) => {
    const frameScale = dt * 60;
    if (statusRef.current !== GameStatus.PLAYING) return;
    const p = playerRef.current;

    if (releasePerfectRef.current > 0) {
      releasePerfectRef.current = Math.max(0, releasePerfectRef.current - dt);
    }

    if (p.invulnerableTimer > 0) {
      p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);
    }

    if (p.exploded) {
      p.particles.forEach((part) => {
        part.pos = vecAdd(part.pos, vecMul(part.vel, frameScale));
        part.vel.y += 0.2 * frameScale;
        part.life -= 0.02 * frameScale;
      });
      p.particles = p.particles.filter((part) => part.life > 0);
      if (shakeRef.current > 0) shakeRef.current = Math.max(0, shakeRef.current - 1.2 * frameScale);
      return;
    }

    // Win sequence: UFO abducts player
    if (winTriggeredRef.current) {
      const ufo = entitiesRef.current.find((e) => e.type === EntityType.UFO);
      if (ufo) {
        // Player is pulled into a narrow vertical tractor beam.
        p.vel.x *= Math.pow(0.9, frameScale);
        p.vel.y = -4.2;
        p.pos.x += (ufo.pos.x - p.pos.x) * 0.08 * frameScale;
        p.pos.y += p.vel.y * frameScale;
        // Particles emanating
        if (Math.random() > 0.5) {
          p.particles.push({
            pos: { ...p.pos },
            vel: { x: (Math.random() - 0.5) * 2, y: -2 - Math.random() * 2 },
            color: '#A8FFEF',
            life: 1.0,
            size: 3,
          });
        }
      }
      p.particles.forEach((part) => {
        part.pos = vecAdd(part.pos, vecMul(part.vel, frameScale));
        part.life -= 0.02 * frameScale;
      });
      p.particles = p.particles.filter((part) => part.life > 0);
      cameraX.current = p.pos.x - 200;
      return;
    }

    p.vel.y += GRAVITY * frameScale;
    p.vel.x *= Math.pow(AIR_RESISTANCE, frameScale);
    p.vel.y *= Math.pow(AIR_RESISTANCE, frameScale);

    if (p.isHooked && p.hookPos) {
      const toHook = vecSub(p.hookPos, p.pos);
      const dist = vecMag(toHook);
      const anchor = entitiesRef.current.find((e) => e.id === p.anchorId);

      if (dist > p.ropeLength) {
        const norm = vecNorm(toHook);
        const over = dist - p.ropeLength;
        p.pos = vecAdd(p.pos, vecMul(norm, over));
        const velDotNorm = vecDot(p.vel, norm);
        p.vel = vecSub(p.vel, vecMul(norm, velDotNorm));
        p.vel = vecAdd(p.vel, vecMul(norm, 0.1 * frameScale));
      }

      // Timed anchor countdown (level 3+)
      if (anchor && anchor.type === EntityType.TIMED_ANCHOR && anchor.timer !== undefined) {
        anchor.timer -= dt;
        if (anchor.timer <= 0) {
          p.isHooked = false;
          p.hookPos = null;
          p.anchorId = null;
          anchor.isActive = false;
        }
      }

      if (anchor && !anchor.isActive) {
        p.isHooked = false;
        p.hookPos = null;
        p.anchorId = null;
      }
    }

    p.pos = vecAdd(p.pos, vecMul(p.vel, frameScale));
    p.trail.push({ ...p.pos });
    if (p.trail.length > 24) p.trail.shift();

    p.particles.forEach((part) => {
      part.pos = vecAdd(part.pos, vecMul(part.vel, frameScale));
      part.vel.y += 0.2 * frameScale;
      part.life -= 0.02 * frameScale;
    });
    p.particles = p.particles.filter((part) => part.life > 0);

    cameraX.current = p.pos.x - 200;
    scoreRef.current = Math.max(scoreRef.current, Math.floor(p.pos.x));

    syncLevelToScore();

    const currentLevel = currentLevelRef.current;
    if (currentLevelRef.current === 4 && scoreRef.current >= LEVEL_BREAKS.WIN_AT) {
      emitMilestone(LEVEL_BREAKS.WIN_AT);
    }

    // Spawn the level-1 portal as a visual cue before the hard 3000 transition.
    if (
      currentLevel === 1 &&
      !portalSpawnedRef.current &&
      scoreRef.current >= LEVEL_BREAKS.L1_END - 220
    ) {
      portalSpawnedRef.current = true;
      entitiesRef.current.push({
        id: `portal-${Date.now()}`,
        type: EntityType.PORTAL,
        pos: { x: LEVEL_BREAKS.L1_END + 50, y: 280 },
        radius: 60,
        isActive: true,
      });
    }

    // Spawn the final extraction platform and UFO after the 20000 sector mark.
    if (
      currentLevel === 4 &&
      !extractionSpawnedRef.current &&
      scoreRef.current >= LEVEL_BREAKS.WIN_AT
    ) {
      extractionSpawnedRef.current = true;
      entitiesRef.current.push({
        id: `platform-${Date.now()}`,
        type: EntityType.WIN_PLATFORM,
        pos: { x: LEVEL_BREAKS.WIN_AT + 240, y: GAME_HEIGHT - 72 },
        width: 260,
        height: 22,
        isActive: true,
      });
      entitiesRef.current.push({
        id: `ufo-${Date.now()}`,
        type: EntityType.UFO,
        pos: { x: LEVEL_BREAKS.WIN_AT + 370, y: 140 },
        radius: 80,
        isActive: true,
      });
    }

    // Generate next chunks per level
    const generateNeeded = (level: 1 | 2 | 3 | 4, until: number) => {
      const last = lastChunkXRef.current[level] || 0;
      if (p.pos.x + 1500 > last && last < until) {
        const start = Math.max(last, getLevelStart(level));
        const chunkEnd = Math.min(start + 1500, until);
        const newOnes = generateLevelChunks(start, chunkEnd, level);
        entitiesRef.current = [...entitiesRef.current, ...newOnes];
        lastChunkXRef.current[level] = chunkEnd;
      }
    };

    if (currentLevel === 1) generateNeeded(1, LEVEL_BREAKS.L1_END);
    if (currentLevel === 2) generateNeeded(2, LEVEL_BREAKS.L2_END);
    if (currentLevel === 3) generateNeeded(3, LEVEL_BREAKS.L3_END);
    if (currentLevel === 4) generateNeeded(4, LEVEL_BREAKS.WIN_AT);

    // Cleanup faraway entities
    entitiesRef.current = entitiesRef.current.filter((e) => e.pos.x > p.pos.x - 1000);

    // Level 2: lasers track the player's active rope line.
    if (currentLevel === 2) {
      const hasActiveLaser = entitiesRef.current.some(
        (e) => e.type === EntityType.LASER && e.isActive,
      );
      laserTimerRef.current -= dt;
      if (laserTimerRef.current <= 0 && p.isHooked && p.hookPos && !hasActiveLaser) {
        laserTimerRef.current = 2.5 + Math.random() * 2;
        entitiesRef.current.push({
          id: `laser-${Date.now()}-${Math.random()}`,
          type: EntityType.LASER,
          pos: {
            x: cameraX.current - LASER_SCREEN_MARGIN,
            y: getLaserTargetY(p),
          },
          width: LASER_FULL_SCREEN_WIDTH,
          height: 4,
          isActive: true,
          warningTimer: 1.0, // 1s warning
          activeTimer: 0.5, // 0.5s lethal
          timer: 0,
        });
      }
    }

    // Level 4: random falling column
    if (currentLevel === 4) {
      fallingTimerRef.current -= dt;
      if (fallingTimerRef.current <= 0) {
        fallingTimerRef.current = 1.0 + Math.random() * 1.2;
        entitiesRef.current.push({
          id: `fall-${Date.now()}-${Math.random()}`,
          type: EntityType.FALLING_HAZARD,
          pos: { x: p.pos.x + 200 + Math.random() * 400, y: -120 },
          width: 32 + Math.random() * 24,
          height: 100,
          vel: { x: 0, y: 0 },
          isActive: true,
          warningTimer: 0.6,
        });
      }
    }

    // Update lasers
    entitiesRef.current.forEach((e) => {
      if (e.type === EntityType.LASER && e.isActive) {
        e.pos.x = cameraX.current - LASER_SCREEN_MARGIN;
        e.width = LASER_FULL_SCREEN_WIDTH;

        if ((e.warningTimer || 0) > 0) {
          if (p.isHooked && p.hookPos) {
            e.pos.y = getLaserTargetY(p);
          }
          e.warningTimer = (e.warningTimer || 0) - dt;
        } else if ((e.activeTimer || 0) > 0) {
          if (e.timer !== 1) {
            soundManager.playLaser();
            e.timer = 1;
          }
          e.activeTimer = (e.activeTimer || 0) - dt;
          // If laser intersects rope -> cut rope
          if (doesLaserHitRope(p, e)) {
            // Cut rope
            p.isHooked = false;
            p.hookPos = null;
            p.anchorId = null;
            p.jumpCount = 0; // reset, give 3 fresh emergency jumps
            soundManager.playExplosion();
            setShake(10);
            e.isActive = false;
            laserTimerRef.current = LASER_COOLDOWN_AFTER_CUT + Math.random() * 0.8;
          }
        } else {
          e.isActive = false;
        }
      }

      // Falling hazard
      if (e.type === EntityType.FALLING_HAZARD && e.isActive) {
        if ((e.warningTimer || 0) > 0) {
          e.warningTimer = (e.warningTimer || 0) - dt;
        } else {
          // Start falling
          if (e.vel) {
            e.vel.y += 0.6 * frameScale;
            e.pos.y += e.vel.y * frameScale;
          }
          if (e.pos.y > GAME_HEIGHT + 50) {
            e.isActive = false;
          }
        }
      }
    });

    // Collisions
    for (const e of entitiesRef.current) {
      if (!e.isActive) continue;

      if (e.type === EntityType.HAZARD || e.type === EntityType.FALLING_HAZARD) {
        // Skip falling that is still in warning phase
        if (e.type === EntityType.FALLING_HAZARD && (e.warningTimer || 0) > 0) continue;
        const rectX = e.pos.x;
        const rectY = e.pos.y;
        if (
          p.invulnerableTimer <= 0 &&
          p.pos.x + 8 > rectX &&
          p.pos.x - 8 < rectX + (e.width || 0) &&
          p.pos.y + 8 > rectY &&
          p.pos.y - 8 < rectY + (e.height || 0)
        ) {
          damagePlayer('#FF4E00');
          return;
        }
      } else if (e.type === EntityType.PORTAL) {
        // Entering the portal cleanly moves the run into level 2.
        if (vecDist(p.pos, e.pos) < (e.radius || 60)) {
          if (e.isActive) {
            e.isActive = false;
            enterLevel(2);
            p.isHooked = false;
            p.hookPos = null;
            p.anchorId = null;
            p.pos.x = Math.max(p.pos.x, LEVEL_BREAKS.L2_START + 80);
            p.vel.x = Math.max(p.vel.x, 9);
            scoreRef.current = Math.max(scoreRef.current, LEVEL_BREAKS.L2_START);
            for (let i = 0; i < 16; i++) {
              p.particles.push({
                pos: { ...p.pos },
                vel: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8 },
                color: '#00FFFF',
                life: 1.0,
                size: 3,
              });
            }
            soundManager.playCore();
          }
        }
      } else if (e.type === EntityType.WIN_PLATFORM) {
        const onPlatform =
          p.pos.x + 8 > e.pos.x &&
          p.pos.x - 8 < e.pos.x + (e.width || 0) &&
          p.pos.y + 8 > e.pos.y &&
          p.pos.y - 8 < e.pos.y + (e.height || 0);
        if (onPlatform) {
          p.pos.y = e.pos.y - 9;
          p.vel.x *= 0.82;
          p.vel.y = -1.5;
          triggerWin();
        }
      } else if (e.type === EntityType.UFO) {
        if (vecDist(p.pos, e.pos) < 90) {
          triggerWin();
        }
      }
    }

    if (p.pos.y > GAME_HEIGHT + 80 || p.pos.y < -300) {
      if (p.invulnerableTimer <= 0) {
        damagePlayer('#FF4E00', true);
      } else {
        p.pos.y = GAME_HEIGHT * 0.45;
        p.vel.y = -5;
      }
      return;
    }

    hudUpdateRef.current.elapsed += dt;
    const shouldUpdateHud =
      hudUpdateRef.current.elapsed >= 0.1 ||
      hudUpdateRef.current.energy !== p.energy ||
      hudUpdateRef.current.health !== p.health ||
      hudUpdateRef.current.level !== currentLevel ||
      Math.floor(hudUpdateRef.current.score / 10) !== Math.floor(scoreRef.current / 10);
    if (shouldUpdateHud) {
      hudUpdateRef.current = {
        elapsed: 0,
        energy: p.energy,
        score: scoreRef.current,
        level: currentLevel,
        health: p.health,
      };
      onUpdateHUD(p.energy, scoreRef.current, currentLevel, p.health);
    }

    if (shakeRef.current > 0) shakeRef.current = Math.max(0, shakeRef.current - 1.2 * frameScale);

    if (canvasRef.current) {
      canvasRef.current.style.transform = `translate(${
        (Math.random() - 0.5) * shakeRef.current * 2
      }px, ${(Math.random() - 0.5) * shakeRef.current * 2}px)`;
    }
  };

  const getLevelStart = (level: 1 | 2 | 3 | 4): number => {
    if (level === 1) return 0;
    if (level === 2) return LEVEL_BREAKS.L2_START;
    if (level === 3) return LEVEL_BREAKS.L3_START;
    return LEVEL_BREAKS.L4_START;
  };

  const getLevelEnd = (level: 1 | 2 | 3 | 4): number => {
    if (level === 1) return LEVEL_BREAKS.L1_END;
    if (level === 2) return LEVEL_BREAKS.L2_END;
    if (level === 3) return LEVEL_BREAKS.L3_END;
    return LEVEL_BREAKS.WIN_AT;
  };

  const drawFallbackSkyline = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#06131d';
    for (let x = 0; x < GAME_WIDTH; x += 90) {
      const h = 150 + ((x * 37) % 220);
      ctx.fillRect(x, GAME_HEIGHT - h, 62, h);
      ctx.fillStyle = 'rgba(64, 220, 255, 0.16)';
      ctx.fillRect(x + 18, GAME_HEIGHT - h + 32, 4, h * 0.42);
      ctx.fillStyle = '#06131d';
    }
  };

  const drawParallaxLayer = (ctx: CanvasRenderingContext2D, layer: ParallaxLayer) => {
    const image = layer.image;
    if (!image || !layer.loaded || image.naturalWidth === 0) return;

    const tileWidth = (image.naturalWidth / image.naturalHeight) * GAME_HEIGHT;
    const offsetX = -(((cameraX.current * layer.speed) % tileWidth) + tileWidth) % tileWidth;

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    for (let x = offsetX - tileWidth; x < GAME_WIDTH + tileWidth; x += tileWidth) {
      ctx.drawImage(image, x, 0, tileWidth, GAME_HEIGHT);
    }
    ctx.restore();
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const grad = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    grad.addColorStop(0, '#13283d');
    grad.addColorStop(0.45, '#0b253e');
    grad.addColorStop(1, '#02070d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const haze = ctx.createRadialGradient(
      GAME_WIDTH / 2,
      GAME_HEIGHT * 0.56,
      0,
      GAME_WIDTH / 2,
      GAME_HEIGHT * 0.56,
      GAME_WIDTH * 0.72,
    );
    haze.addColorStop(0, 'rgba(80, 160, 230, 0.22)');
    haze.addColorStop(0.5, 'rgba(48, 106, 170, 0.12)');
    haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (parallaxLayers.current.some((layer) => layer.loaded)) {
      parallaxLayers.current.forEach((layer) => drawParallaxLayer(ctx, layer));
    } else {
      drawFallbackSkyline(ctx);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = -cameraX.current % 40; x < GAME_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, GAME_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < GAME_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(GAME_WIDTH, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(-cameraX.current, 0);

    entitiesRef.current.forEach((e) => {
      if (!e.isActive) return;

      if (e.type === EntityType.ANCHOR) {
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.radius || 10, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.anchor;
        ctx.fill();
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (e.type === EntityType.TIMED_ANCHOR) {
        const ratio = (e.timer || 0) / (e.maxTimer || 1);
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.radius || 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 78, 0, ${0.3 + ratio * 0.6})`;
        ctx.fill();
        ctx.strokeStyle = COLORS.anchorTimed;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Countdown ring
        if (ratio < 1) {
          ctx.beginPath();
          ctx.arc(
            e.pos.x,
            e.pos.y,
            (e.radius || 10) + 8,
            -Math.PI / 2,
            -Math.PI / 2 + ratio * Math.PI * 2,
          );
          ctx.strokeStyle = '#FF4E00';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      } else if (e.type === EntityType.HAZARD) {
        ctx.fillStyle = COLORS.hazard;
        ctx.fillRect(e.pos.x, e.pos.y, e.width || 0, e.height || 0);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 2;
        for (let sx = 0; sx < (e.width || 0); sx += 12) {
          ctx.beginPath();
          ctx.moveTo(e.pos.x + sx, e.pos.y);
          ctx.lineTo(e.pos.x + sx + 12, e.pos.y + (e.height || 0));
          ctx.stroke();
        }
        // Glow rim
        ctx.shadowBlur = 15;
        ctx.shadowColor = COLORS.hazard;
        ctx.strokeStyle = '#FF8800';
        ctx.lineWidth = 1;
        ctx.strokeRect(e.pos.x, e.pos.y, e.width || 0, e.height || 0);
        ctx.shadowBlur = 0;
      } else if (e.type === EntityType.FALLING_HAZARD) {
        if ((e.warningTimer || 0) > 0) {
          // Warning marker (red flash at top)
          const flash = 0.4 + Math.sin(Date.now() / 60) * 0.4;
          ctx.fillStyle = `rgba(255, 0, 60, ${flash})`;
          ctx.fillRect(e.pos.x, 0, e.width || 0, 8);
          ctx.fillStyle = `rgba(255, 0, 60, ${flash * 0.5})`;
          ctx.fillRect(e.pos.x - 3, 0, (e.width || 0) + 6, 28);
          // Dashed warning column
          ctx.strokeStyle = `rgba(255, 0, 60, ${flash})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.strokeRect(e.pos.x, 0, e.width || 0, 80);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = COLORS.hazard;
          ctx.fillRect(e.pos.x, e.pos.y, e.width || 0, e.height || 0);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.lineWidth = 2;
          for (let sx = 0; sx < (e.width || 0); sx += 12) {
            ctx.beginPath();
            ctx.moveTo(e.pos.x + sx, e.pos.y);
            ctx.lineTo(e.pos.x + sx + 12, e.pos.y + (e.height || 0));
            ctx.stroke();
          }
          ctx.shadowBlur = 18;
          ctx.shadowColor = COLORS.hazard;
          ctx.strokeStyle = '#FFAA00';
          ctx.lineWidth = 1;
          ctx.strokeRect(e.pos.x, e.pos.y, e.width || 0, e.height || 0);
          ctx.shadowBlur = 0;
        }
      } else if (e.type === EntityType.LASER) {
        if ((e.warningTimer || 0) > 0) {
          // Dashed warning line
          const flash = 0.5 + Math.sin(Date.now() / 60) * 0.4;
          ctx.strokeStyle = `rgba(255, 0, 60, ${flash})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 8]);
          ctx.beginPath();
          ctx.moveTo(e.pos.x, e.pos.y);
          ctx.lineTo(e.pos.x + (e.width || 0), e.pos.y);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if ((e.activeTimer || 0) > 0) {
          // Solid lethal beam
          ctx.shadowBlur = 25;
          ctx.shadowColor = COLORS.laser;
          ctx.fillStyle = COLORS.laser;
          ctx.fillRect(e.pos.x, e.pos.y - 3, e.width || 0, 6);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(e.pos.x, e.pos.y - 1, e.width || 0, 2);
          ctx.shadowBlur = 0;
        }
      } else if (e.type === EntityType.PORTAL) {
        // Portal: cyan glowing ring with pulsing hole
        const pulse = 0.5 + Math.sin(Date.now() / 250) * 0.5;
        ctx.shadowBlur = 30;
        ctx.shadowColor = COLORS.portal;
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, (e.radius || 60) + pulse * 6, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.portal;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Inner dark hole
        const holeGrad = ctx.createRadialGradient(
          e.pos.x,
          e.pos.y,
          0,
          e.pos.x,
          e.pos.y,
          e.radius || 60,
        );
        holeGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
        holeGrad.addColorStop(0.6, 'rgba(0, 50, 80, 0.7)');
        holeGrad.addColorStop(1, 'rgba(0, 255, 255, 0.2)');
        ctx.fillStyle = holeGrad;
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, (e.radius || 60) - 2, 0, Math.PI * 2);
        ctx.fill();
        // Label
        ctx.fillStyle = '#00FFFF';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('PORTAL', e.pos.x, e.pos.y - (e.radius || 60) - 12);
        ctx.textAlign = 'start';
      } else if (e.type === EntityType.WIN_PLATFORM) {
        const w = e.width || 260;
        const h = e.height || 22;
        ctx.save();
        ctx.shadowBlur = 24;
        ctx.shadowColor = COLORS.platform;
        ctx.fillStyle = 'rgba(216, 255, 247, 0.18)';
        ctx.fillRect(e.pos.x, e.pos.y - 22, w, 22);
        ctx.fillStyle = COLORS.platform;
        ctx.fillRect(e.pos.x, e.pos.y, w, h);
        ctx.fillStyle = '#050505';
        for (let sx = 12; sx < w; sx += 34) {
          ctx.fillRect(e.pos.x + sx, e.pos.y + 5, 16, 3);
        }
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(e.pos.x, e.pos.y, w, h);
        ctx.fillStyle = '#A8FFEF';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('EXTRACTION PLATFORM', e.pos.x + w / 2, e.pos.y - 30);
        ctx.restore();
      } else if (e.type === EntityType.UFO) {
        // UFO: saucer shape with a narrow vertical tractor beam
        ctx.save();
        const beamGrad = ctx.createLinearGradient(e.pos.x, e.pos.y, e.pos.x, GAME_HEIGHT);
        beamGrad.addColorStop(0, 'rgba(210, 245, 255, 0.9)');
        beamGrad.addColorStop(0.45, 'rgba(90, 190, 255, 0.48)');
        beamGrad.addColorStop(1, 'rgba(90, 190, 255, 0)');
        ctx.shadowBlur = 34;
        ctx.shadowColor = '#8FDFFF';
        ctx.fillStyle = beamGrad;
        ctx.fillRect(e.pos.x - 9, e.pos.y + 12, 18, GAME_HEIGHT - e.pos.y);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(e.pos.x - 2, e.pos.y + 12, 4, GAME_HEIGHT - e.pos.y);
        ctx.strokeStyle = 'rgba(168,255,239,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.pos.x - 26, e.pos.y + 18);
        ctx.lineTo(e.pos.x - 26, GAME_HEIGHT);
        ctx.moveTo(e.pos.x + 26, e.pos.y + 18);
        ctx.lineTo(e.pos.x + 26, GAME_HEIGHT);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Saucer body
        ctx.shadowBlur = 25;
        ctx.shadowColor = COLORS.ufo;
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.ellipse(e.pos.x, e.pos.y, 70, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.ufo;
        ctx.beginPath();
        ctx.ellipse(e.pos.x, e.pos.y - 10, 35, 18, 0, 0, Math.PI);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Lights
        for (let i = -2; i <= 2; i++) {
          const blink = (Math.sin(Date.now() / 200 + i) + 1) * 0.5;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + blink * 0.7})`;
          ctx.beginPath();
          ctx.arc(e.pos.x + i * 22, e.pos.y + 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    });
    ctx.shadowBlur = 0;

    const p = playerRef.current;

    if (p.isHooked && p.hookPos) {
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.lineTo(p.hookPos.x, p.hookPos.y);
      ctx.strokeStyle = COLORS.hook;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (p.trail.length > 1) {
      for (let i = 1; i < p.trail.length; i++) {
        const alpha = (i / p.trail.length) * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.strokeStyle = `rgba(0, 255, 255, ${alpha})`;
        ctx.lineWidth = (i / p.trail.length) * 5 + 1;
        ctx.stroke();
      }
    }

    p.particles.forEach((part) => {
      ctx.fillStyle = part.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, part.life));
      const sz = part.size || 4;
      ctx.fillRect(part.pos.x - sz / 2, part.pos.y - sz / 2, sz, sz);
    });
    ctx.globalAlpha = 1;

    if (!p.exploded) {
      let playerColor = COLORS.player;
      if (p.jumpCount === 1) playerColor = '#FFFF00';
      if (p.jumpCount === 2) playerColor = '#FFA500';
      if (p.jumpCount === 3) playerColor = '#FF0000';
      const invulnerablePulse =
        p.invulnerableTimer > 0 ? 0.45 + Math.sin(Date.now() / 45) * 0.28 : 1;
      ctx.globalAlpha = invulnerablePulse;

      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = playerColor;
      ctx.shadowBlur = 15;
      ctx.shadowColor = playerColor;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      if (p.jumpCount > 0 && !p.isHooked) {
        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = playerColor;
        ctx.textAlign = 'center';
        ctx.fillText(`${p.jumpCount}/3`, p.pos.x, p.pos.y - 16);
        ctx.textAlign = 'start';
      }

      if (releasePerfectRef.current > 0) {
        const r = (1 - releasePerfectRef.current / 0.4) * 40;
        ctx.beginPath();
        ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 255, ${releasePerfectRef.current / 0.4})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore();

    if (!p.exploded && p.jumpCount >= 3 && !p.isHooked) {
      const intensity = 0.4 + Math.sin(Date.now() / 80) * 0.25;
      const vignette = ctx.createRadialGradient(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        GAME_WIDTH * 0.25,
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        GAME_WIDTH * 0.6,
      );
      vignette.addColorStop(0, 'rgba(255, 0, 0, 0)');
      vignette.addColorStop(1, `rgba(255, 0, 0, ${intensity})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
  };

  const gameLoop = (timestamp: number) => {
    const previousTimestamp = lastFrameTimeRef.current ?? timestamp;
    const dt = Math.min((timestamp - previousTimestamp) / 1000, 0.05);
    lastFrameTimeRef.current = timestamp;
    update(dt);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) draw(ctx);
    }
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const handleJump = () => {
    if (statusRef.current !== GameStatus.PLAYING) return;
    const p = playerRef.current;
    if (p.exploded || winTriggeredRef.current) return;

    if (p.isHooked) {
      const speed = vecMag(p.vel);
      const movingForwardUp = p.vel.x > 4 && p.vel.y < -2;
      const perfect = speed > 9 && movingForwardUp;
      p.isHooked = false;
      p.hookPos = null;
      p.anchorId = null;
      if (perfect) {
        p.vel.x += 5;
        p.vel.y -= 5;
        scoreRef.current += 200;
        releasePerfectRef.current = 0.4;
        soundManager.playRelease(true);
      } else {
        p.vel.y -= 3;
        p.vel.x += 2;
        soundManager.playRelease(false);
      }
      p.jumpCount = 0;
    } else {
      if (currentLevelRef.current === 1 && p.jumpCount >= 1) {
        if (handleHook()) return;
      }
      p.jumpCount++;
      if (p.jumpCount > 3) {
        // Stay capped; death comes from hazards.
        p.jumpCount = 3;
        return;
      }
      p.vel.y = -8;
      soundManager.playJump(1 + p.jumpCount * 0.2);
    }
  };

  const handleHook = (): boolean => {
    if (statusRef.current !== GameStatus.PLAYING) return false;
    const p = playerRef.current;
    if (p.exploded || p.isHooked || winTriggeredRef.current) return false;
    let bestAnchor: Entity | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    entitiesRef.current.forEach((ent) => {
      if (
        (ent.type === EntityType.ANCHOR || ent.type === EntityType.TIMED_ANCHOR) &&
        ent.isActive
      ) {
        const d = vecDist(p.pos, ent.pos);
        const dx = ent.pos.x - p.pos.x;
        const isUsable = d <= MAX_HOOK_DISTANCE && dx > -80;
        if (!isUsable) return;

        const forwardPenalty = dx < 0 ? 140 : 0;
        const heightPenalty = ent.pos.y > p.pos.y + 220 ? 80 : 0;
        const score = d + forwardPenalty + heightPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestAnchor = ent;
        }
      }
    });
    if (bestAnchor) {
      const a = bestAnchor as Entity;
      p.isHooked = true;
      p.hookPos = a.pos;
      p.anchorId = a.id;
      p.ropeLength = vecDist(p.pos, a.pos);
      p.jumpCount = 0;
      soundManager.playHook();
      return true;
    }
    return false;
  };

  useEffect(() => {
    parallaxLayers.current.forEach((layer) => {
      if (layer.image) return;

      const image = new Image();
      image.onload = () => {
        layer.loaded = true;
      };
      image.src = layer.src;
      layer.image = image;
    });
  }, []);

  useEffect(() => {
    statusRef.current = status;
    if (status === GameStatus.PLAYING) {
      if (scoreRef.current === 0 || playerRef.current.exploded || winTriggeredRef.current) {
        initGame();
      }
      soundManager.startBGM();
    } else if (
      status === GameStatus.GAMEOVER ||
      status === GameStatus.START ||
      status === GameStatus.WIN
    ) {
      soundManager.stopBGM();
    }

    if (status === GameStatus.START) {
      scoreRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => {
      soundManager.stopBGM();
      clearEndTimer();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
      lastFrameTimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (statusRef.current !== GameStatus.PLAYING) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleJump();
      }
      if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleHook();
      }
    };
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onJump = () => handleJump();
    const onHook = () => handleHook();
    window.addEventListener('gravity-link:jump', onJump);
    window.addEventListener('gravity-link:hook', onHook);
    return () => {
      window.removeEventListener('gravity-link:jump', onJump);
      window.removeEventListener('gravity-link:hook', onHook);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={GAME_WIDTH}
      height={GAME_HEIGHT}
      tabIndex={0}
      className="w-full h-auto block bg-black"
    />
  );
};

export default GameEngine;
