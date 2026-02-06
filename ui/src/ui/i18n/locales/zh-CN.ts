/**
 * Simplified Chinese translations (简体中文)
 */
export const zhCN: Record<string, string> = {
  // App
  "app.title": "OpenClaw",
  "app.subtitle": "网关控制台",

  // Navigation - Tab Groups
  "nav.group.chat": "对话",
  "nav.group.control": "控制",
  "nav.group.agent": "智能体",
  "nav.group.settings": "设置",
  "nav.group.resources": "资源",

  // Navigation - Tabs
  "nav.chat": "对话",
  "nav.overview": "概览",
  "nav.channels": "频道",
  "nav.instances": "实例",
  "nav.sessions": "会话",
  "nav.usage": "用量",
  "nav.cron": "定时任务",
  "nav.agents": "智能体",
  "nav.skills": "技能",
  "nav.nodes": "节点",
  "nav.config": "配置",
  "nav.debug": "调试",
  "nav.logs": "日志",
  "nav.docs": "文档",

  // Navigation - Subtitles
  "nav.subtitle.chat": "直接与网关对话，快速进行干预操作。",
  "nav.subtitle.overview": "网关状态、入口点和快速健康检查。",
  "nav.subtitle.channels": "管理频道和设置。",
  "nav.subtitle.instances": "已连接客户端和节点的在线状态。",
  "nav.subtitle.sessions": "检查活跃会话并调整会话默认设置。",
  "nav.subtitle.usage": "",
  "nav.subtitle.cron": "安排唤醒和定期智能体运行。",
  "nav.subtitle.agents": "管理智能体工作空间、工具和身份。",
  "nav.subtitle.skills": "管理技能可用性和 API 密钥注入。",
  "nav.subtitle.nodes": "已配对设备、功能和命令暴露。",
  "nav.subtitle.config": "安全编辑 ~/.openclaw/openclaw.json。",
  "nav.subtitle.debug": "网关快照、事件和手动 RPC 调用。",
  "nav.subtitle.logs": "实时查看网关日志文件。",

  // Skills Page
  "skills.title": "技能",
  "skills.description": "内置、托管和工作空间技能。",
  "skills.filter": "筛选",
  "skills.noSkills": "未找到技能。",
  "skills.noMatch": "没有匹配的技能，请尝试清空筛选条件。",
  "skills.workspace": "工作空间技能",
  "skills.builtIn": "内置技能",
  "skills.installed": "已安装技能",
  "skills.extra": "额外技能",
  "skills.other": "其他技能",
  "skills.perAgent": "智能体技能白名单和工作空间技能。",
  "skills.loadConfig": "加载网关配置以设置智能体技能。",
  "skills.allSkills": "全部技能",
  "skills.selected": "已选择 {count} 个",
  "skills.editFile": "编辑文件",
  "skills.readOnly": "此技能文件为只读，无法修改。",

  // Common Actions
  "action.refresh": "刷新",
  "action.save": "保存",
  "action.cancel": "取消",
  "action.delete": "删除",
  "action.edit": "编辑",
  "action.add": "添加",
  "action.close": "关闭",
  "action.submit": "提交",
  "action.loading": "加载中...",
  "action.clear": "清除",
  "action.disableAll": "全部禁用",
  "action.enableAll": "全部启用",

  // Common Status
  "status.connected": "已连接",
  "status.disconnected": "已断开",
  "status.connecting": "连接中...",
  "status.error": "错误",
  "status.loading": "加载中",
  "status.ready": "就绪",
  "status.enabled": "已启用",
  "status.disabled": "已禁用",

  // Agents Page
  "agents.title": "智能体",
  "agents.overview": "概览",
  "agents.files": "文件",
  "agents.tools": "工具",
  "agents.skills": "技能",
  "agents.channels": "频道",
  "agents.cron": "定时任务",
  "agents.skillsFilter": "技能筛选",

  // Config Page
  "config.title": "配置",
  "config.description": "安全编辑 ~/.openclaw/openclaw.json。",

  // Debug Page
  "debug.title": "调试",
  "debug.description": "网关快照、事件和手动 RPC 调用。",

  // Logs Page
  "logs.title": "日志",
  "logs.description": "实时查看网关日志文件。",

  // Overview Page
  "overview.title": "概览",
  "overview.description": "网关状态、入口点和快速健康检查。",

  // Channels Page
  "channels.title": "频道",
  "channels.description": "管理频道和设置。",

  // Instances Page
  "instances.title": "实例",
  "instances.description": "已连接客户端和节点的在线状态。",

  // Sessions Page
  "sessions.title": "会话",
  "sessions.description": "检查活跃会话并调整会话默认设置。",

  // Usage Page
  "usage.title": "用量",

  // Cron Page
  "cron.title": "定时任务",
  "cron.description": "安排唤醒和定期智能体运行。",

  // Nodes Page
  "nodes.title": "节点",
  "nodes.description": "已配对设备、功能和命令暴露。",

  // Language Selector
  "language.select": "语言",
  "language.en": "English",
  "language.zhCN": "简体中文",

  // Errors
  "error.notFound": "未找到",
  "error.loadFailed": "加载失败",
  "error.saveFailed": "保存失败",
  "error.connectionFailed": "连接失败",
};
