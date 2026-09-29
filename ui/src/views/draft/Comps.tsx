import { For, type JSX, Show } from "solid-js";
import type { CompMember } from "../../data/generated/CompMember";
import type { Compositions } from "../../data/generated/Compositions";
import type { DamageMix } from "../../data/generated/DamageMix";
import type { DataInfo } from "../../data/generated/DataInfo";
import type { TeamComp } from "../../data/generated/TeamComp";
import { ChampionIcon } from "../../design/GameIcon";
import { EmptyState } from "../../design/States";
import { t } from "../../i18n";
import { decimal, integer, percent, signedPoints } from "../../lib/format";
import { bracketName } from "../../lib/stats";
import styles from "./Comps.module.css";

/** Long games against short ones: the last length bucket's change minus the first's. */
const lean = (comp: TeamComp): number => (comp.lengths.at(-1) ?? 0) - (comp.lengths[0] ?? 0);

/** A damage mix as a bar: physical, magic, true (the numbers are in the rows). */
export function DamageBar(props: { damage: DamageMix }): JSX.Element {
  const width = (share: number) => ({ width: `${share * 100}%` });
  return (
    <div class={styles.bar} aria-hidden="true" data-free-style>
      <span class={styles.physical} style={width(props.damage.physical)} />
      <span class={styles.magic} style={width(props.damage.magic)} />
      <span class={styles.trueDamage} style={width(props.damage.trueDamage)} />
    </div>
  );
}

/** The game-length buckets' names: `under 25 min`, `25–35 min`, `35 min and more`. */
function buckets(bounds: readonly number[]): string[] {
  const words = t().comps;
  return [...bounds.map((b, i) => (i === 0 ? words.under(b) : words.between(bounds[i - 1] ?? 0, b))), words.over(bounds.at(-1) ?? 0)];
}

interface Row {
  label: string;
  value: (comp: TeamComp) => string;
  title?: (comp: TeamComp) => string;
}

function rows(bounds: readonly number[]): Row[] {
  const words = t().comps;
  const names = buckets(bounds);
  return [
    { label: words.rows.physical, value: (c) => percent(c.damage.physical) },
    { label: words.rows.magic, value: (c) => percent(c.damage.magic) },
    { label: words.rows.trueDamage, value: (c) => percent(c.damage.trueDamage) },
    {
      label: words.rows.frontline,
      value: (c) => words.times(decimal(c.frontline, 2)),
      title: (c) => words.frontlineTitle(words.times(decimal(c.frontline, 2))),
    },
    { label: words.rows.cc, value: (c) => words.seconds(integer(c.cc)), title: (c) => words.ccTitle(integer(c.ccUsual)) },
    {
      label: words.rows.late,
      value: (c) => signedPoints(lean(c)),
      title: (c) => words.lateTitle(c.lengths.map((points, i) => words.bucket(names[i] ?? "", signedPoints(points))).join(" · ")),
    },
    { label: words.rows.games, value: (c) => words.atLeast(integer(c.games)) },
  ];
}

/** The champions counted, hovers as such. */
function Members(props: { members: CompMember[] }): JSX.Element {
  return (
    <ul class={styles.members}>
      <For each={props.members}>
        {(m) => (
          <li class={m.hovering ? styles.hovering : undefined}>
            <ChampionIcon championId={m.championId} size={20} />
          </li>
        )}
      </For>
    </ul>
  );
}

export interface CompColumn {
  title: string;
  comp: TeamComp;
  tone?: "ally" | "enemy";
}

/** Compositions side by side, one column each, every number with its title. */
export function CompTable(props: { columns: CompColumn[]; lengths: number[]; members?: boolean }): JSX.Element {
  const words = () => t().comps;
  const counted = (c: TeamComp) => c.counted > 0;
  return (
    <table class={`${styles.table} num`}>
      <thead>
        <tr>
          <td />
          <For each={props.columns}>
            {(col) => (
              <th scope="col" class={col.tone ? styles[col.tone] : undefined}>
                {col.title}
                {/* Its readings, worded, right under the team's name. */}
                <Show when={col.comp.readings.length > 0}>
                  <ul class={styles.readings}>
                    <For each={col.comp.readings}>{(r) => <li>{t().comps.readings[r]}</li>}</For>
                  </ul>
                </Show>
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>
        <Show when={props.members}>
          <tr>
            <th scope="row">{words().rows.champions}</th>
            <For each={props.columns}>
              {(col) => (
                <td>
                  <Show when={col.comp.members.length > 0} fallback={<span class={styles.muted}>{words().waiting}</span>}>
                    <Members members={col.comp.members} />
                  </Show>
                </td>
              )}
            </For>
          </tr>
        </Show>
        <tr>
          <th scope="row">{words().rows.damage}</th>
          <For each={props.columns}>{(col) => <td>{counted(col.comp) ? <DamageBar damage={col.comp.damage} /> : words().none}</td>}</For>
        </tr>
        <For each={rows(props.lengths)}>
          {(row) => (
            <tr>
              <th scope="row">{row.label}</th>
              <For each={props.columns}>
                {(col) => (
                  <td
                    data-hint-title={row.label}
                    data-hint={counted(col.comp) ? row.title?.(col.comp) : undefined}
                    tabIndex={counted(col.comp) && row.title ? 0 : undefined}
                  >
                    {counted(col.comp) ? row.value(col.comp) : words().none}
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

/** Both teams' compositions (ARAM: yours, the enemy team is hidden until the game loads). */
export function Comps(props: { comps: Compositions | null; data: DataInfo | null; aram: boolean }): JSX.Element {
  const words = () => t().comps;
  return (
    <div class={styles.comps}>
      <Show
        when={props.comps}
        fallback={
          <EmptyState
            icon="draft"
            title={props.data ? words().noComps.title : words().noStats.title}
            text={props.data ? words().noComps.text : words().noStats.text}
          />
        }
      >
        {(comps) => {
          const columns = (): CompColumn[] => [
            { title: t().draft.yourTeam, comp: comps().allies, tone: "ally" },
            ...(props.aram ? [] : [{ title: t().draft.enemyTeam, comp: comps().enemies, tone: "enemy" as const }]),
          ];
          return (
            <>
              <CompTable columns={columns()} lengths={comps().lengths} members />
              <Show when={props.data}>
                {(d) => <p class={styles.note}>{(props.aram ? words().noteAram : words().note)(bracketName(d().bracket), d().patch)}</p>}
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}

/**
 * How a pick changes your team: its composition now → with the pick (the dominant damage type,
 * frontline, crowd control); `now` left out for the champion you already have.
 */
export function CompChange(props: { champion: string; now: TeamComp | undefined; next: TeamComp }): JSX.Element {
  const lines = () => {
    const w = t().comps;
    const next = props.next;
    const now = props.now && props.now.counted > 0 ? props.now : undefined;
    const magic = next.damage.magic >= next.damage.physical;
    const type = (c: TeamComp) => percent(magic ? c.damage.magic : c.damage.physical);
    const frontline = (c: TeamComp) => w.times(decimal(c.frontline, 2));
    const cc = (c: TeamComp) => w.seconds(integer(c.cc));
    const change = (label: string, value: (c: TeamComp) => string) =>
      now ? w.change(label, value(now), value(next)) : w.value(label, value(next));
    return [change(magic ? w.magicDamage : w.physicalDamage, type), change(w.rows.frontline, frontline), change(w.rows.cc, cc)];
  };
  return (
    <section class={styles.change}>
      <h3 class={styles.changeTitle}>{t().why.withPick(props.champion)}</h3>
      <DamageBar damage={props.next.damage} />
      <p class={`${styles.changeLines} num`}>
        <For each={lines()}>
          {(line, i) => (
            <>
              <span class={styles.seg}>
                {line}
                {i() < lines().length - 1 ? " ·" : ""}
              </span>{" "}
            </>
          )}
        </For>
      </p>
    </section>
  );
}
