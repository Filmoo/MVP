import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImportResult } from "../data/generated/ImportResult";
import { lockInToasts, statusOf } from "../lib/imports";
import { lookupErrorWords } from "../lib/players";
import { statsErrorWords } from "../lib/stats";
import { aboutLine, requiredStep } from "../lib/updates";
import { lang, localized, resolveLanguage, setLanguage, t } from ".";

describe("the language", () => {
  it("follows the system when set to auto", () => {
    expect(resolveLanguage("auto", "fr-FR")).toBe("fr");
    expect(resolveLanguage("auto", "fr")).toBe("fr");
    expect(resolveLanguage("auto", "FR-ca")).toBe("fr");
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage("auto", "de-DE"), "a language MVP isn't in").toBe("en");
    expect(resolveLanguage("auto", undefined)).toBe("en");
    expect(resolveLanguage("en", "fr-FR"), "a choice beats the system").toBe("en");
    expect(resolveLanguage("fr", "en-US")).toBe("fr");
  });

  it("switches the words in place, the last choice winning", async () => {
    const french = setLanguage("fr");
    const english = setLanguage("en");
    await Promise.all([french, english]);
    expect(lang()).toBe("en");
    expect(t().nav.home.label).toBe("Home");
    await setLanguage("fr");
    expect(lang()).toBe("fr");
    expect(t().nav.home.label).toBe("Accueil");
    expect(t().settings.title, "the views' words come along").toBe("Paramètres");
    await setLanguage("en");
    expect(t().settings.title).toBe("Settings");
  });

  it("changes nothing when told the same language again (every settings event does)", async () => {
    await setLanguage("en");
    const words = t();
    await setLanguage("en");
    await setLanguage("auto");
    expect(t(), "the same object: nothing re-renders").toBe(words);
  });

  it("shows the server's French text when French is on", async () => {
    const text = { en: "Patch 26.20 is live.", fr: "Le patch 26.20 est là." };
    expect(localized(text)).toBe("Patch 26.20 is live.");
    await setLanguage("fr");
    expect(localized(text)).toBe("Le patch 26.20 est là.");
    expect(localized({ en: "Only English.", fr: " " }), "no French: the English").toBe("Only English.");
    await setLanguage("en");
  });
});

describe("French sentences", () => {
  beforeAll(() => setLanguage("fr"));
  afterAll(() => setLanguage("en"));

  it("elide and agree", () => {
    expect(t().stats.noGamesOf("Ahri")).toBe("Pas encore de parties d’Ahri");
    expect(t().stats.noGamesOf("Yasuo")).toBe("Pas encore de parties de Yasuo");
    expect(t().common.games(0)).toBe("0 partie");
    expect(t().common.games(1)).toBe("1 partie");
    expect(t().common.games(2)).toBe("2 parties");
    expect(t().common.games(1_912_400)).toBe("1,9\u00A0M de parties");
    expect(t().draft.picksFor("middle")).toBe("Choix pour le mid");
    expect(t().champions.noBuild.text("Ahri", "jungle")).toBe(
      "Ahri a besoin de plus de parties en jungle avant que son build soit publié.",
    );
    // Plural from 2, as shown.
    expect(t().champions.pointsVs50(0.8)).toBe("+0,8\u00A0pt au\u2011dessus de 50\u00A0%");
    expect(t().champions.pointsVs50(-1.96)).toBe("−2,0\u00A0pts en dessous de 50\u00A0%");
    expect(t().champions.patchDetail(420, "Émeraude+", "hier")).toBe("Solo/Duo · Émeraude+ · hier");
  });

  it("word imports, with each part's article", () => {
    const spell = (id: number) => ({ 4: "Saut éclair", 14: "Embrasement" })[id] ?? `Sort ${id}`;
    const result: ImportResult = {
      championId: 103,
      role: "middle",
      queue: 420,
      automatic: true,
      parts: [
        { part: "runes", outcome: { kind: "saved", name: "MVP · Ahri Mid" } },
        { part: "itemSet", outcome: { kind: "failed", reason: { kind: "noBuild" } } },
        { part: "spells", outcome: { kind: "spellsSet", spellIds: [14, 4], changed: true, flash: { kind: "keptOnYourKey", key: "f" } } },
      ],
    };
    expect(lockInToasts(result, "Ahri", spell)).toEqual([
      { tone: "success", text: "Import pour Ahri\u00A0: runes et sorts. Saut éclair reste sur F, votre touche habituelle." },
      {
        tone: "error",
        text: "Échec de l’import du set d’objets pour Ahri\u00A0: Pas encore de build pour ce champion et ce rôle dans les stats.",
      },
    ]);
    expect(statusOf([{ part: "runes", outcome: { kind: "failed", reason: { kind: "noFreePage" } } }], spell)?.text).toContain(
      "renommez-en une «\u00A0MVP\u00A0»",
    );
  });

  it("word updates and failures", () => {
    expect(aboutLine({ state: "downloading", version: "0.2.0", percent: 45 }).text).toBe("Téléchargement de la version 0.2.0 (45\u00A0%)…");
    expect(requiredStep({ state: "ready", version: "0.2.0", notes: null, mandatory: true }, true).text).toBe(
      "Terminez d’abord votre partie\u00A0: MVP se met à jour juste après.",
    );
    expect(statsErrorWords({ kind: "rateLimited", retryAfter: 7 }).text).toBe("Réessayez dans 7\u00A0s.");
    expect(lookupErrorWords({ kind: "notFound" }, { gameName: "Nobody", tagLine: "404" }, "euw1").text).toBe(
      "Aucun joueur nommé Nobody#404 sur EUW. Vérifiez l’orthographe, le tag et la région.",
    );
  });
});
