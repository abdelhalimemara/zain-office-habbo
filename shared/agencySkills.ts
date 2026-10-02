/**
 * Reviewed persona files from msitarzewski/agency-agents (MIT) that Zain Tech agents may install,
 * as `<dir>/<file stem>` (the skill part of an `agency:` id). Listed explicitly so hire and catalog
 * validation stay strict to these files.
 */
const inDir = (dir: string, prefix: string, names: readonly string[]) => names.map((n) => `${dir}/${prefix}${n}`);

export const AGENCY_SKILLS: readonly string[] = [
  ...inDir("engineering", "engineering-", [
    "ai-data-remediation-engineer", "ai-engineer", "api-platform-engineer", "ats-validator-architect",
    "autonomous-optimization-architect", "backend-architect", "china-network-engineer", "cms-developer",
    "code-reviewer", "codebase-onboarding-engineer", "data-engineer", "data-visualization-engineer",
    "database-optimizer", "database-reliability-engineer", "desktop-app-engineer", "developer-tooling-engineer",
    "devops-automator", "drupal-performance", "drupal-shopping-cart", "email-intelligence-engineer",
    "embedded-firmware-engineer", "feishu-integration-developer", "filament-optimization-specialist", "finops-engineer",
    "frontend-developer", "gaussdb-expert", "git-workflow-master", "i18n-engineer",
    "identity-access-engineer", "incident-response-commander", "iot-fleet-engineer", "it-service-manager",
    "knowledge-graph-engineer", "llm-post-training-engineer", "minimal-change-engineer", "mobile-app-builder",
    "mobile-release-engineer", "multi-agent-systems-architect", "network-engineer", "orgscript-engineer",
    "payments-billing-engineer", "pdf-engine-architect", "platform-engineer", "privacy-engineer",
    "prompt-engineer", "rag-pipeline-engineer", "rapid-prototyper", "realtime-collaboration-engineer",
    "rust-refactoring-specialist", "search-relevance-engineer", "section-508-specialist", "senior-developer",
    "servicenow-developer-mentor", "software-architect", "solidity-smart-contract-engineer", "sre",
    "technical-writer", "universal-document-compiler", "uswds-developer", "video-streaming-engineer",
    "voice-ai-integration-engineer", "webassembly-engineer", "wechat-mini-program-developer", "wordpress-performance",
    "wordpress-shopping-cart",
  ]),
  ...inDir("project-management", "", [
    "project-management-experiment-tracker", "project-management-jira-workflow-steward",
    "project-management-meeting-notes-specialist", "project-management-project-shepherd",
    "project-management-studio-operations", "project-management-studio-producer", "project-manager-senior",
  ]),
  ...inDir("testing", "testing-", [
    "accessibility-auditor", "api-tester", "evidence-collector", "performance-benchmarker", "reality-checker",
    "test-automation-engineer", "test-results-analyzer", "tool-evaluator", "workflow-optimizer",
  ]),
];
