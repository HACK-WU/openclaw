/**
 * Personality Selector Component
 *
 * Renders a personality selection UI for CLI Agent creation.
 */

import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { PersonalityMeta, Personality } from "../controllers/agents.ts";
import { t } from "../i18n/index.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";

export type PersonalitySelectorProps = {
  personalities: PersonalityMeta[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string | null) => void;
  onView: (id: string) => void;
};

export function renderPersonalitySelector(props: PersonalitySelectorProps) {
  const { personalities, selectedId, loading, error, onSelect, onView } = props;

  return html`
    <div class="personality-selector">
      <label class="field">
        <span>${t("personality.title")}</span>
        ${
          loading
            ? html`<div class="personality-selector__loading">${t("status.loading")}</div>`
            : error
              ? html`<div class="personality-selector__error">${error}</div>`
              : html`
                <div class="personality-selector__dropdown-row" style="display: flex; gap: 8px; align-items: flex-start; flex-wrap: nowrap;">
                  <select
                    class="field personality-selector__select"
                    style="flex: 1; min-width: 0; max-width: 100%;"
                    .value=${selectedId ?? ""}
                    @change=${(e: Event) => {
                      const value = (e.target as HTMLSelectElement).value;
                      onSelect(value === "" ? null : value);
                    }}
                  >
                    <option value="">${t("personality.none")} - ${t("personality.noneDesc")}</option>
                    ${personalities.map(
                      (p) => html`
                        <option value=${p.id} ?selected=${selectedId === p.id}>
                          ${p.name}
                        </option>
                      `,
                    )}
                  </select>
                  ${
                    selectedId !== null
                      ? html`
                        <button
                          type="button"
                          class="btn btn--sm btn--secondary personality-selector__preview-btn"
                          style="white-space: nowrap;"
                          @click=${() => {
                            if (selectedId) {
                              onView(selectedId);
                            }
                          }}
                        >
                          ${t("personality.preview")}
                        </button>
                      `
                      : nothing
                  }
                </div>
              `
        }
      </label>
    </div>
  `;
}

export type PersonalityViewDialogProps = {
  open: boolean;
  personality: Personality | null;
  onClose: () => void;
};

export function renderPersonalityViewDialog(props: PersonalityViewDialogProps) {
  const { open, personality, onClose } = props;

  if (!open || !personality) {
    return nothing;
  }

  // Render full personality content as Markdown
  const renderedContent = toSanitizedMarkdownHtml(personality.content);

  return html`
    <div
      class="personality-preview-overlay"
      role="dialog"
      aria-modal="true"
      @click=${onClose}
      style="
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      "
    >
      <div
        class="personality-preview-card"
        @click=${(e: Event) => e.stopPropagation()}
        style="
          background: var(--surface, #fff);
          border-radius: 12px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
          width: 100%;
          max-width: 800px;
          max-height: calc(100vh - 48px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        "
      >
        <div
          class="personality-preview-header"
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid var(--border, #e0e0e0);
          "
        >
          <h3 style="margin: 0; font-size: 18px; font-weight: 600;">${personality.name}</h3>
          <button
            class="btn btn--sm btn--icon"
            @click=${onClose}
            style="font-size: 20px; padding: 4px 8px;"
          >
            ✕
          </button>
        </div>
        <div
          class="personality-preview-body"
          style="
            flex: 1;
            overflow-y: auto;
            padding: 24px;
          "
        >
          <div class="markdown-content">${unsafeHTML(renderedContent)}</div>
        </div>
        <div
          class="personality-preview-footer"
          style="
            display: flex;
            justify-content: flex-end;
            padding: 16px 24px;
            border-top: 1px solid var(--border, #e0e0e0);
            gap: 12px;
          "
        >
          <button class="btn btn--primary" @click=${onClose}>${t("personality.close")}</button>
        </div>
      </div>
    </div>
  `;
}
