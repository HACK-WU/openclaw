import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";
import { toNumber } from "../format.ts";

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
};

/**
 * 加载会话列表
 *
 * 从后端服务器获取会话列表数据，并更新应用状态。
 * 支持多种过滤条件和配置选项，用于不同的业务场景。
 *
 * @param state - 应用状态对象，包含客户端连接信息和会话相关状态
 * @param overrides - 可选的参数覆盖配置
 *   - activeMinutes: 活跃时间过滤（分钟数），0表示不过滤
 *   - limit: 返回结果数量限制，0表示不限制
 *   - includeGlobal: 是否包含全局会话
 *   - includeUnknown: 是否包含未知类型的会话
 *
 * 工作流程：
 * 1. 检查前置条件（客户端连接、加载状态）
 * 2. 设置加载状态并清空错误信息
 * 3. 构建查询参数（结合默认值和覆盖值）
 * 4. 调用后端API获取会话列表
 * 5. 更新应用状态或记录错误信息
 * 6. 重置加载状态
 *
 * 使用场景：
 * - 应用初始化时加载会话列表
 * - 删除会话后刷新列表
 * - 修改过滤条件后重新查询
 * - 切换筛选选项时更新数据
 */
export async function loadSessions(
  state: SessionsState,
  overrides?: {
    activeMinutes?: number;
    limit?: number;
    includeGlobal?: boolean;
    includeUnknown?: boolean;
  },
) {
  // 前置条件检查1：确保客户端对象已初始化
  if (!state.client || !state.connected) {
    return;
  }

  // 前置条件检查2：防止重复加载
  // 如果已经有加载任务在进行中，直接返回，避免并发请求导致的状态混乱
  if (state.sessionsLoading) {
    return;
  }

  // 设置加载状态
  // 1. sessionsLoading = true: 触发UI显示加载动画，并阻止新的加载请求
  // 2. sessionsError = null: 清空之前的错误信息（如果有），准备新的加载操作
  state.sessionsLoading = true;
  state.sessionsError = null;

  try {
    // 构建查询参数
    // 优先使用 overrides 中的值，如果没有提供则使用状态中的默认值

    // includeGlobal: 是否包含全局会话（跨用户的会话）
    const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;

    // includeUnknown: 是否包含未知类型的会话（系统未识别的会话类型）
    const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;

    // activeMinutes: 活跃时间过滤，只返回最近N分钟内有活动的会话
    // 0 或负值表示不进行时间过滤
    const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);

    // limit: 返回结果数量限制，用于分页或性能优化
    // 0 表示不限制返回数量
    const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);

    // 构建API请求参数对象
    const params: Record<string, unknown> = {
      includeGlobal,
      includeUnknown,
    };

    // 只有当 activeMinutes > 0 时才添加到参数中
    // 这样可以避免向后端传递无效的0值或负值
    if (activeMinutes > 0) {
      params.activeMinutes = activeMinutes;
    }

    // 只有当 limit > 0 时才添加到参数中
    // 这样可以避免向后端传递无效的限制值
    if (limit > 0) {
      params.limit = limit;
    }

    // 调用后端API获取会话列表
    // API方法名: "sessions.list"
    // 返回类型: SessionsListResult | undefined (会话列表结果或undefined)
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);

    // 如果API返回了有效结果，更新应用状态
    // 这会触发UI的重新渲染，显示新的会话列表
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    // 捕获并处理加载过程中的错误
    // 将错误信息转换为字符串并存储在状态中
    // UI会读取这个错误信息并显示给用户
    state.sessionsError = String(err);
  } finally {
    // 无论成功还是失败，都必须重置加载状态
    // 这样新的加载请求才能被执行
    state.sessionsLoading = false;
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function deleteSession(state: SessionsState, key: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  const confirmed = window.confirm(
    `Delete session "${key}"?\n\nDeletes the session entry and archives its transcript.`,
  );
  if (!confirmed) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    await state.client.request("sessions.delete", { key, deleteTranscript: true });
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
  }
}
