# Analyse: Literals in den Lehrplan-Graphen

Datum: 2026-02-24

## Übersicht Literals pro Bundesland

| Bundesland | Literals | Graph |
|---|---|---|
| Sachsen | 520.663 | `<http://sn-2026-01-29/>` |
| Bayern | 118.616 | `<http://by-2026-01-27/>` |
| Rheinland-Pfalz | 58.214 | `<http://rlp-2026-01-30/>` |
| Berlin | 28.370 | `<https://w3id.org/lehrplan/data/berlin>` |

### Sachsen ohne Berufs- und Sonderschulen

| Sachsen | Literals |
|---|---|
| Gesamt | 520.663 |
| Ohne Berufsschulen & Sonderschulen | 465.851 |
| Ausgeschlossene Literals | 54.812 (~10,5%) |

Ausgeschlossene Schularten:
- **Berufsschulen:** Berufsvorbereitungsjahr, Berufsgrundbildungsjahr, Duale Berufsausbildung mit Abitur, Berufe nach §66 BBiG
- **Berufliche Schulen:** Berufliches Gymnasium, Fachoberschule
- **Förderschulen:** Förderschwerpunkt geistige Entwicklung, Förderschwerpunkt Lernen, Förderschwerpunkt Sehen

## Analyse: Warum hat Sachsen ~9x mehr Literals als Rheinland-Pfalz?

### 1. Deutlich mehr Knoten

| | Sachsen | Rheinland-Pfalz |
|---|---|---|
| Knoten mit Labels | 355.260 | 51.211 |

Sachsen hat knapp 7x mehr Knoten.

### 2. Feinere Granularität der Inhalte

| Knotentyp | Sachsen | Rheinland-Pfalz |
|---|---|---|
| Titel (LP_0000346) | 180.899 | 25.638 |
| Lernziel und Lerninhalt (LP_0002113) | 11.642 | — |
| Lernbereich (LP_0002114) | 2.242 | — |
| Wahlbereich (LP_0002110) | 40.224 | — |
| Lehrplanfragment (LP_0002115) | 104.766 | — |
| Kompetenzbereich (LP_0000432) | — | 20.694 |
| Kompetenz (LP_0000431) | — | 4.715 |
| Lehrpläne | 553 | 229 |

Sachsen modelliert in 5 Hierarchie-Typen (Titel, Lehrplanfragment, Wahlbereich, Lernbereich, Lernziel/Lerninhalt). Rheinland-Pfalz nutzt nur 2 inhaltliche Typen (Kompetenzbereich, Kompetenz).

### 3. Zusätzliche URI-Property in Sachsen

Sachsen speichert 164.716 zusätzliche Literals über `LP_0000463` ("uri") – URLs zum sächsischen Schulportal. Das allein entspricht fast dem 3-fachen des gesamten RP-Graphen.

### 4. Zusammenfassung der Faktoren

| Faktor | Auswirkung |
|---|---|
| Mehr Lehrpläne (553 vs. 229) | ~2,4x |
| Feinere Granularität (5 vs. 2 Inhaltstypen) | ~3–4x |
| Schulportal-URIs (164.716 extra Literals) | +~3x RP-Gesamtgröße |
| Berufs-/Sonderschulen inklusive | +~55.000 |

## Strukturelle Unterschiede Berlin vs. BY/SN/RP

### Lehrplan-Typ

| | BY / SN / RP | Berlin |
|---|---|---|
| Klasse | Bundesland-spezifische Subklassen (LP_0000819, LP_0000818, LP_0000433) | Generische Klasse LP_0000438 direkt |

### Labels und Titel

| | BY / SN / RP | Berlin |
|---|---|---|
| Lehrplan-Name | `rdfs:label` direkt am Lehrplan | Separate Ressource (`curriculum/N_title`) mit `owl:topDataProperty` |
| Beschreibungen | `lp:LP_0030051` (hat Beschreibung) | Separate Ressource (`curriculum/N_description`) mit `owl:topDataProperty` |

### Verknüpfungen

| | BY / SN / RP | Berlin |
|---|---|---|
| Schulfach | `lp:LP_0000537` am Lehrplan | Nicht vorhanden |
| Schulart | `lp:LP_0000812` am Lehrplan | Nicht vorhanden |

### Hierarchie (hat Teil)

| | BY / SN / RP | Berlin |
|---|---|---|
| Property | `lp:LP_0000008` | `BFO_0000051` (BFO has-part) |

### Niveaustufen

| | BY / SN / RP | Berlin |
|---|---|---|
| Jahrgangsstufe | `lp:LP_0000026` mit URIs `LP_200000N` | Buchstaben-Levels A–H (`bb/level/1`–`8`) |
| Zuordnung an Standards | — | Nur Informatik (8 von 70 Standards), alle anderen Fächer: keine |

### URI-Schema

| | BY / SN / RP | Berlin |
|---|---|---|
| Namespace | `w3id.org/lehrplan/ontology/...` | `lehrplan.yovisto.com/resource/lp/be/...` (Curricula), `lp/bb/...` (Inhalte) |

### Graph-Inhalt

| | BY / SN / RP | Berlin |
|---|---|---|
| Ontologie | Nur Instanzdaten; Ontologie in separatem Graph | Graph enthält vollständige Kopie der Ontologie |

## Berlin: Lehrpläne

46 Rahmenlehrpläne (Berlin-Brandenburg):

**Sprachen:** Deutsch, Deutsche Gebärdensprache, Moderne Fremdsprachen (allgemein + Englisch, Französisch, Spanisch, Italienisch, Russisch, Polnisch, Portugiesisch, Chinesisch (4x), Japanisch, Türkisch, Sorbisch/Wendisch, Hebräisch, Neugriechisch), Latein, Altgriechisch

**MINT:** Mathematik, Informatik, Physik, Chemie, Biologie, Astronomie, Naturwissenschaften 5/6, Naturwissenschaften 7-10

**Gesellschaftswissenschaften:** Geschichte, Geografie, Politische Bildung, Psychologie, Gesellschaftswissenschaften 5/6, Sowi/Wiwi

**Weitere:** Ethik, Lebensgestaltung-Ethik-Religionskunde, Philosophie, Musik, Kunst, Theater, Sport, Sachunterricht, Wirtschaft-Arbeit-Technik, Medienbildung, BC Sprachbildung

### Niveaustufen-Zuordnung in Berlin

`LP_0000578` (Niveaustufe) und `LP_0000840` (Bildungsgangniveau) existieren nur für Informatik (8 von 70 Standards). Alle anderen 45 Lehrpläne haben keine strukturierten Niveaustufen-Zuordnungen.

Verfügbare Bildungsgangniveaus (am Beispiel Informatik): BBR, EBBR, MSA, BOA, Gymnasialniveau Sek I.

### Thema "Fische" in Berlin

Einziger Treffer: **Exercise 520** im Fach Biologie.

- **Titel:** Die RGT-Regel am Beispiel der Kiemendeckelfrequenz von Goldfischen
- **Thema:** Lebensräume und ihre Bewohner
- **Niveaustufe:** G (nur im Titel codiert, nicht strukturiert)
- **Einordnung:** Biologie → Erkenntnisse gewinnen → Elemente der Mathematik anwenden → Messwerte erfassen → Mittelwerte einer Messreihe berechnen (standard/2829)
