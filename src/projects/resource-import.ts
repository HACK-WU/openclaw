/**
 * Project Resource Import
 *
 * Unified import for project docs, rules, and skills from ZIP format.
 */

import JSZip from "jszip";
import {
  createProjectDoc,
  createProjectRule,
  createProjectSkill,
  loadProjectDocs,
  loadProjectMeta,
  loadProjectRules,
  loadProjectSkills,
  updateProjectDoc,
  updateProjectRule,
  updateProjectSkill,
} from "./project-store.js";
import type { Manifest } from "./resource-export.js";
import type { ProjectDoc, ProjectRule, ProjectSkill } from "./types.js";

// ─── Types ───

export type ConflictStrategy = "rename" | "overwrite" | "skip";

export type ResourceType = "docs" | "rules" | "skills";

export interface ImportPreviewItem {
  /** Resource ID from export */
  id: string;
  /** Resource name (doc.name, rule.title, skill.name) */
  name: string;
  /** Resource type */
  type: "doc" | "rule" | "skill";
  /** Whether this resource conflicts with existing */
  hasConflict: boolean;
  /** Existing resource ID if conflict */
  existingId?: string;
}

export interface ImportPreviewStats {
  total: number;
  new: number;
  conflict: number;
}

export interface ImportPreviewResult {
  stats: {
    docs: ImportPreviewStats;
    rules: ImportPreviewStats;
    skills: ImportPreviewStats;
  };
  resources: {
    docs: ImportPreviewItem[];
    rules: ImportPreviewItem[];
    skills: ImportPreviewItem[];
  };
}

export interface ImportProjectResourcesOptions {
  /** Project ID */
  projectId: string;
  /** Base64-encoded ZIP data */
  data: string;
  /** Conflict handling strategy */
  conflictStrategy: ConflictStrategy;
  /** Resource types to import (optional, imports all if not provided) */
  resourceTypes?: ResourceType[];
}

export interface ImportProjectResourcesResult {
  imported: {
    docs: number;
    rules: number;
    skills: number;
  };
  skipped: {
    docs: number;
    rules: number;
    skills: number;
  };
  errors: Array<{
    type: "doc" | "rule" | "skill";
    name: string;
    reason: string;
  }>;
}

// ─── Internal Types ───

interface ParsedDoc {
  id: string;
  name: string;
  content: string;
  createdAt?: number;
  updatedAt?: number;
}

interface ParsedRule {
  id: string;
  title: string;
  content: string;
  createdAt?: number;
  updatedAt?: number;
}

interface ParsedSkill {
  id: string;
  name: string;
  content: string;
  createdAt?: number;
  updatedAt?: number;
}

interface ParsedResources {
  docs: ParsedDoc[];
  rules: ParsedRule[];
  skills: ParsedSkill[];
}

// ─── Constants ───

const MAX_IMPORT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_RESOURCE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per resource

// ─── Validation ───

/**
 * Validate resource size
 */
function validateResourceSize(content: string, name: string, type: ResourceType): void {
  const size = Buffer.byteLength(content, "utf-8");
  if (size > MAX_RESOURCE_SIZE_BYTES) {
    const typeLabel = type === "docs" ? "Document" : type === "rules" ? "Rule" : "Skill";
    throw new Error(
      `${typeLabel} "${name}" exceeds size limit (${Math.floor(size / 1024 / 1024)}MB > 50MB)`,
    );
  }
}

// ─── ZIP Parsing ───

/**
 * Parse resources from manifest-based ZIP (new format)
 */
async function parseManifestZip(zip: JSZip): Promise<ParsedResources> {
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("manifest.json not found in ZIP");
  }

  const manifestContent = await manifestFile.async("string");
  const manifest: Manifest = JSON.parse(manifestContent);

  const resources: ParsedResources = {
    docs: [],
    rules: [],
    skills: [],
  };

  // Parse docs
  for (const docMeta of manifest.resources.docs) {
    const mdFile = zip.file(`docs/${docMeta.id}.md`);
    if (!mdFile) {
      continue; // Skip if content file missing
    }

    const content = await mdFile.async("string");
    validateResourceSize(content, docMeta.name, "docs");

    resources.docs.push({
      id: docMeta.id,
      name: docMeta.name,
      content,
      createdAt: docMeta.createdAt,
    });
  }

  // Parse rules
  for (const ruleMeta of manifest.resources.rules) {
    const mdFile = zip.file(`rules/${ruleMeta.id}.md`);
    if (!mdFile) {
      continue;
    }

    const content = await mdFile.async("string");
    validateResourceSize(content, ruleMeta.name, "rules");

    resources.rules.push({
      id: ruleMeta.id,
      title: ruleMeta.name,
      content,
      createdAt: ruleMeta.createdAt,
    });
  }

  // Parse skills
  for (const skillMeta of manifest.resources.skills) {
    const mdFile = zip.file(`skills/${skillMeta.id}.md`);
    if (!mdFile) {
      continue;
    }

    const content = await mdFile.async("string");
    validateResourceSize(content, skillMeta.name, "skills");

    resources.skills.push({
      id: skillMeta.id,
      name: skillMeta.name,
      content,
      createdAt: skillMeta.createdAt,
    });
  }

  return resources;
}

/**
 * Parse resources from legacy docs-only ZIP (old format)
 */
async function parseLegacyDocsZip(zip: JSZip): Promise<ParsedResources> {
  const resources: ParsedResources = {
    docs: [],
    rules: [],
    skills: [],
  };

  // Try docs.json first
  const docsJsonFile = zip.file("docs.json");
  if (docsJsonFile) {
    const docsJsonContent = await docsJsonFile.async("string");
    const docsArray: Array<{ name: string; content: string }> = JSON.parse(docsJsonContent);

    for (const doc of docsArray) {
      if (!doc.name || typeof doc.name !== "string") {
        continue;
      }
      if (!doc.content || typeof doc.content !== "string") {
        continue;
      }

      validateResourceSize(doc.content, doc.name, "docs");

      resources.docs.push({
        id: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: doc.name.trim(),
        content: doc.content,
      });
    }

    return resources;
  }

  // Try markdown/ folder
  const markdownFolder = zip.folder("markdown");
  if (markdownFolder) {
    const mdFiles = markdownFolder.file(/\.md$/);
    if (mdFiles.length > 0) {
      for (const file of mdFiles) {
        const filename = file.name.replace(/^markdown\//, "");
        const name = filename.replace(/\.md$/, "");
        const content = await file.async("string");

        validateResourceSize(content, name, "docs");

        resources.docs.push({
          id: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name,
          content,
        });
      }

      return resources;
    }
  }

  throw new Error("ZIP must contain either manifest.json, docs.json, or markdown/ folder");
}

/**
 * Parse ZIP and extract all resources
 */
async function parseImportZip(data: string): Promise<ParsedResources> {
  // Decode base64
  const buffer = Buffer.from(data, "base64");
  if (buffer.byteLength > MAX_IMPORT_SIZE_BYTES) {
    throw new Error(
      `Import data exceeds size limit (${Math.floor(buffer.byteLength / 1024 / 1024)}MB > 100MB)`,
    );
  }

  // Load ZIP
  const zip = await JSZip.loadAsync(buffer);

  // Try manifest.json first (new format)
  const manifestFile = zip.file("manifest.json");
  if (manifestFile) {
    return parseManifestZip(zip);
  }

  // Fall back to legacy docs-only format
  return parseLegacyDocsZip(zip);
}

// ─── Conflict Detection ───

/**
 * Build name maps for conflict detection
 */
function buildNameMaps(projectId: string): {
  docsByName: Map<string, ProjectDoc>;
  rulesByTitle: Map<string, ProjectRule>;
  skillsByName: Map<string, ProjectSkill>;
} {
  const docs = loadProjectDocs(projectId);
  const rules = loadProjectRules(projectId);
  const skills = loadProjectSkills(projectId);

  const docsByName = new Map<string, ProjectDoc>();
  for (const doc of docs) {
    docsByName.set(doc.name, doc);
  }

  const rulesByTitle = new Map<string, ProjectRule>();
  for (const rule of rules) {
    rulesByTitle.set(rule.title, rule);
  }

  const skillsByName = new Map<string, ProjectSkill>();
  for (const skill of skills) {
    skillsByName.set(skill.name, skill);
  }

  return { docsByName, rulesByTitle, skillsByName };
}

// ─── Preview Import ───

/**
 * Preview import without actually importing
 */
export async function previewImportResources(
  projectId: string,
  data: string,
): Promise<ImportPreviewResult> {
  // Validate project exists
  const meta = loadProjectMeta(projectId);
  if (!meta) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Parse ZIP
  const parsed = await parseImportZip(data);

  // Build name maps for conflict detection
  const { docsByName, rulesByTitle, skillsByName } = buildNameMaps(projectId);

  // Build preview for docs
  const docsPreview: ImportPreviewItem[] = parsed.docs.map((doc) => {
    const existing = docsByName.get(doc.name);
    return {
      id: doc.id,
      name: doc.name,
      type: "doc" as const,
      hasConflict: !!existing,
      existingId: existing?.id,
    };
  });

  // Build preview for rules
  const rulesPreview: ImportPreviewItem[] = parsed.rules.map((rule) => {
    const existing = rulesByTitle.get(rule.title);
    return {
      id: rule.id,
      name: rule.title,
      type: "rule" as const,
      hasConflict: !!existing,
      existingId: existing?.id,
    };
  });

  // Build preview for skills
  const skillsPreview: ImportPreviewItem[] = parsed.skills.map((skill) => {
    const existing = skillsByName.get(skill.name);
    return {
      id: skill.id,
      name: skill.name,
      type: "skill" as const,
      hasConflict: !!existing,
      existingId: existing?.id,
    };
  });

  // Calculate stats
  const docsStats: ImportPreviewStats = {
    total: docsPreview.length,
    new: docsPreview.filter((d) => !d.hasConflict).length,
    conflict: docsPreview.filter((d) => d.hasConflict).length,
  };

  const rulesStats: ImportPreviewStats = {
    total: rulesPreview.length,
    new: rulesPreview.filter((r) => !r.hasConflict).length,
    conflict: rulesPreview.filter((r) => r.hasConflict).length,
  };

  const skillsStats: ImportPreviewStats = {
    total: skillsPreview.length,
    new: skillsPreview.filter((s) => !s.hasConflict).length,
    conflict: skillsPreview.filter((s) => s.hasConflict).length,
  };

  return {
    stats: {
      docs: docsStats,
      rules: rulesStats,
      skills: skillsStats,
    },
    resources: {
      docs: docsPreview,
      rules: rulesPreview,
      skills: skillsPreview,
    },
  };
}

// ─── Import Functions ───

/**
 * Generate unique name with suffix
 */
function generateUniqueName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let counter = 1;
  let uniqueName = `${baseName}-${counter}`;
  while (existingNames.has(uniqueName)) {
    counter++;
    uniqueName = `${baseName}-${counter}`;
  }

  return uniqueName;
}

/**
 * Import docs
 */
async function importDocs(
  projectId: string,
  docs: ParsedDoc[],
  conflictStrategy: ConflictStrategy,
  nameMap: Map<string, ProjectDoc>,
): Promise<{ imported: number; skipped: number; errors: ImportProjectResourcesResult["errors"] }> {
  const result = { imported: 0, skipped: 0, errors: [] as ImportProjectResourcesResult["errors"] };

  for (const doc of docs) {
    const existing = nameMap.get(doc.name);

    if (existing) {
      switch (conflictStrategy) {
        case "skip":
          result.skipped++;
          continue;

        case "overwrite":
          try {
            await updateProjectDoc(projectId, existing.id, { content: doc.content });
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              type: "doc",
              name: doc.name,
              reason: `Failed to overwrite: ${msg}`,
            });
          }
          continue;

        case "rename": {
          const existingNames = new Set(nameMap.keys());
          const uniqueName = generateUniqueName(doc.name, existingNames);
          try {
            const newDoc = await createProjectDoc(projectId, {
              name: uniqueName,
              content: doc.content,
            });
            nameMap.set(uniqueName, newDoc);
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              type: "doc",
              name: doc.name,
              reason: `Failed to create with renamed: ${msg}`,
            });
          }
          continue;
        }
      }
    }

    // No conflict - create new
    try {
      const newDoc = await createProjectDoc(projectId, { name: doc.name, content: doc.content });
      nameMap.set(doc.name, newDoc);
      result.imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ type: "doc", name: doc.name, reason: `Failed to create: ${msg}` });
    }
  }

  return result;
}

/**
 * Import rules
 */
async function importRules(
  projectId: string,
  rules: ParsedRule[],
  conflictStrategy: ConflictStrategy,
  titleMap: Map<string, ProjectRule>,
): Promise<{ imported: number; skipped: number; errors: ImportProjectResourcesResult["errors"] }> {
  const result = { imported: 0, skipped: 0, errors: [] as ImportProjectResourcesResult["errors"] };

  for (const rule of rules) {
    const existing = titleMap.get(rule.title);

    if (existing) {
      switch (conflictStrategy) {
        case "skip":
          result.skipped++;
          continue;

        case "overwrite":
          try {
            await updateProjectRule(projectId, existing.id, { content: rule.content });
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              type: "rule",
              name: rule.title,
              reason: `Failed to overwrite: ${msg}`,
            });
          }
          continue;

        case "rename": {
          const existingTitles = new Set(titleMap.keys());
          const uniqueTitle = generateUniqueName(rule.title, existingTitles);
          try {
            const newRule = await createProjectRule(projectId, {
              title: uniqueTitle,
              content: rule.content,
            });
            titleMap.set(uniqueTitle, newRule);
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              type: "rule",
              name: rule.title,
              reason: `Failed to create with renamed: ${msg}`,
            });
          }
          continue;
        }
      }
    }

    // No conflict - create new
    try {
      const newRule = await createProjectRule(projectId, {
        title: rule.title,
        content: rule.content,
      });
      titleMap.set(rule.title, newRule);
      result.imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ type: "rule", name: rule.title, reason: `Failed to create: ${msg}` });
    }
  }

  return result;
}

/**
 * Import skills
 */
async function importSkills(
  projectId: string,
  skills: ParsedSkill[],
  conflictStrategy: ConflictStrategy,
  nameMap: Map<string, ProjectSkill>,
): Promise<{ imported: number; skipped: number; errors: ImportProjectResourcesResult["errors"] }> {
  const result = { imported: 0, skipped: 0, errors: [] as ImportProjectResourcesResult["errors"] };

  for (const skill of skills) {
    const existing = nameMap.get(skill.name);

    if (existing) {
      switch (conflictStrategy) {
        case "skip":
          result.skipped++;
          continue;

        case "overwrite":
          try {
            await updateProjectSkill(projectId, existing.id, { content: skill.content });
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              type: "skill",
              name: skill.name,
              reason: `Failed to overwrite: ${msg}`,
            });
          }
          continue;

        case "rename": {
          const existingNames = new Set(nameMap.keys());
          const uniqueName = generateUniqueName(skill.name, existingNames);
          try {
            const newSkill = await createProjectSkill(projectId, {
              name: uniqueName,
              content: skill.content,
            });
            nameMap.set(uniqueName, newSkill);
            result.imported++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              type: "skill",
              name: skill.name,
              reason: `Failed to create with renamed: ${msg}`,
            });
          }
          continue;
        }
      }
    }

    // No conflict - create new
    try {
      const newSkill = await createProjectSkill(projectId, {
        name: skill.name,
        content: skill.content,
      });
      nameMap.set(skill.name, newSkill);
      result.imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ type: "skill", name: skill.name, reason: `Failed to create: ${msg}` });
    }
  }

  return result;
}

// ─── Main Import Function ───

/**
 * Import project resources from ZIP
 */
export async function importProjectResources(
  options: ImportProjectResourcesOptions,
): Promise<ImportProjectResourcesResult> {
  const { projectId, data, conflictStrategy, resourceTypes } = options;

  // Validate project exists
  const meta = loadProjectMeta(projectId);
  if (!meta) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Parse ZIP
  const parsed = await parseImportZip(data);

  // Determine which types to import
  const shouldImportDocs = !resourceTypes || resourceTypes.includes("docs");
  const shouldImportRules = !resourceTypes || resourceTypes.includes("rules");
  const shouldImportSkills = !resourceTypes || resourceTypes.includes("skills");

  // Build name maps
  const { docsByName, rulesByTitle, skillsByName } = buildNameMaps(projectId);

  // Initialize result
  const result: ImportProjectResourcesResult = {
    imported: { docs: 0, rules: 0, skills: 0 },
    skipped: { docs: 0, rules: 0, skills: 0 },
    errors: [],
  };

  // Import docs
  if (shouldImportDocs && parsed.docs.length > 0) {
    const docsResult = await importDocs(projectId, parsed.docs, conflictStrategy, docsByName);
    result.imported.docs = docsResult.imported;
    result.skipped.docs = docsResult.skipped;
    result.errors.push(...docsResult.errors);
  }

  // Import rules
  if (shouldImportRules && parsed.rules.length > 0) {
    const rulesResult = await importRules(projectId, parsed.rules, conflictStrategy, rulesByTitle);
    result.imported.rules = rulesResult.imported;
    result.skipped.rules = rulesResult.skipped;
    result.errors.push(...rulesResult.errors);
  }

  // Import skills
  if (shouldImportSkills && parsed.skills.length > 0) {
    const skillsResult = await importSkills(
      projectId,
      parsed.skills,
      conflictStrategy,
      skillsByName,
    );
    result.imported.skills = skillsResult.imported;
    result.skipped.skills = skillsResult.skipped;
    result.errors.push(...skillsResult.errors);
  }

  return result;
}
