import type { JSX } from "solid-js";
import { Card } from "../design/Card";
import type { IconName } from "../design/Icon";
import { EmptyState } from "../design/States";
import page from "./page.module.css";

export function Planned(props: { title: string; icon: IconName; description: string; stateTitle?: string }): JSX.Element {
  return (
    <div class={page.page}>
      <h1 class={page.title}>{props.title}</h1>
      <div class={page.centered}>
        <Card>
          <EmptyState icon={props.icon} title={props.stateTitle ?? "Coming soon"} text={props.description} />
        </Card>
      </div>
    </div>
  );
}
