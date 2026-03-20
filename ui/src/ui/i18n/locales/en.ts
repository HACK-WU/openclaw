/**
 * English translations
 */
export const en: Record<string, string> = {
  // App
  "app.title": "OpenClaw",
  "app.subtitle": "Gateway Dashboard",

  // Navigation - Tab Groups
  "nav.group.chat": "Chat",
  "nav.group.control": "Control",
  "nav.group.agent": "Agent",
  "nav.group.settings": "Settings",
  "nav.group.resources": "Resources",

  // Navigation - Tabs
  "nav.chat": "Chat",
  "nav.overview": "Overview",
  "nav.channels": "Channels",
  "nav.instances": "Instances",
  "nav.sessions": "Sessions",
  "nav.usage": "Usage",
  "nav.cron": "Cron Jobs",
  "nav.agents": "Agents",
  "nav.skills": "Skills",
  "nav.nodes": "Nodes",
  "nav.config": "Config",
  "nav.debug": "Debug",
  "nav.logs": "Logs",
  "nav.docs": "Docs",

  // Navigation - Subtitles
  "nav.subtitle.chat": "Direct gateway chat session for quick interventions.",
  "nav.subtitle.overview": "Gateway status, entry points, and a fast health read.",
  "nav.subtitle.channels": "Manage channels and settings.",
  "nav.subtitle.instances": "Presence beacons from connected clients and nodes.",
  "nav.subtitle.sessions": "Inspect active sessions and adjust per-session defaults.",
  "nav.subtitle.usage": "",
  "nav.subtitle.cron": "Schedule wakeups and recurring agent runs.",
  "nav.subtitle.agents": "Manage agent workspaces, tools, and identities.",
  "nav.subtitle.skills": "Manage skill availability and API key injection.",
  "nav.subtitle.nodes": "Paired devices, capabilities, and command exposure.",
  "nav.subtitle.config": "Edit ~/.openclaw/openclaw.json safely.",
  "nav.subtitle.debug": "Gateway snapshots, events, and manual RPC calls.",
  "nav.subtitle.logs": "Live tail of the gateway file logs.",

  // Skills Page
  "skills.title": "Skills",
  "skills.description": "Bundled, managed, and workspace skills.",
  "skills.filter": "Filter",
  "skills.noSkills": "No skills found.",
  "skills.noMatch": "No matching skills. Try clearing the filter.",
  "skills.workspace": "Workspace Skills",
  "skills.builtIn": "Built-in Skills",
  "skills.installed": "Installed Skills",
  "skills.extra": "Extra Skills",
  "skills.other": "Other Skills",
  "skills.perAgent": "Per-agent skill allowlist and workspace skills.",
  "skills.loadConfig": "Load the gateway config to set per-agent skills.",
  "skills.allSkills": "all skills",
  "skills.selected": "{count} selected",
  "skills.editFile": "Edit File",
  "skills.readOnly": "This skill file is read-only and cannot be modified.",

  // Common Actions
  "action.refresh": "Refresh",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.delete": "Delete",
  "action.edit": "Edit",
  "action.preview": "Preview",
  "action.add": "Add",
  "action.close": "Close",
  "action.submit": "Submit",
  "action.loading": "Loading...",
  "action.clear": "Clear",
  "action.disableAll": "Disable All",
  "action.enableAll": "Enable All",

  // Common Status
  "status.connected": "Connected",
  "status.disconnected": "Disconnected",
  "status.connecting": "Connecting...",
  "status.error": "Error",
  "status.loading": "Loading",
  "status.ready": "Ready",
  "status.enabled": "Enabled",
  "status.disabled": "Disabled",

  // Agents Page
  "agents.title": "Agents",
  "agents.overview": "Overview",
  "agents.files": "Files",
  "agents.tools": "Tools",
  "agents.skills": "Skills",
  "agents.channels": "Channels",
  "agents.cron": "Cron",
  "agents.skillsFilter": "Skills Filter",

  // Config Page
  "config.title": "Config",
  "config.description": "Edit ~/.openclaw/openclaw.json safely.",

  // Debug Page
  "debug.title": "Debug",
  "debug.description": "Gateway snapshots, events, and manual RPC calls.",

  // Logs Page
  "logs.title": "Logs",
  "logs.description": "Live tail of the gateway file logs.",

  // Overview Page
  "overview.title": "Overview",
  "overview.description": "Gateway status, entry points, and a fast health read.",

  // Channels Page
  "channels.title": "Channels",
  "channels.description": "Manage channels and settings.",

  // Instances Page
  "instances.title": "Instances",
  "instances.description": "Presence beacons from connected clients and nodes.",

  // Sessions Page
  "sessions.title": "Sessions",
  "sessions.description": "Inspect active sessions and adjust per-session defaults.",

  // Usage Page
  "usage.title": "Usage",

  // Cron Page
  "cron.title": "Cron Jobs",
  "cron.description": "Schedule wakeups and recurring agent runs.",

  // Nodes Page
  "nodes.title": "Nodes",
  "nodes.description": "Paired devices, capabilities, and command exposure.",

  // Chat Sessions Sidebar
  "chat.sidebar.title": "Sessions",
  "chat.sidebar.collapse": "Collapse sidebar",
  "chat.sidebar.expand": "Expand sidebar",
  "chat.sidebar.noSessions": "No sessions found.",
  "chat.sidebar.loading": "Loading sessions...",
  "chat.sidebar.offline": "Offline",
  "chat.sidebar.moreCount": "+{count} more",
  "chat.sidebar.deleteSession": "Delete session",
  "chat.sidebar.deleteConfirm": 'Delete session "{name}"?',
  "chat.sidebar.deleteConfirmDetail":
    "This will permanently delete the session and its chat history.",
  "chat.sidebar.sessionActions": "Session actions",
  "chat.sidebar.deleteWarningTitle": "This action cannot be undone",

  // Common
  "common.version": "Version",
  "common.health": "Health",
  "common.ok": "OK",
  "common.offline": "Offline",
  "common.connect": "Connect",
  "common.refresh": "Refresh",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",
  "common.na": "n/a",
  "common.docs": "Docs",
  "common.resources": "Resources",
  "common.cancel": "Cancel",
  "common.deleting": "Deleting...",
  "common.delete": "Delete",

  // Overview Page - Access Section
  "overview.access.title": "Gateway Access",
  "overview.access.subtitle": "Where the dashboard connects and how it authenticates.",
  "overview.access.wsUrl": "WebSocket URL",
  "overview.access.token": "Gateway Token",
  "overview.access.password": "Password (not stored)",
  "overview.access.sessionKey": "Default Session Key",
  "overview.access.language": "Language",
  "overview.access.connectHint": "Click Connect to apply connection changes.",
  "overview.access.trustedProxy": "Authenticated via trusted proxy.",

  // Overview Page - Snapshot Section
  "overview.snapshot.title": "Snapshot",
  "overview.snapshot.subtitle": "Latest gateway handshake information.",
  "overview.snapshot.status": "Status",
  "overview.snapshot.uptime": "Uptime",
  "overview.snapshot.tickInterval": "Tick Interval",
  "overview.snapshot.lastChannelsRefresh": "Last Channels Refresh",
  "overview.snapshot.channelsHint":
    "Use Channels to link WhatsApp, Telegram, Discord, Signal, or iMessage.",

  // Overview Page - Stats Section
  "overview.stats.instances": "Instances",
  "overview.stats.instancesHint": "Presence beacons in the last 5 minutes.",
  "overview.stats.sessions": "Sessions",
  "overview.stats.sessionsHint": "Recent session keys tracked by the gateway.",
  "overview.stats.cron": "Cron",
  "overview.stats.cronNext": "Next wake {time}",

  // Overview Page - Notes Section
  "overview.notes.title": "Notes",
  "overview.notes.subtitle": "Quick reminders for remote control setups.",
  "overview.notes.tailscaleTitle": "Tailscale serve",
  "overview.notes.tailscaleText":
    "Prefer serve mode to keep the gateway on loopback with tailnet auth.",
  "overview.notes.sessionTitle": "Session hygiene",
  "overview.notes.sessionText": "Use /new or sessions.patch to reset context.",
  "overview.notes.cronTitle": "Cron reminders",
  "overview.notes.cronText": "Use isolated sessions for recurring runs.",

  // Overview Page - Auth Section
  "overview.auth.required":
    "This gateway requires auth. Add a token or password, then click Connect.",
  "overview.auth.failed":
    "Auth failed. Re-copy a tokenized URL with {command}, or update the token, then click Connect.",

  // Overview Page - Pairing Section
  "overview.pairing.hint": "This device needs pairing approval from the gateway host.",
  "overview.pairing.mobileHint":
    "On mobile? Copy the full URL (including #token=...) from openclaw dashboard --no-open on your desktop.",

  // Overview Page - Insecure Section
  "overview.insecure.hint":
    "This page is HTTP, so the browser blocks device identity. Use HTTPS (Tailscale Serve) or open {url} on the gateway host.",
  "overview.insecure.stayHttp": "If you must stay on HTTP, set {config} (token-only).",

  // Chat
  "chat.disconnected": "Disconnected from gateway.",
  "chat.refreshTitle": "Refresh chat data",
  "chat.thinkingToggle": "Toggle assistant thinking/working output",
  "chat.focusToggle": "Toggle focus mode (hide sidebar + page header)",
  "chat.onboardingDisabled": "Disabled during onboarding",

  // Language Selector
  "language.select": "Language",
  "language.en": "English",
  "language.zhCN": "Simplified Chinese",
  "language.zhTW": "Traditional Chinese",
  "language.ptBR": "Portuguese",

  // Languages (for backward compatibility)
  "languages.en": "English",
  "languages.zhCN": "简体中文",
  "languages.zhTW": "繁體中文",
  "languages.ptBR": "Português",

  // Group Chat
  "chat.group.title": "Group Chats",
  "chat.group.create": "Create Group",
  "chat.group.createTitle": "Create Group Chat",
  "chat.group.noGroups": "No group chats yet.",
  "chat.group.members": "members",
  "chat.group.info": "Group Info",
  "chat.group.groupName": "Group Name",
  "chat.group.namePlaceholder": "Enter group name...",
  "chat.group.selectAgents": "Select Agents",
  "chat.group.messageMode": "Message Mode",
  "chat.group.messageMode.unicast": "Unicast",
  "chat.group.messageMode.unicastDesc":
    "When no @mention is specified, messages are sent to the assistant only. Use @mention to target specific agents.",
  "chat.group.messageMode.broadcast": "Broadcast",
  "chat.group.messageMode.broadcastDesc":
    "When no @mention is specified, messages are sent to all members. ⚠️ Consumes a large amount of tokens — use with caution.",
  "chat.group.announcement": "Announcement",
  "chat.group.memberList": "Members",
  "chat.group.settings": "Settings",
  "chat.group.placeholder": "Type a message... (use @agentId to mention)",
  "chat.group.send": "Send",
  "chat.group.abort": "Stop",
  "chat.group.back": "Back",
  "chat.group.message": "Message",
  "chat.group.addMember": "Add Member",
  "chat.group.add": "Add",
  "chat.group.noAvailableAgents": "No available agents to add.",
  "chat.group.noAnnouncement": "No announcement",
  "chat.group.announcementPlaceholder": "Enter group announcement...",
  "chat.group.announcementMarkdownHint": "Supports Markdown formatting",
  "chat.group.dangerZone": "Danger Zone",
  "chat.group.disband": "Disband Group",
  "chat.group.disbandConfirm":
    "Are you sure you want to disband this group? This action cannot be undone.",
  "chat.group.export": "Export Transcript",
  "chat.group.generating": "Generating",
  "chat.group.thinkingLevel": "Thinking Level",
  "chat.group.thinkingLevelPlaceholder": "Select thinking level...",
  "chat.group.maxRounds": "Max Rounds",
  "chat.group.maxRoundsHint":
    "Maximum number of conversation rounds in a single group chat turn. Each round allows agents to respond once.",
  "chat.group.maxConsecutive": "Max Consecutive",
  "chat.group.maxConsecutiveHint":
    "Maximum number of consecutive responses a single agent can make before yielding to others.",
  "chat.group.chainTimeout": "Chain Timeout",
  "chat.group.chainTimeoutHint": "Maximum duration of a conversation chain from Owner's message.",
  "chat.group.cliTimeout": "CLI Timeout",
  "chat.group.cliTimeoutHint": "Maximum execution time for a single CLI command.",
  "chat.group.timeoutSeconds": "seconds",
  "chat.group.timeoutMinute": "minute",
  "chat.group.timeoutMinutes": "minutes",
  "chat.group.projectDirectory": "Project Directory (optional)",
  "chat.group.projectDirectoryHint":
    "CLI Agents will start in this directory. Locked after creation.",
  "chat.group.projectDocs": "Project Docs (optional)",
  "chat.group.projectDocsHint": "Comma-separated file paths injected into agent context.",
  "chat.group.error.directoryNotFound": "Directory does not exist",
  "chat.group.error.fileNotFound": "File(s) not found: {files}",
  "chat.group.role.assistant": "Assistant",
  "chat.group.role.member": "Member",
  "chat.group.role.cliAssistant": "CLI Assistant",

  // Agent Create Dialog
  "agent.create.name.hint": "Can be Chinese or English, used as the agent's display name",
  "agent.create.agentId.format": "Only letters, numbers, underscores [a-zA-Z0-9_]",
  "agent.create.agentId.locked": "Auto-filled from name, click to unlock for editing",
  "agent.create.agentId.unlock": "Unlock to edit Agent ID",
  "agent.create.agentId.warning": "Name contains special characters, please specify Agent ID manually (letters, numbers, underscores only)",
  "agent.create.workspace.hint": "Workspace directory, ~ expands to user home directory",
  "agent.create.workspace.relativeHint": "Consider using an absolute path (e.g. ~/agents/xxx or /home/user/xxx)",

  // Errors
  "error.notFound": "Not found",
  "error.loadFailed": "Failed to load",
  "error.saveFailed": "Failed to save",
  "error.connectionFailed": "Connection failed",
};
