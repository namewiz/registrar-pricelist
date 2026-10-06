/**
 * Supported-extension policy and metadata, applied on top of the raw registrar
 * price lists when building the published unified/abridged outputs.
 *
 * - EXCLUDED_TLDS are dropped from every published unified output.
 * - The abridged list is every Nigerian (.ng) extension plus TOP_GLOBAL_TLDS.
 * - Extension metadata (type, country, description) never carries prices and is
 *   only published for the abridged list, as CSV.
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

/** Market-facing descriptions for every abridged extension; anything else gets a generated one. */
const DESCRIPTIONS = {
  // Nigeria
  'ng': 'Nigeria\'s home on the web. Short, proud and instantly recognised by Nigerian customers.',
  'com.ng': 'The go-to address for Nigerian businesses. Signals a trusted, local brand.',
  'org.ng': 'Build trust for your Nigerian NGO, foundation, church or community group.',
  'net.ng': 'Ideal for Nigerian tech, telecoms and internet service brands.',
  'edu.ng': 'The official address for Nigerian universities, polytechnics and colleges (eligibility required).',
  'sch.ng': 'The official address for Nigerian primary and secondary schools (eligibility required).',
  'name.ng': 'Claim your name online. A personal Nigerian address for portfolios, CVs and email.',
  'i.ng': 'A short, creative Nigerian address. Spell words like s.i.ng or br.i.ng.',
  // Legacy generic
  'com': 'The world\'s most trusted domain. The first choice for any business, brand or idea.',
  'net': 'A classic, credible alternative when your .com is taken. Great for tech and networks.',
  'org': 'The trusted home of non-profits, charities, communities and open-source projects.',
  'info': 'Share knowledge. Perfect for guides, resources, FAQs and information hubs.',
  'biz': 'Made for business. A clear, professional choice for companies of every size.',
  'name': 'Your personal brand online, for portfolios, CVs and a memorable email address.',
  'pro': 'Show you mean business. Built for professionals, consultants and freelancers.',
  'mobi': 'Built for the mobile-first audience. Great for apps and on-the-go services.',
  // New generic
  'xyz': 'Flexible, modern and affordable. A favourite of startups, creators and Web3 projects.',
  'online': 'Say exactly where you are. Perfect for any business going online.',
  'site': 'Short, simple and memorable. A home for any website you can imagine.',
  'store': 'Tell customers they can buy from you. Made for online stores and retail brands.',
  'shop': 'Open your doors online. The natural home for e-commerce and shops of any size.',
  'top': 'Short, punchy and affordable. Position your brand at the top.',
  'app': 'Launch your app with a name that says what it is. Secure by default (HTTPS).',
  'dev': 'Built for developers, tools and side projects. Secure by default (HTTPS).',
  'tech': 'Instantly signals innovation. Ideal for startups, gadgets and tech brands.',
  'club': 'Bring your people together. Great for fan clubs, communities and memberships.',
  'live': 'Go live. Perfect for streamers, events, broadcasts and entertainment.',
  'space': 'Room to create. A great fit for portfolios, studios and creative projects.',
  'website': 'Say it like it is. A clear, descriptive address for any website.',
  'blog': 'Give your writing a home people remember. Made for bloggers and writers.',
  'cloud': 'Made for cloud, SaaS and hosting brands that run on the internet.',
  'digital': 'For digital agencies, creators and products built for the modern web.',
  'agency': 'Make your agency easy to find, whether creative, marketing, travel or recruitment.',
  'solutions': 'Tell clients you solve problems. Ideal for consultancies and service providers.',
  'services': 'Show off what you offer. A clear fit for any service business.',
  'company': 'A credible, professional address for companies big and small.',
  'business': 'Exactly what it says. A professional address for any business.',
  'network': 'Connect people and ideas. Great for communities, IT and professional networks.',
  'world': 'Think big. For brands, travel and projects with a global outlook.',
  'global': 'Show the world you operate everywhere. Built for international brands.',
  'life': 'Share your passion. Perfect for lifestyle, wellness and personal brands.',
  'today': 'Fresh and timely. Ideal for news, daily deals and up-to-the-minute content.',
  'news': 'Break stories under a name readers trust. Made for publishers and journalists.',
  'media': 'For media houses, content creators, podcasters and production studios.',
  'email': 'A memorable address for your inbox, newsletters and email services.',
  'link': 'Short and shareable. Great for link-in-bio pages, redirects and campaigns.',
  'click': 'Drive action. Built for campaigns, landing pages and calls to action.',
  'art': 'Showcase your creativity. The home for artists, galleries and collectors.',
  'design': 'Show off your craft. Made for designers, studios and creative agencies.',
  'studio': 'For studios of every kind, from music and film to fitness and design.',
  'fun': 'Bring the good vibes. Perfect for games, events, hobbies and entertainment.',
  'vip': 'Exclusive by name. Ideal for premium brands, events and loyalty programmes.',
  'best': 'Claim your spot as the best. Great for reviews, rankings and standout brands.',
  'guru': 'Show off your expertise. Made for coaches, consultants and specialists.',
  'academy': 'Teach the world. Perfect for schools, online courses and training brands.',
  'africa': 'Proudly African. A pan-African address for brands across the continent.',
  'finance': 'Build trust with a finance-first name, for advisors, lenders and fintechs.',
  'consulting': 'A professional home for consultants and advisory firms.',
  'marketing': 'Market your marketing. Made for agencies, growth teams and marketers.',
  'group': 'For groups, collectives and holding companies with many moving parts.',
  'team': 'Rally your squad. Great for sports teams, clubs and collaborative projects.',
  'works': 'Show your work. Ideal for portfolios, workshops and production houses.',
  'one': 'Short, versatile and memorable. Be the one your customers remember.',
  'page': 'A simple, secure page for your brand, event or project (HTTPS by default).',
  'games': 'Level up. Made for gamers, game studios, esports and gaming communities.',
  'music': 'Your sound, your address. For artists, labels, venues and music lovers.',
  'photography': 'Frame your work. Made for photographers and photo studios.',
  'events': 'Fill every seat. Ideal for event planners, venues and ticketing.',
  'love': 'Share what you love. Great for weddings, passions and heartfelt brands.',
  'money': 'Talk money. Built for fintech, payments, savings and personal finance.',
  'host': 'Made for hosting providers, servers and infrastructure brands.',
  'social': 'Get social. For communities, creators, influencers and social apps.',
  'chat': 'Start the conversation. Made for messaging apps, support and communities.',
  'travel': 'Inspire wanderlust. For travel agencies, tour operators and travel creators.',
  'education': 'For schools, tutors, edtech and learning resources.',
  'capital': 'Command confidence. Ideal for investment firms, VCs and capital markets.',
  // Country code
  'io': 'The startup favourite. Loved by tech founders, SaaS and developer tools.',
  'co': 'Short, sharp and global. A popular alternative to .com for companies and startups.',
  'me': 'All about you. Perfect for personal brands, portfolios and links like contact.me.',
  'ai': 'The home of artificial intelligence. The address of choice for AI startups.',
  'tv': 'Made for video. Ideal for streaming, channels, creators and broadcasters.',
  'cc': 'Short and versatile. A compact alternative for any brand or project.',
  'us': 'America\'s domain. Show US customers you\'re right at home (US presence required).',
  'uk': 'Short and British. A trusted address for UK customers.',
  'co.uk': 'The UK\'s most trusted business address. Instantly familiar to British customers.',
  'de': 'Reach Germany, Europe\'s largest economy, with its most trusted domain.',
  'eu': 'One address for the whole European Union (EU presence required).',
  'ca': 'Canada\'s trusted domain for local brands (Canadian presence required).',
  'in': 'Reach India\'s fast-growing online market with its national domain.',
  'au': 'Short and Australian. Built for local brands (Australian presence required).',
  'com.au': 'Australia\'s most trusted business address (Australian presence required).',
  'nl': 'Win over Dutch customers with the Netherlands\' popular national domain.',
  'fr': 'Speak to French customers with France\'s national domain.',
  'es': 'Reach Spanish-speaking customers in Spain with its national domain.',
  'it': 'Connect with Italian customers using Italy\'s national domain.',
  'ch': 'Swiss quality, online. Reach customers in Switzerland.',
  'be': 'Reach Belgian customers, or make the most of clever names like letit.be.',
  'at': 'Reach Austrian customers, or create catchy addresses like meet.at.',
  'se': 'Connect with Swedish customers using Sweden\'s national domain.',
  'pl': 'Reach Poland\'s growing online market with its national domain.',
  'mx': 'Reach Mexican customers with Mexico\'s national domain.',
  'co.za': 'South Africa\'s favourite business address. Trusted across the region.',
  'ke': 'Kenya\'s national domain. Connect with customers across East Africa.',
  'co.ke': 'Kenya\'s go-to business address. Trusted by local customers.',
  'ws': 'Reads as "website". A short, memorable address for any site.',
  'gg': 'Good game! A favourite of gamers, esports teams and streamers.',
  'fm': 'Tune in. Popular with radio stations, podcasts and music brands.',
  'la': 'Popular with LA brands and anyone who loves a short, catchy name.',
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

const EXTENSION_CSV_COLUMNS = ['tld', 'unicode', 'type', 'country', 'description'];

function escapeCsvField(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Serializes extension metadata as CSV; optional fields are left empty when absent. */
export function extensionsToCsv(extensions) {
  const header = EXTENSION_CSV_COLUMNS.join(',');
  const body = extensions.map((ext) => EXTENSION_CSV_COLUMNS.map((col) => escapeCsvField(ext[col])).join(','));
  return [header, ...body].join('\n');
}
