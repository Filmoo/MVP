import { createResource, createSignal, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { DraftView } from "../../data/generated/DraftView";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Draft.module.css";
import { ImportBar, useImportModes } from "./ImportBar";
import { PhasePill } from "./PhasePill";
import { Suggestions } from "./Suggestions";
import { selectedPick } from "./selection";
import { Teams } from "./Teams";
import { Why } from "./Why";

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
  // Imports of your hovered or locked champion's build, unless every part is turned off.
  const modes = useImportModes();
  const imports = () => Object.values(modes()).some((mode) => mode !== "off");
  const me = () => props.draft.allies.find((slot) => slot.isMe);
  return (
    <div class={`${styles.grid} ${imports() ? "" : styles.noImports}`}>
      <Widget name="draft-teams" class={styles.teams}>
        <Teams draft={props.draft} />
      </Widget>
      <Show when={imports()}>
        <Widget name="draft-imports" class={styles.imports}>
          <ImportBar
            championId={me()?.championId ?? null}
            role={props.draft.myRole}
            hovering={me()?.hovering ?? false}
            available={props.draft.data !== null}
            inChampSelect
            modes={modes()}
          />
        </Widget>
      </Show>
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
      <div class={styles.imports}>
        <Card>
          <Skeleton height="20px" />
        </Card>
      </div>
      <div class={styles.picks}>
        <Card title={t().draft.picks}>
          <Skeleton height="480px" />
        </Card>
      </div>
      <div class={styles.why}>
        <Card title={t().why.title(undefined)}>
          <Skeleton height="360px" />
        </Card>
      </div>
    </div>
  );
}

export default function Draft(): JSX.Element {
  const { transport } = useData();
  const [draft, { mutate, refetch }] = createResource(() => transport.call("draft_state"));
  onCleanup(transport.listen("draft", (next) => mutate(next)));

  return (
    <div class={`${page.page} ${page.live}`}>
      {/* The teams card carries the clock once it has the odds column (stats): the head can fold. */}
      <div class={styles.head} data-folds={draft.state === "ready" && draft()?.team ? "" : undefined}>
        <h1 class={page.title}>{t().nav.draft.label}</h1>
        <Show when={draft.state === "ready" && draft()}>{(d) => <PhasePill draft={d()} />}</Show>
      </div>
      <Switch>
        <Match when={draft.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState
                title={t().draft.readFailed}
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
              <EmptyState icon="draft" title={t().draft.idle.title} text={t().draft.idle.text} />
            </Card>
          </div>
        </Match>
        <Match when={draft()}>{(d) => <DraftContent draft={d()} />}</Match>
      </Switch>
    </div>
  );
}
