/** Spatial audio playback via Web Audio API (HRTF PannerNode).
 *
 * Maps a 2D bounding-box position from vision output to a 3D audio source
 * position, so a hazard detected in the right side of the camera frame
 * sounds like it's coming from the user's right.
 *
 * Also exposes real-time L/R channel levels via AnalyserNode tap so the UI
 * can visualize the spatial effect (essential when the demo video may be
 * downmixed to mono on YouTube / phone speakers).
 */

export interface SoundPosition {
  /** Normalized horizontal position in the camera frame.
   *  0 = far left, 0.5 = center, 1 = far right. */
  x: number;
  /** Optional. Vertical position: 0 = top of frame (far), 1 = bottom (near).
   *  Defaults to 0.5 (mid distance). */
  y?: number;
}

/** Convert a normalized 2D position to 3D PannerNode coordinates.
 *  Listener sits at origin, facing -Z (the convention).
 *  Azimuth spans ±90° from x ∈ [0, 1] for a dramatic spatial effect. */
export function positionToXYZ(
  pos: SoundPosition
): { x: number; y: number; z: number; distance: number } {
  const azimuthDeg = (pos.x - 0.5) * 180;
  const distance = pos.y !== undefined ? 0.5 + (1 - pos.y) * 2.5 : 1.0;
  const azimuthRad = (azimuthDeg * Math.PI) / 180;
  return {
    x: distance * Math.sin(azimuthRad),
    y: 0,
    z: -distance * Math.cos(azimuthRad),
    distance,
  };
}

export interface ChannelLevels {
  /** Left channel RMS in [0, 1] */
  l: number;
  /** Right channel RMS in [0, 1] */
  r: number;
}

export class SpatialAudioPlayer {
  private ctx: AudioContext;
  private listenerConfigured = false;
  // Analyser tap, shared across all plays so UI can read levels continuously
  private analyserL: AnalyserNode;
  private analyserR: AnalyserNode;
  private splitter: ChannelSplitterNode;
  private dataL: Uint8Array<ArrayBuffer>;
  private dataR: Uint8Array<ArrayBuffer>;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.splitter = ctx.createChannelSplitter(2);
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = 256;
    this.analyserR.fftSize = 256;
    this.analyserL.smoothingTimeConstant = 0.6;
    this.analyserR.smoothingTimeConstant = 0.6;
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this.dataL = new Uint8Array(new ArrayBuffer(this.analyserL.frequencyBinCount));
    this.dataR = new Uint8Array(new ArrayBuffer(this.analyserR.frequencyBinCount));
  }

  private ensureListener(): void {
    if (this.listenerConfigured) return;
    const l = this.ctx.listener;
    if (l.forwardX) {
      l.forwardX.value = 0;
      l.forwardY.value = 0;
      l.forwardZ.value = -1;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
      if (l.positionX) {
        l.positionX.value = 0;
        l.positionY.value = 0;
        l.positionZ.value = 0;
      }
    } else {
      const legacy = l as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
        setOrientation?: (
          fx: number, fy: number, fz: number,
          ux: number, uy: number, uz: number
        ) => void;
      };
      legacy.setPosition?.(0, 0, 0);
      legacy.setOrientation?.(0, 0, -1, 0, 1, 0);
    }
    this.listenerConfigured = true;
  }

  private createPanner(pos: SoundPosition): PannerNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 100;
    panner.rolloffFactor = 1;

    const { x, y, z } = positionToXYZ(pos);

    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else {
      const legacy = panner as unknown as {
        setPosition?: (x: number, y: number, z: number) => void;
      };
      legacy.setPosition?.(x, y, z);
    }
    return panner;
  }

  /** Connect through panner + analyser tap + destination. */
  private wireSourceThrough(source: AudioNode, pos: SoundPosition): void {
    const panner = this.createPanner(pos);
    source.connect(panner);
    // Tap: split into L/R for visualization
    panner.connect(this.splitter);
    // Real output: panner → destination
    panner.connect(this.ctx.destination);
  }

  /** Read instantaneous L/R levels in [0, 1]. Call from requestAnimationFrame. */
  getLevels(): ChannelLevels {
    this.analyserL.getByteFrequencyData(this.dataL);
    this.analyserR.getByteFrequencyData(this.dataR);
    let sumL = 0;
    let sumR = 0;
    for (let i = 0; i < this.dataL.length; i++) sumL += this.dataL[i];
    for (let i = 0; i < this.dataR.length; i++) sumR += this.dataR[i];
    return {
      l: sumL / this.dataL.length / 255,
      r: sumR / this.dataR.length / 255,
    };
  }

  /** Play TTS audio bytes spatially. Bytes typically come from /api/voice/speak. */
  async playBytes(audioBytes: ArrayBuffer, pos: SoundPosition): Promise<void> {
    this.ensureListener();
    const buffer = await this.ctx.decodeAudioData(audioBytes.slice(0));
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    this.wireSourceThrough(source, pos);
    source.start();
    return new Promise((resolve) => {
      source.onended = () => resolve();
    });
  }

  /** Play a sine beep spatially — used when TTS unavailable or pure directional cue. */
  async playBeep(pos: SoundPosition, freqHz = 660, durationSec = 0.5): Promise<void> {
    this.ensureListener();
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freqHz;

    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + durationSec);

    osc.connect(gain);
    this.wireSourceThrough(gain, pos);
    osc.start(now);
    osc.stop(now + durationSec + 0.05);
    return new Promise((resolve) => {
      osc.onended = () => resolve();
    });
  }
}
