import "./design/fonts.css";
import "./design/base.css";
import { render } from "solid-js/web";
import { App } from "./app/App";
import { createTransport } from "./data";
import { DataProvider } from "./data/context";
import { initLanguage } from "./i18n";
import { forwardCrashes, installGlobalErrorHandlers } from "./lib/errors";

installGlobalErrorHandlers();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

// The first frame is already in the language this machine used last (French loads on demand).
// Not a top-level await: the startup code is one chunk with this module (vite.config.ts), which
// lazily loaded chunks import, and they would wait forever on a module paused at its top level.
void Promise.all([createTransport(), initLanguage()]).then(([transport]) => {
  forwardCrashes(transport);
  render(
    () => (
      <DataProvider transport={transport}>
        <App />
      </DataProvider>
    ),
    root,
  );
});
