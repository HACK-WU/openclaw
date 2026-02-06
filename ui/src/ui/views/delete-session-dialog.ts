import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import { t } from "../i18n/index.ts";
import { icons } from "../icons.ts";

export type DeleteSessionDialogState = {
  sessionKey: string;
  sessionName: string;
  isDeleting: boolean;
  error: string | null;
};

export function renderDeleteSessionDialog(
  state: AppViewState & {
    deleteSessionDialog: DeleteSessionDialogState | null;
    handleDeleteSessionConfirm: () => Promise<void>;
    handleDeleteSessionCancel: () => void;
  },
) {
  const dialog = state.deleteSessionDialog;
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
            <div class="modal-title">${t("chat.sidebar.deleteSession")}</div>
            <div class="modal-subtitle">${dialog.sessionName || dialog.sessionKey}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("chat.sidebar.deleteWarningTitle")}</div>
              <div class="warning-box__text">${t("chat.sidebar.deleteConfirmDetail")}</div>
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
            ?disabled=${dialog.isDeleting}
            @click=${() => state.handleDeleteSessionCancel()}
          >
            ${t("common.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isDeleting}
            @click=${() => state.handleDeleteSessionConfirm()}
          >
            ${
              dialog.isDeleting
                ? html`
                  <span class="btn__spinner">${icons.loader}</span>
                  <span>${t("common.deleting")}</span>
                `
                : html`<span>${t("chat.sidebar.deleteSession")}</span>`
            }
          </button>
        </div>
      </div>
    </div>
  `;
}
