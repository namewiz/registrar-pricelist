/**
 * Supported-extension policy and metadata, applied on top of the raw registrar
 * price lists when building the published unified/abridged outputs.
 *
 * - EXCLUDED_TLDS are dropped from every published unified output.
 * - The abridged list is every Nigerian (.ng) extension plus TOP_GLOBAL_TLDS.
 * - Extension metadata (type, country, description) never carries prices.
 */
import { domainToUnicode } from 'node:url';

/** Extensions never offered, even when a registrar prices them. */
export const EXCLUDED_TLDS = new Set(['gov.ng', 'biz.ng', 'mobi.ng']);

/**
 * Catalog-only SKUs that are not real public suffixes (e.g. NIRA's premium .ng
 * pool). They stay in price outputs but are left out of extension metadata.
 */
export const SYNTHETIC_SKUS = new Set(['premium.ng']);

/** Top 100 global (non-.ng) extensions, most popular first. */
export const TOP_GLOBAL_TLDS = [
  // Legacy generic
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'mobi',
  // New generic
  'xyz', 'online', 'site', 'store', 'shop', 'top', 'app', 'dev', 'tech', 'club',
  'live', 'space', 'website', 'blog', 'cloud', 'digital', 'agency', 'solutions', 'services', 'company',
  'business', 'network', 'world', 'global', 'life', 'today', 'news', 'media', 'email', 'link',
  'click', 'art', 'design', 'studio', 'fun', 'vip', 'best', 'guru', 'academy', 'africa',
  'finance', 'consulting', 'marketing', 'group', 'team', 'works', 'one', 'page', 'games', 'music',
  'photography', 'events', 'love', 'money', 'host', 'social', 'chat', 'travel', 'education', 'capital',
  // Country code
  'io', 'co', 'me', 'ai', 'tv', 'cc', 'us', 'uk', 'co.uk', 'de',
  'eu', 'ca', 'in', 'au', 'com.au', 'nl', 'fr', 'es', 'it', 'ch',
  'be', 'at', 'se', 'pl', 'mx', 'co.za', 'ke', 'co.ke', 'ws', 'gg',
  'fm', 'la',
];

const TOP_GLOBAL_SET = new Set(TOP_GLOBAL_TLDS);

/** Hand-written descriptions; anything not listed gets a generated one. */
const DESCRIPTIONS = {
  // Nigeria
  'ng': 'Nigeria\'s country-code domain, open to everyone.',
  'com.ng': 'Nigerian commercial domain, for businesses and brands.',
  'org.ng': 'Nigerian domain for non-profits and organisations.',
  'net.ng': 'Nigerian domain for network and internet service providers.',
  'edu.ng': 'Nigerian domain for tertiary institutions (restricted).',
  'sch.ng': 'Nigerian domain for primary and secondary schools (restricted).',
  'name.ng': 'Nigerian domain for individuals and personal names.',
  'i.ng': 'Short Nigerian domain for personal and creative use.',
  // Legacy generic
  'com': 'The most popular domain worldwide, for any commercial or personal site.',
  'net': 'Originally for networks; now a general-purpose alternative to .com.',
  'org': 'For non-profits, communities and open-source projects.',
  'info': 'For informational and resource sites.',
  'biz': 'For businesses and commercial ventures.',
  'name': 'For individuals and personal names.',
  'pro': 'For professionals and their services.',
  'mobi': 'For mobile-focused sites and services.',
  // New generic
  'xyz': 'A flexible, generation-neutral domain for any project.',
  'online': 'For any business or individual with an online presence.',
  'site': 'A short, general-purpose domain for any website.',
  'store': 'For online stores and retail brands.',
  'shop': 'For e-commerce and shops of any size.',
  'top': 'A short, general-purpose domain signalling quality.',
  'app': 'For apps and app developers (HTTPS required).',
  'dev': 'For developers and technical projects (HTTPS required).',
  'tech': 'For technology companies, startups and products.',
  'club': 'For clubs, communities and fan groups.',
  'live': 'For live events, streaming and entertainment.',
  'space': 'For creative spaces, portfolios and projects.',
  'website': 'A descriptive domain for any website.',
  'blog': 'For blogs and bloggers.',
  'cloud': 'For cloud services, hosting and SaaS.',
  'digital': 'For digital agencies, products and services.',
  'agency': 'For agencies of every kind.',
  'solutions': 'For solution providers and consultancies.',
  'services': 'For service businesses.',
  'company': 'For companies and corporations.',
  'business': 'For businesses of every size.',
  'network': 'For networks, communities and IT services.',
  'world': 'For global brands and international projects.',
  'global': 'For organisations with a worldwide audience.',
  'life': 'For lifestyle, personal and wellbeing sites.',
  'today': 'For news, daily content and timely updates.',
  'news': 'For news outlets, journalists and publishers.',
  'media': 'For media companies and content creators.',
  'email': 'For email services and memorable email addresses.',
  'link': 'A short domain for links, landing pages and redirects.',
  'click': 'For marketing campaigns and calls to action.',
  'art': 'For artists, galleries and the creative community.',
  'design': 'For designers, studios and creative work.',
  'studio': 'For studios, producers and creatives.',
  'fun': 'For entertainment, games and leisure.',
  'vip': 'For exclusive brands, events and services.',
  'best': 'For standout products, reviews and recommendations.',
  'guru': 'For experts, coaches and specialists.',
  'academy': 'For schools, courses and training programmes.',
  'africa': 'The pan-African domain for brands and communities across Africa.',
  'finance': 'For financial services and advisors.',
  'consulting': 'For consultants and advisory firms.',
  'marketing': 'For marketers and marketing agencies.',
  'group': 'For groups, collectives and holding companies.',
  'team': 'For teams, sports clubs and collaborators.',
  'works': 'For portfolios, workshops and production houses.',
  'one': 'A short, versatile domain for any brand.',
  'page': 'For simple sites and landing pages (HTTPS required).',
  'games': 'For gamers, game studios and gaming communities.',
  'music': 'For musicians, labels and music lovers.',
  'photography': 'For photographers and photo studios.',
  'events': 'For event planners, venues and ticketing.',
  'love': 'For romance, passions and things people love.',
  'money': 'For fintech, payments and personal finance.',
  'host': 'For hosting providers and infrastructure services.',
  'social': 'For social networks, communities and influencers.',
  'chat': 'For messaging, chat apps and communities.',
  'travel': 'For travel agencies, airlines and tourism.',
  'education': 'For schools, educators and learning resources.',
  'capital': 'For investment firms and capital markets.',
  // Country code
  'io': 'British Indian Ocean Territory\'s domain, widely used by tech startups.',
  'co': 'Colombia\'s domain, popular worldwide as a short alternative to .com.',
  'me': 'Montenegro\'s domain, popular for personal sites and brands.',
  'ai': 'Anguilla\'s domain, popular with artificial intelligence companies.',
  'tv': 'Tuvalu\'s domain, popular for video, streaming and media.',
  'cc': 'Cocos (Keeling) Islands\' domain, used as a general-purpose alternative.',
  'us': 'The United States\' country-code domain.',
  'uk': 'The United Kingdom\'s short country-code domain.',
  'co.uk': 'The United Kingdom\'s commercial domain.',
  'de': 'Germany\'s country-code domain.',
  'eu': 'The European Union\'s domain, for EU residents and organisations.',
  'ca': 'Canada\'s country-code domain (Canadian presence required).',
  'in': 'India\'s country-code domain.',
  'au': 'Australia\'s short country-code domain (Australian presence required).',
  'com.au': 'Australia\'s commercial domain (Australian presence required).',
  'nl': 'The Netherlands\' country-code domain.',
  'fr': 'France\'s country-code domain.',
  'es': 'Spain\'s country-code domain.',
  'it': 'Italy\'s country-code domain.',
  'ch': 'Switzerland\'s country-code domain.',
  'be': 'Belgium\'s country-code domain.',
  'at': 'Austria\'s country-code domain.',
  'se': 'Sweden\'s country-code domain.',
  'pl': 'Poland\'s country-code domain.',
  'mx': 'Mexico\'s country-code domain.',
  'co.za': 'South Africa\'s commercial domain.',
  'ke': 'Kenya\'s country-code domain.',
  'co.ke': 'Kenya\'s commercial domain.',
  'ws': 'Samoa\'s domain, often read as "website".',
  'gg': 'Guernsey\'s domain, popular with gaming communities.',
  'fm': 'Micronesia\'s domain, popular with radio and podcasts.',
  'la': 'Laos\' domain, popular with Los Angeles brands.',
  'su': 'The former Soviet Union\'s country-code domain.',
};

// ccTLDs whose label is not their ISO 3166-1 alpha-2 code.
const CCTLD_REGION_OVERRIDES = { uk: 'GB' };

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

function regionFor(label) {
  if (!/^[a-z]{2}$/.test(label)) return undefined;
  const code = CCTLD_REGION_OVERRIDES[label] || label.toUpperCase();
  const name = regionNames.of(code);
  return name ? { code, name } : undefined;
}

export function isNigerianTld(tld) {
  return tld === 'ng' || tld.endsWith('.ng');
}

export function isExcludedTld(tld) {
  return EXCLUDED_TLDS.has(tld);
}

/** Abridged list: every .ng extension plus the top 100 global extensions. */
export function isAbridgedTld(tld) {
  return isNigerianTld(tld) || TOP_GLOBAL_SET.has(tld);
}

/**
 * Returns a copy of registrar results keeping only TLDs that pass `predicate`,
 * in both the base `data` map and any per-currency maps (e.g. `NGN`).
 *
 * @param {Object<string, { meta?: any, data?: Record<string, any> }>} resultsByRegistrar
 * @param {(tld: string) => boolean} predicate
 */
export function filterResultsByTld(resultsByRegistrar, predicate) {
  const filterMap = (map) => Object.fromEntries(Object.entries(map).filter(([tld]) => predicate(tld)));
  const out = {};
  for (const [provider, result] of Object.entries(resultsByRegistrar || {})) {
    if (!result || typeof result !== 'object') {
      out[provider] = result;
      continue;
    }
    const copy = { ...result };
    for (const [key, value] of Object.entries(result)) {
      const isTldMap = key === 'data' || /^[A-Z]{3}$/.test(key);
      if (isTldMap && value && typeof value === 'object') copy[key] = filterMap(value);
    }
    out[provider] = copy;
  }
  return out;
}

/**
 * Describes a single extension (no prices).
 *
 * @param {string} tld e.g. "com", "com.ng", "xn--p1ai"
 * @returns {{ tld: string, unicode?: string, type: 'generic' | 'country-code' | 'second-level', country?: string, description: string }}
 */
export function describeExtension(tld) {
  const labels = tld.split('.');
  const top = labels[labels.length - 1];
  const region = regionFor(top);
  const type = labels.length > 1 ? 'second-level' : region ? 'country-code' : 'generic';

  const unicode = tld.includes('xn--') ? domainToUnicode(tld) : '';
  const display = unicode || tld;

  let description = DESCRIPTIONS[tld];
  if (!description) {
    if (type === 'country-code') {
      description = `${region.name}'s country-code domain.`;
    } else if (type === 'second-level') {
      description = region
        ? `Second-level domain under .${top} (${region.name}).`
        : `Second-level domain under .${top}.`;
    } else {
      description = `Generic top-level domain .${display}.`;
    }
  }

  const entry = { tld };
  if (unicode && unicode !== tld) entry.unicode = unicode;
  entry.type = type;
  if (region) entry.country = region.code;
  entry.description = description;
  return entry;
}

/**
 * Builds the sorted extension metadata list for a unified price list,
 * skipping synthetic SKUs.
 *
 * @param {Array<{ tld: string }>} unifiedList
 */
export function generateExtensionList(unifiedList) {
  return unifiedList
    .map((entry) => entry.tld)
    .filter((tld) => !SYNTHETIC_SKUS.has(tld))
    .sort()
    .map(describeExtension);
}
