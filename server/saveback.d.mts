import type { Project } from "../src/model";
export function fingerprint(text: string): string;
export function readXmlText(file: string): Promise<string>;
export function inside(parent: string, child: string): boolean;
export function sourceAccess(
  root: { path: string },
  file: string | null,
  gameRoot: string,
): Promise<{ writable: boolean; reason: string; file?: string }>;
export function coordinatePatch(
  text: string,
  originalId: string,
  base: Project,
  edited: Project,
): {
  text: string;
  changes: { node: string; attribute: string; before: string; after: string }[];
  warnings: string[];
};
export function createSaveback(gameRoot: string): {
  bind(
    project: Project,
    root: { path: string },
    id: string,
    raw: string,
  ): Promise<Project>;
  preview(
    project: Project,
  ): Promise<{ planId: string; changes: unknown[]; warnings: string[] }>;
  commit(
    planId: string,
  ): Promise<{ file: string; backup: string; count: number }>;
};
