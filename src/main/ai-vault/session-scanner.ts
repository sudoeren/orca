/* eslint-disable max-lines -- Why: discovery, parsing, command construction, and normalization share one narrow transcript shape. Keeping them together makes resume bugs easier to audit. */
import { createReadStream } from 'fs'
import { homedir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { createInterface } from 'readline'
import { readdir, readFile, stat } from 'fs/promises'
import {
  aiVaultAgentLabel,
  buildAiVaultResumeCommand,
  type AiVaultAgent,
  type AiVaultListResult,
  type AiVaultScanIssue,
  type AiVaultSession,
  type AiVaultSessionPreviewMessage
} from '../../shared/ai-vault-types'

const DEFAULT_LIMIT = 1000
const DEFAULT_SCAN_LIMIT_PER_AGENT = 1000
const SESSION_PARSE_CONCURRENCY = 8
const SESSION_PREVIEW_MESSAGE_LIMIT = 5
const SESSION_PREVIEW_TEXT_LIMIT = 220
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const CODEX_SESSIONS_DIR = join(
  process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'),
  'sessions'
)
const GEMINI_SESSIONS_DIR = join(homedir(), '.gemini', 'tmp')
const COPILOT_SESSIONS_DIR = join(
  process.env.COPILOT_HOME?.trim() || join(homedir(), '.copilot'),
  'session-state'
)
const CURSOR_PROJECTS_DIR = join(homedir(), '.cursor', 'projects')
const OPENCODE_STORAGE_DIR = join(
  process.env.OPENCODE_CONFIG_DIR?.trim() || join(homedir(), '.local', 'share', 'opencode'),
  'storage'
)
const HERMES_SESSIONS_DIR = join(homedir(), '.hermes', 'sessions')
const ROVO_SESSIONS_DIR = join(homedir(), '.rovodev', 'sessions')
const OPENCLAW_STATE_DIR = process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), '.openclaw')
const OPENCLAW_LEGACY_STATE_DIR = join(homedir(), '.clawdbot')
const PI_SESSIONS_DIR = normalizePiSessionsDir(
  process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent', 'sessions')
)
const DROID_SESSIONS_DIR = join(homedir(), '.factory', 'sessions')
const DROID_PROJECTS_DIR = join(homedir(), '.factory', 'projects')

type AiVaultScanOptions = {
  claudeProjectsDir?: string
  codexSessionsDir?: string
  geminiSessionsDir?: string
  copilotSessionsDir?: string
  cursorProjectsDir?: string
  opencodeStorageDir?: string
  hermesSessionsDir?: string
  rovoSessionsDir?: string
  openclawStateDir?: string
  openclawLegacyStateDir?: string
  piSessionsDir?: string
  droidSessionsDir?: string
  droidProjectsDir?: string
  limit?: number
  limitPerAgent?: number
  platform?: NodeJS.Platform
}

type FileWithMtime = {
  path: string
  mtimeMs: number
  modifiedAt: string
}

type SessionFileCandidate = {
  agent: AiVaultAgent
  file: FileWithMtime
}

type SessionFileDiscovery = {
  agent: AiVaultAgent
  files: FileWithMtime[]
}

type SessionParseResult = {
  session: AiVaultSession | null
  issue: AiVaultScanIssue | null
}

type SessionAccumulator = {
  agent: AiVaultAgent
  sessionId: string
  title: string | null
  fallbackTitle: string | null
  cwd: string | null
  branch: string | null
  model: string | null
  filePath: string
  createdAt: string | null
  updatedAt: string | null
  modifiedAt: string
  messageCount: number
  totalTokens: number
  previewMessages: AiVaultSessionPreviewMessage[]
  latestTimestampMs: number
}

type CodexUsageSnapshot = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export async function scanAiVaultSessions(
  options: AiVaultScanOptions = {}
): Promise<AiVaultListResult> {
  const limit = clampPositiveInteger(options.limit, DEFAULT_LIMIT)
  const limitPerAgent = clampPositiveInteger(options.limitPerAgent, DEFAULT_SCAN_LIMIT_PER_AGENT)
  const platform = options.platform ?? process.platform
  const issues: AiVaultScanIssue[] = []

  const discoveries = await Promise.all<SessionFileDiscovery>([
    discoverFiles({
      rootDir: options.claudeProjectsDir ?? CLAUDE_PROJECTS_DIR,
      limit: limitPerAgent,
      agent: 'claude',
      issues,
      extensions: ['.jsonl']
    }),
    discoverFiles({
      rootDir: options.codexSessionsDir ?? CODEX_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'codex',
      issues,
      extensions: ['.jsonl']
    }),
    discoverFiles({
      rootDir: options.geminiSessionsDir ?? GEMINI_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'gemini',
      issues,
      extensions: ['.json', '.jsonl']
    }),
    discoverFiles({
      rootDir: options.copilotSessionsDir ?? COPILOT_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'copilot',
      issues,
      extensions: ['.jsonl']
    }),
    discoverFiles({
      rootDir: options.cursorProjectsDir ?? CURSOR_PROJECTS_DIR,
      limit: limitPerAgent,
      agent: 'cursor',
      issues,
      extensions: ['.jsonl'],
      filePredicate: (path) => path.split(/[\\/]/).includes('agent-transcripts')
    }),
    discoverFiles({
      rootDir: join(options.opencodeStorageDir ?? OPENCODE_STORAGE_DIR, 'session'),
      limit: limitPerAgent,
      agent: 'opencode',
      issues,
      extensions: ['.json']
    }),
    discoverFiles({
      rootDir: options.hermesSessionsDir ?? HERMES_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'hermes',
      issues,
      extensions: ['.json'],
      filePredicate: (path) => basename(path).startsWith('session_')
    }),
    discoverFiles({
      rootDir: options.rovoSessionsDir ?? ROVO_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'rovo',
      issues,
      extensions: ['.json'],
      filePredicate: (path) => basename(path) === 'metadata.json'
    }),
    discoverOpenClawFiles({
      rootDirs: [
        options.openclawStateDir ?? OPENCLAW_STATE_DIR,
        options.openclawLegacyStateDir ?? OPENCLAW_LEGACY_STATE_DIR
      ],
      limit: limitPerAgent,
      issues
    }),
    discoverFiles({
      rootDir: options.piSessionsDir ?? PI_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'pi',
      issues,
      extensions: ['.jsonl']
    }),
    discoverFiles({
      rootDir: options.droidSessionsDir ?? DROID_SESSIONS_DIR,
      limit: limitPerAgent,
      agent: 'droid',
      issues,
      extensions: ['.jsonl']
    }),
    discoverFiles({
      rootDir: options.droidProjectsDir ?? DROID_PROJECTS_DIR,
      limit: limitPerAgent,
      agent: 'droid',
      issues,
      extensions: ['.jsonl']
    })
  ])

  const candidates = discoveries
    .flatMap((discovery) =>
      discovery.files.map((file): SessionFileCandidate => ({ agent: discovery.agent, file }))
    )
    .sort((left, right) => right.file.mtimeMs - left.file.mtimeMs)

  const parsedSessions = await parseSessionCandidates({
    candidates,
    limit,
    platform,
    issues
  })

  const sessions = parsedSessions
    .sort((left, right) => sessionSortTime(right) - sessionSortTime(left))
    .slice(0, limit)

  return {
    sessions,
    issues,
    scannedAt: new Date().toISOString()
  }
}

async function parseSessionCandidates(args: {
  candidates: SessionFileCandidate[]
  limit: number
  platform: NodeJS.Platform
  issues: AiVaultScanIssue[]
}): Promise<AiVaultSession[]> {
  const sessions: AiVaultSession[] = []
  let index = 0

  while (index < args.candidates.length) {
    if (canStopParsingSessions(sessions, args.limit, args.candidates[index]?.file.mtimeMs)) {
      break
    }

    const remaining = args.candidates.length - index
    const needed = Math.max(args.limit - sessions.length, 1)
    const batchSize = Math.min(SESSION_PARSE_CONCURRENCY, needed, remaining)
    const batch = args.candidates.slice(index, index + batchSize)
    const results = await Promise.all(
      batch.map((candidate) => parseSessionCandidate(candidate, args.platform))
    )

    for (const result of results) {
      if (result.issue) {
        args.issues.push(result.issue)
      }
      if (result.session) {
        sessions.push(result.session)
      }
    }

    index += batchSize
  }

  return sessions
}

async function parseSessionCandidate(
  candidate: SessionFileCandidate,
  platform: NodeJS.Platform
): Promise<SessionParseResult> {
  try {
    const session = await parseAgentSessionFile(candidate, platform)
    return { session, issue: null }
  } catch (err) {
    return {
      session: null,
      issue: {
        agent: candidate.agent,
        path: candidate.file.path,
        message: errorMessage(err)
      }
    }
  }
}

async function parseAgentSessionFile(
  candidate: SessionFileCandidate,
  platform: NodeJS.Platform
): Promise<AiVaultSession | null> {
  switch (candidate.agent) {
    case 'claude':
      return parseClaudeSessionFile(candidate.file, platform)
    case 'codex':
      return parseCodexSessionFile(candidate.file, platform)
    case 'gemini':
      return parseGeminiSessionFile(candidate.file, platform)
    case 'copilot':
      return parseCopilotSessionFile(candidate.file, platform)
    case 'cursor':
      return parseCursorSessionFile(candidate.file, platform)
    case 'opencode':
      return parseOpenCodeSessionFile(candidate.file, platform)
    case 'hermes':
      return parseHermesSessionFile(candidate.file, platform)
    case 'rovo':
      return parseRovoSessionFile(candidate.file, platform)
    case 'openclaw':
      return parseMessageGraphSessionFile('openclaw', candidate.file, platform)
    case 'pi':
      return parseMessageGraphSessionFile('pi', candidate.file, platform)
    case 'droid':
      return parseDroidSessionFile(candidate.file, platform)
  }
}

function canStopParsingSessions(
  sessions: AiVaultSession[],
  limit: number,
  nextCandidateMtimeMs: number | undefined
): boolean {
  if (sessions.length < limit || typeof nextCandidateMtimeMs !== 'number') {
    return false
  }
  const visibleCutoff = sessions
    .map(sessionSortTime)
    .sort((left, right) => right - left)
    .at(limit - 1)

  // Transcript mtime is already our discovery bound and fallback sort key; older
  // files cannot displace the current visible set once the cutoff is newer.
  return typeof visibleCutoff === 'number' && nextCandidateMtimeMs < visibleCutoff
}

export async function parseClaudeSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'claude',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  let metaTitle: string | null = null

  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }

    if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
      accumulator.sessionId = record.sessionId.trim()
    }
    updateTimeline(accumulator, extractString(record.timestamp))
    updateLatestLocation(accumulator, record)

    if (record.type === 'user') {
      accumulator.messageCount++
      const title = extractMessageText(record.message)
      addPreviewContent(accumulator, 'user', asRecord(record.message)?.content, record.timestamp)
      if (title && record.isMeta !== true && !accumulator.title) {
        accumulator.title = title
      } else if (title && !metaTitle) {
        metaTitle = title
      }
      continue
    }

    if (record.type === 'assistant') {
      accumulator.messageCount++
      const message = asRecord(record.message)
      addPreviewContent(accumulator, 'assistant', message?.content, record.timestamp)
      const model = extractString(message?.model)
      if (model) {
        accumulator.model = model
      }
      accumulator.totalTokens += claudeUsageTotal(message?.usage)
    }
  }

  accumulator.fallbackTitle = metaTitle
  return finalizeSession(accumulator, platform)
}

export async function parseCodexSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'codex',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  let previousTotals: CodexUsageSnapshot | null = null

  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }

    updateTimeline(accumulator, extractString(record.timestamp))

    const payload = asRecord(record.payload)
    if (record.type === 'session_meta' && payload) {
      const sessionId = extractString(payload.id)
      if (sessionId) {
        accumulator.sessionId = sessionId
      }
      const cwd = extractString(payload.cwd)
      if (cwd) {
        accumulator.cwd = cwd
      }
      accumulator.branch = extractGitBranch(payload.git) ?? accumulator.branch
      continue
    }

    if (record.type === 'turn_context' && payload) {
      const cwd = extractString(payload.cwd)
      if (cwd) {
        accumulator.cwd = cwd
      }
      const model = extractModel(payload)
      if (model) {
        accumulator.model = model
      }
      continue
    }

    if (!payload) {
      continue
    }

    if (record.type === 'response_item' && payload.type === 'message') {
      accumulator.messageCount++
      if (payload.role === 'user' && !accumulator.title) {
        accumulator.title = extractContentText(payload.content)
      }
      addPreviewContent(
        accumulator,
        payload.role === 'assistant' ? 'assistant' : payload.role === 'user' ? 'user' : 'unknown',
        payload.content,
        record.timestamp
      )
      continue
    }

    if (record.type !== 'event_msg') {
      continue
    }

    if (payload.type === 'user_message') {
      accumulator.messageCount++
      if (!accumulator.title) {
        accumulator.title = extractContentText(payload.message)
      }
      addPreviewContent(accumulator, 'user', payload.message, record.timestamp)
      continue
    }

    if (payload.type === 'agent_message') {
      accumulator.messageCount++
      addPreviewContent(accumulator, 'assistant', payload.message, record.timestamp)
      continue
    }

    if (payload.type !== 'token_count') {
      continue
    }

    const info = asRecord(payload.info)
    if (!info) {
      continue
    }
    const totalUsage = normalizeCodexUsage(info.total_token_usage)
    const lastUsage = normalizeCodexUsage(info.last_token_usage)
    const delta = totalUsage ? subtractCodexUsage(totalUsage, previousTotals) : lastUsage
    if (totalUsage) {
      previousTotals = totalUsage
    }
    if (delta) {
      accumulator.totalTokens += delta.totalTokens
    }
    const model = extractModel(payload)
    if (model) {
      accumulator.model = model
    }
  }

  return finalizeSession(accumulator, platform)
}

export async function parseGeminiSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  if (file.path.endsWith('.jsonl')) {
    return parseGeminiJsonlSessionFile(file, platform)
  }

  const record = asRecord(JSON.parse(await readFile(file.path, 'utf-8')) as unknown)
  if (!record) {
    return null
  }
  const accumulator = createAccumulator({
    agent: 'gemini',
    file,
    sessionId: extractString(record.sessionId) ?? sessionIdFromFileName(file.path)
  })
  updateTimeline(accumulator, extractString(record.startTime))
  updateTimeline(accumulator, extractString(record.lastUpdated))
  for (const message of arrayValue(record.messages)) {
    consumeGeminiMessage(accumulator, asRecord(message))
  }
  return finalizeSession(accumulator, platform)
}

async function parseGeminiJsonlSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'gemini',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }
    const setRecord = asRecord(record.$set)
    if (setRecord) {
      updateTimeline(accumulator, extractString(setRecord.lastUpdated))
      continue
    }
    const sessionId = extractString(record.sessionId)
    if (sessionId) {
      accumulator.sessionId = sessionId
    }
    updateTimeline(accumulator, extractString(record.startTime))
    updateTimeline(accumulator, extractString(record.lastUpdated))
    consumeGeminiMessage(accumulator, record)
  }

  return finalizeSession(accumulator, platform)
}

function consumeGeminiMessage(
  accumulator: SessionAccumulator,
  record: Record<string, unknown> | null
): void {
  if (!record) {
    return
  }
  updateTimeline(accumulator, extractString(record.timestamp))
  if (record.type === 'user') {
    accumulator.messageCount++
    accumulator.title ??= extractContentText(record.content)
    addPreviewContent(accumulator, 'user', record.content, record.timestamp)
    return
  }
  if (record.type === 'gemini') {
    accumulator.messageCount++
    addPreviewContent(accumulator, 'assistant', record.content, record.timestamp)
    const model = extractString(record.model)
    if (model) {
      accumulator.model = model
    }
    accumulator.totalTokens += tokenTotal(record.tokens)
  }
}

export async function parseCopilotSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'copilot',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }
    updateTimeline(accumulator, extractString(record.timestamp))
    const data = asRecord(record.data)
    if (record.type === 'session.start' && data) {
      const sessionId = extractString(data.sessionId)
      if (sessionId) {
        accumulator.sessionId = sessionId
      }
      updateTimeline(accumulator, extractString(data.startTime))
      continue
    }
    if (record.type === 'session.model_change' && data) {
      accumulator.model = extractString(data.newModel) ?? accumulator.model
      continue
    }
    if (record.type === 'session.info' && data) {
      accumulator.cwd = extractTrustedFolder(data.message) ?? accumulator.cwd
      continue
    }
    if (record.type === 'user.message' && data) {
      accumulator.messageCount++
      accumulator.title ??= normalizeTitleText(
        extractString(data.transformedContent) ?? extractString(data.content) ?? ''
      )
      addPreviewMessage(accumulator, {
        role: 'user',
        text: extractString(data.transformedContent) ?? extractString(data.content),
        timestamp: record.timestamp
      })
      continue
    }
    if (record.type === 'assistant.message' && data) {
      accumulator.messageCount++
      addPreviewMessage(accumulator, {
        role: 'assistant',
        text: extractString(data.content),
        timestamp: record.timestamp
      })
      continue
    }
    if (record.type === 'session.shutdown' && data) {
      accumulator.model = extractString(data.currentModel) ?? accumulator.model
      accumulator.totalTokens += numberValue(data.currentTokens)
      accumulator.totalTokens += copilotModelMetricsTotal(data.modelMetrics)
    }
  }

  return finalizeSession(accumulator, platform)
}

export async function parseCursorSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'cursor',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }
    updateTimeline(accumulator, extractString(record.timestamp))
    const role = extractString(record.role)
    if (role === 'user' || role === 'assistant') {
      accumulator.messageCount++
      if (role === 'user') {
        accumulator.title ??=
          extractMessageText(record.message) ?? extractContentText(record.content)
      }
      addPreviewContent(
        accumulator,
        role,
        asRecord(record.message)?.content ?? record.content,
        record.timestamp
      )
    }
  }
  return finalizeSession(accumulator, platform)
}

export async function parseOpenCodeSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const record = asRecord(JSON.parse(await readFile(file.path, 'utf-8')) as unknown)
  if (!record) {
    return null
  }
  const sessionId = extractString(record.id) ?? sessionIdFromFileName(file.path)
  const accumulator = createAccumulator({ agent: 'opencode', file, sessionId })
  accumulator.title = normalizeTitleText(extractString(record.title) ?? '')
  accumulator.cwd = extractString(record.directory)
  updateTimeline(accumulator, timeObjectValue(record.time, 'created'))
  updateTimeline(accumulator, timeObjectValue(record.time, 'updated'))
  await consumeOpenCodeMessages(accumulator, findOpenCodeStorageRoot(file.path), sessionId)
  return finalizeSession(accumulator, platform)
}

async function consumeOpenCodeMessages(
  accumulator: SessionAccumulator,
  storageRoot: string | null,
  sessionId: string
): Promise<void> {
  if (!storageRoot) {
    return
  }
  const messageDir = join(storageRoot, 'message', sessionId)
  let entries
  try {
    entries = await readdir(messageDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const message = asRecord(
      JSON.parse(await readFile(join(messageDir, entry.name), 'utf-8')) as unknown
    )
    if (!message) {
      continue
    }
    const role = extractString(message.role)
    if (role === 'user' || role === 'assistant') {
      accumulator.messageCount++
      updateTimeline(accumulator, timeObjectValue(message.time, 'created'))
      if (role === 'user') {
        accumulator.title ??= extractString(asRecord(message.summary)?.title)
        accumulator.title ??= extractString(asRecord(message.summary)?.body)
      }
      addPreviewMessage(accumulator, {
        role,
        text:
          extractPreviewContentText(message.content) ??
          extractString(asRecord(message.summary)?.body) ??
          extractString(asRecord(message.summary)?.title),
        timestamp: timeObjectValue(message.time, 'created')
      })
      accumulator.model =
        extractString(asRecord(message.model)?.modelID) ||
        extractString(message.modelID) ||
        accumulator.model
      accumulator.totalTokens += tokenTotal(message.tokens)
    }
  }
}

export async function parseHermesSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const record = asRecord(JSON.parse(await readFile(file.path, 'utf-8')) as unknown)
  if (!record) {
    return null
  }
  const accumulator = createAccumulator({
    agent: 'hermes',
    file,
    sessionId: extractString(record.session_id) ?? sessionIdFromFileName(file.path)
  })
  accumulator.model = extractString(record.model)
  accumulator.cwd = extractString(record.cwd)
  updateTimeline(accumulator, extractString(record.session_start))
  updateTimeline(accumulator, extractString(record.last_updated))
  for (const message of arrayValue(record.messages)) {
    const messageRecord = asRecord(message)
    const role = extractString(messageRecord?.role)
    if (role === 'user' || role === 'assistant') {
      accumulator.messageCount++
      if (role === 'user') {
        accumulator.title ??= extractContentText(messageRecord?.content)
      }
      addPreviewContent(accumulator, role, messageRecord?.content)
    }
  }
  if (accumulator.messageCount === 0) {
    accumulator.messageCount = numberValue(record.message_count)
  }
  return finalizeSession(accumulator, platform)
}

export async function parseRovoSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const metadata = asRecord(JSON.parse(await readFile(file.path, 'utf-8')) as unknown)
  if (!metadata) {
    return null
  }
  const accumulator = createAccumulator({
    agent: 'rovo',
    file,
    sessionId: basename(dirname(file.path))
  })
  accumulator.title = firstString(metadata, ['title', 'name', 'summary'])
  accumulator.cwd = firstString(metadata, [
    'workspace_path',
    'workspacePath',
    'workspace',
    'cwd',
    'working_directory',
    'workingDirectory',
    'project_path',
    'projectPath'
  ])
  updateTimeline(
    accumulator,
    extractString(metadata.created_at) ?? extractString(metadata.createdAt)
  )
  updateTimeline(
    accumulator,
    extractString(metadata.updated_at) ?? extractString(metadata.updatedAt)
  )

  const contextPath = join(dirname(file.path), 'session_context.json')
  const context = await readJsonObjectIfExists(contextPath)
  if (context) {
    consumeRovoSessionContext(accumulator, context)
  }

  return finalizeSession(accumulator, platform)
}

function consumeRovoSessionContext(
  accumulator: SessionAccumulator,
  context: Record<string, unknown>
): void {
  for (const message of arrayValue(context.messages)) {
    const record = asRecord(message)
    const role = extractString(record?.role)
    if (role === 'user' || role === 'assistant') {
      accumulator.messageCount++
      updateTimeline(accumulator, extractString(record?.timestamp))
      if (role === 'user') {
        accumulator.title ??= extractContentText(record?.content)
      }
      addPreviewContent(accumulator, role, record?.content, record?.timestamp)
    }
  }

  for (const historyEntry of arrayValue(context.message_history)) {
    consumeRovoHistoryEntry(accumulator, asRecord(historyEntry))
  }
}

function consumeRovoHistoryEntry(
  accumulator: SessionAccumulator,
  record: Record<string, unknown> | null
): void {
  if (!record) {
    return
  }
  updateTimeline(accumulator, extractString(record.timestamp))
  const role = extractString(record.role) ?? rovoRoleFromKind(record.kind)
  if (role !== 'user' && role !== 'assistant') {
    return
  }
  const text = rovoPartsText(arrayValue(record.parts), role)
  if (!text) {
    return
  }
  accumulator.messageCount++
  if (role === 'user') {
    accumulator.title ??= text
  }
  addPreviewMessage(accumulator, {
    role,
    text,
    timestamp: record.timestamp
  })
}

function rovoRoleFromKind(value: unknown): 'user' | 'assistant' | null {
  if (value === 'request') {
    return 'user'
  }
  if (value === 'response') {
    return 'assistant'
  }
  return null
}

function rovoPartsText(parts: unknown[], role: 'user' | 'assistant'): string | null {
  const texts: string[] = []
  for (const part of parts) {
    const record = asRecord(part)
    if (!record) {
      continue
    }
    const kind = extractString(record.part_kind)
    if (role === 'user' && kind !== 'user-prompt' && kind !== 'text') {
      continue
    }
    if (role === 'assistant' && kind !== 'text') {
      continue
    }
    const text = extractString(record.content) ?? extractString(record.text)
    if (text) {
      texts.push(text)
    }
  }
  return normalizeTitleText(texts.join(' '))
}

export async function parseMessageGraphSessionFile(
  agent: 'openclaw' | 'pi',
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent,
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }
    updateTimeline(accumulator, extractString(record.timestamp))
    if (record.type === 'session') {
      const sessionId = extractString(record.id)
      if (sessionId) {
        accumulator.sessionId = sessionId
      }
      accumulator.cwd = extractString(record.cwd) ?? accumulator.cwd
      continue
    }
    if (record.type === 'model_change') {
      accumulator.model = extractString(record.modelId) ?? accumulator.model
      continue
    }
    if (record.type !== 'message') {
      continue
    }
    const message = asRecord(record.message)
    const role = extractString(message?.role)
    if (role === 'user' || role === 'assistant') {
      accumulator.messageCount++
      if (role === 'user') {
        accumulator.title ??= extractMessageText(message)
      } else {
        accumulator.model = extractString(message?.model) ?? accumulator.model
        accumulator.totalTokens += tokenTotal(message?.usage)
      }
      addPreviewContent(accumulator, role, message?.content, record.timestamp)
    }
  }

  return finalizeSession(accumulator, platform)
}

export async function parseDroidSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const accumulator = createAccumulator({
    agent: 'droid',
    file,
    sessionId: sessionIdFromFileName(file.path)
  })
  const lines = createInterface({
    input: createReadStream(file.path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })

  for await (const line of lines) {
    const record = parseJsonObject(line)
    if (!record) {
      continue
    }
    updateTimeline(accumulator, record.timestamp)
    if (record.type === 'session_start') {
      accumulator.sessionId = extractString(record.id) ?? accumulator.sessionId
      accumulator.title = normalizeTitleText(extractString(record.title) ?? '')
      accumulator.cwd = extractString(record.cwd) ?? accumulator.cwd
      continue
    }
    if (record.type === 'system') {
      accumulator.cwd = extractString(record.cwd) ?? accumulator.cwd
      accumulator.model = extractString(record.model) ?? accumulator.model
    }
    const streamSessionId = extractString(record.session_id) ?? extractString(record.sessionId)
    if (streamSessionId) {
      accumulator.sessionId = streamSessionId
    }
    if (record.type === 'message') {
      const role = extractString(record.role) ?? extractString(asRecord(record.message)?.role)
      if (role === 'user' || role === 'assistant') {
        accumulator.messageCount++
        if (role === 'user') {
          accumulator.title ??=
            normalizeTitleText(extractString(record.text) ?? '') ||
            extractMessageText(asRecord(record.message))
        }
        addPreviewMessage(accumulator, {
          role,
          text:
            extractString(record.text) ??
            extractPreviewContentText(asRecord(record.message)?.content),
          timestamp: record.timestamp
        })
      }
    } else if (record.type === 'completion') {
      accumulator.messageCount++
      accumulator.totalTokens += tokenTotal(record.usage)
      addPreviewMessage(accumulator, {
        role: 'assistant',
        text: extractString(record.finalText),
        timestamp: record.timestamp
      })
    }
  }
  return finalizeSession(accumulator, platform)
}

async function discoverFiles(args: {
  rootDir: string
  limit: number
  agent: AiVaultAgent
  issues: AiVaultScanIssue[]
  extensions: string[]
  filePredicate?: (path: string) => boolean
}): Promise<SessionFileDiscovery> {
  const paths = await walkSessionFiles(args.rootDir, args.agent, args.issues, {
    extensions: new Set(args.extensions),
    filePredicate: args.filePredicate
  })
  const files: FileWithMtime[] = []
  for (const path of paths) {
    try {
      const fileStat = await stat(path)
      files.push({
        path,
        mtimeMs: fileStat.mtimeMs,
        modifiedAt: fileStat.mtime.toISOString()
      })
    } catch (err) {
      args.issues.push({ agent: args.agent, path, message: errorMessage(err) })
    }
  }
  return {
    agent: args.agent,
    files: files.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, args.limit)
  }
}

async function discoverOpenClawFiles(args: {
  rootDirs: string[]
  limit: number
  issues: AiVaultScanIssue[]
}): Promise<SessionFileDiscovery> {
  const discoveries = await Promise.all(
    args.rootDirs.map((rootDir) =>
      discoverFiles({
        rootDir: basename(rootDir) === 'agents' ? rootDir : join(rootDir, 'agents'),
        limit: args.limit,
        agent: 'openclaw',
        issues: args.issues,
        extensions: ['.jsonl'],
        filePredicate: (path) => path.split(/[\\/]/).includes('sessions')
      })
    )
  )
  const files = discoveries
    .flatMap((discovery) => discovery.files)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, args.limit)
  return { agent: 'openclaw', files }
}

async function walkSessionFiles(
  dirPath: string,
  agent: AiVaultAgent,
  issues: AiVaultScanIssue[],
  options: {
    extensions: Set<string>
    filePredicate?: (path: string) => boolean
  }
): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkSessionFiles(fullPath, agent, issues, options)))
      continue
    }
    if (
      entry.isFile() &&
      options.extensions.has(extname(entry.name).toLowerCase()) &&
      (options.filePredicate?.(fullPath) ?? true)
    ) {
      files.push(fullPath)
    }
  }
  return files
}

function createAccumulator(args: {
  agent: AiVaultAgent
  file: FileWithMtime
  sessionId: string
}): SessionAccumulator {
  return {
    agent: args.agent,
    sessionId: args.sessionId,
    title: null,
    fallbackTitle: null,
    cwd: null,
    branch: null,
    model: null,
    filePath: args.file.path,
    createdAt: null,
    updatedAt: null,
    modifiedAt: args.file.modifiedAt,
    messageCount: 0,
    totalTokens: 0,
    previewMessages: [],
    latestTimestampMs: 0
  }
}

function finalizeSession(
  accumulator: SessionAccumulator,
  platform: NodeJS.Platform
): AiVaultSession | null {
  const sessionId = accumulator.sessionId.trim()
  if (!sessionId) {
    return null
  }
  const title =
    accumulator.title ||
    accumulator.fallbackTitle ||
    `${aiVaultAgentLabel(accumulator.agent)} ${sessionId.slice(0, 8)}`

  return {
    id: `${accumulator.agent}:${sessionId}:${accumulator.filePath}`,
    agent: accumulator.agent,
    sessionId,
    title,
    cwd: accumulator.cwd,
    branch: accumulator.branch,
    model: accumulator.model,
    filePath: accumulator.filePath,
    createdAt: accumulator.createdAt,
    updatedAt: accumulator.updatedAt,
    modifiedAt: accumulator.modifiedAt,
    messageCount: accumulator.messageCount,
    totalTokens: accumulator.totalTokens,
    previewMessages: accumulator.previewMessages,
    resumeCommand: buildAiVaultResumeCommand({
      agent: accumulator.agent,
      sessionId,
      cwd: accumulator.cwd,
      platform
    })
  }
}

function updateTimeline(accumulator: SessionAccumulator, timestamp: unknown): void {
  const parsed = timestampMs(timestamp)
  if (!Number.isFinite(parsed)) {
    return
  }
  const iso = new Date(parsed).toISOString()
  if (!accumulator.createdAt || parsed < Date.parse(accumulator.createdAt)) {
    accumulator.createdAt = iso
  }
  if (!accumulator.updatedAt || parsed >= Date.parse(accumulator.updatedAt)) {
    accumulator.updatedAt = iso
    accumulator.latestTimestampMs = parsed
  }
}

function timestampMs(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return Number.NaN
  }
  return value > 1_000_000_000_000 ? value : value * 1000
}

function addPreviewMessage(
  accumulator: SessionAccumulator,
  args: {
    role: AiVaultSessionPreviewMessage['role']
    text: string | null
    timestamp?: unknown
  }
): void {
  const text = normalizePreviewText(args.text ?? '')
  if (!text) {
    return
  }
  accumulator.previewMessages.push({
    role: args.role,
    text,
    timestamp: timestampIso(args.timestamp)
  })
  if (accumulator.previewMessages.length > SESSION_PREVIEW_MESSAGE_LIMIT) {
    accumulator.previewMessages.shift()
  }
}

function addPreviewContent(
  accumulator: SessionAccumulator,
  role: AiVaultSessionPreviewMessage['role'],
  content: unknown,
  timestamp?: unknown
): void {
  addPreviewMessage(accumulator, {
    role,
    text: extractPreviewContentText(content),
    timestamp
  })
}

function timestampIso(value: unknown): string | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function updateLatestLocation(
  accumulator: SessionAccumulator,
  record: Record<string, unknown>
): void {
  const timestamp = extractString(record.timestamp)
  const parsed = timestamp ? Date.parse(timestamp) : accumulator.latestTimestampMs
  if (!Number.isFinite(parsed) || parsed < accumulator.latestTimestampMs) {
    return
  }
  const cwd = extractString(record.cwd)
  const branch = extractString(record.gitBranch)
  if (cwd) {
    accumulator.cwd = cwd
  }
  if (branch) {
    accumulator.branch = branch
  }
}

function sessionSortTime(session: AiVaultSession): number {
  return Date.parse(session.updatedAt ?? session.modifiedAt)
}

function sessionIdFromFileName(filePath: string): string {
  const fileName = basename(filePath, extname(filePath))
  const match = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  return match?.[0] ?? fileName
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  if (!line.trim()) {
    return null
  }
  try {
    const parsed = JSON.parse(line) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractModel(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  return (
    extractString(record.model) ||
    extractString(record.model_name) ||
    extractString(asRecord(record.metadata)?.model) ||
    extractString(asRecord(record.info)?.model) ||
    null
  )
}

function extractGitBranch(value: unknown): string | null {
  const git = asRecord(value)
  if (!git) {
    return null
  }
  return extractString(git.branch) || extractString(git.current_branch)
}

function extractMessageText(value: unknown): string | null {
  const message = asRecord(value)
  if (!message) {
    return null
  }
  return extractContentText(message.content)
}

function extractContentText(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeTitleText(value)
  }
  if (!Array.isArray(value)) {
    return null
  }
  const parts: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const record = asRecord(item)
    const text = extractString(record?.text) || extractString(record?.content)
    if (text) {
      parts.push(text)
    }
  }
  return normalizeTitleText(parts.join(' '))
}

function normalizeTitleText(value: string): string | null {
  const withoutReminders = value
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!withoutReminders) {
    return null
  }
  if (/^# AGENTS\.md instructions for\b/i.test(withoutReminders)) {
    return null
  }
  if (/^<INSTRUCTIONS>/i.test(withoutReminders)) {
    return null
  }
  return withoutReminders.length > 96 ? `${withoutReminders.slice(0, 93)}...` : withoutReminders
}

function extractPreviewContentText(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizePreviewText(value)
  }
  if (!Array.isArray(value)) {
    return null
  }
  const parts: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    const record = asRecord(item)
    const text = extractString(record?.text) || extractString(record?.content)
    if (text) {
      parts.push(text)
    }
  }
  return normalizePreviewText(parts.join(' '))
}

function normalizePreviewText(value: string): string | null {
  const normalized = value
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) {
    return null
  }
  if (/^# AGENTS\.md instructions for\b/i.test(normalized) || /^<INSTRUCTIONS>/i.test(normalized)) {
    return null
  }
  return normalized.length > SESSION_PREVIEW_TEXT_LIMIT
    ? `${normalized.slice(0, SESSION_PREVIEW_TEXT_LIMIT - 3)}...`
    : normalized
}

async function readJsonObjectIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(JSON.parse(await readFile(filePath, 'utf-8')) as unknown)
  } catch {
    return null
  }
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = extractString(record[key])
    if (value) {
      return value
    }
  }
  return null
}

function tokenTotal(value: unknown): number {
  const usage = asRecord(value)
  if (!usage) {
    return 0
  }
  const explicitTotal =
    numberValue(usage.total) || numberValue(usage.totalTokens) || numberValue(usage.total_tokens)
  if (explicitTotal > 0) {
    return explicitTotal
  }

  const fields: unknown[] = [
    usage.input,
    usage.inputTokens,
    usage.input_tokens,
    usage.output,
    usage.outputTokens,
    usage.output_tokens,
    usage.cacheRead,
    usage.cacheReadTokens,
    usage.cache_read_input_tokens,
    usage.cacheWrite,
    usage.cacheWriteTokens,
    usage.cache_creation_input_tokens,
    usage.cached,
    usage.cachedInputTokens,
    usage.cached_input_tokens,
    usage.reasoning,
    usage.reasoningOutputTokens,
    usage.reasoning_output_tokens
  ]
  return fields.reduce<number>((total, current) => total + numberValue(current), 0)
}

function extractTrustedFolder(value: unknown): string | null {
  const message = extractString(value)
  if (!message) {
    return null
  }
  return message.match(/^Folder (.+) has been added to trusted folders\.$/)?.[1] ?? null
}

function copilotModelMetricsTotal(value: unknown): number {
  const metrics = asRecord(value)
  if (!metrics) {
    return 0
  }
  let total = 0
  for (const metric of Object.values(metrics)) {
    const record = asRecord(metric)
    const usage = asRecord(record?.usage)
    if (!usage) {
      continue
    }
    total += tokenTotal(usage)
  }
  return total
}

function timeObjectValue(value: unknown, key: string): string | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const rawValue = record[key]
  if (typeof rawValue === 'string') {
    return rawValue
  }
  const parsed = timestampMs(rawValue)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return new Date(parsed).toISOString()
}

function findOpenCodeStorageRoot(filePath: string): string | null {
  const sessionDir = dirname(filePath)
  const sessionRoot = dirname(sessionDir)
  if (basename(sessionRoot) !== 'session') {
    return null
  }
  return dirname(sessionRoot)
}

function normalizePiSessionsDir(rawValue: string): string {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return join(homedir(), '.pi', 'agent', 'sessions')
  }
  const normalized = trimmed.replace(/[\\/]+$/, '')
  const leaf = basename(normalized)
  if (leaf === 'sessions') {
    return normalized
  }
  if (leaf === 'agent') {
    return join(normalized, 'sessions')
  }
  if (leaf === '.pi') {
    return join(normalized, 'agent', 'sessions')
  }
  return normalized
}

function claudeUsageTotal(value: unknown): number {
  const usage = asRecord(value)
  if (!usage) {
    return 0
  }
  return (
    numberValue(usage.input_tokens) +
    numberValue(usage.output_tokens) +
    numberValue(usage.cache_read_input_tokens) +
    numberValue(usage.cache_creation_input_tokens)
  )
}

function normalizeCodexUsage(value: unknown): CodexUsageSnapshot | null {
  const usage = asRecord(value)
  if (!usage) {
    return null
  }
  const inputTokens = numberValue(usage.input_tokens)
  const cachedInputTokens = numberValue(usage.cached_input_tokens ?? usage.cache_read_input_tokens)
  const outputTokens = numberValue(usage.output_tokens)
  const reasoningOutputTokens = numberValue(usage.reasoning_output_tokens)
  const totalTokens = numberValue(usage.total_tokens)

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens
  }
}

function subtractCodexUsage(
  current: CodexUsageSnapshot,
  previous: CodexUsageSnapshot | null
): CodexUsageSnapshot {
  return {
    inputTokens: Math.max(current.inputTokens - (previous?.inputTokens ?? 0), 0),
    cachedInputTokens: Math.max(current.cachedInputTokens - (previous?.cachedInputTokens ?? 0), 0),
    outputTokens: Math.max(current.outputTokens - (previous?.outputTokens ?? 0), 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0),
      0
    ),
    totalTokens: Math.max(current.totalTokens - (previous?.totalTokens ?? 0), 0)
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
