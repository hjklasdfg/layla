/** Normalized journey option from TfL Journey API. */
export interface RouteCandidate {
  id: string;
  etaMin: number;
  transferCount: number;
  walkingMinutes: number;
  modes: string[];
  disruptions: string[];
  instructions: string[];
  steps: JourneyStep[];
  stopPointIds: string[];
  lineIds: string[];
  rawJourney: TfLRawJourney;
}

/** One leg of a journey — walk, tube, bus, etc. */
export interface JourneyStep {
  order: number;
  mode: string;
  modeLabel: string;
  durationMin: number;
  from: string;
  to: string;
  line?: string;
  instruction: string;
  /** Live minutes until the next service boards at this step. */
  nextServiceInMin?: number;
  connectionWaitMin?: number;
  connectionRisk?: ConnectionRisk;
  connectionNote?: string;
  /** Extra wait beyond TfL planned time (added to ETA). */
  extraWaitMin?: number;
}

export type ConnectionRisk = "immediate" | "tight" | "comfortable" | "long";

export interface ConnectionTiming {
  legIndex: number;
  stopName: string;
  line?: string;
  mode: string;
  nextServiceMin: number;
  scheduledWaitMin?: number;
  extraWaitMin: number;
  risk: ConnectionRisk;
  isTransfer: boolean;
  note: string;
}

export interface ArrivalInfo {
  destination: string;
  arrivalMinutes: number;
  lineName?: string;
  modeName?: string;
}

export interface LineStatus {
  line: string;
  severity: number;
  description: string;
}

export interface StopPointSummary {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
}

/** TfL Journey API — typed subset used by parsers. */
export interface TfLRawJourney {
  duration?: number;
  legs?: TfLJourneyLeg[];
}

export interface TfLJourneyLeg {
  duration?: number;
  mode?: { id?: string; name?: string };
  instruction?: { summary?: string; detailed?: string };
  disruptions?: TfLDisruption[];
  routeOptions?: Array<{ name?: string; lineIdentifier?: { id?: string; name?: string } }>;
  scheduledDepartureTime?: string;
  scheduledArrivalTime?: string;
  departureTime?: string;
  arrivalTime?: string;
  departurePoint?: {
    naptanId?: string;
    commonName?: string;
    lat?: number;
    lon?: number;
  };
  arrivalPoint?: {
    naptanId?: string;
    commonName?: string;
    lat?: number;
    lon?: number;
  };
  path?: {
    /** TfL often returns this as a JSON string of [lat, lon] pairs. */
    lineString?:
      | string
      | Array<
          | { lat?: number; lon?: number }
          | [number, number]
        >;
  };
}

export interface TfLDisruption {
  category?: string;
  categoryDescription?: string;
  description?: string;
  summary?: string;
}

export interface TfLJourneyResultsResponse {
  journeys?: TfLRawJourney[];
  fromLocationDisambiguation?: TfLDisambiguation;
  toLocationDisambiguation?: TfLDisambiguation;
}

export interface TfLLineStatusResponse {
  id?: string;
  name?: string;
  lineStatuses?: Array<{
    statusSeverity?: number;
    statusSeverityDescription?: string;
    reason?: string;
  }>;
}

export interface TfLArrivalResponse {
  destinationName?: string;
  expectedArrival?: string;
  timeToStation?: number;
  lineName?: string;
  modeName?: string;
}

export interface TfLStopPointSearchResult {
  naptanId?: string;
  id?: string;
  commonName?: string;
  name?: string;
  lat?: number;
  lon?: number;
}

export interface TfLStopPointSearchResponse {
  query?: string;
  total?: number;
  matches?: TfLStopPointSearchResult[];
}

export interface TfLPlaceSearchResult {
  id?: string;
  name?: string;
  lat?: number;
  lon?: number;
}

export interface TfLStopPointDetail {
  naptanId?: string;
  id?: string;
  commonName?: string;
  name?: string;
  lat?: number;
  lon?: number;
}

export interface TfLDisambiguationOption {
  parameterValue?: string;
  place?: { name?: string; naptanId?: string; lat?: string; lon?: string };
}

export interface TfLDisambiguation {
  disambiguationOptions?: TfLDisambiguationOption[];
}

export class TflApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = "TflApiError";
  }
}

/** Legacy snapshot types — used by event simulator and mock adapters. */
export interface LiftOutage {
  station: string;
  line: string;
  active: boolean;
}

export interface LegacyLineStatus {
  id: string;
  name: string;
  severity: "good" | "minor" | "severe";
  delayMinutes?: number;
}

export interface BusArrival {
  routeId: string;
  stopName: string;
  minutesAway: number;
}

export interface TfLRouteSnapshot {
  liftOutages: LiftOutage[];
  lineStatuses: LegacyLineStatus[];
  busArrivals: BusArrival[];
}

export interface TfLNormalized {
  reliabilityImpact: number;
  accessibilityImpact: number;
  predictabilityImpact: number;
  transportDelayRisk: number;
  liftOutageRisk: number;
  evidence: string[];
}
