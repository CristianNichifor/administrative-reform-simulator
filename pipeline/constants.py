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

# Promotion compares candidate populations in bands of this size rather than exactly.
#
# Walking straight down the population list takes the first town that clears the separation
# floor, and once cleared, distance stops mattering — so a town 15.1 km from an existing
# centre beat one of almost the same size 30 km away, and 15 of the 41 counties ended with
# their centres clustered rather than spread. Within a band the candidates count as the same
# size and the better-placed one wins. A quarter of the default threshold: wide enough that
# near-equal towns compete on position, narrow enough that a genuinely bigger town still
# wins outright.
PROMOTION_POPULATION_BAND: Final = 3_000

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
# Minimum shape score a unit may end with, on the Polsby-Popper ratio: 4*pi*area over
# perimeter squared, where 1.0 is a circle and a long ragged strip tends to zero.
#
# Off by default. Shape is the one goal that trades directly against the trip to the town
# hall — the commune that tidies an outline is often not the one nearest a seat — and the
# choice between them belongs to whoever is reading the map, not to this file. At 0 nothing
# is refused. The median unit scores 0.24 and a fifth fall below 0.20, so 0.15 tidies the
# worst edges and 0.25 reshapes most of the country.
MIN_COMPACTNESS_DEFAULT: Final = 0.0

# Two absorbers this close to the same commune count as equally close, and the one holding
# less takes it. Raw distance decides contests by metres, which is a precision the road data
# does not have and which means nothing administratively: a commune 4.1 km from one centre
# and 4.4 km from another is, to anyone living there, the same distance from both. Letting
# size decide inside that band is what stops one centre reaching 60,000 beside one at 15,000.
# Zero restores the old ordering exactly, so the default changes no result.
R_TIE_DEFAULT_M: Final = 3_000

# A unit below this, with no partner the distance cap allows, is a leftover rather than a
# small unit, and the last-resort pass may break the cap to place it. Above it a unit that
# the cap has stranded is left alone: it is small, but it is a real administration and
# dissolving it into a neighbour 60 km away is the worse answer. Set to the target it would
# rescue every stranded unit and collapse municipii like Vatra Dornei into their neighbours.
P_STRANDED_DEFAULT: Final = 15_000
MIN_COMPACTNESS_RANGE: Final = (0.0, 0.35)

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

# The Danube Delta communes, where the channels are the transport network rather than roads.
#
# Two rules bend here, and only here. Borders between them count as crossable even with no
# road, and a merge between two Delta units is exempt from the road-distance cap. Both follow
# from the same fact: there is no alternative administration to compare against. Sulina is
# reached by boat, Pardina is 57.8 km from it by water, and the choice is one Delta unit or
# five that cannot function. Anywhere else a 57.8 km trip to the town hall would be a reason
# to refuse the merge; here it is simply what the Delta is.
DELTA_WATER_UATS: Final[frozenset[str]] = frozenset(
    {
        "159767",  # Oras Sulina
        "160261",  # Crisan
        "160172",  # Chilia Veche
        "159883",  # C.A. Rosetti
        "161231",  # Sfantu Gheorghe
        "160779",  # Maliuc
        "161133",  # Pardina
        "160047",  # Ceatalchioi
        "160911",  # Murighiol
    }
)

# Bucharest's Ilfov ring: the one county line a single unit is allowed to cross.
BUCHAREST_RING_COUNTY: Final = "IF"

# Administrative standing, smaller is more significant. Legea 351/2001 ranks settlements;
# this is the same idea reduced to what the model needs to order two seats against each
# other. Anything at or above `oras` is a town rather than a village-based commune.
ADMIN_RANK_SECTOR: Final = 0
ADMIN_RANK_COUNTY_SEAT: Final = 1
ADMIN_RANK_MUNICIPIU: Final = 2
ADMIN_RANK_ORAS: Final = 3
ADMIN_RANK_COMUNA: Final = 4


def admin_rank_of(natlevname: str) -> int:
    """Administrative standing from the SIRUTA level name.

    Shared rather than duplicated: the model orders seats by this and the web export ships
    it, and two hand-written copies of the same string matching would drift silently.
    """
    # Order matters, and so does matching the whole phrase. SIRUTA writes exactly five
    # level names:
    #
    #   Sectoarele municipiului Bucuresti
    #   Municipiu resedinta de judet
    #   Municipiu, altul decat resedinta de judet
    #   Oras
    #   Comuna
    #
    # Two of them are substring traps. "Sectoarele" does not contain "sector", so a test for
    # "sector" silently ranked the six sectors as municipii. And "altul decat resedinta de
    # judet" contains "resedinta de judet", so a test for that phrase ranked every ordinary
    # municipiu as a county seat — 92 units carried county-seat standing and one carried
    # municipiu standing, which is the wrong way round.
    text = str(natlevname).lower()
    if "sectoarele" in text:
        return ADMIN_RANK_SECTOR
    if "altul decat" in text:
        return ADMIN_RANK_MUNICIPIU
    if "resedinta de judet" in text:
        return ADMIN_RANK_COUNTY_SEAT
    if "municipiu" in text:
        return ADMIN_RANK_MUNICIPIU
    if "oras" in text:
        return ADMIN_RANK_ORAS
    return ADMIN_RANK_COMUNA


# --- Absorber tiers --------------------------------------------------------------------
# Accretion processes tiers in this order, exhausting each before starting the next.
# The values are the sort keys, so they must stay ordered and must not be reordered
# casually: changing them changes every conflict resolution in the model.
TIER_NATIONAL_CAPITAL: Final = 0
TIER_COUNTY_CAPITAL: Final = 1
TIER_POPULATION: Final = 2
TIER_PROMOTED: Final = 3
