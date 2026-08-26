"""Declarations of every external data source, in one place.

Each source records where it comes from, what licence it carries and why it was chosen over
the alternative the brief named. Keeping the provenance next to the URL means the
attribution block in the UI and in METHODOLOGY.md can be generated rather than remembered.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class Source:
    key: str
    title: str
    url: str
    licence: str
    attribution: str
    note: str = ""


# --- Boundaries -----------------------------------------------------------------------
# The brief names the ANCPI geoportal, with OSM admin_level=8 as fallback. As of
# 2026-08-26 `geoportal.ancpi.ro` does not resolve in DNS at all (the parent domain
# ancpi.ro does), so the official portal is not directly fetchable.
#
# geo-spatial.org republishes the ANCPI RELUAT boundaries, already projected to EPSG:3844
# and carrying the SIRUTA code as `natcode`. That is closer to the brief's intent than the
# OSM fallback: it is the official geometry, just mirrored, and it avoids OSM's
# admin_level=8 tagging inconsistencies. Preferred accordingly, with OSM still available
# as the documented fallback.
WFS_BASE: Final = "https://services.geo-spatial.org/geoserver/ows"

BOUNDARIES = Source(
    key="uat_boundaries",
    title="UAT boundaries (polygon), Romania",
    url=f"{WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature"
    f"&typeNames=administrative-boundaries:ro_admin_lau_polygon",
    licence="CC BY-SA 4.0",
    attribution="ANCPI (RELUAT), republished by geo-spatial.org",
    note=(
        "EPSG:3844 natively. 3,186 features. Carries `natcode` (SIRUTA) and county, "
        "but no UAT name — names come from the attributes source and are joined on SIRUTA."
    ),
)

WFS_LAU_TYPENAME: Final = "administrative-boundaries:ro_admin_lau_polygon"


# --- Shared boundaries (adjacency) -------------------------------------------------------
# The brief specifies deriving adjacency via Queen contiguity and then extracting each
# shared boundary with ST_Intersection. This layer supplies both directly: it is the
# official boundary-segment geometry, and each segment already carries the SIRUTA code of
# the UAT on either side.
#
# Preferred over deriving it because the segments are the authoritative boundaries rather
# than an intersection we computed, which removes a class of sliver/precision artefacts at
# the exact step where they would matter — the 50 m buffer used for the road test.
#
# `leftid`/`rightid` of 0 means the other side is outside Romania (national border).
# Segments are not unique per pair: one shared border can be split across several segments,
# so they must be dissolved onto an unordered (min, max) SIRUTA pair.
BOUNDARY_LINES = Source(
    key="uat_boundary_lines",
    title="UAT shared boundary segments, Romania",
    url=f"{WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature"
    f"&typeNames=administrative-boundaries:ro_admin_lau_line",
    licence="CC BY-SA 4.0",
    attribution="ANCPI (RELUAT), republished by geo-spatial.org",
    note=(
        "9,644 segments, EPSG:3844. leftid/rightid are SIRUTA; 0 means the national "
        "border. legalstat records whether the boundary is legally agreed."
    ),
)

WFS_LAU_LINE_TYPENAME: Final = "administrative-boundaries:ro_admin_lau_line"


# --- Attributes: SIRUTA, name, county, population ---------------------------------------
# Transparenta.eu's public GraphQL API. Its UATs table is built from
# `uat_cif_pop_2021.csv` — INS Census 2021, the vintage the brief specifies — and has
# already reconciled SIRUTA against CIF.
#
# Why this rather than INS directly: insse.ro publishes only an AAAA record and is not
# reachable over IPv4; and more importantly the census layers on the geo-spatial WFS carry
# `Nume`/`Judet` but no SIRUTA, so joining them to the boundaries would mean a name-based
# join across diacritics and duplicate commune names. This source has the code, so the
# join is on the code.
GRAPHQL_ENDPOINT: Final = "https://api.transparenta.eu/graphql"

ATTRIBUTES = Source(
    key="uat_attributes",
    title="UAT attributes: SIRUTA, name, county, population (Census 2021)",
    url=GRAPHQL_ENDPOINT,
    licence="Apache-2.0 (software); underlying data INS/MF, public",
    attribution="Transparenta.eu (hack-for-facts-eb-server), data from INS Census 2021",
    note=(
        "3,186 non-county UATs plus 42 county-level rows; filter is_county:false. "
        "Query politely: this is a volunteer-run public service, not our infrastructure."
    ),
)


# --- Roads ------------------------------------------------------------------------------
# Only ever used for a binary 'does a road cross this shared border' test (brief §8
# rules out routing entirely), but that still needs the full road geometry.
ROADS = Source(
    key="osm_roads",
    title="OpenStreetMap Romania extract",
    url="https://download.geofabrik.de/europe/romania-latest.osm.pbf",
    licence="ODbL 1.0",
    attribution="© OpenStreetMap contributors",
    note="~312 MB. Only motorway/trunk/primary/secondary/tertiary/unclassified are used.",
)


ALL_SOURCES: Final[tuple[Source, ...]] = (BOUNDARIES, BOUNDARY_LINES, ATTRIBUTES, ROADS)
