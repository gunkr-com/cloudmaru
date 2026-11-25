import type { en } from "./en";
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
type LeafPaths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}` }[keyof T & string];
export type MessageKey = LeafPaths<Messages>;
