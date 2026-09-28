/**
 * The UI's words in English and French. `en.ts` + `en-views.ts` are the source; `fr.ts` +
 * `fr-views.ts` have exactly their shapes (a missing or extra key fails the typecheck).
 *
 * Components read `t().section.key`: a signal, so switching the language re-renders the text in
 * place. Sentences that carry values are functions of them (`t().common.games(3)`), whole
 * sentences, never fragments glued in an English word order.
 *
 * Loading: the first screen's words (shell, search, Home) are in the startup bundle in English;
 * the other views' words load with the first of those views (their lazy loaders await
 * `loadViewWords`); French loads only when it is on.
 */
import { batch, createSignal } from "solid-js";
import type { Language } from "../data/generated/Language";
import type { LocalizedText } from "../data/generated/LocalizedText";
import { type CoreMessages, en } from "./en";
import type { ViewMessages } from "./en-views";

export type Messages = CoreMessages & ViewMessages;

/** A language the UI is written in (`auto` resolved). */
export type Lang = "en" | "fr";

/** The preference as last known on this machine, for the first frame (the core keeps the lasting one). */
const STORE = "mvp.language";

// Until the first view besides Home asks for them, the view words are missing (see `loadViewWords`).
// `en` is only read once asked for, never while this module loads: lib/format imports this module
// and en.ts imports lib/format, so when en.ts loads first (a test importing it, say) `en` isn't
// initialized yet at that point.
const [messages, setMessages] = createSignal<Messages>();
const [current, setCurrent] = createSignal<Lang>("en");

/** The words of the current language. */
export const t = (): Messages => messages() ?? (en as Messages);

/** The current language. */
export const lang = current;

/** Locale for `Intl` formatting of numbers and times. */
export function intlLocale(): string {
  return current() === "fr" ? "fr-FR" : "en";
}

/** `auto` follows the webview's language, which is the system's: French when it starts with `fr`. */
export function resolveLanguage(preference: Language, system: string | undefined = globalThis.navigator?.language): Lang {
  if (preference === "auto") return system?.toLowerCase().startsWith("fr") ? "fr" : "en";
  return preference;
}

function isLanguage(value: unknown): value is Language {
  return value === "auto" || value === "en" || value === "fr";
}

/** The preference kept on this machine (`auto` when none). */
export function savedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORE);
    return isLanguage(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

function save(preference: Language): void {
  try {
    localStorage.setItem(STORE, preference);
  } catch {
    // Storage unavailable: the core's copy still applies once it answers.
  }
}

const cores: Partial<Record<Lang, Promise<CoreMessages>>> = {};
const views: Partial<Record<Lang, Promise<ViewMessages>>> = {};

const coreOf = (language: Lang): Promise<CoreMessages> =>
  (cores[language] ??= language === "fr" ? import("./fr").then((m) => m.fr) : Promise.resolve(en));
const viewsOf = (language: Lang): Promise<ViewMessages> =>
  (views[language] ??= language === "fr" ? import("./fr-views").then((m) => m.frViews) : import("./en-views").then((m) => m.enViews));

/** Set once a view besides Home is on its way: from then on every language comes with its view words. */
let viewsWanted = false;

const complete = (words: Messages): boolean => "settings" in words;

/** Each language's full words, merged once: asking again gives the same object (no re-render). */
const merged: Partial<Record<Lang, Messages>> = {};

async function wordsOf(language: Lang): Promise<Messages> {
  const core = await coreOf(language);
  if (!viewsWanted) return core as Messages;
  const views = await viewsOf(language);
  merged[language] ??= { ...core, ...views };
  return merged[language];
}

let ticket = 0;

/**
 * Shows the UI in `preference` (French loads on first use) and keeps a local copy of it for the
 * next launch's first frame. The last call wins when two overlap.
 */
export async function setLanguage(preference: Language): Promise<void> {
  save(preference);
  const next = resolveLanguage(preference);
  const mine = ++ticket;
  let words = await wordsOf(next);
  // A view asked for its words meanwhile: never show a language without them from then on.
  while (viewsWanted && !complete(words)) words = await wordsOf(next);
  if (mine !== ticket) return;
  if (typeof document !== "undefined" && document.documentElement.lang !== next) document.documentElement.lang = next;
  // The same language again (every settings event says it) changes nothing: same words object.
  batch(() => {
    setMessages(words);
    setCurrent(next);
  });
}

/** Before the first frame: the language this machine used last. */
export function initLanguage(): Promise<void> {
  return setLanguage(savedLanguage());
}

/**
 * The words of the views besides Home (Draft, Live, stats pages, Settings, notices), in the
 * current language: their lazy loaders await this before rendering.
 */
export async function loadViewWords(): Promise<void> {
  viewsWanted = true;
  while (!complete(t())) {
    const language = current();
    const words = await wordsOf(language);
    if (language === current() && !complete(t())) setMessages(words);
  }
}

/** A server text in the current language (English when the French one is missing). */
export function localized(text: LocalizedText): string {
  return current() === "fr" && text.fr.trim() ? text.fr : text.en;
}
