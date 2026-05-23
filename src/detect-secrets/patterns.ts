interface SecretPattern {
  name: string;
  pattern: RegExp;
  severe: boolean;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // ── AWS ──
  {
    name: "AWS Access Key",
    pattern: /(?<![A-Z0-9])(AKIA[0-9A-Z]{16})(?![A-Z0-9])/,
    severe: true,
  },
  {
    name: "AWS Secret Key",
    pattern: /aws[_\-]?secret[_\-]?(?:access[_\-]?)?key["':\s=]+([A-Za-z0-9\/+]{40})/i,
    severe: true,
  },

  // ── GCP ──
  {
    name: "GCP API Key",
    pattern: /AIza[0-9A-Za-z\-_]{35}/,
    severe: true,
  },

  // ── GitHub ──
  {
    name: "GitHub Token (classic)",
    pattern: /ghp_[A-Za-z0-9]{36}/,
    severe: true,
  },
  {
    name: "GitHub Fine-grained Token",
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
    severe: true,
  },
  {
    name: "GitHub OAuth Token",
    pattern: /gho_[A-Za-z0-9]{36}/,
    severe: true,
  },

  // ── Stripe ──
  {
    name: "Stripe Secret Key",
    pattern: /sk_live_[0-9a-zA-Z]{24,}/,
    severe: true,
  },
  {
    name: "Stripe Publishable Key",
    pattern: /pk_live_[0-9a-zA-Z]{24,}/,
    severe: true,
  },
  {
    name: "Stripe Test Key",
    pattern: /sk_test_[0-9a-zA-Z]{24,}/,
    severe: false,
  },

  // ── Twilio ──
  {
    name: "Twilio Account SID",
    pattern: /twilio.*?account[_\-]?sid["':\s=]+([AC][0-9a-fA-F]{32})/is,
    severe: true,
  },
  {
    name: "Twilio Auth Token",
    pattern: /twilio.*?auth.*?token["':\s=]+([a-f0-9]{32})/i,
    severe: true,
  },

  // ── SendGrid ──
  {
    name: "SendGrid API Key",
    pattern: /SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}/,
    severe: true,
  },

  // ── Mailgun ──
  {
    name: "Mailgun API Key",
    pattern: /key-[0-9a-zA-Z]{32}/,
    severe: true,
  },

  // ── Slack ──
  {
    name: "Slack Bot Token",
    pattern: /xoxb-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24}/,
    severe: true,
  },
  {
    name: "Slack User Token",
    pattern: /xoxp-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+/,
    severe: true,
  },
  {
    name: "Slack Webhook URL",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/,
    severe: true,
  },

  // ── Firebase ──
  {
    name: "Firebase API Key",
    pattern: /"apiKey"\s*:\s*"(AIza[0-9A-Za-z\-_]{35})"/,
    severe: true,
  },

  // ── JWT ──
  {
    name: "JWT Token",
    pattern: /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/,
    severe: true,
  },

  // ── OAuth / Generic ──
  {
    name: "OAuth Client Secret",
    pattern: /client[_\-]?secret["':\s=]+([A-Za-z0-9_\-]{20,80})/i,
    severe: true,
  },
  {
    name: "OAuth Client ID",
    pattern: /client[_\-]?id["':\s=]+([A-Za-z0-9_\-]{15,60})/i,
    severe: false,
  },

  // ── Authorization Headers ──
  {
    name: "Hardcoded Authorization Header",
    pattern:
      /["']Authorization["']\s*:\s*["'](?:Bearer|Basic|Token)\s+([A-Za-z0-9+\/=_.\-]{20,})["']/,
    severe: true,
  },
  {
    name: "Hardcoded X-API-Key Header",
    pattern: /["']x-api-key["']\s*:\s*["']([A-Za-z0-9_\-]{20,80})["']/i,
    severe: true,
  },

  // ── Private Keys ──
  {
    name: "RSA Private Key",
    pattern: /-----BEGIN RSA PRIVATE KEY-----/,
    severe: true,
  },
  {
    name: "EC Private Key",
    pattern: /-----BEGIN EC PRIVATE KEY-----/,
    severe: true,
  },
  {
    name: "Private Key (generic)",
    pattern: /-----BEGIN PRIVATE KEY-----/,
    severe: true,
  },

  // ── Crypto / Web3 ──
  {
    name: "Ethereum Private Key",
    pattern: /(?:0x)?[0-9a-fA-F]{64}/,
    severe: true,
  },
  {
    name: "Mnemonic Phrase",
    pattern: /(?:mnemonic|seed[_\s]?phrase)["']?\s*[:=]\s*["']([^"']{20,})["']/i,
    severe: true,
  },

  // ── Database URIs ──
  {
    name: "MongoDB URI",
    pattern: /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/,
    severe: true,
  },
  {
    name: "PostgreSQL URI",
    pattern: /postgres(?:ql)?:\/\/[^\s"'<>]+/i,
    severe: true,
  },
  {
    name: "MySQL URI",
    pattern: /mysql:\/\/[^\s"'<>]+/,
    severe: true,
  },
  {
    name: "Redis URI",
    pattern: /rediss?:\/\/[^\s"'<>]+/,
    severe: true,
  },

  // ── Cloud Storage ──
  {
    name: "AWS S3 Bucket URL",
    pattern: /https?:\/\/[a-z0-9.\-]+\.s3(?:[\-\.][a-z0-9\-]+)?\.amazonaws\.com/i,
    severe: false,
  },
  {
    name: "GCS Bucket URL",
    pattern: /https:\/\/storage\.googleapis\.com\/[a-z0-9_.\-]+/,
    severe: false,
  },
  {
    name: "Azure Blob Storage URL",
    pattern: /https:\/\/[a-z0-9]+\.blob\.core\.windows\.net\/[^\s"'<>]+/i,
    severe: false,
  },

  // ── Internal URLs with credentials ──
  {
    name: "URL with Embedded Credentials",
    pattern: /https?:\/\/[^:@\s"']+:[^@\s"']+@[^\s"'<>]+/,
    severe: true,
  },

  // ── Generic secrets (with entropy check) ──
  {
    name: "Generic API Key",
    pattern: /(?:api[_\-]?key|apikey)["']?\s*[:=]\s*["']([A-Za-z0-9_\-]{20,60})["']/i,
    severe: false,
  },
  {
    name: "Generic Secret",
    pattern: /(?:secret|client_secret)["']?\s*[:=]\s*["']([A-Za-z0-9_\-+\/]{20,80})["']/i,
    severe: false,
  },
  {
    name: "Generic Password",
    pattern: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']([^"']{8,50})["']/i,
    severe: false,
  },
];
