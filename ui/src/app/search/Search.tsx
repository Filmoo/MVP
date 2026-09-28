import { createEffect, createMemo, createSignal, For, type JSX, Match, on, onCleanup, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { BackendError } from "../../data/generated/BackendError";
import type { PlayerProfile } from "../../data/generated/PlayerProfile";
import { ChampionIcon, ProfileIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { liquid } from "../../design/liquid/liquid";
import { TierBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { classes } from "../../lib/champions";
import { backendError, lookupPlayer } from "../../lib/players";
import { clearRecent, recent, remember } from "../../lib/recent";
import {
  DEFAULT_PLATFORM,
  formatRiotId,
  isPlatform,
  PLATFORMS,
  parseRiotId,
  platformLabel,
  playerPath,
  riotIdKey,
} from "../../lib/riot-id";
import { navigate } from "../router";
import { buildSections, defaultIndex, type SearchOption, type SearchSection } from "./options";
import styles from "./Search.module.css";

/** Network work waits for typing to pause; the local list never does. */
export const LOOKUP_DEBOUNCE_MS = 300;
const PLATFORM_STORE = "mvp.search.platform";

type Lookup = { state: "loading" } | { state: "ready"; profile: PlayerProfile } | { state: "error"; error: BackendError };

function savedPlatform(): string {
  try {
    const saved = localStorage.getItem(PLATFORM_STORE);
    return saved && isPlatform(saved) ? saved : DEFAULT_PLATFORM;
  } catch {
    return DEFAULT_PLATFORM;
  }
}

/** The mounted search field (one per window). */
let field: HTMLInputElement | undefined;

/** Puts the cursor in the search field and opens it ("Search again" buttons). */
export function focusSearch(): void {
  field?.focus();
  field?.select();
}

/** Typing into another field: "/" is text there, not a shortcut. */
function typingElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function PlayerLine(props: { option: Extract<SearchOption, { kind: "player" }>; lookup: Lookup | undefined }): JSX.Element {
  const region = () => platformLabel(props.option.platform);
  const profile = () => (props.lookup?.state === "ready" ? props.lookup.profile : undefined);
  const secondary = () => {
    const l = props.lookup;
    const words = t().search;
    if (props.option.recent && !l) return words.player(region());
    if (!l) return words.searchOn(formatRiotId(props.option.riotId), region());
    if (l.state === "loading") return words.searching(region());
    if (l.state === "ready") return words.level(l.profile.level, region());
    if (l.error.kind === "notFound") return words.noPlayerOn(region());
    return words.checkFailed;
  };
  return (
    <>
      <span class={styles.lead}>
        <Switch fallback={<Icon name="user" size={16} />}>
          <Match when={profile()}>{(p) => <ProfileIcon iconId={p().profileIconId} size={28} />}</Match>
          <Match when={props.lookup?.state === "error"}>
            <Icon name="alert" size={16} />
          </Match>
        </Switch>
      </span>
      <span class={styles.text}>
        <span class={styles.primary}>
          {/* Riot's spelling once known (IDs are case-insensitive). */}
          <span class={styles.name}>{(profile()?.riotId ?? props.option.riotId).gameName}</span>
          <span class={styles.tag}>#{(profile()?.riotId ?? props.option.riotId).tagLine}</span>
        </span>
        <span class={`${styles.secondary} ${props.lookup?.state === "error" ? styles.warn : ""}`}>{secondary()}</span>
      </span>
      {/* Fixed-width slot: the rank fills it in place, nothing moves. */}
      <span class={`${styles.trail} num`}>
        <Switch>
          <Match when={props.lookup?.state === "loading" || (!props.lookup && !props.option.recent)}>
            <span class={styles.skeleton} data-state={props.lookup?.state === "loading" ? "loading" : undefined} />
          </Match>
          <Match when={profile()}>
            {(p) => (
              <Show when={p().soloQueue} fallback={<span class={styles.muted}>{t().common.unranked}</span>}>
                {(q) => (
                  <>
                    <TierBadge tier={q().tier} division={q().division} class={styles.tier} />
                    <span class={`${styles.muted} ${styles.lp}`}>{t().common.lp(q().leaguePoints)}</span>
                  </>
                )}
              </Show>
            )}
          </Match>
        </Switch>
      </span>
    </>
  );
}

function ChampionLine(props: { option: Extract<SearchOption, { kind: "champion" }> }): JSX.Element {
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(props.option.championId);
  return (
    <>
      <span class={styles.lead}>
        <ChampionIcon championId={props.option.championId} size={28} round />
      </span>
      <span class={styles.text}>
        <span class={styles.primary}>
          <span class={styles.name}>{champion()?.name ?? t().common.championN(props.option.championId)}</span>
        </span>
        <span class={styles.secondary}>
          {props.option.recent ? t().common.champion : (classes(champion()?.tags) ?? t().common.champion)}
        </span>
      </span>
      <span class={styles.trail} />
    </>
  );
}

/**
 * Title-bar search: champions (instant, local) and players (Riot ID, looked up in the
 * background). Enter always opens the row highlighted when it is pressed; lookups resolving
 * later only fill their row in, they never add, move or re-highlight rows.
 */
export function Search(): JSX.Element {
  const { transport, gameData } = useData();
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [platform, setPlatform] = createSignal(savedPlatform());
  /** Highlight moved with the keyboard or mouse, valid for the query it was moved in. */
  const [moved, setMoved] = createSignal<{ query: string; index: number } | null>(null);
  const [lookups, setLookups] = createSignal<Record<string, Lookup>>({});
  let input!: HTMLInputElement;
  let root!: HTMLDivElement;

  const champions = createMemo(() => [...(gameData()?.champions.values() ?? [])]);
  const sections = createMemo<SearchSection[]>(() => buildSections(query(), platform(), champions(), recent()));
  const options = createMemo(() => sections().flatMap((s) => s.options));
  const scope = () => `${platform()}|${query()}`;
  const active = () => {
    const count = options().length;
    const m = moved();
    if (m && m.query === scope() && count > 0) return Math.min(m.index, count - 1);
    return defaultIndex(query(), options());
  };
  const optionId = (index: number) => `search-option-${index}`;
  const lookupFor = (option: SearchOption) => (option.kind === "player" ? lookups()[riotIdKey(option.platform, option.riotId)] : undefined);

  // Player lookups: debounced, and only ever fill a row in.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settleLookup = (key: string, next: Lookup) => setLookups((all) => ({ ...all, [key]: next }));
  createEffect(
    on([() => parseRiotId(query().trim()), platform], ([riotId, pf]) => {
      clearTimeout(timer);
      if (!riotId) return;
      const key = riotIdKey(pf, riotId);
      if (lookups()[key]) return;
      timer = setTimeout(() => {
        settleLookup(key, { state: "loading" });
        lookupPlayer(transport, pf, riotId).then(
          (profile) => settleLookup(key, { state: "ready", profile }),
          (error: unknown) => settleLookup(key, { state: "error", error: backendError(error) }),
        );
      }, LOOKUP_DEBOUNCE_MS);
    }),
  );
  onCleanup(() => clearTimeout(timer));

  const close = () => {
    setOpen(false);
    setMoved(null);
  };

  const choose = (option: SearchOption | undefined) => {
    if (!option) return;
    if (option.kind === "champion") {
      remember({ kind: "champion", championId: option.championId });
      navigate(`/champions?id=${option.championId}`);
    } else {
      remember({ kind: "player", platform: option.platform, riotId: option.riotId });
      navigate(playerPath(option.platform, option.riotId));
    }
    setQuery("");
    close();
    input.blur();
  };

  const move = (delta: number) => {
    const count = options().length;
    if (count === 0) return;
    const from = active();
    setMoved({ query: scope(), index: ((((from < 0 ? -1 : from) + delta) % count) + count) % count });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpen(true);
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        setOpen(true);
        move(-1);
        break;
      case "Enter":
        e.preventDefault();
        // What is highlighted right now, whatever is still loading.
        if (open()) choose(options()[active()]);
        else setOpen(true);
        break;
      case "Escape":
        e.preventDefault();
        if (open() && query()) setQuery("");
        else if (open()) close();
        else input.blur();
        break;
      case "Tab":
        close();
        break;
    }
  };

  // Ctrl+K anywhere, or "/" when not typing somewhere else, focuses the search.
  const onGlobalKey = (e: KeyboardEvent) => {
    const shortcut = (e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.altKey;
    if (shortcut || (e.key === "/" && !e.ctrlKey && !e.metaKey && !typingElsewhere(e.target))) {
      e.preventDefault();
      input.focus();
      input.select();
      setOpen(true);
    }
  };
  document.addEventListener("keydown", onGlobalKey);
  onCleanup(() => {
    document.removeEventListener("keydown", onGlobalKey);
    if (field === input) field = undefined;
  });

  const onFocusOut = (e: FocusEvent) => {
    if (!(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) close();
  };

  const changePlatform = (next: string) => {
    if (!isPlatform(next)) return;
    setPlatform(next);
    try {
      localStorage.setItem(PLATFORM_STORE, next);
    } catch {
      // not remembered: EUW next time
    }
    input.focus();
  };

  /** Sections with the index of their first option in the flat list Enter and the arrows use. */
  const laidOut = createMemo(() => {
    let start = 0;
    return sections().map((section) => {
      const at = start;
      start += section.options.length;
      return { ...section, start: at };
    });
  });

  return (
    <div class={styles.search} ref={root} onFocusOut={onFocusOut} data-open={open() ? "" : undefined}>
      <div class={styles.field}>
        <Icon name="search" size={16} class={styles.glass} />
        <input
          ref={(el) => {
            input = el;
            field = el;
          }}
          class={styles.input}
          type="text"
          role="combobox"
          aria-label={t().search.label}
          aria-expanded={open()}
          aria-controls="search-panel"
          aria-autocomplete="list"
          aria-activedescendant={open() && active() >= 0 ? optionId(active()) : undefined}
          placeholder={t().search.placeholder}
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          data-testid="search-input"
        />
        <span class={styles.kbd} aria-hidden="true">
          Ctrl K
        </span>
        <select
          class={styles.region}
          aria-label={t().search.region}
          value={platform()}
          onChange={(e) => changePlatform(e.currentTarget.value)}
          data-testid="search-region"
        >
          <For each={PLATFORMS}>{(p) => <option value={p.id}>{p.label}</option>}</For>
        </select>
      </div>
      <Show when={open()}>
        <div class={`${styles.panel} glass-rim`} id="search-panel" data-testid="search-panel">
          <div class={styles.panelGlass} aria-hidden="true" ref={(el) => liquid(el, "panel")} />
          <Show
            when={sections().length > 0}
            fallback={
              <p class={styles.hint}>
                {t().search.hint} <span class={styles.example}>{t().search.example}</span>
              </p>
            }
          >
            <div class={styles.list} role="listbox" aria-label={t().search.results}>
              <For each={laidOut()}>
                {(section) => (
                  // biome-ignore lint/a11y/useSemanticElements: ARIA listbox group (a fieldset isn't allowed in a listbox)
                  <div class={styles.section} role="group" aria-labelledby={`search-section-${section.id}`} data-section={section.id}>
                    <div class={styles.sectionHead} id={`search-section-${section.id}`}>
                      {t().search.sections[section.id]}
                    </div>
                    <For each={section.options}>
                      {(option, j) => {
                        const i = section.start + j();
                        return (
                          // biome-ignore lint/a11y/useFocusableInteractive: combobox pattern, focus stays in the input (aria-activedescendant)
                          // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keys for every option
                          <div
                            id={optionId(i)}
                            role="option"
                            class={styles.option}
                            aria-selected={active() === i}
                            data-testid="search-option"
                            data-kind={option.kind}
                            onMouseMove={() => active() !== i && setMoved({ query: scope(), index: i })}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => choose(option)}
                          >
                            <Show
                              when={option.kind === "player" && option}
                              fallback={<ChampionLine option={option as Extract<SearchOption, { kind: "champion" }>} />}
                            >
                              {(p) => <PlayerLine option={p()} lookup={lookupFor(p())} />}
                            </Show>
                            <span class={styles.enter} aria-hidden="true">
                              <Icon name="enter" size={14} />
                            </span>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={section.note}>
                      <p class={styles.note}>{section.note === "noChampion" ? t().search.noChampion : t().search.typeRiotId}</p>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <footer class={styles.foot}>
            <Show
              when={!query().trim() && recent().length > 0}
              fallback={
                <span class={styles.keys} aria-hidden="true">
                  <span>
                    <kbd>↑</kbd> <kbd>↓</kbd> {t().search.keys.move}
                  </span>
                  <span>
                    <kbd>{t().search.keys.enter}</kbd> {t().search.keys.open}
                  </span>
                  <span>
                    <kbd>{t().search.keys.esc}</kbd> {t().search.keys.close}
                  </span>
                </span>
              }
            >
              <span class={styles.keys} aria-hidden="true">
                <span>
                  <kbd>{t().search.keys.enter}</kbd> {t().search.keys.open}
                </span>
              </span>
              <button
                type="button"
                class={styles.clear}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  clearRecent();
                  input.focus();
                }}
              >
                {t().search.clearRecent}
              </button>
            </Show>
          </footer>
        </div>
      </Show>
    </div>
  );
}
