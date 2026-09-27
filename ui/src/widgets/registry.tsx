import type { JSX } from "solid-js";
import { profile } from "../data/mock/fixtures";
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
};
