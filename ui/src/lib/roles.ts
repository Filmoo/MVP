import type { Role } from "../data/generated/Role";
import type { IconName } from "../design/Icon";

export const ROLE_LABEL: Record<Role, string> = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };

/** For tight spots such as role odds under a champion. */
export const ROLE_SHORT: Record<Role, string> = { top: "Top", jungle: "Jgl", middle: "Mid", bottom: "Bot", support: "Sup" };

/** Map order. */
export const ROLES: readonly Role[] = ["top", "jungle", "middle", "bottom", "support"];

export const ROLE_ICON: Record<Role, IconName> = {
  top: "roleTop",
  jungle: "roleJungle",
  middle: "roleMiddle",
  bottom: "roleBottom",
  support: "roleSupport",
};
