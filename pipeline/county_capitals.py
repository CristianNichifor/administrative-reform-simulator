"""The 41 county capitals, by SIRUTA.

These are tier-0 absorbers: they are processed before every other seed and get the larger
`R_cap` radius, so getting one wrong changes the map across an entire county.

This is an explicit table rather than a derived rule on purpose. The obvious heuristic —
"the highest-ranked, then largest, UAT in each county" — is right 40 times out of 41 and
wrong for **Ilfov**, whose capital is Buftea (14k) while Otopeni (17k) is larger and shares
its rank. County seats are fixed by law, not by size, so they are recorded as law rather
than inferred from population.

Bucharest is not in this table. Its six sectors are all tier-0 seeds in their own right
(brief §2 step 1) and are identified by county code B.
"""

from __future__ import annotations

from typing import Final

# SIRUTA -> county code. Names are comments only; the SIRUTA is the key, so diacritics and
# renames cannot break the lookup.
COUNTY_CAPITAL_SIRUTA: Final[dict[str, str]] = {
    "1017": "AB",  # Municipiul Alba Iulia
    "13169": "AG",  # Municipiul Pitești
    "9262": "AR",  # Municipiul Arad
    "20297": "BC",  # Municipiul Bacău
    "26564": "BH",  # Municipiul Oradea
    "32394": "BN",  # Municipiul Bistrița
    "42682": "BR",  # Municipiul Brăila
    "35731": "BT",  # Municipiul Botoșani
    "40198": "BV",  # Municipiul Brașov
    "44818": "BZ",  # Municipiul Buzău
    "54975": "CJ",  # Municipiul Cluj-Napoca
    "92569": "CL",  # Municipiul Călărași
    "50790": "CS",  # Municipiul Reșița
    "60419": "CT",  # Municipiul Constanța
    "63394": "CV",  # Municipiul Sfântu Gheorghe
    "65342": "DB",  # Municipiul Târgoviște
    "69900": "DJ",  # Municipiul Craiova
    "77812": "GJ",  # Municipiul Târgu Jiu
    "75098": "GL",  # Municipiul Galați
    "100521": "GR",  # Municipiul Giurgiu
    "86687": "HD",  # Municipiul Deva
    "83320": "HR",  # Municipiul Miercurea Ciuc
    "100576": "IF",  # Oraș Buftea — NOT Otopeni; see module docstring
    "92658": "IL",  # Municipiul Slobozia
    "95060": "IS",  # Municipiul Iași
    "109773": "MH",  # Municipiul Drobeta-Turnu Severin
    "106318": "MM",  # Municipiul Baia Mare
    "114319": "MS",  # Municipiul Târgu Mureș
    "120726": "NT",  # Municipiul Piatra-Neamț
    "125347": "OT",  # Municipiul Slatina
    "130534": "PH",  # Municipiul Ploiești
    "143450": "SB",  # Municipiul Sibiu
    "139704": "SJ",  # Municipiul Zalău
    "136483": "SM",  # Municipiul Satu Mare
    "146263": "SV",  # Municipiul Suceava
    "159614": "TL",  # Municipiul Tulcea
    "155243": "TM",  # Municipiul Timișoara
    "151790": "TR",  # Municipiul Alexandria
    "167473": "VL",  # Municipiul Râmnicu Vâlcea
    "174744": "VN",  # Municipiul Focșani
    "161945": "VS",  # Municipiul Vaslui
}

EXPECTED_CAPITAL_COUNT: Final = 41
