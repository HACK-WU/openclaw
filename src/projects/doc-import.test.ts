/**
 * Tests for Project Document Import
 */

import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importProjectDocs, previewImportDocs } from "./doc-import.js";
import { createProjectDoc, loadProjectDocs, loadProjectMeta } from "./project-store.js";

// Mock project-store
vi.mock("./project-store.js", () => ({
  loadProjectMeta: vi.fn(),
  loadProjectDocs: vi.fn(),
  createProjectDoc: vi.fn(),
}));

describe("importProjectDocs", () => {
  const mockProjectId = "test-project-id";

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(loadProjectMeta).mockReturnValue({
      id: mockProjectId,
      name: "Test Project",
      directory: "/test/project",
      documents: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    vi.mocked(loadProjectDocs).mockReturnValue([]);

    vi.mocked(createProjectDoc).mockImplementation(async (projectId, params) => ({
      id: `doc-${params.name}`,
      projectId,
      name: params.name,
      content: params.content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  });

  describe("JSON format", () => {
    it("should import documents from JSON array", async () => {
      const docs = [
        { name: "Doc 1", content: "Content 1" },
        { name: "Doc 2", content: "Content 2" },
      ];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
      });

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.importedDocIds).toHaveLength(2);
      expect(createProjectDoc).toHaveBeenCalledTimes(2);
    });

    it("should validate document structure", async () => {
      const docs = [
        { name: "Valid Doc", content: "Valid content" },
        { name: "", content: "Empty name" }, // Invalid
        { content: "Missing name" }, // Invalid
      ];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
      });

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].reason).toContain("invalid name");
    });

    it("should reject oversized documents", async () => {
      const largeContent = "x".repeat(51 * 1024 * 1024); // 51MB
      const docs = [{ name: "Large Doc", content: largeContent }];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
      });

      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toContain("exceeds size limit");
    });

    it("should reject oversized import data", async () => {
      // Create a large valid JSON array that exceeds size limit
      // 150KB * 1000 = 150MB, base64 encoding adds ~33% = ~200MB
      const largeDocs = Array(1000).fill({ name: "Doc", content: "x".repeat(150 * 1024) });
      const jsonData = JSON.stringify(largeDocs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      await expect(
        importProjectDocs({
          projectId: mockProjectId,
          data: base64Data,
          format: "json",
        }),
      ).rejects.toThrow("exceeds size limit");
    });

    it("should reject invalid JSON", async () => {
      const base64Data = Buffer.from("not valid json").toString("base64");

      await expect(
        importProjectDocs({
          projectId: mockProjectId,
          data: base64Data,
          format: "json",
        }),
      ).rejects.toThrow("Invalid JSON format");
    });

    it("should reject non-array JSON", async () => {
      const jsonData = JSON.stringify({ name: "Doc", content: "Content" });
      const base64Data = Buffer.from(jsonData).toString("base64");

      await expect(
        importProjectDocs({
          projectId: mockProjectId,
          data: base64Data,
          format: "json",
        }),
      ).rejects.toThrow("must contain an array");
    });
  });

  describe("ZIP format", () => {
    it("should import from ZIP with docs.json", async () => {
      const docs = [
        { name: "Doc 1", content: "Content 1" },
        { name: "Doc 2", content: "Content 2" },
      ];

      const zip = new JSZip();
      zip.file("README.md", "# Export");
      zip.file("docs.json", JSON.stringify(docs));
      zip.folder("markdown")?.file("doc-1.md", "Content 1");

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Data = zipBuffer.toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "zip",
      });

      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it("should import from ZIP with markdown folder (fallback)", async () => {
      const zip = new JSZip();
      zip.file("README.md", "# Export");
      const mdFolder = zip.folder("markdown");
      if (mdFolder) {
        mdFolder.file("doc-1.md", "Content 1");
        mdFolder.file("doc-2.md", "Content 2");
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Data = zipBuffer.toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "zip",
      });

      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject ZIP without docs.json or markdown folder", async () => {
      const zip = new JSZip();
      zip.file("README.md", "# Export");
      // No docs.json and no markdown folder

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Data = zipBuffer.toString("base64");

      await expect(
        importProjectDocs({
          projectId: mockProjectId,
          data: base64Data,
          format: "zip",
        }),
      ).rejects.toThrow("No markdown files found");
    });

    it("should reject ZIP with empty markdown folder", async () => {
      const zip = new JSZip();
      zip.folder("markdown"); // Empty folder

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Data = zipBuffer.toString("base64");

      await expect(
        importProjectDocs({
          projectId: mockProjectId,
          data: base64Data,
          format: "zip",
        }),
      ).rejects.toThrow("No markdown files found");
    });
  });

  describe("Conflict handling", () => {
    it("should skip conflicting docs with 'skip' strategy", async () => {
      // Existing doc
      vi.mocked(loadProjectDocs).mockReturnValue([
        {
          id: "existing-doc-1",
          projectId: mockProjectId,
          name: "Doc 1",
          content: "Existing content",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      const docs = [
        { name: "Doc 1", content: "New content" }, // Conflict
        { name: "Doc 2", content: "Content 2" }, // New
      ];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
        conflictStrategy: "skip",
      });

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(createProjectDoc).toHaveBeenCalledTimes(1);
      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 2",
        content: "Content 2",
      });
    });

    it("should overwrite conflicting docs with 'overwrite' strategy", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        {
          id: "existing-doc-1",
          projectId: mockProjectId,
          name: "Doc 1",
          content: "Existing content",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      const docs = [{ name: "Doc 1", content: "New content" }];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
        conflictStrategy: "overwrite",
      });

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(createProjectDoc).toHaveBeenCalledTimes(1);
      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 1",
        content: "New content",
      });
    });

    it("should rename conflicting docs with 'rename' strategy", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        {
          id: "existing-doc-1",
          projectId: mockProjectId,
          name: "Doc 1",
          content: "Existing content",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      const docs = [{ name: "Doc 1", content: "New content" }];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
        conflictStrategy: "rename",
      });

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(createProjectDoc).toHaveBeenCalledTimes(1);
      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 1-1",
        content: "New content",
      });
    });

    it("should handle multiple conflicts with rename", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        {
          id: "existing-doc-1",
          projectId: mockProjectId,
          name: "Doc 1",
          content: "Existing",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: "existing-doc-1-1",
          projectId: mockProjectId,
          name: "Doc 1-1",
          content: "Existing",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      const docs = [{ name: "Doc 1", content: "New content" }];

      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      const result = await importProjectDocs({
        projectId: mockProjectId,
        data: base64Data,
        format: "json",
        conflictStrategy: "rename",
      });

      expect(result.imported).toBe(1);
      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 1-2",
        content: "New content",
      });
    });
  });

  describe("Project validation", () => {
    it("should reject non-existent project", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(null);

      const docs = [{ name: "Doc", content: "Content" }];
      const jsonData = JSON.stringify(docs);
      const base64Data = Buffer.from(jsonData).toString("base64");

      await expect(
        importProjectDocs({
          projectId: "non-existent",
          data: base64Data,
          format: "json",
        }),
      ).rejects.toThrow("not found");
    });
  });
});

describe("previewImportDocs", () => {
  const mockProjectId = "test-project-id";

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadProjectDocs).mockReturnValue([]);
  });

  it("should preview JSON import", async () => {
    const docs = [
      { name: "Doc 1", content: "Content 1" },
      { name: "Doc 2", content: "Content 2" },
    ];

    const jsonData = JSON.stringify(docs);
    const base64Data = Buffer.from(jsonData).toString("base64");

    const preview = await previewImportDocs(base64Data, "json", mockProjectId);

    expect(preview).toHaveLength(2);
    expect(preview[0].name).toBe("Doc 1");
    expect(preview[0].contentPreview).toBe("Content 1");
    expect(preview[0].hasConflict).toBe(false);
  });

  it("should preview ZIP import with docs.json", async () => {
    const docs = [{ name: "Doc 1", content: "Content 1" }];

    const zip = new JSZip();
    zip.file("docs.json", JSON.stringify(docs));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const base64Data = zipBuffer.toString("base64");

    const preview = await previewImportDocs(base64Data, "zip", mockProjectId);

    expect(preview).toHaveLength(1);
    expect(preview[0].name).toBe("Doc 1");
  });

  it("should preview ZIP import with markdown folder", async () => {
    const zip = new JSZip();
    const mdFolder = zip.folder("markdown");
    if (mdFolder) {
      mdFolder.file("doc-1.md", "Content 1");
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const base64Data = zipBuffer.toString("base64");

    const preview = await previewImportDocs(base64Data, "zip", mockProjectId);

    expect(preview).toHaveLength(1);
    expect(preview[0].name).toBe("doc-1");
    expect(preview[0].contentPreview).toBe("Content 1");
  });

  it("should detect conflicts in preview", async () => {
    vi.mocked(loadProjectDocs).mockReturnValue([
      {
        id: "existing-doc",
        projectId: mockProjectId,
        name: "Doc 1",
        content: "Existing",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    const docs = [{ name: "Doc 1", content: "New content" }];

    const jsonData = JSON.stringify(docs);
    const base64Data = Buffer.from(jsonData).toString("base64");

    const preview = await previewImportDocs(base64Data, "json", mockProjectId);

    expect(preview).toHaveLength(1);
    expect(preview[0].hasConflict).toBe(true);
    expect(preview[0].existingDocId).toBe("existing-doc");
  });

  it("should truncate long content in preview", async () => {
    const longContent = "x".repeat(500);
    const docs = [{ name: "Doc", content: longContent }];

    const jsonData = JSON.stringify(docs);
    const base64Data = Buffer.from(jsonData).toString("base64");

    const preview = await previewImportDocs(base64Data, "json", mockProjectId);

    expect(preview[0].contentPreview.length).toBe(200);
  });
});
