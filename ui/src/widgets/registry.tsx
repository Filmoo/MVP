import type { JSX } from "solid-js";
import { NoticeList, UpdateRequiredDialog } from "../app/notices/Notices";
import { champSelectDraft } from "../data/mock/draft-fixtures";
import { profile } from "../data/mock/fixtures";
import { liveGame } from "../data/mock/live-fixtures";
import { outageBanner, patchBanner, requiredConfig, updateReady } from "../data/mock/platform-fixtures";
import { defaultSettings } from "../data/mock/settings-fixtures";
import { mockChampionPage, mockStatsIndex, mockTierList } from "../data/mock/stats-fixtures";
import { buildFor, roleTabs } from "../lib/stats";
import { BuildSummary } from "../views/champions/BuildSummary";
import { ItemsCard, SkillsCard, SpellsCard } from "../views/champions/Builds";
import { ChampionGrid } from "../views/champions/ChampionGrid";
import { ChampionHero } from "../views/champions/ChampionHero";
import { MatchupsCard } from "../views/champions/Matchups";
import { RunesCard } from "../views/champions/Runes";
import { IDLE_HINT, ImportPanel } from "../views/draft/ImportBar";
import { Suggestions } from "../views/draft/Suggestions";
import { Teams } from "../views/draft/Teams";
import { Why } from "../views/draft/Why";
import { PerformanceSummary } from "../views/home/PerformanceSummary";
import { ProfileHeader } from "../views/home/ProfileHeader";
import { RecentMatches } from "../views/home/RecentMatches";
import { LiveTeam } from "../views/live/LiveTeam";
import { About, AppSettings, AutomationSettings, ImportSettings } from "../views/settings/sections";
import { TierTable } from "../views/tierlist/TierTable";

// Stats widgets measured on a two-role champion (Lux: support, mid) and the full Emerald+ list.
const tierList = mockTierList(420, "emeraldPlus");
const lux = mockChampionPage(99, 420, "emeraldPlus");
const luxBuild = buildFor(lux, "support");
if (!luxBuild) throw new Error("the Lux fixture has a support build");

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
  "tier-list": () => <TierTable list={tierList} roleFilter="all" />,
  "champion-grid": () => <ChampionGrid list={tierList} roleFilter="all" query="" />,
  "champion-hero": () => (
    <ChampionHero
      championId={99}
      page={lux}
      loading={false}
      tabs={roleTabs(lux)}
      forRole="support"
      onRole={() => {}}
      index={mockStatsIndex()}
    />
  ),
  "champion-runes": () => <RunesCard build={luxBuild} />,
  "champion-spells": () => <SpellsCard build={luxBuild} />,
  "champion-skills": () => <SkillsCard build={luxBuild} />,
  "champion-items": () => <ItemsCard build={luxBuild} />,
  "champion-matchups": () => <MatchupsCard page={lux} forRole="support" />,
  "build-summary": () => <BuildSummary championId={99} build={luxBuild} />,
  // A champion page's bar, outside of champion select: spells wait for it.
  "champion-import": () => (
    <ImportPanel
      championId={99}
      subtitle="Lux · Support · most played in Ranked Solo · Emerald+"
      parts={[
        { part: "runes", busy: false, outcome: { kind: "saved", name: "MVP · Lux Support" }, automatic: false },
        { part: "itemSet", busy: false, automatic: false },
        { part: "spells", busy: false, disabled: "Spells can only change during champion select", automatic: false },
      ]}
      status={{ tone: "done", text: "“MVP · Lux Support” is your current rune page." }}
      onImport={() => {}}
    />
  ),
};
