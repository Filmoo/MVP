import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { ChampionPage } from "../../data/generated/ChampionPage";
import type { MatchupEntry } from "../../data/generated/MatchupEntry";
import type { Role } from "../../data/generated/Role";
import type { RoleMatchups } from "../../data/generated/RoleMatchups";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Segmented, type SegmentedOption } from "../../design/Segmented";
import { EmptyState } from "../../design/States";
import { games, percent, signedPoints } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import { bestAndWorst } from "../../lib/stats";
import styles from "./Matchups.module.css";

type Kind = "lane" | "jungle" | "duos";

/** Pairs shown per list. */
const SHOWN = 5;

function Pairs(props: { title: string; entries: readonly MatchupEntry[]; showRole: boolean; testId: string }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? `Champion ${id}`;
  return (
    <div class={styles.list} data-testid={props.testId}>
      <h3 class={styles.listTitle}>{props.title}</h3>
      <Show when={props.entries.length > 0} fallback={<p class={styles.none}>No clear effect yet.</p>}>
        <ol class={styles.rows}>
          <For each={props.entries}>
            {(e) => (
              <li class={styles.row}>
                <a class={styles.link} href={`#/champions?id=${e.id}&role=${e.role}`}>
                  <ChampionIcon championId={e.id} size={32} />
                  <span class={styles.names}>
                    <span class={styles.name}>{name(e.id)}</span>
                    <Show when={props.showRole}>
                      <span class={styles.sub}>{ROLE_LABEL[e.role]}</span>
                    </Show>
                  </span>
                </a>
                <span
                  class={`${styles.delta} ${e.d >= 0 ? styles.up : styles.down} num`}
                  title="Win-rate effect beyond both champions' strength, in points, shrunk when games are few"
                >
                  {signedPoints(e.d)}
                </span>
                <span class={`${styles.stat} num`} title={`${e.w} wins in ${e.g} games`}>
                  <span class={styles.wr}>{percent(e.g > 0 ? e.w / e.g : 0, 1)}</span>
                  <span class={styles.caption}>{games(e.g)} games</span>
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}

/** Lane opponents, the enemy jungler and teammates: best and worst by shrunk effect, each with its games. */
export function MatchupsCard(props: { page: ChampionPage; forRole: Role | undefined }): JSX.Element {
  const data = createMemo<RoleMatchups | undefined>(() => props.page.matchups?.roles.find((r) => r.role === props.forRole));
  const options = createMemo<SegmentedOption<Kind>[]>(() => {
    const d = data();
    if (!d) return [];
    const jungler = d.role === "jungle";
    const all: Array<SegmentedOption<Kind> & { n: number }> = [
      { value: "lane", label: jungler ? "vs Jungler" : "Lane", n: d.lane.length },
      { value: "jungle", label: "vs Jungler", n: d.jungle.length },
      { value: "duos", label: "Duos", n: d.duos.length },
    ];
    return all.filter((o) => o.n > 0).map(({ value, label }) => ({ value, label }));
  });
  const [kind, setKind] = createSignal<Kind>("lane");
  const current = () => options().find((o) => o.value === kind())?.value ?? options()[0]?.value ?? "lane";
  const entries = () => data()?.[current()] ?? [];
  const split = createMemo(() => bestAndWorst(entries(), SHOWN));
  // Bot lane lists both enemies, duos every teammate: say which role each one plays.
  const showRole = () => current() === "duos" || (current() === "lane" && (props.forRole === "bottom" || props.forRole === "support"));
  const duo = () => current() === "duos";
  return (
    <Card title="Matchups" class={styles.card}>
      <Switch>
        <Match when={props.page.info.queue === 450}>
          <p class={styles.aram} data-testid="matchups-aram">
            <Icon name="champions" size={20} class={styles.aramIcon} />
            <span>
              <b class={styles.aramTitle}>No matchups in ARAM.</b> Everyone shares one lane with random teams: there is no lane opponent to
              measure. The builds still apply.
            </span>
          </p>
        </Match>
        <Match when={!data() || options().length === 0}>
          <EmptyState icon="champions" title="Not enough games yet" text="Matchups show once enough games of this role are counted." />
        </Match>
        <Match when={true}>
          <Show when={options().length > 1}>
            <Segmented
              label="Matchups"
              size="sm"
              class={styles.kinds}
              options={options()}
              value={current()}
              onChange={setKind}
              testId="matchup-kind"
            />
          </Show>
          <div class={styles.wrap}>
            <div class={styles.lists}>
              <Pairs title={duo() ? "Best with" : "Best against"} entries={split().best} showRole={showRole()} testId="matchups-best" />
              <Pairs title={duo() ? "Worst with" : "Worst against"} entries={split().worst} showRole={showRole()} testId="matchups-worst" />
            </div>
          </div>
          <p class={styles.note}>
            The colored number is the effect on win rate in points, beyond both champions' strength, shrunk when games are few.
          </p>
        </Match>
      </Switch>
    </Card>
  );
}
