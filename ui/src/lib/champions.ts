/** Words about champions that game data leaves in English. */
import { t } from "../i18n";

/** A Data Dragon class tag in the current language (`Fighter` → `Combattant`); unknown ones as they are. */
export const className = (tag: string): string => t().classes[tag] ?? tag;

/** A champion's classes, `Mage · Assassin`; `undefined` without any. */
export function classes(tags: readonly string[] | undefined): string | undefined {
  return tags && tags.length > 0 ? tags.map(className).join(" · ") : undefined;
}
