/**
 * Supported-extension policy and metadata, applied on top of the raw registrar
 * price lists when building the published unified/abridged outputs.
 *
 * - EXCLUDED_TLDS are dropped from every published unified output.
 * - The abridged list is every Nigerian (.ng) extension plus POPULAR_GLOBAL_TLDS.
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

/** A curated selection of popular global (non-.ng) extensions. */
export const POPULAR_GLOBAL_TLDS = [
  // Legacy generic
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'mobi', 'asia',
  // New generic
  'xyz', 'online', 'site', 'store', 'shop', 'top', 'app', 'dev', 'tech', 'club',
  'live', 'space', 'website', 'blog', 'cloud', 'digital', 'agency', 'solutions', 'services', 'company',
  'business', 'network', 'world', 'global', 'life', 'today', 'news', 'media', 'email', 'link',
  'click', 'art', 'design', 'studio', 'fun', 'vip', 'best', 'guru', 'academy', 'africa',
  'finance', 'consulting', 'marketing', 'group', 'team', 'works', 'one', 'page', 'games', 'music',
  'photography', 'events', 'love', 'money', 'host', 'social', 'chat', 'travel', 'education', 'capital',
  'software', 'tools', 'ltd', 'work', 'community', 'school', 'video', 'health', 'llc', 'support',
  'training', 'courses', 'expert', 'legal', 'fitness', 'realestate', 'restaurant', 'photo', 'reviews', 'systems',
  'bond', 'lol', 'sbs', 'cfd', 'icu', 'cyou', 'buzz', 'lat', 'garden', 'bet',
  'help', 'beer', 'win', 'autos', 'wiki', 'ink', 'cam', 'run', 'homes',
  // Country code
  'io', 'co', 'me', 'ai', 'tv', 'cc', 'us', 'uk', 'co.uk', 'de',
  'eu', 'ca', 'in', 'au', 'com.au', 'nl', 'fr', 'es', 'it', 'ch',
  'be', 'at', 'se', 'pl', 'mx', 'co.za', 'ke', 'co.ke', 'ws', 'gg',
  'fm', 'la',
];

/** Backward-compatible export for existing consumers. */
export const TOP_GLOBAL_TLDS = POPULAR_GLOBAL_TLDS;

const POPULAR_GLOBAL_SET = new Set(POPULAR_GLOBAL_TLDS);

/** Market-facing descriptions for every abridged extension; anything else gets a generated one. */
const DESCRIPTIONS = {
  // Nigeria
  'ng': 'Connect with Nigerian customers through their national domain.',
  'com.ng': 'Give your Nigerian business a local web address.',
  'org.ng': 'Represent your Nigerian nonprofit, charity or community online.',
  'net.ng': 'Build an online presence for Nigerian technology and telecom services.',
  'edu.ng': 'Identify an eligible Nigerian university, polytechnic or college online.',
  'sch.ng': 'Identify an eligible Nigerian primary or secondary school online.',
  'name.ng': 'Create a personal Nigerian address for your portfolio or email.',
  'i.ng': 'Create a short, distinctive Nigerian web address.',
  // Legacy generic
  'com': 'Build a familiar web presence for your business, brand or idea.',
  'net': 'Establish a web presence for technology services and networks.',
  'org': 'Represent nonprofits, charities, communities and open-source projects online.',
  'info': 'Share guides, resources and useful information online.',
  'biz': 'Give your business a professional web address.',
  'name': 'Showcase your personal brand, portfolio or email address.',
  'pro': 'Highlight your professional services, consultancy or freelance work.',
  'mobi': 'Reach mobile audiences with apps and services.',
  'asia': 'Businesses targeting Asia',
  // New generic
  'xyz': 'Create a flexible web identity for your startup or creative project.',
  'online': 'Bring your business, brand or project online.',
  'site': 'Create a simple web address for any project.',
  'store': 'Give your online store or retail brand a clear web address.',
  'shop': 'Build an online home for your shop or e-commerce business.',
  'top': 'Give your brand a short, distinctive web address.',
  'app': 'Showcase your app on a domain that requires HTTPS.',
  'dev': 'Showcase developer tools and projects on a domain that requires HTTPS.',
  'tech': 'Highlight your technology startup, products or services.',
  'club': 'Bring clubs, communities and membership groups together online.',
  'live': 'Promote live streams, events and broadcasts.',
  'space': 'Give your portfolio, studio or creative project room online.',
  'website': 'Give any website a clear, descriptive address.',
  'blog': 'Create a home for your blog or writing.',
  'cloud': 'Showcase cloud software, SaaS products and hosting services.',
  'digital': 'Promote digital products, creative work and agency services.',
  'agency': 'Showcase your creative, marketing, travel or recruitment agency.',
  'solutions': 'Present the solutions your consultancy or service business provides.',
  'services': 'Help customers find the services your business offers.',
  'company': 'Establish an online home for your company.',
  'business': 'Create a professional online presence for your business.',
  'network': 'Connect communities, technology services and professional networks online.',
  'world': 'Share brands, travel and projects with a global audience.',
  'global': 'Present your international brand to a worldwide audience.',
  'life': 'Share lifestyle, wellness and personal interests online.',
  'today': 'Publish timely news, daily deals and fresh content.',
  'news': 'Publish news, reporting and editorial coverage.',
  'media': 'Showcase media, podcasts and content production.',
  'email': 'Create an address for email services and newsletters.',
  'link': 'Share links, redirects and campaign pages.',
  'click': 'Direct visitors to campaigns and landing pages.',
  'art': 'Showcase artwork, galleries and collections.',
  'design': 'Present design portfolios, studios and creative services.',
  'studio': 'Showcase your music, film, fitness or design studio.',
  'fun': 'Share games, hobbies, events and entertainment.',
  'vip': 'Highlight premium brands, exclusive events and loyalty programmes.',
  'best': 'Publish reviews, rankings and standout recommendations.',
  'guru': 'Share your expertise as a coach, consultant or specialist.',
  'academy': 'Promote schools, online courses and training programmes.',
  'africa': 'Connect your brand with audiences across Africa.',
  'finance': 'Showcase financial advice, lending and fintech services.',
  'consulting': 'Present your consulting and advisory services.',
  'marketing': 'Promote marketing agencies, campaigns and growth services.',
  'group': 'Represent groups, collectives and holding companies online.',
  'team': 'Bring sports teams, clubs and collaborators together online.',
  'works': 'Showcase portfolios, workshops and production work.',
  'one': 'Create a short, versatile address for your brand or project.',
  'page': 'Present your brand, event or project on a domain that requires HTTPS.',
  'games': 'Connect gamers, game studios and esports communities.',
  'music': 'Showcase musicians, labels, venues and music communities.',
  'photography': 'Display photography portfolios and studio services.',
  'events': 'Promote events, venues and ticketing services.',
  'love': 'Celebrate weddings, passions and the things you love.',
  'money': 'Share payment services, savings tools and personal finance resources.',
  'host': 'Promote web hosting, servers and infrastructure services.',
  'social': 'Connect communities, creators and social apps online.',
  'chat': 'Create a home for messaging, support and community conversations.',
  'travel': 'Showcase travel agencies, tours and travel content.',
  'education': 'Share schools, tutoring services and learning resources.',
  'capital': 'Present investment firms, venture capital and financial services.',
  'software': 'Software businesses and SaaS products',
  'tools': 'Developer utilities and productivity apps',
  'ltd': 'Company websites and business branding',
  'work': 'Recruitment, freelancing and portfolios',
  'community': 'Forums, associations and membership groups',
  'school': 'Schools and learning platforms',
  'video': 'Video creators, production and streaming',
  'health': 'Health services and wellness businesses',
  'llc': 'Branding for limited liability companies',
  'support': 'Help centres and customer service',
  'training': 'Professional training and coaching',
  'courses': 'Online courses and education businesses',
  'expert': 'Consultants and specialist services',
  'legal': 'Law firms and legal services',
  'fitness': 'Gyms, trainers and fitness platforms',
  'realestate': 'Property agents and listings',
  'restaurant': 'Restaurants and dining businesses',
  'photo': 'Shorter alternative to your existing .photography',
  'reviews': 'Product reviews and comparison websites',
  'systems': 'IT providers and systems integrators',
  'bond': 'Finance and brand names',
  'lol': 'Humour and entertainment',
  'sbs': 'General branding',
  'cfd': 'Trading and financial brands',
  'icu': 'General branding',
  'cyou': 'Personal and creator websites',
  'buzz': 'Trends, entertainment and marketing',
  'lat': 'Latin American audiences',
  'garden': 'Gardening and landscaping',
  'bet': 'Betting-related businesses',
  'help': 'Support and advice',
  'beer': 'Breweries and hospitality',
  'win': 'Competitions and gaming',
  'autos': 'Automotive businesses',
  'wiki': 'Knowledge bases and documentation',
  'ink': 'Publishing, art and tattoos',
  'cam': 'Cameras and streaming',
  'run': 'Running and fitness',
  'homes': 'Housing and property',
  // Country code
  'io': 'Showcase technology startups, SaaS products and developer tools.',
  'co': 'Give your company or startup a short web address.',
  'me': 'Showcase your personal brand or portfolio.',
  'ai': 'Highlight artificial intelligence products, services and startups.',
  'tv': 'Showcase video channels, streaming and broadcasting.',
  'cc': 'Create a compact address for your brand or project.',
  'us': 'Reach American customers with a domain requiring a US presence.',
  'uk': 'Connect with British customers through a UK domain.',
  'co.uk': 'Give your business a familiar address for UK customers.',
  'de': 'Reach German customers through their national domain.',
  'eu': 'Reach European audiences with a domain requiring an EU presence.',
  'ca': 'Reach Canadian customers with a domain requiring a Canadian presence.',
  'in': 'Connect with Indian customers through their national domain.',
  'au': 'Reach local customers with a domain requiring an Australian presence.',
  'com.au': 'Represent your business with a domain requiring an Australian presence.',
  'nl': 'Reach Dutch customers through their national domain.',
  'fr': 'Connect with French customers through their national domain.',
  'es': 'Reach customers in Spain through their national domain.',
  'it': 'Connect with Italian customers through their national domain.',
  'ch': 'Reach Swiss customers through their national domain.',
  'be': 'Connect with Belgian customers through their national domain.',
  'at': 'Reach Austrian customers through their national domain.',
  'se': 'Connect with Swedish customers through their national domain.',
  'pl': 'Reach Polish customers through their national domain.',
  'mx': 'Connect with Mexican customers through their national domain.',
  'co.za': 'Give your business a local address for South African customers.',
  'ke': 'Connect with Kenyan customers through their national domain.',
  'co.ke': 'Give your business a local address for Kenyan customers.',
  'ws': 'Create a short, memorable address for your website.',
  'gg': 'Connect with gamers, esports teams and streamers.',
  'fm': 'Promote radio stations, podcasts and music brands.',
  'la': 'Give your LA brand a short, distinctive web address.',
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

/** Abridged list: every .ng extension plus a selection of popular global extensions. */
export function isAbridgedTld(tld) {
  return isNigerianTld(tld) || POPULAR_GLOBAL_SET.has(tld);
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

const EXTENSION_CSV_COLUMNS = ['tld', 'type', 'country', 'description'];

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
