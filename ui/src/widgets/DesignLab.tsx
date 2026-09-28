import { For, type JSX } from "solid-js";
import type { TierGrade } from "../data/generated/TierGrade";
import { Glyph, type GlyphName, glyphPath } from "../design/Glyph";
import { Icon, iconPath, LineIcon } from "../design/Icon";
import { Mark } from "../design/Logo";
import { Penguin } from "../design/Penguin";
import { TierMark } from "../design/TierMark";
import styles from "./DesignLab.module.css";

/*
 * Design pre-shoot (dev server only: `#/__harness?show=design`): the new small icons, the tier
 * medallions and the penguin at every size, each next to what it stands beside in the app. Labels
 * here are the code's own names (a lab, like the emblem lab), not product words.
 */

const NEW_ICONS: GlyphName[] = [
  "roleAll",
  "winRate",
  "pick",
  "ban",
  "games",
  "patch",
  "ranked",
  "aram",
  "gem",
  "trendUp",
  "trendDown",
  "crown",
  "tierList",
  "penguin",
];
const ROLE_ICONS: string[] = [
  glyphPath("roleAll"),
  ...(["roleTop", "roleJungle", "roleMiddle", "roleBottom", "roleSupport"] as const).map(iconPath),
];
const TIERS: TierGrade[] = ["S", "A", "B", "C", "D"];

function IconCell(props: { name: GlyphName }): JSX.Element {
  return (
    <div class={styles.iconCell}>
      <div class={styles.iconSizes}>
        <Glyph name={props.name} size={24} />
        <Glyph name={props.name} size={20} />
        <Glyph name={props.name} size={16} />
        <Glyph name={props.name} size={14} />
      </div>
      <span class={styles.caption}>{props.name}</span>
    </div>
  );
}

export default function DesignLab(): JSX.Element {
  return (
    <div class={styles.lab} data-testid="design-lab">
      <section class={styles.panel}>
        <h2 class={styles.title}>icons · 24 / 20 / 16 / 14 px</h2>
        <div class={styles.iconGrid}>
          <For each={NEW_ICONS}>{(name) => <IconCell name={name} />}</For>
        </div>
        <h2 class={styles.title}>in context</h2>
        <div class={styles.context}>
          <span class={styles.stat}>
            <Glyph name="winRate" size={14} />
            <b class={styles.win}>52.6%</b>
          </span>
          <span class={styles.stat}>
            <Glyph name="pick" size={14} />
            <b>7.9%</b>
          </span>
          <span class={styles.stat}>
            <Glyph name="ban" size={14} />
            <b class={styles.loss}>12.3%</b>
          </span>
          <span class={styles.stat}>
            <Glyph name="games" size={14} />
            33K
          </span>
          <span class={styles.stat}>
            <Glyph name="patch" size={14} />
            26.19
          </span>
          <span class={styles.stat}>
            <Glyph name="ranked" size={16} />
            Ranked Solo
          </span>
          <span class={styles.stat}>
            <Glyph name="aram" size={16} />
            ARAM
          </span>
          <span class={styles.stat} style={{ "--gem": "var(--rank-emerald)" }}>
            <span class={styles.gem}>
              <Glyph name="gem" size={16} />
            </span>
            Emerald+
          </span>
          <span class={styles.stat} style={{ "--gem": "var(--rank-diamond)" }}>
            <span class={styles.gem}>
              <Glyph name="gem" size={16} />
            </span>
            Diamond+
          </span>
          <span class={styles.stat}>
            <span class={styles.win}>
              <Glyph name="trendUp" size={16} />
            </span>
            +1.2
          </span>
          <span class={styles.stat}>
            <span class={styles.loss}>
              <Glyph name="trendDown" size={16} />
            </span>
            −0.8
          </span>
          <span class={styles.stat}>
            <span class={styles.gold}>
              <Glyph name="crown" size={16} />
            </span>
            1
          </span>
        </div>
        <h2 class={styles.title}>roles · rest / chosen (role colour)</h2>
        <div class={styles.roles}>
          <For each={ROLE_ICONS}>
            {(name, i) => (
              <div
                class={styles.role}
                style={{
                  "--tone": [
                    "var(--accent)",
                    "var(--role-top)",
                    "var(--role-jungle)",
                    "var(--role-middle)",
                    "var(--role-bottom)",
                    "var(--role-support)",
                  ][i()],
                }}
              >
                <LineIcon d={name} size={20} />
                <span class={styles.roleOn}>
                  <LineIcon d={name} size={20} />
                </span>
              </div>
            )}
          </For>
          <div class={styles.navCompare}>
            <span class={styles.caption}>nav: tiers → tierList</span>
            <Icon name="tiers" size={20} />
            <Glyph name="tierList" size={20} />
          </div>
        </div>
      </section>

      <section class={styles.panel}>
        <h2 class={styles.title}>tier medallions · 64 / 44 / 32 / 24 / 20 / 16 px</h2>
        <div class={styles.tiers}>
          <For each={TIERS}>
            {(grade) => (
              <div class={styles.tierRow}>
                <TierMark grade={grade} size={64} />
                <TierMark grade={grade} size={44} />
                <TierMark grade={grade} size={32} />
                <TierMark grade={grade} size={24} />
                <TierMark grade={grade} size={20} />
                <TierMark grade={grade} size={16} />
              </div>
            )}
          </For>
        </div>
      </section>

      <section class={styles.panel}>
        <h2 class={styles.title}>penguin · 96 / 64 / 48 / 32 / 24 / 20 / 16 px, with the logo</h2>
        <div class={styles.penguins}>
          <div class={styles.logo}>
            <Mark size={96} />
          </div>
          <Penguin size={96} crown />
          <Penguin size={96} />
          <Penguin size={96} gaze="away" />
          <Penguin size={64} />
          <Penguin size={48} crown />
          <Penguin size={32} />
          <Penguin size={24} />
          <Penguin size={20} crown />
          <Penguin size={16} />
        </div>
        <h2 class={styles.title}>on the surfaces it will sit on</h2>
        <div class={styles.surfaces}>
          <div class={styles.onPage}>
            <Penguin size={64} gaze="away" />
          </div>
          <div class={styles.onCard}>
            <Penguin size={64} />
          </div>
          <div class={styles.onTile}>
            <Penguin size={44} crown />
          </div>
          <div class={styles.onLine}>
            <Glyph name="penguin" size={24} />
            <Glyph name="penguin" size={20} />
            <Glyph name="penguin" size={16} />
          </div>
        </div>
      </section>
    </div>
  );
}
