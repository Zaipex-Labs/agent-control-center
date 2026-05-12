// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [Q-1] Public API of the handlers package. The pre-v0.2.5 broker had
// a 1900-LOC `src/broker/handlers.ts` god-file (audit §6 Q-1) mixing
// HTTP + auth + fs + spawn + DB + WS + tmux. v0.2.5 splits it into
// per-concern files in `src/broker/handlers/` and re-exports the same
// surface from this index. Everything that used to import from
// `'../broker/handlers.js'` keeps working unchanged because the
// top-level `handlers.ts` now re-exports from this index too.

export {
  // Body parsing + helpers callers consume directly.
  parseBody,
  parseRawBody,
  BodyTooLargeError,
  DEFAULT_MAX_BODY_SIZE,
} from './_helpers.js';

export {
  handleHealth,
  handleRegister,
  handleHeartbeat,
  handleUnregister,
  handleSetSummary,
  handleSetRole,
  handleCsrfIssue,
  handleListPeers,
} from './peers.js';

export {
  handleSharedSet,
  handleSharedGet,
  handleSharedList,
  handleSharedDelete,
  handleDecisionsRecall,
  DECISIONS_NAMESPACE,
  RECALL_DEFAULT_LIMIT,
  RECALL_MAX_LIMIT,
} from './shared.js';

export {
  handleSendMessage,
  handleSendToRole,
  handlePollMessages,
  handleGetHistory,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
} from './messages.js';

export {
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleDeleteThread,
  handleSearchThreads,
  handleThreadSummary,
} from './threads.js';

export {
  handleUploadBlob,
  handleDownloadBlob,
  handleBlobStats,
} from './blobs.js';

export {
  handleBrowse,
  migrateLegacyProjects,
  handleListProjects,
  handleCreateProject,
  handleCreateDemo,
  handleAddAgent,
  handleUpdateProject,
  handleProjectUp,
  handleListModifiedFiles,
  handleSaveResume,
  handleProjectDown,
  handleDeleteProject,
  buildSaveResumePrompt,
} from './projects.js';

export {
  handleSkillsList,
  handleSkillsGet,
  handleSkillsSave,
  handleSkillsDelete,
  handleSkillsListExamples,
} from './skills.js';

export { handleListPowers } from './powers.js';
export { handleProjectTokens, handleProjectCoordOverhead } from './tokens.js';
