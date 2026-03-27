/**
 * Project Management — View
 *
 * Renders the project management page: list, cards, create/edit/delete dialogs.
 * Follows the same patterns as views/group-chat.ts.
 */

import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { GroupIndexEntry } from "../controllers/group-chat.ts";
import type {
  Project,
  ProjectCreateDialogState,
  ProjectDeleteDialogState,
  ProjectEditDialogState,
  ProjectIndexEntry,
  ProjectRule,
  ProjectRuleCreateDialogState,
  ProjectRuleDeleteDialogState,
  ProjectRuleEditDialogState,
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
  projectError: string | null;
  // 群聊信息（用于显示关联群聊数量）
  groupIndex: GroupIndexEntry[];
  // 规则管理状态
  projectRules: ProjectRule[];
  projectRulesLoading: boolean;
  projectRuleCreateDialog: ProjectRuleCreateDialogState | null;
  projectRuleEditDialog: ProjectRuleEditDialogState | null;
  projectRuleDeleteDialog: ProjectRuleDeleteDialogState | null;
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
  onOpenEditDialog: (project: Project) => void;
  onCloseEditDialog: () => void;
  onUpdateProject: (
    projectId: string,
    params: { directory?: string; documents?: string[]; description?: string },
  ) => void;
  onOpenDeleteDialog: (projectId: string, projectName: string) => void;
  onCloseDeleteDialog: () => void;
  onDeleteProject: (projectId: string) => void;
  onValidatePaths: (paths: string[], type: "directory" | "file") => Promise<ValidationResult[]>;
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

      ${props.activeProject ? renderRulesSection(props) : nothing}

      ${renderCreateDialog(props)}
      ${renderEditDialog(props)}
      ${renderDeleteDialog(props)}
      ${renderRuleCreateDialog(props)}
      ${renderRuleEditDialog(props)}
      ${renderRuleDeleteDialog(props)}
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
          @click=${() => {
            props.onLoadProjectInfo(project.id);
            props.onLoadProjectRules(project.id);
          }}
          title="${t("project.card.manage")}"
        >
          ${t("project.card.manage")}
        </button>
        <button
          class="btn btn--sm"
          @click=${async () => {
            // 加载完整项目信息后打开编辑对话框
            if (!props.activeProject || props.activeProject.id !== project.id) {
              props.onLoadProjectInfo(project.id);
              // 等待一小段时间让数据加载
              await new Promise((r) => setTimeout(r, 200));
            }
            if (props.activeProject && props.activeProject.id === project.id) {
              props.onOpenEditDialog(props.activeProject);
            }
          }}
          title="${t("project.card.edit")}"
        >
          ${t("project.card.edit")}
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

// ─── Edit Dialog ───

function renderEditDialog(props: ProjectsViewProps): TemplateResult | typeof nothing {
  const dialog = props.projectEditDialog;
  if (!dialog) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseEditDialog();
        }
      }}
    >
      <div class="modal-card projects-dialog">
        <div class="modal-header">
          <h3 class="modal-title">${t("project.dialog.edit.title", { name: dialog.name })}</h3>
          <button class="modal-close" @click=${() => props.onCloseEditDialog()}>
            ${icons.x}
          </button>
        </div>
        <div class="modal-body">
          <!-- 项目名称（不可编辑） -->
          <div class="form-group">
            <label class="form-label">${t("project.dialog.name.label")}</label>
            <input
              class="form-input form-input--disabled"
              type="text"
              .value=${dialog.name}
              disabled
            />
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
                props.projectEditDialog!.directory = target.value;
              }}
              ?disabled=${dialog.isBusy}
            />
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
                props.projectEditDialog!.documents = target.value;
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
                props.projectEditDialog!.description = target.value;
              }}
              ?disabled=${dialog.isBusy}
              rows="3"
            ></textarea>
          </div>

          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseEditDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("project.dialog.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || !dialog.directory.trim()}
            @click=${() => {
              const docs = dialog.documents
                .split(",")
                .map((d) => d.trim())
                .filter(Boolean);
              props.onUpdateProject(dialog.projectId, {
                directory: dialog.directory.trim(),
                documents: docs,
                description: dialog.description.trim() || undefined,
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("project.dialog.save")}
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
    <div class="modal-overlay" role="dialog" aria-modal="true"
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
                @click=${() => {
                  props.projectRuleCreateDialog!.previewMode = false;
                }}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => {
                  props.projectRuleCreateDialog!.previewMode = true;
                }}
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
    <div class="modal-overlay" role="dialog" aria-modal="true"
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
                @click=${() => {
                  props.projectRuleEditDialog!.previewMode = false;
                }}
              >
                ${t("project.rules.dialog.tab.edit")}
              </button>
              <button
                class="projects-rules__tab ${dialog.previewMode ? "projects-rules__tab--active" : ""}"
                @click=${() => {
                  props.projectRuleEditDialog!.previewMode = true;
                }}
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
