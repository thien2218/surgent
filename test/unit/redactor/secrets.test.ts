import { describe, expect, it } from "vitest";
import { containSecrets, replaceSecrets } from "../../../src/redactor/secrets.js";

// Build synthetic credentials at runtime; none are issued keys or usable PEMs.
const mixed = "Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4Yz5";
const hex = "0123456789abcdef".repeat(4);
const marker = "(redacted texts)";
const begin = "-----BEGIN";
const end = "-----END";
const uri = (scheme: string, host = "example.invalid/db") => `${scheme}://${"fake:password@"}${host}`;

const credentials: Array<[string, string, string, string]> = [
  ["AWS access key", "", `AKIA${"1".repeat(16)}`, ""],
  ["AWS secret key", "AWS_SECRET_ACCESS_KEY='", "a".repeat(40), "'"],
  ["GCP key", "", `AIza${"a".repeat(35)}`, ""],
  ["GitHub classic token", "", `ghp_${"a".repeat(36)}`, ""],
  ["GitHub fine-grained token", "", `github_pat_${"a_".repeat(41)}`, ""],
  ["GitHub OAuth token", "", `gho_${"a".repeat(36)}`, ""],
  ["Stripe secret key", "", `sk_live_${"a".repeat(24)}`, ""],
  ["Stripe publishable key", "", `pk_live_${"a".repeat(24)}`, ""],
  ["Stripe test key", "", `sk_test_${mixed}`, ""],
  ["Twilio account SID", "TWILIO\nACCOUNT-SID: '", `A${"0".repeat(32)}`, "'"],
  ["Twilio auth token", "twilio auth token='", "0".repeat(32), "'"],
  ["SendGrid key", "", `SG.${"a".repeat(22)}.${"b".repeat(43)}`, ""],
  ["Mailgun key", "", `key-${"a".repeat(32)}`, ""],
  ["Slack bot token", "", `xoxb-${"1".repeat(11)}-${"2".repeat(13)}-${"a".repeat(24)}`, ""],
  ["Slack user token", "", ["xoxp", "1", "2", "3", "abc"].join("-"), ""],
  ["Slack webhook", "", `https://${"hooks.slack.com"}/services/FAKE/TEST/notreal`, ""],
  ["Firebase key", '"apiKey": "', `AIza${"a".repeat(35)}`, '"'],
  ["JWT", "", `eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`, ""],
  ["OAuth secret", "CLIENT-SECRET='", "a".repeat(20), "'"],
  ["OAuth ID", "client_id='", mixed, "'"],
  ["Authorization", '"Authorization": "Bearer ', "a".repeat(20), '"'],
  ["API key header", '"X-API-KEY": "', "a".repeat(20), '"'],
  ["Ethereum key", "", `0x${"0".repeat(64)}`, ""],
  ["bare hex key", "", "a".repeat(64), ""],
  ["mnemonic", 'seed_phrase="', ["fake words only", "never use this phrase"].join(" "), '"'],
  ...["mongodb", "mongodb+srv", "POSTGRESQL", "postgres", "mysql", "redis", "rediss", "http", "https"]
    .map((scheme): [string, string, string, string] => [scheme, "", uri(scheme), ""]),
  ["S3", "", `https://${"fake-bucket"}.s3.eu-west-1.amazonaws.com`, ""],
  ["GCS", "", `https://${"storage.googleapis.com"}/fake-bucket`, ""],
  ["Azure", "", `https://${"fake123"}.blob.core.windows.net/container`, ""],
  ["generic API key", 'api_key="', mixed, '"'],
  ["generic secret", 'secret="', mixed, '"'],
  ["generic password", 'pwd="', `${mixed}!@#$%`, '"'],
];

describe("credential redaction", () => {
  it.each(credentials)("detects and masks %s without removing surrounding text", (_name, prefix, value, suffix) => {
    const input = `before ${prefix}${value}${suffix} after`;

    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`before ${prefix}${marker}${suffix} after`);
  });

  it.each(["RSA ", "EC ", ""])("masks complete %sprivate-key blocks, not only headers", (kind) => {
    const key = `${begin} ${kind}PRIVATE KEY-----\nZmFrZS1rZXktbm90LXJlYWw=\n${end} ${kind}PRIVATE KEY-----`;

    expect(containSecrets(key)).toBe(true);
    expect(replaceSecrets(`before\n${key}\nafter`)).toBe(`before\n${marker}\nafter`);
  });

  it.each(["RSA ", "EC ", ""])("masks truncated %sprivate keys through end of input", (kind) => {
    const key = `${begin} ${kind}PRIVATE KEY-----\r\nsynthetic body without footer`;

    expect(containSecrets(key)).toBe(true);
    expect(replaceSecrets(`before\r\n${key}`)).toBe(`before\r\n${marker}`);
  });

  it("masks separate PEM blocks while preserving text between them", () => {
    const key = `${begin} PRIVATE KEY-----\r\nZmFrZQ==\r\n${end} PRIVATE KEY-----`;
    expect(replaceSecrets(`${key}\nkeep\n${key}`)).toBe(`${marker}\nkeep\n${marker}`);
  });

  it.each(["Bearer", "Basic", "Token", "bearer", "bAsIc"])("recognizes case-insensitive Authorization scheme %s", (scheme) => {
    const input = `'authorization': '${scheme} ${"a".repeat(20)}'`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`'authorization': '${scheme} ${marker}'`);
  });

  it.each(["token", "SECRET", "key", "password", "credential", "auth", "api", "private", "token_value", "secret-value"])("detects unquoted generic label %s", (label) => {
    const input = `${label}: ${mixed}`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`${label}: ${marker}`);
  });

  it.each(["'", '"'])("preserves %s quotes around generic credentials", (quote) => {
    const input = `credential=${quote}${mixed}${quote}`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`credential=${quote}${marker}${quote}`);
  });
});

describe("candidate filtering and boundaries", () => {
  it.each([
    "", "ordinary text", marker,
    'api_key="alphabetic_placeholder_value"',
    'password="1234567890.1234567890.1234567890"',
    `token=${"a1_".repeat(10)}`,
    `token=${"ab-".repeat(10)}`,
    `token=${mixed.slice(0, 19)}`,
    `token=${"01234567".repeat(4)}`,
    `token=${"abcdefghijklmnop1".repeat(2)}`,
    `pwd="${"a1!".repeat(10)}"`,
    `client_id='${mixed.slice(0, 19)}'`,
    `sk_test_${"a".repeat(24)}`,
  ])("leaves non-secret or low-entropy input unchanged: %s", (input) => {
    expect(containSecrets(input)).toBe(false);
    expect(replaceSecrets(input)).toBe(input);
  });

  it.each([
    `token=${mixed.slice(0, 20)}`,
    `token=${"0123456789abcdef".repeat(2)}`,
    `token=${"abcdefghijklmnopqr1".repeat(2)}`,
    `pwd="${"abcdefghijklmn1!".repeat(2)}"`,
  ])("accepts high-entropy values in each character class: %s", (input) => {
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toContain(marker);
    expect(replaceSecrets(input)).not.toBe(input);
  });

  it.each([
    `AKIA${"1".repeat(15)}`,
    `AKIA${"1".repeat(16)}A`,
    `ZAKIA${"1".repeat(16)}`,
    `akia${"1".repeat(16)}`,
    `AIza${"a".repeat(34)}`,
    `ghp_${"a".repeat(35)}`,
    `ghp_${"a".repeat(35)}!`,
    `github_pat_${"q".repeat(81)}`,
    `gho_${"a".repeat(35)}`,
    `sk_live_${"a".repeat(23)}`,
    `pk_live_${"a".repeat(23)}`,
    `SG.${"a".repeat(21)}.${"b".repeat(43)}`,
    `SG.${"a".repeat(22)}.${"b".repeat(42)}`,
    `key-${"a".repeat(31)}`,
    `xoxb-${"1".repeat(10)}-${"2".repeat(11)}-${"a".repeat(24)}`,
    `eyJ${"a".repeat(9)}.${"b".repeat(10)}.${"c".repeat(10)}`,
    "a".repeat(63),
  ])("does not match an invalid credential shape: %s", (input) => {
    expect(containSecrets(input)).toBe(false);
    expect(replaceSecrets(input)).toBe(input);
  });

  it.each([" ", "-", "z"])("accepts AWS keys next to permitted delimiter %s", (delimiter) => {
    const input = `${delimiter}AKIA${"1".repeat(16)}${delimiter}`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`${delimiter}${marker}${delimiter}`);
  });

  it("preserves unmatched suffixes around fixed-length embedded tokens", () => {
    const input = `prefix:ghp_${"a".repeat(36)}suffix`;
    expect(replaceSecrets(input)).toBe(`prefix:${marker}suffix`);
  });

  it.each([20, 80])("accepts OAuth secrets at length boundary %s", (length) => {
    const input = `client-secret='${"a".repeat(length)}'`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`client-secret='${marker}'`);
  });

  it("accepts the generic maximum length and preserves punctuation", () => {
    const input = `credential=${mixed.repeat(4).slice(0, 120)};`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`credential=${marker};`);
  });
});

describe("redaction regressions", () => {
  it("detects later qualifying matches when the first same-pattern candidate is rejected", () => {
    const input = `client_id='${"a".repeat(20)}'\nclient_id='${mixed}'`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`client_id='${"a".repeat(20)}'\nclient_id='${marker}'`);
  });

  it("continues generic scanning after a rejected candidate", () => {
    const input = `credential=${"a".repeat(20)}\ncredential=${mixed}`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`credential=${"a".repeat(20)}\ncredential=${marker}`);
  });

  it("redacts the actual capture when identical text appears earlier in the match", () => {
    const value = "0".repeat(32);
    const input = `twilio ${value} auth token='${value}'`;
    expect(containSecrets(input)).toBe(true);
    expect(replaceSecrets(input)).toBe(`twilio ${value} auth token='${marker}'`);
  });

  it("masks the entire credentialed URL when an inner hex key also matches", () => {
    expect(replaceSecrets(uri("https", `example.invalid/${hex}`))).toBe(marker);
  });

  it("merges partially overlapping secrets instead of exposing either end", () => {
    const input = `secret="${mixed}${uri("mysql")}"`;
    expect(replaceSecrets(input)).toBe(`secret="${marker}"`);
  });

  it("masks every adjacent and repeated secret while preserving Unicode and newlines", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const input = `🔒 ${token}${token}\n${token} café`;
    expect(replaceSecrets(input)).toBe(`🔒 ${marker}${marker}\n${marker} café`);
  });

  it("produces stable results across alternating detection and replacement calls", () => {
    const input = `credential=${mixed}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(containSecrets(input)).toBe(true);
      expect(containSecrets("safe")).toBe(false);
      expect(replaceSecrets(input)).toBe(`credential=${marker}`);
      expect(replaceSecrets(replaceSecrets(input))).toBe(`credential=${marker}`);
    }
  });
});
