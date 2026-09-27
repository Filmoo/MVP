import type { JSX } from "solid-js";
import { Card } from "../design/Card";
import { EmptyState } from "../design/States";
import page from "./page.module.css";

export function Planned(props: { title: string }): JSX.Element {
  return (
    <div class={page.page}>
      <h1 class={page.title}>{props.title}</h1>
      <Card>
        <EmptyState icon="sparkles" title="Coming soon" text="This screen is designed after the feature triage." />
      </Card>
    </div>
  );
}
