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
  "action.remove": "Remove",
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
  "chat.group.removeMember": "Remove Member",
  "chat.group.removeMemberConfirm": "Are you sure you want to remove {name}?",
  "chat.group.add": "Add",
  "chat.group.noAvailableAgents": "No available agents to add.",
  "chat.group.noAnnouncement": "No announcement",
  "chat.group.announcementPlaceholder": "Enter group announcement...",
  "chat.group.announcementMarkdownHint": "Supports Markdown formatting",
  "chat.group.dangerZone": "Danger Zone",
  "chat.group.disband": "Disband Group",
  "chat.group.disbandConfirm":
    "Are you sure you want to disband this group? This action cannot be undone.",
  "chat.group.disbandConfirmDetail": "All messages and settings will be permanently deleted.",
  "chat.group.disbanding": "Disbanding...",
  "chat.group.disbandChecking": "Checking memory files...",
  "chat.group.disbandMemoryWarning":
    "This group contains a shared memory file (MEMORY.md) that needs to be organized before disbanding.",
  "chat.group.disbandMemoryWarningDetail":
    "Please extract valuable memories to project-level shared memory first, then clear the group memory before disbanding.",
  "chat.group.disbandMemorySize": "Memory file size: {size}",
  "chat.group.disbandOrganize": "Organize & Disband",
  "chat.group.disbandOrganizing": "Organizing memories...",
  "chat.group.disbandOrganizingDetail":
    "A memory organization command has been sent to the assistant agent. Please wait for it to finish, then click the button below.",
  "chat.group.disbandOrganizeComplete": "Done organizing, disband now",
  "chat.group.disbandForce": "Force Disband",
  "chat.group.disbandForceConfirm": "Are you sure you want to force disband?",
  "chat.group.disbandForceConfirmDetail":
    "Shared memory data will be permanently lost. This action cannot be undone.",
  "chat.group.clearMessages": "Clear Messages",
  "chat.group.clearMessagesConfirm": "Are you sure you want to clear all messages?",
  "chat.group.clearMessagesConfirmDetail":
    "This action will delete all chat messages and cannot be undone.",
  "chat.group.clearMessagesWarning": "Cannot clear messages while conversation is active",
  "chat.group.clearMessagesBlocked": "Cannot Clear Messages",
  "chat.group.clearMessagesBlockedDetail":
    "Some agents are still responding. Please wait for them to finish.",
  "chat.group.clearing": "Clearing...",
  "chat.group.export": "Export Transcript",
  "chat.group.generating": "Generating",
  "chat.group.thinkingLevel": "Thinking Level",
  "chat.group.thinkingLevelPlaceholder": "Select thinking level...",
  "chat.group.maxRounds": "Max Conversation Turns",
  "chat.group.maxRoundsHint":
    "Maximum number of agent responses in a single group chat conversation.",
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

  // Project Configuration
  "chat.group.projectConfiguration": "Project Configuration",
  "chat.group.projectDirectoryLockedDesc":
    "Locked at creation. CLI Agents start in this directory.",
  "chat.group.projectDirectoryNotConfigured": "Not configured. Set during group creation.",
  "chat.group.projectDocsDesc": "Files injected into agent context. Can be updated anytime.",

  // Context Configuration
  "chat.group.contextConfiguration": "Context Configuration",
  "chat.group.maxMessages": "Max Messages",
  "chat.group.maxMessagesDesc": "Maximum number of history messages sent to agents (5-100).",
  "chat.group.maxCharacters": "Max Characters",
  "chat.group.maxCharactersDesc": "Maximum total characters in context (10,000-200,000).",
  "chat.group.includeSystemMessages": "Include System Messages",
  "chat.group.includeSystemMessagesDesc": "Include member join/leave events in context.",

  // Memory Management
  "chat.group.memoryManagement": "Memory Management",
  "chat.group.memory.sharedMemory": "Shared Memory",
  "chat.group.memory.agentMemory": "Agent Memory",
  "chat.group.memory.totalSize": "Total Size",
  "chat.group.memory.maxSize": "Limit",
  "chat.group.memory.missing": "not created",
  "chat.group.memory.warningApproaching":
    "Memory files approaching size limit, consider compacting",
  "chat.group.memory.warningOverLimit":
    "Memory files exceeded size limit, please compact immediately",
  "chat.group.memory.merge": "Merge Memory",
  "chat.group.memory.compact": "Compact Memory",
  "chat.group.memory.mergeDesc": "Consolidate agent memories into shared memory files",
  "chat.group.memory.compactDesc": "Clean up outdated, redundant, or overly verbose entries",
  "chat.group.memory.noMemory": "No memory files yet. Will be created on first agent interaction.",
  "chat.group.memory.contentInterval": "Content Interval",
  "chat.group.memory.contentIntervalDesc": "Inject memory content every N agent replies.",
  "chat.group.memory.promptInterval": "Prompt Interval",
  "chat.group.memory.promptIntervalDesc": "Inject memory management prompt every N agent replies.",
  "chat.group.memory.maxSizeLabel": "Max Size (KB)",
  "chat.group.memory.maxSizeDesc": "Total size limit for all memory files.",
  "chat.group.memory.times": "times",

  // CLI Agent Core Files
  "cliAgent.coreFiles.title": "Core Files",
  "cliAgent.coreFiles.files": "Files",
  "cliAgent.coreFiles.identity": "Identity",
  "cliAgent.coreFiles.personality": "Personality",
  "cliAgent.coreFiles.soul": "Soul",
  "cliAgent.coreFiles.agents": "Project Guide",
  "cliAgent.coreFiles.tools": "Tools",
  "cliAgent.coreFiles.identityDesc": "Define your identity information",
  "cliAgent.coreFiles.personalityDesc": "Define your personality traits",
  "cliAgent.coreFiles.soulDesc": "Engineer role and coding principles",
  "cliAgent.coreFiles.agentsDesc": "Project conventions and guidelines",
  "cliAgent.coreFiles.toolsDesc": "Environment config and device info (optional)",
  "cliAgent.coreFiles.reset": "Reset",
  "cliAgent.coreFiles.save": "Save",
  "cliAgent.coreFiles.unsaved": "Unsaved changes",
  "cliAgent.coreFiles.fileNotFound": "File not found, will create on save",
  "cliAgent.coreFiles.agentsReadOnly":
    "This file is usually maintained by the project. Consider updating via project config.",

  // Personality Selection
  "personality.title": "Personality (Optional)",
  "personality.none": "No Personality",
  "personality.noneDesc": "Use default behavior",
  "personality.view": "View",
  "personality.preview": "Preview",
  "personality.close": "Close",
  "personality.coreTraits": "Core Traits",
  "personality.thinkingMode": "Thinking Mode",
  "personality.communicationStyle": "Communication Style",
  "personality.decisionTendency": "Decision Tendency",
  "personality.typicalExpressions": "Typical Expressions",
  "personality.architect.name": "The Architect",
  "personality.architect.desc":
    "Reviews problems from a global perspective, focuses on long-term system evolution",
  "personality.implementer.name": "The Implementer",
  "personality.implementer.desc": "Result-oriented, pursues quick delivery of working code",
  "personality.reviewer.name": "The Reviewer",
  "personality.reviewer.desc":
    "Scrutinizes everything with skepticism, focuses on quality and risks",
  "personality.explorer.name": "The Explorer",
  "personality.explorer.desc":
    "Curious about new technologies, loves exploring different solutions",
  "personality.guardian.name": "The Guardian",
  "personality.guardian.desc": "Stability comes first, considers risks for any change",

  // Errors
  "error.notFound": "Not found",
  "error.loadFailed": "Failed to load",
  "error.saveFailed": "Failed to save",
  "error.connectionFailed": "Connection failed",

  // Agent Create Dialog
  "agent.create.workspace.error.required": "Please enter workspace path",
  "agent.create.workspace.error.forbidden": "Cannot select system core directory",
  "agent.create.workspace.error.restricted":
    "This directory is protected, please choose another location",
  "agent.create.workspace.error.notDirectory": "Path is not a directory",
  "agent.create.workspace.error.parentNotFound": "Parent directory does not exist",
  "agent.create.workspace.error.checkFailed": "Path check failed",
  "agent.create.workspace.autoCreate":
    "Path does not exist, directory will be created automatically",
  "agent.create.workspace.warning.caution":
    "This directory is typically used for system software, proceed with caution",

  // Project Management
  "nav.projects": "Projects",
  "nav.subtitle.projects": "Manage project directories and related documents.",
  "project.title": "Project Management",
  "project.newProject": "New Project",
  "project.list.empty.title": "No Projects",
  "project.list.empty.description":
    "Create projects to manage your code directories and related documents",
  "project.list.empty.button": "Create First Project",
  "project.card.directory": "Project Directory",
  "project.card.docs": "Project Docs",
  "project.card.groups": "Linked Groups",
  "project.card.manage": "Manage",
  "project.card.edit": "Edit",
  "project.card.delete": "Delete",
  "project.card.createdAt": "Created",
  "project.card.updatedAt": "Updated",
  "project.total.count": "{count} projects in total",
  "project.dialog.create.title": "Create New Project",
  "project.dialog.edit.title": "Edit Project - {name}",
  "project.dialog.name.label": "Project Name",
  "project.dialog.name.hint": "Used to identify the project, cannot be changed after creation",
  "project.dialog.name.placeholder": "Enter project name...",
  "project.dialog.name.required": "Project name is required",
  "project.dialog.name.exists": "Project name already exists",
  "project.dialog.directory.label": "Project Directory",
  "project.dialog.directory.hint": "CLI agents will work in this directory",
  "project.dialog.directory.placeholder": "/path/to/your/project",
  "project.dialog.directory.required": "Project directory is required",
  "project.dialog.directory.notFound": "Directory does not exist",
  "project.dialog.docs.label": "Project Documents",
  "project.dialog.docs.hint": "File paths to inject into agent context, comma-separated",
  "project.dialog.docs.placeholder": "README.md, docs/api.md",
  "project.dialog.docs.add": "Add Document",
  "project.dialog.docs.remove": "Remove",
  "project.dialog.docs.fileNotFound": "File not found",
  "project.dialog.docs.count": "{count} documents selected",
  "project.dialog.description.label": "Description",
  "project.dialog.description.hint": "Help you and your team understand the project purpose",
  "project.dialog.description.placeholder": "This project is used for...",
  "project.dialog.cancel": "Cancel",
  "project.dialog.create": "Create Project",
  "project.dialog.save": "Save Changes",
  "project.delete.title": "Delete Project",
  "project.delete.confirm":
    'Are you sure you want to delete project "{name}"? This action cannot be undone.',
  "project.delete.warning.groups":
    "This project is linked to {count} groups. They will become standalone groups after deletion.",
  "project.delete.cancel": "Cancel",
  "project.delete.confirmButton": "Confirm Delete",

  // Project Rules
  "project.rules.title": "Project Rules",
  "project.rules.create": "Create Rule",
  "project.rules.edit": "Edit",
  "project.rules.delete": "Delete",
  "project.rules.empty.title": "No Project Rules",
  "project.rules.empty.description":
    "Create rules to standardize Agent behavior, rules will be injected into linked group contexts",
  "project.rules.empty.button": "Create First Rule",
  "project.rules.dialog.create.title": "Create Rule",
  "project.rules.dialog.edit.title": "Edit Rule",
  "project.rules.dialog.title.label": "Rule Title",
  "project.rules.dialog.title.hint": "Name the rule for easy identification and management",
  "project.rules.dialog.title.placeholder": "Enter rule title...",
  "project.rules.dialog.title.required": "Rule title is required",
  "project.rules.dialog.content.label": "Rule Content",
  "project.rules.dialog.content.hint":
    "Supports Markdown format, will be injected into linked group Agent contexts",
  "project.rules.dialog.content.placeholder": "## Rule Title\n\nRule content...",
  "project.rules.dialog.content.required": "Rule content is required",
  "project.rules.dialog.tab.edit": "Edit",
  "project.rules.dialog.tab.preview": "Preview",
  "project.rules.dialog.cancel": "Cancel",
  "project.rules.dialog.create": "Create Rule",
  "project.rules.dialog.save": "Save Changes",
  "project.rules.delete.title": "Delete Rule",
  "project.rules.delete.confirm":
    'Are you sure you want to delete rule "{title}"? This action cannot be undone.',
  "project.rules.delete.hint":
    "After deletion, Agents in linked groups will no longer receive this rule in context.",
  "project.rules.delete.cancel": "Cancel",
  "project.rules.delete.confirmButton": "Confirm Delete",
  "project.rules.count": "{count} rules",
  "project.manage.title": "Project Management",
  "project.manage.tab.overview": "Overview",
  "project.manage.tab.rules": "Rules",
  "project.manage.tab.skills": "Skills",
  "project.manage.tab.docs": "Docs",
  // Skills management
  "project.skills.title": "Project Skills",
  "project.skills.create": "Create Skill",
  "project.skills.edit": "Edit",
  "project.skills.delete": "Delete",
  "project.skills.empty.title": "No Project Skills",
  "project.skills.empty.description":
    "Create skills to equip Agent capabilities, skills will be injected into linked group contexts",
  "project.skills.empty.button": "Create First Skill",
  "project.skills.dialog.create.title": "Create Skill",
  "project.skills.dialog.edit.title": "Edit Skill",
  "project.skills.dialog.name.label": "Skill Name",
  "project.skills.dialog.name.hint": "Name the skill for easy identification and management",
  "project.skills.dialog.name.placeholder": "Enter skill name...",
  "project.skills.dialog.content.label": "Skill Content",
  "project.skills.dialog.content.hint":
    "Supports Markdown format, will be injected into linked group Agent contexts",
  "project.skills.dialog.content.placeholder": "## Skill Name\n\nSkill content...",
  "project.skills.dialog.cancel": "Cancel",
  "project.skills.dialog.create": "Create Skill",
  "project.skills.dialog.save": "Save Changes",
  "project.skills.delete.title": "Delete Skill",
  "project.skills.delete.confirm":
    'Are you sure you want to delete skill "{title}"? This action cannot be undone.',
  "project.skills.delete.hint":
    "After deletion, Agents in linked groups will no longer receive this skill in context.",
  "project.skills.delete.cancel": "Cancel",
  "project.skills.delete.confirmButton": "Confirm Delete",
  // Docs management
  "project.docs.title": "Project Docs",
  "project.docs.create": "Create Doc",
  "project.docs.edit": "Edit",
  "project.docs.delete": "Delete",
  "project.docs.empty.title": "No Project Docs",
  "project.docs.empty.description":
    "Create docs to provide reference materials for Agent, docs will be injected into linked group contexts",
  "project.docs.empty.button": "Create First Doc",
  "project.docs.dialog.create.title": "Create Doc",
  "project.docs.dialog.edit.title": "Edit Doc",
  "project.docs.dialog.name.label": "Doc Name",
  "project.docs.dialog.name.hint": "Name the doc for easy identification and management",
  "project.docs.dialog.name.placeholder": "Enter doc name...",
  "project.docs.dialog.content.label": "Doc Content",
  "project.docs.dialog.content.hint":
    "Supports Markdown format, will be injected into linked group Agent contexts",
  "project.docs.dialog.content.placeholder": "## Doc Name\n\nDoc content...",
  "project.docs.dialog.cancel": "Cancel",
  "project.docs.dialog.create": "Create Doc",
  "project.docs.dialog.save": "Save Changes",
  "project.docs.delete.title": "Delete Doc",
  "project.docs.delete.confirm":
    'Are you sure you want to delete doc "{title}"? This action cannot be undone.',
  "project.docs.delete.hint":
    "After deletion, Agents in linked groups will no longer receive this doc in context.",
  "project.docs.delete.cancel": "Cancel",
  "project.docs.delete.confirmButton": "Confirm Delete",
  "project.groups.title": "Linked Groups",
  "project.groups.empty.title": "No linked groups",
  "project.groups.empty.description":
    "Select this project when creating a group, or link from group settings.",
  "project.groups.enter": "Enter",
  "project.groups.unlink": "Unlink",
  "project.groups.archived": "Archived",
  // Create group - project selection
  "chat.group.project.select": "Select Project",
  "chat.group.project.select.hint":
    "Select a project to inherit project settings, or create a standalone group",
  "chat.group.project.noProject": "No project (standalone group)",
  "chat.group.project.selected": "Selected Project",
  "chat.group.project.docs.count": "{count} documents",
  // Group info panel - project display
  "chat.group.project.associated": "Associated Project",
  // Group info panel - project content (read-only)
  "chat.group.projectContent": "Project Content",
  "chat.group.projectContent.rules": "Rules",
  "chat.group.projectContent.skills": "Skills",
  "chat.group.projectContent.docs": "Docs",
  "chat.group.projectContent.empty": "No content configured",
  "chat.group.projectContent.loading": "Loading project content...",
};
