// Hotbar badges and availability, computed from state (§4.2). Shared by the panel definitions.
import { businessForSale, catalogAvailable, claimAvailable, grainQuote, livestockMarketOpen, type GameState } from '../../sim/index.ts';
import type { Badge } from '../core/registry.ts';
import { money, num } from '../core/format.ts';
import { almanacPins, cropState, fieldStatus, goalChecklist, isNewArrival, loanInfo, squares } from '../core/simapi.ts';

export const badge = {
  homestead(s: GameState): Badge | null {
    if (s.globals.mail > 0) return { text: 'Mail', tone: 'urgent', tip: 'a letter is in the mailbox' };
    if (s.extra.triviaOpen) return { text: 'Trivia', tone: 'good', tip: 'a trivia card is on your porch: click to answer it and win money' };
    const b = s.propet.toBuildBarn + s.propet.toBuildWindmill + s.propet.toBuildHouse;
    if (b > 0 && s.globals.houseStat !== 0) return { text: 'Build', tone: 'info', tip: 'something needs building: click its blueprint' };
    return null;
  },
  field(s: GameState): Badge | null {
    const c = s.cursit;
    const st = fieldStatus(s);
    const crop = cropState(s);
    if (crop.phase === 'harvest' && st.harvest.ok) return { text: 'Harvest!', tone: 'urgent', tip: 'your crop is ripe and can be harvested now' };
    const free = squares(s).filter((q) => q.plowed && !q.planted && q.owned).length;
    if (free && st.plant.ok) return { text: `${free} to plant`, tone: 'info', tip: `${free} plowed squares are ready for seed` };
    if (st.plow.ok && c.numPlowed < 8 * s.propet.numFields && c.numPlanted === 0) return { text: 'Plow', tone: 'info', tip: 'it is plowing season' };
    return null;
  },
  house(s: GameState): Badge | null {
    if (s.propet.savings > 0) return { text: money(s.propet.savings), tone: 'info', tip: `${money(s.propet.savings)} in the savings box` };
    return null;
  },
  street(s: GameState): Badge | null {
    const g = s.globals;
    if (g.tTalk > 0 && (g.blinkTTalk === 1 || (s.date.year === 1880 && s.date.mon === 4 && g.firstTT !== 1))) return { text: 'Talk', tone: 'urgent', tip: 'townsfolk are talking on the boardwalk' };
    if (claimAvailable(s)) return { text: 'Land!', tone: 'good', tip: 'the land office offers a free second claim', clear: true };
    const b = businessForSale(s);
    if (b) return { text: 'For sale', tone: 'info', tip: 'a business in town is for sale', clear: true };
    return null;
  },
  store(s: GameState): Badge | null {
    for (const c of catalogAvailable(s)) if (isNewArrival(s, c.name) && c.stock > 0) return { text: 'New!', tone: 'good', tip: 'something new arrived in the catalogue', clear: true };
    return null;
  },
  bank(s: GameState): Badge | null {
    if (s.myRecieve > 0) return { text: money(s.myRecieve), tone: 'good', tip: `${money(s.myRecieve)} is waiting for you at the cashier` };
    if (s.cursit.telegram.pending) return { text: 'Telegram', tone: 'urgent', tip: 'a telegram is waiting at the bank' };
    const l = loanInfo(s);
    if (l.has && l.monthsLeft <= 12) return { text: `Due Dec ${l.dueYear}`, tone: l.monthsLeft <= 3 ? 'urgent' : 'info', tip: `your loan of ${money(l.due)} must be repaid in December ${l.dueYear}`, clear: l.monthsLeft > 3 };
    return null;
  },
  elevator(s: GameState): Badge | null {
    const bu = s.cursit.bushels.reduce((a, b) => a + b, 0);
    if (bu > 0) return { text: `${num(bu)} bu`, tone: 'urgent', tip: `${num(bu)} bushels of grain are waiting to be sold` };
    return null;
  },
  pen(s: GameState): Badge | null {
    return livestockMarketOpen(s) ? { text: 'Fair open', tone: 'good', tip: 'the livestock fair is open this month', clear: true } : null;
  },
  almanac(s: GameState): Badge | null {
    const urgent = almanacPins(s).filter((p) => p.urgent).length;
    return urgent ? { text: String(urgent), tone: 'urgent', tip: `${urgent} deadline${urgent === 1 ? '' : 's'} coming up soon` } : null;
  },
  goals(s: GameState): Badge | null {
    const g = goalChecklist(s);
    return { text: `${Math.round(g.progress * 100)}%`, tone: 'info', tip: `you are ${Math.round(g.progress * 100)}% of the way to your goal today` };
  },
};

export const unavailable = {
  house(s: GameState): string | null {
    return s.propet.house <= 0 ? 'Your neighbors raise the sod house when you first press Advance.' : null;
  },
  pen(s: GameState): string | null {
    if (s.propet.barn !== 1) return 'Animals need a barn. Build one first.';
    if (s.date.year === 1880) return 'The first livestock fair is in April 1881.';
    if (!livestockMarketOpen(s)) return 'The livestock fair comes in April and May.';
    return null;
  },
  elevator(s: GameState): string | null {
    const has = s.cursit.bushels.some((b) => b > 0) || s.cursit.harvestValue > 0;
    return has ? null : null;
  },
};

export function grainWaiting(s: GameState) {
  const bu = s.cursit.bushels.reduce((a, b) => a + b, 0);
  return { bushels: bu, value: bu ? grainQuote(s).localTotal : 0 };
}
