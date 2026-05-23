type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
  cwe: string;
  cvss: number;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // ── AWS ──
  {
    name: "AWS Access Key",
    pattern: /(?<![A-Z0-9])(AKIA[0-9A-Z]{16})(?![A-Z0-9])/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.8,
  },
  {
    name: "AWS Secret Key",
    pattern: /aws[_\-]?secret[_\-]?(?:access[_\-]?)?key["':\s=]+([A-Za-z0-9\/+]{40})/i,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.8,
  },

  // ── GCP ──
  {
    name: "GCP API Key",
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.1,
  },
  {
    name: "GCP Service Account",
    pattern: /"type"\s*:\s*"service_account"/,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.1,
  },

  // ── GitHub ──
  {
    name: "GitHub Token (classic)",
    pattern: /ghp_[A-Za-z0-9]{36}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.8,
  },
  {
    name: "GitHub Fine-grained Token",
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.8,
  },
  {
    name: "GitHub OAuth Token",
    pattern: /gho_[A-Za-z0-9]{36}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 8.8,
  },

  // ── Stripe ──
  {
    name: "Stripe Secret Key",
    pattern: /sk_live_[0-9a-zA-Z]{24,}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.8,
  },
  {
    name: "Stripe Publishable Key",
    pattern: /pk_live_[0-9a-zA-Z]{24,}/,
    severity: "HIGH",
    cwe: "CWE-200",
    cvss: 6.5,
  },
  {
    name: "Stripe Test Key",
    pattern: /sk_test_[0-9a-zA-Z]{24,}/,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 4.3,
  },

  // ── Twilio ──
  {
    name: "Twilio Account SID",
    pattern: /AC[0-9a-fA-F]{32}/,
    severity: "HIGH",
    cwe: "CWE-200",
    cvss: 6.5,
  },
  {
    name: "Twilio Auth Token",
    pattern: /twilio.*?auth.*?token["':\s=]+([a-f0-9]{32})/i,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.8,
  },

  // ── SendGrid ──
  {
    name: "SendGrid API Key",
    pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.1,
  },

  // ── Mailgun ──
  {
    name: "Mailgun API Key",
    pattern: /key-[0-9a-zA-Z]{32}/,
    severity: "HIGH",
    cwe: "CWE-798",
    cvss: 7.5,
  },

  // ── Slack ──
  {
    name: "Slack Bot Token",
    pattern: /xoxb-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24}/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.1,
  },
  {
    name: "Slack User Token",
    pattern: /xoxp-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+/,
    severity: "CRITICAL",
    cwe: "CWE-798",
    cvss: 9.1,
  },
  {
    name: "Slack Webhook URL",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/,
    severity: "HIGH",
    cwe: "CWE-200",
    cvss: 6.5,
  },

  // ── Firebase ──
  {
    name: "Firebase API Key",
    pattern: /"apiKey"\s*:\s*"(AIza[0-9A-Za-z\-_]{35})"/,
    severity: "HIGH",
    cwe: "CWE-200",
    cvss: 6.5,
  },

  // ── JWT ──
  {
    name: "JWT Token",
    pattern: /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/,
    severity: "HIGH",
    cwe: "CWE-522",
    cvss: 7.5,
  },

  // ── OAuth / Generic ──
  {
    name: "OAuth Client Secret",
    pattern: /client[_\-]?secret["':\s=]+([A-Za-z0-9_\-]{20,80})/i,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.1,
  },
  {
    name: "OAuth Client ID",
    pattern: /client[_\-]?id["':\s=]+([A-Za-z0-9_\-]{15,60})/i,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 5.3,
  },

  // ── Authorization Headers ──
  {
    name: "Hardcoded Authorization Header",
    pattern:
      /["']Authorization["']\s*:\s*["'](?:Bearer|Basic|Token)\s+([A-Za-z0-9+\/=_.\-]{20,})["']/,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.1,
  },
  {
    name: "Hardcoded X-API-Key Header",
    pattern: /["']x-api-key["']\s*:\s*["']([A-Za-z0-9_\-]{20,80})["']/i,
    severity: "HIGH",
    cwe: "CWE-798",
    cvss: 7.5,
  },

  // ── Generic secrets (with entropy check) ──
  {
    name: "Generic API Key",
    pattern: /(?:api[_\-]?key|apikey)["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{20,60})["']/i,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 5.3,
  },
  {
    name: "Generic Secret",
    pattern: /(?:secret|client_secret)["']?\s*[:=]\s*["']([A-Za-z0-9_\-+\/]{20,80})["']/i,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 5.3,
  },
  {
    name: "Generic Password",
    pattern: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']([^"']{8,50})["']/i,
    severity: "MEDIUM",
    cwe: "CWE-259",
    cvss: 6.5,
  },

  // ── Private Keys ──
  {
    name: "RSA Private Key",
    pattern: /-----BEGIN RSA PRIVATE KEY-----/,
    severity: "CRITICAL",
    cwe: "CWE-321",
    cvss: 9.8,
  },
  {
    name: "EC Private Key",
    pattern: /-----BEGIN EC PRIVATE KEY-----/,
    severity: "CRITICAL",
    cwe: "CWE-321",
    cvss: 9.8,
  },
  {
    name: "Private Key (generic)",
    pattern: /-----BEGIN PRIVATE KEY-----/,
    severity: "CRITICAL",
    cwe: "CWE-321",
    cvss: 9.8,
  },

  // ── Crypto / Web3 ──
  {
    name: "Ethereum Private Key",
    pattern: /(?:0x)?[0-9a-fA-F]{64}/,
    severity: "HIGH",
    cwe: "CWE-321",
    cvss: 8.1,
  },
  {
    name: "Mnemonic Phrase",
    pattern: /(?:mnemonic|seed[_\s]?phrase)["']?\s*[:=]\s*["']([^"']{20,})["']/i,
    severity: "CRITICAL",
    cwe: "CWE-321",
    cvss: 9.8,
  },

  // ── Database URIs ──
  {
    name: "MongoDB URI",
    pattern: /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.8,
  },
  {
    name: "PostgreSQL URI",
    pattern: /postgres(?:ql)?:\/\/[^\s"'<>]+/i,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.8,
  },
  {
    name: "MySQL URI",
    pattern: /mysql:\/\/[^\s"'<>]+/,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.8,
  },
  {
    name: "Redis URI",
    pattern: /rediss?:\/\/[^\s"'<>]+/,
    severity: "HIGH",
    cwe: "CWE-522",
    cvss: 7.5,
  },

  // ── Cloud Storage ──
  {
    name: "AWS S3 Bucket URL",
    pattern: /https?:\/\/[a-z0-9.\-]+\.s3(?:[\-\.][a-z0-9\-]+)?\.amazonaws\.com/i,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 5.3,
  },
  {
    name: "GCS Bucket URL",
    pattern: /https:\/\/storage\.googleapis\.com\/[a-z0-9_.\-]+/,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 5.3,
  },
  {
    name: "Azure Blob Storage URL",
    pattern: /https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/[^\s"'<>]+/i,
    severity: "MEDIUM",
    cwe: "CWE-200",
    cvss: 5.3,
  },

  // ── Internal/Staging URLs with credentials ──
  {
    name: "URL with Embedded Credentials",
    pattern: /https?:\/\/[^:@\s"']+:[^@\s"']+@[^\s"'<>]+/,
    severity: "CRITICAL",
    cwe: "CWE-522",
    cvss: 9.8,
  },

  // ── Hardcoded env strings ──
  {
    name: "Hardcoded Production URL",
    pattern:
      /(?:api_url|base_url|api_base)["']?\s*[:=]\s*["']https?:\/\/(?:api|prod|production)\.[^\s"'<>]{5,80}["']/i,
    severity: "LOW",
    cwe: "CWE-200",
    cvss: 3.1,
  },
];
