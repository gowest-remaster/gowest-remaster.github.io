// Glossary of 1880s words (remastered-ux §6.2), in plain words for readers of 8 and up, and the
// inline linker: `glossify(el)` underlines the first use of each term inside verbatim text
// (letters, talk transcripts, newspapers, hints) without changing a character of it. Hover or
// focus shows the meaning (the global [data-tip] tooltip); click opens Help ▸ Glossary.

export interface GlossEntry {
  term: string;
  text: string;
  /** extra spellings that link to this entry (matched case-insensitively, whole words) */
  match?: string[];
}

export const GLOSSARY: GlossEntry[] = [
  { term: 'Homestead', text: 'Free land from the government. Live on it and farm it for five years and it is yours.', match: ['homestead', 'homesteads', 'homesteader', 'homesteaders'] },
  { term: 'Homestead Act', text: 'The 1862 law that gave families 160 acres of free land in the West if they lived on it and farmed it for five years.', match: ['Homestead Act'] },
  { term: 'Enlarged Homestead Act', text: 'A 1909 law that let homesteaders claim more land, because dry plains farms needed more acres to make a living.', match: ['Enlarged Homestead Act'] },
  { term: 'Claim', text: 'The paper that says which land is yours to homestead. Filing a claim is how you ask for the land.', match: ['claim', 'claims'] },
  { term: 'Quarter section', text: '160 acres, a quarter of a square mile. Your field is 8 squares of 20 acres.', match: ['quarter section', 'quarter-section'] },
  { term: 'Acre', text: 'A piece of land about the size of a football field.', match: ['acre', 'acres'] },
  { term: 'Bushel', text: 'A basket that holds about 60 pounds of wheat. Grain is bought and sold by the bushel.', match: ['bushel', 'bushels'] },
  { term: 'Sod house', text: 'A house built from bricks of prairie grass and roots, because the plains had almost no trees.', match: ['sod house', 'sod houses', 'soddy'] },
  { term: 'Frame house', text: 'A house built from sawn lumber, brought in by train. A sign that a family was doing well.', match: ['frame house', 'wooden house'] },
  { term: 'Windmill & well', text: 'The wind turns the blades, which pump water up from the deep well. On the plains, water was far underground.', match: ['windmill', 'windmills'] },
  { term: 'Grain elevator', text: 'A tall building by the railroad where grain is bought, stored and loaded onto trains.', match: ['grain elevator', 'elevator'] },
  { term: 'Hauler', text: 'A man with a wagon who carries grain to a bigger market for a fee. He may pay more, but storms can ruin a load.', match: ['hauler', 'freight'] },
  { term: 'Barbed wire', text: 'Wire with sharp points that kept cattle out of fields where there was no wood for fences.', match: ['barbed wire', 'barbed-wire', 'wire fence'] },
  { term: 'Steam traction engine', text: 'An early tractor powered by a steam boiler. It plowed far faster than a team of horses.', match: ['steam tractor', 'traction engine', 'tractor', 'tractors'] },
  { term: 'Telegram', text: 'A short message sent over electric wires and printed out at the other end, the fastest news there was.', match: ['telegram', 'telegraph'] },
  { term: 'Farmers’ Alliance', text: 'A group farmers formed in the 1880s to buy and sell together and stand up to railroads and banks.', match: ['Farmers Alliance', 'Farmers’ Alliance', "Farmers' Alliance", 'Alliance'] },
  { term: 'Populists', text: 'The People’s Party of the 1890s, formed by farmers who felt railroads and banks treated them unfairly.', match: ['Populist', 'Populists', 'People’s Party', "People's Party"] },
  { term: 'Pullman strike', text: 'In 1894 railroad workers stopped working to protest wage cuts. Trains across the West stood still.', match: ['Pullman strike', 'Pullman'] },
  { term: 'Interstate Commerce Act', text: 'An 1887 law that made railroads charge fair prices, the first time the government set rules for a big business.', match: ['Interstate Commerce', 'ICC'] },
  { term: 'Cherokee Strip', text: 'Land in Oklahoma opened to settlers in a great race on September 16, 1893. Over 100,000 people rushed in.', match: ['Cherokee Strip', 'land run'] },
  { term: 'Model T', text: 'Henry Ford’s cheap, sturdy car from 1908. It put farm families on wheels.', match: ['Model T', 'automobile', 'motor car'] },
  { term: 'Income tax', text: 'A tax on what people earn. The 16th Amendment allowed it in 1913.', match: ['income tax'] },
  { term: 'Prohibition', text: 'A ban on making and selling alcohol. Kansas was “dry” from 1881; the whole country from 1920.', match: ['Prohibition', 'dry Kansas', '18th Amendment', '"dry" state', 'dry state'] },
  { term: 'Suffrage', text: 'The right to vote. Kansas women won it in 1912; all American women in 1920.', match: ['suffrage', 'women’s vote', "women's vote", 'vote for women', 'allowed to vote'] },
  { term: 'The Great War', text: 'World War I, fought in Europe from 1914 to 1918. America joined in 1917.', match: ['Great War', 'the war in Europe', 'Kaiser'] },
  { term: 'Armistice', text: 'The agreement that stopped the fighting of World War I on November 11, 1918.', match: ['Armistice'] },
  { term: 'Turkey Red', text: 'A hardy winter wheat brought to Kansas by Mennonite settlers in 1874.', match: ['Turkey Red'] },
  { term: 'Upkeep', text: 'What your family spends each month on food and supplies (the original game called it the cost of living).', match: ['upkeep', 'cost of living'] },
  { term: 'Interest', text: 'What the bank charges for lending you money, a share of the loan added each year.', match: ['interest'] },
  { term: 'Compound interest', text: 'Interest that grows on top of last year’s interest, so a debt grows faster each year.', match: ['compound interest'] },
  { term: 'Collateral', text: 'Something you promise the bank, like your farm, that it takes if you can’t repay.', match: ['collateral'] },
  { term: 'Standing', text: 'How well the town thinks of you. Donations, weddings and businesses raise it.', match: ['standing', 'your standing'] },
  { term: 'Depot', text: 'The railroad station, where trains loaded grain and dropped off mail and goods.', match: ['depot', 'Train Depot'] },
  { term: 'Grange', text: 'A farmers’ club where neighbors met, shared news and bought supplies together.', match: ['Grange'] },
];

const byWord = new Map<string, GlossEntry>();
for (const g of GLOSSARY) for (const m of g.match ?? [g.term]) byWord.set(m.toLowerCase(), g);
// longest first so "compound interest" wins over "interest"
const words = [...byWord.keys()].sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE = new RegExp(`(?<![\\w’'])(${words.map(esc).join('|')})(?![\\w’'])`, 'gi');

export const glossFor = (word: string) => byWord.get(word.toLowerCase()) ?? null;

let openGlossary: ((term: string) => void) | null = null;
/** The Help panel registers how to open the glossary at a term. */
export function onOpenGlossary(fn: (term: string) => void) {
  openGlossary = fn;
}

/**
 * Underline glossary words in an element's text, first use of each entry only (per call).
 * Never changes the text itself; skips inputs, buttons and existing glossary links.
 */
export function glossify<T extends HTMLElement>(root: T, seen = new Set<GlossEntry>()): T {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.gloss, button, input, textarea, a, kbd, .no-gloss') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let last = 0;
    const frag = document.createDocumentFragment();
    let hit = false;
    while ((m = RE.exec(text))) {
      const g = glossFor(m[1]);
      if (!g || seen.has(g)) continue;
      seen.add(g);
      hit = true;
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(glossSpan(m[1], g));
      last = m.index + m[1].length;
    }
    if (!hit) continue;
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return root;
}

export function glossSpan(word: string, g: GlossEntry) {
  const s = document.createElement('span');
  s.className = 'gloss';
  s.tabIndex = 0;
  s.textContent = word;
  s.dataset.tip = `${g.term}: ${g.text}`;
  s.setAttribute('role', 'button');
  s.setAttribute('aria-label', `${word}. Glossary: ${g.text}`);
  const open = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    openGlossary?.(g.term);
  };
  s.addEventListener('click', open);
  s.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && open(e));
  return s;
}
