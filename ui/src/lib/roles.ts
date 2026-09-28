import type { Role } from "../data/generated/Role";
import type { IconName } from "../design/Icon";
import { t } from "../i18n";

/** A role's name: `Mid` (French `Milieu`). */
export const roleLabel = (role: Role): string => t().roles[role];

/** For tight spots such as role odds under a champion: `Jgl`. */
export const roleShort = (role: Role): string => t().rolesShort[role];

/** Map order. */
export const ROLES: readonly Role[] = ["top", "jungle", "middle", "bottom", "support"];

export const ROLE_ICON: Record<Role, IconName> = {
  top: "roleTop",
  jungle: "roleJungle",
  middle: "roleMiddle",
  bottom: "roleBottom",
  support: "roleSupport",
};

/** A role's identity colour (tokens.css), for its icon when chosen and in charts. */
export const ROLE_TONE: Record<Role, string> = {
  top: "var(--role-top)",
  jungle: "var(--role-jungle)",
  middle: "var(--role-middle)",
  bottom: "var(--role-bottom)",
  support: "var(--role-support)",
};
