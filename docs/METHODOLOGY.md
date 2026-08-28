# Methodology / Metodologie

**English below. Versiunea în română începe [aici](#metodologie-română).**

---

## English

### What this is

An interactive map that simulates what Romania's administrative map would look like if
communes were merged according to a set of explicit, mechanical rules — and lets anyone
change the rules and see the result immediately.

It is an **analysis instrument for public debate**. It is not an official proposal, it does
not represent anyone's position, and no scenario it produces is a recommendation.

### What it deliberately is not

The model is **deterministic**: the same settings always produce exactly the same map, on
every machine, every time. It uses no optimization and no randomness.

This is a trade-off made on purpose, and it costs something real. Optimization methods —
Max-P regionalization and similar — produce more balanced maps that score better on
compactness and population evenness. What they cannot do is tell you *why* a particular
commune ended up in a particular region. The answer is "the solver put it there."

Here, every absorption follows from rules that fit in a paragraph. A journalist can
reconstruct any result, and a mayor can dispute the specific rule that moved their commune.
That is the whole point, and it is worth a worse compactness score.

### How the model works

**Step 1 — choosing centres.**
Two kinds of place become an absorbing centre: the 41 county capitals, and any locality
above the population threshold you set.

**Bucharest is one centre, not six.** Its sectors are not candidates and never compete with
each other — six parallel administrations over one continuous city is precisely the
duplication this exercise is about.

**Bucharest is also the one place a unit may cross a county line.** Everywhere else the
county boundary is absolute. Around the capital it runs through continuous built-up area:
Otopeni, Voluntari, Pantelimon and Popești-Leordeni are the city's suburbs in every
practical sense, and a model that stops at the line describes an administration rather than
a city. The resulting unit is 2.22 million across 38 UATs, 32 of them in Ilfov — and it
includes Buftea, Ilfov's own county capital. A county capital is otherwise untouchable; the
national capital is allowed to stand this one down, because Buftea sits inside the city's
reach and, protected, came out a unit of a single UAT and 20,577 people in the middle of the
metropolitan area.

The candidacy grid keeps the Bucharest-to-Ilfov pairs for the same reason. Dropping every
cross-county pair left the city able to see only the communes directly bordering a sector,
so it stopped one ring out: Cernica borders Pantelimon and Glina, both already part of the
city, and still could not be absorbed.

The city's reach is the union of its six sectors', not Sector 1's alone. Candidacy is
precomputed per UAT and Sector 1's buffer points north-west, so treating it as the city gave
a capital that absorbed Chitila and nothing else.

If a county ends up with fewer centres than the minimum you set, more are promoted. They are
chosen by *how much uncovered population they would reach*, not by how large they are. Towns
join the pool whatever their population: the threshold decides who is automatically a centre,
but promotion exists to fill a county that came up short, and there a town with a town hall
is a better answer than a large commune.

**Every unit is named after the most significant town in it.** Which communes group together
is settled by roads and radii; this decides only which member gives the unit its seat. It is
re-elected by administrative standing — county capital, then municipiu, then oraș, then the
larger commune — because otherwise a commune promoted for its coverage can end up seating a
unit that contains a town: Curcani, a commune of 5,301, gave its name to a unit containing
Oraș Budești (7,126). A re-election that would put a member beyond the distance cap from its
new seat is refused, and the unit keeps the seat it grew from.
This matters: choosing by size alone bunches every centre into whichever corner of the
county is densest, which is exactly the failure this step exists to prevent. Promoted
centres must also sit a minimum distance apart **by road**, measured through the county
rather than across it.

The minimum defaults to one — no constraint. At a 7,500 threshold the fallback is barely
needed, and left higher it does active harm in sparse counties: Tulcea has two natural
centres, so a minimum of five promoted Sarichioi into a centre of its own instead of letting
it join Babadag, 16 km away by road and sharing a border with it. Raise the threshold and
the fallback becomes useful again, which is why the slider stays. Where that is impossible, the requirement is
relaxed in steps, and if it still cannot be met the county is reported as **under-seeded**
rather than quietly fudged.

**Step 2 — deciding what each centre can reach.**
Each centre's own territory is expanded outward by a radius — a larger one for county
capitals, a smaller one for everything else.

The radius is applied to the **whole territory of the centre**, not to a point at its town
hall. A city and a 3,000-person commune would otherwise get identical reach from very
different starting footprints.

A commune is within reach by any of three routes: enough of its territory falls inside the
radius, its main village falls inside it, or it is within the radius **by road**. The third
matters because a long, thin commune can sit ten minutes down a direct road and still fail
an area test, since most of its area points somewhere else. Shape should not decide who your
administration is. The first test has a threshold you can set; without one, a
commune could be absorbed on the strength of a few metres of overlap at one corner, which
looks indefensible on a map and would be the first thing an opponent screenshotted.

**Step 3 — absorption, by road distance, in three passes.**

*A county capital is also finished once it has taken that ring.* It is never a partner in
the merging step below. This is the whole answer to "why is the county capital absorbing far
more than its neighbours": its own growth always stopped at the ring, and what reached 49.6 km
was the merging step. Oraș Recaș (8,347) and Oraș Buziaș (6,834) grow but never reach 50,000,
so they merge with the small units beside them and are still short, and that chain keeps
merging outward until it meets the only adjacent unit that clears the target — the capital. So
the whole chain drained into it.

Only capitals are closed off. Refusing *every* satisfied unit as a partner also works, and it
strands the leftovers instead: widening the radius then produced more units rather than fewer,
because a wider radius satisfies more units and each one it satisfies stops accepting
neighbours. A slider labelled "how far a centre reaches" must not increase the number of units
when you turn it up.

*A capital wins any contest for a commune on its own border, outright.* Nothing overrides
this. It was broken three separate ways: by the radius admitting the wrong set, by a nearer
centre winning the contest on road distance, and by the rebalancing pass moving ring communes
to a nearer seat after the fact — that last one had taken part of the ring from 24 of the 41
capitals. A test now asserts the rule directly rather than trusting the steps meant to produce
it. 39 of 41 capitals hold their complete ring; the two exceptions, Ocna Sugatag at 50.0 km
from Baia Mare and Buchin at 50.3 km from Resita, border their capital across a mountain and
fall outside the road cap.

*A ring is settled nearest pair first, with running totals.* The bids are collected across
the whole county before any is settled, but they are awarded one at a time in ascending road
distance, and each award updates that centre's population immediately. Awarding a whole ring
at once let one centre take five communes in a round and land 37,000 over the target while the
centre beside it stayed at 20,000 — no single commune overshot, so the concession rule never
fired, and the imbalance was decided by who happened to be nearest to more of them. With
running totals a centre stops the moment it reaches the target and the rest of its ring falls
to neighbours that still need it. Median overshoot fell from 5,728 to 1,487 and the largest
unit produced by growth from 87,075 to 56,505.

*Bids are still collected across the county at once.* Every centre bids for every unclaimed
commune it borders, all the bids are collected, and the whole ring is decided together.
Populations change only between rounds, so no centre gains an advantage from being processed
earlier in the alphabet.

*A contested commune goes to a centre that still needs it.* Where two centres bid for the
same commune, one that would pass the target by taking it concedes to one that would not: a
centre near its target should leave the commune to a neighbour still short of it. Among
centres equal on that, the nearest by road wins, then the higher tier, then the larger.

*The pool is filled by walking down from the threshold, preferring the better-placed
candidate among towns of comparable size.* Where a county has fewer centres than the minimum,
the next one is the next plausible town — a question about size. This used to maximise
uncovered population reached, which answers "who would sweep up the most" instead, and picked
Curcani, a commune of 5,301, over Oraș Budești at 7,126.

Size alone is not enough either. There is a separation floor of 15 km by road, but taking the
first candidate that clears it means position stops mattering the moment it is cleared: a town
15.1 km from an existing centre beat one of nearly the same size 30 km away, and 15 of the 41
counties ended with their centres clustered rather than spread. Populations are now compared
in bands of 3,000, and within a band the more distant candidate wins. Clustered counties fall
to 13, and the median distance between a promoted centre and its nearest neighbour rises from
22.6 km to 32.7.

*Every centre takes its first ring before any centre takes a second.* Growth is ordered by
ring first and by road distance only within a ring. Ordered by distance alone it was a single
race, and a large centre reached past a small one's own doorstep: 56 units under 25,000 sat
beside units over 55,000 with nothing left next to them to take. Within a ring the nearest by
road still wins, so a commune between two centres goes to the one it is closest to.

*A centre still short of the target keeps going past its radius.* The radius says how far a
centre pulls while it still has a choice; it is not what should stop a centre that has not yet
gathered enough people to be worth creating. With the radius binding, small centres ran out of
eligible neighbours at 10 km and stopped at 9,000 next to a neighbour of 141,000. The road cap
still bounds it, so "keeps going" is never unbounded.

*A county capital absorbs everything within its radius by road.* The radius, measured properly — and it has been wrong twice.

It first meant area overlap against a buffer drawn round the whole city polygon, so
Timișoara's "10 km" admitted 19 communes, 15 of them past 10 km by road and one at 30, and
the capital sprawled to 30 communes while Oraș Ciacova sat at 21,000. Replacing it with "the
communes that share a border with me" fixed that and threw road distance out altogether:
Călărași sits on the Danube and has three land neighbours, so it could not take Roseți 9.9 km
away while Dragalina took it from 45.4 km and wrapped around the capital. Nine of Dragalina's
fifteen communes were nearer to Călărași than to their own seat.

It is now distance from the capital's seat along the road network, which is what the slider
says and what a resident would measure, with nearest-by-road settling anything past it.
Călărași holds 7 UATs and 88,344 people; Dragalina 13 and 50,731. The six communes still
nearer to Călărași stay where they are for one stated reason: moving any of them drops
Dragalina below the target, which it clears by 731.

Bucharest is excluded from this: it is the national capital rather than a resedinta de judet,
and its ring is genuinely two communes deep — Cernica borders Pantelimon rather than a
sector, and belongs to the city all the same.

*The Danube Delta is the one place where water counts as road.* Everywhere else a border only
counts if a road crosses it, which is right: two communes either side of a bridgeless river
are not neighbours in any sense a resident would recognise. In the Delta there are almost no
roads and the channels are the network. Left to the road test it came out as three units of
one to three communes each, none able to reach the others or Tulcea. Borders inside the Delta
are crossable, and merges inside it are exempt from the distance cap — Pardina is 57.8 km
from Sulina by water and there is no shorter route and no other administration to join. It is
now one unit of seven communes seated on Oras Sulina.

*Capitals are not capped.* A county capital absorbs whatever its radius admits. The
population target governs the smaller centres only — Tulcea alone is 65,624, already past a
50,000 target, so capping it would have it absorb nothing at all.

*Smaller centres stop at the target.* Once a centre has gathered enough people it stops
taking more, leaving something for its neighbours instead of letting whichever centre is
nearest to the most communes sweep the county.

*Nothing may be further from its centre than the distance cap.* Without one, growth is
limited only by the radius and by who else is competing — and in a sparse county nobody
competes. Cernavodă reached Ostrov 59 km away and Constanța reached Vulturu at 60 km, giving
units as wide as the county. A radius says how far a centre pulls; the cap says how far
anyone should reasonably have to travel to their own town hall. It binds on every merge, not
only on growth.

*A centre standing inside a capital's reach is stood down, and the capital takes it.* This
is what builds a metropolitan area instead of a ring of small rivals. Cumpăna is part of
Constanța in every practical sense, so leaving it a separate centre describes an
administrative fiction — and left to compete it was absorbed southwards by Eforie instead.

The rule keys on the capital's reach, not on sharing a border with it: Cumpăna does not
touch Constanța at all, it reaches the city through Agigea. It also keys on the centre's
*seat* being inside the radius rather than on how much of its territory overlaps. A quarter
of Sighetu Marmației's sprawling area reaches Baia Mare's buffer while the two seats are
38 km apart, and demoting a municipiu of 34,000 on that basis would be indefensible.

The centre role is not destroyed, it moves outward. A stood-down candidate is removed from
the pool before promotion runs, so the county fills its quota from a town further out —
which is where a second centre is actually useful.

A stood-down centre is *reserved* for its capital, not handed to it. Growth still has to
arrive over the capital's own territory, which is what keeps every unit in one piece:
assigning Cumpăna directly produced a Constanța in two disconnected halves. At the default
settings 112 centres are stood down, and every one of them is reached by the capital reserved
for it.

**Nothing inside a capital's reach may be promoted to a centre either.** Standing centres
down runs once, before promotion; without this the promotion step simply put new ones back
inside the same reach. Găneasa (5,402) and Cornetu (7,389) both sit inside București's radius
and both came out units of a single UAT, because they became centres *after* the rule that
would have stood them down had already run.

A commune joins whichever centre reaches it **along the shortest road**. Distance is
measured between seat villages, on the real road network, and accumulated along the path
travelled — so a commune three communes away from its centre is charged the full driving
distance through all three.

A commune can only join if it borders something already in that region, so a region never
jumps over a commune it did not absorb, and once a commune is taken it is taken.

Two hard limits: a region **never crosses a county boundary**, and a commune can only be
absorbed across a border that a road actually crosses.

**A motorway is not a connection.** You cannot join or leave one at an arbitrary point, so
a motorway crossing a border without a junction carries traffic *past* it rather than across
it. Counting them made 513 border crossings passable where in practice there is no way
across. Motorways remain in the routing network — once you are on one it is a real road —
but they cannot be the thing that makes a border passable.

*This changed after the first version.* The original rule resolved competition by
processing order — county capitals first, then by population — and it produced results that
could not be defended. Sarichioi shares a road-connected border with Babadag 16 km away and
does not border Tulcea at all, yet Tulcea took it, purely because capitals go first and
Tulcea's territory is large enough to buffer that far. Measuring the road fixes that class
of result, and it matters more than it sounds: across all 9,281 adjacent pairs the road is a
median of **1.41×** the straight line, and in the worst cases **12×**. Around the Razim
lagoon, a straight line is close to meaningless.

Ties — genuinely equal road distances — break on centre tier, then population, then SIRUTA,
so two runs always agree.

**Step 4 — what is left over.**
Communes no centre reached can pair up with each other, smallest first, up to a size limit
you set. These clusters follow a **different rule** from absorption, and are shown in a
different colour for that reason. The largest member becomes the seat.

Without this step the model leaves over a thousand tiny communes untouched, which defeats
the purpose. Anything still unmerged after it simply stays as it is today.

**Step 5 — minimum resulting size.**
Optional, and off by default. A unit still below the population target absorbs the smallest
neighbouring unit it can, repeatedly, until it reaches the target or runs out of neighbours
**in its own county**. The larger of the two keeps its seat.

This answers a different question from everything above it. The gravitational rules ask
"who can reach whom"; this asks "is the result large enough to be worth creating". A unit of
4,000 people still needs a mayor, a secretary and a budget, so a scenario can shrink the map
without fixing anything.

Some units finish below the target legitimately. Four do so at every setting — Nămoloasa,
Pietroșani, Sulina and Tănăsoaia — because every neighbour they have lies across a county
line. They are reported, never forced.

### The parameters

| Parameter | Default | Range | What it does |
|---|---|---|---|
| Absorber population threshold | 7,500 | 5,000 – 50,000 | Localities above this become centres |
| County-capital radius | 15 km | 5 – 30 km | How far a county capital reaches |
| Other-absorber radius | 10 km | 5 – 30 km | How far every other centre reaches |
| Minimum centres per county | 1 (no constraint) | 1 – 10 | Below this, more centres are promoted |
| Minimum separation | 15 km by road | 0 – 30 km | Keeps promoted centres apart |
| Minimum overlap | 10% | 0 – 50% | How much of a commune must fall inside the radius |
| Leftover threshold | 5,000 | 0 (off) – 15,000 | How large a leftover cluster may grow |
| Minimum resulting population | 50,000 | 0 – 100,000 | Merges units that finish below this |
| Maximum road distance | 50 km | 0 (off) – 80 km | How far a commune may be from its centre |

The two radii snap to 2.5 km steps. Reach is precomputed for each of those steps so the map
can recompute in milliseconds instead of re-doing the geometry in your browser.

**The absorber threshold cannot go below 5,000.** Reach is only precomputed for localities
at or above that size, so a lower value would need the data rebuilt and republished.

### Reading the map

Every resulting unit is given a colour that none of the units touching it share, so two or
three separate units can never read as one shape. The constraint deliberately crosses county
lines: two units either side of a county boundary touch on screen, and if they matched, the
boundary between them would disappear.

Units built by absorption take cool colours, small-commune clusters warm ones, so the two
kinds stay distinguishable — a cluster follows a different rule. Where a cluster's every warm
colour is already taken by a neighbour it borrows a cool one, because two adjacent units
matching is always worse than a cluster drawn in the wrong family.

The seat of every unit is marked: gold for a county capital, white for another centre, and a
smaller pale dot for a cluster seat or a commune nothing reached.

**Today** shows the map as it stands — all 3,186 communes, each its own unit — so the before
and after can be compared directly. Hovering any commune gives both at once: its population
today, and the population and size of the unit it would join.

Names appear once the map is zoomed in far enough to have room for them. Across the whole
country there are 3,186 of them and any labelling is an unreadable pile.

### What the panel shows

Selecting a unit gives its fiscal position: total income, the wage bill of its
administrative staff, its total wage bill, operating spending and development spending,
with the balance between income and spending underneath.

The estimated saving is the administration of every commune in the unit **except the
centre**, because the centre keeps its own town hall. It is the same figure as the national
headline, computed for one unit.

Two limits worth knowing. Income is the total, not "own revenues" — separating locally
raised income from state transfers needs a revenue-code breakdown that has not been stable
enough to depend on. And the figures are 2024 execution for the communes as they are today;
they are what a merger would inherit, not a forecast of what it would spend.

### Where the data comes from

| Layer | Source | Vintage |
|---|---|---|
| Boundaries | ANCPI (RELUAT), via geo-spatial.org | 2025-03-26 |
| Population | INS, Census 2021, via Transparenta.eu | 1 Dec 2021 |
| Commune seats | SIRUTA locality register, via geo-spatial.org | — |
| Roads | OpenStreetMap, Geofabrik extract | 2026-08-24 |
| Budget execution | Ministry of Finance, via Transparenta.eu | 2024 |

Two checks worth stating, because they are independent of each other and both landed:
the boundaries total **238,397 km²** against Romania's actual ~238,400, and the population
totals **19,053,815** against the ~19.05 million the 2021 census recorded.

### Decisions a reader might reasonably dispute

Everything below is a judgement call, not a fact. They are listed so they can be argued
with rather than discovered.

**The savings figure excludes almost everything.** Local government spent 109.4 bn RON on
operating costs in 2024, but only **14.7 bn of that is administration** — the town hall, the
council, administrative staff. The rest is schools, social assistance, health, culture and
utilities. Merging two town halls does not close a school.

So the headline saving counts administration only. The larger figure, which applies the same
formula to all operating spending, is shown as an explicit **upper bound** — it is roughly
seven times larger and it assumes the absorbed commune's schools and social services vanish
along with its mayor. It should not be quoted on its own.

**What the map draws is not what the model routes on.** The model measures distances over
the whole public network — motorway, trunk, primary, secondary, tertiary, unclassified,
residential, living street, and every link road: 14 OSM classes, 511,000 ways. A drum
județean is `secondary` or `tertiary`, so county roads have always been in the routing.

The map, however, drew only motorway, trunk and primary, which made it look as though
routing knew nothing but the national network. County and communal roads are now their own
toggle — 87,586 segments, loaded on demand, drawn thinner and fading in as you zoom, because
together with the national roads at country zoom they are a smear rather than information.

Of the 9,281 adjacent seat pairs, 195 have no road route at all and fall back to straight-line
distance; most are Vrancea and Delta communes where the road genuinely does not connect. The
median route is 1.38 times the straight line, the 99th percentile 4.3 times.

**A border you can drive across, not a border a road crosses.** The model used to ask
whether a road crossed each shared boundary, and that is the wrong question. Oraș Făurei and
Surdila-Găiseanca share 2,252 m of border that no road crosses at any tolerance — and their
seats are 5.4 km apart by road, because the route goes round. Under that rule Făurei was
forbidden from absorbing its own neighbour, which then drained to Ianca through a chain of
merges. Nationally 3,213 borders were blocked while a real driving route existed, 234 of them
shorter than 10 km.

A border now counts if you can drive between the two seats at all, and the routed distance is
the weight. That needs no threshold: a border that is a long way round carries a large weight,
so growth avoids it and the distance cap bounds it. A river with no bridge and a motorway with
no junction are both long detours, which is exactly what they are — the protection those cases
need is the distance, not a yes/no test. 9,125 of 9,281 borders are now passable; the 156 that
are not have no road route between their seats at all.

This also removed the last two permanently stranded communes. Pietroșani and Nămoloasa each
had exactly one road-connected neighbour, in a different county, so no setting of any slider
could ever merge them. Both now have neighbours in their own county.

**Roads decide two different things.** Whether a border may be crossed at all is a yes/no
test: a road counts if it passes near the shared border *and* enters both communes, so a
road running parallel along one side of a boundary is not a connection across it. Which
centre wins is then decided by road **distance** between seat villages.

Distance is measured on the classified network — motorways down to `unclassified`, which in
rural Romania is most of what links one commune to the next — plus slip roads. Residential
streets are excluded: including them triples the graph for routes that differ only in the
few hundred metres at each end, which is noise against a 13 km median. 437 of 9,281 pairs
could not be routed and fall back to the straight line, which understates rather than
inflates their distance.

It is still not travel *time*. A mountain road and a motorway of the same length count the
same.

Road classification comes from OpenStreetMap and is not always right. In the Danube Delta,
sand tracks and dyke roads are tagged as ordinary roads, so the model treats several Delta
communes as road-connected when in practice you travel there by boat. This is a known
overstatement, accepted because the alternative — excluding whole road categories
nationally — would break far more places than it fixes. A commune with no road connection at
all may merge with whoever it borders, so nothing is ever stranded.

**Bucharest's six sectors have no seat in the register**, so a representative point inside
each is used instead. They can only merge with each other, since regions cannot cross county
lines.

**Ilfov's capital is Buftea, not Otopeni.** Otopeni is larger and shares Buftea's
administrative rank, so any size-based rule picks the wrong one. County seats are set by
law, so they are recorded from law rather than inferred.

**231 communes have out-of-date entries in the locality register.** They were created after
the register's vintage — often split from a larger commune in 2003–2004 — so their seat is
still listed as an ordinary village. Their seats were recovered by name instead, including
allowing for Romanian grammatical forms: the commune *Albeștii de Muscel* has the village
*Albești*.

Five seats could not be settled by rule and were checked individually against each
commune's own records. Four were already right; **Hărmănești** was wrong and is corrected by
hand, with the source recorded in `pipeline/seat_overrides.csv`.

**One seat sits outside its own commune.** Sâncraiu de Mureș's village point falls 705 m
inside Târgu Mureș, because the boundary and locality datasets disagree at that edge. It is
pulled back onto its own commune, and the move is recorded.

**Budget reports are filtered to one type.** The Ministry publishes the same money more than
once — once in detail, again aggregated per spending authority. Only the principal
aggregated reports are used, because summing a mixture would double-count. Bucharest is
reported both as a municipality and as its six sectors; the municipality is excluded for the
same reason.

### Limitations

- The radius is a straight line, not a road distance. Terrain is ignored: a 15 km radius
  crosses a mountain range as easily as a plain.
- Population is from 2021 and spending from 2024.
- The model says nothing about whether a merger is desirable, legal, or wanted locally. It
  computes a geometry, not a policy.
- It cannot model amenities, service catchments, school networks, or travel times.
- Every figure is an estimate from published aggregates, not a costing.

### Checking it yourself

Everything is reproducible. The pipeline rebuilds every layer from public sources on a clean
machine, and prints a data-quality report at each stage. The model is implemented twice —
once in Python as the reference, once in TypeScript for the browser — and a test asserts
they produce **identical** results across 24 parameter combinations. If they ever disagree,
the browser is wrong.

Source, data reports and licence: see the repository.

---

<a id="metodologie-română"></a>

## Reading the map

**No colour appears twice inside a county, and no two units that touch ever match.**

Those are two different rules and they are not equally satisfiable. The county rule is what a
reader actually uses — two same-coloured units at opposite ends of one county still read as
one thing when you are looking at that county — and the busiest county holds eleven units, so
eleven colours are needed and eleven are enough. The touching rule crosses county lines,
because two units either side of a boundary touch on screen and the boundary between them
disappears if they match.

Where the two conflict the touching rule wins, because it can always be met. With the
population target switched off a single county holds thirty units, and thirty colours a reader
can tell apart do not exist; there the county rule is given up unit by unit rather than
allowing two neighbours to match.

**The eleven colours are all different hues, not shades.** Chosen by search under two
constraints at once: at least 32 degrees of hue between any pair, and maximum perceptual
distance subject to that. The closest pair sits 25.3 apart in CIELAB and lightness runs from
40 to 83, so they separate by brightness as well as by hue. Two hand-picked palettes preceded
this one and both contained near-duplicates — two olive-greens 5.0 apart, then two blues that
differed only in lightness. Hue separation is the constraint that prevents it, and eyeballing
does not enforce it. The palette is not editable by hand.

Cluster units no longer have a colour family of their own: all eleven are needed for the
county rule, so a cluster is marked by its badge in the panel instead.

**Hovering or selecting a commune outlines its county.** The county boundary is the hardest
constraint in the model, so knowing which county you are looking at explains more of the
shape on screen than any other single line.

## What a capital may hold

A reședință de județ takes the ring of communes bordering it and, beyond that, only what
nothing else will have.

Growth was made to respect this and did. The steps *after* growth did not, and between them
they put 302 communes into capitals beyond their ring: handing out leftovers added 130,
because a commune whose neighbours had not yet been reached was given to the capital
immediately; rebalancing added 172, because it asks only "is another seat nearer by road" and
a capital's seat very often is.

Three rules now hold the line. Leftovers are handed out in two phases, so a capital only gets
what remains after every other unit has finished reaching outward. Rebalancing never moves a
commune *into* a capital beyond its ring. And a capital **gives back** anything beyond its
ring that another unit will take — units keep growing and merging after a commune is handed
over, so one that had no neighbour at the time often acquires one later.

That takes it from 302 to 64, and every one of the 64 has a reason: 10 would split the
capital's unit in two if removed, 30 have every alternative past the distance cap, and 24 have
no other unit adjacent at all. None is simply the capital reaching further than it should.

## No leftovers

A commune no centre reached used to start a unit of its own with the other communes nobody
reached. That was an artefact of the target rather than of geography: a centre stops once it
has enough people, and when every centre around a commune was satisfied nobody was allowed to
take it. 300 communes were stranded that way, none of them far from anywhere.

They are handed out instead. A leftover goes to the neighbouring unit **still short of the
target**, nearest by road. If every neighbour is already satisfied it goes to the **smallest**
of them rather than the nearest — handing each to the nearest piled them onto whichever unit
happened to be adjacent to the most leftovers, and took the worst county from a 219-fold
spread between its largest and smallest unit to 548. The distance cap still applies, so a
commune further from every neighbouring seat than anyone should travel is left for the cluster
step. Repeated until nothing more can be placed, because placing one commune gives its
neighbours a unit to join.

561 of the 710 are placed this way, and the cluster step now handles 149 rather than 568.

## Putting communes in the right unit

Growth settles a commune against the state at the moment it was reached. By the time
everything has grown, merged and been re-seated, some communes sit in a unit whose seat is
further away than a neighbouring unit's — which is the first thing a resident notices and the
thing that produces ragged edges.

A final pass moves them. A commune changes unit only when it borders the unit it joins and may
legally join it, that seat is strictly nearer by road and within the cap, the unit it leaves
stays in one piece, and the unit it leaves does not fall below the target if it was above it —
a tidier edge is not worth breaking a unit that was already viable. At the default settings
574 communes move.

Re-seating and consolidation then take turns until they agree, because they interact:
consolidation judges a merge by road distance from the seat that would survive, and re-seating
moves that seat, which can make a refused merge feasible. The loop ends when a pass merges
nothing, so the seats the last pass judged from are the seats the map ends with.

Together these take the spread between the largest and smallest unit inside a county from 19
times to 10.6, and units still short of the target from 134 to 107.

**Shape is a control, off by default.** The rebalancing pass optimises for the trip to the
town hall, which is what shape trades against: the commune that tidies an outline is often not
the one nearest a seat, so the choice belongs to whoever is reading the map.

The **minimum compactness** slider sets a floor on the Polsby-Popper ratio — four pi times
area over perimeter squared, where 1.00 is a circle and a long ragged strip tends to zero. A
claim, a merge or a move is refused when it would leave a unit both below the floor *and*
worse than it is now. The second half matters: the median unit scores 0.24, so a floor that
refused every change to a ragged unit would freeze exactly the ones that most need
rearranging.

| floor | units | below target | median shape | units under 0.20 | saving |
|---|---|---|---|---|---|
| off | 250 | 96 | 0.237 | 79 | 8.82 bn |
| 0.20 | 258 | 97 | 0.251 | 39 | 8.73 bn |
| 0.25 | 267 | 113 | 0.264 | 42 | 8.67 bn |
| 0.30 | 282 | 121 | 0.258 | 59 | 8.57 bn |

At 0.20 the number of visibly ragged units halves for eight more units and 0.09 bn RON. Past
0.25 it starts working against itself: refusing merges leaves more small awkward units than it
prevents.

**The shape is computed without any geometry.** A unit's area is the sum of its members' areas
and its outline the sum of their perimeters less twice every border that falls inside it, so
two scalars per commune and one per border are enough — the browser never loads a polygon to
score a shape. A test checks that arithmetic against the merged polygons on forty units and
requires them to agree to six decimal places; it caught the first version walking the
road-connected graph, which left the 156 road-less borders in the perimeter.

## Manual overrides

Every rule in this document is deterministic, and none of them knows anything the map does
not contain. Where you have a reason the model does not — a road that matters, a plan that
exists, a history that does not show up in a population figure — you can move a UAT by hand.

Select it, pick a unit from **Move this UAT to…**, and it goes there. The constraints are the
model's own: the target has to be a unit that exists at the current parameters, and it has to
be one the UAT could legally join, which means the same county, or Bucharest for an Ilfov
commune.

Overrides are applied *after* the rules run and are never confused with them. A moved commune
is labelled `manual` in the member list, its explanation says it was placed by hand, and the
sidebar lists every override with a way to undo it. With no overrides the map is exactly what
the rules produced — which is what keeps the Python reference and the browser in step.

They travel in the link, so a scenario with overrides can still be shared and argued with.

One thing an override can do that the rules cannot: leave a unit in two disconnected pieces,
by taking a commune out of the middle of one. That is reported rather than prevented. Refusing
it would hide the consequence, and the point of an override is that the person making it knows
something the model does not.

## Worth a look

A list of units the rules leave looking odd: single-UAT units, units below the population
target, units whose seat is outranked administratively by one of their own members, and any
unit an override has split. None of these is an error — they are all legal outcomes of the
rules — but every problem described in this document was found by noticing one of them while
panning around the map. The list exists so they can be found on purpose instead.

Each entry says *why*, because "single-UAT unit" is an observation and only a reason is
actionable. There are exactly two:

**Past the road cap.** The nearest merge available would put some commune further from its
town hall than the cap allows, and the list gives the distance — which is the answer to
"what would I have to set the cap to". Three of the five single-UAT units at the default
settings are this, Dănicei at 61.4 km among them. Raising the cap trades unit count against
travel time, and it is the single most consequential slider on the page.

**No road neighbour in its own county.** Pietroșani's only road-connected neighbour is in
Giurgiu; Nămoloasa's is in Vrancea. The county rule forbids every merge either could make, so
no cap setting reaches them and they stay units of one at any parameters. This is the cost of
the county constraint, stated rather than hidden.

## Metodologie (română)

### Ce este

O hartă interactivă care simulează cum ar arăta harta administrativă a României dacă
comunele ar fi unite după un set de reguli explicite și mecanice — și care permite oricui să
schimbe regulile și să vadă imediat rezultatul.

Este un **instrument de analiză pentru dezbatere publică**. Nu este o propunere oficială, nu
reprezintă poziția nimănui, iar niciun scenariu produs nu este o recomandare.

### Ce nu este, în mod deliberat

Modelul este **determinist**: aceleași setări produc întotdeauna exact aceeași hartă, pe
orice calculator, de fiecare dată. Nu folosește optimizare și nici aleatoriu.

Este un compromis asumat și costă ceva real. Metodele de optimizare — regionalizare Max-P și
altele similare — produc hărți mai echilibrate, care se descurcă mai bine la compactitate și
la echilibrul populației. Ce nu pot face este să explice *de ce* o anumită comună a ajuns
într-o anumită regiune. Răspunsul este „așa a decis algoritmul de optimizare”.

Aici, fiecare absorbție decurge din reguli care încap într-un paragraf. Un jurnalist poate
reconstitui orice rezultat, iar un primar poate contesta exact regula care i-a mutat comuna.
Acesta este întregul scop și merită un scor mai slab la compactitate.

### Cum funcționează modelul

**Pasul 1 — alegerea centrelor.**
Două categorii devin automat centre de absorbție: cele 41 de reședințe de județ și orice
localitate peste pragul de populație ales.

**Bucureștiul este un singur centru, nu șase.** Sectoarele nu sunt candidate și nu concurează
între ele — șase administrații paralele peste un oraș continuu sunt exact dublarea despre
care este vorba aici.

**Bucureștiul este și singurul loc unde o unitate poate traversa o limită de județ.** În rest
limita de județ este absolută. În jurul capitalei ea trece prin construit continuu: Otopeni,
Voluntari, Pantelimon și Popești-Leordeni sunt suburbiile orașului în orice sens practic, iar
un model care se oprește la limită descrie o administrație, nu un oraș. Unitatea rezultată
are 2,22 milioane de locuitori în 38 de UAT-uri, dintre care 32 în Ilfov — și include Buftea,
reședința județului Ilfov. O reședință de județ este altfel intangibilă; capitala are voie să
o oprească pe aceasta, pentru că Buftea se află în raza orașului și, protejată, ieșea o
unitate de un singur UAT și 20.577 de locuitori în mijlocul zonei metropolitane.

Grila de candidatură păstrează perechile București–Ilfov din același motiv. Eliminarea
tuturor perechilor inter-județene lăsa orașul să vadă doar comunele cu graniță directă la un
sector, deci se oprea la primul inel: Cernica se învecinează cu Pantelimon și Glina, ambele
deja parte din oraș, și tot nu putea fi absorbită.

Raza orașului este reuniunea razelor celor șase sectoare, nu doar a Sectorului 1. Candidatura
este precalculată per UAT, iar tamponul Sectorului 1 este orientat spre nord-vest, așa că
tratarea lui ca oraș întreg dădea o capitală care absorbea Chitila și nimic altceva.

Minimul este implicit unu — adică fără constrângere. La un prag de 7.500 această rezervă
aproape nu este necesară, iar lăsată mai sus face rău în județele rare: Tulcea are două
centre naturale, așa că un minim de cinci a promovat Sarichioi drept centru propriu în loc
să îl lase să se alăture Babadagului, la 16 km pe drum și cu graniță comună.

Dacă un județ rămâne cu mai puține centre decât minimul stabilit, se promovează altele. Sunt
alese după *câtă populație neacoperită ar cuprinde*, nu după cât de mari sunt. Orașele intră
în bazinul de candidați indiferent de populație: pragul stabilește cine este automat centru,
dar promovarea există tocmai pentru un județ rămas descoperit, iar acolo un oraș cu primărie
este un răspuns mai bun decât o comună mare. Acest lucru
contează: alegerea după mărime grupează toate centrele în colțul cel mai dens al județului,
exact eșecul pe care acest pas există să îl prevină. Centrele promovate trebuie să fie și la
o distanță minimă unele de altele. Unde acest lucru nu este posibil, cerința se relaxează
treptat, iar dacă tot nu poate fi îndeplinită, județul este raportat ca **sub prag**, nu
ajustat pe tăcute.

**Pasul 2 — ce poate cuprinde fiecare centru.**
Teritoriul fiecărui centru este extins în afară cu o rază — mai mare pentru reședințele de
județ, mai mică pentru restul.

Raza se aplică **întregului teritoriu al centrului**, nu unui punct la primărie. Altfel, un
oraș și o comună de 3.000 de locuitori ar avea aceeași întindere pornind de la suprafețe
complet diferite.

O comună este în raza de acțiune dacă suficient din teritoriul ei intră în rază sau dacă
satul ei principal intră. Prima condiție are un prag reglabil; fără el, o comună ar putea fi
absorbită pe baza câtorva metri de suprapunere într-un colț, ceea ce arată indefensabil pe
hartă și ar fi primul lucru fotografiat de un contestatar.

**Pasul 3 — absorbția.**
*O reședință de județ preia inelul care se învecinează cu ea și nimic dincolo de el.* Nu o
rază: raza nu înseamnă ce sugerează numele. Candidatura se măsoară ca suprapunere de
suprafață cu un tampon în jurul întregului poligon al orașului, așa că „10 km" pentru
Timișoara admitea 19 comune, 15 dintre ele peste 10 km pe drum și una la 30. O reședință
mărginită așa se întinde, în timp ce orașele din jur rămân mici — Timișoara ajungea la 30 de
comune și 420.000 de locuitori, iar Orașul Ciacova rămânea la 21.000. Bucureștiul face
excepție: este capitala națională, nu o reședință de județ, iar inelul lui are efectiv două
comune adâncime.

*Delta Dunării este singurul loc unde apa contează drept drum.* Acolo aproape că nu există
drumuri, iar canalele sunt rețeaua. Lăsată pe seama testului rutier, Delta ieșea ca trei
unități de una până la trei comune, niciuna capabilă să ajungă la celelalte sau la Tulcea.
Granițele din interiorul Deltei sunt traversabile, iar fuziunile din interiorul ei sunt
scutite de plafonul de distanță — Pardina este la 57,8 km de Sulina pe apă și nu există rută
mai scurtă și nicio altă administrație la care să adere. Acum este o singură unitate de șapte
comune, cu sediul la Orașul Sulina.

Centrele preiau comune într-o ordine strictă: întâi toate reședințele de județ, apoi
centrele care depășesc pragul de populație, apoi cele promovate. În fiecare grupă, cele cu
populație mai mare merg primele. Egalitățile se departajează după codul SIRUTA, deci ordinea
nu variază niciodată între rulări.

Fiecare centru crește în inele. Ia în calcul întâi comunele vecine, apoi vecinele *acelora*
și așa mai departe. O comună se poate alătura doar dacă atinge ceva deja aflat în acea
regiune, deci o regiune nu poate niciodată să sară peste o comună pe care nu a absorbit-o.
Odată preluată, o comună rămâne preluată — primul centru care ajunge la ea o păstrează.

Două limite ferme: o regiune **nu traversează niciodată o limită de județ** — cu singura
excepție a Bucureștiului și a inelului său ilfovean — iar o comună poate fi absorbită doar
peste o graniță traversată efectiv de un drum.

*Un centru aflat în raza unei reședințe de județ este oprit din competiție, iar reședința îl
preia.* Astfel se construiește o zonă metropolitană în loc de un inel de rivali mici. Cumpăna
face parte din Constanța în orice sens practic, iar lăsată centru separat ajungea absorbită
spre sud de Eforie.

Regula se raportează la raza reședinței, nu la faptul că are graniță comună cu ea: Cumpăna nu
atinge deloc Constanța, ajunge la oraș prin Agigea. Se raportează și la *sediul* centrului
aflat în rază, nu la cât din teritoriu se suprapune. Un sfert din suprafața întinsă a
Sighetului Marmației atinge tamponul Băii Mari, deși cele două sedii sunt la 38 km distanță,
iar retrogradarea unui municipiu de 34.000 pe acest temei ar fi de nesusținut.

Rolul de centru nu dispare, ci se mută mai departe: candidatul oprit este scos din bazin
înainte de promovare, așa că județul își completează cota cu un oraș mai depărtat — acolo
unde un al doilea centru chiar folosește.

Un centru oprit este *rezervat* reședinței, nu atribuit direct. Creșterea trebuie să ajungă
la el pe teritoriul propriu al reședinței, ceea ce menține fiecare unitate dintr-o singură
bucată: atribuirea directă a Cumpenei producea o Constanță în două jumătăți neconectate. La
setările implicite 112 centre sunt oprite, iar fiecare este ajuns de reședința rezervată lui.

**Nimic aflat în raza unei reședințe nu poate fi promovat la rang de centru.** Oprirea
centrelor rulează o singură dată, înainte de promovare; fără această regulă pasul de
promovare punea altele la loc în aceeași rază. Găneasa (5.402) și Cornetu (7.389) sunt ambele
în raza Bucureștiului și ieșeau amândouă unități de un singur UAT, pentru că deveneau centre
*după* ce regula care le-ar fi oprit rulase deja.

**Fiecare unitate poartă numele celei mai importante localități din ea.** Ce comune ajung
împreună este decis de drumuri și raze; aici se stabilește doar care membru dă sediul. Este
reales după rangul administrativ — reședință de județ, apoi municipiu, apoi oraș, apoi comuna
mai mare — pentru că altfel o comună promovată pentru acoperire ajunge să dea numele unei
unități care conține un oraș: Curcani, comună de 5.301 locuitori, dădea numele unei unități
care conținea Orașul Budești (7.126). O realegere care ar duce un membru dincolo de plafonul
de distanță față de noul sediu este refuzată, iar unitatea păstrează sediul din care a
crescut.

**Pasul 5 — mărimea minimă rezultată.**
Opțional și dezactivat implicit. O unitate rămasă sub pragul de populație absoarbe cea mai
mică unitate vecină pe care o poate, în mod repetat, până atinge pragul sau rămâne fără
vecini **în propriul județ**. Cea mai mare dintre cele două își păstrează reședința.

Răspunde la o întrebare diferită de toate cele de mai sus. Regulile gravitaționale întreabă
„cine pe cine poate cuprinde”; aceasta întreabă „este rezultatul destul de mare cât să merite
creat”. O unitate de 4.000 de locuitori tot are nevoie de primar, secretar și buget, deci un
scenariu poate micșora harta fără să rezolve nimic.

Unele unități rămân sub prag în mod legitim. Patru rămân la orice setare — Nămoloasa,
Pietroșani, Sulina și Tănăsoaia — pentru că toți vecinii lor se află în alt județ. Sunt
raportate, niciodată forțate.

**Pasul 4 — ce rămâne.**
Comunele la care nu a ajuns niciun centru se pot uni între ele, cele mai mici întâi, până la
o limită de mărime aleasă. Aceste grupări urmează o **regulă diferită** de absorbție și sunt
afișate într-o culoare distinctă tocmai din acest motiv. Cel mai mare membru devine
reședință.

Fără acest pas, modelul lasă neatinse peste o mie de comune mici, ceea ce anulează scopul.
Ce rămâne neunit și după acest pas rămâne pur și simplu așa cum este astăzi.

### Parametrii

| Parametru | Implicit | Interval | Ce face |
|---|---|---|---|
| Prag populație absorbant | 7.500 | 5.000 – 50.000 | Localitățile peste acest prag devin centre |
| Rază reședință de județ | 15 km | 5 – 30 km | Cât de departe ajunge o reședință de județ |
| Rază alte centre | 10 km | 5 – 30 km | Cât de departe ajung celelalte centre |
| Minim centre per județ | 1 (fără constrângere) | 1 – 10 | Sub acest număr se promovează centre |
| Distanță minimă | 15 km pe drum | 0 – 30 km | Menține centrele promovate depărtate |
| Suprapunere minimă | 10% | 0 – 50% | Cât din comună trebuie să intre în rază |
| Prag comune rămase | 5.000 | 0 (oprit) – 15.000 | Cât de mare poate crește o grupare |
| Populație minimă rezultată | 50.000 | 0 – 100.000 | Unește unitățile rămase sub acest prag |
| Distanță maximă pe drum | 50 km | 0 (oprit) – 80 km | Cât de departe poate fi o comună de centrul ei |

Cele două raze se fixează pe trepte de 2,5 km. Întinderea este precalculată pentru fiecare
treaptă, astfel încât harta să se recalculeze în milisecunde, fără a reface geometria în
browser.

**Pragul de populație nu poate coborî sub 5.000.** Întinderea este precalculată doar pentru
localitățile de la această mărime în sus, deci o valoare mai mică ar necesita reconstruirea
și republicarea datelor.

### De unde vin datele

| Strat | Sursă | Vintage |
|---|---|---|
| Limite administrative | ANCPI (RELUAT), via geo-spatial.org | 26.03.2025 |
| Populație | INS, Recensământ 2021, via Transparenta.eu | 1 dec. 2021 |
| Reședințe de comună | Nomenclator SIRUTA, via geo-spatial.org | — |
| Drumuri | OpenStreetMap, extras Geofabrik | 24.08.2026 |
| Execuție bugetară | Ministerul Finanțelor, via Transparenta.eu | 2024 |

Două verificări independente care au ieșit corect: limitele însumează **238.397 km²** față
de cei ~238.400 reali ai României, iar populația însumează **19.053.815** față de cele ~19,05
milioane înregistrate la recensământul din 2021.

### Decizii care pot fi contestate

Tot ce urmează este o judecată, nu un fapt. Sunt enumerate ca să poată fi contestate, nu
descoperite.

**Cifra de economie exclude aproape tot.** Administrația locală a cheltuit 109,4 mld RON pe
funcționare în 2024, dar doar **14,7 mld reprezintă administrație** — primăria, consiliul,
personalul administrativ. Restul înseamnă școli, asistență socială, sănătate, cultură și
utilități. Unirea a două primării nu închide o școală.

Prin urmare, economia principală numără doar administrația. Cifra mai mare, care aplică
aceeași formulă tuturor cheltuielilor de funcționare, este afișată explicit ca **limită
superioară** — este de circa șapte ori mai mare și presupune că școlile și serviciile
sociale ale comunei absorbite dispar odată cu primarul. Nu ar trebui citată singură.

**Ce desenează harta nu este ce folosește modelul pentru rutare.** Modelul măsoară distanțele
pe întreaga rețea publică — autostradă, drum expres, drum principal, secundar, terțiar,
neclasificat, rezidențial, stradă locală și toate bretelele: 14 clase OSM, 511.000 de căi. Un
drum județean este `secondary` sau `tertiary`, deci drumurile județene au fost dintotdeauna în
rutare.

Harta însă desena doar autostrăzile, drumurile expres și cele principale, ceea ce făcea să
pară că rutarea nu știe decât de rețeaua națională. Drumurile județene și comunale au acum
propriul comutator — 87.586 de segmente, încărcate la cerere, desenate mai subțire și apărând
treptat pe măsură ce se apropie zoom-ul, pentru că împreună cu cele naționale, la zoom pe
toată țara, sunt o pată, nu informație.

Din cele 9.281 de perechi de sedii vecine, 195 nu au deloc rută rutieră și cad înapoi pe
distanța în linie dreaptă; majoritatea sunt comune din Vrancea și din Deltă unde drumul chiar
nu face legătura. Ruta mediană este de 1,38 ori linia dreaptă, percentila 99 de 4,3 ori.

**Drumurile sunt un test da/nu, nu o distanță.** Modelul verifică doar dacă un drum
traversează granița dintre două comune. Nu măsoară timp de deplasare sau distanță rutieră.
Un drum contează dacă trece pe lângă granița comună *și* intră în ambele comune — un drum
paralel cu granița, pe o singură parte, nu este o legătură peste ea.

Clasificarea drumurilor provine din OpenStreetMap și nu este întotdeauna corectă. În Delta
Dunării, drumurile de nisip și cele de pe diguri sunt marcate ca drumuri obișnuite, deci
modelul tratează mai multe comune deltaice ca fiind legate rutier, deși în practică se
ajunge acolo cu barca. Este o supraestimare cunoscută, acceptată pentru că alternativa —
excluderea unor categorii întregi de drumuri la nivel național — ar strica mult mai multe
locuri decât ar repara. O comună fără nicio legătură rutieră se poate uni cu oricine se
învecinează, deci nimic nu rămâne izolat definitiv.

**Cele șase sectoare ale Bucureștiului nu au reședință în nomenclator**, deci se folosește
un punct reprezentativ din interiorul fiecăruia. Se pot uni doar între ele, pentru că
regiunile nu traversează limite de județ.

**Reședința județului Ilfov este Buftea, nu Otopeni.** Otopeni este mai mare și are același
rang administrativ, deci orice regulă bazată pe mărime alege greșit. Reședințele de județ
sunt stabilite prin lege, deci sunt preluate din lege, nu deduse.

**231 de comune au înregistrări depășite în nomenclatorul de localități.** Au fost create
după vintage-ul nomenclatorului — adesea desprinse dintr-o comună mai mare în 2003–2004 —
deci reședința lor este încă trecută ca sat obișnuit. Reședințele au fost recuperate după
nume, ținând cont și de formele gramaticale românești: comuna *Albeștii de Muscel* are satul
*Albești*.

Cinci reședințe nu au putut fi stabilite prin regulă și au fost verificate individual în
documentele fiecărei comune. Patru erau deja corecte; **Hărmănești** era greșită și este
corectată manual, cu sursa consemnată în `pipeline/seat_overrides.csv`.

**O reședință se află în afara propriei comune.** Punctul satului Sâncraiu de Mureș cade la
705 m în interiorul municipiului Târgu Mureș, pentru că seturile de date privind limitele și
localitățile nu coincid în acel loc. Este readus în propria comună, iar mutarea este
consemnată.

**Rapoartele bugetare sunt filtrate la un singur tip.** Ministerul publică aceiași bani de
mai multe ori — o dată detaliat, o dată agregat pe ordonator. Se folosesc doar rapoartele
agregate la nivel de ordonator principal, pentru că însumarea unui amestec ar duce la dublă
contabilizare. Bucureștiul este raportat atât ca municipiu, cât și prin cele șase sectoare;
municipiul este exclus din același motiv.

### Limitări

- Raza este în linie dreaptă, nu pe drum. Relieful este ignorat: o rază de 15 km traversează
  un lanț muntos la fel de ușor ca o câmpie.
- Populația este din 2021, iar cheltuielile din 2024.
- Modelul nu spune nimic despre dacă o fuziune este de dorit, legală sau acceptată local.
  Calculează o geometrie, nu o politică.
- Nu poate modela dotări, arii de deservire, rețele școlare sau timpi de deplasare.
- Fiecare cifră este o estimare din agregate publicate, nu un deviz.

### Cum poate fi verificat

Totul este reproductibil. Pipeline-ul reconstruiește fiecare strat din surse publice pe un
calculator curat și tipărește un raport de calitate a datelor la fiecare etapă. Modelul este
implementat de două ori — o dată în Python ca referință, o dată în TypeScript pentru browser
— iar un test verifică faptul că produc rezultate **identice** pentru 24 de combinații de
parametri. Dacă vreodată nu coincid, browserul este cel greșit.

Sursă, rapoarte de date și licență: vezi repository-ul.

## Cum se citește harta

**Două unități care se ating nu au niciodată aceeași culoare.** Restricția se aplică pe orice
graniță comună, indiferent dacă o traversează un drum, și trece intenționat peste limitele de
județ: două unități de o parte și de alta a unei limite se ating pe ecran, iar dacă au aceeași
culoare limita dintre ele dispare.

Această ultimă parte a fost greșită până de curând. Colorarea folosea graful *rutier* — cele
5.902 granițe traversate de un drum — în loc de toate cele 9.281 de granițe comune. Sulina,
Crișan și Chilia Veche sunt trei unități distincte din Deltă, fără drum între ele, așa că
algoritmul le credea nevecine și le desena pe toate trei într-un singur bloc portocaliu, care
se citea ca o singură unitate cu trei puncte de sediu în ea. Sediile erau corecte, culoarea nu.

**Cele douăsprezece culori sunt alese prin căutare, nu cu ochiul.** Paleta anterioară avea
douăzeci de intrări alese manual, câteva aproape identice: două verzi-măslinii la distanță
CIELAB de 5,0, un verde și un smarald la 9,0, două indigouri la 8,1. Unități vecine desenate
în asemenea perechi nu pot fi deosebite. Cele douăsprezece provin dintr-o căutare de tip
farthest-point peste nuanțe vii, iar cea mai apropiată pereche este la 32,8 — valoare impusă
de un test. Paleta nu trebuie editată manual: exact așa au apărut aproape-duplicatele.
Colorarea greedy nu are nevoie niciodată de mai mult de șase dintre ele.

**Trecerea cu mouse-ul sau selectarea unei comune conturează județul ei.** Limita de județ
este cea mai dură constrângere din model, deci a ști în ce județ vă aflați explică mai mult
din forma de pe ecran decât orice altă linie.

## Modificări manuale

Toate regulile din acest document sunt deterministe și niciuna nu știe ceva ce harta nu
conține. Acolo unde aveți un motiv pe care modelul nu îl are — un drum care contează, un plan
care există, o istorie care nu apare într-o cifră de populație — puteți muta o UAT manual.

O selectați, alegeți o unitate din **Mută această UAT la…** și acolo ajunge. Constrângerile
sunt chiar ale modelului: ținta trebuie să fie o unitate care există la parametrii curenți și
una la care UAT-ul se poate alătura legal — adică același județ, sau Bucureștiul pentru o
comună ilfoveană.

Modificările se aplică *după* ce rulează regulile și nu se confundă niciodată cu ele. O comună
mutată este marcată `manual` în lista de membri, explicația ei spune că a fost plasată manual,
iar bara laterală listează fiecare modificare cu posibilitatea de a o anula. Fără modificări,
harta este exact ce au produs regulile — ceea ce ține modelul de referință Python și browserul
în pas.

Modificările circulă în link, deci un scenariu cu modificări poate fi în continuare distribuit
și contestat.

Un lucru pe care o modificare îl poate face, iar regulile nu: să lase o unitate din două
bucăți neconectate, scoțând o comună din mijlocul ei. Acest lucru este raportat, nu împiedicat.
A-l refuza ar ascunde consecința, iar rostul unei modificări manuale este tocmai că persoana
care o face știe ceva ce modelul nu știe.

## De verificat

O listă a unităților pe care regulile le lasă arătând ciudat: unități dintr-o singură UAT,
unități sub populația-țintă, unități al căror sediu este depășit în rang administrativ de un
membru propriu și orice unitate ruptă de o modificare manuală. Niciuna nu este o eroare — sunt
toate rezultate legale ale regulilor — dar fiecare problemă descrisă în acest document a fost
găsită observând una dintre ele în timp ce se naviga pe hartă. Lista există pentru ca ele să
poată fi găsite intenționat.

Fiecare intrare spune *de ce*, pentru că „unitate dintr-o singură UAT" este o observație și
doar un motiv permite o acțiune. Există exact două:

**Peste plafonul de drum.** Cea mai apropiată fuziune posibilă ar duce o comună mai departe de
primărie decât permite plafonul, iar lista dă distanța — adică răspunsul la întrebarea „la cât
ar trebui să pun plafonul". Trei din cele cinci unități de o singură UAT la setările implicite
sunt în această situație, între care Dănicei la 61,4 km. Ridicarea plafonului schimbă numărul
de unități contra timpului de deplasare și este cel mai consecvent cursor din pagină.

**Niciun vecin pe drum în propriul județ.** Singurul vecin rutier al Pietroșaniului este în
Giurgiu, iar al Nămoloasei în Vrancea. Regula județului le interzice orice fuziune, deci
niciun plafon nu ajunge la ele și rămân unități de una singură la orice parametri. Acesta este
costul constrângerii județene, spus explicit, nu ascuns.

