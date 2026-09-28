import type { JSX } from "solid-js";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import badge from "../../design/TierBadge.module.css";
import { t } from "../../i18n";

/**
 * MVP's grade of a game: the letter on its tier colour, drawn like the tier list's grades (S+
 * takes S's colour).
 */
export function GradeChip(props: { grade: MatchGrade }): JSX.Element {
  return (
    <span
      class={`${badge.grade} ${badge.md} ${badge[`grade${props.grade.letter[0]}`]}`}
      role="img"
      aria-label={t().grade.label(props.grade.letter)}
      data-chip
    >
      {props.grade.letter}
    </span>
  );
}
