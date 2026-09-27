import { createResource, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import { Card } from "../../design/Card";
import page from "../page.module.css";

export default function Settings(): JSX.Element {
  const { transport } = useData();
  const [info] = createResource(() => transport.call("app_info"));
  return (
    <div class={page.page}>
      <h1 class={page.title}>Settings</h1>
      <Card title="About">
        <Show when={info()} fallback={<p>Loading…</p>}>
          {(i) => (
            <p>
              {i().name} {i().version} · {i().platform}
            </p>
          )}
        </Show>
      </Card>
    </div>
  );
}
