"""Shared constants for the pipeline and the reference model.

Anything in here that the frontend also needs is exported to ``web/public/data/`` by
``export.py`` rather than duplicated by hand in TypeScript. Two hand-maintained copies of
the parameter defaults would drift, and a drifted default is a silent parity failure.
"""

from __future__ import annotations

from typing import Final

# --- Projection ---------------------------------------------------------------------
# All geometric work happens in Stereo 70. Buffering in WGS84 degrees produces
# north-south stretched ellipses, which would make every radius wrong by latitude.
CRS_STEREO70: Final = "EPSG:3844"
CRS_WGS84: Final = "EPSG:4326"


# --- Model parameters ---------------------------------------------------------------
# Defaults and UI ranges. Distances in metres; the UI presents kilometres.

ABSORBER_POP_THRESHOLD_DEFAULT: Final = 15_000
ABSORBER_POP_THRESHOLD_RANGE: Final = (5_000, 50_000)

R_CAP_DEFAULT_M: Final = 15_000
R_TOWN_DEFAULT_M: Final = 10_000
RADIUS_RANGE_M: Final = (5_000, 30_000)

N_MIN_DEFAULT: Final = 5
N_MIN_RANGE: Final = (1, 10)

R_SEP_DEFAULT_M: Final = 15_000
R_SEP_RANGE_M: Final = (0, 30_000)

MIN_OVERLAP_DEFAULT: Final = 0.10
MIN_OVERLAP_RANGE: Final = (0.0, 0.5)

P_ORPHAN_DEFAULT: Final = 5_000
P_ORPHAN_RANGE: Final = (0, 15_000)

# Seed-promotion relaxation (brief §2 step 1): when no candidate satisfies the separation
# constraint, shrink it stepwise rather than failing outright, and give up below the floor.
R_SEP_RELAXATION_FACTOR: Final = 0.75
R_SEP_RELAXATION_FLOOR_M: Final = 2_000


# --- Candidacy precomputation grid ---------------------------------------------------
# Candidacy depends on radius, which is a slider, so it is precomputed over a discrete grid
# and the UI slider snaps to these values.
RADIUS_GRID_M: Final[tuple[int, ...]] = tuple(range(5_000, 30_001, 2_500))

# The floor of the X slider. Nothing below this can ever be an absorber, so nothing below
# this needs a precomputed candidacy row.
#
# NOTE: brief §4 marks this as a DECISION pending confirmation. It is baked into the
# precomputed grid — raising it later shrinks the grid harmlessly, but lowering it forces a
# full rebuild of build_candidacy.py output.
POTENTIAL_ABSORBER_POP_FLOOR: Final = 5_000

# Overlap fractions are quantised before storage to keep the packed grid small.
OVERLAP_QUANTISATION_DECIMALS: Final = 2


# --- Adjacency ------------------------------------------------------------------------
# Tolerance for testing whether a road crosses a shared border: the shared boundary is
# buffered by this much before intersecting against the road network.
SHARED_BORDER_BUFFER_M: Final = 50

# Sanity thresholds for the data-quality report. A UAT with no road-connected neighbour can
# never be absorbed and can never absorb, so a systematic error here silently removes
# territory from the model.
MAX_EXPECTED_ROAD_ISOLATED_UATS: Final = 10

OSM_ROAD_CLASSES: Final[tuple[str, ...]] = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
)


# --- Administrative structure ----------------------------------------------------------
EXPECTED_UAT_COUNT: Final = 3_186
EXPECTED_COUNTY_COUNT: Final = 42  # 41 judete + Bucuresti

# County codes as used by SIRUTA/INS. "B" is Bucuresti, whose sectors are treated as
# tier-0 seeds in their own right.
# fmt: off
# Kept as a readable grid: one row per ten counties is far easier to audit against an
# official list than 42 separate lines.
COUNTY_CODES: Final[tuple[str, ...]] = (
    "AB", "AR", "AG", "BC", "BH", "BN", "BT", "BV", "BR", "BZ",
    "CS", "CL", "CJ", "CT", "CV", "DB", "DJ", "GL", "GR", "GJ",
    "HR", "HD", "IL", "IS", "IF", "MM", "MH", "MS", "NT", "OT",
    "PH", "SM", "SJ", "SB", "SV", "TR", "TM", "TL", "VS", "VL",
    "VN", "B",
)
# fmt: on

BUCHAREST_COUNTY_CODE: Final = "B"


# --- Absorber tiers --------------------------------------------------------------------
# Accretion processes tiers in this order, exhausting each before starting the next.
# The values are the sort keys, so they must stay ordered and must not be reordered
# casually: changing them changes every conflict resolution in the model.
TIER_COUNTY_CAPITAL: Final = 0
TIER_POPULATION: Final = 1
TIER_PROMOTED: Final = 2
