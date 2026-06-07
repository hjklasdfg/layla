import type { DetectedHazard, HazardStreamResult, HazardSurroundings } from "@/lib/camera/hazard-stream";

const NEARBY_THRESHOLD = 0.45;
const STOP_THRESHOLD = 0.9;
const CROWDED_FRONT_THRESHOLD = 5;
const FRONT_POSITIONS = new Set(["ahead", "far ahead"]);

function distanceBand(proximity: number): string {
  if (proximity >= STOP_THRESHOLD) return "very close";
  if (proximity >= NEARBY_THRESHOLD) return "nearby";
  return "distant";
}

function bboxPosition(bbox: DetectedHazard["bbox"]): string {
  const cx = (bbox.x1 + bbox.x2) / 2;
  const cy = (bbox.y1 + bbox.y2) / 2;
  if (cy < 0.22) return "far ahead";
  if (cx < 0.36) return "on the left";
  if (cx > 0.64) return "on the right";
  return "ahead";
}

export function describeSurroundings(hazards: DetectedHazard[]): HazardSurroundings {
  const items = hazards.map((hazard) => ({
    label: hazard.label.toLowerCase(),
    proximity: hazard.proximity,
    distanceBand: hazard.distanceBand ?? distanceBand(hazard.proximity),
    position: hazard.position ?? bboxPosition(hazard.bbox),
    confidence: hazard.confidence,
  }));

  const frontCount = items.filter((item) => FRONT_POSITIONS.has(item.position)).length;
  const crowded = frontCount > CROWDED_FRONT_THRESHOLD;
  const crowdedSummary = crowded ? "Crowded environment — please be careful." : null;

  if (!items.length) {
    return {
      summary: crowdedSummary ?? "Path looks clear — nothing detected ahead.",
      voiceText: null,
      items: [],
      crowded,
      frontCount,
    };
  }

  const grouped = new Map<
    string,
    { label: string; band: string; position: string; count: number; proximity: number }
  >();
  for (const item of items) {
    const key = `${item.label}|${item.distanceBand}|${item.position}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.proximity = Math.max(existing.proximity, item.proximity);
    } else {
      grouped.set(key, {
        label: item.label,
        band: item.distanceBand,
        position: item.position,
        count: 1,
        proximity: item.proximity,
      });
    }
  }

  const phrases = [...grouped.values()]
    .sort((a, b) => b.proximity - a.proximity)
    .map(({ label, band, position, count }) => {
      const noun = count === 1 ? label : `${count} ${label}s`;
      if (band === "very close") return `${noun} very close ${position}`;
      if (position === "ahead") return `${noun} ${band} ahead`;
      return `${noun} ${band} ${position}`;
    });

  let summary = phrases.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(". ") + ".";
  if (crowdedSummary) {
    summary = `${crowdedSummary} ${summary}`;
  } else if (items.some((item) => item.proximity >= STOP_THRESHOLD)) {
    summary = `Please be careful. ${summary}`;
  }

  const needsCareful =
    crowded || items.some((item) => item.proximity >= STOP_THRESHOLD);
  const voiceText = needsCareful ? summary : null;

  return { summary, voiceText, items, crowded, frontCount };
}

export function hazardCarefulVoiceText(
  result: Pick<HazardStreamResult, "voiceText" | "surroundings">
): string | null {
  const text = result.voiceText ?? result.surroundings?.voiceText ?? null;
  if (!text) return null;
  return text.replace(/\bstop\b/gi, "be careful").replace(/\s—\s/g, ". ");
}
