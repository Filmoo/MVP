import type { Banner } from "../generated/Banner";
import type { RemoteConfig } from "../generated/RemoteConfig";
import type { UpdateStatus } from "../generated/UpdateStatus";
import { DEFAULT_REMOTE_CONFIG } from "../remote-defaults";
import { FIXTURE_NOW } from "./fixtures";

const hoursFromNow = (hours: number) => new Date(FIXTURE_NOW + hours * 3_600_000).toISOString();

/** Patch day: informative, with a link, the player may close it. */
export const patchBanner: Banner = {
  id: "patch-26.20",
  severity: "info",
  text: {
    en: "Patch 26.20 is live: champion stats refresh over the next hours as new games come in.",
    fr: "Le patch 26.20 est là : les stats des champions se mettent à jour dans les prochaines heures.",
  },
  link: "https://status.example.com/patch-26.20",
  startsAt: hoursFromNow(-2),
  endsAt: hoursFromNow(22),
  dismissible: true,
};

/** An outage: stays up while it lasts. */
export const outageBanner: Banner = {
  id: "euw-riot-slow",
  severity: "warn",
  text: {
    en: "Riot's servers are slow on EUW right now: player cards and searches may take longer.",
    fr: "Les serveurs de Riot sont lents sur EUW : les cartes et recherches de joueurs peuvent être plus longues.",
  },
  link: null,
  startsAt: null,
  endsAt: null,
  dismissible: false,
};

/** Ended yesterday: a copy the core kept offline, never shown. */
export const endedBanner: Banner = {
  ...patchBanner,
  id: "patch-26.19",
  text: { en: "Patch 26.19 is live.", fr: "Le patch 26.19 est là." },
  startsAt: hoursFromNow(-48),
  endsAt: hoursFromNow(-24),
};

export const bannersConfig: RemoteConfig = { ...DEFAULT_REMOTE_CONFIG, banners: [patchBanner, outageBanner, endedBanner] };

export const requiredConfig: RemoteConfig = {
  ...DEFAULT_REMOTE_CONFIG,
  updateRequired: true,
  minVersion: {
    version: "0.2.0",
    message: {
      en: "This version of MVP no longer works with our servers. The update takes a few seconds and keeps your settings.",
      fr: "Cette version de MVP ne fonctionne plus avec nos serveurs. La mise à jour prend quelques secondes et garde vos réglages.",
    },
  },
};

/** The auto-accept kill switch is on (e.g. a client patch broke it). */
export const autoAcceptKilledConfig: RemoteConfig = {
  ...DEFAULT_REMOTE_CONFIG,
  killSwitches: { ...DEFAULT_REMOTE_CONFIG.killSwitches, autoAccept: true },
};

export const upToDate: UpdateStatus = { state: "upToDate" };

export const updateReady = {
  state: "ready",
  version: "0.2.0",
  notes: "Faster draft helper",
  mandatory: false,
} as const satisfies UpdateStatus;

export const updateDownloading: UpdateStatus = { state: "downloading", version: "0.2.0", percent: 45 };

/** A random install id as the core makes it (32 hex digits). */
export const installId = "3f9c2a7be41d4c0a9d6e8b1f2a4c6e80";
