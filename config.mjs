// Public settings only. Never put an API key here.
export const contentConfig = Object.freeze({
  apiBase: 'https://vocabulary-dictionary.cjt110801.workers.dev',
  automaticQueriesApproved: false,
  contentRetentionApproved: false
});

// Enable only after a real provider key, budget and quality checks are ready.
export const sentenceFeedbackConfig=Object.freeze({apiBase:'https://vocabulary-feedback.cjt110801.workers.dev',enabled:true});
