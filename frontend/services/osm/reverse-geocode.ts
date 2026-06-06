export interface ReverseGeocodedPlace {
  displayName: string;
  borough?: string;
  road?: string;
  postcode?: string;
  city?: string;
}

interface NominatimReverseResult {
  display_name: string;
  address?: {
    road?: string;
    suburb?: string;
    borough?: string;
    city_district?: string;
    city?: string;
    town?: string;
    postcode?: string;
    county?: string;
  };
}

/** Reverse geocode lat/lon via Nominatim (OpenStreetMap). */
export async function reverseGeocode(
  lat: number,
  lon: number,
  options: { nominatimUrl: string; userAgent: string }
): Promise<ReverseGeocodedPlace> {
  const url = new URL(`${options.nominatimUrl}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": options.userAgent, Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Reverse geocoding failed (${res.status})`);
  }

  const data = (await res.json()) as NominatimReverseResult;
  const addr = data.address ?? {};

  const borough =
    addr.borough ??
    addr.city_district ??
    addr.suburb ??
    addr.county ??
    undefined;

  return {
    displayName: data.display_name,
    borough,
    road: addr.road,
    postcode: addr.postcode,
    city: addr.city ?? addr.town,
  };
}
