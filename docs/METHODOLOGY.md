# Methodology / Metodologie

> **Stub.** This document will carry the full specification of the accretion model, written
> for a non-technical reader, in Romanian and English. It is written last on purpose: the
> algorithm's parameters are still being validated against real geometry, and a methodology
> document that describes an algorithm nobody has run yet is a liability.
>
> The authoritative specification until then is the project brief, §2.

## What this tool does / Ce face acest instrument

**EN.** This is an analysis instrument for public debate. It simulates what Romania's
administrative map would look like under a set of explicit, mechanical merger rules, and
lets anyone change the rules and see the result. It is **not** an official proposal, and no
scenario it produces is a recommendation by anyone.

**RO.** Acesta este un instrument de analiză pentru dezbaterea publică. Simulează cum ar
arăta harta administrativă a României pe baza unor reguli de fuziune explicite și mecanice,
și permite oricui să schimbe regulile și să vadă rezultatul. **Nu** este o propunere
oficială, iar niciun scenariu produs nu reprezintă o recomandare.

## Why the rules are simple / De ce sunt regulile simple

**EN.** The model is deterministic: the same settings always produce exactly the same map.
It uses no optimization and no randomness. This is a deliberate trade-off. Optimization
methods produce more balanced maps, but nobody — not a journalist, not a mayor, not a
statistician — can reconstruct why a particular commune ended up in a particular region.
Here, they can. Every absorption follows from rules that fit in a paragraph, and every
result can be disputed on its merits.

**RO.** Modelul este determinist: aceleași setări produc întotdeauna exact aceeași hartă.
Nu folosește optimizare și nici aleatoriu. Este un compromis asumat. Metodele de optimizare
produc hărți mai echilibrate, dar nimeni — nici jurnalist, nici primar, nici statistician —
nu poate reconstitui de ce o anumită comună a ajuns într-o anumită regiune. Aici se poate.
Fiecare absorbție decurge din reguli care încap într-un paragraf, iar fiecare rezultat poate
fi contestat pe fond.

## To be written / De scris

- [ ] Parameters and their defaults, in plain language
- [ ] Seed selection, and why dispersion rather than raw population
- [ ] Candidacy: why polygons are buffered, not points
- [ ] Accretion: why regions grow in waves and cannot leapfrog
- [ ] Conflict resolution order
- [ ] The orphan tier, and how it differs from gravitational absorption
- [ ] The savings figure: what it includes, what it excludes, and what it does not claim
- [ ] Known limitations and what the model deliberately ignores
- [ ] Data sources, vintages, and every SIRUTA reconciliation decision
