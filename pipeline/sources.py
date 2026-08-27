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

# Display geometry. The full-resolution boundaries are 119 MB and exist for area
# calculations, not for drawing; this pre-simplified layer is 3.9 MB (0.9 MB gzipped) and
# is what the map renders.
#
# Preferred over simplifying ourselves because it is topologically consistent: running
# shapely's simplify() over 3,186 independent polygons tears shared borders apart, leaving
# visible slivers and gaps between neighbouring communes on a choropleth. Preferred over
# PMTiles for v1 because it needs no tippecanoe in the build, and at under a megabyte
# gzipped the streaming a tileset buys is not yet worth the toolchain.
WFS_LAU_SIMPLIFIED_TYPENAME: Final = "administrative-boundaries:ro_admin_lau_simplified_polygon"


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

# Context layers for the map. None of these feed the model — they exist so a reader can see
# the constraints the model works under: a region can never cross a county line, and the
# development regions are the tier above that.
WFS_COUNTY_LINE_TYPENAME: Final = "administrative-boundaries:ro_admin_county_simplified_line"
WFS_REGION_LINE_TYPENAME: Final = "administrative-boundaries:ro_admin_region_simplified_line"


# --- Locality points (UAT seats) --------------------------------------------------------
# The brief specifies taking commune seats from SIRUTA's `reședință de comună` and their
# coordinates from OSM `place=village/town`, explicitly not polygon centroids.
#
# This layer is better than that plan: it is the SIRUTA locality nomenclator *with*
# geometry, so no name-based match against OSM is needed at all. Every locality carries
# its own SIRUTA (`natCode`), its parent UAT's SIRUTA (`supCode`) and its SIRUTA rank:
#
#   I    Bucuresti
#   II   municipiu resedinta de judet
#   III  other municipii and orase
#   IV   sat resedinta de comuna
#   V    sat component
#
# The seat of a UAT is the locality whose supCode is that UAT and whose rank is the most
# significant present — rank V localities are never seats.
LOCALITIES = Source(
    key="uat_seats",
    title="SIRUTA locality points, Romania",
    url=f"{WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature"
    f"&typeNames=geospatial:ro_localitati_punct",
    licence="CC BY-SA 4.0",
    attribution="SIRUTA / ANCPI, republished by geo-spatial.org",
    note="13,750 localities. natCode=locality SIRUTA, supCode=parent UAT SIRUTA, rank=I-V.",
)

WFS_LOCALITIES_TYPENAME: Final = "geospatial:ro_localitati_punct"

# Ranks that can denote a UAT seat, most significant first. Rank V is a component village
# and is never a seat.
SEAT_RANKS: Final[tuple[str, ...]] = ("I", "II", "III", "IV")


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


# --- Budget execution -------------------------------------------------------------------
# The savings metric is the operating expenditure a merger would remove:
#
#   sum(operating_expenditure of all members) - operating_expenditure(absorber)
#
# Development spending is excluded, because merging two town halls does not stop a road
# from needing to be built.
#
# Transparenta.eu models that distinction as a first-class enum on the fact table
# (functionare / dezvoltare), so it does not have to be derived from COFOG3 economic codes.
# Measured for 2024: 109.4 bn RON operating + 55.2 bn development = 164.6 bn, against a
# 164.7 bn unfiltered total, so the split is exhaustive and nothing falls between the two.
#
# REPORT TYPE — the decision that matters. The Ministry publishes the same money more than
# once: once per institution in detail, and again rolled up per principal and per secondary
# ordonator. Summing a mixture double-counts. PRINCIPAL_AGGREGATED is the right single
# choice here: one row per top-level spending authority, which for local government is the
# UAT itself, so it captures the commune plus its subordinate institutions exactly once.
FINANCE = Source(
    key="uat_finance",
    title="Budget execution per UAT, split operating vs development",
    url=GRAPHQL_ENDPOINT,
    licence="Apache-2.0 (software); underlying data Ministerul Finanțelor, public",
    attribution="Transparenta.eu, data from Ministerul Finanțelor",
    note=(
        "heatmapUATData with report_type PRINCIPAL_AGGREGATED and is_uat true. "
        "Bucharest is returned both as the municipality and as its six sectors; the "
        "municipality is a county-level row and drops out on the SIRUTA join."
    ),
)

# Latest complete execution year. Bump deliberately: every savings figure moves with it.
FINANCE_YEAR: Final = 2024

# 'ch' is expenditure, 'vn' is income.
FINANCE_ACCOUNT_CATEGORY: Final = "ch"
FINANCE_REPORT_TYPE: Final = "PRINCIPAL_AGGREGATED"
EXPENSE_TYPES: Final[tuple[str, ...]] = ("functionare", "dezvoltare")

# Functional-classification prefix for "Autorități publice și acțiuni externe" — the town
# hall itself: the mayor's office, the council, the administrative staff.
#
# This matters more than it looks. Operating expenditure is 109.4 bn RON nationally, but
# only 14.7 bn of that is administration; the remaining 94.7 bn is schools, social
# assistance, health, culture and utilities. Merging two town halls does not stop a school
# needing teachers, so applying the brief's savings formula to the whole operating figure
# claims a saving of 31.8 bn RON — 29% of all local spending in Romania — which no mayor
# would accept and no journalist should repeat.
#
# Both figures are therefore carried: administration as the defensible headline, and the
# full operating figure as an explicit upper bound.
ADMIN_FUNCTIONAL_PREFIX: Final = "51"

# Economic classification prefix for "Cheltuieli de personal" — wages and contributions.
# Crossed with the administration function it gives the wage bill of the town hall itself,
# which is the part of a merger's saving that is a payroll rather than an estimate.
PERSONNEL_ECONOMIC_PREFIX: Final = "10"


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


ALL_SOURCES: Final[tuple[Source, ...]] = (
    BOUNDARIES,
    BOUNDARY_LINES,
    LOCALITIES,
    ATTRIBUTES,
    ROADS,
)
