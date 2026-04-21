/**
 * Tests for Project Resource Export
 */

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadProjectDocs,
  loadProjectMeta,
  loadProjectRules,
  loadProjectSkills,
} from "./project-store.js";
import { exportProjectResources } from "./resource-export.js";
import type { Project, ProjectDoc, ProjectRule, ProjectSkill } from "./types.js";

// Mock project-store functions
vi.mock("./project-store.js", () => ({
  loadProjectMeta: vi.fn(),
  loadProjectDocs: vi.fn(),
  loadProjectRules: vi.fn(),
  loadProjectSkills: vi.fn(),
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

// Helper to create mock rule
function mockRule(id: string, projectId: string, title: string, content: string): ProjectRule {
  return {
    id,
    projectId,
    title,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Helper to create mock skill
function mockSkill(id: string, projectId: string, name: string, content: string): ProjectSkill {
  return {
    id,
    projectId,
    name,
    content,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("exportProjectResources", () => {
  const mockProjectId = "test-project-id";

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(loadProjectMeta).mockReturnValue(mockProject(mockProjectId, "Test Project"));
    vi.mocked(loadProjectDocs).mockReturnValue([]);
    vi.mocked(loadProjectRules).mockReturnValue([]);
    vi.mocked(loadProjectSkills).mockReturnValue([]);
  });

  describe("error cases", () => {
    it("throws when project not found", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(null);

      await expect(
        exportProjectResources({
          projectId: "nonexistent",
          resourceTypes: ["docs"],
        }),
      ).rejects.toThrow("Project nonexistent not found");
    });

    it("throws when resourceTypes is empty", async () => {
      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: [],
        }),
      ).rejects.toThrow("At least one resource type must be specified");
    });

    it("throws when no resources found to export", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([]);
      vi.mocked(loadProjectRules).mockReturnValue([]);
      vi.mocked(loadProjectSkills).mockReturnValue([]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["docs", "rules", "skills"],
        }),
      ).rejects.toThrow("No resources found to export");
    });

    it("throws when docIds filter results in empty", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content 1"),
      ]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["docs"],
          docIds: ["nonexistent"],
        }),
      ).rejects.toThrow("No resources found to export");
    });

    it("throws when ruleIds filter results in empty", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Rule 1", "Content 1"),
      ]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["rules"],
          ruleIds: ["nonexistent"],
        }),
      ).rejects.toThrow("No resources found to export");
    });

    it("throws when skillIds filter results in empty", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Skill 1", "Content 1"),
      ]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["skills"],
          skillIds: ["nonexistent"],
        }),
      ).rejects.toThrow("No resources found to export");
    });

    it("throws when document exceeds size limit", async () => {
      const largeContent = "x".repeat(51 * 1024 * 1024); // 51MB
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Large Doc", largeContent),
      ]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["docs"],
        }),
      ).rejects.toThrow(/exceeds size limit/);
    });

    it("throws when rule exceeds size limit", async () => {
      const largeContent = "x".repeat(51 * 1024 * 1024); // 51MB
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Large Rule", largeContent),
      ]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["rules"],
        }),
      ).rejects.toThrow(/exceeds size limit/);
    });

    it("throws when skill exceeds size limit", async () => {
      const largeContent = "x".repeat(51 * 1024 * 1024); // 51MB
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Large Skill", largeContent),
      ]);

      await expect(
        exportProjectResources({
          projectId: mockProjectId,
          resourceTypes: ["skills"],
        }),
      ).rejects.toThrow(/exceeds size limit/);
    });
  });

  describe("export all resource types", () => {
    it("exports docs, rules, and skills together", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content 1"),
        mockDoc("d2", mockProjectId, "Doc 2", "Content 2"),
      ]);
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Rule 1", "Content 1"),
      ]);
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Skill 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs", "rules", "skills"],
      });

      expect(result.contentType).toBe("application/zip");
      expect(result.stats.docs).toBe(2);
      expect(result.stats.rules).toBe(1);
      expect(result.stats.skills).toBe(1);
      expect(result.stats.total).toBe(4);

      // Verify ZIP content
      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check manifest.json
      expect(zip.file("manifest.json")).toBeDefined();
      const manifestContent = await zip.file("manifest.json")!.async("text");
      const manifest = JSON.parse(manifestContent);
      expect(manifest.version).toBe("1.0");
      expect(manifest.projectId).toBe(mockProjectId);
      expect(manifest.projectName).toBe("Test Project");
      expect(manifest.stats.docs).toBe(2);
      expect(manifest.stats.rules).toBe(1);
      expect(manifest.stats.skills).toBe(1);
      expect(manifest.stats.total).toBe(4);

      // Check README.md
      expect(zip.file("README.md")).toBeDefined();
      const readmeContent = await zip.file("README.md")!.async("text");
      expect(readmeContent).toContain("Test Project");
      expect(readmeContent).toContain("4 resource(s)");
      expect(readmeContent).toContain("docs/: 2 document(s)");
      expect(readmeContent).toContain("rules/: 1 rule(s)");
      expect(readmeContent).toContain("skills/: 1 skill(s)");

      // Check docs folder
      const docsFolder = zip.folder("docs");
      expect(docsFolder).toBeDefined();
      expect(docsFolder!.file("d1.md")).toBeDefined();
      expect(docsFolder!.file("d1.json")).toBeDefined();
      expect(docsFolder!.file("d2.md")).toBeDefined();
      expect(docsFolder!.file("d2.json")).toBeDefined();

      // Check rules folder
      const rulesFolder = zip.folder("rules");
      expect(rulesFolder).toBeDefined();
      expect(rulesFolder!.file("r1.md")).toBeDefined();
      expect(rulesFolder!.file("r1.json")).toBeDefined();

      // Check skills folder
      const skillsFolder = zip.folder("skills");
      expect(skillsFolder).toBeDefined();
      expect(skillsFolder!.file("s1.md")).toBeDefined();
      expect(skillsFolder!.file("s1.json")).toBeDefined();
    });

    it("exports only docs", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs"],
      });

      expect(result.stats.docs).toBe(1);
      expect(result.stats.rules).toBe(0);
      expect(result.stats.skills).toBe(0);
      expect(result.stats.total).toBe(1);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check docs folder has files
      expect(zip.file("docs/d1.md")).toBeDefined();
      expect(zip.file("docs/d1.json")).toBeDefined();

      // Check rules and skills folders don't have files
      const allFiles = Object.keys(zip.files);
      const rulesFiles = allFiles.filter((f) => f.startsWith("rules/") && !f.endsWith("/"));
      const skillsFiles = allFiles.filter((f) => f.startsWith("skills/") && !f.endsWith("/"));

      expect(rulesFiles.length).toBe(0);
      expect(skillsFiles.length).toBe(0);

      // README should only mention docs
      const readmeContent = await zip.file("README.md")!.async("text");
      expect(readmeContent).toContain("docs/: 1 document(s)");
      expect(readmeContent).not.toContain("rules/:");
      expect(readmeContent).not.toContain("skills/:");
    });

    it("exports only rules", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Rule 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["rules"],
      });

      expect(result.stats.docs).toBe(0);
      expect(result.stats.rules).toBe(1);
      expect(result.stats.skills).toBe(0);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check rules folder has files
      expect(zip.file("rules/r1.md")).toBeDefined();
      expect(zip.file("rules/r1.json")).toBeDefined();

      // Check docs and skills folders don't have files
      const allFiles = Object.keys(zip.files);
      const docsFiles = allFiles.filter((f) => f.startsWith("docs/") && !f.endsWith("/"));
      const skillsFiles = allFiles.filter((f) => f.startsWith("skills/") && !f.endsWith("/"));

      expect(docsFiles.length).toBe(0);
      expect(skillsFiles.length).toBe(0);
    });

    it("exports only skills", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Skill 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["skills"],
      });

      expect(result.stats.docs).toBe(0);
      expect(result.stats.rules).toBe(0);
      expect(result.stats.skills).toBe(1);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check skills folder has files
      expect(zip.file("skills/s1.md")).toBeDefined();
      expect(zip.file("skills/s1.json")).toBeDefined();

      // Check docs and rules folders don't have files
      const allFiles = Object.keys(zip.files);
      const docsFiles = allFiles.filter((f) => f.startsWith("docs/") && !f.endsWith("/"));
      const rulesFiles = allFiles.filter((f) => f.startsWith("rules/") && !f.endsWith("/"));

      expect(docsFiles.length).toBe(0);
      expect(rulesFiles.length).toBe(0);
    });
  });

  describe("export filtered resources", () => {
    it("exports specific documents by ID", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content 1"),
        mockDoc("d2", mockProjectId, "Doc 2", "Content 2"),
        mockDoc("d3", mockProjectId, "Doc 3", "Content 3"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs"],
        docIds: ["d1", "d3"],
      });

      expect(result.stats.docs).toBe(2);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check specific files exist
      expect(zip.file("docs/d1.md")).toBeDefined();
      expect(zip.file("docs/d3.md")).toBeDefined();
      expect(zip.file("docs/d2.md")).toBeNull();
    });

    it("exports specific rules by ID", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Rule 1", "Content 1"),
        mockRule("r2", mockProjectId, "Rule 2", "Content 2"),
        mockRule("r3", mockProjectId, "Rule 3", "Content 3"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["rules"],
        ruleIds: ["r1", "r3"],
      });

      expect(result.stats.rules).toBe(2);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      expect(zip.file("rules/r1.md")).toBeDefined();
      expect(zip.file("rules/r3.md")).toBeDefined();
      expect(zip.file("rules/r2.md")).toBeNull();
    });

    it("exports specific skills by ID", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Skill 1", "Content 1"),
        mockSkill("s2", mockProjectId, "Skill 2", "Content 2"),
        mockSkill("s3", mockProjectId, "Skill 3", "Content 3"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["skills"],
        skillIds: ["s1", "s3"],
      });

      expect(result.stats.skills).toBe(2);

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      expect(zip.file("skills/s1.md")).toBeDefined();
      expect(zip.file("skills/s3.md")).toBeDefined();
      expect(zip.file("skills/s2.md")).toBeNull();
    });

    it("exports mixed resource types with specific IDs", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content 1"),
        mockDoc("d2", mockProjectId, "Doc 2", "Content 2"),
      ]);
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Rule 1", "Content 1"),
        mockRule("r2", mockProjectId, "Rule 2", "Content 2"),
      ]);
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Skill 1", "Content 1"),
        mockSkill("s2", mockProjectId, "Skill 2", "Content 2"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs", "rules", "skills"],
        docIds: ["d1"],
        ruleIds: ["r2"],
        skillIds: ["s1", "s2"],
      });

      expect(result.stats.docs).toBe(1);
      expect(result.stats.rules).toBe(1);
      expect(result.stats.skills).toBe(2);
      expect(result.stats.total).toBe(4);
    });
  });

  describe("ZIP file structure validation", () => {
    it("validates manifest.json structure", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs"],
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      const manifestContent = await zip.file("manifest.json")!.async("text");
      const manifest = JSON.parse(manifestContent);

      // Validate manifest structure
      expect(manifest.version).toBe("1.0");
      expect(typeof manifest.exportedAt).toBe("number");
      expect(manifest.projectId).toBe(mockProjectId);
      expect(manifest.projectName).toBe("Test Project");
      expect(manifest.resources).toBeDefined();
      expect(Array.isArray(manifest.resources.docs)).toBe(true);
      expect(Array.isArray(manifest.resources.rules)).toBe(true);
      expect(Array.isArray(manifest.resources.skills)).toBe(true);
      expect(manifest.stats).toBeDefined();

      // Validate resource entry structure
      const docEntry = manifest.resources.docs[0];
      expect(docEntry.id).toBe("d1");
      expect(docEntry.name).toBe("Doc 1");
      expect(typeof docEntry.createdAt).toBe("number");
    });

    it("validates docs folder structure", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs"],
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      const docsFolder = zip.folder("docs");
      expect(docsFolder).toBeDefined();

      // Check .md file
      const mdContent = await docsFolder!.file("d1.md")!.async("text");
      expect(mdContent).toBe("Content 1");

      // Check .json file
      const jsonContent = await docsFolder!.file("d1.json")!.async("text");
      const docMeta = JSON.parse(jsonContent);
      expect(docMeta.id).toBe("d1");
      expect(docMeta.name).toBe("Doc 1");
      expect(typeof docMeta.createdAt).toBe("number");
      expect(typeof docMeta.updatedAt).toBe("number");
    });

    it("validates rules folder structure", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("r1", mockProjectId, "Rule 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["rules"],
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      const rulesFolder = zip.folder("rules");
      expect(rulesFolder).toBeDefined();

      // Check .md file
      const mdContent = await rulesFolder!.file("r1.md")!.async("text");
      expect(mdContent).toBe("Content 1");

      // Check .json file (uses title instead of name)
      const jsonContent = await rulesFolder!.file("r1.json")!.async("text");
      const ruleMeta = JSON.parse(jsonContent);
      expect(ruleMeta.id).toBe("r1");
      expect(ruleMeta.title).toBe("Rule 1");
      expect(typeof ruleMeta.createdAt).toBe("number");
      expect(typeof ruleMeta.updatedAt).toBe("number");
    });

    it("validates skills folder structure", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("s1", mockProjectId, "Skill 1", "Content 1"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["skills"],
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      const skillsFolder = zip.folder("skills");
      expect(skillsFolder).toBeDefined();

      // Check .md file
      const mdContent = await skillsFolder!.file("s1.md")!.async("text");
      expect(mdContent).toBe("Content 1");

      // Check .json file
      const jsonContent = await skillsFolder!.file("s1.json")!.async("text");
      const skillMeta = JSON.parse(jsonContent);
      expect(skillMeta.id).toBe("s1");
      expect(skillMeta.name).toBe("Skill 1");
      expect(typeof skillMeta.createdAt).toBe("number");
      expect(typeof skillMeta.updatedAt).toBe("number");
    });

    it("validates README.md exists", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs"],
      });

      const zipBuffer = Buffer.from(result.data, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);

      expect(zip.file("README.md")).toBeDefined();

      const readmeContent = await zip.file("README.md")!.async("text");
      expect(readmeContent).toContain("# Test Project - Resource Export");
      expect(readmeContent).toContain("OpenClaw");
      expect(readmeContent).toContain("manifest.json");
      expect(readmeContent).toContain("README.md");
    });
  });

  describe("filename generation", () => {
    it("generates filename with timestamp", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("d1", mockProjectId, "Doc 1", "Content"),
      ]);

      const result = await exportProjectResources({
        projectId: mockProjectId,
        resourceTypes: ["docs"],
      });

      // Filename format: project-export-{YYYYMMDD-HHMMSS}.zip
      expect(result.filename).toMatch(/^project-export-\d{8}-\d{6}\.zip$/);
      expect(result.filename.endsWith(".zip")).toBe(true);
    });
  });
});
