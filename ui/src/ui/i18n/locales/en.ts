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

  // Language Selector
  "language.select": "Language",
  "language.en": "English",
  "language.zhCN": "简体中文",

  // Errors
  "error.notFound": "Not found",
  "error.loadFailed": "Failed to load",
  "error.saveFailed": "Failed to save",
  "error.connectionFailed": "Connection failed",
};
