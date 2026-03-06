/**
 * Traditional Chinese translations (繁體中文)
 */
export const zhTW: Record<string, string> = {
  // App
  "app.title": "OpenClaw",
  "app.subtitle": "網關控制台",

  // Navigation - Tab Groups
  "nav.group.chat": "對話",
  "nav.group.control": "控制",
  "nav.group.agent": "智能體",
  "nav.group.settings": "設置",
  "nav.group.resources": "資源",

  // Navigation - Tabs
  "nav.chat": "對話",
  "nav.overview": "概覽",
  "nav.channels": "頻道",
  "nav.instances": "實例",
  "nav.sessions": "會話",
  "nav.usage": "使用情況",
  "nav.cron": "定時任務",
  "nav.agents": "智能體",
  "nav.skills": "技能",
  "nav.nodes": "節點",
  "nav.config": "配置",
  "nav.debug": "調試",
  "nav.logs": "日誌",
  "nav.docs": "文檔",

  // Navigation - Subtitles
  "nav.subtitle.chat": "用於快速干預的直接網關聊天會話。",
  "nav.subtitle.overview": "網關狀態、入口點和快速健康讀取。",
  "nav.subtitle.channels": "管理頻道和設置。",
  "nav.subtitle.instances": "來自已連接客戶端和節點的在線信號。",
  "nav.subtitle.sessions": "檢查活動會話並調整每個會話的默認設置。",
  "nav.subtitle.usage": "",
  "nav.subtitle.cron": "安排喚醒和重複的智能體運行。",
  "nav.subtitle.agents": "管理智能體工作區、工具和身份。",
  "nav.subtitle.skills": "管理技能可用性和 API 密鑰注入。",
  "nav.subtitle.nodes": "配對設備、功能和命令公開。",
  "nav.subtitle.config": "安全地編輯 ~/.openclaw/openclaw.json。",
  "nav.subtitle.debug": "網關快照、事件和手動 RPC 調用。",
  "nav.subtitle.logs": "網關文件日誌的實時追蹤。",

  // Skills Page
  "skills.title": "技能",
  "skills.description": "內置、托管和工作區技能。",
  "skills.filter": "篩選",
  "skills.noSkills": "未找到技能。",
  "skills.noMatch": "沒有匹配的技能，請嘗試清空篩選條件。",
  "skills.workspace": "工作區技能",
  "skills.builtIn": "內置技能",
  "skills.installed": "已安裝技能",
  "skills.extra": "額外技能",
  "skills.other": "其他技能",
  "skills.perAgent": "每個智能體的技能白名單和工作區技能。",
  "skills.loadConfig": "加載網關配置以設置每個智能體的技能。",
  "skills.allSkills": "全部技能",
  "skills.selected": "已選擇 {count} 個",
  "skills.editFile": "編輯文件",
  "skills.readOnly": "此技能文件為只讀，無法修改。",

  // Common Actions
  "action.refresh": "刷新",
  "action.save": "保存",
  "action.cancel": "取消",
  "action.delete": "刪除",
  "action.edit": "編輯",
  "action.add": "添加",
  "action.close": "關閉",
  "action.submit": "提交",
  "action.loading": "加載中...",
  "action.clear": "清除",
  "action.disableAll": "全部禁用",
  "action.enableAll": "全部啟用",

  // Common Status
  "status.connected": "已連接",
  "status.disconnected": "已斷開",
  "status.connecting": "連接中...",
  "status.error": "錯誤",
  "status.loading": "加載中",
  "status.ready": "就緒",
  "status.enabled": "已啟用",
  "status.disabled": "已禁用",

  // Agents Page
  "agents.title": "智能體",
  "agents.overview": "概覽",
  "agents.files": "文件",
  "agents.tools": "工具",
  "agents.skills": "技能",
  "agents.channels": "頻道",
  "agents.cron": "定時任務",
  "agents.skillsFilter": "技能篩選",

  // Config Page
  "config.title": "配置",
  "config.description": "安全地編輯 ~/.openclaw/openclaw.json。",

  // Debug Page
  "debug.title": "調試",
  "debug.description": "網關快照、事件和手動 RPC 調用。",

  // Logs Page
  "logs.title": "日誌",
  "logs.description": "實時查看網關日誌文件。",

  // Overview Page
  "overview.title": "概覽",
  "overview.description": "網關狀態、入口點和快速健康檢查。",

  // Overview Page - Access Section
  "overview.access.title": "網關訪問",
  "overview.access.subtitle": "儀表板連接的位置及其身份驗證方式。",
  "overview.access.wsUrl": "WebSocket URL",
  "overview.access.token": "網關令牌",
  "overview.access.password": "密碼 (不存儲)",
  "overview.access.sessionKey": "默認會話密鑰",
  "overview.access.language": "語言",
  "overview.access.connectHint": "點擊連接以應用連接更改。",
  "overview.access.trustedProxy": "通過受信任代理身份驗證。",

  // Overview Page - Snapshot Section
  "overview.snapshot.title": "快照",
  "overview.snapshot.subtitle": "最新的網關握手信息。",
  "overview.snapshot.status": "狀態",
  "overview.snapshot.uptime": "運行時間",
  "overview.snapshot.tickInterval": "刻度間隔",
  "overview.snapshot.lastChannelsRefresh": "最後頻道刷新",
  "overview.snapshot.channelsHint":
    "使用頻道鏈接 WhatsApp、Telegram、Discord、Signal 或 iMessage。",

  // Overview Page - Stats Section
  "overview.stats.instances": "實例",
  "overview.stats.instancesHint": "過去 5 分鐘內的在線信號。",
  "overview.stats.sessions": "會話",
  "overview.stats.sessionsHint": "網關跟蹤的最近會話密鑰。",
  "overview.stats.cron": "定時任務",
  "overview.stats.cronNext": "下次喚醒 {time}",

  // Overview Page - Notes Section
  "overview.notes.title": "備註",
  "overview.notes.subtitle": "遠程控制設置的快速提醒。",
  "overview.notes.tailscaleTitle": "Tailscale serve",
  "overview.notes.tailscaleText": "首選 serve 模式以通過 tailnet 身份驗證將網關保持在回環地址。",
  "overview.notes.sessionTitle": "會話清理",
  "overview.notes.sessionText": "使用 /new 或 sessions.patch 重置上下文。",
  "overview.notes.cronTitle": "定時任務提醒",
  "overview.notes.cronText": "為重複運行使用隔離的會話。",

  // Overview Page - Auth Section
  "overview.auth.required": "此網關需要身份驗證。添加令牌或密碼，然後點擊連接。",
  "overview.auth.failed":
    "身份驗證失敗。請使用 {command} 重新複製令牌化 URL，或更新令牌，然後點擊連接。",

  // Overview Page - Pairing Section
  "overview.pairing.hint": "此裝置需要閘道主機的配對批准。",
  "overview.pairing.mobileHint":
    "在手機上？從桌面執行 openclaw dashboard --no-open 複製完整 URL（包括 #token=...）。",

  // Overview Page - Insecure Section
  "overview.insecure.hint":
    "此頁面為 HTTP，因此瀏覽器阻止設備標識。請使用 HTTPS (Tailscale Serve) 或在網關主機上打開 {url}。",
  "overview.insecure.stayHttp": "如果您必須保持 HTTP，請設置 {config} (僅限令牌)。",

  // Channels Page
  "channels.title": "頻道",
  "channels.description": "管理頻道和設置。",

  // Instances Page
  "instances.title": "實例",
  "instances.description": "來自已連接客戶端和節點的在線信號。",

  // Sessions Page
  "sessions.title": "會話",
  "sessions.description": "檢查活動會話並調整每個會話的默認設置。",

  // Usage Page
  "usage.title": "使用情況",

  // Cron Page
  "cron.title": "定時任務",
  "cron.description": "安排喚醒和重複的智能體運行。",

  // Nodes Page
  "nodes.title": "節點",
  "nodes.description": "已配對設備、功能和命令公開。",

  // Chat Sessions Sidebar
  "chat.sidebar.title": "會話",
  "chat.sidebar.collapse": "收起側邊欄",
  "chat.sidebar.expand": "展開側邊欄",
  "chat.sidebar.noSessions": "未找到會話。",
  "chat.sidebar.loading": "加載會話中...",
  "chat.sidebar.offline": "離線",
  "chat.sidebar.moreCount": "還有 {count} 個",
  "chat.sidebar.deleteSession": "刪除會話",
  "chat.sidebar.deleteConfirm": '刪除會話 "{name}"?',
  "chat.sidebar.deleteConfirmDetail": "這將永久刪除該會話及其聊天記錄。",
  "chat.sidebar.sessionActions": "會話操作",
  "chat.sidebar.deleteWarningTitle": "此操作無法撤銷",

  // Chat
  "chat.disconnected": "已斷開與網關的連接。",
  "chat.refreshTitle": "刷新聊天數據",
  "chat.thinkingToggle": "切換助手思考/工作輸出",
  "chat.focusToggle": "切換專注模式 (隱藏側邊欄 + 頁面頁眉)",
  "chat.onboardingDisabled": "引導期間禁用",

  // Common
  "common.version": "版本",
  "common.health": "健康狀況",
  "common.ok": "正常",
  "common.offline": "離線",
  "common.connect": "連接",
  "common.refresh": "刷新",
  "common.enabled": "已啟用",
  "common.disabled": "已禁用",
  "common.na": "不適用",
  "common.docs": "文檔",
  "common.resources": "資源",
  "common.cancel": "取消",
  "common.deleting": "刪除中...",
  "common.delete": "刪除",

  // Language Selector
  "language.select": "語言",
  "language.en": "English",
  "language.zhCN": "簡體中文",
  "language.zhTW": "繁體中文",
  "language.ptBR": "Português",

  // Languages (for backward compatibility)
  "languages.en": "English",
  "languages.zhCN": "简体中文",
  "languages.zhTW": "繁體中文",
  "languages.ptBR": "Português",

  // Group Chat
  "chat.group.title": "群聊",
  "chat.group.create": "建立群聊",
  "chat.group.createTitle": "建立群聊",
  "chat.group.noGroups": "暫無群聊。",
  "chat.group.members": "名成員",
  "chat.group.info": "群聊資訊",
  "chat.group.groupName": "群聊名稱",
  "chat.group.namePlaceholder": "輸入群聊名稱...",
  "chat.group.selectAgents": "選擇智能體",
  "chat.group.messageMode": "訊息模式",
  "chat.group.announcement": "公告",
  "chat.group.memberList": "成員列表",
  "chat.group.settings": "設置",
  "chat.group.placeholder": "輸入訊息...（使用 @agentId 提及）",
  "chat.group.send": "發送",
  "chat.group.abort": "停止",
  "chat.group.back": "返回",
  "chat.group.message": "訊息",
  "chat.group.addMember": "添加成員",
  "chat.group.add": "添加",
  "chat.group.noAvailableAgents": "沒有可添加的智能體。",
  "chat.group.noAnnouncement": "暫無公告",

  // Errors
  "error.notFound": "未找到",
  "error.loadFailed": "加載失敗",
  "error.saveFailed": "保存失敗",
  "error.connectionFailed": "連接失敗",
};
