import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimal, integer, percent, timeAgo } from "../lib/format";
import { setLanguage } from ".";
import { en } from "./en";
import { enViews } from "./en-views";
import { fr } from "./fr";
import { frViews } from "./fr-views";

type Tree = { [key: string]: unknown };

const EN: Tree = { ...en, ...enViews };
const FR: Tree = { ...fr, ...frViews };

/**
 * Arguments to call every function of the catalogue with (each list is one call): a new
 * function needs its samples here, so its French is checked like the rest. Numbers come
 * formatted in the language under test, as the views pass them.
 */
const samples = (): Record<string, unknown[][]> => ({
  "common.championN": [[103]],
  "common.itemN": [[3031]],
  "common.spellN": [[4]],
  "common.runeN": [[8112]],
  "common.runeTreeN": [[8100]],
  "common.colon": [["Conqueror", "Gain stacks."]],
  "common.games": [[1], [3], [3244], [1_912_400]],
  "common.lp": [[75]],
  "common.record": [[12, 8]],
  "common.wins": [[3]],
  "common.losses": [[2]],
  "common.kda": [[decimal(3.5, 2)]],
  "common.wr": [[percent(0.54)]],
  "common.patch": [["26.19"]],
  "common.updated": [[timeAgo(Date.now() - 3 * 3_600_000)]],
  "common.lastResults": [[[true]], [[true, false, true]]],
  "days.weekday": [[new Date(2026, 8, 23)]],
  "days.date": [[new Date(2026, 8, 12)], [new Date(2026, 8, 1)]],
  "shell.acceptFailed": [["HTTP 500"]],
  "search.player": [["EUW"]],
  "search.searchOn": [["Fillmo#7272", "EUW"]],
  "search.searching": [["EUW"]],
  "search.level": [[347, "EUW"]],
  "search.noPlayerOn": [["EUW"]],
  "profile.level": [[347]],
  "profile.main": [["Ahri"]],
  "profile.last": [[1], [10]],
  "profile.winRate": [[percent(0.53)]],
  "profile.lastGames": [[1], [10]],
  "profile.roleShare": [[9, 11]],
  "matches.perMinute": [[decimal(8, 1)]],
  "grade.place": [[1], [2], [3], [10]],
  "grade.label": [["A"], ["S+"]],
  "summary.title": [[1], [11]],
  "summary.remakes": [[1], [2]],
  "players.notFound.text": [["Nobody#404", "EUW"]],
  "players.rateLimited.text": [[null], [12]],
  "matchDetails.level": [[16]],
  "matchDetails.damageTitle": [["31,000"]],
  "gradeWhy.title": [["A", decimal(7.4, 1)]],
  "gradeWhy.place": [["2nd"]],
  "gradeWhy.factors.killParticipation": [[percent(0.72)]],
  "gradeWhy.factors.damageShare": [[percent(0.31)]],
  "gradeWhy.factors.damageTakenShare": [[percent(0.28)]],
  "gradeWhy.factors.objectiveShare": [[percent(0.42)]],
  "gradeWhy.factors.visionShare": [[percent(0.38)]],
  "gradeWhy.factors.csLead": [["+18"], ["−12"]],
  "gradeWhy.factors.goldLead": [["+1,240"], ["−850"]],
  "draft.bans": [[true], [false]],
  "draft.oddsAria": [[percent(0.515, 1), decimal(1.6, 1)]],
  "draft.picksFor": [["middle"], [null]],
  "draft.teamNow": [[percent(0.515, 1)]],
  "draft.vs": [["Irelia"]],
  "draft.with": [["Ahri"]],
  "draft.tier": [[2]],
  "draft.best": [[true], [false]],
  "draft.yourGames": [
    [1, percent(1)],
    [41, percent(0.56)],
  ],
  "draft.yourMastery": [[5]],
  "draft.masteryTitle": [[5, 123456]],
  "draft.rerolls": [[0], [1], [2]],
  "draft.yoursMastery": [[7]],
  "why.title": [["Malphite"], [undefined]],
  "why.vsTeamNow": [[percent(0.515, 1)]],
  "why.kept": [[percent(0.85)]],
  "why.weak": [[percent(0.24)]],
  "why.keptTitle": [[percent(0.85)]],
  "why.roleOdds": [[percent(0.94)]],
  "why.roleOddsTitle": [[percent(0.94)]],
  "why.yourGames": [[1], [41]],
  "why.withPick": [["Shen"]],
  "comps.times": [[decimal(1.12, 2)]],
  "comps.seconds": [[integer(52)]],
  "comps.atLeast": [[integer(3244)]],
  "comps.change": [["Magic", percent(0.61), percent(0.47)]],
  "comps.value": [["Magic", percent(0.47)]],
  "comps.frontlineTitle": [[`${decimal(1.12, 2)}×`]],
  "comps.ccTitle": [[integer(78)]],
  "comps.lateTitle": [["25–35 min +0,3"]],
  "comps.under": [[25]],
  "comps.between": [[25, 35]],
  "comps.over": [[35]],
  "comps.bucket": [["35 min", "+1,9"]],
  "comps.note": [["Emerald+", "26.19"]],
  "comps.noteAram": [["Emerald+", "26.19"]],
  "imports.importPart": [["runes"], ["itemSet"], ["spells"]],
  "imports.idle": [["Flash"]],
  "imports.warning.text": [
    ["Ahri Mid", "Lux"],
    ["Ahri Mid", "Ahri Support"],
  ],
  "imports.warning.importFor": [["Lux"], ["Ahri Support"]],
  "imports.mostPlayedIn": [[420, "Emerald+"]],
  "imports.failed": [["MVP is still starting"]],
  "imports.fail.client": [["Busy (HTTP 503)"]],
  "imports.skip.tooLate": [[3], [0]],
  "imports.flash.kept": [["Flash", "F"]],
  "imports.flash.guessed": [["Flash", "F"]],
  "imports.flash.notInBuild": [["Flash"]],
  "imports.savedRunes": [["MVP · Ahri Mid"]],
  "imports.savedItemSet": [["MVP · Ahri Mid"]],
  "imports.spellsOn": [["Ignite", "Flash"]],
  "imports.spellsSet": [["Ignite on D, Flash on F."]],
  "imports.spellsAlready": [["Ignite on D, Flash on F."]],
  "imports.imported": [["runes and spells"]],
  "imports.importedFor": [["runes", "Ahri"]],
  "imports.notesFor": [["Ahri", "Spells not changed."]],
  "imports.failedFor": [
    ["runes", "Ahri", "No build."],
    ["itemSet", "Ahri", "No build."],
    ["spells", "Ahri", "No build."],
  ],
  "live.scouting.busy": [[null], [12]],
  "live.otp": [["Ahri"]],
  "live.otpTitle": [[percent(0.73), "Ahri"]],
  "live.streak": [[4]],
  "live.streakTitle": [[4]],
  "live.veteranTitle": [[1], [1234]],
  "live.kdaOn": [
    [decimal(3.5, 2), "Ahri"],
    [decimal(3.5, 2), undefined],
  ],
  "live.poolTitle": [
    ["Ahri", 1, percent(1)],
    ["Ahri", 12, percent(0.58)],
  ],
  "live.mains": [["Mid / Top"]],
  "stats.queueN": [[1700]],
  "stats.errors.rateLimited.text": [[null], [7]],
  "stats.tier": [["S"]],
  "stats.noGamesOf": [["Ahri"], ["Yasuo"], ["Mel"]],
  "stats.nothingCounted": [["Ranked Solo · Emerald+"]],
  "stats.nothingCountedNew": [["Ranked Solo · Emerald+"]],
  "stats.winsInGames": [
    [1, 1],
    [1234, 2345],
  ],
  "stats.pickedIn": [
    [1, 20],
    [1234, 5000],
  ],
  "tierList.showAll": [[171]],
  "champions.tiersFrom.after": [["Ranked Solo · Emerald+"]],
  "champions.noMatch": [["zzz"]],
  "champions.noBuild.text": [
    ["Ahri", "middle"],
    ["Ahri", undefined],
  ],
  "champions.pointsVs50": [[1.2], [-0.8], [3.1]],
  "champions.ofGames": [[412_000], [1_912_400]],
  "champions.bans": [[1], [812]],
  // ARAM's line is the same words in both languages: only the ranked one is compared.
  "champions.patchDetail": [[420, "Emerald+", timeAgo(Date.now() - 20 * 3_600_000)]],
  "champions.shrunkTitle": [
    [1, 1, percent(1, 1)],
    [4820, 9100, percent(0.53, 1)],
  ],
  "champions.runePage": [["Conqueror", "Resolve", percent(0.531, 1), percent(0.23, 1)]],
  "champions.maxOrder": [[["Q", "E", "W"]]],
  "champions.levelsLabel": [[4], [3]],
  "champions.nth": [[4]],
  "champions.buildTitle": [
    ["Ahri", "middle"],
    ["Ahri", undefined],
  ],
  "champions.buildRecord": [[1], [812], [1_912_400]],
  "shards.unknownN": [[5099]],
  "settings.saveFailed": [["Settings file not writable."]],
  "settings.seconds": [[4]],
  "settings.spokenSeconds": [[1], [4]],
  "settings.imports.flashKey.title": [["Flash"]],
  "settings.imports.flashKey.text": [["Flash"]],
  "settings.app.effects.fallback": [["the graphics driver restarted"]],
  "updates.unavailable": [["development build"]],
  "updates.available": [["0.2.0"]],
  "updates.downloading": [
    ["0.2.0", 45],
    ["0.2.0", null],
  ],
  "updates.ready": [["0.2.0"]],
  "updates.failed": [["offline"]],
  "updates.restartFailed": [["in a game"]],
  "updates.required.ready": [["0.2.0"]],
  "updates.required.downloading": [
    ["0.2.0", 45],
    ["0.2.0", null],
  ],
  "updates.required.failed": [["offline"]],
  "notices.ready": [[true], [false]],
});

/**
 * Words French keeps as English has them: the game's own terms and names (ARAM, Clash, Jungle,
 * Support…), the community's (Draft, Tier list, Matchups, KDA, WR), and numbers-only formats.
 */
const SAME = new Set([
  "common.champion",
  "common.championN",
  "common.runeN",
  "common.kda",
  "common.patch",
  "roles.top",
  "roles.jungle",
  "roles.middle",
  "roles.bottom",
  "roles.support",
  "rolesShort.top",
  "rolesShort.jungle",
  "rolesShort.middle",
  "rolesShort.bottom",
  "rolesShort.support",
  "tiers.bronze",
  "tiers.challenger",
  "classes.Assassin",
  "classes.Mage",
  "classes.Support",
  "classes.Tank",
  "queues.450",
  "queues.700",
  "queues.900",
  "queues.1700",
  "queues.1750",
  "queues.1900",
  "queues.4310",
  "soloDuoShort",
  "nav.draft.label",
  "nav.draft.short",
  "nav.champions.label",
  "nav.champions.short",
  "nav.tierList.label",
  "nav.tierList.short",
  "search.sections.champions",
  "profile.stats.kda",
  "matches.outcome.remake",
  "matches.perMinute",
  "grade.mvp",
  "grade.ace",
  "matchDetails.columns.cs",
  "matchDetails.columns.vision",
  "summary.championsTitle",
  "draft.tier",
  "why.kinds.jungle",
  "why.kinds.matchup",
  "why.kinds.duo",
  "comps.none",
  "comps.rows.champions",
  "comps.rows.frontline",
  "comps.times",
  "imports.parts.runes",
  "imports.nouns.runes",
  "live.wr",
  "stats.tier",
  "tierList.title",
  "tierList.columns.rank",
  "tierList.columns.champion",
  "tierList.columns.tier",
  "tierList.columns.score",
  "champions.title",
  "champions.classes",
  "champions.patch",
  "champions.bans",
  "champions.build",
  "champions.runes",
  "champions.matchups",
  "champions.duos",
  "champions.tiersFrom.link",
  "champions.summary.runes",
  "settings.about.version",
  "settings.about.platforms.windows",
  "settings.about.platforms.macos",
  "settings.about.platforms.linux",
]);

interface Leaf {
  path: string;
  en: string;
  fr: string;
}

/** Every string of both catalogues side by side (functions called with their samples); mismatches in `problems`. */
function leaves(a: Tree, b: Tree, path: string, out: Leaf[], problems: string[], SAMPLES: Record<string, unknown[][]>): void {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.join() !== keysB.join()) problems.push(`${path || "(root)"}: keys differ: en [${keysA}] fr [${keysB}]`);
  for (const key of keysA.filter((k) => k in b)) {
    const at = path ? `${path}.${key}` : key;
    const x = a[key];
    const y = b[key];
    if (typeof x === "string" && typeof y === "string") {
      out.push({ path: at, en: x, fr: y });
    } else if (typeof x === "function" && typeof y === "function") {
      if (x.length !== y.length) problems.push(`${at}: takes ${x.length} argument(s) in English, ${y.length} in French`);
      const calls = SAMPLES[at];
      if (!calls) {
        problems.push(`${at}: no samples to check it with (add them to SAMPLES)`);
        continue;
      }
      calls.forEach((args, i) => {
        const [enText, frText] = [x(...args), y(...args)];
        if (typeof enText !== "string" || typeof frText !== "string") problems.push(`${at}#${i}: doesn't return a string`);
        else out.push({ path: at, en: enText, fr: frText });
      });
    } else if (x && y && typeof x === "object" && typeof y === "object") {
      leaves(x as Tree, y as Tree, at, out, problems, SAMPLES);
    } else {
      problems.push(`${at}: ${typeof x} in English, ${typeof y} in French`);
    }
  }
}

/** French typography: what a French reader expects around punctuation. */
function typography(text: string): string[] {
  const issues: string[] = [];
  const spaced = /[\u00A0\u202F]/;
  [...text].forEach((ch, i) => {
    const before = text[i - 1] ?? "";
    const after = text[i + 1] ?? "";
    if (":;!?%»".includes(ch) && i > 0 && !spaced.test(before)) issues.push(`no no-break space before “${ch}”`);
    if (ch === "«" && !spaced.test(after)) issues.push("no no-break space after «");
  });
  if (text.includes("'")) issues.push("straight apostrophe (use ’)");
  if (text.includes('"')) issues.push("straight quotes (use « »)");
  if (text.includes("...")) issues.push("three dots (use …)");
  if (/ {2}/.test(text)) issues.push("double space");
  return issues;
}

describe("the French catalogue", () => {
  const all: Leaf[] = [];
  const problems: string[] = [];
  beforeAll(async () => {
    // Function outputs format numbers in the current language: French for French.
    await setLanguage("fr");
    leaves(EN, FR, "", all, problems, samples());
  });
  afterAll(() => setLanguage("en"));

  it("has exactly the English shape, every function checked", () => {
    expect(problems).toEqual([]);
    expect(all.length).toBeGreaterThan(400);
  });

  it("has no empty text in either language", () => {
    expect(all.filter((l) => !l.en.trim() || !l.fr.trim()).map((l) => l.path)).toEqual([]);
  });

  it("translates everything but the shared terms", () => {
    const untranslated = all.filter((l) => l.en === l.fr && !SAME.has(l.path)).map((l) => `${l.path}: ${l.fr}`);
    expect(untranslated).toEqual([]);
    const stale = [...SAME].filter((path) => !all.some((l) => l.path === path && l.en === l.fr));
    expect(stale, "listed as shared but translated (or gone): drop them from SAME").toEqual([]);
  });

  it("follows French typography", () => {
    const wrong = all.flatMap((l) => typography(l.fr).map((issue) => `${l.path}: ${issue} in “${l.fr}”`));
    expect(wrong).toEqual([]);
  });
});
