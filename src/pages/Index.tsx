import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Volume2, VolumeX, Pause, Play } from 'lucide-react';
import GameEngine from '@/game/GameEngine';
import { GameStatus } from '@/game/types';
import { soundManager } from '@/game/sounds';

const LEVEL_NAMES: Record<number, string> = {
  1: '关卡 1 // 基础链路',
  2: '关卡 2 // 激光封锁区',
  3: '关卡 3 // 不稳定锚区',
  4: '关卡 4 // 坍塌红柱区',
};

const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: '按 F 挂住锚点，按空格弹跳，再继续挂住下一段绳子。',
  2: '前方会随机射出激光，激光会切断绳子，断绳后有 3 次紧急弹跳机会。',
  3: '锚点会快速消失，挂住后观察圆圈进度条，归零后会掉落。',
  4: '上方会随机坍塌红色柱子，小球被红柱撞到就会死亡。',
};

const START_IMAGE_URL = '/assets/picture/gravity-link-start-cyberpunk-v2.png';
const HEALTH_ICON_URL = '/assets/ui/health/cyber-heart.png';
const GAME_OVER_ASSETS = {
  status: '/assets/ui/game-over/critical-status.png',
  title: '/assets/ui/game-over/mission-failed-title.png',
  restart: '/assets/ui/game-over/restart-label.png',
  mainMenu: '/assets/ui/game-over/main-menu-label.png',
};

type TutorialStep = 'jump' | 'hook' | null;

const getLevelFromMilestone = (name: string): number | null => {
  const match = name.match(/关卡\s*(\d)/);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 4 ? value : null;
};

export default function Index() {
  const [status, setStatus] = useState<GameStatus>(GameStatus.START);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [energy, setEnergy] = useState(10);
  const [health, setHealth] = useState(3);
  const [milestoneText, setMilestoneText] = useState<string | null>(null);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(null);
  const [levelPopup, setLevelPopup] = useState<{ level: number; name: string; detail: string } | null>(
    null,
  );
  const [muted, setMuted] = useState(false);
  const milestoneTimerRef = useRef<number | null>(null);
  const levelPopupTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);

  const handleGameOver = (finalScore: number) => {
    setScore(finalScore);
    setStatus(GameStatus.GAMEOVER);
  };

  const handleWin = (finalScore: number) => {
    setScore(finalScore);
    setStatus(GameStatus.WIN);
  };

  const handleUpdateHUD = (
    currentEnergy: number,
    currentScore: number,
    currentLevel: number,
    currentHealth: number,
  ) => {
    setEnergy(currentEnergy);
    setScore(currentScore);
    setLevel(currentLevel);
    setHealth(currentHealth);
  };

  const handleMilestone = (name: string) => {
    setMilestoneText(name);
    if (milestoneTimerRef.current) window.clearTimeout(milestoneTimerRef.current);
    milestoneTimerRef.current = window.setTimeout(() => setMilestoneText(null), 1800);

    const nextLevel = getLevelFromMilestone(name);
    if (nextLevel && nextLevel > 1) {
      setLevelPopup({
        level: nextLevel,
        name: LEVEL_NAMES[nextLevel],
        detail: LEVEL_DESCRIPTIONS[nextLevel],
      });
      if (levelPopupTimerRef.current) window.clearTimeout(levelPopupTimerRef.current);
      setStatus(GameStatus.PAUSED);
    }
  };

  const continueToNextLevel = () => {
    setLevelPopup(null);
    setMilestoneText(null);
    setStatus(GameStatus.PLAYING);
  };

  const resetHud = () => {
    setScore(0);
    setLevel(1);
    setEnergy(10);
    setHealth(3);
    setLevelPopup(null);
  };

  const startGame = () => {
    resetHud();
    soundManager.stopBGM();
    setTutorialStep('jump');
    setStatus(GameStatus.PAUSED);
  };

  const restartGame = () => {
    setStatus(GameStatus.START);
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      resetHud();
      soundManager.stopBGM();
      setTutorialStep('jump');
      setStatus(GameStatus.PAUSED);
    }, 50);
  };

  const goToMainMenu = () => {
    resetHud();
    setTutorialStep(null);
    setStatus(GameStatus.START);
  };

  const togglePause = () => {
    if (tutorialStep) return;
    setStatus((s) =>
      s === GameStatus.PLAYING ? GameStatus.PAUSED : s === GameStatus.PAUSED ? GameStatus.PLAYING : s,
    );
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      soundManager.setMuted(next);
      if (next) soundManager.stopBGM();
      else if (status === GameStatus.PLAYING) soundManager.startBGM();
      else if (status === GameStatus.GAMEOVER) soundManager.playGameOverBGM();
      else if (status === GameStatus.START) soundManager.playMenuBGM();
      return next;
    });
  };

  useEffect(() => {
    if (muted) return;
    if (status === GameStatus.START) soundManager.playMenuBGM();
    if (status === GameStatus.GAMEOVER) soundManager.playGameOverBGM();
    if (status === GameStatus.WIN) soundManager.stopBGM();
  }, [muted, status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tutorialStep) return;
      if (e.key === 'Escape' && (status === GameStatus.PLAYING || status === GameStatus.PAUSED)) {
        togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, tutorialStep]);

  useEffect(() => {
    if (!tutorialStep) return;

    const onTutorialKey = (e: KeyboardEvent) => {
      const isJump = e.code === 'Space';
      const isHook = e.code === 'KeyF' || e.key === 'f' || e.key === 'F';

      if (!isJump && !isHook) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (tutorialStep === 'jump' && isJump) {
        setTutorialStep('hook');
      } else if (tutorialStep === 'hook' && isHook) {
        setTutorialStep(null);
        setStatus(GameStatus.PLAYING);
      }
    };

    window.addEventListener('keydown', onTutorialKey, { capture: true });
    return () => window.removeEventListener('keydown', onTutorialKey, { capture: true });
  }, [tutorialStep]);

  useEffect(() => {
    return () => {
      if (milestoneTimerRef.current) window.clearTimeout(milestoneTimerRef.current);
      if (levelPopupTimerRef.current) window.clearTimeout(levelPopupTimerRef.current);
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#050505] text-white font-sans selection:bg-[#00FFFF] selection:text-black overflow-hidden flex flex-col items-center justify-center relative">
      <style>{`
        .industrial-grid {
          background-image: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .scan-line {
          position: absolute;
          left: 0;
          right: 0;
          width: 100%;
          height: 2px;
          background: rgba(0, 255, 255, 0.1);
          box-shadow: 0 0 10px rgba(0, 255, 255, 0.2);
          animation: scan 8s linear infinite;
        }
        @keyframes scan {
          from { transform: translateY(0vh); }
          to { transform: translateY(100vh); }
        }
        .glitch-title {
          text-shadow: 3px 0 #00ffff, -3px 0 #ff2f6d, 0 0 24px rgba(255,255,255,0.28);
          filter: contrast(1.1);
        }
      `}</style>

      <div className="fixed inset-0 industrial-grid pointer-events-none" />
      <div className="scan-line pointer-events-none" />
      <button
        onClick={toggleMute}
        className="fixed right-4 top-4 z-[80] flex h-11 w-11 items-center justify-center border border-white/25 bg-black/65 text-white backdrop-blur-sm transition-colors hover:border-[#00FFFF]/70 hover:bg-[#00FFFF]/15"
        aria-label={muted ? '开启声音' : '静音'}
        title={muted ? '开启声音' : '静音'}
        type="button"
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      <div className="relative w-full h-screen flex flex-col overflow-hidden">
        <AnimatePresence>
          {status === GameStatus.START && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 z-0 pointer-events-none"
            >
              <img
                src={START_IMAGE_URL}
                alt=""
                className="h-full w-full object-cover"
                aria-hidden="true"
              />
              <div className="absolute inset-0 bg-black/18" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_18%,rgba(0,255,255,0.16),transparent_28%),linear-gradient(90deg,rgba(0,0,0,0.42),rgba(0,0,0,0.08)_52%,rgba(0,0,0,0.30))]" />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {status === GameStatus.START && (
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ duration: 0.6 }}
              className="absolute left-[5vw] top-[9vh] z-30 pointer-events-none select-none"
            >
              <div className="text-[12px] font-mono tracking-[0.35em] text-[#ff3f7f] uppercase mb-5">
                系统状态 // SYSTEM_STATUS
              </div>
              <h1 className="glitch-title text-[13vw] md:text-[10vw] font-black leading-[0.78] tracking-normal uppercase text-white">
                GRAVITY<br />LINK
              </h1>
              <div className="mt-7 text-base md:text-xl font-mono tracking-[0.65em] text-white/80">
                重 · 力 · 牵 · 引 · 未 · 来
              </div>
              <div className="mt-5 h-3 w-72 bg-[repeating-linear-gradient(135deg,#ff3f7f_0_18px,#341019_18px_32px)]" />
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={`absolute inset-0 pointer-events-none z-40 p-3 md:p-8 ${
            status === GameStatus.START ? 'hidden' : ''
          }`}
        >
          <div className="w-full h-full border border-white/15 p-3 md:p-6 flex flex-col justify-between">
            <div className="flex justify-between items-start gap-4">
              <div className="space-y-3">
                <div className="text-[10px] font-mono tracking-[0.2em] text-white/60 uppercase">
                  系统状态 // SYSTEM_STATUS
                </div>
                <div className="text-xs md:text-sm font-bold uppercase tracking-normal">
                  {status === GameStatus.PAUSED ? '链路：已暂停' : '重力链路：稳定 / 激活中'}
                </div>
                <div className="flex items-center gap-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <img
                      key={index}
                      src={HEALTH_ICON_URL}
                      alt=""
                      aria-hidden="true"
                      className={`h-8 w-8 md:h-10 md:w-10 object-contain transition-opacity ${
                        index < health ? 'opacity-100' : 'opacity-20 grayscale'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pointer-events-auto">
                {(status === GameStatus.PLAYING || status === GameStatus.PAUSED) && !tutorialStep && (
                  <button
                    onClick={togglePause}
                    className="w-9 h-9 border border-white/20 flex items-center justify-center hover:bg-white/10 transition-colors"
                    aria-label={status === GameStatus.PAUSED ? '继续' : '暂停'}
                    type="button"
                  >
                    {status === GameStatus.PAUSED ? <Play size={16} /> : <Pause size={16} />}
                  </button>
                )}
              </div>

              {status === GameStatus.PLAYING && (
                <div className="text-right space-y-1 hidden md:block">
                  <div className="text-[10px] font-mono tracking-[0.2em] text-white/60 uppercase">
                    当前关卡 // STAGE
                  </div>
                  <div className="text-2xl font-black italic tracking-normal leading-none text-[#00FFFF]">
                    {LEVEL_NAMES[level]}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-end gap-4">
              <div className="space-y-2 md:space-y-3">
                <div className="text-[10px] font-mono tracking-[0.2em] text-white/60 uppercase">
                  目标 // OBJECTIVE
                </div>
                <div className="text-xs md:text-sm font-bold uppercase">
                  到达 20000 // 登上撤离平台
                </div>
              </div>

              <div className="text-right space-y-1">
                <div className="text-[10px] font-mono tracking-[0.2em] text-white/60 uppercase">
                  能量 {energy.toString().padStart(2, '0')} // SECTOR_INDEX
                </div>
                <div className="text-3xl md:text-4xl font-black tracking-normal tabular-nums leading-none">
                  {score.toString().padStart(6, '0')}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`relative flex-1 flex items-center justify-center ${
            status === GameStatus.START ? 'px-0' : 'px-2 md:px-0'
          }`}
        >
          <div
            className={
              status === GameStatus.START
                ? 'absolute inset-0 overflow-hidden'
                : 'relative w-full max-w-[1024px] aspect-[1024/600] bg-black/40 overflow-hidden'
            }
          >
            {status !== GameStatus.START && (
              <GameEngine
                status={status}
                onGameOver={handleGameOver}
                onWin={handleWin}
                onUpdateHUD={handleUpdateHUD}
                onMilestone={handleMilestone}
              />
            )}

            {status === GameStatus.PLAYING && level === 1 && (
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute left-1/2 top-4 z-30 -translate-x-1/2 pointer-events-none"
              >
                <div className="flex items-center gap-3 border border-[#00FFFF]/45 bg-black/70 px-4 py-2 text-[11px] md:text-xs font-mono text-white/85 shadow-[0_0_22px_rgba(0,255,255,0.16)] backdrop-blur-sm">
                  <span className="text-[#00FFFF] tracking-[0.22em] uppercase">TRAINING</span>
                  <span className="h-4 w-px bg-white/20" />
                  <kbd className="border border-white/35 bg-white/10 px-2 py-0.5 text-white">SPACE</kbd>
                  <span>跳跃</span>
                  <kbd className="border border-white/35 bg-white/10 px-2 py-0.5 text-white">F</kbd>
                  <span>发射钩锁</span>
                </div>
              </motion.div>
            )}

            <AnimatePresence>
              {milestoneText && status === GameStatus.PLAYING && !levelPopup && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="absolute left-1/2 -translate-x-1/2 top-12 z-30 pointer-events-none"
                >
                  <div className="bg-black/80 border border-[#00FFFF]/50 px-6 py-3 backdrop-blur-sm">
                    <div className="text-[10px] font-mono tracking-[0.3em] text-[#00FFFF] uppercase">
                      ENTERING //
                    </div>
                    <div className="text-lg font-black tracking-normal uppercase">{milestoneText}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {levelPopup && (status === GameStatus.PLAYING || status === GameStatus.PAUSED) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto"
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.92, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: -10 }}
                    transition={{ duration: 0.22 }}
                    className="w-[min(88%,620px)] border border-[#00FFFF]/60 bg-black/90 px-7 py-7 text-center shadow-[0_0_45px_rgba(0,255,255,0.18)]"
                  >
                    <div className="text-[10px] font-mono tracking-[0.35em] text-[#00FFFF] uppercase mb-3">
                      STAGE RESULT
                    </div>
                    <div className="mx-auto mb-4 h-1 w-28 bg-[#00FFFF] shadow-[0_0_18px_rgba(0,255,255,0.9)]" />
                    <div className="mb-2 text-sm font-mono tracking-[0.25em] text-white/55 uppercase">
                      区域指数 {score.toString().padStart(6, '0')}
                    </div>
                    <div className="text-3xl md:text-5xl font-black italic uppercase tracking-normal text-white">
                      {levelPopup.name}
                    </div>
                    <div className="mt-4 text-sm md:text-base font-mono leading-relaxed text-white/75">
                      {levelPopup.detail}
                    </div>
                    <button
                      onClick={continueToNextLevel}
                      className="mt-7 w-full bg-white px-6 py-4 text-black font-black italic uppercase tracking-[0.08em] hover:bg-[#00FFFF] transition-colors"
                      type="button"
                    >
                      进入下一关 // CONTINUE
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {status === GameStatus.PLAYING && (
              <div className="absolute inset-x-0 bottom-3 z-30 px-4 flex justify-between items-end pointer-events-none md:hidden">
                <button
                  onTouchStart={(e) => {
                    e.preventDefault();
                    window.dispatchEvent(new Event('gravity-link:hook'));
                  }}
                  onClick={() => window.dispatchEvent(new Event('gravity-link:hook'))}
                  className="pointer-events-auto w-20 h-20 rounded-full bg-[#00FFFF]/20 border-2 border-[#00FFFF] text-[#00FFFF] font-black uppercase text-sm backdrop-blur-sm active:bg-[#00FFFF]/40 select-none"
                  type="button"
                >
                  HOOK
                </button>
                <button
                  onTouchStart={(e) => {
                    e.preventDefault();
                    window.dispatchEvent(new Event('gravity-link:jump'));
                  }}
                  onClick={() => window.dispatchEvent(new Event('gravity-link:jump'))}
                  className="pointer-events-auto w-24 h-24 rounded-full bg-white/15 border-2 border-white text-white font-black uppercase text-sm backdrop-blur-sm active:bg-white/30 select-none"
                  type="button"
                >
                  JUMP
                </button>
              </div>
            )}

            <AnimatePresence>
              {tutorialStep && status === GameStatus.PAUSED && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/88 backdrop-blur-sm pointer-events-auto"
                >
                  <motion.div
                    initial={{ opacity: 0, y: 18, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -12, scale: 0.98 }}
                    className="w-[min(88%,560px)] border border-[#00FFFF]/70 bg-black/90 px-7 py-7 text-center shadow-[0_0_45px_rgba(0,255,255,0.22)]"
                  >
                    <div className="mb-3 text-[10px] font-mono tracking-[0.35em] text-[#00FFFF] uppercase">
                      REQUIRED TRAINING
                    </div>
                    <div className="mx-auto mb-6 h-1 w-32 bg-[#00FFFF] shadow-[0_0_18px_rgba(0,255,255,0.9)]" />
                    <div className="mb-3 text-2xl md:text-4xl font-black italic uppercase tracking-normal text-white">
                      {tutorialStep === 'jump' ? '第一步：跳跃' : '第二步：发射钩锁'}
                    </div>
                    <div className="mb-7 text-sm md:text-base font-mono leading-relaxed text-white/70">
                      {tutorialStep === 'jump'
                        ? '按下空格键，确认你知道如何让小球跳起。'
                        : '按下 F 键，确认你知道如何发射重力钩锁。'}
                    </div>
                    <div className="flex items-center justify-center gap-3">
                      <kbd
                        className={`min-w-28 border px-5 py-3 text-xl font-black ${
                          tutorialStep === 'jump'
                            ? 'border-[#00FFFF] bg-[#00FFFF] text-black shadow-[0_0_24px_rgba(0,255,255,0.35)]'
                            : 'border-white/20 bg-white/5 text-white/35'
                        }`}
                      >
                        SPACE
                      </kbd>
                      <kbd
                        className={`min-w-20 border px-5 py-3 text-xl font-black ${
                          tutorialStep === 'hook'
                            ? 'border-[#00FFFF] bg-[#00FFFF] text-black shadow-[0_0_24px_rgba(0,255,255,0.35)]'
                            : 'border-white/20 bg-white/5 text-white/35'
                        }`}
                      >
                        F
                      </kbd>
                    </div>
                    <div className="mt-6 text-[10px] font-mono tracking-[0.22em] text-white/40 uppercase">
                      必须完成训练后开始第一关
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {status === GameStatus.PAUSED && !levelPopup && !tutorialStep && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
                >
                  <div className="text-[10px] font-mono tracking-[0.3em] text-[#00FFFF] uppercase mb-2">
                    系统暂停 // SYSTEM_HALTED
                  </div>
                  <h2 className="text-6xl md:text-8xl font-black italic tracking-normal uppercase mb-8">
                    PAUSED
                  </h2>
                  <button
                    onClick={togglePause}
                    className="px-8 py-3 bg-white text-black font-black uppercase italic tracking-normal hover:bg-[#00FFFF] transition-colors"
                    type="button"
                  >
                    继续运行 // RESUME
                  </button>
                  <div className="mt-6 text-[10px] font-mono tracking-[0.3em] text-white/50 uppercase">
                    按 ESC 继续
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {status === GameStatus.START && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 flex flex-col items-center justify-center md:items-end md:justify-center p-6 md:p-12"
                >
                  <div className="max-w-md w-full translate-y-[200px] space-y-6 bg-black/55 p-6 md:p-7 backdrop-blur-md border border-[#ff3f7f]/45 shadow-[0_0_40px_rgba(255,47,109,0.18)]">
                    <div className="space-y-4">
                      <div className="text-[12px] font-mono tracking-[0.25em] text-[#ff3f7f] uppercase border-b border-[#ff3f7f]/30 pb-3">
                        实时模拟 // 关卡 1-4
                      </div>
                      <div className="text-xs font-mono text-white/70 space-y-3">
                        <div className="flex gap-3 items-start">
                          <kbd className="px-2 py-0.5 border border-white/30 text-white rounded font-sans">
                            空格
                          </kbd>
                          <span>跳跃 / 释放钩锁（空中最多 3 次）</span>
                        </div>
                        <div className="flex gap-3 items-start">
                          <kbd className="px-2 py-0.5 border border-white/30 text-white rounded font-sans">
                            F
                          </kbd>
                          <span>发射重力钩锁（重置连跳）</span>
                        </div>
                        <div className="flex gap-3 items-start">
                          <kbd className="px-2 py-0.5 border border-white/30 text-white rounded font-sans">
                            ESC
                          </kbd>
                          <span>暂停 / 继续</span>
                        </div>
                        <div className="hidden">
                          <div>
                            <span className="text-[#00FFFF] font-bold">关卡 1：</span>
                            按 F 挂住锚点，按空格弹跳，再按空格继续挂绳。
                          </div>
                          <div>
                            <span className="text-[#FF4E00] font-bold">关卡 2：</span>
                            3000-7000，前方激光会切断绳子，断绳后保留 3 次紧急弹跳。
                          </div>
                          <div>
                            <span className="text-[#FF4E00] font-bold">关卡 3：</span>
                            7000-12000，锚点出现圆圈进度条，归零后消失。
                          </div>
                          <div>
                            <span className="text-[#FF4E00] font-bold">关卡 4：</span>
                            12000-20000，上方红色柱子会随机坍塌，撞到小球即死亡。
                          </div>
                          <div>
                            <span className="text-[#A8FFEF] font-bold">终点：</span>
                            超过 20000 后出现撤离平台，飞碟会把小球吸走通关。
                          </div>
                        </div>
                        <p className="hidden">
                          警告：接触红色柱体会立即爆炸。
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={startGame}
                      className="w-full bg-[#ff3f7f] text-white py-4 font-black uppercase italic tracking-[0.08em] hover:bg-white hover:text-black transition-all transform hover:scale-[1.02] active:scale-95 shadow-[0_0_24px_rgba(255,63,127,0.35)]"
                      type="button"
                    >
                      启动 // START
                    </button>
                  </div>
                </motion.div>
              )}

              {status === GameStatus.GAMEOVER && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4"
                >
                  <div className="relative text-center px-5 py-7 md:p-12 w-full max-w-xl border-x border-[#ff3f7f]/25 shadow-[0_0_48px_rgba(255,63,127,0.18)] overflow-hidden">
                    <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#00ffff] to-transparent opacity-80" />
                    <div className="pointer-events-none absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-[#ff3f7f] to-transparent opacity-80" />
                    <img
                      src={GAME_OVER_ASSETS.status}
                      alt="链路扭曲：临界状态"
                      className="mx-auto mb-4 h-8 w-auto max-w-full object-contain animate-pulse"
                      draggable={false}
                    />
                    <h2 className="sr-only">任务失败</h2>
                    <img
                      src={GAME_OVER_ASSETS.title}
                      alt=""
                      aria-hidden="true"
                      className="mx-auto mb-6 w-full max-w-[590px] object-contain drop-shadow-[0_0_22px_rgba(255,63,127,0.35)]"
                      draggable={false}
                    />

                    <div className="grid grid-cols-2 gap-4 md:gap-8 mb-8">
                      <div className="text-left border-l border-white/20 pl-3">
                        <div className="text-[10px] font-mono text-white/40 uppercase mb-2">最终距离</div>
                        <div className="text-2xl md:text-4xl font-black tabular-nums">{score}</div>
                      </div>
                      <div className="text-left border-l border-white/20 pl-3">
                        <div className="text-[10px] font-mono text-white/40 uppercase mb-2">阵亡关卡</div>
                        <div className="text-2xl md:text-4xl font-black italic text-[#FF4E00]">
                          {LEVEL_NAMES[level]?.split(' // ')[0] || `关卡 ${level}`}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                      <button
                        onClick={restartGame}
                        className="flex-1 bg-white text-black py-3 min-h-[68px] flex items-center justify-center hover:bg-[#00FFFF] transition-all shadow-[0_0_24px_rgba(255,255,255,0.18)]"
                        type="button"
                      >
                        <span className="sr-only">重新开始</span>
                        <img
                          src={GAME_OVER_ASSETS.restart}
                          alt=""
                          aria-hidden="true"
                          className="h-10 w-auto max-w-full object-contain"
                          draggable={false}
                        />
                      </button>
                      <button
                        onClick={goToMainMenu}
                        className="flex-1 border border-white/20 !bg-transparent !hover:bg-transparent text-white py-3 min-h-[68px] flex items-center justify-center hover:bg-white/5 transition-all shadow-[inset_0_0_18px_rgba(0,255,255,0.08)]"
                        type="button"
                      >
                        <span className="sr-only">回到主界面</span>
                        <img
                          src={GAME_OVER_ASSETS.mainMenu}
                          alt=""
                          aria-hidden="true"
                          className="h-10 w-auto max-w-full object-contain"
                          draggable={false}
                        />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {status === GameStatus.WIN && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
                >
                  <div className="text-center p-6 md:p-12 w-full max-w-xl border-x border-[#00FFFF]/30">
                    <div className="text-[10px] font-mono tracking-[0.3em] text-[#00FFFF] uppercase mb-4 animate-pulse">
                      撤离成功 // EXTRACTION_OK
                    </div>
                    <h2 className="text-[12vw] md:text-[8vw] font-black italic tracking-normal uppercase text-white mb-2">
                      通关
                    </h2>
                    <div className="text-sm font-mono text-[#A8FFEF] mb-6 uppercase tracking-widest">
                      飞碟已将你带离破壁点
                    </div>

                    <div className="grid grid-cols-2 gap-4 md:gap-8 mb-8">
                      <div className="text-left border-l border-[#00FFFF]/30 pl-3">
                        <div className="text-[10px] font-mono text-white/40 uppercase mb-2">最终距离</div>
                        <div className="text-2xl md:text-4xl font-black tabular-nums text-[#00FFFF]">
                          {score}
                        </div>
                      </div>
                      <div className="text-left border-l border-[#00FFFF]/30 pl-3">
                        <div className="text-[10px] font-mono text-white/40 uppercase mb-2">状态</div>
                        <div className="text-2xl md:text-4xl font-black italic text-[#00FFFF]">CLEAR</div>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3">
                      <button
                        onClick={restartGame}
                        className="flex-1 bg-[#00FFFF] text-black py-4 font-black uppercase italic tracking-normal hover:bg-white transition-all"
                        type="button"
                      >
                        再来一次
                      </button>
                      <button
                        onClick={goToMainMenu}
                        className="flex-1 border border-white/20 !bg-transparent !hover:bg-transparent text-white py-4 font-black uppercase italic tracking-normal hover:bg-white/5 transition-all"
                        type="button"
                      >
                        回到主界面
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
