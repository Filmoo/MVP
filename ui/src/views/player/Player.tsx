import { createMemo, createResource, type JSX, Match, Switch } from "solid-js";
import { path } from "../../app/router";
import { focusSearch } from "../../app/search/Search";
import { useData } from "../../data/context";
import { useAmbient } from "../../design/ambient";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import { EmptyState, ErrorState } from "../../design/States";
import { t } from "../../i18n";
import { backendError, lookupErrorWords, lookupPlayer } from "../../lib/players";
import { parsePlayerPath } from "../../lib/riot-id";
import { ProfileContent, ProfileSkeleton, profileArt } from "../home/Profile";
import page from "../page.module.css";

/** Another player's page (`/player/{platform}/{gameName}/{tagLine}`), from our backend. */
export default function Player(): JSX.Element {
  const { transport, gameData } = useData();
  const target = createMemo(() => parsePlayerPath(path()), undefined, {
    equals: (a, b) => a?.platform === b?.platform && a?.riotId.gameName === b?.riotId.gameName && a?.riotId.tagLine === b?.riotId.tagLine,
  });
  const [profile, { refetch }] = createResource(target, (t) => lookupPlayer(transport, t.platform, t.riotId));
  useAmbient(() => profileArt(gameData(), profile.state === "ready" ? profile() : undefined));

  const words = () => {
    const t = target();
    return t && profile.state === "errored" ? lookupErrorWords(backendError(profile.error), t.riotId, t.platform) : undefined;
  };
  const searchAgain = (
    <Button onClick={focusSearch}>
      <Icon name="search" size={16} />
      {t().search.again}
    </Button>
  );

  return (
    <div class={page.page}>
      <Switch>
        <Match when={!target()}>
          <div class={page.centered}>
            <Card>
              <EmptyState heading icon="user" title={t().players.badLink.title} text={t().players.badLink.text} action={searchAgain} />
            </Card>
          </div>
        </Match>
        <Match when={words()}>
          {(w) => (
            <div class={page.centered}>
              <Card>
                {w().retry ? (
                  <ErrorState heading title={w().title} message={w().text} onRetry={() => void refetch()} />
                ) : (
                  <EmptyState heading icon="user" title={w().title} text={w().text} action={searchAgain} />
                )}
              </Card>
            </div>
          )}
        </Match>
        <Match when={profile.state === "ready" && profile()}>{(p) => <ProfileContent profile={p()} />}</Match>
        <Match when={true}>
          <ProfileSkeleton />
        </Match>
      </Switch>
    </div>
  );
}

// An opened game's code rides in this chunk: Home's match history loads it from here too (App.tsx).
export { GameSheet, hint } from "../home/GameSheet";
