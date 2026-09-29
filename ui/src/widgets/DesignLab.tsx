import { For, type JSX } from "solid-js";
import type { TierGrade } from "../data/generated/TierGrade";
import { Glyph, type GlyphName, glyphPath } from "../design/Glyph";
import { Icon, iconPath, LineIcon } from "../design/Icon";
import { Mark } from "../design/Logo";
import { Penguin } from "../design/Penguin";
import { TierMark } from "../design/TierMark";
import styles from "./DesignLab.module.css";

/*
 * The design lab (dev server only: `#/__harness?show=design`): the glyphs, the role icons, the
 * tier medallions and the penguin at every size. Labels here are the code's own names (a lab, like
 * the emblem lab), not product words.
 */

const GLYPHS: GlyphName[] = ["roleAll", "winRate", "pick", "ban", "games", "patch", "ranked", "aram", "crown", "map", "shelves", "table"];
const ROLES = ["roleTop", "roleJungle", "roleMiddle", "roleBottom", "roleSupport"] as const;
const TONES = ["var(--role-top)", "var(--role-jungle)", "var(--role-middle)", "var(--role-bottom)", "var(--role-support)"];
const TIERS: TierGrade[] = ["S", "A", "B", "C", "D"];

function GlyphCell(props: { name: GlyphName }): JSX.Element {
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
        <h2 class={styles.title}>glyphs · 24 / 20 / 16 / 14 px</h2>
        <div class={styles.iconGrid}>
          <For each={GLYPHS}>{(name) => <GlyphCell name={name} />}</For>
        </div>
        <h2 class={styles.title}>roles · 24 / 20 / 16 px, then chosen (role colour)</h2>
        <div class={styles.roles}>
          <div class={styles.role} style={{ "--tone": "var(--accent)" }}>
            <LineIcon d={glyphPath("roleAll")} size={24} />
            <LineIcon d={glyphPath("roleAll")} size={20} />
            <LineIcon d={glyphPath("roleAll")} size={16} />
            <span class={styles.roleOn}>
              <LineIcon d={glyphPath("roleAll")} size={20} />
            </span>
          </div>
          <For each={ROLES}>
            {(name, i) => (
              <div class={styles.role} style={{ "--tone": TONES[i()] }}>
                <LineIcon d={iconPath(name)} size={24} />
                <LineIcon d={iconPath(name)} size={20} />
                <LineIcon d={iconPath(name)} size={16} />
                <span class={styles.roleOn}>
                  <LineIcon d={iconPath(name)} size={20} />
                </span>
              </div>
            )}
          </For>
          <div class={styles.navCompare}>
            <span class={styles.caption}>nav</span>
            <Icon name="tiers" size={20} />
          </div>
        </div>
      </section>

      <section class={styles.panel}>
        <h2 class={styles.title}>tier medallions · 64 / 40 / 24 / 20 px</h2>
        <div class={styles.tiers}>
          <For each={TIERS}>
            {(grade) => (
              <div class={styles.tierRow}>
                <TierMark grade={grade} size="xl" />
                <TierMark grade={grade} size="lg" />
                <TierMark grade={grade} size="md" />
                <TierMark grade={grade} size="sm" />
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
      </section>
    </div>
  );
}
