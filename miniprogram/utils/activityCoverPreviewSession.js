let previewSession = null;

function setActivityCoverPreviewSession(session) {
  previewSession = session && session.artist ? session : null;
}

function takeActivityCoverPreviewSession() {
  const session = previewSession;
  previewSession = null;
  return session;
}

module.exports = {
  setActivityCoverPreviewSession,
  takeActivityCoverPreviewSession
};
