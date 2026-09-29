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
import { t } from "../../i18n";
import { percent, signedPoints } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import { bestAndWorst } from "../../lib/stats";
import styles from "./Matchups.module.css";

type Kind = "lane" | "jungle" | "duos";

/** Pairs shown per list. */
const SHOWN = 5;

function Pairs(props: { title: string; entries: readonly MatchupEntry[]; showRole: boolean; testId: string }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  return (
    <div class={styles.list} data-testid={props.testId}>
      <h3 class={styles.listTitle}>{props.title}</h3>
      <Show when={props.entries.length > 0} fallback={<p class={styles.none}>{t().champions.noEffect}</p>}>
        <ol class={styles.rows}>
          <For each={props.entries}>
            {(e) => (
              // What its numbers mean, on hover of the row or focus of its link (design/tip).
              <li
                class={styles.row}
                data-hint-title={name(e.id)}
                data-hint={`${t().stats.winsInGames(e.w, e.g)}\n${t().champions.effectOf(signedPoints(e.d))}`}
              >
                <a class={styles.link} href={`#/champions?id=${e.id}&role=${e.role}`}>
                  <ChampionIcon championId={e.id} size={32} />
                  <span class={styles.names}>
                    <span class={styles.name}>{name(e.id)}</span>
                    <Show when={props.showRole}>
                      <span class={styles.sub}>{roleLabel(e.role)}</span>
                    </Show>
                  </span>
                </a>
                <span class={`${styles.delta} ${e.d >= 0 ? styles.up : styles.down} num`}>{signedPoints(e.d)}</span>
                <span class={`${styles.stat} num`}>
                  <span class={styles.wr}>{percent(e.g > 0 ? e.w / e.g : 0, 1)}</span>
                  <span class={styles.caption}>{t().common.games(e.g)}</span>
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
      { value: "lane", label: jungler ? t().champions.vsJungler : t().champions.lane, n: d.lane.length },
      { value: "jungle", label: t().champions.vsJungler, n: d.jungle.length },
      { value: "duos", label: t().champions.duos, n: d.duos.length },
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
    <Card title={t().champions.matchups} class={styles.card}>
      <Switch>
        <Match when={props.page.info.queue === 450}>
          <p class={styles.aram} data-testid="matchups-aram">
            <Icon name="champions" size={20} class={styles.aramIcon} />
            <span>
              <b class={styles.aramTitle}>{t().champions.aram.title}</b> {t().champions.aram.text}
            </span>
          </p>
        </Match>
        <Match when={!data() || options().length === 0}>
          <EmptyState icon="champions" title={t().champions.noMatchups.title} text={t().champions.noMatchups.text} />
        </Match>
        <Match when={true}>
          <Show when={options().length > 1}>
            <Segmented
              label={t().champions.matchups}
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
              <Pairs
                title={duo() ? t().champions.bestWith : t().champions.bestAgainst}
                entries={split().best}
                showRole={showRole()}
                testId="matchups-best"
              />
              <Pairs
                title={duo() ? t().champions.worstWith : t().champions.worstAgainst}
                entries={split().worst}
                showRole={showRole()}
                testId="matchups-worst"
              />
            </div>
          </div>
          <p class={styles.note}>{t().champions.effectNote}</p>
        </Match>
      </Switch>
    </Card>
  );
}
