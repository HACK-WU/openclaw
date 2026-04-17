/**
 * Project Management — View
 *
 * Renders the project management page: list, cards, create/edit/delete dialogs.
 * Follows the same patterns as views/group-chat.ts.
 */

import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type {
  DocExportDialogState,
  DocImportDialogState,
  LinkedGroupEntry,
  Project,
  ProjectCreateDialogState,
  ProjectDeleteDialogState,
  ProjectDoc,
  ProjectDocCreateDialogState,
  ProjectDocDeleteDialogState,
  ProjectDocEditDialogState,
  ProjectEditDialogState,
  ProjectIndexEntry,
  ProjectManageDialogState,
  ProjectRule,
  ProjectRuleCreateDialogState,
  ProjectRuleDeleteDialogState,
  ProjectRuleEditDialogState,
  ProjectSkill,
  ProjectSkillCreateDialogState,
  ProjectSkillDeleteDialogState,
  ProjectSkillEditDialogState,
  ValidationResult,
} from "../controllers/projects.ts";
import { t } from "../i18n/index.ts";
import { icons } from "../icons.ts";

// ─── Props ───

export type ProjectsViewProps = {
  // 状态
  projectsList: ProjectIndexEntry[];
  projectsLoading: boolean;
  activeProject: Project | null;
  // 对话框
  projectCreateDialog: ProjectCreateDialogState | null;
  projectEditDialog: ProjectEditDialogState | null;
  projectDeleteDialog: ProjectDeleteDialogState | null;
  projectManageDialog: ProjectManageDialogState | null;
  projectError: string | null;
  // 规则管理状态
  projectRules: ProjectRule[];
  projectRulesLoading: boolean;
  projectRuleCreateDialog: ProjectRuleCreateDialogState | null;
  projectRuleEditDialog: ProjectRuleEditDialogState | null;
  projectRuleDeleteDialog: ProjectRuleDeleteDialogState | null;
  // 技能管理状态
  projectSkills: ProjectSkill[];
  projectSkillsLoading: boolean;
  projectSkillCreateDialog: ProjectSkillCreateDialogState | null;
  projectSkillEditDialog: ProjectSkillEditDialogState | null;
  projectSkillDeleteDialog: ProjectSkillDeleteDialogState | null;
  // 文档管理状态
  projectDocs: ProjectDoc[];
  projectDocsLoading: boolean;
  projectDocCreateDialog: ProjectDocCreateDialogState | null;
  projectDocEditDialog: ProjectDocEditDialogState | null;
  projectDocDeleteDialog: ProjectDocDeleteDialogState | null;
  // 文档导出/导入状态
  projectDocExportDialog: DocExportDialogState | null;
  projectDocImportDialog: DocImportDialogState | null;
  // 关联群聊
  projectLinkedGroups: LinkedGroupEntry[];
  projectLinkedGroupsLoading: boolean;
  // 回调
  onLoadProjectInfo: (projectId: string) => void;
  onOpenCreateDialog: () => void;
  onCloseCreateDialog: () => void;
  onCreateProject: (params: {
    name: string;
    directory: string;
    documents?: string[];
    description?: string;
  }) => void;
  onUpdateProject: (
    projectId: string,
    params: { name?: string; directory?: string; documents?: string[]; description?: string },
  ) => void;
  onOpenDeleteDialog: (projectId: string, projectName: string) => void;
  onCloseDeleteDialog: () => void;
  onDeleteProject: (projectId: string) => void;
  onValidatePaths: (paths: string[], type: "directory" | "file") => Promise<ValidationResult[]>;
  // 管理弹框回调
  onOpenManageDialog: (projectId: string, projectName: string) => void;
  onCloseManageDialog: () => void;
  onSetManageTab: (tab: "overview" | "rules" | "skills" | "docs") => void;
  // 规则回调
  onLoadProjectRules: (projectId: string) => void;
  onOpenRuleCreateDialog: () => void;
  onCloseRuleCreateDialog: () => void;
  onCreateRule: (projectId: string, params: { title: string; content: string }) => void;
  onOpenRuleEditDialog: (rule: ProjectRule) => void;
  onCloseRuleEditDialog: () => void;
  onUpdateRule: (
    projectId: string,
    ruleId: string,
    params: { title?: string; content?: string },
  ) => void;
  onOpenRuleDeleteDialog: (ruleId: string, ruleTitle: string) => void;
  onCloseRuleDeleteDialog: () => void;
  onDeleteRule: (projectId: string, ruleId: string) => void;
  // 预览模式切换
  onToggleRuleCreatePreview: (previewMode: boolean) => void;
  onToggleRuleEditPreview: (previewMode: boolean) => void;
  // 技能回调
  onLoadProjectSkills: (projectId: string) => void;
  onOpenSkillCreateDialog: () => void;
  onCloseSkillCreateDialog: () => void;
  onCreateSkill: (projectId: string, params: { name: string; content: string }) => void;
  onOpenSkillEditDialog: (skill: ProjectSkill) => void;
  onCloseSkillEditDialog: () => void;
  onUpdateSkill: (
    projectId: string,
    skillId: string,
    params: { name?: string; content?: string },
  ) => void;
  onOpenSkillDeleteDialog: (skillId: string, skillName: string) => void;
  onCloseSkillDeleteDialog: () => void;
  onDeleteSkill: (projectId: string, skillId: string) => void;
  // 预览模式切换（技能）
  onToggleSkillCreatePreview: (previewMode: boolean) => void;
  onToggleSkillEditPreview: (previewMode: boolean) => void;
  // 文档回调
  onLoadProjectDocs: (projectId: string) => void;
  onOpenDocCreateDialog: () => void;
  onCloseDocCreateDialog: () => void;
  onCreateDoc: (projectId: string, params: { name: string; content: string }) => void;
  onOpenDocEditDialog: (doc: ProjectDoc) => void;
  onCloseDocEditDialog: () => void;
  onUpdateDoc: (
    projectId: string,
    docId: string,
    params: { name?: string; content?: string },
  ) => void;
  onOpenDocDeleteDialog: (docId: string, docName: string) => void;
  onCloseDocDeleteDialog: () => void;
  onDeleteDoc: (projectId: string, docId: string) => void;
  // 预览模式切换（文档）
  onToggleDocCreatePreview: (previewMode: boolean) => void;
  onToggleDocEditPreview: (previewMode: boolean) => void;
  // 文档导出/导入回调
  onOpenDocExportDialog: () => void;
  onCloseDocExportDialog: () => void;
  onToggleDocExportSelection: (docId: string) => void;
  onToggleDocExportSelectAll: () => void;
  onExportDocs: () => void;
  onOpenDocImportDialog: () => void;
  onCloseDocImportDialog: () => void;
  onSetImportConflictStrategy: (strategy: "rename" | "overwrite" | "skip") => void;
  onImportDocs: () => void;
};

// ─── Main Render ───

export function renderProjectsView(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-view">
      <div class="projects-view__header">
        <div class="projects-view__title-row">
          <h2 class="projects-view__title">${t("project.title")}</h2>
          <button
            class="btn btn--primary"
            @click=${() => props.onOpenCreateDialog()}
          >
            ${icons.plus}
            <span>${t("project.newProject")}</span>
          </button>
        </div>
      </div>

      ${props.projectError ? html`<div class="callout danger">${props.projectError}</div>` : nothing}

      ${
        props.projectsLoading
          ? html`<div class="projects-view__loading">${t("action.loading")}</div>`
          : props.projectsList.length === 0
            ? renderEmptyState(props)
            : renderProjectList(props)
      }

      ${renderCreateDialog(props)}
      ${renderDeleteDialog(props)}
      ${renderManageDialog(props)}
      ${renderRuleCreateDialog(props)}
      ${renderRuleEditDialog(props)}
      ${renderRuleDeleteDialog(props)}
      ${renderSkillCreateDialog(props)}
      ${renderSkillEditDialog(props)}
      ${renderSkillDeleteDialog(props)}
      ${renderDocCreateDialog(props)}
      ${renderDocEditDialog(props)}
      ${renderDocDeleteDialog(props)}
    </div>
  `;
}

// ─── Project List ───

function renderProjectList(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-view__list">
      ${props.projectsList.map((project) => renderProjectCard(project, props))}
      <div class="projects-view__count">
        ${t("project.total.count", { count: String(props.projectsList.length) })}
      </div>
    </div>
  `;
}

// ─── Project Card ───

function renderProjectCard(project: ProjectIndexEntry, props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-view__card card">
      <div class="projects-view__card-header">
        <div class="projects-view__card-icon">${icons.folder}</div>
        <div class="projects-view__card-name">${project.name}</div>
      </div>
      <div class="projects-view__card-body">
        <div class="projects-view__card-field">
          <span class="projects-view__card-label">${icons.folder}</span>
          <span class="projects-view__card-value mono">${project.directory || "—"}</span>
        </div>
        ${
          project.documentsCount > 0
            ? html`
              <div class="projects-view__card-field">
                <span class="projects-view__card-label">${icons.fileText}</span>
                <span class="projects-view__card-value">${project.documentsCount} ${t("project.card.docs").toLowerCase()}</span>
              </div>
            `
            : nothing
        }
        ${
          project.description
            ? html`
              <div class="projects-view__card-description">${project.description}</div>
            `
            : nothing
        }
      </div>
      <div class="projects-view__card-actions">
        <button
          class="btn btn--sm"
          @click=${() => props.onOpenManageDialog(project.id, project.name)}
          title="${t("project.card.manage")}"
        >
          ${t("project.card.manage")}
        </button>
        <button
          class="btn btn--sm btn--danger-text"
          @click=${() => props.onOpenDeleteDialog(project.id, project.name)}
          title="${t("project.card.delete")}"
        >
          ${t("project.card.delete")}
        </button>
      </div>
    </div>
  `;
}

// ─── Empty State ───

function renderEmptyState(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-view__empty">
      <div class="projects-view__empty-icon">${icons.folder}</div>
      <div class="projects-view__empty-title">${t("project.list.empty.title")}</div>
      <div class="projects-view__empty-desc">${t("project.list.empty.description")}</div>
      <button
        class="btn btn--primary"
        @click=${() => props.onOpenCreateDialog()}
      >
        ${t("project.list.empty.button")}
      </button>
    </div>
  `;
}

// ─── Create Dialog ───

function renderCreateDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectCreateDialog;
  if (!dialog) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseCreateDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.dialog.create.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseCreateDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 项目名称 -->
          <div class="form-group">
            <label class="form-label">${t("project.dialog.name.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.name}
              placeholder=${t("project.dialog.name.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectCreateDialog!.name = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
            <div class="form-hint">${t("project.dialog.name.hint")}</div>
          </div>

          <!-- 项目目录 -->
          <div class="form-group">
            <label class="form-label">${t("project.dialog.directory.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.directory}
              placeholder=${t("project.dialog.directory.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectCreateDialog!.directory = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
            <div class="form-hint">${t("project.dialog.directory.hint")}</div>
          </div>

          <!-- 项目文档 -->
          <div class="form-group">
            <label class="form-label">${t("project.dialog.docs.label")}</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.documents}
              placeholder=${t("project.dialog.docs.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectCreateDialog!.documents = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
            <div class="form-hint">${t("project.dialog.docs.hint")}</div>
          </div>

          <!-- 描述 -->
          <div class="form-group">
            <label class="form-label">${t("project.dialog.description.label")}</label>
            <textarea
              class="form-input form-textarea"
              .value=${dialog.description}
              placeholder=${t("project.dialog.description.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLTextAreaElement;
                props.projectCreateDialog!.description = target.value;
              }}
              ?disabled=${dialog.isBusy}
              rows="3"
            ></textarea>
            <div class="form-hint">${t("project.dialog.description.hint")}</div>
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseCreateDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.name.trim() || !dialog.directory.trim()}
            @click=${() => {
              const docs = dialog.documents
                .split(",")
                .map((d) => d.trim())
                .filter(Boolean);
              props.onCreateProject({
                name: dialog.name.trim(),
                directory: dialog.directory.trim(),
                documents: docs.length > 0 ? docs : undefined,
                description: dialog.description.trim() || undefined,
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.dialog.create")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Delete Dialog ───

function renderDeleteDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectDeleteDialog;
  if (!dialog) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="modal-card modal-card--danger">
        <div class="modal-header">
          <div class="modal-icon modal-icon--danger">
            ${icons.trash}
          </div>
          <div class="modal-title-group">
            <div class="modal-title">${t("project.delete.title")}</div>
            <div class="modal-subtitle">${dialog.projectName}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("project.delete.confirm", { name: dialog.projectName })}</div>
              ${
                dialog.linkedGroupCount > 0
                  ? html`<div class="warning-box__text">${t("project.delete.warning.groups", { count: String(dialog.linkedGroupCount) })}</div>`
                  : nothing
              }
            </div>
          </div>

          ${
            dialog.error
              ? html`
                <div class="modal-error">
                  <span class="modal-error__icon">${icons.alertCircle}</span>
                  <span>${dialog.error}</span>
                </div>
              `
              : nothing
          }
        </div>

        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onCloseDeleteDialog()}
          >
            ${t("project.delete.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onDeleteProject(dialog.projectId)}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.delete.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Manage Dialog ───

function renderManageDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectManageDialog;
  if (!dialog) {
    return nothing;
  }

  const project = props.activeProject;

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseManageDialog();
        }
      }}
    >
      <div class="modal-card projects-manage-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.manage.title")} - ${dialog.projectName}</h3>
          <button class="modal-close" @click=${() => props.onCloseManageDialog()}>
            ${icons.x}
          </button>
        </div>

        <!-- Tab 切换 -->
        <div class="projects-manage-dialog__tabs">
          <button
            class="projects-manage-dialog__tab ${dialog.activeTab === "overview" ? "projects-manage-dialog__tab--active" : ""}"
            @click=${() => props.onSetManageTab("overview")}
          >
            ${t("project.manage.tab.overview")}
          </button>
          <button
            class="projects-manage-dialog__tab ${dialog.activeTab === "rules" ? "projects-manage-dialog__tab--active" : ""}"
            @click=${() => props.onSetManageTab("rules")}
          >
            ${t("project.manage.tab.rules")}
          </button>
          <button
            class="projects-manage-dialog__tab ${dialog.activeTab === "skills" ? "projects-manage-dialog__tab--active" : ""}"
            @click=${() => props.onSetManageTab("skills")}
          >
            ${t("project.manage.tab.skills")}
          </button>
          <button
            class="projects-manage-dialog__tab ${dialog.activeTab === "docs" ? "projects-manage-dialog__tab--active" : ""}"
            @click=${() => props.onSetManageTab("docs")}
          >
            ${t("project.manage.tab.docs")}
          </button>
        </div>

        <div class="modal-body">
          ${
            dialog.activeTab === "overview"
              ? renderManageOverviewTab(props, project)
              : dialog.activeTab === "rules"
                ? renderManageRulesTab(props)
                : dialog.activeTab === "skills"
                  ? renderManageSkillsTab(props)
                  : renderManageDocsTab(props)
          }
        </div>

        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseManageDialog()}
          >
            ${t("action.close")}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderManageOverviewTab(
  props: ProjectsViewProps,
  project: Project | null,
): TemplateResult {
  if (!project) {
    return html`<div class="projects-manage-dialog__loading">${t("action.loading")}</div>`;
  }

  return html`
    <div class="projects-manage-dialog__overview">
      <!-- 项目名称 -->
      <div class="projects-manage-dialog__section">
        <h4 class="projects-manage-dialog__section-title">${t("project.dialog.name.label")}</h4>
        <div class="projects-manage-dialog__field-edit">
          <input
            type="text"
            class="form-input"
            .value=${project.name}
            @change=${(e: Event) => {
              const newName = (e.target as HTMLInputElement).value.trim();
              if (newName && newName !== project.name) {
                props.onUpdateProject(project.id, { name: newName });
              }
            }}
          />
        </div>
      </div>

      <!-- 项目目录 -->
      <div class="projects-manage-dialog__section">
        <h4 class="projects-manage-dialog__section-title">${t("project.card.directory")}</h4>
        <div class="projects-manage-dialog__field mono">${project.directory}</div>
      </div>

      ${
        project.documents.length > 0
          ? html`
            <div class="projects-manage-dialog__section">
              <h4 class="projects-manage-dialog__section-title">${t("project.card.docs")}</h4>
              <div class="projects-manage-dialog__docs">
                ${project.documents.map(
                  (doc) => html`
                  <div class="projects-manage-dialog__doc-item">
                    ${icons.fileText}
                    <span>${doc}</span>
                  </div>
                `,
                )}
              </div>
            </div>
          `
          : nothing
      }

      ${
        project.description
          ? html`
            <div class="projects-manage-dialog__section">
              <h4 class="projects-manage-dialog__section-title">${t("project.dialog.description.label")}</h4>
              <div class="projects-manage-dialog__description">${project.description}</div>
            </div>
          `
          : nothing
      }

      <!-- 关联群聊 -->
      <div class="projects-manage-dialog__section">
        <h4 class="projects-manage-dialog__section-title">${t("project.groups.title")}</h4>
        ${
          props.projectLinkedGroupsLoading
            ? html`<div class="projects-manage-dialog__loading">${t("action.loading")}</div>`
            : props.projectLinkedGroups.length > 0
              ? html`
              <div class="projects-manage-dialog__groups">
                ${props.projectLinkedGroups.map(
                  (group) => html`
                    <div class="projects-manage-dialog__group-item">
                      ${icons.messageSquare}
                      <span>${group.groupName || group.groupId}</span>
                      ${
                        group.archived
                          ? html`<span class="projects-manage-dialog__group-badge">${t("project.groups.archived")}</span>`
                          : nothing
                      }
                    </div>
                  `,
                )}
              </div>
            `
              : html`<div class="projects-manage-dialog__empty-hint">${t("project.groups.empty.title")}</div>`
        }
      </div>

      <!-- 时间信息 -->
      <div class="projects-manage-dialog__section projects-manage-dialog__section--muted">
        <div class="projects-manage-dialog__time-info">
          <span>${t("project.card.createdAt")}: ${new Date(project.createdAt).toLocaleString()}</span>
          <span>${t("project.card.updatedAt")}: ${new Date(project.updatedAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;
}

function renderManageRulesTab(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-manage-dialog__rules">
      <div class="projects-manage-dialog__rules-header">
        <h4 class="projects-manage-dialog__section-title">
          ${t("project.rules.title")}
          ${
            props.projectRules.length > 0
              ? html`<span class="projects-rules__count">(${props.projectRules.length})</span>`
              : nothing
          }
        </h4>
        <button
          class="btn btn--sm btn--primary"
          @click=${() => props.onOpenRuleCreateDialog()}
        >
          ${icons.plus}
          <span>${t("project.rules.create")}</span>
        </button>
      </div>

      ${
        props.projectRulesLoading
          ? html`<div class="projects-manage-dialog__loading">${t("action.loading")}</div>`
          : props.projectRules.length === 0
            ? html`
              <div class="projects-rules__empty">
                <div class="projects-rules__empty-icon">${icons.fileText}</div>
                <div class="projects-rules__empty-title">${t("project.rules.empty.title")}</div>
                <div class="projects-rules__empty-desc">${t("project.rules.empty.description")}</div>
                <button
                  class="btn btn--primary btn--sm"
                  @click=${() => props.onOpenRuleCreateDialog()}
                >
                  ${t("project.rules.empty.button")}
                </button>
              </div>
            `
            : html`
              <div class="projects-rules__list">
                ${props.projectRules.map((rule) => renderRuleItem(rule, props))}
              </div>
            `
      }
    </div>
  `;
}

// ─── Simple Markdown to HTML ───

function simpleMarkdownToHtml(md: string): string {
  let html = md
    // 转义 HTML 特殊字符
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // 标题
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    // 粗体和斜体
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // 行内代码
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // 无序列表
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // 段落（连续空行分隔）
    .replace(/\n\n/g, "</p><p>")
    // 换行
    .replace(/\n/g, "<br>");

  // 包裹列表项
  html = html.replace(/(<li>.*?<\/li>)+/g, "<ul>$&</ul>");
  // 包裹段落
  html = `<p>${html}</p>`;
  // 清理空段落
  html = html.replace(/<p><\/p>/g, "").replace(/<p><br><\/p>/g, "");

  return html;
}

// ─── Rules Section (rendered inside project card or manage view) ───

export function renderRulesSection(props: ProjectsViewProps): TemplateResult {
  const project = props.activeProject;
  if (!project) {
    return html``;
  }

  return html`
    <div class="projects-rules">
      <div class="projects-rules__header">
        <h3 class="projects-rules__title">
          ${t("project.rules.title")}
          ${
            props.projectRules.length > 0
              ? html`<span class="projects-rules__count">(${props.projectRules.length})</span>`
              : nothing
          }
        </h3>
        <button
          class="btn btn--sm btn--primary"
          @click=${() => props.onOpenRuleCreateDialog()}
        >
          ${icons.plus}
          <span>${t("project.rules.create")}</span>
        </button>
      </div>

      ${
        props.projectRulesLoading
          ? html`<div class="projects-rules__loading">${t("action.loading")}</div>`
          : props.projectRules.length === 0
            ? renderRulesEmptyState(props)
            : renderRulesList(props)
      }
    </div>
  `;
}

function renderRulesEmptyState(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-rules__empty">
      <div class="projects-rules__empty-icon">${icons.fileText}</div>
      <div class="projects-rules__empty-title">${t("project.rules.empty.title")}</div>
      <div class="projects-rules__empty-desc">${t("project.rules.empty.description")}</div>
      <button
        class="btn btn--primary btn--sm"
        @click=${() => props.onOpenRuleCreateDialog()}
      >
        ${t("project.rules.empty.button")}
      </button>
    </div>
  `;
}

function renderRulesList(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-rules__list">
      ${props.projectRules.map((rule) => renderRuleItem(rule, props))}
    </div>
  `;
}

function renderRuleItem(rule: ProjectRule, props: ProjectsViewProps): TemplateResult {
  // 截取内容摘要（前 80 个字符）
  const summary = rule.content.length > 80 ? rule.content.substring(0, 80) + "..." : rule.content;

  return html`
    <div class="projects-rules__item">
      <div class="projects-rules__item-info">
        <div class="projects-rules__item-title">${icons.fileText} ${rule.title}</div>
        <div class="projects-rules__item-summary">${summary}</div>
      </div>
      <div class="projects-rules__item-actions">
        <button
          class="btn btn--sm"
          @click=${() => props.onOpenRuleEditDialog(rule)}
          title="${t("project.rules.edit")}"
        >
          ${t("project.rules.edit")}
        </button>
        <button
          class="btn btn--sm btn--danger-text"
          @click=${() => props.onOpenRuleDeleteDialog(rule.id, rule.title)}
          title="${t("project.rules.delete")}"
        >
          ${t("project.rules.delete")}
        </button>
      </div>
    </div>
  `;
}

// ─── Rule Create Dialog ───

function renderRuleCreateDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectRuleCreateDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseRuleCreateDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog projects-dialog--wide">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.rules.dialog.create.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseRuleCreateDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 规则标题 -->
          <div class="form-group">
            <label class="form-label">${t("project.rules.dialog.title.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.title}
              placeholder=${t("project.rules.dialog.title.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectRuleCreateDialog!.title = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
            <div class="form-hint">${t("project.rules.dialog.title.hint")}</div>
          </div>

          <!-- 编辑/预览 Tab -->
          <div class="form-group">
            <label class="form-label">${t("project.rules.dialog.content.label")} *</label>
            <div class="projects-rules__tabs">
              <button
                class="projects-rules__tab ${!dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleRuleCreatePreview(false)}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleRuleCreatePreview(true)}
              >
                ${t("project.rules.dialog.tab.preview")}
              </button>
            </div>

            ${
              dialog.previewMode
                ? html`
                <div class="projects-rules__preview markdown-body">
                  ${unsafeHTML(simpleMarkdownToHtml(dialog.content || t("project.rules.dialog.content.placeholder")))}
                </div>
              `
                : html`
                <textarea
                  class="form-input form-textarea projects-rules__editor"
                  .value=${dialog.content}
                  placeholder=${t("project.rules.dialog.content.placeholder")}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    props.projectRuleCreateDialog!.content = target.value;
                  }}
                  ?disabled=${dialog.isBusy}
                  rows="10"
                ></textarea>
              `
            }
            <div class="form-hint">${t("project.rules.dialog.content.hint")}</div>
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseRuleCreateDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.rules.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.title.trim() || !dialog.content.trim()}
            @click=${() => {
              props.onCreateRule(props.activeProject!.id, {
                title: dialog.title.trim(),
                content: dialog.content.trim(),
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.rules.dialog.create")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Rule Edit Dialog ───

function renderRuleEditDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectRuleEditDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseRuleEditDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog projects-dialog--wide">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.rules.dialog.edit.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseRuleEditDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 规则标题 -->
          <div class="form-group">
            <label class="form-label">${t("project.rules.dialog.title.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.title}
              placeholder=${t("project.rules.dialog.title.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectRuleEditDialog!.title = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
          </div>

          <!-- 编辑/预览 Tab -->
          <div class="form-group">
            <label class="form-label">${t("project.rules.dialog.content.label")} *</label>
            <div class="projects-rules__tabs">
              <button
                class="projects-rules__tab ${!dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleRuleEditPreview(false)}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleRuleEditPreview(true)}
              >
                ${t("project.rules.dialog.tab.preview")}
              </button>
            </div>

            ${
              dialog.previewMode
                ? html`
                <div class="projects-rules__preview markdown-body">
                  ${unsafeHTML(simpleMarkdownToHtml(dialog.content || ""))}
                </div>
              `
                : html`
                <textarea
                  class="form-input form-textarea projects-rules__editor"
                  .value=${dialog.content}
                  placeholder=${t("project.rules.dialog.content.placeholder")}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    props.projectRuleEditDialog!.content = target.value;
                  }}
                  ?disabled=${dialog.isBusy}
                  rows="10"
                ></textarea>
              `
            }
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseRuleEditDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.rules.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.title.trim() || !dialog.content.trim()}
            @click=${() => {
              props.onUpdateRule(props.activeProject!.id, dialog.ruleId, {
                title: dialog.title.trim(),
                content: dialog.content.trim(),
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.rules.dialog.save")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Rule Delete Dialog ───

function renderRuleDeleteDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectRuleDeleteDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="modal-card modal-card--danger">
        <div class="modal-header">
          <div class="modal-icon modal-icon--danger">
            ${icons.trash}
          </div>
          <div class="modal-title-group">
            <div class="modal-title">${t("project.rules.delete.title")}</div>
            <div class="modal-subtitle">${dialog.ruleTitle}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("project.rules.delete.confirm", { title: dialog.ruleTitle })}</div>
              <div class="warning-box__text">${t("project.rules.delete.hint")}</div>
            </div>
          </div>

          ${
            dialog.error
              ? html`
              <div class="modal-error">
                <span class="modal-error__icon">${icons.alertCircle}</span>
                <span>${dialog.error}</span>
              </div>
            `
              : nothing
          }
        </div>

        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onCloseRuleDeleteDialog()}
          >
            ${t("project.rules.delete.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onDeleteRule(props.activeProject!.id, dialog.ruleId)}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.rules.delete.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Skills Section (Rules Tab in Manage Dialog) ───

function renderManageSkillsTab(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-manage-dialog__rules">
      <div class="projects-manage-dialog__rules-header">
        <h4 class="projects-manage-dialog__section-title">
          ${t("project.skills.title")}
          ${
            props.projectSkills.length > 0
              ? html`<span class="projects-rules__count">(${props.projectSkills.length})</span>`
              : nothing
          }
        </h4>
        <button
          class="btn btn--sm btn--primary"
          @click=${() => props.onOpenSkillCreateDialog()}
        >
          ${icons.plus}
          <span>${t("project.skills.create")}</span>
        </button>
      </div>

      ${
        props.projectSkillsLoading
          ? html`<div class="projects-manage-dialog__loading">${t("action.loading")}</div>`
          : props.projectSkills.length === 0
            ? html`
              <div class="projects-rules__empty">
                <div class="projects-rules__empty-icon">${icons.fileText}</div>
                <div class="projects-rules__empty-title">${t("project.skills.empty.title")}</div>
                <div class="projects-rules__empty-desc">${t("project.skills.empty.description")}</div>
                <button
                  class="btn btn--primary btn--sm"
                  @click=${() => props.onOpenSkillCreateDialog()}
                >
                  ${t("project.skills.empty.button")}
                </button>
              </div>
            `
            : html`
              <div class="projects-rules__list">
                ${props.projectSkills.map((skill) => renderSkillItem(skill, props))}
              </div>
            `
      }
    </div>
  `;
}

function renderSkillItem(skill: ProjectSkill, props: ProjectsViewProps): TemplateResult {
  const summary =
    skill.content.length > 80 ? skill.content.substring(0, 80) + "..." : skill.content;

  return html`
    <div class="projects-rules__item">
      <div class="projects-rules__item-info">
        <div class="projects-rules__item-title">${icons.fileText} ${skill.name}</div>
        <div class="projects-rules__item-summary">${summary}</div>
      </div>
      <div class="projects-rules__item-actions">
        <button
          class="btn btn--sm"
          @click=${() => props.onOpenSkillEditDialog(skill)}
          title=${t("project.skills.edit")}
        >
          ${t("project.skills.edit")}
        </button>
        <button
          class="btn btn--sm btn--danger-text"
          @click=${() => props.onOpenSkillDeleteDialog(skill.id, skill.name)}
          title=${t("project.skills.delete")}
        >
          ${t("project.skills.delete")}
        </button>
      </div>
    </div>
  `;
}

// ─── Skill Create Dialog ───

function renderSkillCreateDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectSkillCreateDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  const previewHtml = dialog.content.trim() ? simpleMarkdownToHtml(dialog.content) : "";

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay--light")) {
          props.onCloseSkillCreateDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog projects-dialog--wide">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.skills.dialog.create.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseSkillCreateDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 技能名称 -->
          <div class="form-group">
            <label class="form-label">${t("project.skills.dialog.name.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.name}
              placeholder=${t("project.skills.dialog.name.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectSkillCreateDialog!.name = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
            <div class="form-hint">${t("project.skills.dialog.name.hint")}</div>
          </div>

          <!-- 编辑/预览 Tab -->
          <div class="form-group">
            <label class="form-label">${t("project.skills.dialog.content.label")} *</label>
            <div class="projects-rules__tabs">
              <button
                class="projects-rules__tab ${!dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleSkillCreatePreview(false)}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleSkillCreatePreview(true)}
              >
                ${t("project.rules.dialog.tab.preview")}
              </button>
            </div>

            ${
              dialog.previewMode
                ? html`
                <div class="projects-rules__preview markdown-body">
                  ${unsafeHTML(previewHtml || t("project.rules.dialog.content.placeholder"))}
                </div>
              `
                : html`
                <textarea
                  class="form-input form-textarea projects-rules__editor"
                  .value=${dialog.content}
                  placeholder=${t("project.skills.dialog.content.placeholder")}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    props.projectSkillCreateDialog!.content = target.value;
                  }}
                  ?disabled=${dialog.isBusy}
                  rows="10"
                ></textarea>
              `
            }
            <div class="form-hint">${t("project.skills.dialog.content.hint")}</div>
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseSkillCreateDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.rules.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.name.trim() || !dialog.content.trim()}
            @click=${() => {
              props.onCreateSkill(props.activeProject!.id, {
                name: dialog.name.trim(),
                content: dialog.content.trim(),
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.skills.dialog.create")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Skill Edit Dialog ───

function renderSkillEditDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectSkillEditDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  const previewHtml = dialog.content.trim() ? simpleMarkdownToHtml(dialog.content) : "";

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay--light")) {
          props.onCloseSkillEditDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog projects-dialog--wide">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.skills.dialog.edit.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseSkillEditDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 技能名称 -->
          <div class="form-group">
            <label class="form-label">${t("project.skills.dialog.name.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.name}
              placeholder=${t("project.skills.dialog.name.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectSkillEditDialog!.name = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
          </div>

          <!-- 编辑/预览 Tab -->
          <div class="form-group">
            <label class="form-label">${t("project.skills.dialog.content.label")} *</label>
            <div class="projects-rules__tabs">
              <button
                class="projects-rules__tab ${!dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleSkillEditPreview(false)}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleSkillEditPreview(true)}
              >
                ${t("project.rules.dialog.tab.preview")}
              </button>
            </div>

            ${
              dialog.previewMode
                ? html`
                <div class="projects-rules__preview markdown-body">
                  ${unsafeHTML(previewHtml || "")}
                </div>
              `
                : html`
                <textarea
                  class="form-input form-textarea projects-rules__editor"
                  .value=${dialog.content}
                  placeholder=${t("project.skills.dialog.content.placeholder")}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    props.projectSkillEditDialog!.content = target.value;
                  }}
                  ?disabled=${dialog.isBusy}
                  rows="10"
                ></textarea>
              `
            }
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseSkillEditDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.rules.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.name.trim() || !dialog.content.trim()}
            @click=${() => {
              props.onUpdateSkill(props.activeProject!.id, dialog.skillId, {
                name: dialog.name.trim(),
                content: dialog.content.trim(),
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.rules.dialog.save")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Skill Delete Dialog ───

function renderSkillDeleteDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectSkillDeleteDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="modal-card modal-card--danger">
        <div class="modal-header">
          <div class="modal-icon modal-icon--danger">
            ${icons.trash}
          </div>
          <div class="modal-title-group">
            <div class="modal-title">${t("project.skills.delete.title")}</div>
            <div class="modal-subtitle">${dialog.skillName}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("project.skills.delete.confirm", { title: dialog.skillName })}</div>
              <div class="warning-box__text">${t("project.skills.delete.hint")}</div>
            </div>
          </div>

          ${
            dialog.error
              ? html`
              <div class="modal-error">
                <span class="modal-error__icon">${icons.alertCircle}</span>
                <span>${dialog.error}</span>
              </div>
            `
              : nothing
          }
        </div>

        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onCloseSkillDeleteDialog()}
          >
            ${t("project.skills.delete.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onDeleteSkill(props.activeProject!.id, dialog.skillId)}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.skills.delete.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Docs Section (Manage Dialog) ───

function renderManageDocsTab(props: ProjectsViewProps): TemplateResult {
  return html`
    <div class="projects-manage-dialog__rules">
      <div class="projects-manage-dialog__rules-header">
        <h4 class="projects-manage-dialog__section-title">
          ${t("project.docs.title")}
          ${
            props.projectDocs.length > 0
              ? html`<span class="projects-rules__count">(${props.projectDocs.length})</span>`
              : nothing
          }
        </h4>
        <div class="projects-docs-header__actions">
          <button
            class="btn btn--sm btn--primary"
            @click=${() => props.onOpenDocCreateDialog()}
          >
            ${icons.plus}
            <span>${t("project.docs.create")}</span>
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${props.projectDocs.length === 0}
            @click=${() => props.onOpenDocExportDialog()}
            title=${t("project.docs.export")}
          >
            ${icons.download}
            <span>${t("project.docs.export")}</span>
          </button>
          <button
            class="btn btn--sm"
            @click=${() => props.onOpenDocImportDialog()}
            title=${t("project.docs.import")}
          >
            ${icons.upload}
            <span>${t("project.docs.import")}</span>
          </button>
        </div>
      </div>

      ${
        props.projectDocsLoading
          ? html`<div class="projects-manage-dialog__loading">${t("action.loading")}</div>`
          : props.projectDocs.length === 0
            ? html`
              <div class="projects-rules__empty">
                <div class="projects-rules__empty-icon">${icons.fileText}</div>
                <div class="projects-rules__empty-title">${t("project.docs.empty.title")}</div>
                <div class="projects-rules__empty-desc">${t("project.docs.empty.description")}</div>
                <button
                  class="btn btn--primary btn--sm"
                  @click=${() => props.onOpenDocCreateDialog()}
                >
                  ${t("project.docs.empty.button")}
                </button>
              </div>
            `
            : html`
              <div class="projects-rules__list">
                ${props.projectDocs.map((doc) => renderDocItem(doc, props))}
              </div>
            `
      }

      ${renderDocExportDialog(props)}
      ${renderDocImportDialog(props)}
    </div>
  `;
}

function renderDocItem(doc: ProjectDoc, props: ProjectsViewProps): TemplateResult {
  const summary = doc.content.length > 80 ? doc.content.substring(0, 80) + "..." : doc.content;

  return html`
    <div class="projects-rules__item">
      <div class="projects-rules__item-info">
        <div class="projects-rules__item-title">${icons.fileText} ${doc.name}</div>
        <div class="projects-rules__item-summary">${summary}</div>
      </div>
      <div class="projects-rules__item-actions">
        <button
          class="btn btn--sm"
          @click=${() => props.onOpenDocEditDialog(doc)}
          title=${t("project.docs.edit")}
        >
          ${t("project.docs.edit")}
        </button>
        <button
          class="btn btn--sm btn--danger-text"
          @click=${() => props.onOpenDocDeleteDialog(doc.id, doc.name)}
          title=${t("project.docs.delete")}
        >
          ${t("project.docs.delete")}
        </button>
      </div>
    </div>
  `;
}

// ─── Doc Create Dialog ───

function renderDocCreateDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectDocCreateDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  const previewHtml = dialog.content.trim() ? simpleMarkdownToHtml(dialog.content) : "";

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay--light")) {
          props.onCloseDocCreateDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog projects-dialog--wide">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.docs.dialog.create.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseDocCreateDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 文档名称 -->
          <div class="form-group">
            <label class="form-label">${t("project.docs.dialog.name.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.name}
              placeholder=${t("project.docs.dialog.name.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectDocCreateDialog!.name = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
            <div class="form-hint">${t("project.docs.dialog.name.hint")}</div>
          </div>

          <!-- 编辑/预览 Tab -->
          <div class="form-group">
            <label class="form-label">${t("project.docs.dialog.content.label")} *</label>
            <div class="projects-rules__tabs">
              <button
                class="projects-rules__tab ${!dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleDocCreatePreview(false)}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleDocCreatePreview(true)}
              >
                ${t("project.rules.dialog.tab.preview")}
              </button>
            </div>

            ${
              dialog.previewMode
                ? html`
                <div class="projects-rules__preview markdown-body">
                  ${unsafeHTML(previewHtml || t("project.rules.dialog.content.placeholder"))}
                </div>
              `
                : html`
                <textarea
                  class="form-input form-textarea projects-rules__editor"
                  .value=${dialog.content}
                  placeholder=${t("project.docs.dialog.content.placeholder")}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    props.projectDocCreateDialog!.content = target.value;
                  }}
                  ?disabled=${dialog.isBusy}
                  rows="10"
                ></textarea>
              `
            }
            <div class="form-hint">${t("project.docs.dialog.content.hint")}</div>
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseDocCreateDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.rules.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.name.trim() || !dialog.content.trim()}
            @click=${() => {
              props.onCreateDoc(props.activeProject!.id, {
                name: dialog.name.trim(),
                content: dialog.content.trim(),
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.docs.dialog.create")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Doc Edit Dialog ───

function renderDocEditDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectDocEditDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  const previewHtml = dialog.content.trim() ? simpleMarkdownToHtml(dialog.content) : "";

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay--light")) {
          props.onCloseDocEditDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog projects-dialog--wide">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.docs.dialog.edit.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseDocEditDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 文档名称 -->
          <div class="form-group">
            <label class="form-label">${t("project.docs.dialog.name.label")} *</label>
            <input
              class="form-input"
              type="text"
              .value=${dialog.name}
              placeholder=${t("project.docs.dialog.name.placeholder")}
              @input=${(e: Event) => {
                const target = e.target as HTMLInputElement;
                props.projectDocEditDialog!.name = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
          </div>

          <!-- 编辑/预览 Tab -->
          <div class="form-group">
            <label class="form-label">${t("project.docs.dialog.content.label")} *</label>
            <div class="projects-rules__tabs">
              <button
                class="projects-rules__tab ${!dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleDocEditPreview(false)}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => props.onToggleDocEditPreview(true)}
              >
                ${t("project.rules.dialog.tab.preview")}
              </button>
            </div>

            ${
              dialog.previewMode
                ? html`
                <div class="projects-rules__preview markdown-body">
                  ${unsafeHTML(previewHtml || "")}
                </div>
              `
                : html`
                <textarea
                  class="form-input form-textarea projects-rules__editor"
                  .value=${dialog.content}
                  placeholder=${t("project.docs.dialog.content.placeholder")}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    props.projectDocEditDialog!.content = target.value;
                  }}
                  ?disabled=${dialog.isBusy}
                  rows="10"
                ></textarea>
              `
            }
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseDocEditDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.rules.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.name.trim() || !dialog.content.trim()}
            @click=${() => {
              props.onUpdateDoc(props.activeProject!.id, dialog.docId, {
                name: dialog.name.trim(),
                content: dialog.content.trim(),
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.docs.dialog.save")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Doc Delete Dialog ───

function renderDocDeleteDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectDocDeleteDialog;
  if (!dialog || !props.activeProject) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="modal-card modal-card--danger">
        <div class="modal-header">
          <div class="modal-icon modal-icon--danger">
            ${icons.trash}
          </div>
          <div class="modal-title-group">
            <div class="modal-title">${t("project.docs.delete.title")}</div>
            <div class="modal-subtitle">${dialog.docName}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("project.docs.delete.confirm", { title: dialog.docName })}</div>
              <div class="warning-box__text">${t("project.docs.delete.hint")}</div>
            </div>
          </div>

          ${
            dialog.error
              ? html`
              <div class="modal-error">
                <span class="modal-error__icon">${icons.alertCircle}</span>
                <span>${dialog.error}</span>
              </div>
            `
              : nothing
          }
        </div>

        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onCloseDocDeleteDialog()}
          >
            ${t("project.docs.delete.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onDeleteDoc(props.activeProject!.id, dialog.docId)}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.docs.delete.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Doc Export Dialog ───

function renderDocExportDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectDocExportDialog;
  if (!dialog) {
    return nothing;
  }

  const allSelected = dialog.selectedDocIds.size === props.projectDocs.length;
  const noneSelected = dialog.selectedDocIds.size === 0;

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay--light")) {
          props.onCloseDocExportDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.docs.export.dialog.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseDocExportDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">
              ${t("project.docs.export.dialog.selectLabel")}
              (${dialog.selectedDocIds.size}/${props.projectDocs.length})
            </label>
            <div class="projects-docs-export__select-all">
              <label class="form-checkbox">
                <input
                  type="checkbox"
                  .checked=${allSelected}
                  @change=${() => props.onToggleDocExportSelectAll()}
                />
                <span>${t("project.docs.export.dialog.selectAll")}</span>
              </label>
            </div>
            <div class="projects-docs-export__doc-list">
              ${props.projectDocs.map(
                (doc) => html`
                  <label class="form-checkbox projects-docs-export__doc-item">
                    <input
                      type="checkbox"
                      .checked=${dialog.selectedDocIds.has(doc.id)}
                      @change=${() => props.onToggleDocExportSelection(doc.id)}
                    />
                    <span class="projects-docs-export__doc-name">${icons.fileText} ${doc.name}</span>
                  </label>
                `,
              )}
            </div>
          </div>

          ${
            dialog.error
              ? html`
              <div class="modal-error">
                <span class="modal-error__icon">${icons.alertCircle}</span>
                <span>${dialog.error}</span>
              </div>
            `
              : nothing
          }
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isExporting}
            @click=${() => props.onCloseDocExportDialog()}
          >
            ${t("project.docs.export.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${noneSelected || dialog.isExporting}
            @click=${() => props.onExportDocs()}
          >
            ${
              dialog.isExporting ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing
            }
            ${t("project.docs.export.dialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Doc Import Dialog ───

function renderDocImportDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectDocImportDialog;
  if (!dialog) {
    return nothing;
  }

  const conflictCount = dialog.previewDocs.filter((d) => d.hasConflict).length;

  return html`
    <div class="modal-overlay modal-overlay--light" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay--light")) {
          props.onCloseDocImportDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.docs.import.dialog.title")}</h3>
          <button class="modal-close" @click=${() => props.onCloseDocImportDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">${t("project.docs.import.dialog.file")}</label>
            <div class="projects-docs-import__filename">${dialog.fileName}</div>
          </div>

          ${
            dialog.previewDocs.length > 0
              ? html`
              <div class="form-group">
                <label class="form-label">
                  ${t("project.docs.import.dialog.containedDocs")}
                  (${dialog.previewDocs.length})
                </label>
                <div class="projects-docs-import__doc-list">
                  ${dialog.previewDocs.map(
                    (doc) => html`
                      <div class="projects-docs-import__doc-item ${doc.hasConflict ? "projects-docs-import__doc-item--conflict" : ""}">
                        <span class="projects-docs-import__doc-icon">${icons.fileText}</span>
                        <span class="projects-docs-import__doc-name">${doc.name}</span>
                        ${
                          doc.hasConflict
                            ? html`<span class="projects-docs-import__conflict-badge">${t("project.docs.import.dialog.conflict")}</span>`
                            : html`<span class="projects-docs-import__new-badge">${t("project.docs.import.dialog.newDoc")}</span>`
                        }
                      </div>
                    `,
                  )}
                </div>
              </div>
            `
              : nothing
          }

          ${
            conflictCount > 0
              ? html`
              <div class="form-group">
                <label class="form-label">${t("project.docs.import.dialog.conflictStrategy")}</label>
                <div class="projects-docs-import__strategy-options">
                  <label class="form-radio">
                    <input
                      type="radio"
                      name="conflictStrategy"
                      .checked=${dialog.conflictStrategy === "rename"}
                      @change=${() => props.onSetImportConflictStrategy("rename")}
                    />
                    <span>${t("project.docs.import.dialog.strategy.rename")}</span>
                  </label>
                  <label class="form-radio">
                    <input
                      type="radio"
                      name="conflictStrategy"
                      .checked=${dialog.conflictStrategy === "overwrite"}
                      @change=${() => props.onSetImportConflictStrategy("overwrite")}
                    />
                    <span>${t("project.docs.import.dialog.strategy.overwrite")}</span>
                  </label>
                  <label class="form-radio">
                    <input
                      type="radio"
                      name="conflictStrategy"
                      .checked=${dialog.conflictStrategy === "skip"}
                      @change=${() => props.onSetImportConflictStrategy("skip")}
                    />
                    <span>${t("project.docs.import.dialog.strategy.skip")}</span>
                  </label>
                </div>
              </div>
            `
              : nothing
          }

          ${
            dialog.error
              ? html`
              <div class="modal-error">
                <span class="modal-error__icon">${icons.alertCircle}</span>
                <span>${dialog.error}</span>
              </div>
            `
              : nothing
          }
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isImporting}
            @click=${() => props.onCloseDocImportDialog()}
          >
            ${t("project.docs.import.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isImporting || dialog.previewDocs.length === 0}
            @click=${() => props.onImportDocs()}
          >
            ${
              dialog.isImporting ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing
            }
            ${t("project.docs.import.dialog.confirm")}
          </button>
        </div>
      </div>
    </div>
  `;
}
