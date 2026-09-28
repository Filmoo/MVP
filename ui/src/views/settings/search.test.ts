import { describe, expect, it } from "vitest";
import type { Messages } from "../../i18n";
import { en } from "../../i18n/en";
import { enViews } from "../../i18n/en-views";
import { fr } from "../../i18n/fr";
import { frViews } from "../../i18n/fr-views";
import { findSettings, type SearchId, settingsIndex } from "./search";

const EN = { ...en, ...enViews } as Messages;
const FR = { ...fr, ...frViews } as Messages;
const index = { en: settingsIndex(EN, "Flash"), fr: settingsIndex(FR, "Saut éclair") };

/** The settings (not cards) a query keeps on the page. */
function rows(query: string, lang: "en" | "fr" = "en"): SearchId[] {
  const found = findSettings(query, index[lang]);
  if (!found) throw new Error(`"${query}" is no search`);
  const cards = new Set(index[lang].map((c) => c.id));
  return [...found.keys()].filter((id) => !cards.has(id));
}

/** The cards a query keeps on the page. */
function cards(query: string, lang: "en" | "fr" = "en"): SearchId[] {
  const found = findSettings(query, index[lang]);
  return index[lang].map((c) => c.id).filter((id) => found?.has(id));
}

/** The marked parts of an entry's title and text. */
function marked(query: string, id: SearchId, lang: "en" | "fr" = "en"): { title: string[]; text: string[] } {
  const entry = index[lang].flatMap((c) => [c, ...c.groups.flat()]).find((e) => e.id === id);
  const marks = findSettings(query, index[lang])?.get(id);
  if (!entry || !marks) throw new Error(`"${query}" doesn't show ${id}`);
  const cut = (text = "", ranges: readonly (readonly [number, number])[]) => ranges.map(([from, to]) => text.slice(from, to));
  return { title: cut(entry.title, marks.title), text: cut(entry.text, marks.text) };
}

describe("the settings search", () => {
  it("looks for nothing until a letter or digit is typed", () => {
    for (const query of ["", "   ", "- ’ ?"]) expect(findSettings(query, index.en)).toBeNull();
  });

  it("finds settings by their title and description", () => {
    expect(rows("close to tray")).toEqual(["closeToTray"]);
    expect(rows("glass")).toEqual(["effects"]);
    expect(rows("windows start")).toContain("launchAtStartup");
    expect(rows("shop")).toEqual(["itemSet"]);
  });

  it("finds settings by what players call them (English)", () => {
    const cases: Array<[string, SearchId]> = [
      ["blur", "effects"],
      ["transparency", "effects"],
      ["animations", "effects"],
      ["queue", "autoAccept"],
      ["ready check", "autoAccept"],
      ["pop", "autoAccept"],
      ["boot", "launchAtStartup"],
      ["keystone", "runes"],
      ["items", "itemSet"],
      ["elo", "bracket"],
      ["emerald", "bracket"],
      ["diamond", "bracket"],
      ["update", "updates"],
      ["upgrade", "updates"],
      ["logs", "help"],
      ["diagnostics", "help"],
      ["language", "language"],
      ["français", "language"],
      ["english", "language"],
      ["systray", "closeToTray"],
    ];
    for (const [query, id] of cases) expect(rows(query), query).toContain(id);
  });

  it("finds settings by what players call them (French)", () => {
    const cases: Array<[string, SearchId]> = [
      ["verre", "effects"],
      ["flou", "effects"],
      ["transparence", "effects"],
      ["file d’attente", "autoAccept"],
      ["ready check", "autoAccept"],
      ["démarrage", "launchAtStartup"],
      ["boot", "launchAtStartup"],
      ["boutique", "itemSet"],
      ["objets", "itemSet"],
      ["stuff", "itemSet"],
      ["flash", "flashKey"],
      ["summoners", "spells"],
      ["elo", "bracket"],
      ["émeraude", "bracket"],
      ["mise à jour", "updates"],
      ["maj", "updates"],
      ["journaux", "help"],
      ["logs", "help"],
      ["langue", "language"],
      ["english", "language"],
    ];
    for (const [query, id] of cases) expect(rows(query, "fr"), query).toContain(id);
  });

  it("keeps a setting and the ones nested under it together", () => {
    // Flash's key refines the summoner spells row; the delay, auto-accept.
    expect(rows("flash")).toEqual(["spells", "flashKey"]);
    expect(rows("delay")).toEqual(["autoAccept", "delay"]);
    expect(rows("hotkey")).toEqual(["spells", "flashKey"]);
  });

  it("keeps a whole card when its title matches, and narrows it with more words", () => {
    // The whole Automation card, and a row elsewhere that says "automations".
    expect(cards("automation")).toEqual(["automation", "app"]);
    expect(rows("automation")).toEqual(["autoAccept", "delay", "bringToFront", "autoSwitch", "closeToTray"]);
    expect(rows("automation delay")).toEqual(["autoAccept", "delay"]);
    expect(cards("imports")).toContain("imports");
    expect(rows("imports")).toEqual(expect.arrayContaining(["runes", "itemSet", "spells", "flashKey"]));
    // About's sections are its rows.
    expect(rows("about")).toEqual(["updates", "data", "help", "legal"]);
  });

  it("forgives accents, case and punctuation", () => {
    expect(rows("FRANCAIS")).toContain("language");
    expect(rows("demarrage", "fr")).toEqual(["launchAtStartup"]);
    expect(rows("autoaccept")).toEqual(["autoAccept", "delay"]);
    expect(rows("auto-accept")).toEqual(["autoAccept", "delay"]);
    expect(rows("ÉMERAUDE", "fr")).toContain("bracket");
  });

  it("forgives a typo when nothing matches as typed", () => {
    const cases: Array<[string, SearchId, "en" | "fr"]> = [
      ["transparancy", "effects", "en"],
      ["acept", "autoAccept", "en"],
      ["lnaguage", "language", "en"],
      ["flsh", "flashKey", "en"],
      ["stratup", "launchAtStartup", "en"],
      ["diagnotics", "help", "en"],
      ["tay", "closeToTray", "en"],
      ["tranparence", "effects", "fr"],
      ["démarage", "launchAtStartup", "fr"],
    ];
    for (const [query, id, lang] of cases) expect(rows(query, lang), query).toContain(id);
  });

  it("doesn't let typos add noise to what matches as typed", () => {
    // "tray" is one letter from "tran…" (transparency), but a setting says "tray".
    expect(rows("tray")).toEqual(["closeToTray", "launchAtStartup"]);
    expect(rows("rank")).toEqual(["bracket"]);
  });

  it("counts short words only when nothing longer is typed", () => {
    expect(rows("launch on startup")).toEqual(["launchAtStartup"]);
    expect(rows("lancer au démarrage", "fr")).toEqual(["launchAtStartup"]);
    expect(rows("flash d")).toEqual(["spells", "flashKey"]);
    expect(rows("d")).toContain("flashKey");
    expect(rows("f", "fr")).toContain("flashKey");
  });

  it("needs every word, and says when nothing matches", () => {
    expect(findSettings("zzzz", index.en)?.size).toBe(0);
    expect(findSettings("tray glass", index.en)?.size).toBe(0);
    expect(findSettings("verre", index.en)?.size).toBe(0);
  });

  it("marks what matched, as typed or as the word it was taken for", () => {
    expect(marked("tray", "closeToTray")).toEqual({ title: ["tray"], text: ["tray", "tray"] });
    expect(marked("autoaccept", "autoAccept").title).toEqual(["Auto-accept"]);
    expect(marked("runes", "runes").title).toEqual(["Rune"]);
    expect(marked("demarrage", "launchAtStartup", "fr")).toEqual({ title: ["démarrage"], text: [] });
    expect(marked("transparancy", "effects")).toEqual({ title: [], text: [] });
    expect(marked("lnaguage", "language")).toEqual({ title: ["Language"], text: ["language"] });
    expect(marked("glass light", "effects").text).toEqual(["glass", "light", "light", "glass"]);
    // A matching card title is marked; its rows only where they match themselves.
    expect(marked("automation", "automation").title).toEqual(["Automation"]);
    expect(marked("automation", "bringToFront")).toEqual({ title: [], text: [] });
    // Words found only among what players call it: shown, nothing on screen to mark.
    expect(marked("blur", "effects")).toEqual({ title: [], text: [] });
  });
});
