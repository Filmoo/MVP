import type { Role } from "../data/generated/Role";
import { t } from "../i18n";

/** A role's name: `Mid` (French `Milieu`). */
export const roleLabel = (role: Role): string => t().roles[role];

/** For tight spots such as role odds under a champion: `Jgl`. */
export const roleShort = (role: Role): string => t().rolesShort[role];

/** Map order. */
export const ROLES: readonly Role[] = ["top", "jungle", "middle", "bottom", "support"];
