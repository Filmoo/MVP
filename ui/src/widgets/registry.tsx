import { For, type JSX } from "solid-js";
import { NoticeList, UpdateRequiredDialog } from "../app/notices/Notices";
import { useData } from "../data/context";
import type { TextSpan } from "../data/generated/TextSpan";
import { aramDraft, champSelectDraft } from "../data/mock/draft-fixtures";
import { profile } from "../data/mock/fixtures";
import { liveGame } from "../data/mock/live-fixtures";
import { gameFor, withGrades } from "../data/mock/match-fixtures";
import { gatheringOverview, mayhemAugments, mayhemChampion, mayhemOverview } from "../data/mock/mayhem-fixtures";
import { outageBanner, patchBanner, requiredConfig, updateReady } from "../data/mock/platform-fixtures";
import { lpFor, masteryFixture } from "../data/mock/progress-fixtures";
import { defaultSettings } from "../data/mock/settings-fixtures";
import { mockChampionPage, mockPreviousTierList, mockStatsIndex, mockTierList } from "../data/mock/stats-fixtures";
import { ShardIcon } from "../design/RuneIcon";
import { GameTip, type GameTipProps } from "../design/tip/Tip";
import tipStyles from "../design/tip/Tip.module.css";
import { localized, t } from "../i18n";
import { roleLabel } from "../lib/roles";
import { bracketLabel, buildFor, rankEntries, roleTabs, trendsOf } from "../lib/stats";
import { BuildSummary } from "../views/champions/BuildSummary";
import { ItemsCard, SkillsCard, SpellsCard } from "../views/champions/Builds";
import { ChampionHero } from "../views/champions/ChampionHero";
import { MatchupsCard } from "../views/champions/Matchups";
import { RunesCard } from "../views/champions/Runes";
import { Comps } from "../views/draft/Comps";
import { ImportPanel } from "../views/draft/ImportBar";
import { Suggestions } from "../views/draft/Suggestions";
import { Teams } from "../views/draft/Teams";
import { Why } from "../views/draft/Why";
import { MatchTable, markedIn } from "../views/home/MatchDetails";
import { MatchHistory } from "../views/home/MatchHistory";
import { MatchStats } from "../views/home/MatchStats";
import { PerformanceSummary } from "../views/home/PerformanceSummary";
import { ProfileHeader } from "../views/home/ProfileHeader";
import { LiveTeam } from "../views/live/LiveTeam";
import { AugmentTiers } from "../views/mayhem/Mayhem";
import { ChampionAugmentsView } from "../views/mayhem/parts";
import { QuestionCard } from "../views/mayhem/Question";
import { About, AppSettings, AutomationSettings, ImportSettings, NoMatch, StatsSettings } from "../views/settings/sections";
import { NoStatsChampions } from "../views/tierlist/NoStats";
import { Shelves } from "../views/tierlist/Shelves";
import { TierTable } from "../views/tierlist/TierTable";

// Stats widgets measured on a two-role champion (Lux: support, mid) and the full Emerald+ list,
// every lane at once (its heaviest: ~220 rows, a champion once per lane), with its trends.
const tierList = mockTierList(420, "emeraldPlus");
const tierRows = rankEntries(tierList.entries, "all");
const trends = trendsOf(tierList, mockPreviousTierList(420, "emeraldPlus"));
const lux = mockChampionPage(99, 420, "emeraldPlus");
const luxBuild = buildFor(lux, "support");
if (!luxBuild) throw new Error("the Lux fixture has a support build");

/**
 * Tooltips' cards (design/tip) side by side, as they float over a page: an item with coloured
 * text, a keystone, a summoner spell with its cooldown, and a stat shard in the UI's words.
 * Sample texts: the real ones come from the core (the dev cache in the preview).
 */
function GameTips(): JSX.Element {
  const { gameData } = useData();
  const data = gameData();
  const plain = (text: string): TextSpan => ({ text });
  const strong = (text: string): TextSpan => ({ text, tone: "strong" });
  const keystone = data?.runes.get(8112)?.rune.icon;
  const cards: GameTipProps[] = [
    {
      kind: "item",
      id: 6653,
      data,
      art: data && `${data.assetBase}/img/item/6653.png`,
      text: {
        text: [
          [strong("60"), plain(" Ability Power")],
          [strong("300"), plain(" Health")],
          [],
          [strong("A passive")],
          [plain("Deals "), { text: "bonus magic damage", tone: "magic" }, plain(" over a few seconds.")],
        ],
      },
    },
    {
      kind: "rune",
      id: 8112,
      data,
      art: data && keystone ? `${data.artBase}/img/${keystone}` : undefined,
      text: { text: [[plain("Hitting a champion three times deals bonus damage.")], [], [{ text: "A line of flavour.", tone: "subtle" }]] },
    },
    {
      kind: "spell",
      id: 4,
      data,
      art: data && `${data.assetBase}/img/spell/SummonerFlash.png`,
      text: { cooldown: 300, text: [[plain("Moves you a short way.")]] },
    },
    {
      kind: "shard",
      id: 5008,
      row: "offense",
      data,
      text: null,
      glyph: (ShardIcon({ shardId: 5008, size: 24, chosen: true }) as HTMLElement).querySelector("svg") ?? undefined,
      tone: "var(--tier-s)",
    },
  ];
  return (
    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "16px", "align-items": "flex-start" }}>
      <For each={cards}>
        {(card) => (
          <div class={tipStyles.tip} style={{ position: "relative" }}>
            <GameTip {...card} />
          </div>
        )}
      </For>
    </div>
  );
}

// Match rows with their grades (as player pages get them), and the first game opened (from our
// backend: every stat row).
const graded = withGrades(profile);
const firstMatch = profile.recentMatches[0];
if (!firstMatch) throw new Error("the profile fixture has games");
const firstGame = gameFor(firstMatch, profile.riotId, false, false);
/** The LP of the fixture's ranked games, as Home gets it (computed once, not measured). */
const lp = lpFor(profile);

// ARAM: Mayhem: every made-up augment by tier, and a champion with plenty of shared games (Ahri).
const augments = new Map(mayhemAugments.augments.map((a) => [a.id, a]));

/**
 * Every widget with representative data, for isolated performance measurement
 * (tests/perf.spec.ts). The perf suite fails if a widget rendered anywhere is missing here.
 */
export const widgetRegistry: Record<string, () => JSX.Element> = {
  // Your own profile: the LP graph in the ranked pane, filters over the list, mastery.
  "profile-header": () => <ProfileHeader profile={profile} lp={lp} />,
  "recent-matches": () => <MatchHistory matches={graded.recentMatches} focus={graded.riotId} lp={lp} />,
  "match-details": () => <MatchTable game={firstGame} focus={profile.riotId} />,
  "match-stats": () => <MatchStats game={firstGame} tab="damage" marked={markedIn(firstGame, profile.riotId)} />,
  "performance-summary": () => <PerformanceSummary matches={profile.recentMatches} mastery={masteryFixture} />,
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
  // Its first 50 rows (then "Show all"). In an element, as the page's widget has it: the table
  // starts with a <Show>, which the harness can't mount alone.
  "tier-table": () => (
    <div>
      <TierTable rows={tierRows} aram={false} allRoles trends={trends} />
    </div>
  ),
  // The podium, the mini map (a dot per row) and the first slice of faces.
  "tier-shelves": () => (
    <Shelves
      rows={tierRows}
      shown={tierRows}
      filtering={false}
      allRoles
      trends={trends}
      lit={undefined}
      onLight={() => {}}
      onOpenMap={() => {}}
    />
  ),
  // Without stats: every champion by class, its first slice.
  "tier-no-stats": () => (
    <div>
      <NoStatsChampions query="" />
    </div>
  ),
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
  // The question asked once, with both features still waiting for games.
  "share-question": () => <QuestionCard progress={gatheringOverview.progress} champions={172} onAnswer={() => {}} />,
  "game-tips": () => <GameTips />,
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
