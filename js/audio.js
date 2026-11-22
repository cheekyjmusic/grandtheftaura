// =============================================================================
// audio.js — Procedural Web Audio SoundEngine (sfx) with custom audio file overrides from levelData.audioBindings.
// =============================================================================
import { levelData } from './levelData.js';
import { gameState } from './state.js';
import { playCustomAudio, stopCustomAudio } from './assets.js';

const DEFAULT_BGM_TRACKS = [
  'assets/audio/themesong1.mp3',
  'assets/audio/themesong2.mp3'
];

export class SoundEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.noiseBuffer = null;

    this.engineOsc = null;
    this.engineSubOsc = null;
    this.engineFilter = null;
    this.engineGain = null;

    this.skidTimer = 0;
    this.stepTimer = 0;
    this.stepLeft = false;

    this.customEngine = null;
    this.music = null;
    this.musicPath = '';

    // Built-in background music playlist state
    this.bgmPlayer = null;
    this.bgmIndex = 0;
    this.bgmVolume = 0.05;
    this.bgmPlayPending = false;
  }

  // ---- custom audio file overrides (levelData.audioBindings) ----
  custom(eventName, vol = 0.9) {
    if (!this.enabled) return false;
    const path = levelData.audioBindings && levelData.audioBindings[eventName];
    if (!path) return false;
    return Boolean(playCustomAudio(path, vol));
  }

  customEngineStep(active, rpm, throttle) {
    const path = levelData.audioBindings && levelData.audioBindings.engineLoop;
    if (!path) {
      if (this.customEngine) { stopCustomAudio(this.customEngine); this.customEngine = null; }
      return false;
    }
    if (!this.enabled || !active) {
      if (this.customEngine && !this.customEngine.paused) this.customEngine.pause();
      return true;
    }
    if (!this.customEngine) {
      this.customEngine = playCustomAudio(path, 0.5, { loop: true });
      if (!this.customEngine) return false; // not loaded yet -> procedural synth
    } else if (this.customEngine.paused) {
      const p = this.customEngine.play();
      if (p && p.catch) p.catch(() => {});
    }
    const ratio = Math.max(0, Math.min(1.1, rpm / 8000));
    this.customEngine.playbackRate = 0.6 + ratio * 1.5;
    this.customEngine.volume = Math.min(1, 0.25 + (throttle ? 0.2 : 0) + ratio * 0.4);
    return true;
  }

  setMusicVolume(volume) {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    if (this.bgmPlayer) this.bgmPlayer.volume = this.bgmVolume;
    if (this.music) this.music.volume = this.bgmVolume;
  }

  _ensureBgmPlayer() {
    if (this.bgmPlayer || typeof Audio === 'undefined') return;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = this.bgmVolume;
    audio.src = DEFAULT_BGM_TRACKS[this.bgmIndex];

    audio.addEventListener('ended', () => {
      this.bgmIndex = (this.bgmIndex + 1) % DEFAULT_BGM_TRACKS.length;
      audio.src = DEFAULT_BGM_TRACKS[this.bgmIndex];
      audio.volume = this.bgmVolume;
      if (this.enabled && gameState.screen === 'playing') {
        const p = audio.play();
        if (p && p.catch) p.catch(() => {});
      }
    });

    this.bgmPlayer = audio;
  }

  /** Called every frame by main.js: plays bound bgMusic or alternates themesong1.mp3 & themesong2.mp3 quietly. */
  updateMusic() {
    const customPath = levelData.audioBindings && levelData.audioBindings.bgMusic;
    const want = this.enabled && gameState.screen === 'playing';

    // If a custom Studio bgMusic override is bound, use it and pause the default playlist
    if (customPath) {
      if (this.bgmPlayer && !this.bgmPlayer.paused) this.bgmPlayer.pause();
      if (this.music && this.musicPath !== customPath) {
        stopCustomAudio(this.music);
        this.music = null;
      }
      if (want) {
        if (!this.music) {
          this.music = playCustomAudio(customPath, 0.35, { loop: true });
          this.musicPath = customPath;
        } else if (this.music.paused) {
          const p = this.music.play();
          if (p && p.catch) p.catch(() => {});
        }
      } else if (this.music && !this.music.paused) {
        this.music.pause();
      }
      return;
    }

    // Stop any previously bound custom music if unbound
    if (this.music) {
      stopCustomAudio(this.music);
      this.music = null;
      this.musicPath = '';
    }

    // Default quiet background playlist (themesong1.mp3 <-> themesong2.mp3)
    if (want) {
      this._ensureBgmPlayer();
      if (!this.bgmPlayer) return;
      this.bgmPlayer.volume = this.bgmVolume;
      if (this.bgmPlayer.paused && !this.bgmPlayPending) {
        this.bgmPlayPending = true;
        const p = this.bgmPlayer.play();
        if (p && p.then) {
          p.then(() => { this.bgmPlayPending = false; })
           .catch(() => { this.bgmPlayPending = false; });
        } else {
          this.bgmPlayPending = false;
        }
      }
    } else if (this.bgmPlayer && !this.bgmPlayer.paused) {
      this.bgmPlayer.pause();
    }
  }

  /** Studio "Test Sound": plays the bound custom file, or the built-in synth when unbound. */
  previewEvent(eventName) {
    this.unlock();
    const path = levelData.audioBindings && levelData.audioBindings[eventName];
    if (path) {
      const node = playCustomAudio(path, 0.9, { loop: false });
      if (node) {
        if (eventName === 'bgMusic' || eventName === 'engineLoop') setTimeout(() => stopCustomAudio(node), 3500);
        return true;
      }
    }
    switch (eventName) {
      case 'punch': this.hit(); break;
      case 'batSwing': this.tone(240, 82, 0.14, 'triangle', 0.12); break;
      case 'hotdogFire': this.wienerShot(); break;
      case 'pickup': this.pickup(); break;
      case 'carHorn': this.horn(); break;
      case 'footstep': this.footstep('concrete', false); break;
      case 'engineLoop':
        for (let i = 0; i < 8; i++) {
          setTimeout(() => this.tone(60 + i * 22, 70 + i * 22, 0.16, 'sawtooth', 0.09), i * 120);
        }
        break;
      case 'bgMusic':
        [0, 1, 2, 3].forEach((i) => setTimeout(() => this.tone([392, 494, 587, 784][i], null, 0.3, 'sine', 0.1), i * 220));
        break;
      default: this.uiClick();
    }
    return false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    // Retry background music if autoplay was waiting for the first user gesture
    if (this.bgmPlayer && this.bgmPlayer.paused && this.enabled && gameState.screen === 'playing' && !this.bgmPlayPending) {
      this.bgmPlayPending = true;
      const p = this.bgmPlayer.play();
      if (p && p.then) {
        p.then(() => { this.bgmPlayPending = false; })
         .catch(() => { this.bgmPlayPending = false; });
      } else {
        this.bgmPlayPending = false;
      }
    }

    // Build reusable white/pink noise buffer once for footsteps & transient effects
    if (this.ctx && !this.noiseBuffer) {
      const length = Math.floor(this.ctx.sampleRate * 0.25);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.18) * 1.4;
      }
      this.noiseBuffer = buffer;
    }

    if (this.ctx && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineSubOsc = this.ctx.createOscillator();
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineGain = this.ctx.createGain();

      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;

      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 45;

      this.engineSubOsc.type = 'triangle';
      this.engineSubOsc.frequency.value = 22.5;

      this.engineGain.gain.value = 0.0001;

      this.engineOsc.connect(this.engineFilter);
      this.engineSubOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);

      this.engineOsc.start();
      this.engineSubOsc.start();
    }
  }

  updateEngine(active, rpm, throttle, onLimiter = false) {
    if (this.customEngineStep(active, rpm, throttle)) {
      if (this.ctx && this.engineGain) this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.06);
      return;
    }
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const t = this.ctx.currentTime;
    if (!this.enabled || !active) {
      this.engineGain.gain.setTargetAtTime(0.0001, t, 0.06);
      return;
    }
    const rpmRatio = Math.max(0, Math.min(1.1, rpm / 8000));
    const freq = 32 + rpmRatio * 175;
    const cutoff = 180 + rpmRatio * 680 + (throttle ? 180 : 0);
    const limiterCut = onLimiter && Math.sin(t * 95) > 0 ? 0.35 : 1.0;
    const vol = (0.032 + (throttle ? 0.036 : 0.01) + rpmRatio * 0.038) * limiterCut;

    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.03);
    this.engineSubOsc.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.04);
    this.engineGain.gain.setTargetAtTime(vol, t, 0.04);
  }

  tone(f0, f1, dur, type = 'triangle', vol = 0.12) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  /**
   * Synthesizes a single natural footstep (low heel thud + filtered surface grit).
   * @param {'concrete'|'grass'|'sand'|'wood'|'metal'} surface
   * @param {boolean} sprinting
   */
  footstep(surface = 'concrete', sprinting = false) {
    if (!this.enabled) return;
    if (this.custom('footstep', sprinting ? 0.32 : 0.22)) return;
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;

    const t = this.ctx.currentTime;
    this.stepLeft = !this.stepLeft;

    // Subtle alternation between left/right foot + organic micro-variation
    const footBias = this.stepLeft ? 0.95 : 1.05;
    const jitter = 0.93 + Math.random() * 0.14;
    const pitchScale = footBias * jitter;
    const masterGain = sprinting ? 0.085 : 0.055;

    let thudStart = 118;
    let thudEnd = 42;
    let thudDur = 0.055;
    let gritFreq = 1150;
    let gritQ = 1.6;
    let gritDur = 0.048;
    let gritMix = 0.75;

    if (surface === 'grass' || surface === 'sand' || surface === 'dirt') {
      thudStart = 84;
      thudEnd = 34;
      thudDur = 0.065;
      gritFreq = 1750;
      gritQ = 0.9;
      gritDur = 0.075;
      gritMix = 1.1;
    } else if (surface === 'wood' || surface === 'metal') {
      thudStart = 165;
      thudEnd = 64;
      thudDur = 0.068;
      gritFreq = 920;
      gritQ = 2.4;
      gritDur = 0.042;
      gritMix = 0.55;
    }

    // 1. Heel / sole impact thud
    const thudOsc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(thudStart * pitchScale, t);
    thudOsc.frequency.exponentialRampToValueAtTime(Math.max(24, thudEnd * pitchScale), t + thudDur);

    thudGain.gain.setValueAtTime(0.0001, t);
    thudGain.gain.linearRampToValueAtTime(masterGain, t + 0.005);
    thudGain.gain.exponentialRampToValueAtTime(0.0008, t + thudDur);

    thudOsc.connect(thudGain);
    thudGain.connect(this.ctx.destination);
    thudOsc.start(t);
    thudOsc.stop(t + thudDur + 0.01);

    // 2. Sole scuff / surface texture burst
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(gritFreq * pitchScale, t);
    filter.Q.value = gritQ;

    const noiseGain = this.ctx.createGain();
    const peakGrit = masterGain * gritMix;
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.linearRampToValueAtTime(peakGrit, t + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0008, t + gritDur);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    // Random offset inside the cached noise buffer so each step has unique grain
    const maxOffset = Math.max(0, this.noiseBuffer.duration - gritDur - 0.02);
    noise.start(t, Math.random() * maxOffset, gritDur + 0.01);
  }

  /**
   * Call once per frame while updating the player to trigger rhythmic footsteps.
   */
  updateFootsteps(dt, moving, sprinting = false, grounded = true, surface = 'concrete') {
    if (!this.enabled || !moving || !grounded) {
      // Short lead-in so the first step triggers almost immediately when walking resumes
      this.stepTimer = Math.min(this.stepTimer, 0.09);
      return;
    }
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.footstep(surface, sprinting);
      this.stepTimer = sprinting ? 0.31 : 0.46;
    }
  }

  uiClick() { this.tone(640, 860, 0.06, 'sine', 0.07); }
  swing() {
    if (this.custom(gameState.activeRightWeapon === 'fists' ? 'punch' : 'batSwing')) return;
    this.tone(240, 82, 0.14, 'triangle', 0.12);
  }
  hit() { this.tone(145, 50, 0.16, 'sawtooth', 0.16); }
  metalClang() {
    this.tone(420, 140, 0.22, 'square', 0.14);
    this.tone(185, 65, 0.25, 'sawtooth', 0.15);
  }
  wienerShot() {
    if (this.custom('hotdogFire')) return;
    this.tone(290, 620, 0.07, 'sine', 0.13);
    setTimeout(() => this.tone(440, 130, 0.09, 'triangle', 0.10), 20);
  }
  wienerSplat() {
    this.tone(210, 58, 0.12, 'sawtooth', 0.13);
  }
  smash() {
    this.tone(165, 42, 0.24, 'sawtooth', 0.2);
    setTimeout(() => this.tone(110, 35, 0.18, 'square', 0.13), 45);
  }
  mantle() {
    this.tone(175, 265, 0.11, 'triangle', 0.13);
    setTimeout(() => this.tone(255, 345, 0.12, 'sine', 0.1), 85);
  }
  elevatorDing() {
    this.tone(880, 880, 0.18, 'sine', 0.1);
    setTimeout(() => this.tone(1174, 1174, 0.28, 'sine', 0.09), 140);
  }
  pickup() {
    if (this.custom('pickup')) return;
    this.tone(540, 880, 0.11, 'triangle', 0.11);
    setTimeout(() => this.tone(820, 1220, 0.14, 'triangle', 0.1), 60);
  }
  heal() {
    this.tone(420, 680, 0.16, 'sine', 0.12);
    setTimeout(() => this.tone(680, 960, 0.2, 'sine', 0.11), 85);
  }
  damage() { this.tone(115, 38, 0.3, 'sawtooth', 0.24); }
  shift() {
    this.tone(240, 135, 0.08, 'square', 0.09);
    setTimeout(() => this.tone(320, 210, 0.06, 'triangle', 0.06), 35);
  }
  skid(dt) {
    this.skidTimer -= dt;
    if (this.skidTimer <= 0) {
      this.skidTimer = 0.11;
      this.tone(940, 740, 0.10, 'sawtooth', 0.048);
    }
  }
  horn() {
    if (this.custom('carHorn')) return;
    this.tone(330, 322, 0.26, 'sawtooth', 0.1);
    this.tone(415, 408, 0.26, 'sawtooth', 0.09);
  }
  backfire() {
    this.tone(190, 48, 0.11, 'sawtooth', 0.24);
    setTimeout(() => this.tone(240, 55, 0.13, 'square', 0.20), 65);
  }
  sleepChime() {
    this.tone(523.25, 493.88, 0.22, 'sine', 0.10);
    setTimeout(() => this.tone(392.0, 349.23, 0.34, 'sine', 0.09), 160);
  }
  meteorDive() {
    this.tone(180, 52, 1.95, 'sawtooth', 0.16);
    this.tone(95, 34, 1.95, 'triangle', 0.18);
  }
  meteorImpact() {
    this.tone(110, 24, 0.75, 'sawtooth', 0.30);
    this.tone(72, 20, 0.90, 'sine', 0.32);
    setTimeout(() => this.tone(160, 36, 0.42, 'square', 0.18), 45);
  }
}

export const sfx = new SoundEngine();