# Mutsify-prompts

Dit bestand is de bron van alle prompts die naar het AI-model gaan. Pas de tekst in de grijze blokken aan,
commit, en na de volgende deploy gebruikt de site de nieuwe tekst.

**Spelregels**

- Verander alleen de tekst **in** de grijze blokken. Laat de kopjes met de code tussen `backticks` staan:
  daaraan herkent de site welk blok wat is.
- Woorden tussen {accolades} worden door de site ingevuld. Je mag ze verplaatsen of weglaten, maar niet hernoemen.
- Een blok mag leeg zijn; dan valt dat stukje gewoon weg.
- Het model tekent vaak wat je noemt, ook achter "niet" of "zonder". Schrijf dus alleen wat je wél wilt zien.
- Na een wijziging: `node scripts/build-prompts.mjs` zet dit bestand om naar `lib/prompts-data.mjs`.
  Netlify doet dat bij elke deploy zelf; lokaal doet `node server.mjs` het bij het starten.

## 1. Gedeelde zinnen

Deze zinnen komen in alle prompts terug.

### Begin van elke prompt — `shared.who`

Invulwoord: `{who}`

```
For every face of a person or animal in this picture:
```

### Houding — `shared.pose`

Invulwoord: `{pose}`. Staat achter "Everyone stays …" (muts) en "The costume is fitted onto each body …" (ridder).

```
exactly as it is posed right now: same position in the frame, same lean and head tilt, same arms and hand gestures, same expression, and they keep holding whatever they are holding.
```

### Achtergrond — `shared.scene`

Invulwoord: `{scene}`

```
The background, framing, lighting and photographic style stay exactly the same, and everything else in the picture stays as it is.
```

## 2. Kerstmuts (gewone pagina en /robin)

### De prompt — `hat.prompt`

`{count}`, `{worn}`, `{extra}`, `{robin}` en `{everyone}` komen uit de blokken hieronder.

```
{who} put one classic red Santa Christmas hat with white fur trim and one white pom-pom on top of the head, above the eyebrows. {count} {worn} {extra} {robin} {everyone} stays {pose} {scene}
```

### Aantal mutsen — `hat.count`

Alleen als de herkenning hoofden vond. `{number}` wordt bijvoorbeeld `one hat` of `two hats`.

```
That is exactly {number} in the picture.
```

### Aantal mutsen op /robin — `hat.count.robin`

```
That is exactly {number} in the picture, Robin's included.
```

### Hoe de muts gedragen wordt, bij één hoofd — `hat.worn.one`

```
The hat is worn {idea}.
```

### Hoe de mutsen gedragen worden, bij meer hoofden — `hat.worn.many`

`{ideas}` zijn maximaal drie manieren uit de lijst hieronder, gescheiden door `;`.

```
Each hat is worn differently, for example: {ideas}.
```

### Manieren om de muts te dragen — `hat.ideas`

Eén manier per regel. De site kiest er willekeurig uit, één per hoofd.

```
tilted far to one side at a cheeky angle
comically tiny and perched on the very top of the head
worn backwards with the pom-pom dangling behind the head
pushed far back on the head, as if it is about to slide off the back
```

### Wie blijft staan — `hat.everyone`

Invulwoord: `{everyone}`

```
Everyone
```

### Extraatje per kleurbolletje

Bij 🔵 Frosty Blue • Snowdeer komt er niets bij.

### 🔴 Cranberry • Rudolph — `extra.antlers`

```
Each Santa hat also has a pair of small soft felt reindeer antlers in light brown sticking up from it.
```

### 🟢 Pine • Scarf — `extra.scarf`

```
Everyone also wears a cosy knitted Christmas scarf with red and green stripes, loosely around the neck.
```

### 🟤 Gingerbread • Cookie — `extra.cookie`

```
Everyone also has a gingerbread man cookie with white icing: people hold it in a hand that is already in the picture, animals have it lying right in front of their paws.
```

### 🟣 Sugarplum • Candy Cane — `extra.candycane`

```
Everyone also has a red-and-white striped candy cane: people hold it in a hand that is already in the picture, animals have it lying right in front of their paws.
```

## 3. /robin

Robin komt bij de kerstmutsprompt; zijn plaatje gaat als tweede afbeelding mee naar het model.

### Robin erbij — `robin.text`

Invulwoord: `{robin}`

```
Robin, the small white toy robot from the second image, joins the picture as the one new figure: one robot, close to the others like a member of the family posing with them, at a natural toy size, facing the camera, in the same lighting and focus. Robin looks exactly as in the second image and wears a Santa hat too.
```

### Wie blijft staan op /robin — `robin.everyone`

Invulwoord: `{everyone}`

```
Everyone already in the picture
```

## 4. /ridder

### De prompt — `knight.prompt`

`{costume}` en `{helmet}` komen uit het gekozen kleurbolletje hieronder.

```
{who} dress them in {costume}, and put {helmet} around the head. The helmet is open at the front. {animals} The costume is fitted onto each body {pose} {scene}
```

### Extra zin als er dieren op de foto staan — `knight.animals`

Invulwoord: `{animals}`

```
Animals stay the same animals: small ones such as dogs and cats wear a little helmet and a matching little armoured coat over their back, large ones such as horses and cows wear a decorated cloth over their body.
```

### Kostuum en helm per kleurbolletje

### 🔵 Steel • Plate Armour: kostuum — `knight.plate.costume`

```
polished silver steel plate armour with a royal-blue tabard
```

### 🔵 Steel • Plate Armour: helm — `knight.plate.helmet`

```
a simple round shiny steel helmet that sits on top of the head like a cap, above the eyebrows, with a tall red feather plume on top
```

### 🔴 Crimson • Royal Guard: kostuum — `knight.guard.costume`

```
a chainmail shirt under a red heraldic tabard showing a golden lion
```

### 🔴 Crimson • Royal Guard: helm — `knight.guard.helmet`

```
a round steel kettle-hat helmet with a wide brim, over a chainmail hood that frames the face
```

### 🟢 Pine • Forest Knight: kostuum — `knight.forest.costume`

```
dark green enamelled armour with bronze edges and a green hooded cloak
```

### 🟢 Pine • Forest Knight: helm — `knight.forest.helmet`

```
a simple round bronze helmet that sits on top of the head like a cap, above the eyebrows, with a small crest of oak leaves
```

### 🟤 Gold • Knight King: kostuum — `knight.king.costume`

```
ornate golden armour with engraved patterns and a red velvet cape with white fur trim
```

### 🟤 Gold • Knight King: helm — `knight.king.helmet`

```
an open-faced golden helmet with a small royal crown on top
```

### 🟣 Sugarplum • Tournament: kostuum — `knight.tournament.costume`

```
steel armour under a jousting tabard with purple and white stripes
```

### 🟣 Sugarplum • Tournament: helm — `knight.tournament.helmet`

```
a simple round steel helmet that sits on top of the head like a cap, above the eyebrows, with large purple and white feather plumes
```
