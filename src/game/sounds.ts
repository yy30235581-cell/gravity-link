const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;

class SoundManager {
  private ctx: AudioContext | null = null;
  private bgmInterval: ReturnType<typeof setInterval> | null = null;
  private bgmGain: GainNode | null = null;
  private currentMusic: HTMLAudioElement | null = null;
  private currentMusicSrc = '';
  private gameBgmIndex = 0;
  private muted = false;
  private bgmStep = 0;

  private readonly musicVolume = 0.42;
  private readonly sfxVolume = 0.72;
  private readonly tracks = {
    menu: assetUrl('/assets/audio/menu-bgm.wav'),
    game: [assetUrl('/assets/audio/game-bgm.wav'), assetUrl('/assets/audio/game-bgm-2.wav')],
    gameOver: assetUrl('/assets/audio/game-over-bgm.wav'),
    laser: assetUrl('/assets/audio/laser.wav'),
  };

  private init() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.stopBGM();
    if (this.currentMusic) this.currentMusic.muted = m;
  }

  isMuted() {
    return this.muted;
  }

  private playMusic(src: string, loop = true) {
    if (this.muted) return;
    this.stopSynthBGM();

    if (this.currentMusic && this.currentMusicSrc === src) {
      this.currentMusic.loop = loop;
      this.currentMusic.muted = false;
      this.currentMusic.play().catch(() => {});
      return;
    }

    this.stopBGM();
    const audio = new Audio(src);
    audio.loop = loop;
    audio.volume = this.musicVolume;
    audio.muted = this.muted;
    audio.preload = 'auto';
    this.currentMusic = audio;
    this.currentMusicSrc = src;
    audio.play().catch(() => {});
  }

  playMenuBGM() {
    this.playMusic(this.tracks.menu);
  }

  playGameOverBGM() {
    this.playMusic(this.tracks.gameOver);
  }

  playLaser() {
    if (this.muted) return;
    const laser = new Audio(this.tracks.laser);
    laser.volume = this.sfxVolume;
    laser.play().catch(() => {});
  }

  playJump(pitch = 1) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150 * pitch, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600 * pitch, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playHook() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playRelease(boosted = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(boosted ? 400 : 200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(boosted ? 1200 : 100, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(boosted ? 0.18 : 0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playExplosion() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const bufSize = this.ctx.sampleRate * 0.5;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.5);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    noise.start();
    noise.stop(this.ctx.currentTime + 0.5);
  }

  playCore() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2400, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playMilestone() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [600, 900, 1350].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, t + i * 0.08);
      gain.gain.setValueAtTime(0.06, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.15);
    });
  }

  startBGM() {
    const track = this.tracks.game[this.gameBgmIndex % this.tracks.game.length];
    this.gameBgmIndex++;
    this.playMusic(track);
    return;
  }

  private startSynthBGM() {
    if (this.muted) return;
    this.init();
    if (!this.ctx || this.bgmInterval) return;
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.setValueAtTime(0.07, this.ctx.currentTime);
    this.bgmGain.connect(this.ctx.destination);

    const bassPattern = [55, 55, 65.41, 55, 82.41, 73.42, 65.41, 49];
    const arpPattern = [220, 329.63, 440, 554.37, 440, 329.63, 246.94, 293.66];
    const chordPattern = [
      [110, 164.81, 220],
      [98, 146.83, 196],
      [130.81, 196, 261.63],
      [82.41, 123.47, 164.81],
    ];

    this.bgmStep = 0;
    this.bgmInterval = setInterval(() => {
      if (!this.ctx || !this.bgmGain) return;
      const time = this.ctx.currentTime;
      const step = this.bgmStep;

      const playTone = (
        frequency: number,
        duration: number,
        type: OscillatorType,
        volume: number,
        destination: AudioNode = this.bgmGain!,
        startOffset = 0,
      ) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = time + startOffset;
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(destination);
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
        osc.start(start);
        osc.stop(start + duration);
      };

      if (step % 4 === 0) {
        playTone(bassPattern[(step / 4) % bassPattern.length], 0.42, 'sawtooth', 0.16);
        playTone(bassPattern[(step / 4) % bassPattern.length] / 2, 0.7, 'triangle', 0.08);
      }

      if (step % 8 === 0) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, time);
        filter.frequency.exponentialRampToValueAtTime(2200, time + 0.7);
        filter.Q.setValueAtTime(5, time);
        filter.connect(this.bgmGain);
        chordPattern[(step / 8) % chordPattern.length].forEach((note) =>
          playTone(note, 0.75, 'sawtooth', 0.035, filter),
        );
        setTimeout(() => filter.disconnect(), 820);
      }

      if (step % 2 === 1) {
        playTone(arpPattern[step % arpPattern.length], 0.12, 'square', 0.025);
      }

      if (step % 4 === 2) {
        playTone(arpPattern[(step + 3) % arpPattern.length] * 2, 0.08, 'triangle', 0.018);
      }

      if (step % 2 === 0) {
        const bufSize = this.ctx.sampleRate * 0.06;
        const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.setValueAtTime(5200, time);
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(step % 8 === 0 ? 0.035 : 0.016, time);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.bgmGain);
        noise.onended = () => {
          noise.disconnect();
          noiseFilter.disconnect();
          noiseGain.disconnect();
        };
        noise.start(time);
        noise.stop(time + 0.06);
      }

      this.bgmStep = (step + 1) % 64;
    }, 150);
  }

  private stopSynthBGM() {
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
    if (this.bgmGain && this.ctx) {
      const time = this.ctx.currentTime;
      this.bgmGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
      const oldGain = this.bgmGain;
      this.bgmGain = null;
      setTimeout(() => oldGain.disconnect(), 500);
    }
  }

  stopBGM() {
    this.stopSynthBGM();
    if (this.currentMusic) {
      this.currentMusic.pause();
      this.currentMusic.currentTime = 0;
      this.currentMusic = null;
      this.currentMusicSrc = '';
    }
  }
}

export const soundManager = new SoundManager();
