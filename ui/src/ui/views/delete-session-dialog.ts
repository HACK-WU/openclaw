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

/**
 * 渲染删除会话确认对话框
 *
 * @param state - 应用视图状态，包含以下字段：
 *   - deleteSessionDialog: 对话框状态对象，为null时不显示对话框
 *   - handleDeleteSessionConfirm: 确认删除的处理函数
 *   - handleDeleteSessionCancel: 取消删除的处理函数
 * @returns LitElement HTML模板或nothing
 */
export function renderDeleteSessionDialog(
  state: AppViewState & {
    deleteSessionDialog: DeleteSessionDialogState | null;
    handleDeleteSessionConfirm: () => Promise<void>;
    handleDeleteSessionCancel: () => void;
  },
) {
  // 获取对话框状态对象
  const dialog = state.deleteSessionDialog;

  // 如果对话框状态为null，说明对话框未打开，返回nothing不渲染任何内容
  if (!dialog) {
    return nothing;
  }

  // 返回对话框HTML模板
  return html`
    <!-- 模态遮罩层 -->
    <!-- role="dialog": 标识这是一个对话框 -->
    <!-- aria-modal="true": 表示这是一个模态对话框，会阻塞背景交互 -->
    <!-- aria-live="polite": 当内容变化时温和地通知屏幕阅读器 -->
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-live="polite">
      
      <!-- 危险类型的模态卡片容器 -->
      <div class="modal-card modal-card--danger">
        
        <!-- 对话框头部区域 -->
        <div class="modal-header">
          <!-- 危险图标（垃圾桶） -->
          <div class="modal-icon modal-icon--danger">
            ${icons.trash}
          </div>
          
          <!-- 标题组：包含主标题和副标题 -->
          <div class="modal-title-group">
            <!-- 主标题：国际化文本 "删除会话" -->
            <div class="modal-title">${t("chat.sidebar.deleteSession")}</div>
            <!-- 副标题：显示会话名称或会话键（优先显示名称） -->
            <div class="modal-subtitle">${dialog.sessionName || dialog.sessionKey}</div>
          </div>
        </div>

        <!-- 对话框主体内容区域 -->
        <div class="modal-body">
          
          <!-- 警告提示框：提醒用户此操作的严重性 -->
          <div class="warning-box">
            <!-- 警告图标（三角形警告符号） -->
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <!-- 警告内容 -->
            <div class="warning-box__content">
              <!-- 警告标题 -->
              <div class="warning-box__title">${t("chat.sidebar.deleteWarningTitle")}</div>
              <!-- 警告详情文本 -->
              <div class="warning-box__text">${t("chat.sidebar.deleteConfirmDetail")}</div>
            </div>
          </div>

          <!-- 条件渲染：如果存在错误信息，显示错误提示框 -->
          ${
            dialog.error
              ? html`
                <!-- 错误提示框 -->
                <div class="modal-error">
                  <!-- 错误图标（圆形警告符号） -->
                  <span class="modal-error__icon">${icons.alertCircle}</span>
                  <!-- 错误消息文本 -->
                  <span>${dialog.error}</span>
                </div>
              `
              : nothing
          }
        </div>

        <!-- 对话框操作按钮区域 -->
        <div class="modal-actions">
          
          <!-- 取消按钮 -->
          <button
            class="btn btn--secondary"
            ?disabled=${
              // 没有错误时不渲染任何内容
              dialog.isDeleting
            }
            @click=${() => state.handleDeleteSessionCancel()}
          >
            ${t("common.cancel")}
          </button>
          
          <!-- 确认删除按钮 -->
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isDeleting}
            @click=${() => state.handleDeleteSessionConfirm()}
          >
            <!-- 条件渲染：根据删除状态显示不同的按钮内容 -->
            ${
              dialog.isDeleting
                ? html`
                  <!-- 删除中状态：显示加载图标和"删除中..."文本 -->
                  <span class="btn__spinner">${icons.loader}</span>
                  <span>${t("common.deleting")}</span>
                `
                : html`<!-- 正常状态：显示"删除会话"文本 -->
                      <span>${t("chat.sidebar.deleteSession")}</span>`
            }
          </button>
        </div>
      </div>
    </div>
  `;
}
