/** Pure-function navigation state machine.
 *
 * Inputs:  current state + new GPS tick
 * Outputs: new state + list of events (speak / advance / progress / arrived)
 *
 * No React, no fetch, no audio — fully testable.
 */

import type { GpsTick, NavRoute, NavigationEvent, NavigationState } from "./types";
import { distanceMeters } from "./geo";

const PRE_THRESHOLD_M = 150;
const ALERT_THRESHOLD_M = 30;
const ADVANCE_THRESHOLD_M = 12;
const ARRIVE_THRESHOLD_M = 15;

export function initNavigationState(route: NavRoute, now: number): NavigationState {
  return {
    route,
    currentManeuverIndex: 0,
    spokenKeys: new Set<string>(),
    lastGps: null,
    startedAt: now,
    isArrived: false,
  };
}

/** Given a state and a new GPS tick, compute next state + emitted events. */
export function tickNavigation(
  state: NavigationState,
  gps: GpsTick
): { newState: NavigationState; events: NavigationEvent[] } {
  if (state.isArrived) {
    return { newState: { ...state, lastGps: gps }, events: [] };
  }

  const events: NavigationEvent[] = [];
  const route = state.route;
  const newSpoken = new Set(state.spokenKeys);
  let currentIdx = state.currentManeuverIndex;

  // The "next maneuver" is the one we're approaching. Its location is the
  // first point of that maneuver's segment in the polyline.
  const nextManeuverIdx = currentIdx + 1;
  const nextManeuver = route.maneuvers[nextManeuverIdx];

  // Speak the "depart" pre/post cue once at the very start
  if (currentIdx === 0 && !newSpoken.has("0-depart")) {
    const departCue =
      route.maneuvers[0]?.voice.pre || route.maneuvers[0]?.voice.post;
    if (departCue) {
      events.push({ kind: "speak", text: departCue, priority: "normal" });
      newSpoken.add("0-depart");
    }
  }

  // No next maneuver → we're on the final leg, check for arrival
  if (!nextManeuver) {
    const lastPoint = route.geometry[route.geometry.length - 1];
    if (lastPoint) {
      const dist = distanceMeters(gps, { lat: lastPoint[1], lng: lastPoint[0] });
      if (dist < ARRIVE_THRESHOLD_M) {
        events.push({ kind: "arrived" });
        const arriveCue =
          route.maneuvers[route.maneuvers.length - 1]?.voice.alert ||
          "You have arrived at your destination.";
        events.push({ kind: "speak", text: arriveCue, priority: "high" });
        return {
          newState: {
            ...state,
            lastGps: gps,
            isArrived: true,
            spokenKeys: newSpoken,
          },
          events,
        };
      }
    }
    return {
      newState: { ...state, lastGps: gps, spokenKeys: newSpoken },
      events,
    };
  }

  // Get the location of the next maneuver from the polyline
  const nextPoint = route.geometry[nextManeuver.beginShapeIndex];
  if (!nextPoint) {
    // Defensive: invalid index, just skip
    return {
      newState: { ...state, lastGps: gps, spokenKeys: newSpoken },
      events,
    };
  }
  const distToNext = distanceMeters(gps, {
    lat: nextPoint[1],
    lng: nextPoint[0],
  });

  // Emit progress every tick
  events.push({
    kind: "progress",
    distanceToNextManeuverM: distToNext,
    currentManeuverIndex: currentIdx,
  });

  // PRE cue: in the "approaching" band
  if (distToNext < PRE_THRESHOLD_M && distToNext > ALERT_THRESHOLD_M) {
    const key = `${nextManeuverIdx}-pre`;
    if (!newSpoken.has(key) && nextManeuver.voice.pre) {
      events.push({
        kind: "speak",
        text: nextManeuver.voice.pre,
        priority: "normal",
      });
      newSpoken.add(key);
    }
  }

  // ALERT cue: very close
  if (distToNext < ALERT_THRESHOLD_M && distToNext > ADVANCE_THRESHOLD_M) {
    const key = `${nextManeuverIdx}-alert`;
    if (!newSpoken.has(key) && nextManeuver.voice.alert) {
      events.push({
        kind: "speak",
        text: nextManeuver.voice.alert,
        priority: "normal",
      });
      newSpoken.add(key);
    }
  }

  // ADVANCE: we've passed the maneuver point, move on
  if (distToNext < ADVANCE_THRESHOLD_M) {
    currentIdx = nextManeuverIdx;
    events.push({ kind: "advance", toIndex: currentIdx });
    // Speak the post cue of the maneuver we just completed
    const justDone = route.maneuvers[currentIdx];
    const postKey = `${currentIdx}-post`;
    if (justDone?.voice.post && !newSpoken.has(postKey)) {
      events.push({
        kind: "speak",
        text: justDone.voice.post,
        priority: "low",
      });
      newSpoken.add(postKey);
    }
  }

  return {
    newState: {
      ...state,
      currentManeuverIndex: currentIdx,
      spokenKeys: newSpoken,
      lastGps: gps,
    },
    events,
  };
}
