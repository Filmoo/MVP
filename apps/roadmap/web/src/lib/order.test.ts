import { describe, expect, it } from "vitest";
import type { Feature } from "../types";
import { beforeIdForLane, nextAfter, orderOf, placeMove, progress, ratio } from "./order";

function feature(id: number, versionId: number, position: number, extra: Partial<Feature> = {}): Feature {
  return {
    id,
    title: `F${id}`,
    description: "",
    versionId,
    status: "accepted",
    area: "draft",
    proposedBy: "owner",
    position,
    links: [],
    comments: 0,
    createdAt: "2026-09-29T12:00:00Z",
    updatedAt: "2026-09-29T12:00:00Z",
    startedAt: null,
    doneAt: null,
    removedAt: null,
    ...extra,
  };
}

const board = () => [feature(1, 10, 0), feature(2, 10, 1), feature(3, 10, 2), feature(4, 20, 0), feature(5, 20, 1)];

describe("placeMove, as the service does it", () => {
  it("reorders within a version", () => {
    const placed = placeMove(board(), 3, 10, 1);
    expect(placed).toEqual([
      { id: 3, versionId: 10, position: 0 },
      { id: 1, versionId: 10, position: 1 },
      { id: 2, versionId: 10, position: 2 },
    ]);
  });

  it("moves to the end of another version and closes the gap", () => {
    const placed = placeMove(board(), 1, 20, null);
    expect(placed).toEqual([
      { id: 4, versionId: 20, position: 0 },
      { id: 5, versionId: 20, position: 1 },
      { id: 1, versionId: 20, position: 2 },
      { id: 2, versionId: 10, position: 0 },
      { id: 3, versionId: 10, position: 1 },
    ]);
  });

  it("keeps removed features in their place", () => {
    const features = board();
    features[1] = feature(2, 10, 1, { removedAt: "2026-09-29T12:00:00Z" });
    expect(placeMove(features, 3, 10, 2).map((p) => p.id)).toEqual([1, 3, 2]);
  });

  it("puts an unknown neighbour at the end", () => {
    expect(placeMove(board(), 1, 10, 99).map((p) => p.id)).toEqual([2, 3, 1]);
  });
});

describe("neighbours", () => {
  it("finds what follows, to undo a move", () => {
    expect(nextAfter(board(), 1)).toBe(2);
    expect(nextAfter(board(), 3)).toBeNull();
  });

  it("drops at a lane's index, or last", () => {
    const lane = board().slice(0, 3);
    expect(beforeIdForLane(lane, 0, 3)).toBe(1);
    expect(beforeIdForLane(lane, 1, 1)).toBe(3);
    expect(beforeIdForLane(lane, 5, 1)).toBeNull();
    expect(orderOf(board(), 20).map((f) => f.id)).toEqual([4, 5]);
  });
});

describe("progress", () => {
  it("counts what counts", () => {
    const features = [
      feature(1, 1, 0, { status: "done" }),
      feature(2, 1, 1, { status: "in_progress" }),
      feature(3, 1, 2, { status: "proposed" }),
      feature(4, 1, 3, { status: "rejected" }),
      feature(5, 1, 4, { status: "done", removedAt: "2026-09-29T12:00:00Z" }),
    ];
    const p = progress(features);
    expect(p).toEqual({ total: 3, done: 1, inProgress: 1, accepted: 0, proposed: 1 });
    expect(ratio(p)).toBeCloseTo(1 / 3);
    expect(ratio(progress([]))).toBe(0);
  });
});
