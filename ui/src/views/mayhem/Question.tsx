/**
 * The question asked once, on the first start after installing or updating (on Home, never in
 * champion select or a game, and it never blocks the app): share your ARAM: Mayhem games? What
 * goes in plain words (game data only), the features still waiting for games with how far each
 * is, and two equal answers. Yes turns sharing on (the core then reads every past Mayhem game
 * once); either answer can be changed in Settings. Loaded only when asked (app/Banners).
 */
import { createResource, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { MayhemProgress } from "../../data/generated/MayhemProgress";
import type { Settings } from "../../data/generated/Settings";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Glyph } from "../../design/Glyph";
import { Icon } from "../../design/Icon";
import { t } from "../../i18n";
import { notify, reportError } from "../../lib/errors";
import { Widget } from "../../widgets/Widget";
import { Meter } from "./parts";
import styles from "./Question.module.css";

/** The question itself: the features `progress` says still wait (none offline), and the answers. */
export function QuestionCard(props: {
  progress: MayhemProgress | null | undefined;
  /** Every champion of the game: how many each champion's own pick rates wait for. */
  champions: number;
  onAnswer: (share: boolean) => void;
}): JSX.Element {
  const words = () => t().mayhem.question;
  const waiting = () => {
    const p = props.progress;
    const meters: Array<[string, number, number]> = p
      ? [
          [words().pageRates, p.games, p.gamesNeeded],
          [words().championRates, p.championsReady, props.champions],
        ]
      : [];
    return meters.filter(([, have, needed]) => have < needed);
  };
  return (
    <Card>
      <section class={styles.body} aria-labelledby="share-question" data-testid="share-question">
        <div class={styles.column}>
          <h2 class={styles.title} id="share-question">
            <span class={styles.icon}>
              <Glyph name="mayhem" size={20} />
            </span>
            {words().title}
          </h2>
          <ul class={styles.points}>
            <For each={[words().data, words().why]}>
              {(point) => (
                <li>
                  <Icon name="check" size={16} class={styles.check} />
                  {point}
                </li>
              )}
            </For>
          </ul>
        </div>
        <div class={styles.column}>
          <Show when={waiting().length > 0}>
            <div class={styles.meters}>
              <h3 class={styles.waiting}>{words().waiting}</h3>
              <For each={waiting()}>
                {([label, have, needed]) => (
                  <Meter label={label} count={t().mayhem.gathering.count(have, needed)} have={have} needed={needed} />
                )}
              </For>
            </div>
          </Show>
          <div class={styles.answers}>
            <Button onClick={() => props.onAnswer(true)} testId="share-yes">
              {words().yes}
            </Button>
            <Button onClick={() => props.onAnswer(false)} testId="share-no">
              {words().no}
            </Button>
          </div>
          <p class={styles.later}>{words().later}</p>
        </div>
      </section>
    </Card>
  );
}

export default function Question(props: { settings: Settings }): JSX.Element {
  const { transport, gameData } = useData();
  const [overview] = createResource(() => transport.call("mayhem_overview").catch(() => null));
  // Saved, the core's `settings` event makes the shell stop asking (this goes away).
  const answer = (share: boolean) =>
    transport.call("update_settings", { settings: { ...props.settings, shareMayhemGames: share } }).then(
      () => share && notify(t().mayhem.question.thanks),
      (error: unknown) => reportError(t().settings.saveFailed(error instanceof Error ? error.message : String(error)), "settings"),
    );
  return (
    <Widget name="share-question" class={styles.strip}>
      <QuestionCard progress={overview()?.progress} champions={gameData()?.champions.size ?? 0} onAnswer={(share) => void answer(share)} />
    </Widget>
  );
}
