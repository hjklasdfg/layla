export interface CameraObservation {
  crowdDensity: number;
  obstacleDensity: number;
  crossingVisibility: number;
}

export interface GpsLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
}

export interface CameraDataItem {
  routeId?: string;
  observation: CameraObservation;
  evidence: string[];
}

export interface TflRoutePayload {
  routeId: string;
  name: string;
  etaMin: number;
  signals: {
    accessibility: number;
    stress: number;
    reliability: number;
    predictability: number;
    crowding: number;
    crossingComplexity: number;
  };
  evidence: {
    tfl: string[];
    osm: string[];
    cv: string[];
  };
  risks: string[];
  strengths: string[];
}

export interface TflDataPayload {
  from: string;
  to: string;
  profile: string;
  osmWarning?: string;
  routes: TflRoutePayload[];
}

export interface MobilitySensorPayload {
  audioInput?: string;
  gps?: GpsLocation | null;
  cameraData?: CameraDataItem[];
  tflData?: TflDataPayload;
}
