import type { JSX } from "solid-js";
import { champSelectDraft } from "../data/mock/draft-fixtures";
import { profile } from "../data/mock/fixtures";
import { Suggestions } from "../views/draft/Suggestions";
import { Teams } from "../views/draft/Teams";
import { Why } from "../views/draft/Why";
import { PerformanceSummary } from "../views/home/PerformanceSummary";
import { ProfileHeader } from "../views/home/ProfileHeader";
import { RecentMatches } from "../views/home/RecentMatches";

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
};
