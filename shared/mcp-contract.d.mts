import type { Project } from "../src/model";
import type { ZodType } from "zod";
export const VERSION: string;
export const calibrationPatch: ZodType;
export const previewPatch: ZodType;
export const toolDefinitions: {
  name: string;
  description: string;
  inputSchema: ZodType;
  readOnly: boolean;
}[];
export const definitionsByName: Map<string, (typeof toolDefinitions)[number]>;
export function applyCalibrationPatch(
  project: Project,
  input: unknown,
): Project;
