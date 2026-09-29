import { createResource, type JSX, Match, onCleanup, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { ClientError } from "../../data/generated/ClientError";
import type { ClientStatus } from "../../data/generated/ClientStatus";
import { useAmbient } from "../../design/ambient";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import { PenguinArt } from "../../design/PenguinArt";
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

  // Reload when the client comes up (or answers again after it stopped: the error goes by
  // itself) and after every game (new match, new LP).
  let last: ClientStatus | undefined;
  onCleanup(
    transport.listen("client-status", (next) => {
      const connected = next.connection === "connected" && last?.connection !== "connected";
      const gameOver = last?.phase === "postGame" && next.phase !== "postGame";
      last = next;
      if (connected || gameOver) void refetch();
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
              <EmptyState
                heading
                icon="plug"
                art={<PenguinArt size={88} gaze="away" />}
                title={t().home.waiting.title}
                text={t().home.waiting.text}
              />
            </Card>
          </div>
        </Match>
        <Match when={profile()}>{(p) => <ProfileContent profile={p()} />}</Match>
      </Switch>
    </div>
  );
}
