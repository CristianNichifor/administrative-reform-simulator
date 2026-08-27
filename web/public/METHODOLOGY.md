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
duplication this exercise is about. They merge into a single unit of 1.72 million. Because
regions never cross county lines, that unit absorbs nothing beyond itself, which is also why
the national-capital radius has almost no effect in practice.

If a county ends up with fewer centres than the minimum you set, more are promoted. They are
chosen by *how much uncovered population they would reach*, not by how large they are.
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

*A centre bordering its county capital is held back.* Otherwise the capital simply eats it
on the first step, and a perfectly good town disappears because of where it happens to sit.
It is left alone while everyone else grows, then asked whether it can still reach the target
from what remains. If it can, it stays a centre. If it cannot, it folds into the capital —
the outcome it was being protected from, but only once that has been shown to be the right
answer rather than an accident of ordering.

At the default settings 69 centres are held this way; 5 survive on their own and 64 fold in.
Not always into the capital: a neighbouring held centre that did reach the target grows in
the same pass and can take it first. Dumbrăvița, Ghiroda and Moșnița Nouă all border
Timișoara and end up in Giroc rather than in the capital, because Giroc is nearer by road.

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
Două categorii devin automat centre de absorbție: cele 41 de reședințe de județ plus cele
șase sectoare ale Bucureștiului, și orice localitate peste pragul de populație ales.

Minimul este implicit unu — adică fără constrângere. La un prag de 7.500 această rezervă
aproape nu este necesară, iar lăsată mai sus face rău în județele rare: Tulcea are două
centre naturale, așa că un minim de cinci a promovat Sarichioi drept centru propriu în loc
să îl lase să se alăture Babadagului, la 16 km pe drum și cu graniță comună.

Dacă un județ rămâne cu mai puține centre decât minimul stabilit, se promovează altele. Sunt
alese după *câtă populație neacoperită ar cuprinde*, nu după cât de mari sunt. Acest lucru
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

Două limite ferme: o regiune **nu traversează niciodată o limită de județ**, iar o comună
poate fi absorbită doar peste o graniță traversată efectiv de un drum.

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
