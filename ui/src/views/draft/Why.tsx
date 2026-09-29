import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { Compositions } from "../../data/generated/Compositions";
import type { DataInfo } from "../../data/generated/DataInfo";
import type { Reason } from "../../data/generated/Reason";
import type { Suggestion } from "../../data/generated/Suggestion";
import { Card } from "../../design/Card";
import { ChampionArt } from "../../design/GameIcon";
import { Segmented } from "../../design/Segmented";
import { t } from "../../i18n";
import { decimal, percent, percentOf100, signedPoints } from "../../lib/format";
import { Widget } from "../../widgets/Widget";
import { ChampionAugments } from "../mayhem/parts";
import { CompChange, Comps } from "./Comps";
import styles from "./Why.module.css";

/** What the panel explains: the selected pick, both teams' compositions, or (Mayhem) its augments. */
export type WhyTab = "pick" | "teams" | "augments";

/** Bars span ±5 pp. */
const SCALE = 5;
/** Below this share kept, the value is mostly the prior: flagged as weak evidence. */
export const WEAK = 0.3;

/** Largest effect first, the order the list's reason chips use. */
export function bySize(reasons: readonly Reason[]): Reason[] {
  return [...reasons].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

interface Segment {
  text: string;
  class?: string | undefined;
  title?: string;
}

/** `a · b · c` that only wraps between segments, never inside one. */
export function Segments(props: { items: Segment[]; class?: string | undefined }): JSX.Element {
  return (
    <span class={`${props.class ?? ""} num`}>
      <For each={props.items}>
        {(seg, i) => (
          <>
            <span class={`${styles.seg} ${seg.class ?? ""}`} title={seg.title}>
              {seg.text}
              {i() < props.items.length - 1 ? " ·" : ""}
            </span>{" "}
          </>
        )}
      </For>
    </span>
  );
}

function Bar(props: { points: number }): JSX.Element {
  const width = () => `${(Math.min(Math.abs(props.points), SCALE) / SCALE) * 50}%`;
  return (
    <div class={styles.bar} aria-hidden="true" data-free-style>
      <div
        class={`${styles.fill} ${props.points >= 0 ? styles.fillUp : styles.fillDown}`}
        style={props.points >= 0 ? { left: "50%", width: width() } : { right: "50%", width: width() }}
      />
    </div>
  );
}

function evidence(r: Reason): Segment[] {
  const words = t().why;
  const segments: Segment[] = [{ text: t().common.games(r.games) }];
  if (r.kind !== "base") {
    const kept = percent(r.kept);
    const title = words.keptTitle(kept);
    segments.push(r.kept < WEAK ? { text: words.weak(kept), class: styles.weak, title } : { text: words.kept(kept), title });
  }
  if (r.probability < 0.995) {
    const odds = percent(r.probability);
    segments.push({ text: words.roleOdds(odds), title: words.roleOddsTitle(odds) });
  }
  return segments;
}

/** The terms that add up to a pick's estimate, largest first. */
export function WhyTerms(props: { suggestion: Suggestion; class?: string | undefined }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const label = (r: Reason) => {
    if (r.kind === "base") return name(props.suggestion.championId);
    if (r.championId === null) return t().why.kinds[r.kind];
    return r.kind === "duo" ? t().draft.with(name(r.championId)) : t().draft.vs(name(r.championId));
  };
  return (
    <ul class={`${styles.rows} ${props.class ?? ""}`}>
      <For each={bySize(props.suggestion.reasons)}>
        {(r) => (
          <li class={styles.row}>
            <span class={styles.label}>
              <span class={styles.kind}>{t().why.kinds[r.kind]} · </span>
              {label(r)}
            </span>
            <span class={`${styles.value} num ${r.points >= 0 ? styles.up : styles.down}`}>{signedPoints(r.points)}</span>
            <Bar points={r.points} />
            <Segments class={styles.meta} items={evidence(r)} />
          </li>
        )}
      </For>
    </ul>
  );
}

export function Why(props: {
  suggestion: Suggestion | undefined;
  teamPercent: number | undefined;
  /** Both teams' compositions: the "Teams" tab, and your team with the pick. */
  comps?: Compositions | null | undefined;
  data?: DataInfo | null | undefined;
  aram?: boolean;
  /** The champion you hover or have: your team's composition already holds it. */
  mine?: number | null | undefined;
  /** ARAM: Mayhem: the champion whose augments the third tab shows (`undefined`: not Mayhem). */
  augments?: number | null | undefined;
  tab?: WhyTab;
  onTab?: (tab: WhyTab) => void;
}): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const teams = () => props.tab === "teams";
  const augments = () => props.tab === "augments";
  const pick = () => !teams() && !augments();
  const tabs = () => [
    { value: "pick" as const, label: t().why.tabs.pick },
    { value: "teams" as const, label: t().why.tabs.teams },
    ...(props.augments === undefined ? [] : [{ value: "augments" as const, label: t().mayhem.augments }]),
  ];
  const title = () => {
    if (teams()) return t().why.teamsTitle;
    // The tab says "Augments": the title names whose (narrow panel, long tab row).
    if (augments()) return props.augments ? name(props.augments) : t().mayhem.augments;
    return t().why.title(props.suggestion ? name(props.suggestion.championId) : undefined);
  };
  return (
    <Card
      title={title()}
      actions={
        <Show when={props.onTab}>
          {(onTab) => (
            <Segmented
              size="sm"
              class={styles.tabs}
              label={t().why.tabsLabel}
              options={tabs()}
              value={props.tab ?? "pick"}
              onChange={onTab()}
              testId="why-tabs"
            />
          )}
        </Show>
      }
      class={styles.card}
      scroll
      backdrop={<Show when={pick() && props.suggestion}>{(s) => <ChampionArt championId={s().championId} class={styles.art} light />}</Show>}
    >
      <Show when={teams()}>
        <Widget name="draft-comps">
          <Comps comps={props.comps ?? null} data={props.data ?? null} aram={props.aram ?? false} />
        </Widget>
      </Show>
      <Show when={augments()}>
        <Show when={props.augments} fallback={<p class={styles.meta}>{t().why.empty}</p>}>
          {(id) => (
            <Widget name="mayhem-champion">
              <ChampionAugments championId={id()} name={name(id())} />
            </Widget>
          )}
        </Show>
      </Show>
      <Show
        when={pick() && props.suggestion}
        fallback={
          <Show when={pick()}>
            <p class={styles.meta}>{t().why.empty}</p>
          </Show>
        }
      >
        {(s) => (
          <>
            <div class={`${styles.summary} num`}>
              <span class={styles.big}>{percentOf100(s().estimate.percent)}</span>
              <span class={styles.pm}>± {decimal(s().estimate.plusMinus, 1)}</span>
              <Show when={props.teamPercent}>
                {(team) => (
                  <span class={styles.delta}>
                    <b class={s().gain >= 0 ? styles.up : styles.down}>{signedPoints(s().gain)}</b>{" "}
                    {t().why.vsTeamNow(percentOf100(team()))}
                  </span>
                )}
              </Show>
            </div>
            <WhyTerms suggestion={s()} />
            <Show when={s().comp}>
              {(next) => (
                <CompChange
                  champion={name(s().championId)}
                  now={s().championId === props.mine ? undefined : props.comps?.allies}
                  next={next()}
                />
              )}
            </Show>
            <Show when={s().mine}>
              {(m) => (
                <Segments
                  class={styles.footer}
                  items={[
                    { text: t().why.yourGames(m().games) },
                    { text: t().common.wr(percent(m().wins / m().games)) },
                    { text: t().why.notInEstimate, title: t().why.notInEstimateTitle },
                  ]}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </Card>
  );
}
