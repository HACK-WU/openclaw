/**
 * Project Management — View
 *
 * Renders the project management page: list, cards, create/edit/delete dialogs.
 * Follows the same patterns as views/group-chat.ts.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { GroupIndexEntry } from "../controllers/group-chat.ts";
import type {
  Project,
  ProjectCreateDialogState,
  ProjectDeleteDialogState,
  ProjectEditDialogState,
  ProjectIndexEntry,
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
      ${renderEditDialog(props)}
      ${renderDeleteDialog(props)}
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
