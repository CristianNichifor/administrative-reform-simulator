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

