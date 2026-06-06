export interface CrimeIncident {
  id: string;
  category: string;
  lat: number;
  lng: number;
  month: string;
  location: string;
}

export interface CrimeIncidentMeta {
  count: number;
  area: string;
  month: string;
}

export interface CrimeIncidentResponse {
  incidents: CrimeIncident[];
  meta: CrimeIncidentMeta;
}
