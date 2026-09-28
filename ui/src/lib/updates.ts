import type { UpdateStatus } from "../data/generated/UpdateStatus";

/** What a status line says, and the one action it offers. */
export interface UpdateLine {
  text: string;
  action?: "check" | "restart";
  label?: string;
  /** The action is running (a check): shown, not clickable. */
  busy?: boolean;
}

const percent = (value: number | null) => (value === null ? "" : ` (${value} %)`);

/** Settings → About: where the app's own update stands. */
export function aboutLine(update: UpdateStatus): UpdateLine {
  switch (update.state) {
    case "unavailable":
      return { text: `This copy of MVP doesn't update itself (${update.reason}).` };
    case "idle":
      return { text: "MVP looks for updates by itself every few hours.", action: "check", label: "Check for updates" };
    case "checking":
      return { text: "Checking for updates…", action: "check", label: "Check for updates", busy: true };
    case "upToDate":
      return { text: "MVP is up to date.", action: "check", label: "Check for updates" };
    case "available":
      return { text: `Version ${update.version} is out: it downloads as soon as no game is running.` };
    case "downloading":
      return { text: `Downloading version ${update.version}${percent(update.percent)}…` };
    case "ready":
      return {
        text: `Version ${update.version} is ready: it installs when you restart MVP, or when you quit.`,
        action: "restart",
        label: "Restart to update",
      };
    case "failed":
      return { text: `Couldn't check for updates: ${update.message}.`, action: "check", label: "Try again" };
  }
}

/** The "update required" card: what it says and offers (nothing during a game). */
export function requiredStep(update: UpdateStatus, inGame: boolean): UpdateLine {
  if (inGame) return { text: "Finish your game first: MVP updates right after." };
  switch (update.state) {
    case "ready":
      return { text: `MVP ${update.version} is downloaded and ready.`, action: "restart", label: "Restart to update" };
    case "downloading":
      return { text: `Downloading MVP ${update.version}${percent(update.percent)}…` };
    case "available":
    case "checking":
      return { text: "Getting the update…" };
    case "unavailable":
      return { text: "This copy of MVP can't update itself: please install the latest version." };
    case "failed":
      return { text: `Couldn't get the update: ${update.message}.`, action: "check", label: "Try again" };
    case "idle":
    case "upToDate":
      return { text: "", action: "check", label: "Check for the update" };
  }
}
