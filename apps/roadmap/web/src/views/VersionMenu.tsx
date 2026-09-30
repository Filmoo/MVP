import type { JSX } from "solid-js";
import { data, features } from "../state/data";
import { setOverlay } from "../state/ui";
import { deleteVersion, shiftVersion, updateVersion } from "../state/versions";
import type { Version } from "../types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Dropdown, layers } from "../ui/Layers";

/** A version's menu in its column head: edit, release, move, delete. */
export function VersionMenu(props: { version: Version }): JSX.Element {
  const index = () => data.versions.findIndex((v) => v.id === props.version.id);
  const empty = () => !features().some((f) => f.versionId === props.version.id);
  const today = () => new Date().toISOString().slice(0, 10);
  return (
    <Dropdown
      label={`Version ${props.version.name}`}
      align="end"
      trigger={(open, toggle) => (
        <Button
          variant="ghost"
          size="sm"
          square
          icon="chevronDown"
          aria-label={`Version ${props.version.name} menu`}
          aria-expanded={open()}
          onClick={toggle}
        />
      )}
    >
      {(close) => {
        const act = (run: () => void) => () => {
          close();
          run();
        };
        return (
          <>
            <button
              type="button"
              role="menuitem"
              class={layers.option}
              onClick={act(() => setOverlay({ kind: "version", versionId: props.version.id }))}
            >
              <Icon name="edit" /> Edit version
            </button>
            <button
              type="button"
              role="menuitem"
              class={layers.option}
              onClick={act(() => void updateVersion(props.version.id, { releasedOn: props.version.releasedOn ? null : today() }))}
            >
              <Icon name="flag" /> {props.version.releasedOn ? "Mark as not released" : "Mark as released today"}
            </button>
            <div class={layers.separator} />
            <button
              type="button"
              role="menuitem"
              class={layers.option}
              disabled={index() <= 0}
              onClick={act(() => void shiftVersion(props.version.id, -1))}
            >
              <Icon name="chevronLeft" /> Move left
            </button>
            <button
              type="button"
              role="menuitem"
              class={layers.option}
              disabled={index() >= data.versions.length - 1}
              onClick={act(() => void shiftVersion(props.version.id, 1))}
            >
              <Icon name="chevronRight" /> Move right
            </button>
            <div class={layers.separator} />
            <button
              type="button"
              role="menuitem"
              class={layers.option}
              disabled={!empty()}
              title={empty() ? undefined : "Only an empty version can go: move its features first"}
              onClick={act(() => void deleteVersion(props.version.id))}
            >
              <Icon name="trash" /> Delete version
            </button>
          </>
        );
      }}
    </Dropdown>
  );
}
