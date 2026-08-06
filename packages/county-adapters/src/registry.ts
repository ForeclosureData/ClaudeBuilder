import type { CountyForeclosureAdapter } from "./types";
import { hidalgoAdapter } from "./hidalgo/adapter";

const adapters: Record<string, CountyForeclosureAdapter> = {
  hidalgo: hidalgoAdapter,
};

export function getCountyAdapter(adapterKey: string): CountyForeclosureAdapter {
  const adapter = adapters[adapterKey];
  if (!adapter) {
    throw new Error(`No county adapter registered for key "${adapterKey}". Add it to registry.ts.`);
  }
  return adapter;
}

export function listCountyAdapters(): CountyForeclosureAdapter[] {
  return Object.values(adapters);
}
