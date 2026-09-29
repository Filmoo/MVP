import type { JSX } from "solid-js";
import { NoticeList, UpdateRequiredDialog } from "../app/notices/Notices";
import { aramDraft, champSelectDraft } from "../data/mock/draft-fixtures";
import { profile } from "../data/mock/fixtures";
import { liveGame } from "../data/mock/live-fixtures";
import { gameFor, withGrades } from "../data/mock/match-fixtures";
import { outageBanner, patchBanner, requiredConfig, updateReady } from "../data/mock/platform-fixtures";
import { defaultSettings } from "../data/mock/settings-fixtures";
import { mayhemAugments, mayhemChampion, mayhemOverview } from "../data/mock/mayhem-fixtures";
import { mockChampionPage, mockStatsIndex, mockTierList } from "../data/mock/stats-fixtures";
import { localized, t } from "../i18n";
import { roleLabel } from "../lib/roles";
import { bracketLabel, buildFor, roleTabs } from "../lib/stats";
import { BuildSummary } from "../views/champions/BuildSummary";
import { ItemsCard, SkillsCard, SpellsCard } from "../views/champions/Builds";
import { ChampionGrid } from "../views/champions/ChampionGrid";
import { ChampionHero } from "../views/champions/ChampionHero";
import { MatchupsCard } from "../views/champions/Matchups";
import { RunesCard } from "../views/champions/Runes";
import { Comps } from "../views/draft/Comps";
import { ImportPanel } from "../views/draft/ImportBar";
import { Suggestions } from "../views/draft/Suggestions";
import { Teams } from "../views/draft/Teams";
import { Why } from "../views/draft/Why";
import { MatchTable } from "../views/home/MatchDetails";
import { PerformanceSummary } from "../views/home/PerformanceSummary";
import { ProfileHeader } from "../views/home/ProfileHeader";
import { RecentMatches } from "../views/home/RecentMatches";
import { LiveTeam } from "../views/live/LiveTeam";
import { AugmentTiers } from "../views/mayhem/Mayhem";
import { ChampionAugmentsView } from "../views/mayhem/parts";
import { About, AppSettings, AutomationSettings, ImportSettings, NoMatch, StatsSettings } from "../views/settings/sections";
import { TierTable } from "../views/tierlist/TierTable";

// Stats widgets measured on a two-role champion (Lux: support, mid) and the full Emerald+ list.
const tierList = mockTierList(420, "emeraldPlus");
const lux = mockChampionPage(99, 420, "emeraldPlus");
const luxBuild = buildFor(lux, "support");
if (!luxBuild) throw new Error("the Lux fixture has a support build");

// Match rows with their grades (as player pages get them), and the first game opened.
const graded = withGrades(profile);
const firstMatch = profile.recentMatches[0];
if (!firstMatch) throw new Error("the profile fixture has games");
const firstGame = gameFor(firstMatch, profile.riotId);

// ARAM: Mayhem: every made-up augment by tier, and a champion with plenty of shared games (Ahri).
const augments = new Map(mayhemAugments.augments.map((a) => [a.id, a]));

/**
 * Every widget with representative data, for isolated performance measurement
 * (tests/perf.spec.ts). The perf suite fails if a widget rendered anywhere is missing here.
 */
export const widgetRegistry: Record<string, () => JSX.Element> = {
  "profile-header": () => <ProfileHeader profile={profile} />,
  "recent-matches": () => <RecentMatches matches={graded.recentMatches} focus={graded.riotId} />,
  "match-details": () => <MatchTable game={firstGame} focus={profile.riotId} />,
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
  // The pick's terms and your team with it, the switch to the compositions.
  "draft-why": () => (
    <Why
      suggestion={champSelectDraft.suggestions[0]}
      teamPercent={champSelectDraft.team?.percent}
      comps={champSelectDraft.comps}
      data={champSelectDraft.data}
      tab="pick"
      onTab={() => {}}
    />
  ),
  // Both teams, every row.
  "draft-comps": () => <Comps comps={champSelectDraft.comps} data={champSelectDraft.data} aram={false} />,
  // ARAM: your team only.
  "draft-comps-aram": () => <Comps comps={aramDraft.comps} data={aramDraft.data} aram />,
  // Every state at once: done, busy, failed, and the warning after a trade.
  "draft-imports": () => (
    <ImportPanel
      championId={54}
      subtitle={`Malphite · ${roleLabel("top")} · ${t().imports.lockedIn}`}
      parts={[
        { part: "runes", busy: false, outcome: { kind: "saved", name: "MVP · Malphite Top" }, automatic: true },
        { part: "itemSet", busy: true, automatic: false },
        { part: "spells", busy: false, outcome: { kind: "failed", reason: { kind: "noBuild" } }, automatic: false },
      ]}
      status={{ tone: "hint", text: t().imports.idle("Flash") }}
      onImport={() => {}}
      warning={{
        text: t().imports.warning.text(`Shen ${roleLabel("top")}`, "Malphite"),
        action: t().imports.warning.importFor("Malphite"),
        busy: false,
        onImport: () => {},
      }}
    />
  ),
  "settings-automation": () => <AutomationSettings settings={defaultSettings} onChange={() => {}} />,
  "settings-imports": () => <ImportSettings settings={defaultSettings} onChange={() => {}} />,
  "settings-stats": () => <StatsSettings settings={defaultSettings} onChange={() => {}} />,
  "settings-app": () => <AppSettings settings={defaultSettings} onChange={() => {}} />,
  "live-team": () => <LiveTeam title={t().draft.yourTeam} players={liveGame.allies} enemy={false} scouting="done" />,
  "settings-about": () => <About info={{ name: "MVP", version: "0.1.0", platform: "windows", installId: null }} update={updateReady} />,
  "settings-no-match": () => <NoMatch query="overlay" onClear={() => {}} />,
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
      message={requiredConfig.minVersion ? localized(requiredConfig.minVersion.message) : ""}
      update={updateReady}
      inGame={false}
      onRestart={() => {}}
      onCheck={() => {}}
    />
  ),
  "tier-list": () => <TierTable list={tierList} roleFilter="all" />,
  // Sorted by name, its heaviest first slice: every tile has a badge (by tier, a heading has it).
  "champion-grid": () => <ChampionGrid list={tierList} roleFilter="all" sort="name" query="" />,
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
  "mayhem-augments": () => <AugmentTiers augments={augments} overview={mayhemOverview} rarity="all" />,
  "mayhem-champion": () => (
    <div>
      <ChampionAugmentsView champion={mayhemChampion(103)} augments={augments} name="Ahri" full />
    </div>
  ),
  // A champion page's bar, outside of champion select: spells wait for it.
  "champion-import": () => (
    <ImportPanel
      championId={99}
      subtitle={`Lux · ${roleLabel("support")} · ${t().imports.mostPlayedIn(420, bracketLabel("emeraldPlus"))}`}
      parts={[
        { part: "runes", busy: false, outcome: { kind: "saved", name: "MVP · Lux Support" }, automatic: false },
        { part: "itemSet", busy: false, automatic: false },
        { part: "spells", busy: false, disabled: t().imports.spellsInChampSelect, automatic: false },
      ]}
      status={{ tone: "done", text: t().imports.savedRunes("MVP · Lux Support") }}
      onImport={() => {}}
    />
  ),
};
