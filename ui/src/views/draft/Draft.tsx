import { createResource, createSignal, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { DraftView } from "../../data/generated/DraftView";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { duration } from "../../lib/format";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Draft.module.css";
import { Suggestions } from "./Suggestions";
import { selectedPick } from "./selection";
import { Teams } from "./Teams";
import { Why } from "./Why";

const PHASE_LABEL: Record<DraftView["phase"], string> = {
  planning: "Planning",
  banning: "Banning",
  picking: "Picking",
  finalizing: "Finalizing",
};
/** The timer turns red from here on. */
const URGENT_SECONDS = 10;

export function DraftContent(props: { draft: DraftView }): JSX.Element {
  const [clicked, setClicked] = createSignal<number>();
  // Narrow windows explain a pick under its row; a second tap folds it away again.
  const [expanded, setExpanded] = createSignal<number>();
  const selected = () => selectedPick(props.draft, clicked());
  const suggestion = () => props.draft.suggestions.find((s) => s.championId === selected());
  // The screen takes the colors of the pick being explained.
  const { gameData } = useData();
  useAmbient(() => championArtUrl(gameData(), selected()));
  const select = (championId: number) => {
    setClicked(championId);
    setExpanded((open) => (open === championId ? undefined : championId));
  };
  return (
    <div class={styles.grid}>
      <Widget name="draft-teams" class={styles.teams}>
        <Teams draft={props.draft} />
      </Widget>
      <Widget name="draft-suggestions" class={styles.picks}>
        <Suggestions draft={props.draft} selected={selected()} expanded={expanded()} onSelect={select} />
      </Widget>
      {/* Hidden on narrow windows, where a tapped pick shows its terms in the list. */}
      <Widget name="draft-why" class={styles.why} hideable>
        <Why suggestion={suggestion()} teamPercent={props.draft.team?.percent} />
      </Widget>
    </div>
  );
}

/** Same boxes as the loaded screen, so nothing jumps when the draft arrives. */
function DraftSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.teams}>
        <Card>
          <Skeleton height="132px" />
        </Card>
      </div>
      <div class={styles.picks}>
        <Card title="Picks">
          <Skeleton height="480px" />
        </Card>
      </div>
      <div class={styles.why}>
        <Card title="Why">
          <Skeleton height="360px" />
        </Card>
      </div>
    </div>
  );
}

function PhasePill(props: { draft: DraftView }): JSX.Element {
  const urgent = () => props.draft.secondsLeft !== null && props.draft.secondsLeft <= URGENT_SECONDS;
  return (
    <span class={`${styles.phase} ${urgent() ? styles.urgent : ""} num`}>
      {PHASE_LABEL[props.draft.phase]}
      <Show when={props.draft.secondsLeft !== null}> · {duration(props.draft.secondsLeft ?? 0)}</Show>
    </span>
  );
}

export default function Draft(): JSX.Element {
  const { transport } = useData();
  const [draft, { mutate, refetch }] = createResource(() => transport.call("draft_state"));
  onCleanup(transport.listen("draft", (next) => mutate(next)));

  return (
    <div class={`${page.page} ${page.live}`}>
      <div class={styles.head}>
        <h1 class={page.title}>Draft</h1>
        <Show when={draft.state === "ready" && draft()}>{(d) => <PhasePill draft={d()} />}</Show>
      </div>
      <Switch>
        <Match when={draft.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState
                title="Couldn't read champion select"
                message={String(draft.error?.message ?? draft.error)}
                onRetry={() => void refetch()}
              />
            </Card>
          </div>
        </Match>
        <Match when={draft.state === "pending" || draft.state === "unresolved"}>
          <DraftSkeleton />
        </Match>
        <Match when={draft() === null}>
          <div class={page.centered}>
            <Card>
              <EmptyState
                icon="draft"
                title="Not in champion select"
                text="When your champion select starts, picks for your role show up here and update with every hover, pick and ban."
              />
            </Card>
          </div>
        </Match>
        <Match when={draft()}>{(d) => <DraftContent draft={d()} />}</Match>
      </Switch>
    </div>
  );
}
