import type { Role } from "../data/generated/Role";

export const ROLE_LABEL: Record<Role, string> = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" };

/** For tight spots such as role odds under a champion. */
export const ROLE_SHORT: Record<Role, string> = { top: "Top", jungle: "Jgl", middle: "Mid", bottom: "Bot", support: "Sup" };
