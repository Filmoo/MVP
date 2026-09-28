import type { UpdateStatus } from "../data/generated/UpdateStatus";
import { t } from "../i18n";

/** What a status line says, and the one action it offers. */
export interface UpdateLine {
  text: string;
  action?: "check" | "restart";
  label?: string;
  /** The action is running (a check): shown, not clickable. */
  busy?: boolean;
}

/** Settings → About: where the app's own update stands. */
export function aboutLine(update: UpdateStatus): UpdateLine {
  const words = t().updates;
  switch (update.state) {
    case "unavailable":
      return { text: words.unavailable(update.reason) };
    case "idle":
      return { text: words.idle, action: "check", label: words.check };
    case "checking":
      return { text: words.checking, action: "check", label: words.check, busy: true };
    case "upToDate":
      return { text: words.upToDate, action: "check", label: words.check };
    case "available":
      return { text: words.available(update.version) };
    case "downloading":
      return { text: words.downloading(update.version, update.percent) };
    case "ready":
      return { text: words.ready(update.version), action: "restart", label: words.restart };
    case "failed":
      return { text: words.failed(update.message), action: "check", label: t().common.tryAgain };
  }
}

/** The "update required" card: what it says and offers (nothing during a game). */
export function requiredStep(update: UpdateStatus, inGame: boolean): UpdateLine {
  const words = t().updates.required;
  if (inGame) return { text: words.inGame };
  switch (update.state) {
    case "ready":
      return { text: words.ready(update.version), action: "restart", label: t().updates.restart };
    case "downloading":
      return { text: words.downloading(update.version, update.percent) };
    case "available":
    case "checking":
      return { text: words.getting };
    case "unavailable":
      return { text: words.cannot };
    case "failed":
      return { text: words.failed(update.message), action: "check", label: t().common.tryAgain };
    case "idle":
    case "upToDate":
      return { text: "", action: "check", label: words.check };
  }
}
