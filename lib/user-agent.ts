export interface ParsedUserAgent {
  browser: string;
  os: string;
  device: string;
}

type UserAgentRule = {
  matches: (userAgent: string) => boolean;
  value: string;
};

const BROWSER_RULES: UserAgentRule[] = [
  { matches: (ua) => ua.includes("Firefox/"), value: "Firefox" },
  { matches: (ua) => ua.includes("Edg/"), value: "Edge" },
  {
    matches: (ua) => ua.includes("OPR/") || ua.includes("Opera/"),
    value: "Opera",
  },
  {
    matches: (ua) => ua.includes("Chrome/") && !ua.includes("Edg/"),
    value: "Chrome",
  },
  {
    matches: (ua) => ua.includes("Safari/") && !ua.includes("Chrome/"),
    value: "Safari",
  },
  {
    matches: (ua) =>
      ua.includes("bot") || ua.includes("Bot") || ua.includes("crawler"),
    value: "Bot",
  },
];

const OS_RULES: UserAgentRule[] = [
  { matches: (ua) => ua.includes("Windows"), value: "Windows" },
  {
    matches: (ua) => ua.includes("Mac OS X") || ua.includes("Macintosh"),
    value: "macOS",
  },
  {
    matches: (ua) => ua.includes("Linux") && !ua.includes("Android"),
    value: "Linux",
  },
  { matches: (ua) => ua.includes("Android"), value: "Android" },
  {
    matches: (ua) => ua.includes("iPhone") || ua.includes("iPad"),
    value: "iOS",
  },
  { matches: (ua) => ua.includes("CrOS"), value: "ChromeOS" },
];

const DEVICE_RULES: UserAgentRule[] = [
  {
    matches: (ua) =>
      ua.includes("Mobile") || ua.includes("Android") || ua.includes("iPhone"),
    value: "Mobile",
  },
  {
    matches: (ua) => ua.includes("iPad") || ua.includes("Tablet"),
    value: "Tablet",
  },
];

function matchUserAgentValue(
  userAgent: string,
  rules: UserAgentRule[],
  fallback: string,
): string {
  for (const rule of rules) {
    if (rule.matches(userAgent)) {
      return rule.value;
    }
  }

  return fallback;
}

export function parseUserAgent(userAgent: string): ParsedUserAgent {
  return {
    browser: matchUserAgentValue(userAgent, BROWSER_RULES, "Other"),
    os: matchUserAgentValue(userAgent, OS_RULES, "Other"),
    device: matchUserAgentValue(userAgent, DEVICE_RULES, "Desktop"),
  };
}
