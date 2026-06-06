export interface CrimeIncident {
  crimeId: string;
  month: string;
  latitude: number;
  longitude: number;
  location: string;
  crimeType: string;
  outcome: string;
}

export interface CrimeIncidentMeta {
  sourceFile: string;
  totalRows: number;
  mappedCount: number;
  unmappedCount: number;
}

export interface CrimeIncidentResponse {
  incidents: CrimeIncident[];
  meta: CrimeIncidentMeta;
}
