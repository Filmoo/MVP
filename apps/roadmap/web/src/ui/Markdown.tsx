import { For, type JSX, Match, Switch } from "solid-js";
import { type Block, type Inline, parse } from "../lib/markdown";
import styles from "./Markdown.module.css";

function Inlines(props: { nodes: Inline[] }): JSX.Element {
  return (
    <For each={props.nodes}>
      {(node) => (
        <Switch>
          <Match when={node.t === "text" && node}>{(n) => n().v}</Match>
          <Match when={node.t === "code" && node}>{(n) => <code>{n().v}</code>}</Match>
          <Match when={node.t === "strong" && node}>
            {(n) => (
              <strong>
                <Inlines nodes={n().c} />
              </strong>
            )}
          </Match>
          <Match when={node.t === "em" && node}>
            {(n) => (
              <em>
                <Inlines nodes={n().c} />
              </em>
            )}
          </Match>
          <Match when={node.t === "link" && node}>
            {(n) => (
              <a href={n().href} target="_blank" rel="noopener noreferrer">
                <Inlines nodes={n().c} />
              </a>
            )}
          </Match>
          <Match when={node.t === "br"}>
            <br />
          </Match>
        </Switch>
      )}
    </For>
  );
}

function Blocks(props: { blocks: Block[] }): JSX.Element {
  return (
    <For each={props.blocks}>
      {(block) => (
        <Switch>
          <Match when={block.t === "p" && block}>
            {(b) => (
              <p>
                <Inlines nodes={b().c} />
              </p>
            )}
          </Match>
          <Match when={block.t === "h" && block}>
            {(b) => (
              <h4 data-level={b().level}>
                <Inlines nodes={b().c} />
              </h4>
            )}
          </Match>
          <Match when={block.t === "ul" && block}>
            {(b) => (
              <ul>
                <For each={b().items}>
                  {(item) => (
                    <li>
                      <Inlines nodes={item} />
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
          <Match when={block.t === "ol" && block}>
            {(b) => (
              <ol start={b().start}>
                <For each={b().items}>
                  {(item) => (
                    <li>
                      <Inlines nodes={item} />
                    </li>
                  )}
                </For>
              </ol>
            )}
          </Match>
          <Match when={block.t === "pre" && block}>
            {(b) => (
              <pre>
                <code>{b().v}</code>
              </pre>
            )}
          </Match>
          <Match when={block.t === "quote" && block}>
            {(b) => (
              <blockquote>
                <Blocks blocks={b().c} />
              </blockquote>
            )}
          </Match>
          <Match when={block.t === "hr"}>
            <hr />
          </Match>
        </Switch>
      )}
    </For>
  );
}

/** Markdown as elements (never innerHTML). */
export function Markdown(props: { source: string; class?: string | undefined }): JSX.Element {
  return (
    <div class={`${styles.markdown} ${props.class ?? ""}`}>
      <Blocks blocks={parse(props.source)} />
    </div>
  );
}
