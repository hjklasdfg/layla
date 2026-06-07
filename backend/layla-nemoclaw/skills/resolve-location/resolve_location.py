"""Skill 2 — resolve GPS coordinates to a street address via OSM Nominatim."""
from __future__ import annotations

import os
from typing import Any

import requests

NOMINATIM_URL = os.getenv(
    "NOMINATIM_URL", "https://nominatim.openstreetmap.org/reverse"
)
NOMINATIM_USER_AGENT = os.getenv("NOMINATIM_USER_AGENT", "LaylaHackathonDemo/1.0")


def run(lat: float, lng: float) -> dict[str, Any]:
    """Reverse-geocode WGS84 coordinates using OpenStreetMap Nominatim."""
    res = requests.get(
        NOMINATIM_URL,
        params={
            "format": "jsonv2",
            "lat": lat,
            "lon": lng,
            "addressdetails": 1,
        },
        headers={"User-Agent": NOMINATIM_USER_AGENT},
        timeout=10,
    )

    res.raise_for_status()
    data = res.json()
    address = data.get("address", {})

    return {
        "lat": lat,
        "lng": lng,
        "display_name": data.get("display_name"),
        "road": address.get("road") or address.get("pedestrian") or address.get("footway"),
        "borough": (
            address.get("city_district")
            or address.get("borough")
            or address.get("suburb")
            or address.get("town")
            or "Unknown"
        ),
        "postcode": address.get("postcode"),
        "country": address.get("country"),
        "source": "nominatim",
    }
