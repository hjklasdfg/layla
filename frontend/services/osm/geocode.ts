export interface GeocodedPlace {
  lat: number;
  lon: number;
  displayName: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

/** Geocode a place name via Nominatim (OpenStreetMap). */
export async function geocodePlace(
  query: string,
  options: { nominatimUrl: string; userAgent: string; biasLondon?: boolean }
): Promise<GeocodedPlace> {
  const q =
    options.biasLondon !== false && !/london|uk|united kingdom/i.test(query)
      ? `${query}, London, UK`
      : query;

  const url = new URL(`${options.nominatimUrl}/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": options.userAgent, Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Nominatim geocoding failed (${res.status}) for "${query}"`);
  }

  const data = (await res.json()) as NominatimResult[];
  if (!data.length) {
    throw new Error(`No geocoding results for "${query}"`);
  }

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  };
}
