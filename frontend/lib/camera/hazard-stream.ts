export interface HazardBbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectedHazard {
  label: string;
  bbox: HazardBbox;
  proximity: number;
  confidence?: number;
  position?: string;
  distanceBand?: string;
}

export interface SurroundingsItem {
  label: string;
  proximity: number;
  distanceBand: string;
  position: string;
  confidence?: number;
}

export interface HazardSurroundings {
  summary: string;
  voiceText?: string | null;
  items: SurroundingsItem[];
  crowded?: boolean;
  frontCount?: number;
}

export type HazardStreamAction = "stop" | "continue";

export interface HazardStreamResult {
  ok: boolean;
  chunkIndex?: number;
  frameIndex?: number;
  bytes?: number;
  frameWidth: number;
  frameHeight: number;
  hazards: DetectedHazard[];
  action: HazardStreamAction;
  voiceText?: string | null;
  closestHazard?: DetectedHazard | null;
  surroundings?: HazardSurroundings;
  crowded?: boolean;
  crowdedFrontCount?: number;
  meta?: {
    model?: string;
    inferenceMs?: number;
    hazardCount?: number;
    stopThreshold?: number;
    crowdedFrontThreshold?: number;
    demo?: boolean;
  };
  /** True when Next.js returned synthetic bboxes (CAMERA_HAZARD_FAKE_LOOP). */
  faked?: boolean;
  forwarded?: boolean;
}
