/** Curated German ingredient catalogue for the fridge/pantry autocomplete.
 *
 * Scope: what a normal household actually has in the fridge, freezer or
 * cupboard — not a professional food database. Free text always stays
 * allowed; this list only makes the common cases fast to enter.
 *
 * Kept flat per category so the picker can group results, and deliberately
 * singular/base forms ("Tomate", not "Tomaten") so what lands in the prompt
 * reads consistently.
 */

export interface ZutatKategorie {
  name: string;
  items: string[];
}

export const ZUTAT_KATEGORIEN: ZutatKategorie[] = [
  {
    name: 'Gemüse',
    items: [
      'Tomate', 'Zwiebel', 'Knoblauch', 'Kartoffel', 'Karotte', 'Möhre', 'Paprika', 'Zucchini',
      'Aubergine', 'Gurke', 'Brokkoli', 'Blumenkohl', 'Spinat', 'Champignon', 'Lauch',
      'Sellerie', 'Fenchel', 'Kürbis', 'Süßkartoffel', 'Rote Bete', 'Rotkohl', 'Weißkohl',
      'Wirsing', 'Grünkohl', 'Rosenkohl', 'Spitzkohl', 'Chinakohl', 'Pak Choi', 'Mangold',
      'Kohlrabi', 'Pastinake', 'Radieschen', 'Rettich', 'Frühlingszwiebel', 'Schalotte',
      'Erbse', 'Zuckerschote', 'Grüne Bohne', 'Spargel', 'Artischocke', 'Mais', 'Chili',
      'Jalapeño', 'Ingwer', 'Kurkuma', 'Meerrettich', 'Sauerkraut', 'Oliven',
      'Getrocknete Tomate', 'Kopfsalat', 'Rucola', 'Feldsalat', 'Eisbergsalat', 'Endivie',
      'Radicchio', 'Sprossen', 'Avocado', 'Shiitake', 'Kräuterseitling', 'Pfifferling',
    ],
  },
  {
    name: 'Obst',
    items: [
      'Zitrone', 'Limette', 'Orange', 'Apfel', 'Banane', 'Birne', 'Erdbeere', 'Himbeere',
      'Blaubeere', 'Brombeere', 'Johannisbeere', 'Kirsche', 'Pfirsich', 'Nektarine',
      'Aprikose', 'Pflaume', 'Traube', 'Wassermelone', 'Honigmelone', 'Ananas', 'Mango',
      'Papaya', 'Kiwi', 'Granatapfel', 'Feige', 'Dattel', 'Rosine', 'Cranberry',
      'Grapefruit', 'Mandarine', 'Kokosnuss', 'Rhabarber', 'Quitte',
    ],
  },
  {
    name: 'Fleisch & Fisch',
    items: [
      'Hähnchenbrust', 'Hähnchenschenkel', 'Hackfleisch', 'Rinderhack', 'Rindersteak',
      'Rinderfilet', 'Gulasch', 'Schweinefilet', 'Schweinenacken', 'Kotelett', 'Speck',
      'Bacon', 'Schinken', 'Salami', 'Chorizo', 'Bratwurst', 'Wiener Würstchen',
      'Putenbrust', 'Ente', 'Lamm', 'Kalb', 'Leberwurst', 'Lachs', 'Räucherlachs',
      'Thunfisch', 'Kabeljau', 'Seelachs', 'Forelle', 'Zander', 'Garnele', 'Scampi',
      'Muschel', 'Tintenfisch', 'Sardelle', 'Sardine', 'Hering',
    ],
  },
  {
    name: 'Milchprodukte & Eier',
    items: [
      'Ei', 'Milch', 'Butter', 'Margarine', 'Sahne', 'Schmand', 'Saure Sahne',
      'Crème fraîche', 'Joghurt', 'Griechischer Joghurt', 'Quark', 'Hüttenkäse',
      'Frischkäse', 'Mozzarella', 'Parmesan', 'Pecorino', 'Gouda', 'Emmentaler',
      'Cheddar', 'Feta', 'Ziegenkäse', 'Blauschimmelkäse', 'Ricotta', 'Mascarpone',
      'Halloumi', 'Raclettekäse', 'Butterschmalz', 'Buttermilch', 'Kefir',
      'Hafermilch', 'Mandelmilch', 'Sojamilch', 'Kokosmilch',
    ],
  },
  {
    name: 'Grundnahrung',
    items: [
      'Nudeln', 'Spaghetti', 'Penne', 'Tagliatelle', 'Lasagneplatten', 'Reis',
      'Basmatireis', 'Risottoreis', 'Sushireis', 'Couscous', 'Bulgur', 'Quinoa',
      'Polenta', 'Gnocchi', 'Kartoffelpüree', 'Brot', 'Toastbrot', 'Baguette',
      'Brötchen', 'Fladenbrot', 'Tortilla', 'Wrap', 'Semmelbrösel', 'Haferflocken',
      'Müsli', 'Cornflakes', 'Reisnudeln', 'Glasnudeln', 'Ramen-Nudeln', 'Knödel',
      'Blätterteig', 'Pizzateig', 'Filoteig', 'Nudelteig',
    ],
  },
  {
    name: 'Hülsenfrüchte & Nüsse',
    items: [
      'Kichererbsen', 'Linsen', 'Rote Linsen', 'Kidneybohnen', 'Schwarze Bohnen',
      'Weiße Bohnen', 'Sojabohnen', 'Edamame', 'Tofu', 'Tempeh', 'Seitan',
      'Erdnuss', 'Mandel', 'Walnuss', 'Haselnuss', 'Cashew', 'Pistazie', 'Pinienkern',
      'Sonnenblumenkern', 'Kürbiskern', 'Sesam', 'Leinsamen', 'Chiasamen',
      'Erdnussbutter', 'Tahini',
    ],
  },
  {
    name: 'Gewürze & Kräuter',
    items: [
      'Salz', 'Pfeffer', 'Paprikapulver', 'Chiliflocken', 'Cayennepfeffer', 'Kreuzkümmel',
      'Koriandersamen', 'Kurkumapulver', 'Curry', 'Garam Masala', 'Zimt', 'Muskatnuss',
      'Nelke', 'Kardamom', 'Lorbeerblatt', 'Oregano', 'Thymian', 'Rosmarin', 'Basilikum',
      'Petersilie', 'Schnittlauch', 'Dill', 'Minze', 'Koriandergrün', 'Salbei', 'Estragon',
      'Majoran', 'Kerbel', 'Zitronengras', 'Kaffirlimettenblatt', 'Galgant', 'Safran',
      'Vanille', 'Sternanis', 'Fenchelsamen', 'Senfkörner', 'Wacholder', 'Piment',
      'Italienische Kräuter', 'Kräuter der Provence',
    ],
  },
  {
    name: 'Vorrat & Saucen',
    items: [
      'Olivenöl', 'Sonnenblumenöl', 'Rapsöl', 'Sesamöl', 'Kokosöl', 'Essig',
      'Balsamico', 'Apfelessig', 'Reisessig', 'Sojasauce', 'Fischsauce', 'Austernsauce',
      'Worcestersauce', 'Sriracha', 'Sambal Oelek', 'Harissa', 'Miso', 'Currypaste',
      'Tomatenmark', 'Passierte Tomaten', 'Dosentomaten', 'Ketchup', 'Senf', 'Mayonnaise',
      'Pesto', 'Hummus', 'Ajvar', 'Gemüsebrühe', 'Hühnerbrühe', 'Rinderbrühe',
      'Weißwein', 'Rotwein', 'Bier', 'Rum', 'Wodka', 'Gin', 'Whisky', 'Tequila',
      'Aperol', 'Campari', 'Wermut', 'Sekt', 'Prosecco', 'Tonic Water', 'Ginger Beer',
      'Sodawasser', 'Cola', 'Orangensaft', 'Apfelsaft', 'Kokoswasser',
    ],
  },
  {
    name: 'Backen & Süßes',
    items: [
      'Mehl', 'Dinkelmehl', 'Vollkornmehl', 'Zucker', 'Rohrzucker', 'Puderzucker',
      'Brauner Zucker', 'Honig', 'Ahornsirup', 'Agavendicksaft', 'Backpulver',
      'Natron', 'Hefe', 'Trockenhefe', 'Speisestärke', 'Vanillezucker', 'Kakao',
      'Schokolade', 'Zartbitterschokolade', 'Schokoladenstreusel', 'Marzipan',
      'Nutella', 'Marmelade', 'Apfelmus', 'Kokosraspeln', 'Gelatine', 'Agar-Agar',
      'Zuckersirup', 'Grenadine',
    ],
  },
];

/** Flat list of every catalogue entry (stable order). */
export const ALLE_ZUTATEN: string[] = ZUTAT_KATEGORIEN.flatMap((k) => k.items);

/** Shown on focus before anything is typed — the everyday staples. */
export const TOP_ZUTATEN: string[] = [
  'Ei', 'Tomate', 'Zwiebel', 'Knoblauch', 'Kartoffel', 'Karotte', 'Paprika',
  'Hähnchenbrust', 'Hackfleisch', 'Nudeln', 'Reis', 'Milch', 'Butter', 'Käse',
  'Sahne', 'Joghurt', 'Zitrone', 'Olivenöl', 'Mehl', 'Zwiebel',
].filter((v, i, a) => a.indexOf(v) === i);

/** Fold German text for search: ä->ae etc., strip diacritics, lowercase. */
const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function foldZutat(text: string): string {
  const lowered = text.toLowerCase().replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c);
  return lowered.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Suggestions for the current input.
 *
 * - empty query  -> TOP_ZUTATEN (minus what's already picked)
 * - otherwise    -> catalogue matches, prefix hits first, then substring
 *
 * `exclude` are the already-selected items (compared fold-insensitively), so
 * the list never offers something that's already a badge.
 */
export function matchZutaten(query: string, exclude: string[] = [], limit = 8): string[] {
  const taken = new Set(exclude.map(foldZutat));
  const q = foldZutat(query.trim());

  if (!q) return TOP_ZUTATEN.filter((z) => !taken.has(foldZutat(z))).slice(0, limit);

  const prefix: string[] = [];
  const contains: string[] = [];
  for (const item of ALLE_ZUTATEN) {
    const folded = foldZutat(item);
    if (taken.has(folded)) continue;
    if (folded.startsWith(q)) prefix.push(item);
    else if (folded.includes(q)) contains.push(item);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}
