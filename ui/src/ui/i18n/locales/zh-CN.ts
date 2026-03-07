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
  "overview.access.title": "网关访问",
  "overview.access.subtitle": "仪表板连接的位置及其身份验证方式。",
  "overview.access.wsUrl": "WebSocket URL",
  "overview.access.token": "网关令牌",
  "overview.access.password": "密码 (不存储)",
  "overview.access.sessionKey": "默认会话密钥",
  "overview.access.language": "语言",
  "overview.access.connectHint": "点击连接以应用连接更改。",
  "overview.access.trustedProxy": "通过受信任代理认证。",
  "overview.snapshot.title": "快照",
  "overview.snapshot.subtitle": "最新的网关握手信息。",
  "overview.snapshot.status": "状态",
  "overview.snapshot.uptime": "运行时间",
  "overview.snapshot.tickInterval": "刻度间隔",
  "overview.snapshot.lastChannelsRefresh": "最后频道刷新",
  "overview.snapshot.channelsHint":
    "使用频道链接 WhatsApp、Telegram、Discord、Signal 或 iMessage。",
  "overview.stats.instances": "实例",
  "overview.stats.instancesHint": "过去 5 分钟内的在线信号。",
  "overview.stats.sessions": "会话",
  "overview.stats.sessionsHint": "网关跟踪的最近会话密钥。",
  "overview.stats.cron": "定时任务",
  "overview.stats.cronNext": "下次唤醒 {time}",
  "overview.notes.title": "备注",
  "overview.notes.subtitle": "远程控制设置的快速提醒。",
  "overview.notes.tailscaleTitle": "Tailscale serve",
  "overview.notes.tailscaleText": "首选 serve 模式以通过 tailnet 身份验证将网关保持在回环地址。",
  "overview.notes.sessionTitle": "会话清理",
  "overview.notes.sessionText": "使用 /new 或 sessions.patch 重置上下文。",
  "overview.notes.cronTitle": "定时任务提醒",
  "overview.notes.cronText": "为重复运行使用隔离的会话。",
  "overview.auth.required": "此网关需要身份验证。添加令牌或密码，然后点击连接。",
  "overview.auth.failed":
    "身份验证失败。请使用 {command} 重新复制令牌化 URL，或更新令牌，然后点击连接。",
  "overview.pairing.hint": "此设备需要网关主机的配对批准。",
  "overview.pairing.mobileHint":
    "在手机上？从桌面运行 openclaw dashboard --no-open 复制完整 URL（包括 #token=...）。",
  "overview.insecure.hint":
    "此页面为 HTTP，因此浏览器阻止设备标识。请使用 HTTPS (Tailscale Serve) 或在网关主机上打开 {url}。",
  "overview.insecure.stayHttp": "如果您必须保持 HTTP，请设置 {config} (仅限令牌）。",

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

  // Chat Sessions Sidebar
  "chat.sidebar.title": "会话",
  "chat.sidebar.collapse": "收起侧边栏",
  "chat.sidebar.expand": "展开侧边栏",
  "chat.sidebar.noSessions": "未找到会话。",
  "chat.sidebar.loading": "加载会话中...",
  "chat.sidebar.offline": "离线",
  "chat.sidebar.moreCount": "还有 {count} 个",
  "chat.sidebar.deleteSession": "删除会话",
  "chat.sidebar.deleteConfirm": '删除会话 "{name}"?',
  "chat.sidebar.deleteConfirmDetail": "这将永久删除该会话及其聊天记录。",
  "chat.sidebar.sessionActions": "会话操作",
  "chat.sidebar.deleteWarningTitle": "此操作无法撤销",

  // 通用
  "common.cancel": "取消",
  "common.deleting": "删除中...",
  "common.delete": "删除",
  "common.na": "不适用",
  "common.connect": "连接",
  "common.refresh": "刷新",
  "common.enabled": "已启用",
  "common.disabled": "已禁用",
  "common.docs": "文档",
  "common.resources": "资源",
  "common.expand": "展开侧边栏",
  "common.collapse": "折叠侧边栏",

  // Language Selector
  "language.select": "语言",
  "language.en": "English",
  "language.zhCN": "简体中文",
  "language.zhTW": "繁體中文",
  "language.ptBR": "Português",

  // Languages (for backward compatibility)
  "languages.en": "English",
  "languages.zhCN": "简体中文",
  "languages.zhTW": "繁體中文",
  "languages.ptBR": "Português",

  // Group Chat
  "chat.group.title": "群聊",
  "chat.group.create": "创建群聊",
  "chat.group.createTitle": "创建群聊",
  "chat.group.noGroups": "暂无群聊。",
  "chat.group.members": "名成员",
  "chat.group.info": "群聊信息",
  "chat.group.groupName": "群聊名称",
  "chat.group.namePlaceholder": "输入群聊名称...",
  "chat.group.selectAgents": "选择智能体",
  "chat.group.messageMode": "消息模式",
  "chat.group.announcement": "公告",
  "chat.group.memberList": "成员列表",
  "chat.group.settings": "设置",
  "chat.group.placeholder": "输入消息...（使用 @agentId 提及）",
  "chat.group.send": "发送",
  "chat.group.abort": "停止",
  "chat.group.back": "返回",
  "chat.group.message": "消息",
  "chat.group.addMember": "添加成员",
  "chat.group.add": "添加",
  "chat.group.noAvailableAgents": "没有可添加的智能体。",
  "chat.group.noAnnouncement": "暂无公告",
  "chat.group.announcementPlaceholder": "输入群公告...",
  "chat.group.dangerZone": "危险区域",
  "chat.group.disband": "解散群聊",
  "chat.group.disbandConfirm": "确定要解散该群聊吗？此操作无法撤销。",
  "chat.group.generating": "生成中",

  // Errors
  "error.notFound": "未找到",
  "error.loadFailed": "加载失败",
  "error.saveFailed": "保存失败",
  "error.connectionFailed": "连接失败",
};
