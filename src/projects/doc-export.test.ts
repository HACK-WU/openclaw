import JSZip from "jszip";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { exportProjectDocs } from "./doc-export.js";
import { loadProjectDocs, loadProjectMeta } from "./project-store.js";
import type { ProjectDoc, Project } from "./types.js";

// Mock project-store functions
vi.mock("./project-store.js", () => ({
  loadProjectMeta: vi.fn(),
  loadProjectDocs: vi.fn(),
}));

// Helper to create mock project
function mockProject(id: string, name: string): Project {
  return {
    id,
    name,
    directory: "/tmp/test-project",
    documents: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Helper to create mock document
function mockDoc(id: string, projectId: string, name: string, content: string): ProjectDoc {
  return {
    id,
    projectId,
    name,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("exportProjectDocs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("error cases", () => {
    it("throws when project not found", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(null);

      await expect(exportProjectDocs({ projectId: "nonexistent" })).rejects.toThrow(
        "Project nonexistent not found",
      );
    });

    it("throws when project has no documents", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([]);

      await expect(exportProjectDocs({ projectId: "p1" })).rejects.toThrow(
        "Project p1 has no documents",
      );
    });

    it("throws when docIds filter results in empty", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([mockDoc("d1", "p1", "Doc 1", "Content 1")]);

      await expect(exportProjectDocs({ projectId: "p1", docIds: ["nonexistent"] })).rejects.toThrow(
        "No matching documents found for provided docIds",
      );
    });

    it("throws when document exceeds size limit", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      const largeContent = "x".repeat(51 * 1024 * 1024); // 51MB
      vi.mocked(loadProjectDocs).mockReturnValue([mockDoc("d1", "p1", "Large Doc", largeContent)]);

      await expect(exportProjectDocs({ projectId: "p1" })).rejects.toThrow(/exceeds size limit/);
    });
  });

  describe("JSON format", () => {
    it("exports all documents as JSON", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", "p1", "Doc 1", "Content 1"),
        mockDoc("d2", "p1", "Doc 2", "Content 2"),
      ]);

      const result = await exportProjectDocs({
        projectId: "p1",
        format: "json",
      });

      expect(result.filename).toMatch(/Test-Project-docs-\d{4}-\d{2}-\d{2}.json/);
      expect(result.contentType).toBe("application/json");
      expect(result.docCount).toBe(2);
      expect(result.docIds).toEqual(["d1", "d2"]);

      // Verify JSON content
      const decoded = Buffer.from(result.data, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("Doc 1");
    });

    it("exports filtered documents as JSON", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", "p1", "Doc 1", "Content 1"),
        mockDoc("d2", "p1", "Doc 2", "Content 2"),
        mockDoc("d3", "p1", "Doc 3", "Content 3"),
      ]);

      const result = await exportProjectDocs({
        projectId: "p1",
        docIds: ["d1", "d3"],
        format: "json",
      });

      expect(result.docCount).toBe(2);
      expect(result.docIds).toEqual(["d1", "d3"]);

      const decoded = Buffer.from(result.data, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe("d1");
      expect(parsed[1].id).toBe("d3");
    });
  });

  describe("ZIP format", () => {
    it("exports all documents as ZIP with correct structure", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", "p1", "Doc 1", "Content 1"),
        mockDoc("d2", "p1", "Doc 2", "Content 2"),
      ]);

      const result = await exportProjectDocs({
        projectId: "p1",
        format: "zip",
      });

      expect(result.filename).toMatch(/Test-Project-docs-\d{4}-\d{2}-\d{2}.zip/);
      expect(result.contentType).toBe("application/zip");
      expect(result.docCount).toBe(2);
      expect(result.docIds).toEqual(["d1", "d2"]);

      // Verify ZIP content
      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check files exist
      expect(zip.file("README.md")).toBeDefined();
      expect(zip.file("docs.json")).toBeDefined();
      expect(zip.folder("markdown")).toBeDefined();

      // Check markdown files
      const readmeContent = await zip.file("README.md")!.async("text");
      expect(readmeContent).toContain("Test Project");
      expect(readmeContent).toContain("2 document(s)");

      const docsJsonContent = await zip.file("docs.json")!.async("text");
      const docsJson = JSON.parse(docsJsonContent);
      expect(docsJson).toHaveLength(2);

      // Check markdown folder files
      const markdownFolder = zip.folder("markdown");
      const markdownFiles = Object.keys(markdownFolder!.files).filter((f) => !f.endsWith("/"));
      expect(markdownFiles).toContain("markdown/Doc-1.md");
      expect(markdownFiles).toContain("markdown/Doc-2.md");
    });

    it("handles filename conflicts", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", "p1", "Same Name", "Content 1"),
        mockDoc("d2", "p1", "Same Name", "Content 2"),
        mockDoc("d3", "p1", "Same Name", "Content 3"),
      ]);

      const result = await exportProjectDocs({
        projectId: "p1",
        format: "zip",
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Get all files in the ZIP
      const allFiles = Object.keys(zip.files);
      const markdownFiles = allFiles.filter((f) => f.startsWith("markdown/") && !f.endsWith("/"));

      expect(markdownFiles).toContain("markdown/Same-Name.md");
      expect(markdownFiles).toContain("markdown/Same-Name-1.md");
      expect(markdownFiles).toContain("markdown/Same-Name-2.md");
    });

    it("sanitizes filenames with special characters", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", "p1", "Doc: With/Special*Chars", "Content"),
        mockDoc("d2", "p1", "", "Content"), // empty name
      ]);

      const result = await exportProjectDocs({
        projectId: "p1",
        format: "zip",
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Get all files in the ZIP
      const allFiles = Object.keys(zip.files);
      const markdownFiles = allFiles.filter((f) => f.startsWith("markdown/") && !f.endsWith("/"));

      // Should have sanitized filenames
      expect(markdownFiles).toContain("markdown/Doc-With-Special-Chars.md");
      expect(markdownFiles).toContain("markdown/untitled.md");
    });

    it("exports filtered documents as ZIP", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(mockProject("p1", "Test Project"));
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", "p1", "Doc 1", "Content 1"),
        mockDoc("d2", "p1", "Doc 2", "Content 2"),
        mockDoc("d3", "p1", "Doc 3", "Content 3"),
      ]);

      const result = await exportProjectDocs({
        projectId: "p1",
        docIds: ["d1", "d3"],
        format: "zip",
      });

      expect(result.docCount).toBe(2);
      expect(result.docIds).toEqual(["d1", "d3"]);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      const docsJsonContent = await zip.file("docs.json")!.async("text");
      const docsJson = JSON.parse(docsJsonContent);
      expect(docsJson).toHaveLength(2);
      expect(docsJson[0].id).toBe("d1");
      expect(docsJson[1].id).toBe("d3");
    });
  });
});
