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

# Every UAT above this is a candidate to be a centre. 7,500 rather than the brief's 15,000:
# at 15,000 only 134 UATs qualify nationally, so most counties fall back on promotion to
# reach their minimum, and the map is shaped more by that fallback than by the threshold.
# At 7,500 the candidate set is 686 and the threshold does the work it is there to do.
ABSORBER_POP_THRESHOLD_DEFAULT: Final = 7_500
ABSORBER_POP_THRESHOLD_RANGE: Final = (5_000, 50_000)

# Three radii now, because there are three kinds of centre.
#
# Bucharest is the only national capital and it cannot cross a county line, so its 15 km
# reaches nothing but its own sectors — the value is there for completeness, not effect.
R_NATIONAL_DEFAULT_M: Final = 15_000
R_CAP_DEFAULT_M: Final = 10_000
R_TOWN_DEFAULT_M: Final = 10_000
RADIUS_RANGE_M: Final = (5_000, 30_000)

# Every county aims for at least this many centres, promoting more where the threshold
# leaves it short. A county with one centre is not a reformed county, it is a county with
# one very large unit.
N_MIN_DEFAULT: Final = 5
N_MIN_RANGE: Final = (1, 10)

R_SEP_DEFAULT_M: Final = 15_000
R_SEP_RANGE_M: Final = (0, 30_000)

MIN_OVERLAP_DEFAULT: Final = 0.10
MIN_OVERLAP_RANGE: Final = (0.0, 0.5)

P_ORPHAN_DEFAULT: Final = 5_000
P_ORPHAN_RANGE: Final = (0, 15_000)

# Minimum population a resulting unit should reach once everything else has run.
#
# Off by default. The gravitational rules answer "who can reach whom"; this answers a
# different question — "is the result big enough to be worth having" — so it is a separate,
# clearly-labelled step rather than something folded into the radii, where it would quietly
# change what a radius means.
P_TARGET_DEFAULT: Final = 50_000
P_TARGET_RANGE: Final = (0, 100_000)

# How far a commune may be from its centre, by road, to be absorbed at all.
#
# Without a cap, growth is limited only by the radius and by who else is competing, and in a
# sparse county nobody competes: Cernavodă reached Ostrov 59 km away, and Constanța reached
# Vulturu at 60 km, giving units as wide as the county. A radius says how far a centre
# *pulls*; this says how far anyone should reasonably have to travel to their own town hall.
# 50 km rather than 35: at 35 km the cap and a 50,000 target pull hard against each other
# and 303 of 420 units finish short, because a compact unit in a sparse county simply cannot
# find 50,000 people. At 50 km no unit breaches the cap and 143 fall short. Both are sliders;
# this is the point where they stop fighting.
MAX_ROAD_DEFAULT_M: Final = 50_000
MAX_ROAD_RANGE_M: Final = (10_000, 80_000)

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
TIER_NATIONAL_CAPITAL: Final = 0
TIER_COUNTY_CAPITAL: Final = 1
TIER_POPULATION: Final = 2
TIER_PROMOTED: Final = 3
