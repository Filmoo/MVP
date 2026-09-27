import { type Accessor, createContext, type JSX, useContext } from "solid-js";
import { createGameData, type GameDataView } from "./static-data";
import type { Transport } from "./transport";

interface AppData {
  transport: Transport;
  gameData: Accessor<GameDataView | undefined>;
}

const Ctx = createContext<AppData>();

export function DataProvider(props: { transport: Transport; children: JSX.Element }): JSX.Element {
  const value: AppData = { transport: props.transport, gameData: createGameData(props.transport) };
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useData(): AppData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useData() outside <DataProvider>");
  return value;
}
