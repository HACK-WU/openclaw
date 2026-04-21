/**
 * Tests for Project Resource Import
 */

import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { importProjectResources, previewImportResources } from "./resource-import.js";
import type { Project, ProjectDoc, ProjectRule, ProjectSkill } from "./types.js";

// Mock project-store
vi.mock("./project-store.js", () => ({
  loadProjectMeta: vi.fn(),
  loadProjectDocs: vi.fn(),
  loadProjectRules: vi.fn(),
  loadProjectSkills: vi.fn(),
  createProjectDoc: vi.fn(),
  createProjectRule: vi.fn(),
  createProjectSkill: vi.fn(),
  updateProjectDoc: vi.fn(),
  updateProjectRule: vi.fn(),
  updateProjectSkill: vi.fn(),
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

// Helper to create a valid manifest-based ZIP
async function createManifestZip(
  docs: Array<{ id: string; name: string; content: string }> = [],
  rules: Array<{ id: string; title: string; content: string }> = [],
  skills: Array<{ id: string; name: string; content: string }> = [],
): Promise<string> {
  const zip = new JSZip();

  const manifest = {
    version: "1.0",
    exportedAt: Date.now(),
    projectId: "source-project",
    projectName: "Source Project",
    resources: {
      docs: docs.map((d) => ({ id: d.id, name: d.name, createdAt: Date.now() })),
      rules: rules.map((r) => ({ id: r.id, name: r.title, createdAt: Date.now() })),
      skills: skills.map((s) => ({ id: s.id, name: s.name, createdAt: Date.now() })),
    },
    stats: {
      docs: docs.length,
      rules: rules.length,
      skills: skills.length,
      total: docs.length + rules.length + skills.length,
    },
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.md", "# Export");

  // Add docs
  const docsFolder = zip.folder("docs");
  for (const doc of docs) {
    docsFolder!.file(`${doc.id}.md`, doc.content);
    docsFolder!.file(
      `${doc.id}.json`,
      JSON.stringify({ id: doc.id, name: doc.name, createdAt: Date.now() }),
    );
  }

  // Add rules
  const rulesFolder = zip.folder("rules");
  for (const rule of rules) {
    rulesFolder!.file(`${rule.id}.md`, rule.content);
    rulesFolder!.file(
      `${rule.id}.json`,
      JSON.stringify({ id: rule.id, title: rule.title, createdAt: Date.now() }),
    );
  }

  // Add skills
  const skillsFolder = zip.folder("skills");
  for (const skill of skills) {
    skillsFolder!.file(`${skill.id}.md`, skill.content);
    skillsFolder!.file(
      `${skill.id}.json`,
      JSON.stringify({ id: skill.id, name: skill.name, createdAt: Date.now() }),
    );
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return zipBuffer.toString("base64");
}

// Helper to create legacy docs-only ZIP (docs.json format)
async function createLegacyDocsJsonZip(
  docs: Array<{ name: string; content: string }>,
): Promise<string> {
  const zip = new JSZip();
  zip.file("README.md", "# Export");
  zip.file("docs.json", JSON.stringify(docs, null, 2));

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return zipBuffer.toString("base64");
}

// Helper to create legacy docs-only ZIP (markdown folder format)
async function createLegacyMarkdownZip(
  files: Array<{ filename: string; content: string }>,
): Promise<string> {
  const zip = new JSZip();
  zip.file("README.md", "# Export");

  // Create markdown folder and add files using folder().file()
  const mdFolder = zip.folder("markdown");
  if (mdFolder) {
    for (const file of files) {
      mdFolder.file(file.filename, file.content);
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  return zipBuffer.toString("base64");
}

describe("previewImportResources", () => {
  const mockProjectId = "test-project-id";

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadProjectMeta).mockReturnValue(mockProject(mockProjectId, "Test Project"));
    vi.mocked(loadProjectDocs).mockReturnValue([]);
    vi.mocked(loadProjectRules).mockReturnValue([]);
    vi.mocked(loadProjectSkills).mockReturnValue([]);
  });

  describe("preview manifest-based ZIP", () => {
    it("should preview ZIP with all resource types", async () => {
      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "Content 1" }],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
        [{ id: "s1", name: "Skill 1", content: "Content 1" }],
      );

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(1);
      expect(preview.stats.rules.total).toBe(1);
      expect(preview.stats.skills.total).toBe(1);

      expect(preview.resources.docs).toHaveLength(1);
      expect(preview.resources.docs[0].id).toBe("d1");
      expect(preview.resources.docs[0].name).toBe("Doc 1");
      expect(preview.resources.docs[0].type).toBe("doc");
      expect(preview.resources.docs[0].hasConflict).toBe(false);

      expect(preview.resources.rules).toHaveLength(1);
      expect(preview.resources.rules[0].id).toBe("r1");
      expect(preview.resources.rules[0].name).toBe("Rule 1");
      expect(preview.resources.rules[0].type).toBe("rule");

      expect(preview.resources.skills).toHaveLength(1);
      expect(preview.resources.skills[0].id).toBe("s1");
      expect(preview.resources.skills[0].name).toBe("Skill 1");
      expect(preview.resources.skills[0].type).toBe("skill");
    });

    it("should preview ZIP with only docs", async () => {
      const base64Zip = await createManifestZip([
        { id: "d1", name: "Doc 1", content: "Content 1" },
      ]);

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(1);
      expect(preview.stats.rules.total).toBe(0);
      expect(preview.stats.skills.total).toBe(0);
    });

    it("should preview ZIP with only rules", async () => {
      const base64Zip = await createManifestZip(
        [],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
      );

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(0);
      expect(preview.stats.rules.total).toBe(1);
      expect(preview.stats.skills.total).toBe(0);
    });

    it("should preview ZIP with only skills", async () => {
      const base64Zip = await createManifestZip(
        [],
        [],
        [{ id: "s1", name: "Skill 1", content: "Content 1" }],
      );

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(0);
      expect(preview.stats.rules.total).toBe(0);
      expect(preview.stats.skills.total).toBe(1);
    });
  });

  describe("conflict detection", () => {
    it("should detect doc conflicts by name", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip([
        { id: "d1", name: "Doc 1", content: "New content" },
      ]);

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(1);
      expect(preview.stats.docs.new).toBe(0);
      expect(preview.stats.docs.conflict).toBe(1);

      expect(preview.resources.docs[0].hasConflict).toBe(true);
      expect(preview.resources.docs[0].existingId).toBe("existing-d1");
    });

    it("should detect rule conflicts by title", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("existing-r1", mockProjectId, "Rule 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [{ id: "r1", title: "Rule 1", content: "New content" }],
      );

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.rules.total).toBe(1);
      expect(preview.stats.rules.new).toBe(0);
      expect(preview.stats.rules.conflict).toBe(1);

      expect(preview.resources.rules[0].hasConflict).toBe(true);
      expect(preview.resources.rules[0].existingId).toBe("existing-r1");
    });

    it("should detect skill conflicts by name", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("existing-s1", mockProjectId, "Skill 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [],
        [{ id: "s1", name: "Skill 1", content: "New content" }],
      );

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.skills.total).toBe(1);
      expect(preview.stats.skills.new).toBe(0);
      expect(preview.stats.skills.conflict).toBe(1);

      expect(preview.resources.skills[0].hasConflict).toBe(true);
      expect(preview.resources.skills[0].existingId).toBe("existing-s1");
    });

    it("should detect multiple conflicts across resource types", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing"),
      ]);
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("existing-r1", mockProjectId, "Rule 1", "Existing"),
      ]);
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("existing-s1", mockProjectId, "Skill 1", "Existing"),
      ]);

      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "New" }],
        [{ id: "r1", title: "Rule 1", content: "New" }],
        [{ id: "s1", name: "Skill 1", content: "New" }],
      );

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.conflict).toBe(1);
      expect(preview.stats.rules.conflict).toBe(1);
      expect(preview.stats.skills.conflict).toBe(1);
    });
  });

  describe("preview legacy docs-only ZIP", () => {
    it("should preview legacy docs.json format", async () => {
      const base64Zip = await createLegacyDocsJsonZip([
        { name: "Doc 1", content: "Content 1" },
        { name: "Doc 2", content: "Content 2" },
      ]);

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(2);
      expect(preview.stats.rules.total).toBe(0);
      expect(preview.stats.skills.total).toBe(0);

      expect(preview.resources.docs).toHaveLength(2);
      expect(preview.resources.docs[0].name).toBe("Doc 1");
    });

    it("should preview legacy markdown folder format", async () => {
      const base64Zip = await createLegacyMarkdownZip([
        { filename: "doc-1.md", content: "Content 1" },
        { filename: "doc-2.md", content: "Content 2" },
      ]);

      const preview = await previewImportResources(mockProjectId, base64Zip);

      expect(preview.stats.docs.total).toBe(2);
      expect(preview.stats.rules.total).toBe(0);
      expect(preview.stats.skills.total).toBe(0);

      expect(preview.resources.docs).toHaveLength(2);
      expect(preview.resources.docs[0].name).toBe("doc-1");
    });
  });

  describe("preview error cases", () => {
    it("should throw when project not found", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(null);

      const base64Zip = await createManifestZip([{ id: "d1", name: "Doc 1", content: "Content" }]);

      await expect(previewImportResources("nonexistent", base64Zip)).rejects.toThrow(
        "Project nonexistent not found",
      );
    });

    it("should throw when ZIP has no valid format", async () => {
      const zip = new JSZip();
      zip.file("README.md", "# Empty");
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Zip = zipBuffer.toString("base64");

      await expect(previewImportResources(mockProjectId, base64Zip)).rejects.toThrow(
        "ZIP must contain either manifest.json, docs.json, or markdown/ folder",
      );
    });
  });
});

describe("importProjectResources", () => {
  const mockProjectId = "test-project-id";

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(loadProjectMeta).mockReturnValue(mockProject(mockProjectId, "Test Project"));
    vi.mocked(loadProjectDocs).mockReturnValue([]);
    vi.mocked(loadProjectRules).mockReturnValue([]);
    vi.mocked(loadProjectSkills).mockReturnValue([]);

    // Mock create functions
    vi.mocked(createProjectDoc).mockImplementation(async (projectId, params) => ({
      id: `doc-${params.name}`,
      projectId,
      name: params.name,
      content: params.content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    vi.mocked(createProjectRule).mockImplementation(async (projectId, params) => ({
      id: `rule-${params.title}`,
      projectId,
      title: params.title,
      content: params.content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    vi.mocked(createProjectSkill).mockImplementation(async (projectId, params) => ({
      id: `skill-${params.name}`,
      projectId,
      name: params.name,
      content: params.content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    // Mock update functions
    vi.mocked(updateProjectDoc).mockImplementation(async (projectId, docId, params) => ({
      id: docId,
      projectId,
      name: "Updated Doc",
      content: params.content || "Updated content",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    vi.mocked(updateProjectRule).mockImplementation(async (projectId, ruleId, params) => ({
      id: ruleId,
      projectId,
      title: "Updated Rule",
      content: params.content || "Updated content",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    vi.mocked(updateProjectSkill).mockImplementation(async (projectId, skillId, params) => ({
      id: skillId,
      projectId,
      name: "Updated Skill",
      content: params.content || "Updated content",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  });

  describe("import without conflicts", () => {
    it("should import all resource types without conflicts", async () => {
      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "Content 1" }],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
        [{ id: "s1", name: "Skill 1", content: "Content 1" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.docs).toBe(1);
      expect(result.imported.rules).toBe(1);
      expect(result.imported.skills).toBe(1);
      expect(result.skipped.docs).toBe(0);
      expect(result.skipped.rules).toBe(0);
      expect(result.skipped.skills).toBe(0);
      expect(result.errors).toHaveLength(0);

      expect(createProjectDoc).toHaveBeenCalledTimes(1);
      expect(createProjectRule).toHaveBeenCalledTimes(1);
      expect(createProjectSkill).toHaveBeenCalledTimes(1);
    });

    it("should import only docs", async () => {
      const base64Zip = await createManifestZip([
        { id: "d1", name: "Doc 1", content: "Content 1" },
      ]);

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
        resourceTypes: ["docs"],
      });

      expect(result.imported.docs).toBe(1);
      expect(result.imported.rules).toBe(0);
      expect(result.imported.skills).toBe(0);
    });

    it("should import only rules", async () => {
      const base64Zip = await createManifestZip(
        [],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
        resourceTypes: ["rules"],
      });

      expect(result.imported.docs).toBe(0);
      expect(result.imported.rules).toBe(1);
      expect(result.imported.skills).toBe(0);
    });

    it("should import only skills", async () => {
      const base64Zip = await createManifestZip(
        [],
        [],
        [{ id: "s1", name: "Skill 1", content: "Content 1" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
        resourceTypes: ["skills"],
      });

      expect(result.imported.docs).toBe(0);
      expect(result.imported.rules).toBe(0);
      expect(result.imported.skills).toBe(1);
    });
  });

  describe("import with conflicts - skip strategy", () => {
    it("should skip conflicting docs", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "New content" }],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "skip",
      });

      expect(result.imported.docs).toBe(0);
      expect(result.skipped.docs).toBe(1);
      expect(result.imported.rules).toBe(1);

      expect(createProjectDoc).not.toHaveBeenCalled();
      expect(createProjectRule).toHaveBeenCalledTimes(1);
    });

    it("should skip conflicting rules", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("existing-r1", mockProjectId, "Rule 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [{ id: "r1", title: "Rule 1", content: "New content" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "skip",
      });

      expect(result.imported.rules).toBe(0);
      expect(result.skipped.rules).toBe(1);
    });

    it("should skip conflicting skills", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("existing-s1", mockProjectId, "Skill 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [],
        [{ id: "s1", name: "Skill 1", content: "New content" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "skip",
      });

      expect(result.imported.skills).toBe(0);
      expect(result.skipped.skills).toBe(1);
    });
  });

  describe("import with conflicts - overwrite strategy", () => {
    it("should overwrite conflicting docs", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip([
        { id: "d1", name: "Doc 1", content: "New content" },
      ]);

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "overwrite",
      });

      expect(result.imported.docs).toBe(1);
      expect(result.skipped.docs).toBe(0);

      expect(updateProjectDoc).toHaveBeenCalledWith(mockProjectId, "existing-d1", {
        content: "New content",
      });
      expect(createProjectDoc).not.toHaveBeenCalled();
    });

    it("should overwrite conflicting rules", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("existing-r1", mockProjectId, "Rule 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [{ id: "r1", title: "Rule 1", content: "New content" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "overwrite",
      });

      expect(result.imported.rules).toBe(1);
      expect(result.skipped.rules).toBe(0);

      expect(updateProjectRule).toHaveBeenCalledWith(mockProjectId, "existing-r1", {
        content: "New content",
      });
    });

    it("should overwrite conflicting skills", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("existing-s1", mockProjectId, "Skill 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [],
        [{ id: "s1", name: "Skill 1", content: "New content" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "overwrite",
      });

      expect(result.imported.skills).toBe(1);
      expect(result.skipped.skills).toBe(0);

      expect(updateProjectSkill).toHaveBeenCalledWith(mockProjectId, "existing-s1", {
        content: "New content",
      });
    });
  });

  describe("import with conflicts - rename strategy", () => {
    it("should rename conflicting docs", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip([
        { id: "d1", name: "Doc 1", content: "New content" },
      ]);

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.docs).toBe(1);
      expect(result.skipped.docs).toBe(0);

      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 1-1",
        content: "New content",
      });
    });

    it("should rename conflicting rules", async () => {
      vi.mocked(loadProjectRules).mockReturnValue([
        mockRule("existing-r1", mockProjectId, "Rule 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [{ id: "r1", title: "Rule 1", content: "New content" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.rules).toBe(1);
      expect(result.skipped.rules).toBe(0);

      expect(createProjectRule).toHaveBeenCalledWith(mockProjectId, {
        title: "Rule 1-1",
        content: "New content",
      });
    });

    it("should rename conflicting skills", async () => {
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("existing-s1", mockProjectId, "Skill 1", "Existing content"),
      ]);

      const base64Zip = await createManifestZip(
        [],
        [],
        [{ id: "s1", name: "Skill 1", content: "New content" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.skills).toBe(1);
      expect(result.skipped.skills).toBe(0);

      expect(createProjectSkill).toHaveBeenCalledWith(mockProjectId, {
        name: "Skill 1-1",
        content: "New content",
      });
    });

    it("should handle multiple rename conflicts", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing"),
        mockDoc("existing-d1-1", mockProjectId, "Doc 1-1", "Existing"),
      ]);

      const base64Zip = await createManifestZip([
        { id: "d1", name: "Doc 1", content: "New content" },
      ]);

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.docs).toBe(1);

      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 1-2",
        content: "New content",
      });
    });
  });

  describe("import legacy docs-only ZIP", () => {
    it("should import from legacy docs.json format", async () => {
      const base64Zip = await createLegacyDocsJsonZip([
        { name: "Doc 1", content: "Content 1" },
        { name: "Doc 2", content: "Content 2" },
      ]);

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.docs).toBe(2);
      expect(result.imported.rules).toBe(0);
      expect(result.imported.skills).toBe(0);
      expect(result.errors).toHaveLength(0);

      expect(createProjectDoc).toHaveBeenCalledTimes(2);
    });

    it("should import from legacy markdown folder format", async () => {
      const base64Zip = await createLegacyMarkdownZip([
        { filename: "doc-1.md", content: "Content 1" },
        { filename: "doc-2.md", content: "Content 2" },
      ]);

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      expect(result.imported.docs).toBe(2);
      expect(result.imported.rules).toBe(0);
      expect(result.imported.skills).toBe(0);
    });
  });

  describe("error cases", () => {
    it("should throw when project not found", async () => {
      vi.mocked(loadProjectMeta).mockReturnValue(null);

      const base64Zip = await createManifestZip([{ id: "d1", name: "Doc 1", content: "Content" }]);

      await expect(
        importProjectResources({
          projectId: "nonexistent",
          data: base64Zip,
          conflictStrategy: "rename",
        }),
      ).rejects.toThrow("Project nonexistent not found");
    });

    it("should throw when ZIP has no valid format", async () => {
      const zip = new JSZip();
      zip.file("README.md", "# Empty");
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Zip = zipBuffer.toString("base64");

      await expect(
        importProjectResources({
          projectId: mockProjectId,
          data: base64Zip,
          conflictStrategy: "rename",
        }),
      ).rejects.toThrow("ZIP must contain either manifest.json, docs.json, or markdown/ folder");
    });

    it("should throw when import data exceeds size limit", async () => {
      // Create a ZIP that exceeds 100MB after compression
      // We need to create content that won't compress well
      const largeDocs = Array(2000).fill({
        id: `d`,
        name: "Doc",
        content: Array(50).fill("x").join(""), // Random-like content that won't compress well
      });

      // Create a very large manifest ZIP
      const zip = new JSZip();
      const manifest = {
        version: "1.0",
        exportedAt: Date.now(),
        projectId: "source",
        projectName: "Source",
        resources: {
          docs: largeDocs.map((d, i) => ({ id: `d${i}`, name: d.name, createdAt: Date.now() })),
          rules: [],
          skills: [],
        },
        stats: { docs: largeDocs.length, rules: 0, skills: 0, total: largeDocs.length },
      };

      zip.file("manifest.json", JSON.stringify(manifest));
      zip.file("README.md", "# Export");

      const docsFolder = zip.folder("docs");
      for (let i = 0; i < largeDocs.length; i++) {
        docsFolder!.file(`d${i}.md`, largeDocs[i].content);
        docsFolder!.file(`d${i}.json`, JSON.stringify({ id: `d${i}`, name: largeDocs[i].name }));
      }

      // Generate without compression to ensure it's large
      const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "STORE", // No compression
      });

      // If the ZIP is still not large enough, skip this test
      if (zipBuffer.byteLength <= 100 * 1024 * 1024) {
        // Create an even larger ZIP by using more content
        const veryLargeContent = "x".repeat(60 * 1024 * 1024); // 60MB per doc
        const largeZip = new JSZip();
        largeZip.file(
          "manifest.json",
          JSON.stringify({
            version: "1.0",
            resources: {
              docs: [{ id: "d1", name: "Large", createdAt: Date.now() }],
              rules: [],
              skills: [],
            },
            stats: { docs: 1, rules: 0, skills: 0, total: 1 },
          }),
        );
        largeZip.file("docs/d1.md", veryLargeContent);

        const largeZipBuffer = await largeZip.generateAsync({
          type: "nodebuffer",
          compression: "STORE",
        });
        const base64Zip = largeZipBuffer.toString("base64");

        await expect(
          importProjectResources({
            projectId: mockProjectId,
            data: base64Zip,
            conflictStrategy: "rename",
          }),
        ).rejects.toThrow(/exceeds size limit/);
      } else {
        const base64Zip = zipBuffer.toString("base64");

        await expect(
          importProjectResources({
            projectId: mockProjectId,
            data: base64Zip,
            conflictStrategy: "rename",
          }),
        ).rejects.toThrow(/exceeds size limit/);
      }
    });

    it("should throw when resource exceeds size limit", async () => {
      const largeContent = "x".repeat(51 * 1024 * 1024); // 51MB
      const base64Zip = await createManifestZip([
        { id: "d1", name: "Large Doc", content: largeContent },
      ]);

      await expect(
        importProjectResources({
          projectId: mockProjectId,
          data: base64Zip,
          conflictStrategy: "rename",
        }),
      ).rejects.toThrow(/exceeds size limit/);
    });

    it("should throw when manifest.json is invalid JSON", async () => {
      const zip = new JSZip();
      zip.file("manifest.json", "not valid json");
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Zip = zipBuffer.toString("base64");

      await expect(
        importProjectResources({
          projectId: mockProjectId,
          data: base64Zip,
          conflictStrategy: "rename",
        }),
      ).rejects.toThrow();
    });

    it("should throw when docs.json is invalid JSON", async () => {
      const zip = new JSZip();
      zip.file("docs.json", "not valid json");
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Zip = zipBuffer.toString("base64");

      await expect(
        importProjectResources({
          projectId: mockProjectId,
          data: base64Zip,
          conflictStrategy: "rename",
        }),
      ).rejects.toThrow();
    });

    it("should handle missing content files gracefully", async () => {
      // Create manifest with docs but no actual .md files
      const zip = new JSZip();
      const manifest = {
        version: "1.0",
        exportedAt: Date.now(),
        projectId: "source",
        projectName: "Source",
        resources: {
          docs: [{ id: "d1", name: "Doc 1", createdAt: Date.now() }],
          rules: [],
          skills: [],
        },
        stats: { docs: 1, rules: 0, skills: 0, total: 1 },
      };
      zip.file("manifest.json", JSON.stringify(manifest));
      zip.file("README.md", "# Export");
      // Note: no docs/d1.md file

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const base64Zip = zipBuffer.toString("base64");

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      // Should skip the doc without content file
      expect(result.imported.docs).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("selective import", () => {
    it("should import only selected resource types", async () => {
      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "Content 1" }],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
        [{ id: "s1", name: "Skill 1", content: "Content 1" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
        resourceTypes: ["docs", "skills"],
      });

      expect(result.imported.docs).toBe(1);
      expect(result.imported.rules).toBe(0);
      expect(result.imported.skills).toBe(1);

      expect(createProjectDoc).toHaveBeenCalledTimes(1);
      expect(createProjectRule).not.toHaveBeenCalled();
      expect(createProjectSkill).toHaveBeenCalledTimes(1);
    });

    it("should import all types when resourceTypes not specified", async () => {
      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "Content 1" }],
        [{ id: "r1", title: "Rule 1", content: "Content 1" }],
        [{ id: "s1", name: "Skill 1", content: "Content 1" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
        // resourceTypes not specified
      });

      expect(result.imported.docs).toBe(1);
      expect(result.imported.rules).toBe(1);
      expect(result.imported.skills).toBe(1);
    });
  });

  describe("mixed conflicts", () => {
    it("should handle mixed conflicts across resource types", async () => {
      vi.mocked(loadProjectDocs).mockReturnValue([
        mockDoc("existing-d1", mockProjectId, "Doc 1", "Existing"),
      ]);
      vi.mocked(loadProjectRules).mockReturnValue([]);
      vi.mocked(loadProjectSkills).mockReturnValue([
        mockSkill("existing-s1", mockProjectId, "Skill 1", "Existing"),
      ]);

      const base64Zip = await createManifestZip(
        [{ id: "d1", name: "Doc 1", content: "New" }],
        [{ id: "r1", title: "Rule 1", content: "New" }],
        [{ id: "s1", name: "Skill 1", content: "New" }],
      );

      const result = await importProjectResources({
        projectId: mockProjectId,
        data: base64Zip,
        conflictStrategy: "rename",
      });

      // Doc 1 and Skill 1 should be renamed (conflicts)
      // Rule 1 should be created normally (no conflict)
      expect(result.imported.docs).toBe(1);
      expect(result.imported.rules).toBe(1);
      expect(result.imported.skills).toBe(1);

      expect(createProjectDoc).toHaveBeenCalledWith(mockProjectId, {
        name: "Doc 1-1",
        content: "New",
      });
      expect(createProjectRule).toHaveBeenCalledWith(mockProjectId, {
        title: "Rule 1",
        content: "New",
      });
      expect(createProjectSkill).toHaveBeenCalledWith(mockProjectId, {
        name: "Skill 1-1",
        content: "New",
      });
    });
  });
});
