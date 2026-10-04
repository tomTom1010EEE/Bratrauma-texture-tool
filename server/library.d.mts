import type { XMLParser } from "fast-xml-parser";
import type { Project, Reference, Library } from "../src/model";
type SourceRoot = {
  path: string;
  name: string;
  workshopId: string;
  id?: string;
};
export const parser: XMLParser;
export function exists(path: string): Promise<boolean>;
export function scan(root: SourceRoot): Promise<Library>;
export function reference(
  root: SourceRoot,
  roots: SourceRoot[],
  gameRoot: string,
  gender?: string,
): Promise<Reference>;
export function importItem(
  file: string,
  id: string,
  root: SourceRoot,
  roots: SourceRoot[],
  gameRoot: string,
): Promise<Project>;
export function itemNodes(node: unknown): unknown[];
