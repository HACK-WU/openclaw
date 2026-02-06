import { html, nothing } from "lit";
import type { SkillMessageMap } from "../controllers/skills.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import { clampText } from "../format.ts";
import { t } from "../i18n/index.ts";

type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

const SKILL_SOURCE_GROUPS: Array<{ id: string; labelKey: string; sources: string[] }> = [
  { id: "workspace", labelKey: "skills.workspace", sources: ["openclaw-workspace"] },
  { id: "built-in", labelKey: "skills.builtIn", sources: ["openclaw-bundled"] },
  { id: "installed", labelKey: "skills.installed", sources: ["openclaw-managed"] },
  { id: "extra", labelKey: "skills.extra", sources: ["openclaw-extra"] },
];

function groupSkills(skills: SkillStatusEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: t(def.labelKey), skills: [] });
  }
  const builtInGroup = SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in");
  const other: SkillGroup = { id: "other", label: t("skills.other"), skills: [] };
  for (const skill of skills) {
    const match = skill.bundled
      ? builtInGroup
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter(
    (group): group is SkillGroup => Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}

export type SkillsProps = {
  loading: boolean;
  report: SkillStatusReport | null;
  error: string | null;
  filter: string;
  edits: Record<string, string>;
  busyKey: string | null;
  messages: SkillMessageMap;
  // File editing props
  fileEditing: string | null;
  fileContent: string;
  fileOriginal: string;
  fileEditable: boolean;
  filePath: string;
  fileSaving: boolean;
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (skillKey: string, enabled: boolean) => void;
  onEdit: (skillKey: string, value: string) => void;
  onSaveKey: (skillKey: string) => void;
  onInstall: (skillKey: string, name: string, installId: string) => void;
  onEditFile: (skillKey: string) => void;
  onFileContentChange: (content: string) => void;
  onFileSave: () => void;
  onFileClose: () => void;
};

export function renderSkills(props: SkillsProps) {
  const skills = props.report?.skills ?? [];
  const filter = props.filter.trim().toLowerCase();
  const filtered = filter
    ? skills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : skills;
  const groups = groupSkills(filtered);
  const editingSkill = props.fileEditing
    ? skills.find((s) => s.skillKey === props.fileEditing)
    : null;
  const hasChanges = props.fileContent !== props.fileOriginal;

  return html`
    ${
      props.fileEditing
        ? html`
          <div class="modal-overlay" @click=${(e: Event) => {
            if (e.target === e.currentTarget) {
              props.onFileClose();
            }
          }}>
            <div class="modal modal--large">
              <div class="modal-header">
                <div class="modal-title">
                  ${editingSkill?.emoji ? `${editingSkill.emoji} ` : ""}${t("skills.editFile")}: ${editingSkill?.name ?? props.fileEditing}
                </div>
                <button class="btn btn--icon" @click=${props.onFileClose} title="${t("action.close")}">×</button>
              </div>
              <div class="modal-body">
                <div class="muted" style="margin-bottom: 8px; font-size: 12px;">
                  ${props.filePath}
                </div>
                ${
                  !props.fileEditable
                    ? html`<div class="callout warning" style="margin-bottom: 12px;">
                        ${t("skills.readOnly")}
                      </div>`
                    : nothing
                }
                <textarea
                  class="skill-file-editor"
                  .value=${props.fileContent}
                  @input=${(e: Event) => props.onFileContentChange((e.target as HTMLTextAreaElement).value)}
                  ?disabled=${!props.fileEditable || props.fileSaving}
                  spellcheck="false"
                ></textarea>
              </div>
              <div class="modal-footer">
                <button class="btn" @click=${props.onFileClose}>
                  ${t("action.cancel")}
                </button>
                ${
                  props.fileEditable
                    ? html`
                        <button
                          class="btn primary"
                          ?disabled=${props.fileSaving || !hasChanges}
                          @click=${props.onFileSave}
                        >
                          ${props.fileSaving ? t("action.loading") : t("action.save")}
                        </button>
                      `
                    : nothing
                }
              </div>
            </div>
          </div>
        `
        : nothing
    }
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("skills.title")}</div>
          <div class="card-sub">${t("skills.description")}</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? t("action.loading") : t("action.refresh")}
        </button>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1;">
          <span>${t("skills.filter")}</span>
          <div style="display: flex; gap: 8px;">
            <input
              style="flex: 1;"
              .value=${props.filter}
              @input=${(e: Event) => props.onFilterChange((e.target as HTMLInputElement).value)}
              placeholder="${t("skills.filter")}"
              autocomplete="new-password"
              data-lpignore="true"
              data-form-type="other"
            />
            <button class="btn secondary small" @click=${() => props.onFilterChange("")}>${t("action.clear")}</button>
          </div>
        </label>
        <div class="muted">${filtered.length} shown</div>
      </div>

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing
      }

      ${
        filtered.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">
                ${filter ? t("skills.noMatch") : t("skills.noSkills")}
              </div>
            `
          : html`
            <div class="agent-skills-groups" style="margin-top: 16px;">
              ${groups.map((group) => {
                const collapsedByDefault = group.id === "workspace" || group.id === "built-in";
                return html`
                  <details class="agent-skills-group" ?open=${!collapsedByDefault}>
                    <summary class="agent-skills-header">
                      <span>${group.label}</span>
                      <span class="muted">${group.skills.length}</span>
                    </summary>
                    <div class="list skills-grid">
                      ${group.skills.map((skill) => renderSkill(skill, props))}
                    </div>
                  </details>
                `;
              })}
            </div>
          `
      }
    </section>
  `;
}

function renderSkill(skill: SkillStatusEntry, props: SkillsProps) {
  const busy = props.busyKey === skill.skillKey;
  const apiKey = props.edits[skill.skillKey] ?? "";
  const message = props.messages[skill.skillKey] ?? null;
  const canInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const showBundledBadge = Boolean(skill.bundled && skill.source !== "openclaw-bundled");
  // Allow editing workspace and managed skills
  const canEdit =
    skill.source === "openclaw-workspace" || skill.source === "openclaw-managed" || !skill.bundled;
  const missing = [
    ...skill.missing.bins.map((b) => `bin:${b}`),
    ...skill.missing.env.map((e) => `env:${e}`),
    ...skill.missing.config.map((c) => `config:${c}`),
    ...skill.missing.os.map((o) => `os:${o}`),
  ];
  const reasons: string[] = [];
  if (skill.disabled) {
    reasons.push("disabled");
  }
  if (skill.blockedByAllowlist) {
    reasons.push("blocked by allowlist");
  }
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          ${skill.emoji ? `${skill.emoji} ` : ""}${skill.name}
        </div>
        <div class="list-sub">${clampText(skill.description, 140)}</div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${skill.source}</span>
          ${
            showBundledBadge
              ? html`
                  <span class="chip">bundled</span>
                `
              : nothing
          }
          <span class="chip ${skill.eligible ? "chip-ok" : "chip-warn"}">
            ${skill.eligible ? "eligible" : "blocked"}
          </span>
          ${
            skill.disabled
              ? html`
                  <span class="chip chip-warn">disabled</span>
                `
              : nothing
          }
        </div>
        ${
          missing.length > 0
            ? html`
              <div class="muted" style="margin-top: 6px;">
                Missing: ${missing.join(", ")}
              </div>
            `
            : nothing
        }
        ${
          reasons.length > 0
            ? html`
              <div class="muted" style="margin-top: 6px;">
                Reason: ${reasons.join(", ")}
              </div>
            `
            : nothing
        }
      </div>
      <div class="list-meta">
        <div class="row" style="justify-content: flex-end; flex-wrap: wrap; gap: 6px;">
          ${
            canEdit
              ? html`<button
                  class="btn"
                  ?disabled=${busy}
                  @click=${() => props.onEditFile(skill.skillKey)}
                  title="${t("skills.editFile")}"
                >
                  ${t("action.edit")}
                </button>`
              : nothing
          }
          <button
            class="btn"
            ?disabled=${busy}
            @click=${() => props.onToggle(skill.skillKey, skill.disabled)}
          >
            ${skill.disabled ? "Enable" : "Disable"}
          </button>
          ${
            canInstall
              ? html`<button
                class="btn"
                ?disabled=${busy}
                @click=${() => props.onInstall(skill.skillKey, skill.name, skill.install[0].id)}
              >
                ${busy ? "Installing…" : skill.install[0].label}
              </button>`
              : nothing
          }
        </div>
        ${
          message
            ? html`<div
              class="muted"
              style="margin-top: 8px; color: ${
                message.kind === "error"
                  ? "var(--danger-color, #d14343)"
                  : "var(--success-color, #0a7f5a)"
              };"
            >
              ${message.message}
            </div>`
            : nothing
        }
        ${
          skill.primaryEnv
            ? html`
              <div class="field" style="margin-top: 10px;">
                <span>API key</span>
                <input
                  type="password"
                  .value=${apiKey}
                  @input=${(e: Event) =>
                    props.onEdit(skill.skillKey, (e.target as HTMLInputElement).value)}
                />
              </div>
              <button
                class="btn primary"
                style="margin-top: 8px;"
                ?disabled=${busy}
                @click=${() => props.onSaveKey(skill.skillKey)}
              >
                Save key
              </button>
            `
            : nothing
        }
      </div>
    </div>
  `;
}
