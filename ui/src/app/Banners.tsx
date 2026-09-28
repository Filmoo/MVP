import { createSignal, type JSX, lazy, Show, Suspense } from "solid-js";
import { useData } from "../data/context";
import type { Banner } from "../data/generated/Banner";
import type { ClientStatus } from "../data/generated/ClientStatus";
import { IN_GAME_PHASES, useRemoteConfig, useUpdates } from "../data/platform";
import { localized, t } from "../i18n";
import { reportError } from "../lib/errors";
import type { Ready } from "./notices/Notices";

// Loaded only when there is something to show: most sessions never need them.
const NoticesStrip = lazy(() => import("./notices/Notices").then((m) => ({ default: m.NoticesStrip })));
const UpdateBlocker = lazy(() => import("./notices/Notices").then((m) => ({ default: m.UpdateBlocker })));

/** Banners the player closed, by id (the server keeps ids stable). */
const DISMISSED_KEY = "mvp.dismissed-banners.v1";
const DISMISSED_MAX = 50;

function loadDismissed(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string").slice(-DISMISSED_MAX) : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-DISMISSED_MAX)));
  } catch {
    // Private mode or full storage: it comes back next launch, that's all.
  }
}

/** The server only sends banners in their window; a copy kept offline may have ended since. */
function current(banner: Banner, now: number): boolean {
  const starts = banner.startsAt ? Date.parse(banner.startsAt) : Number.NaN;
  const ends = banner.endsAt ? Date.parse(banner.endsAt) : Number.NaN;
  return !(starts > now) && !(ends <= now);
}

/**
 * Notices from our server (remote config banners), the "Update ready — Restart" prompt, and the
 * blocking-but-polite "update required" state. Renders nothing when there's nothing to say.
 */
export default function Banners(props: { status: ClientStatus | undefined }): JSX.Element {
  const { transport } = useData();
  const config = useRemoteConfig();
  const updates = useUpdates();
  const [dismissed, setDismissed] = createSignal(loadDismissed());
  // "Later" on the prompt: until the next launch.
  const [later, setLater] = createSignal(false);
  const inGame = () => IN_GAME_PHASES.has(props.status?.phase ?? "idle");

  const banners = () => {
    const now = Date.now();
    return config().banners.filter((b) => current(b, now) && !(b.dismissible && dismissed().includes(b.id)));
  };
  const ready = (): Ready | undefined => {
    const u = updates.status();
    if (u.state !== "ready" || config().updateRequired || inGame()) return undefined;
    return later() && !u.mandatory ? undefined : u;
  };
  // The server's words, in the player's language.
  const requiredMessage = () => {
    const message = config().minVersion?.message;
    return message ? localized(message) : t().updates.required.unsupported;
  };
  const dismiss = (id: string) => {
    const next = [...dismissed().filter((d) => d !== id), id];
    setDismissed(next);
    saveDismissed(next);
  };
  const open = (id: string) => {
    transport.call("open_banner_link", { id }).catch((error: unknown) => reportError(error, "banner link"));
  };
  const restart = () => {
    updates.restart().catch((error: unknown) => {
      reportError(t().updates.restartFailed(error instanceof Error ? error.message : String(error)), "update");
    });
  };

  return (
    // One boundary each: the strip loading later never hides the card for a frame.
    <>
      <Suspense>
        <Show when={config().updateRequired}>
          <UpdateBlocker
            message={requiredMessage()}
            update={updates.status()}
            inGame={inGame()}
            onRestart={restart}
            onCheck={() => void updates.check()}
          />
        </Show>
      </Suspense>
      <Suspense>
        <Show when={banners().length > 0 || ready()}>
          <NoticesStrip
            banners={banners()}
            ready={ready()}
            onDismiss={dismiss}
            onOpen={open}
            onRestart={restart}
            onLater={() => setLater(true)}
          />
        </Show>
      </Suspense>
    </>
  );
}
