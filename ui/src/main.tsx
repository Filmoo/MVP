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
// Not a top-level `await`: the first screen's code is one chunk with this module (vite.config.ts),
// and a chunk loaded meanwhile that imports from it would wait for this module to finish.
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
