/**
 * Project Document Import
 *
 * Import project documents from ZIP or JSON format.
 */

import JSZip from "jszip";
import { createProjectDoc, loadProjectDocs, loadProjectMeta } from "./project-store.js";
import type { ProjectDoc } from "./types.js";

// ─── Types ───

export type ConflictStrategy = "skip" | "overwrite" | "rename";

export interface DocImportOptions {
  /** Project ID */
  projectId: string;
  /** Base64-encoded data */
  data: string;
  /** Import format */
  format: "zip" | "json";
  /** Conflict handling strategy (default: "rename") */
  conflictStrategy?: ConflictStrategy;
}

export interface DocImportResult {
  /** Number of successfully imported documents */
  imported: number;
  /** Number of skipped documents */
  skipped: number;
  /** Import errors */
  errors: Array<{ name: string; reason: string }>;
  /** Imported document IDs */
  importedDocIds: string[];
}

export interface ImportPreviewDoc {
  /** Document name */
  name: string;
  /** Document content preview (truncated) */
  contentPreview: string;
  /** Whether this doc conflicts with existing */
  hasConflict: boolean;
  /** Existing doc ID if conflict */
  existingDocId?: string;
}

// ─── Constants ───

const MAX_IMPORT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_DOC_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per doc
const PREVIEW_LENGTH = 200;

// ─── Validation ───

/**
 * Validate imported document data
 */
function validateImportedDoc(
  doc: unknown,
  index: number,
): { valid: true; data: Partial<ProjectDoc> } | { valid: false; error: string } {
  if (!doc || typeof doc !== "object") {
    return { valid: false, error: `Document at index ${index} is not an object` };
  }

  const obj = doc as Record<string, unknown>;

  // Required fields
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    return { valid: false, error: `Document at index ${index} has invalid name` };
  }

  if (typeof obj.content !== "string") {
    return { valid: false, error: `Document at index ${index} has invalid content` };
  }

  // Size check
  const contentSize = Buffer.byteLength(obj.content, "utf-8");
  if (contentSize > MAX_DOC_SIZE_BYTES) {
    return {
      valid: false,
      error: `Document "${obj.name}" exceeds size limit (${Math.floor(contentSize / 1024 / 1024)}MB > 50MB)`,
    };
  }

  return {
    valid: true,
    data: {
      name: obj.name.trim(),
      content: obj.content,
      // Preserve timestamps if available
      createdAt: typeof obj.createdAt === "number" ? obj.createdAt : undefined,
      updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : undefined,
    },
  };
}

// ─── Import functions ───

/**
 * Import documents from JSON format
 */
async function importFromJson(options: DocImportOptions): Promise<DocImportResult> {
  const { projectId, data, conflictStrategy = "rename" } = options;

  // Decode base64
  const buffer = Buffer.from(data, "base64");
  if (buffer.byteLength > MAX_IMPORT_SIZE_BYTES) {
    throw new Error(
      `Import data exceeds size limit (${Math.floor(buffer.byteLength / 1024 / 1024)}MB > 100MB)`,
    );
  }

  // Parse JSON
  let docsArray: unknown;
  try {
    docsArray = JSON.parse(buffer.toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON format");
  }

  // Validate array
  if (!Array.isArray(docsArray)) {
    throw new Error("JSON must contain an array of documents");
  }

  // Load existing docs for conflict detection
  const existingDocs = loadProjectDocs(projectId);
  const existingByName = new Map<string, ProjectDoc>();
  for (const doc of existingDocs) {
    existingByName.set(doc.name, doc);
  }

  // Import documents
  const result: DocImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    importedDocIds: [],
  };

  for (let i = 0; i < docsArray.length; i++) {
    const validation = validateImportedDoc(docsArray[i], i);
    if (!validation.valid) {
      result.errors.push({ name: `index-${i}`, reason: validation.error });
      continue;
    }

    const docData = validation.data;
    const existingDoc = existingByName.get(docData.name!);

    // Handle conflicts
    if (existingDoc) {
      switch (conflictStrategy) {
        case "skip":
          result.skipped++;
          continue;

        case "overwrite":
          // Delete existing doc and create new one (preserves new content)
          // Note: We create a new doc with new ID to avoid timestamp issues
          try {
            const newDoc = await createProjectDoc(projectId, {
              name: docData.name!,
              content: docData.content!,
            });
            result.imported++;
            result.importedDocIds.push(newDoc.id);
            // Update map to reflect new state
            existingByName.set(docData.name!, newDoc);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({ name: docData.name!, reason: `Failed to overwrite: ${msg}` });
          }
          continue;

        case "rename":
          // Generate unique name
          let uniqueName = docData.name!;
          let counter = 1;
          while (existingByName.has(uniqueName)) {
            uniqueName = `${docData.name!}-${counter}`;
            counter++;
          }

          try {
            const newDoc = await createProjectDoc(projectId, {
              name: uniqueName,
              content: docData.content!,
            });
            result.imported++;
            result.importedDocIds.push(newDoc.id);
            existingByName.set(uniqueName, newDoc);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({
              name: docData.name!,
              reason: `Failed to import with renamed: ${msg}`,
            });
          }
          continue;
      }
    }

    // No conflict - create new doc
    try {
      const newDoc = await createProjectDoc(projectId, {
        name: docData.name!,
        content: docData.content!,
      });
      result.imported++;
      result.importedDocIds.push(newDoc.id);
      existingByName.set(docData.name!, newDoc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ name: docData.name!, reason: `Failed to create: ${msg}` });
    }
  }

  return result;
}

/**
 * Import documents from ZIP format
 */
async function importFromZip(options: DocImportOptions): Promise<DocImportResult> {
  const { projectId, data, conflictStrategy = "rename" } = options;

  // Decode base64
  const buffer = Buffer.from(data, "base64");
  if (buffer.byteLength > MAX_IMPORT_SIZE_BYTES) {
    throw new Error(
      `Import data exceeds size limit (${Math.floor(buffer.byteLength / 1024 / 1024)}MB > 100MB)`,
    );
  }

  // Load ZIP
  const zip = await JSZip.loadAsync(buffer);

  // Try to find docs.json (preferred source)
  const docsJsonFile = zip.file("docs.json");
  if (docsJsonFile) {
    const docsJsonContent = await docsJsonFile.async("string");
    return importFromJson({
      projectId,
      data: Buffer.from(docsJsonContent).toString("base64"),
      format: "json",
      conflictStrategy,
    });
  }

  // Fallback: parse markdown folder
  const markdownFolder = zip.folder("markdown");
  if (!markdownFolder || markdownFolder.length === 0) {
    throw new Error("ZIP must contain either docs.json or markdown/ folder with .md files");
  }

  // Extract markdown files
  const docs: Array<{ name: string; content: string }> = [];
  const files = markdownFolder.file(/\.md$/);

  for (const file of files) {
    const filename = file.name.replace(/^markdown\//, "");
    const name = filename.replace(/\.md$/, "");
    const content = await file.async("string");

    docs.push({ name, content });
  }

  if (docs.length === 0) {
    throw new Error("No markdown files found in ZIP");
  }

  // Import as JSON
  return importFromJson({
    projectId,
    data: Buffer.from(JSON.stringify(docs)).toString("base64"),
    format: "json",
    conflictStrategy,
  });
}

/**
 * Import project documents
 */
export async function importProjectDocs(options: DocImportOptions): Promise<DocImportResult> {
  const { projectId, format } = options;

  // Validate project exists
  const meta = loadProjectMeta(projectId);
  if (!meta) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Import based on format
  if (format === "json") {
    return importFromJson(options);
  } else {
    return importFromZip(options);
  }
}

/**
 * Preview import documents (parse without importing)
 */
export async function previewImportDocs(
  data: string,
  format: "zip" | "json",
  projectId: string,
): Promise<ImportPreviewDoc[]> {
  // Decode base64
  const buffer = Buffer.from(data, "base64");

  let docs: Array<{ name: string; content: string }>;

  if (format === "json") {
    const jsonData = JSON.parse(buffer.toString("utf-8"));
    if (!Array.isArray(jsonData)) {
      throw new Error("JSON must contain an array of documents");
    }

    docs = jsonData.map((doc) => ({
      name: doc.name ?? "unnamed",
      content: doc.content ?? "",
    }));
  } else {
    // ZIP format
    const zip = await JSZip.loadAsync(buffer);

    // Try docs.json first
    const docsJsonFile = zip.file("docs.json");
    if (docsJsonFile) {
      const docsJsonContent = await docsJsonFile.async("string");
      const jsonData = JSON.parse(docsJsonContent);
      if (!Array.isArray(jsonData)) {
        throw new Error("docs.json must contain an array of documents");
      }
      docs = jsonData.map((doc) => ({
        name: doc.name ?? "unnamed",
        content: doc.content ?? "",
      }));
    } else {
      // Parse markdown folder
      const markdownFolder = zip.folder("markdown");
      if (!markdownFolder) {
        throw new Error("ZIP must contain either docs.json or markdown/ folder");
      }

      docs = [];
      const files = markdownFolder.file(/\.md$/);
      for (const file of files) {
        const filename = file.name.replace(/^markdown\//, "");
        const name = filename.replace(/\.md$/, "");
        const content = await file.async("string");
        docs.push({ name, content });
      }
    }
  }

  // Load existing docs for conflict detection
  const existingDocs = loadProjectDocs(projectId);
  const existingByName = new Map<string, ProjectDoc>();
  for (const doc of existingDocs) {
    existingByName.set(doc.name, doc);
  }

  // Build preview
  return docs.map((doc) => {
    const existingDoc = existingByName.get(doc.name);
    const contentPreview = doc.content.slice(0, PREVIEW_LENGTH);

    return {
      name: doc.name,
      contentPreview,
      hasConflict: !!existingDoc,
      existingDocId: existingDoc?.id,
    };
  });
}
