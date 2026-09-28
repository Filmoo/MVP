import type { JSX } from "solid-js";
import { NoticeList, UpdateRequiredDialog } from "../app/notices/Notices";
import { champSelectDraft } from "../data/mock/draft-fixtures";
import { profile } from "../data/mock/fixtures";
import { liveGame } from "../data/mock/live-fixtures";
import { outageBanner, patchBanner, requiredConfig, updateReady } from "../data/mock/platform-fixtures";
import { defaultSettings } from "../data/mock/settings-fixtures";
import { ChampionSoonHero } from "../views/champions/Champions";
import { IDLE_HINT, ImportPanel } from "../views/draft/ImportBar";
import { Suggestions } from "../views/draft/Suggestions";
import { Teams } from "../views/draft/Teams";
import { Why } from "../views/draft/Why";
import { PerformanceSummary } from "../views/home/PerformanceSummary";
import { ProfileHeader } from "../views/home/ProfileHeader";
import { RecentMatches } from "../views/home/RecentMatches";
import { LiveTeam } from "../views/live/LiveTeam";
import { About, AppSettings, AutomationSettings, ImportSettings } from "../views/settings/sections";

/**
 * Every widget with representative data, for isolated performance measurement
 * (tests/perf.spec.ts). The perf suite fails if a widget rendered anywhere is missing here.
 */
export const widgetRegistry: Record<string, () => JSX.Element> = {
  "profile-header": () => <ProfileHeader profile={profile} />,
  "recent-matches": () => <RecentMatches matches={profile.recentMatches} />,
  "performance-summary": () => <PerformanceSummary matches={profile.recentMatches} />,
  "draft-teams": () => <Teams draft={champSelectDraft} />,
  "draft-suggestions": () => (
    <Suggestions
      draft={champSelectDraft}
      selected={champSelectDraft.suggestions[0]?.championId}
      expanded={champSelectDraft.suggestions[0]?.championId}
      onSelect={() => {}}
    />
  ),
  "draft-why": () => <Why suggestion={champSelectDraft.suggestions[0]} teamPercent={champSelectDraft.team?.percent} />,
  // Every state at once: done, busy, failed.
  "draft-imports": () => (
    <ImportPanel
      championId={54}
      subtitle="Malphite · Top · locked in"
      parts={[
        { part: "runes", busy: false, outcome: { kind: "saved", name: "MVP · Malphite Top" }, automatic: true },
        { part: "itemSet", busy: true, automatic: false },
        { part: "spells", busy: false, outcome: { kind: "failed", reason: { kind: "noBuild" } }, automatic: false },
      ]}
      status={{ tone: "hint", text: IDLE_HINT }}
      onImport={() => {}}
    />
  ),
  "settings-automation": () => <AutomationSettings settings={defaultSettings} onChange={() => {}} />,
  "settings-imports": () => <ImportSettings settings={defaultSettings} onChange={() => {}} />,
  "settings-app": () => <AppSettings settings={defaultSettings} onChange={() => {}} />,
  "live-team": () => <LiveTeam title="Your team" players={liveGame.allies} enemy={false} scouting="done" />,
  "champion-soon": () => <ChampionSoonHero championId={103} />,
  "settings-about": () => <About info={{ name: "MVP", version: "0.1.0", platform: "windows", installId: null }} update={updateReady} />,
  banners: () => (
    <NoticeList
      banners={[patchBanner, outageBanner]}
      ready={updateReady}
      onDismiss={() => {}}
      onOpen={() => {}}
      onRestart={() => {}}
      onLater={() => {}}
    />
  ),
  "update-required": () => (
    <UpdateRequiredDialog
      message={requiredConfig.minVersion?.message.en ?? ""}
      update={updateReady}
      inGame={false}
      onRestart={() => {}}
      onCheck={() => {}}
    />
  ),
};
