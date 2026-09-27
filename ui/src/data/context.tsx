import { createContext, type JSX, type Resource, useContext } from "solid-js";
import { createStaticData, type StaticData } from "./static-data";
import type { Transport } from "./transport";

interface AppData {
  transport: Transport;
  staticData: Resource<StaticData>;
}

const Ctx = createContext<AppData>();

export function DataProvider(props: { transport: Transport; children: JSX.Element }): JSX.Element {
  const value: AppData = {
    transport: props.transport,
    staticData: createStaticData(props.transport),
  };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useData() outside <DataProvider>");
  return value;
}
