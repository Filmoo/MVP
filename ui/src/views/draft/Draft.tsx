import { createResource, createSignal, type JSX, Match, onCleanup, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { DraftView } from "../../data/generated/DraftView";
import { Card } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Draft.module.css";
import { Suggestions } from "./Suggestions";
import { Teams } from "./Teams";
import { Why } from "./Why";

const PHASE_LABEL: Record<DraftView["phase"], string> = {
  planning: "Planning",
  banning: "Banning",
  picking: "Picking",
  finalizing: "Finalizing",
};

export function DraftContent(props: { draft: DraftView }): JSX.Element {
  const [picked, setPicked] = createSignal<number>();
  const selected = () => picked() ?? props.draft.suggestions[0]?.championId;
  const suggestion = () => props.draft.suggestions.find((s) => s.championId === selected());
  return (
    <div class={styles.grid}>
      <Widget name="draft-teams" class={styles.teams}>
        <Teams draft={props.draft} />
      </Widget>
      <Widget name="draft-suggestions" class={styles.picks}>
        <Suggestions draft={props.draft} selected={selected()} onSelect={setPicked} />
      </Widget>
      <Widget name="draft-why" class={styles.why}>
        <Why suggestion={suggestion()} teamPercent={props.draft.team?.percent} data={props.draft.data} />
      </Widget>
    </div>
  );
}

export default function Draft(): JSX.Element {
  const { transport } = useData();
  const [draft, { mutate, refetch }] = createResource(() => transport.call("draft_state"));
  onCleanup(transport.listen("draft", (next) => mutate(next)));

  return (
    <div class={page.page}>
      <div class={styles.head}>
        <h1 class={page.title}>Draft</h1>
        <Switch>
          <Match when={draft.state === "ready" && draft()}>
            {(d) => (
              <span class={`${styles.phase} num`}>
                {PHASE_LABEL[d().phase]}
                {d().secondsLeft !== null ? ` · 0:${String(d().secondsLeft).padStart(2, "0")}` : ""}
              </span>
            )}
          </Match>
        </Switch>
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
          <Card>
            <Skeleton height="220px" />
          </Card>
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
