import "./design/fonts.css";
import "./design/base.css";
import { render } from "solid-js/web";
import { App } from "./app/App";
import { createTransport } from "./data";
import { DataProvider } from "./data/context";
import { installGlobalErrorHandlers } from "./lib/errors";

installGlobalErrorHandlers();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

const transport = await createTransport();
render(
  () => (
    <DataProvider transport={transport}>
      <App />
    </DataProvider>
  ),
  root,
);
