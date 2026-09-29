/** Changes to versions: create, edit, reorder, delete (the owner's; no optimistic step needed). */
import { api, type VersionInput } from "../api";
import { data, setData } from "./data";
import { failed } from "./ops";
import { toast } from "./toasts";

export async function createVersion(input: VersionInput & { name: string }): Promise<boolean> {
  try {
    const created = await api.createVersion(input);
    setData("versions", (all) => [...all, created]);
    toast(`Added version ${created.name}`);
    return true;
  } catch (error) {
    return failed(`add version ${input.name}`, error);
  }
}

export async function updateVersion(id: number, patch: VersionInput): Promise<boolean> {
  try {
    const updated = await api.updateVersion(id, patch);
    setData("versions", (v) => v.id === id, updated);
    toast(`Saved version ${updated.name}`);
    return true;
  } catch (error) {
    return failed("save the version", error);
  }
}

/** One step left (-1) or right (+1). */
export async function shiftVersion(id: number, by: -1 | 1): Promise<boolean> {
  const order = data.versions.map((v) => v.id);
  const index = order.indexOf(id);
  const to = index + by;
  if (index < 0 || to < 0 || to >= order.length) return false;
  // Before the version that will follow it (or last).
  const rest = order.filter((v) => v !== id);
  const beforeId = rest[to] ?? null;
  try {
    const versions = await api.moveVersion(id, beforeId);
    setData("versions", versions);
    return true;
  } catch (error) {
    return failed("move the version", error);
  }
}

export async function deleteVersion(id: number): Promise<boolean> {
  const name = data.versions.find((v) => v.id === id)?.name ?? "";
  try {
    await api.deleteVersion(id);
    setData("versions", (all) => all.filter((v) => v.id !== id));
    toast(`Deleted version ${name}`);
    return true;
  } catch (error) {
    return failed(`delete version ${name}`, error);
  }
}
