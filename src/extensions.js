/**
 * Supported-extension policy and metadata, applied on top of the raw registrar
 * price lists when building the published unified/abridged outputs.
 *
 * - EXCLUDED_TLDS are dropped from every published unified output.
 * - The abridged list is every Nigerian (.ng) extension plus POPULAR_GLOBAL_TLDS.
 * - Extension metadata (type, country, description, tags) never carries prices and is
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
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'mobi', 'asia', 'cat', 'tel',
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
  'pics', 'skin', 'makeup', 'rest', 'casino', 'fit', 'surf', 'mom', 'beauty', 'bio',
  'onl', 'quest', 'fyi', 'hair', 'forum', 'nyc', 'baby', 'bid', 'rocks', 'center',
  'care', 'wtf', 'bar', 'berlin', 'earth', 'plus', 'family', 'boats', 'london', 'church',
  'technology',
  // Country code
  'io', 'co', 'me', 'ai', 'tv', 'cc', 'us', 'uk', 'co.uk', 'de',
  'eu', 'ca', 'in', 'au', 'com.au', 'nl', 'fr', 'es', 'it', 'ch',
  'be', 'at', 'se', 'pl', 'mx', 'co.za', 'ke', 'co.ke', 'ws', 'gg',
  'fm', 'la',
];

/** Backward-compatible export for existing consumers. */
export const TOP_GLOBAL_TLDS = POPULAR_GLOBAL_TLDS;

const POPULAR_GLOBAL_SET = new Set(POPULAR_GLOBAL_TLDS);

/** Curated discovery groups, based on the market-facing descriptions below. */
const TAG_GROUPS = {
  popular: 'ai app co com com.ng dev info io net ng online org shop site store tech xyz',
  technology: 'ai app bio cam chat cloud dev digital email host io mobi net net.ng network run software solutions support systems tech technology tel tools xyz',
  academic: 'academy bio courses earth edu.ng education fyi info sch.ng school training wiki',
  finance: 'bid bond capital cfd finance money',
  business: 'agency autos beauty best bid biz boats business buzz capital care center chat click cloud co com com.ng company consulting design digital email expert finance garden global group guru hair help homes host i.ng ink lat legal link llc ltd marketing mobi money net net.ng ng online page photography plus pro realestate reviews services shop site software solutions store studio support systems tel top training vip website work works',
  'arts & media': 'art berlin blog cam cat design events fm ink live london media music news photo photography pics rocks space studio today tv video works xyz',
  'social & lifestyle': 'agency baby bar beauty beer bio blog boats bond cc chat church club community cyou events family forum group hair i.ng icu life link london love makeup me mom name name.ng network one org org.ng quest rest restaurant sbs skin social surf team travel vip work world ws',
  'fun & sports': 'bet casino club events fit fitness fun games gg live lol quest rocks run surf team win wtf',
  health: 'bio care fit fitness health life skin',
};

const TAGS_BY_TLD = new Map();
for (const [tag, tlds] of Object.entries(TAG_GROUPS)) {
  for (const tld of tlds.split(' ')) {
    if (!TAGS_BY_TLD.has(tld)) TAGS_BY_TLD.set(tld, []);
    TAGS_BY_TLD.get(tld).push(tag);
  }
}

// Geographic generic suffixes supplement country-code suffixes and their children.
const REGIONAL_TLDS = new Set('africa asia cat berlin london lat nyc'.split(' '));

/** Maximum regular first-year USD registration price for the `cheap` tag. */
export const CHEAP_CREATE_PRICE_USD = 10;

function extensionTags(tld, top, region, priceEntry) {
  const tags = new Set(TAGS_BY_TLD.get(tld) || []);
  if (region || REGIONAL_TLDS.has(top)) tags.add('geographic');
  if (/^[a-z]{2,3}$/.test(tld)) tags.add('short');
  const create = priceEntry?.['regular-price']?.create;
  // Legacy unified entries omit currency and use USD. Never compare a local
  // currency amount with the USD threshold or use sale/renewal prices.
  if ((priceEntry?.currency || 'USD').toUpperCase() === 'USD'
      && Number.isFinite(create) && create >= 0 && create <= CHEAP_CREATE_PRICE_USD) {
    tags.add('cheap');
  }
  return [...tags].sort();
}

/** Market-facing descriptions for every abridged extension; anything else gets a generated one. */
const DESCRIPTIONS = {
  // Nigeria
  'ng': 'Nigerian businesses, organisations and personal websites',
  'com.ng': 'Nigerian businesses, shops and services',
  'org.ng': 'Nigerian nonprofits, charities and community groups',
  'net.ng': 'Nigerian technology, networking and telecom services',
  'edu.ng': 'Eligible Nigerian universities, polytechnics and colleges',
  'sch.ng': 'Eligible Nigerian primary and secondary schools',
  'name.ng': 'Nigerian personal profiles, portfolios and email',
  'i.ng': 'Nigerian brands, startups and personal projects',
  // Legacy generic
  'com': 'Businesses, brands, shops and personal websites',
  'net': 'Internet services, technology companies and networks',
  'org': 'Nonprofits, charities, communities and open-source projects',
  'info': 'Information portals, reference guides and educational resources',
  'biz': 'Small businesses, shops and professional services',
  'name': 'Personal profiles, portfolios and email',
  'pro': 'Professional services, consultants and freelancers',
  'mobi': 'Mobile apps, services and websites',
  'asia': 'Asian businesses, communities and regional services',
  'cat': 'Catalan-language websites, culture and communities',
  'tel': 'Contact directories, telephone services and business listings',
  // New generic
  'xyz': 'Startups, creative projects and experimental apps',
  'online': 'Online businesses, shops, services and personal projects',
  'site': 'Business websites, portfolios and project pages',
  'store': 'Online stores, retail brands and e-commerce',
  'shop': 'Online shops, local retailers and e-commerce',
  'top': 'Rankings, best-of lists and product recommendations',
  'app': 'Mobile apps, web apps and SaaS products; HTTPS required',
  'dev': 'Developer tools, APIs and software projects; HTTPS required',
  'tech': 'Technology startups, software, hardware and IT services',
  'club': 'Clubs, hobby groups and membership communities',
  'live': 'Live streams, concerts, events and broadcasts',
  'space': 'Creative portfolios, coworking spaces and astronomy projects',
  'website': 'Business websites, personal sites and online portfolios',
  'blog': 'Blogs, personal journals and editorial content',
  'cloud': 'Cloud computing, SaaS, hosting and storage',
  'digital': 'Digital products, creative agencies and online services',
  'agency': 'Marketing, design, travel and recruitment agencies',
  'solutions': 'Business consulting, IT solutions and service providers',
  'services': 'Professional, local and business services',
  'company': 'Company profiles, corporate websites and business services',
  'business': 'Businesses, entrepreneurship and B2B services',
  'network': 'Computer networks, professional networks and communities',
  'world': 'Global communities, travel guides and international projects',
  'global': 'International businesses, trade and worldwide services',
  'life': 'Lifestyle, wellness, personal stories and life coaching',
  'today': 'Daily news, current events and daily deals',
  'news': 'News reporting, journalism and editorial coverage',
  'media': 'Digital media, podcasts and content production',
  'email': 'Email hosting, newsletters and email marketing',
  'link': 'Link directories, link-in-bio pages and redirects',
  'click': 'Advertising campaigns, landing pages and affiliate links',
  'art': 'Artists, galleries, artwork and collections',
  'design': 'Design portfolios, creative studios and design services',
  'studio': 'Music, film, photography, fitness and design studios',
  'fun': 'Games, hobbies, parties and entertainment',
  'vip': 'Premium services, exclusive events and loyalty programmes',
  'best': 'Product reviews, rankings and recommendations',
  'guru': 'Coaches, consultants, tutorials and specialist advice',
  'academy': 'Schools, online courses and training programmes',
  'africa': 'African businesses, communities and regional services',
  'finance': 'Financial advice, lending, investment and fintech',
  'consulting': 'Business consultants, advisory services and strategy',
  'marketing': 'Marketing agencies, advertising, campaigns and growth services',
  'group': 'Business groups, collectives and holding companies',
  'team': 'Sports teams, project teams and workplace collaboration',
  'works': 'Creative portfolios, workshops, manufacturing and production',
  'one': 'Personal brands, flagship products and all-in-one services',
  'page': 'Personal pages, landing pages and event pages; HTTPS required',
  'games': 'Video games, game studios, esports and gaming communities',
  'music': 'Musicians, record labels, venues and music communities',
  'photography': 'Photographers, photo portfolios and studio services',
  'events': 'Conferences, festivals, venues and event ticketing',
  'love': 'Weddings, dating, relationships and fan communities',
  'money': 'Payments, savings, budgeting and personal finance',
  'host': 'Web hosting, servers and infrastructure services',
  'social': 'Social networks, creator communities and social apps',
  'chat': 'Messaging, chatbots, customer support and community discussions',
  'travel': 'Travel agencies, tours, destinations and travel guides',
  'education': 'Schools, tutoring, online learning and educational resources',
  'capital': 'Investment firms, venture capital and business funding',
  'software': 'Software businesses, SaaS products and development services',
  'tools': 'Developer utilities, productivity apps and online calculators',
  'ltd': 'Limited companies, corporate profiles and business services',
  'work': 'Recruitment, freelancing, portfolios and workplace tools',
  'community': 'Forums, associations and membership groups',
  'school': 'Schools and learning platforms',
  'video': 'Video creators, production and streaming',
  'health': 'Health services and wellness businesses',
  'llc': 'Limited liability companies and business services',
  'support': 'Help centres, technical support and customer service',
  'training': 'Professional training and coaching',
  'courses': 'Online courses and education businesses',
  'expert': 'Consultants and specialist services',
  'legal': 'Law firms and legal services',
  'fitness': 'Gyms, trainers and fitness platforms',
  'realestate': 'Property agents and listings',
  'restaurant': 'Restaurants, menus, reservations and dining guides',
  'photo': 'Photography, photo galleries, image sharing and editing',
  'reviews': 'Product reviews and comparison websites',
  'systems': 'IT providers, systems integration and business software',
  'bond': 'Bonds, investment services and community connections',
  'lol': 'Humour, memes, comedy and entertainment',
  'sbs': 'Community projects, nonprofits and collaborative teams',
  'cfd': 'Financial trading, market analysis and trading platforms',
  'icu': 'Personal profiles, portfolios and creator websites',
  'cyou': 'Personal and creator websites',
  'buzz': 'Trends, entertainment and marketing',
  'lat': 'Latin American businesses, creators and communities',
  'garden': 'Gardening, landscaping, nurseries and horticulture',
  'bet': 'Sports betting, odds and betting analysis',
  'help': 'Support, advice, tutorials and troubleshooting',
  'beer': 'Breweries, pubs, beer brands and tasting events',
  'win': 'Competitions, gaming, prizes and sports results',
  'autos': 'Car dealerships, vehicle listings and automotive services',
  'wiki': 'Knowledge bases and documentation',
  'ink': 'Publishing, printing, writing, art and tattoos',
  'cam': 'Cameras, webcams, video chats and streaming',
  'run': 'Running, jogging, races, job runners and workflow automation',
  'homes': 'Housing, property listings, home builders and residential services',
  'pics': 'Photos, image galleries, picture sharing and visual portfolios',
  'skin': 'Skincare, dermatology, cosmetics and beauty products',
  'makeup': 'Cosmetics, makeup artists, tutorials and beauty brands',
  'rest': 'Restaurants, menus, dining guides and reservations',
  'casino': 'Casinos, casino games and gaming entertainment',
  'fit': 'Fitness, workouts, personal training and active lifestyles',
  'surf': 'Surfing, surf schools, beach travel and board sports',
  'mom': 'Motherhood, parenting, family advice and support groups',
  'beauty': 'Beauty brands, salons, cosmetics and personal care',
  'bio': 'Biographies, personal profiles, biology and biotechnology',
  'onl': 'Online services, stores and personal websites',
  'quest': 'Adventures, gaming quests, exploration and learning challenges',
  'fyi': 'Reference guides, explainers, announcements and useful information',
  'hair': 'Hair salons, barbers, styling and haircare products',
  'forum': 'Discussion boards, community forums and peer support',
  'nyc': 'New York City businesses, neighbourhoods and local services',
  'baby': 'Baby products, newborn care, parenting and nursery supplies',
  'bid': 'Auctions, bidding platforms, tenders and procurement',
  'rocks': 'Rock music, bands, geology, climbing and fan communities',
  'center': 'Community centres, resource hubs and service centres',
  'care': 'Healthcare, caregiving, elder care and support services',
  'wtf': 'Humour, satire, surprising stories and commentary',
  'bar': 'Bars, cocktails, nightlife and hospitality',
  'berlin': 'Berlin businesses, culture, events and local services',
  'earth': 'Environmental projects, sustainability, conservation and earth sciences',
  'plus': 'Premium memberships, added services and product upgrades',
  'family': 'Family communities, genealogy, parenting and shared memories',
  'boats': 'Boat sales, rentals, sailing and marine services',
  'london': 'London businesses, tourism, events and local services',
  'church': 'Churches, congregations, ministries and worship resources',
  'technology': 'Technology companies, innovation, software and engineering',
  // Country code
  'io': 'Technology startups, SaaS products and developer tools',
  'co': 'Companies, startups and business services',
  'me': 'Personal profiles, portfolios, resumes and blogs',
  'ai': 'Artificial intelligence, machine learning, AI tools and startups',
  'tv': 'Video channels, streaming and broadcasting',
  'cc': 'Creative projects, community groups and personal websites',
  'us': 'US businesses and communities; US presence required',
  'uk': 'UK businesses, organisations and local services',
  'co.uk': 'UK businesses, shops and professional services',
  'de': 'German businesses, communities and local services',
  'eu': 'European businesses and communities; EU presence required',
  'ca': 'Canadian businesses and communities; Canadian presence required',
  'in': 'Indian businesses, communities and local services',
  'au': 'Australian businesses and communities; Australian presence required',
  'com.au': 'Australian businesses and services; Australian presence required',
  'nl': 'Dutch businesses, communities and local services',
  'fr': 'French businesses, communities and local services',
  'es': 'Spanish businesses, communities and local services',
  'it': 'Italian businesses, communities and local services',
  'ch': 'Swiss businesses, communities and local services',
  'be': 'Belgian businesses, communities and local services',
  'at': 'Austrian businesses, communities and local services',
  'se': 'Swedish businesses, communities and local services',
  'pl': 'Polish businesses, communities and local services',
  'mx': 'Mexican businesses, communities and local services',
  'co.za': 'South African businesses, shops and services',
  'ke': 'Kenyan businesses, communities and local services',
  'co.ke': 'Kenyan businesses, shops and services',
  'ws': 'Business websites, personal sites and online projects',
  'gg': 'Gaming, esports, streamers and gaming communities',
  'fm': 'Radio stations, podcasts, music and audio streaming',
  'la': 'Los Angeles businesses, creators and local services',
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
 * @param {{ currency?: string, 'regular-price'?: { create?: number } }} [priceEntry]
 *   Optional unified price entry used only to determine the `cheap` tag.
 * @returns {{ tld: string, unicode?: string, type: 'generic' | 'country-code' | 'second-level', country?: string, description: string, tags: string[] }}
 */
export function describeExtension(tld, priceEntry) {
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
  entry.tags = extensionTags(tld, top, region, priceEntry);
  return entry;
}

/**
 * Builds the sorted extension metadata list for a unified price list,
 * skipping synthetic SKUs.
 *
 * @param {Array<{ tld: string, currency?: string, 'regular-price'?: { create?: number } }>} unifiedList
 */
export function generateExtensionList(unifiedList) {
  return unifiedList
    .filter((entry) => !SYNTHETIC_SKUS.has(entry.tld))
    .map((entry) => describeExtension(entry.tld, entry))
    .sort((a, b) => a.tld < b.tld ? -1 : a.tld > b.tld ? 1 : 0);
}

const EXTENSION_CSV_COLUMNS = ['tld', 'type', 'country', 'description', 'tags'];

function escapeCsvField(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Serializes metadata as CSV with pipe-separated tags; absent fields stay empty. */
export function extensionsToCsv(extensions) {
  const header = EXTENSION_CSV_COLUMNS.join(',');
  const body = extensions.map((ext) => EXTENSION_CSV_COLUMNS
    .map((col) => escapeCsvField(col === 'tags' ? ext.tags?.join('|') : ext[col])).join(','));
  return [header, ...body].join('\n');
}
