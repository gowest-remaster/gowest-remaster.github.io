// Registry of every known original bug/quirk that the simulation touches.
// `classic` reproduces the original behaviour; `remastered` (default) applies the fix,
// except where `remasteredKeeps` is true (the quirk is kept on purpose: data verbatim,
// design intent, or no observable effect).

export type FidelityMode = 'classic' | 'remastered';

/**
 * Where a quirk lives:
 * - `sim`: the rules engine implements both behaviours (`reproduces()` is consulted in src/sim).
 * - `ui`: a presentation bug; skins call `reproduces(state.fidelity, id)` to pick the behaviour.
 * - `none`: no observable effect, or a platform detail with no equivalent in the remake.
 *   Listed so the audit is complete; the flag changes nothing.
 */
export type QuirkScope = 'sim' | 'ui' | 'none';

export interface Quirk {
  id: string;
  description: string;
  /** Spec citation. */
  spec: string;
  classic: string;
  remastered: string;
  /** true when remastered intentionally reproduces the quirk too (`remastered` gives the reason). */
  remasteredKeeps?: boolean;
  /** Default `sim`. */
  scope?: QuirkScope;
  /** One plain sentence for players ("About this remaster"). Required for every fix remastered makes. */
  player?: string;
  /** Proposal from docs/design/remastered-ux.md §9.4 (a rules change, not an original bug). */
  proposal?: boolean;
}

const Q = (q: Quirk) => q;

export const QUIRKS = {
  // ---- 02 farm sim, section 7 ----
  Q1: Q({ id: 'Q1', spec: '02 §7 Q1, §3.5.6', description: 'ChangeCash clamps cash at 0, so living costs or wages larger than cash are forgiven.', classic: 'Shortfall forgiven; savings untouched.', remastered: 'Monthly living-cost shortfall is taken from savings first; any remainder is still forgiven (cash never negative).', player: 'Living costs you couldn\'t cover with cash are now taken from your savings box instead of being quietly forgiven.' }),
  Q2: Q({ id: 'Q2', spec: '02 §7 Q2, §6.7.3', description: 'Restarting the calendar in the same month repeats the per-month checks; SON2PLOT can charge $600 twice in one August.', classic: 'Law-school fee can be charged on every calendar start in August.', remastered: 'Law-school fee is charged at most once per year. (Month-check nag messages still repeat; that is intended.)', player: 'Your son\'s law-school fee can no longer be charged twice in the same August.' }),
  Q3: Q({ id: 'Q3', spec: '02 §7 Q3, §3.4(a)6', description: 'The stop request and town-talk stop are ignored in a month where g_WasEvent = 1.', classic: 'Calendar runs one extra month.', remastered: 'Stop request honoured even after an event this month.', player: 'Pressing Stop now works even in a month when a letter or event arrived.' }),
  Q4: Q({ id: 'Q4', spec: '02 §7 Q4', description: 'Months crossed by field work, construction, helping a neighbour or the house build do not run PREPARE.', classic: 'No living cost, maturity, deadline, January re-rolls or disasters for the crossed month.', remastered: 'Each crossed month runs the month bookkeeping (flags, BuildDate re-rolls except the day, PREPARE, WhatScore).', player: 'Months that pass while you work the field, build or help a neighbor now count properly (upkeep, ripening crops, January prices, disasters).' }),
  Q5: Q({ id: 'Q5', spec: '02 §7 Q5', description: 'The 30-day NewDate helpers never roll the year.', classic: 'Unreachable in practice (no job can cross December); the sim rolls the year defensively.', remastered: 'Same: unreachable in play (no job can cross December); the sim rolls the year in both modes.', remasteredKeeps: true }),
  Q6: Q({ id: 'Q6', spec: '02 §7 Q6, §6.1', description: 'WrongEvent cannot recover a misaligned All index.', classic: 'Events and keys are kept in one list, so misalignment cannot happen.', remastered: 'Same: events and their keys share one list, so they cannot get out of step.', remasteredKeeps: true }),
  Q7: Q({ id: 'Q7', spec: '02 §7 Q7', description: 'The 1885 homestead deed letter (AL43) never sets its achievement flag.', classic: 'Deed flag never set.', remastered: 'A separate remake-only deedReceived flag is set (Propet 15.2 is left alone because it is the ALM1 flag, Q28).', player: 'The 1885 homestead deed is now remembered as received.' }),
  Q8: Q({ id: 'Q8', spec: '02 §7 Q8', description: 'CheckMoneyLoan compares g_year < 87, so the neighbour portrait is always DBox19.', classic: 'Always DBox19.', remastered: 'DBox1 before 1887, else DBox19.', player: 'Before 1887 the neighbor who helps you in hard times is shown young again, as intended.' }),
  Q9: Q({ id: 'Q9', spec: '02 §7 Q9', description: 'Propet 17.3 (fence to build) is never set; Construction fence jobs and BuildFence are unreachable.', classic: 'Dead content.', remastered: 'Same (fences come from the store).', remasteredKeeps: true }),
  Q10: Q({ id: 'Q10', spec: '02 §7 Q10', description: 'CurSit 4.4 (unsold crops) is never written, so the NoM3 advice is dead.', classic: 'NoM3 never shown.', remastered: 'Unsold bushels count as "unsold crops": NoM3 is shown when broke with grain to sell (not during the 1894 strike, when grain cannot be sold; otherwise the advice would stop the calendar forever).', player: 'When you\'re short of money but still have grain to sell, the neighbor now reminds you to sell it.' }),
  Q11: Q({ id: 'Q11', spec: '02 §7 Q11', description: 'The winter animal-death flag 2.7 is reset only in January 1881.', classic: 'Animals die at most once from 1881 on.', remastered: 'Flag resets every January.', player: 'Animals left without a barn can be lost in any winter, not just the first one.' }),
  Q12: Q({ id: 'Q12', spec: '02 §7 Q12, §1.2', description: 'Init (deadline, disasters) destroys unsold grain (CurSit line 8) and harvest totals.', classic: 'Unsold grain lost.', remastered: 'Harvested grain (lines 8/9, 4.6/4.7) survives Init; only the field is cleared.', player: 'Harvested grain no longer rots when a deadline, fire or grasshoppers clear the field; only the field itself is lost.' }),
  Q13: Q({ id: 'Q13', spec: '02 §7 Q13', description: 'SAVE writes g_WorkNow1 into CurSit 7.3, the neighbour-debt counter.', classic: 'Original-layout serializer writes g_WorkNow1 into 7.3.', remastered: 'Serializer writes the debt into 7.3 (JSON saves keep both).', player: 'Saving no longer mixes up neighbor help you owe with neighbors who helped at harvest.' }),
  Q14: Q({ id: 'Q14', spec: '02 §7 Q14', description: 'Season thresholds differ: field click uses Random 2.2 for May and October; PlowGoes swaps 1.2/2.2.', classic: 'Inconsistent thresholds reproduced.', remastered: 'All use WhatSeason thresholds (1.2 for May, 2.2 for October).', player: 'The field, the plow and the calendar all agree on when summer heat and the first frost arrive.' }),
  Q15: Q({ id: 'Q15', spec: '02 §7 Q15', description: 'Harend writes prices per bushel with floatPrecision 0, rounding them to whole dollars.', classic: 'Prices rounded to integers (0.45 -> 0, then clamped to 0.20 when sold).', remastered: 'Prices kept to the cent.', player: 'Crop prices keep their cents instead of being rounded to whole dollars (no more $0 wheat).' }),
  Q16: Q({ id: 'Q16', spec: '02 §7 Q16', description: 'Crop graphics map crop 3 to "Corn" and 4 to "Oats".', classic: 'Presentation only.', remastered: 'Presentation only (UI should draw 3 = oats, 4 = corn).', remasteredKeeps: true }),
  Q17: Q({ id: 'Q17', spec: '02 §7 Q17', description: 'The "fix the old plow for free" option costs $10.', classic: '-$10 and +10 days.', remastered: '+10 days, free.', player: 'Fixing the old plow for free really is free now (it still costs 10 days).' }),
  Q18: Q({ id: 'Q18', spec: '02 §7 Q18', description: 'Harvest worker affordability check uses a zero time and never fails.', classic: 'Never refused.', remastered: 'Refused (OneWor/ManyWor) when workers x wage x estimated days > cash.', player: 'The hired-hands check at harvest now warns you when you can\'t afford their wages.' }),
  Q19: Q({ id: 'Q19', spec: '02 §7 Q19', description: 'Early-stop harvest wipe writes to CurSit line 1 instead of line 3.', classic: 'No observable effect (Harend clears the field right after).', remastered: 'Same: no observable effect (Harend clears the field right after).', remasteredKeeps: true }),
  Q20: Q({ id: 'Q20', spec: '02 §7 Q20', description: 'Cancelling the wedding dialog skips the wedding with no consequence.', classic: 'Nothing happens.', remastered: 'Cancel = no paid wedding: child still leaves home (LifePrice -5, floor 5), no score.', player: 'Skipping a wedding still means your child moves out, so your living costs go down as they should.' }),
  Q21: Q({ id: 'Q21', spec: '02 §7 Q21', description: '1902/8: with goal = farmer the LifePrice -5 is not applied.', classic: 'No -5 when goal = 1.', remastered: '-5 always applied.', player: 'In August 1902 the farmer\'s living costs drop by $5 like everyone else\'s.' }),
  Q22: Q({ id: 'Q22', spec: '02 §7 Q22', description: '1909/7 MyRecieve +480 is granted for AL51 (no college) too.', classic: '+480 for either letter.', remastered: '+480 only for AL35 (daughter repays).', player: 'The $480 college repayment arrives only if your daughter actually went to college.' }),
  Q23: Q({ id: 'Q23', spec: '02 §7 Q23', description: 'NHelp charges the stale construction "Cost" field.', classic: 'Charges last construction cost + living cost.', remastered: 'Charges living cost only.', player: 'Helping a neighbor no longer charges you for your last construction job by mistake.' }),
  Q24: Q({ id: 'Q24', spec: '02 §7 Q24', description: 'BuAc4 1888 typo "1,67" parses as $1/bu; 1887-1890 P/B columns are ~$2.', classic: '1888 corn = $1.00.', remastered: '1888 corn = $1.67. Other drought prices kept verbatim.', player: 'The 1888 corn price typo is fixed: corn sells for $1.67, not $1.' }),
  Q25: Q({ id: 'Q25', spec: '02 §7 Q25', description: 'Drought scenes have no yield effect.', classic: 'Design.', remastered: 'Kept by design: droughts are scenery; rain and frost stops come from the season days.', remasteredKeeps: true }),
  Q26: Q({ id: 'Q26', spec: '02 §7 Q26, §6.1 type 2', description: 'Donation scoring uses integer division of LifePrice; donating $0 scores +2.', classic: 'Integer thresholds; $0 = +2.', remastered: 'Exact thresholds; $0 donation = no score.', player: 'Donating $0 no longer earns you standing, and donation tiers use exact amounts.' }),
  Q27: Q({ id: 'Q27', spec: '02 §7 Q27', description: '1880 with a barn and no windmill: WMEOG stops the calendar every month except June/July.', classic: 'Nag every month.', remastered: 'Same (it is the tutorial nag).', remasteredKeeps: true }),
  Q28: Q({ id: 'Q28', spec: '02 §7 Q28', description: 'ALM1 letter flag shares Propet 15.2 with the deed flag.', classic: 'Shared slot.', remastered: 'Deed uses its own flag (see Q7).', player: 'The deed and the first politician\'s letter no longer share one memory slot.' }),
  // ---- found in the Lingo while implementing (not in the spec quirk lists) ----
  PAYSAV: Q({ id: 'PAYSAV', spec: 'CALEND ScoreScript 49/50/54/55, MovieScript 5 (SON2PLOT); 02 §6.1', description: 'Event payments "cash first, then savings" zero cash and then subtract the FULL amount from savings (cash is already 0), so the player loses cash + amount. With a negative letter amount (type 6) savings even grow.', classic: 'Reproduced exactly.', remastered: 'Only the shortfall is taken from savings.', player: 'Paying from cash and then savings now takes only what you owe, instead of emptying your cash and charging your savings the full amount again.' }),
  FAMW: Q({ id: 'FAMW', spec: 'CALEND ScoreScript 55; 02 §6.1 type 3', description: 'Family helpers +1 is applied before the money check, so a failed/retried Yes increments it again.', classic: 'Reproduced.', remastered: 'Incremented once, only on success.', player: 'Saying Yes to a family request you can\'t afford no longer adds an extra family worker.' }),
  DOCEQ: Q({ id: 'DOCEQ', spec: '02 §6.1 type 4', description: 'Doctor: text says the visit is free when cash <= 2xLifePrice, but $25 is charged when cash >= 2xLifePrice (both at equality).', classic: 'Charged at equality.', remastered: 'Free at equality.', player: 'The doctor\'s visit is free exactly when the doctor says it is.' }),
  DOC0: Q({ id: 'DOC0', spec: 'CALEND ScoreScript 49; 02 §6.3', description: 'Doctor list OK with no items selected still scores +3.', classic: '+3.', remastered: 'No score.', player: 'Buying nothing from the doctor\'s list no longer earns standing.' }),
  MAYOR: Q({ id: 'MAYOR', spec: 'CALEND ScoreScript 62', description: 'A budget outcome equal to the previous one (g_MayerTTalk) schedules no town talk.', classic: 'Repeated outcome adds no talk.', remastered: 'Talk always scheduled.', player: 'As mayor, every budget you pass gets its own town talk, even if the result matches last year\'s.' }),
  LOGLOC: Q({ id: 'LOGLOC', spec: '02 §6.15; 03 §0.5, §6.3', description: 'Wrong logbook locations: trivia 9 (invalid), livestock 6 (Dealer), elevator sale 7 (Livestock market), O\'Grady 8 (invalid, $0 income).', classic: 'Wrong locations.', remastered: 'Trivia 5, livestock 7, elevator 6, O\'Grady 6 with income at bank receipt.', player: 'The ledger now files trivia, livestock, elevator and O\'Grady entries under the right place, with O\'Grady income shown.' }),
  SAVLOG: Q({ id: 'SAVLOG', spec: '04 §3', description: 'Savings moves are logged with cost 0 and income 0; house upgrades are not logged.', classic: 'Amounts not logged; upgrades not logged.', remastered: 'Amounts logged (cost for put away, income for take out); upgrades logged as Farm house / Buy.', player: 'The ledger now records how much you moved in or out of savings, and logs house upgrades.' }),
  ANIMIDX: Q({ id: 'ANIMIDX', spec: '04 §6.3', description: 'Album shows 17 pictures only when exactly one Kodak is owned.', classic: '2+ cameras -> 5 pictures.', remastered: '>= 1 camera -> 17 pictures.', player: 'Buying a second Kodak camera no longer hides most of your album pictures.' }),
  CAPSCAN: Q({ id: 'CAPSCAN', spec: '04 §6.5', description: 'Album caption date scan includes the first future caption, stops early on unsorted casts, and is stale in Dec 1918.', classic: 'Scan as written.', remastered: 'Exactly the captions whose date has been reached.', player: 'The album offers exactly the captions for events that have already happened.' }),
  // ---- 03 town ----
  T1: Q({ id: 'T1', spec: '03 §6.1, §1.5', description: 'The June/July 1894 railroad strike wipes all unsold bushels when you visit the elevator.', classic: 'Bushels wiped (value in 4.6 survives).', remastered: 'Strike refuses the sale without destroying grain.', player: 'The 1894 railroad strike stops grain sales but no longer destroys your stored grain.' }),
  T2: Q({ id: 'T2', spec: '03 §6.2', description: 'Nothing-to-sell resets CurSit line 8.', classic: 'Reset (harmless).', remastered: 'Same: harmless (there is nothing left to reset).', remasteredKeeps: true }),
  T7: Q({ id: 'T7', spec: '03 §6.7, §1.7', description: "Reilly's Shirt Shop ad says $40/month; the data pays $30.", classic: '$30.', remastered: '$40 as advertised.', player: 'Reilly\'s Shirt Shop pays the $40 a month its sign promises.' }),
  T8: Q({ id: 'T8', spec: '03 §6.8', description: 'Business, claim, seeds, catalogue and loan repayment use cash only.', classic: 'Cash only.', remastered: 'Same (design).', remasteredKeeps: true }),
  T11: Q({ id: 'T11', spec: '03 §6.11', description: 'Bank logbook merge skips line 1: the first bank transaction of each visit is not logged.', classic: 'First transaction per bank visit unlogged.', remastered: 'All logged.', player: 'The first bank transaction of each visit now appears in your ledger.' }),
  T12: Q({ id: 'T12', spec: '03 §6.12, §2.7', description: 'No loan cap other than the 4-digit field.', classic: 'Up to $9999.', remastered: 'Capped at the land value (Propet 8.3), the rule the unused SEG008 line describes.', player: 'The bank won\'t lend more than your land is worth, as the banker explains.' }),
  T13: Q({ id: 'T13', spec: '03 §6.13', description: 'REPAY only in Nov/Dec of the due year; an unpaid-but-affordable loan blocks new loans forever.', classic: 'Repay window only.', remastered: 'Repay any time a loan exists.', player: 'You can repay a loan any time, and an unpaid loan no longer blocks new loans forever.' }),
  T17: Q({ id: 'T17', spec: '03 §6.17, 02 §3.5.5', description: 'Yearly loan interest computed in PREPARE is discarded.', classic: 'No yearly interest (the RNG roll is still consumed).', remastered: 'Same (interest is compounded at signing).', remasteredKeeps: true }),
  T18: Q({ id: 'T18', spec: '03 §6.18, §3.3', description: 'Store error counter counts every OK press; on the 3rd wrong try the clerk fills in the answer.', classic: 'Reproduced.', remastered: 'Kept by design: after three wrong totals Harriet works it out for you, a gentle math helper.', remasteredKeeps: true }),
  T21: Q({ id: 'T21', spec: '03 §6.21, §5.2', description: 'Newspaper availability compares against the previous issue\'s month/day; inverted in Jan 1919.', classic: 'Rule as written.', remastered: 'Issue k readable once the date reaches its issue date.', player: 'Each newspaper issue can be read from its publication date (the old date check was wrong most months).' }),
  OGNEG: Q({ id: 'OGNEG', spec: '03 §1.5 edge cases', description: "O'Grady total can be negative (haul > bonus) and is added to MyRecieve anyway.", classic: 'Negative added (reduces later bank receipts).', remastered: 'Clamped at 0.', player: 'An O\'Grady deal can no longer leave you owing money when hauling costs more than the bonus.' }),
  // ---- remastered proposals (docs/design/remastered-ux.md §9.4): rules changes, not bugs ----
  VISITROLL: Q({ id: 'VISITROLL', proposal: true, spec: 'remastered-ux §9.4; 02 §5.1, §6.13; 03 §1.2', description: 'Per-visit rolls (field wage and neighbours, O\'Grady presence, livestock maxima and prices) are re-rolled on every visit, so instant travel turns re-entering into a free re-roll.', classic: 'Re-rolled on every visit.', remastered: 'Rolled once per month on the first visit and reused for the rest of that month (same distribution).', player: 'Wages, O\'Grady\'s wagon and livestock prices are set once a month, so walking out and back in no longer changes them.' }),
  RNGSTREAM: Q({ id: 'RNGSTREAM', proposal: true, spec: 'remastered-ux §9.4, §6.5', description: 'One RNG drives both the world (weather, disasters, yields, events) and per-visit rolls, so merely visiting a place can change whether a fire comes.', classic: 'Single stream (the remake RNG is not the original\'s anyway).', remastered: 'Two streams: world (month advance, disasters, yields, prices, events, trivia) and visit (the per-visit rolls of the field, town and livestock fair). Navigation cannot change fate, which keeps Undo and Rewind honest.', player: 'Looking around town can no longer change your luck: weather and disasters follow only your real decisions.' }),
  TRIVKEEP: Q({ id: 'TRIVKEEP', proposal: true, spec: 'remastered-ux §9.4; 02 §3.2', description: 'The trivia card closes on any non-trivia command, so going anywhere forfeits the question.', classic: 'Card closes on any other command.', remastered: 'Card stays open until the month changes.', player: 'The trivia card waits for you until the end of the month instead of vanishing when you walk away.' }),
  // ---- found while auditing (not in the spec quirk lists) ----
  SKIPEVT: Q({ id: 'SKIPEVT', spec: '02 §3.4, Q4 (Date check runs only for the month the calendar is in)', description: 'A field job that crosses two month boundaries (e.g. April to June) skips the Date check of the month in between, so a letter or event scheduled in that month never arrives.', classic: 'Event lost.', remastered: 'Events of skipped months are moved to the next month without an event in the same year (only events whose resolution does not depend on the exact month).', player: 'A letter that was due while you were busy in the field now arrives late instead of being lost.' }),
  WINTERLOCK: Q({ id: 'WINTERLOCK', spec: '02 §6.6 MonthCheck, Q27; 02 §6.12 build months', description: 'A "build your windmill/barn" reminder stops the calendar at every Date check until fixed, but nothing can be built from November to February. If a tornado wrecks the windmill and the store has no windmill left, the calendar can never advance again (also November 1880 with nothing built).', classic: 'Soft-lock reproduced (buy a catalogue windmill to escape while stock lasts).', remastered: 'From November to February the reminder is shown without stopping the calendar; from March it blocks again until you build.', player: "A neighbor's reminder to rebuild can no longer freeze the calendar in winter, when building is impossible." }),
  LOANRATE: Q({ id: 'LOANRATE', spec: '03 §2.7, §6.14', description: 'The loan info screen shows today\'s interest rate, not the rate the loan was signed at.', classic: 'Shows today\'s rate (`loanInfo().rate`).', remastered: 'Shows the contracted rate (stored at signing).', player: 'The bank shows the interest rate your loan was actually signed at.' }),
  ALBUMPIC: Q({ id: 'ALBUMPIC', spec: '04 §6.3 quirk 2', description: 'A page storing a picture number above the current maximum keeps incrementing past the last picture into missing casts.', classic: 'Any picture number is stored.', remastered: 'Picture numbers are clamped to 0..albumMaxPictures.', player: 'Album pages can no longer point at pictures that don\'t exist.' }),
  ALBUMCLEAR: Q({ id: 'ALBUMCLEAR', scope: 'none', spec: '04 §6.1', description: 'New game clears only album pages 3..23; pages 24..50 keep text from a previous game on the same install.', classic: 'Not reproducible: every remake game owns its album.', remastered: 'Every new game starts with a blank album.', player: 'A new game always starts with a clean family album.' }),
  STOCKSAVE: Q({ id: 'STOCKSAVE', scope: 'none', spec: '03 §3.4, §6.19', description: 'Catalogue stock is written back only when leaving the catalogue normally; leaving another way keeps the purchase but not the stock change.', classic: 'Not reproduced: every purchase updates stock atomically.', remastered: 'Stock always updated.', player: 'Store stock is always updated after a purchase, however you leave the catalogue.' }),
  BOOKMARK: Q({ id: 'BOOKMARK', scope: 'none', spec: '01 §4.2, §9.6', description: 'The bookmark writer never deletes stale higher-numbered save files.', classic: 'Not applicable: JSON saves.', remastered: 'Not applicable: JSON saves.', remasteredKeeps: true }),
  // ---- presentation bugs: skins consult reproduces() ----
  CURRENCY: Q({ id: 'CURRENCY', scope: 'ui', spec: '01 §5.5, §9.17', description: 'numberToCurrency puts the minus sign after the $ ("$-5.00").', classic: '"$-5.00".', remastered: '"-$5.00".', player: 'Negative amounts are written the normal way (-$5.00).' }),
  CREDITS: Q({ id: 'CREDITS', scope: 'ui', spec: '01 §6.3, §9.11; secrets §2.6', description: 'The credits scroller stops at line 105 of 124, so the last lines never show.', classic: 'Stops at line 105.', remastered: 'Scrolls to the end.', player: 'The credits now roll all the way to the last name.' }),
  BUBBLE92: Q({ id: 'BUBBLE92', scope: 'ui', spec: '01 §9.9', description: 'Hint bubble 92\'s cast name contains a space, so it never displays.', classic: 'Bubble 92 never shown.', remastered: 'Bubble 92 shown.', player: 'A help bubble that never appeared in 1996 now shows up.' }),
  CURSORON: Q({ id: 'CURSORON', scope: 'ui', spec: '01 §9.8; 04 §2.3', description: 'CursorOn tests the wrong sprite\'s visibility, so the hand cursor appears over hidden or wrong hotspots.', classic: 'Cursor as coded.', remastered: 'Hand cursor exactly over active hotspots.', player: 'The pointing hand appears exactly over things you can click.' }),
  INTROHAND: Q({ id: 'INTROHAND', scope: 'ui', spec: '01 §9.13; secrets §9', description: 'The INTRO driver\'s hand animation never starts (global declared as gHnadAnimObj).', classic: 'No hand animation.', remastered: 'Hand animates.', player: 'The wagon driver in the introduction finally moves his hand.' }),
  PT4: Q({ id: 'PT4', scope: 'ui', spec: '03 §1.5, §6.6', description: 'The elevator\'s corn price display can be rounded and truncated to 4 characters ("$1" instead of "$0.60"); the row total is right.', classic: 'Truncated display.', remastered: 'Price shown to the cent.', player: 'The elevator shows the real corn price instead of a cut-off number.' }),
  STRIKESND: Q({ id: 'STRIKESND', scope: 'ui', spec: '03 §1.5, §6.5', description: 'In June-August 1894 DelSetup skips assigning the dealer voice lines, so stale or missing sounds play.', classic: 'Stale or silent dealer lines.', remastered: 'The year\'s normal dealer lines play.', player: 'Grain dealers speak their proper lines in the summer of 1894.' }),
  STRIKE721: Q({ id: 'STRIKE721', scope: 'ui', spec: '03 §6.4; secrets §9', description: 'The Dealers rows for the 1894 strike are unreachable, so line 721 ("the strike is over... some of your grain went bad") never plays.', classic: 'Never plays.', remastered: 'Still unused: remastered keeps your grain through the strike (T1), so the line would be untrue.', remasteredKeeps: true }),
  CLAIMCURSOR: Q({ id: 'CLAIMCURSOR', scope: 'ui', spec: '03 §1.8, §6.9', description: 'The land-claim sign\'s cursor logic disagrees with its visibility window (1909 vs. Mar 1910).', classic: 'Cursor as coded.', remastered: 'Clickable exactly while visible (claimAvailable).', player: 'The free-land sign is clickable exactly while it is shown.' }),
  STREETERA: Q({ id: 'STREETERA', scope: 'ui', spec: '03 §6.10', description: 'Some bank/store exit paths jump to frame 1 of the street and show the wrong era\'s street art.', classic: 'Wrong-era street on some exits.', remastered: 'Street always matches the year.', player: 'Main Street always looks like the right decade when you step outside.' }),
  DUEDATE: Q({ id: 'DUEDATE', scope: 'ui', spec: '03 §6.15; secrets §9', description: 'The loan repayment date reads "Dec. ,1886".', classic: '"Dec. ,1886".', remastered: '"Dec. 1886".', player: 'Loan due dates are printed properly ("Dec. 1886").' }),
  STOREGREET: Q({ id: 'STOREGREET', scope: 'ui', spec: '03 §6.18', description: 'Harriet\'s greeting plays only on the first two seed visits per program run.', classic: 'First two visits per run.', remastered: 'First visit of each month.', player: 'Harriet at the store greets you again on your first visit each month.' }),
  CATSTOCK: Q({ id: 'CATSTOCK', scope: 'ui', spec: '03 §3.4, §6.19', description: 'The catalogue\'s in-stock count is never displayed (unregistered sprite names).', classic: 'Count hidden.', remastered: 'Count shown.', player: 'The catalogue tells you how many of each item are left.' }),
  CATORDER: Q({ id: 'CATORDER', scope: 'ui', spec: '03 §6.19', description: 'In-stock catalogue product pages appear in reverse order.', classic: 'Reverse order.', remastered: 'Catalogue order.', player: 'Catalogue pages appear in their proper order.' }),
  TTDSILENT: Q({ id: 'TTDSILENT', scope: 'ui', spec: '03 §4, §6.20; secrets §8', description: 'Town-talk default lines are silent because of a path bug ("ttd_ 5.WAV").', classic: 'Silent.', remastered: 'Default lines are voiced.', player: 'Townsfolk with nothing new to say now actually say it out loud.' }),
  LOGNOTES: Q({ id: 'LOGNOTES', scope: 'ui', spec: '04 §4.1', description: 'Leaving the logbook through the bottom strip discards notes typed on the visible page.', classic: 'Notes lost.', remastered: 'Notes always saved.', player: 'Notes you type in the ledger are always kept, however you close it.' }),
  HOUSE3MUSIC: Q({ id: 'HOUSE3MUSIC', scope: 'ui', spec: '04 §2.1', description: 'The wooden house (HOUSE3) neither restarts the house music nor resets its input state.', classic: 'Music not restarted.', remastered: 'House music plays in every house.', player: 'The house music plays in the wooden house too.' }),
  NEWSART: Q({ id: 'NEWSART', scope: 'none', spec: '03 §6.22, §6.23', description: 'Newspaper art inconsistencies (headline wording, "FARMELAND", "Temperence", a small 1919 crop).', classic: 'As printed.', remastered: 'Kept as printed: it is the original artwork, shown verbatim.', remasteredKeeps: true }),
  // ---- no observable effect (listed so the audit is complete) ----
  LOGTPL: Q({ id: 'LOGTPL', scope: 'none', spec: '01 §5.5, §9.7', description: 'FillLogBook initialises l_Lobbook but uses l_LogBook.', classic: 'No effect (the row is built directly).', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
  APIPATH: Q({ id: 'APIPATH', scope: 'none', spec: '01 §9.1; secrets §7', description: 'Misspelt student-path globals (gsStudentPrivatePath / StudnetPrivatePath) mean the launcher path never works.', classic: 'Not applicable (no Edunetics launcher).', remastered: 'Not applicable: there is no Edunetics launcher.', remasteredKeeps: true }),
  CONFIRMNO: Q({ id: 'CONFIRMNO', scope: 'none', spec: '01 §9.2', description: 'LOGIN Confirm "No" calls vTryAgainBtn instead of vConfirmNoBtn.', classic: 'Equivalent behaviour.', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
  ORGPLAY: Q({ id: 'ORGPLAY', scope: 'none', spec: '01 §9.14', description: 'ORGPLAY calls a handler that does not exist.', classic: 'No effect (ORGPLAY is not used).', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
  WOODFENCE: Q({ id: 'WOODFENCE', scope: 'none', spec: '01 §9.15; 03 §6.19', description: 'edResetCatalog references a non-existent #woodenFence product.', classic: 'No effect.', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
  IRANDOM8: Q({ id: 'IRANDOM8', scope: 'none', spec: '01 §9.16', description: 'The IRandom trivia-order template lacks the number 8.', classic: 'No effect (edRandom overwrites it at new game).', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
  INTEREST1: Q({ id: 'INTEREST1', scope: 'none', spec: '01 §9.20; 03 §6.16', description: 'g_interest reads only the first character of the Interest field.', classic: 'No effect (rates are 3..7%, one digit).', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
  TABL: Q({ id: 'TABL', scope: 'none', spec: '04 §4.1', description: 'Old logbook Tabl code (row tint, shifted Pay Interest row) is never called.', classic: 'No effect.', remastered: 'Same: no observable effect.', remasteredKeeps: true }),
} as const satisfies Record<string, Quirk>;

export type QuirkId = keyof typeof QUIRKS;

export interface FidelityOptions {
  mode: FidelityMode;
  /** Per-quirk override: true = reproduce the original behaviour. */
  overrides?: Partial<Record<QuirkId, boolean>>;
}

/** Does this configuration reproduce quirk `id`? */
export function reproduces(opts: FidelityOptions, id: QuirkId): boolean {
  const o = opts.overrides?.[id];
  if (o !== undefined) return o;
  if (opts.mode === 'classic') return true;
  return (QUIRKS[id] as Quirk).remasteredKeeps === true;
}

export const ALL_QUIRK_IDS = Object.keys(QUIRKS) as QuirkId[];

/** Scope of a quirk (default `sim`). */
export function quirkScope(id: QuirkId): QuirkScope {
  return (QUIRKS[id] as Quirk).scope ?? 'sim';
}

/**
 * Every original behaviour the Remastered rules change, as one plain sentence each, in registry
 * order. This is the list for the "About this remaster" screen (and src/sim/BUGFIXES.md).
 * `proposals` false leaves out the §9.4 rules changes that are not bug fixes.
 */
export function remasterFixes(opts: { proposals?: boolean } = {}): { id: QuirkId; text: string; proposal: boolean }[] {
  return ALL_QUIRK_IDS.filter((id) => {
    const q = QUIRKS[id] as Quirk;
    return !q.remasteredKeeps && !!q.player && (opts.proposals !== false || !q.proposal);
  }).map((id) => ({ id, text: (QUIRKS[id] as Quirk).player!, proposal: !!(QUIRKS[id] as Quirk).proposal }));
}
