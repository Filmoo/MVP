import { createEffect, For, type JSX, on, Show } from "solid-js";
import { api } from "../api";
import { me, proposals, setMe, setSignedOutReason } from "../state/data";
import { go, route, setFilters, VIEWS, type View } from "../state/route";
import { searchFocus, setOverlay } from "../state/ui";
import { Button } from "../ui/Button";
import { Avatar, Kbd } from "../ui/Glyphs";
import { Icon, type IconName, Mark } from "../ui/Icon";
import { Dropdown, layers } from "../ui/Layers";
import styles from "./TopBar.module.css";

const VIEW_META: Record<View, { label: string; icon: IconName; key: string }> = {
  board: { label: "Board", icon: "board", key: "1" },
  roadmap: { label: "Roadmap", icon: "roadmap", key: "2" },
  list: { label: "List", icon: "list", key: "3" },
};

export async function signOut(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // Signed out either way: the cookie goes with the page.
  }
  setSignedOutReason(null);
  setMe(null);
}

export function ViewSwitch(): JSX.Element {
  const index = () => VIEWS.indexOf(route().view);
  return (
    <div class={styles.views} role="radiogroup" aria-label="View" style={{ "--index": index() }}>
      <span class={`${styles.thumb} glass-drop`} />
      <For each={VIEWS}>
        {(view) => (
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons, like the app's Segmented control
          <button
            type="button"
            role="radio"
            class={styles.view}
            aria-checked={route().view === view}
            title={`${VIEW_META[view].label} (${VIEW_META[view].key})`}
            onClick={() => go({ view })}
          >
            <Icon name={VIEW_META[view].icon} />
            <span class={styles.label}>{VIEW_META[view].label}</span>
          </button>
        )}
      </For>
    </div>
  );
}

export function SearchField(props: { class?: string | undefined }): JSX.Element {
  let input: HTMLInputElement | undefined;
  createEffect(
    on(searchFocus, (asked) => {
      if (asked > 0 && input && input.offsetParent !== null) {
        input.focus();
        input.select();
      }
    }),
  );
  return (
    <label class={`${styles.search} ${props.class ?? ""}`}>
      <span class="visually-hidden">Search features</span>
      <Icon name="search" class={styles.searchIcon} />
      <input
        ref={input}
        class={styles.searchInput}
        type="search"
        placeholder="Search features"
        value={route().filters.query}
        onInput={(event) => setFilters({ query: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (event.currentTarget.value) setFilters({ query: "" });
            else event.currentTarget.blur();
          }
          if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            event.currentTarget.blur();
            document.querySelector<HTMLElement>("[data-feature][tabindex='0']")?.focus();
          }
        }}
      />
      <span class={styles.searchHint}>
        <Kbd>/</Kbd>
        <Kbd>Ctrl K</Kbd>
      </span>
    </label>
  );
}

export function TopBar(): JSX.Element {
  const waiting = () => proposals().length;
  return (
    <header class={styles.bar} data-testid="topbar">
      <a class={styles.brand} href="#/board" aria-label="MVP Roadmap, board">
        <Mark size={28} />
        <span class={styles.brandText}>
          <span class={styles.brandName}>Roadmap</span>
          <span class={styles.brandHost}>{window.location.host}</span>
        </span>
      </a>
      <ViewSwitch />
      <SearchField />
      <div class={styles.actions}>
        <Button
          variant={route().panel === "inbox" ? "secondary" : "ghost"}
          class={styles.inbox}
          title="Claude's proposals (I)"
          aria-label={`Proposals, ${waiting()} waiting`}
          onClick={() => go({ panel: route().panel === "inbox" ? null : "inbox" })}
        >
          <Icon name="inbox" />
          <span class={styles.label}>Proposals</span>
          <Show when={waiting() > 0}>
            <span class={`${styles.badge} num`}>{waiting()}</span>
          </Show>
        </Button>
        <Button
          variant="primary"
          icon="plus"
          title="New feature (N)"
          onClick={() => setOverlay({ kind: "create", versionId: null, status: null })}
        >
          <span class={styles.newLabel}>New</span>
        </Button>
        <Dropdown
          label="Account"
          align="end"
          trigger={(open, toggle) => (
            <button type="button" class={styles.me} aria-expanded={open()} aria-label="Account" onClick={toggle}>
              <Avatar name={me()?.name ?? "?"} url={me()?.avatarUrl || undefined} size={30} />
            </button>
          )}
        >
          {(close) => (
            <>
              <div class={styles.who}>
                <strong>{me()?.name}</strong>@{me()?.login}
                {me()?.dev ? " · dev login" : ""}
              </div>
              <div class={layers.separator} />
              <button
                type="button"
                role="menuitem"
                class={layers.option}
                onClick={() => {
                  close();
                  go({ panel: "activity" });
                }}
              >
                <Icon name="activity" /> Activity log
              </button>
              <button
                type="button"
                role="menuitem"
                class={layers.option}
                onClick={() => {
                  close();
                  setOverlay({ kind: "keys" });
                }}
              >
                <Icon name="keyboard" /> Keyboard shortcuts <span class={layers.optionCount}>?</span>
              </button>
              <div class={layers.separator} />
              <button type="button" role="menuitem" class={layers.option} onClick={() => void signOut()}>
                <Icon name="logout" /> Sign out
              </button>
            </>
          )}
        </Dropdown>
      </div>
    </header>
  );
}
