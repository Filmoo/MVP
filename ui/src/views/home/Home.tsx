import { createResource, createSignal, type JSX, Match, onCleanup, Switch } from "solid-js";
import { useData } from "../../data/context";
import { createFollowed } from "../../data/follow";
import type { ChampionMastery } from "../../data/generated/ChampionMastery";
import type { ClientError } from "../../data/generated/ClientError";
import type { ClientStatus } from "../../data/generated/ClientStatus";
import type { LpGame } from "../../data/generated/LpGame";
import { useAmbient } from "../../design/ambient";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import { EmptyState, ErrorState } from "../../design/States";
import { t } from "../../i18n";
import page from "../page.module.css";
import { ProfileContent, ProfileSkeleton, profileArt } from "./Profile";

/** The League client is up but doesn't answer: a wait (the core asks it again by itself), not an error. */
function notAnswering(error: unknown): boolean {
  return (error as { detail?: ClientError } | undefined)?.detail?.kind === "notAnswering";
}

export function Home(): JSX.Element {
  const { transport, gameData } = useData();
  const [profile, { refetch }] = createResource(() => transport.call("current_profile"));
  // The page takes its colors from the art in the hero: the player's most played recent champion.
  useAmbient(() => profileArt(gameData(), profile.state === "ready" ? profile() : undefined));

  // What only your own profile has: the LP MVP kept per ranked game and your mastery. Extras:
  // the page never waits for them, nor fails with them.
  const [lp, setLp] = createSignal<LpGame[]>([]);
  const [mastery, setMastery] = createSignal<ChampionMastery[]>([]);
  const loadLp = () => void transport.call("lp_history").then(setLp, () => undefined);
  const reload = () => {
    void refetch();
    loadLp();
    void transport.call("champion_mastery").then(setMastery, () => undefined);
  };
  loadLp();
  void transport.call("champion_mastery").then(setMastery, () => undefined);

  // The game that just ended (the core's summary), until closed or the next champion select: its
  // window of the stack of opened games opens by itself, once; closed, it's gone for good.
  let summed: string | undefined;
  const [post, { mutate }] = createFollowed(
    () =>
      transport.call("post_game").then(
        (game) => {
          summed ??= game?.matchId;
          return game;
        },
        () => null,
      ),
    (set) => transport.listen("post-game", set),
  );
  const shown = () => (post.state === "ready" ? post() : null);
  onCleanup(
    transport.listen("post-game", (next) => {
      if (!next) return;
      // A new game is in your history now; the same game again brings its LP.
      if (next.matchId === summed) loadLp();
      else reload();
      summed = next.matchId;
    }),
  );
  const dismiss = (matchId: string) => {
    mutate(null);
    void transport.call("dismiss_post_game", { matchId }).catch(() => undefined);
  };
  const lastGame = () => {
    const game = shown();
    return game ? { matchId: game.matchId, lpPending: game.lpPending, seen: () => dismiss(game.matchId) } : undefined;
  };
  // Its LP comes with the summary first: the history's (read again then) catches up.
  const lpAll = () => {
    const counted = shown()?.lp;
    const list = lp();
    return counted && !list.some((g) => g.gameId === counted.gameId) ? [counted, ...list] : list;
  };

  // Reload when the client comes up (or answers again after it stopped: the error goes by
  // itself) and after every game (new match, new LP).
  let last: ClientStatus | undefined;
  onCleanup(
    transport.listen("client-status", (next) => {
      const connected = next.connection === "connected" && last?.connection !== "connected";
      const gameOver = last?.phase === "postGame" && next.phase !== "postGame";
      last = next;
      if (connected || gameOver) reload();
    }),
  );

  return (
    <div class={page.page}>
      <Switch>
        <Match when={profile.state === "errored" && notAnswering(profile.error)}>
          {/* MVP's own words, the title bar's, never the request's text with its address. */}
          <div class={page.centered} role="status">
            <Card>
              <EmptyState
                heading
                icon="plug"
                title={t().shell.connection.notAnswering}
                text={t().home.notAnswering.text}
                action={
                  <Button onClick={() => void refetch()}>
                    <Icon name="refresh" size={16} />
                    {t().home.notAnswering.retry}
                  </Button>
                }
              />
            </Card>
          </div>
        </Match>
        <Match when={profile.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState
                heading
                title={t().home.loadFailed}
                message={String(profile.error?.message ?? profile.error)}
                onRetry={() => void refetch()}
              />
            </Card>
          </div>
        </Match>
        <Match when={profile.state === "pending" || profile.state === "unresolved"}>
          <ProfileSkeleton />
        </Match>
        <Match when={profile() === null}>
          <div class={page.centered}>
            <Card>
              <EmptyState heading icon="plug" title={t().home.waiting.title} text={t().home.waiting.text} />
            </Card>
          </div>
        </Match>
        <Match when={profile()}>
          {(p) => (
            <ProfileContent
              profile={p()}
              lp={lpAll()}
              mastery={mastery()}
              older={(begIndex) => transport.call("older_matches", { begIndex })}
              lastGame={lastGame()}
            />
          )}
        </Match>
      </Switch>
    </div>
  );
}
