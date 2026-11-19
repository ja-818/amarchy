// A post on X, drawn the way X shows it in the timeline (the xpost block:
// app/blocks.json; chat.js artifactParts puts it in the block's card). So a
// post is approved by seeing it: the avatar, the name and @handle, the text
// with its links, @mentions and #tags in X's blue, its pictures in X's grid,
// "Replying to", a quoted post's frame, the action row (only drawn: nothing
// here goes to X), and the count X keeps.
//
// The look follows X's web timeline and Vercel's react-tweet (MIT,
// github.com/vercel/react-tweet), which copies X's embed: sizes, spacing and
// colors, in the --xpost-* tokens (ui.css; a light theme gets X's light ones
// from theme.css). The text's rules are twitter-text's, X's own
// (github.com/twitter/twitter-text, Apache License 2.0): which words are
// links, mentions, hashtags and cashtags, a link shown as X shortens it, and
// the weighted count (parseTweet, config v3), with its lists of domain
// endings (validGTLD, validCCTLD: the ASCII ones).

"use strict";

const XPOST_LIMIT = 280;        // X's weighted characters in a post (not Premium)
const XPOST_URL = 23;           // every link counts this much, whatever its length (t.co)

const XPOST_GTLD = [
  "zuerich zone zippo zip zero zara zappos yun youtube you yokohama yoga yodobashi yandex yamaxun yahoo yachts xyz xxx",
  "xperia xin xihuan xfinity xerox xbox wtf wtc wow world works work woodside wolterskluwer wme winners wine windows win",
  "williamhill wiki wien whoswho weir weibo wedding wed website weber webcam weatherchannel weather watches watch warman",
  "wanggou wang walter walmart wales vuelos voyage voto voting vote volvo volkswagen vodka vlaanderen vivo viva",
  "vistaprint vista vision visa virgin vip vin villas viking vig video viajes vet versicherung verisign ventures vegas",
  "vanguard vana vacations ups uol uno university unicom uconnect ubs ubank tvs tushu tunes tui tube trv trust",
  "travelersinsurance travelers travelchannel travel training trading trade toys toyota town tours total toshiba toray",
  "top tools tokyo today tmall tkmaxx tjx tjmaxx tirol tires tips tiffany tienda tickets tiaa theatre theater thd teva",
  "tennis temasek telefonica telecity tel technology tech team tdk tci taxi tax tattoo tatar tatamotors target taobao",
  "talk taipei tab systems symantec sydney swiss swiftcover swatch suzuki surgery surf support supply supplies sucks",
  "style study studio stream store storage stockholm stcgroup stc statoil statefarm statebank starhub star staples stada",
  "srt srl spreadbetting spot sport spiegel space soy sony song solutions solar sohu software softbank social soccer sncf",
  "smile smart sling skype sky skin ski site singles sina silk shriram showtime show shouji shopping shop shoes shiksha",
  "shia shell shaw sharp shangrila sfr sexy sex sew seven ses services sener select seek security secure seat search scot",
  "scor scjohnson science schwarz schule school scholarships schmidt schaeffler scb sca sbs sbi saxo save sas sarl sapo",
  "sap sanofi sandvikcoromant sandvik samsung samsclub salon sale sakura safety safe saarland ryukyu rwe run ruhr rugby",
  "rsvp room rogers rodeo rocks rocher rmit rip rio ril rightathome ricoh richardli rich rexroth reviews review",
  "restaurant rest republican report repair rentals rent ren reliance reit reisen reise rehab redumbrella redstone red",
  "recipes realty realtor realestate read raid radio racing qvc quest quebec qpon pwc pub prudential pru protection",
  "property properties promo progressive prof productions prod pro prime press praxi pramerica post porn politie poker",
  "pohl pnc plus plumbing playstation play place pizza pioneer pink ping pin pid pictures pictet pics piaget physio",
  "photos photography photo phone philips phd pharmacy pfizer pet pccw pay passagens party parts partners pars paris",
  "panerai panasonic pamperedchef page ovh ott otsuka osaka origins orientexpress organic org orange oracle open ooo",
  "onyourside online onl ong one omega ollo oldnavy olayangroup olayan okinawa office off observer obi nyc ntt nrw nra",
  "nowtv nowruz now norton northwesternmutual nokia nissay nissan ninja nikon nike nico nhk ngo nfl nexus nextdirect next",
  "news newholland new neustar network netflix netbank net nec nba navy natura nationwide name nagoya nadex nab mutuelle",
  "mutual museum mtr mtpc mtn msd movistar movie mov motorcycles moto moscow mortgage mormon mopar montblanc monster",
  "money monash mom moi moe moda mobily mobile mobi mma mls mlb mitsubishi mit mint mini mil microsoft miami metlife",
  "merckmsd meo menu men memorial meme melbourne meet media med mckinsey mcdonalds mcd mba mattel maserati marshalls",
  "marriott markets marketing market map mango management man makeup maison maif madrid macys luxury luxe lupin lundbeck",
  "ltda ltd lplfinancial lpl love lotto lotte london lol loft locus locker loans loan llp llc lixil living live lipsy",
  "link linde lincoln limo limited lilly like lighting lifestyle lifeinsurance life lidl liaison lgbt lexus lego legal",
  "lefrak leclerc lease lds lawyer law latrobe latino lat lasalle lanxess landrover land lancome lancia lancaster lamer",
  "lamborghini ladbrokes lacaixa kyoto kuokgroup kred krd kpn kpmg kosher komatsu koeln kiwi kitchen kindle kinder kim",
  "kia kfh kerryproperties kerrylogistics kerryhotels kddi kaufen juniper juegos jprs jpmorgan joy jot joburg jobs jnj",
  "jmp jll jlc jio jewelry jetzt jeep jcp jcb java jaguar iwc iveco itv itau istanbul ist ismaili iselect irish ipiranga",
  "investments intuit international intel int insure insurance institute ink ing info infiniti industries inc immobilien",
  "immo imdb imamat ikano iinet ifm ieee icu ice icbc ibm hyundai hyatt hughes htc hsbc how house hotmail hotels hoteles",
  "hot hosting host hospital horse honeywell honda homesense homes homegoods homedepot holiday holdings hockey hkt hiv",
  "hitachi hisamitsu hiphop hgtv hermes here helsinki help healthcare health hdfcbank hdfc hbo haus hangout hamburg hair",
  "guru guitars guide guge gucci guardian group grocery gripe green gratis graphics grainger gov got gop google goog",
  "goodyear goodhands goo golf goldpoint gold godaddy gmx gmo gmbh gmail globo global gle glass glade giving gives gifts",
  "gift ggee george genting gent gea gdn gbiz gay garden gap games game gallup gallo gallery gal fyi futbol furniture",
  "fund fun fujixerox fujitsu ftr frontier frontdoor frogans frl fresenius free fox foundation forum forsale forex ford",
  "football foodnetwork food foo fly flsmidth flowers florist flir flights flickr fitness fit fishing fish firmdale",
  "firestone fire financial finance final film fido fidelity fiat ferrero ferrari feedback fedex fast fashion farmers",
  "farm fans fan family faith fairwinds fail fage extraspace express exposed expert exchange everbank events eus",
  "eurovision etisalat esurance estate esq erni ericsson equipment epson epost enterprises engineering engineer energy",
  "emerck email education edu edeka eco eat earth dvr dvag durban dupont duns dunlop duck dubai dtv drive download dot",
  "doosan domains doha dog dodge doctor docs dnp diy dish discover discount directory direct digital diet diamonds dhl",
  "dev design desi dentist dental democrat delta deloitte dell delivery degree deals dealer deal dds dclk day datsun",
  "dating date data dance dad dabur cyou cymru cuisinella csc cruises cruise crs crown cricket creditunion creditcard",
  "credit cpa courses coupons coupon country corsica coop cool cookingchannel cooking contractors contact consulting",
  "construction condos comsec computer compare company community commbank comcast com cologne college coffee codes coach",
  "clubmed club cloud clothing clinique clinic click cleaning claims cityeats city citic citi citadel cisco circle",
  "cipriani church chrysler chrome christmas chloe chintai cheap chat chase charity channel chanel cfd cfa cern ceo",
  "center ceb cbs cbre cbn cba catholic catering cat casino cash caseih case casa cartier cars careers career care cards",
  "caravan car capitalone capital capetown canon cancerresearch camp camera cam calvinklein call cal cafe cab bzh buzz",
  "buy business builders build bugatti budapest brussels brother broker broadway bridgestone bradesco box boutique bot",
  "boston bostik bosch boots booking book boo bond bom bofa boehringer boats bnpparibas bnl bmw bms blue bloomberg blog",
  "blockbuster blanco blackfriday black biz bio bingo bing bike bid bible bharti bet bestbuy best berlin bentley beer",
  "beauty beats bcn bcg bbva bbt bbc bayern bauhaus basketball baseball bargains barefoot barclays barclaycard barcelona",
  "bar bank band bananarepublic banamex baidu baby azure axa aws avianca autos auto author auspost audio audible audi",
  "auction attorney athleta associates asia asda arte art arpa army archi aramco arab aquarelle apple app apartments aol",
  "anz anquan android analytics amsterdam amica amfam amex americanfamily americanexpress alstom alsace ally allstate",
  "allfinanz alipay alibaba alfaromeo akdn airtel airforce airbus aigo aig agency agakhan africa afl afamilycompany aetna",
  "aero aeg adult ads adac actor active aco accountants accountant accenture academy abudhabi abogado able abc abbvie",
  "abbott abb abarth aarp aaa onion",
].join(" ");
const XPOST_CCTLD = [
  "zw zm za yt ye ws wf vu vn vi vg ve vc va uz uy us um uk ug ua tz tw tv tt tr tp to tn tm tl tk tj th tg tf td tc sz",
  "sy sx sv su st ss sr so sn sm sl sk sj si sh sg se sd sc sb sa rw ru rs ro re qa py pw pt ps pr pn pm pl pk ph pg pf",
  "pe pa om nz nu nr np no nl ni ng nf ne nc na mz my mx mw mv mu mt ms mr mq mp mo mn mm ml mk mh mg mf me md mc ma ly",
  "lv lu lt ls lr lk li lc lb la kz ky kw kr kp kn km ki kh kg ke jp jo jm je it is ir iq io in im il ie id hu ht hr hn",
  "hm hk gy gw gu gt gs gr gq gp gn gm gl gi gh gg gf ge gd gb ga fr fo fm fk fj fi eu et es er eh eg ee ec dz do dm dk",
  "dj de cz cy cx cw cv cu cr co cn cm cl ck ci ch cg cf cd cc ca bz by bw bv bt bs br bq bo bn bm bl bj bi bh bg bf be",
  "bd bb ba az ax aw au at as ar aq ao an am al ai ag af ae ad ac",
].join(" ");

// twitter-text's patterns, as its regexp/*.js make them (UTF-16, as it reads).
const XPOST_RE = (() => {
  const punct = "!'#%&()*+,\\\\\\-./:;<=>?@\\[\\]^_{|}~$";
  const spaces = "\\x09-\\x0D\\x20\\x85\\xA0\\u1680\\u180E\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
  const invalid = "\\uFFFE\\uFEFF\\uFFFF";
  const marks = "\\u202A-\\u202E\\u061C\\u200E\\u200F\\u2066-\\u2069";
  const latin = "\\xC0-\\xD6\\xD8-\\xF6\\xF8-\\xFF\\u0100-\\u024F\\u0253\\u0254\\u0256\\u0257\\u0259\\u025B\\u0263\\u0268\\u026F\\u0272\\u0289\\u028B\\u02BB\\u0300-\\u036F\\u1E00-\\u1EFF";
  const cyrillic = "\\u0400-\\u04FF";
  const dc = `[^${punct}${spaces}${invalid}${marks}]`;
  const tld = `(?:(?:${XPOST_GTLD.split(" ").join("|")}|${XPOST_CCTLD.split(" ").join("|")}|xn--[\\-0-9a-z]+)(?=[^0-9a-zA-Z@+-]|$))`;
  const name = `(?:(?:${dc}(?:-|${dc})*)?${dc}\\.)`;
  const sub = `(?:(?:${dc}(?:[_-]|${dc})*)?${dc}\\.)`;
  const domain = `(?:${sub}*${name}${tld})`;
  const gp = `[a-z${cyrillic}0-9!*';:=+,.$/%#\\[\\]\\-\\u2013_~@|&${latin}]`;
  const parens = `\\((?:${gp}+|(?:${gp}*\\(${gp}+\\)${gp}*))\\)`;
  const ending = `(?:[+\\-a-z${cyrillic}0-9=_#/${latin}]|${parens})`;
  const path = `(?:(?:${gp}*(?:${parens}${gp}*)*${ending})|(?:@${gp}+/))`;
  const query = "[a-z0-9!?*'@();:&=+$/%#\\[\\]\\-_.,~|]", queryEnd = "[a-z0-9\\-_&=#/]";
  const before = `(?:[^A-Za-z0-9@＠$#＃${invalid}]|[${marks}]|^)`;
  const alnum = "[\\p{L}\\p{M}\\p{Nd}_\\u200c\\u200d\\ua67e\\u05be\\u05f3\\u05f4\\uff5e\\u301c\\u309b\\u309c\\u30a0\\u30fb\\u3003\\u0f0b\\u0f0c\\xb7]";
  // An emoji, as twemoji-parser finds one (X counts each as 2, joined ones,
  // a skin tone, a flag or a keycap as one): © ® ™ only with their emoji
  // look (U+FE0F), digits, # and * only as keycaps.
  const pic = "(?:[\\u00A9\\u00AE\\u2122]\\uFE0F|(?![\\u00A9\\u00AE\\u2122#*0-9])\\p{Emoji})";
  // Its U+FE0F, when it takes one: one drawn as an emoji already takes none
  // (one after it counts alone), but for those with a text look too (⚡ ⌚ ⭐...).
  const look = "(?:(?<!\\p{Emoji_Presentation})|(?<=[\\u231A\\u231B\\u25FD\\u25FE\\u2614\\u2615\\u2648-\\u2653\\u267F\\u2693\\u26A1\\u26AA\\u26AB\\u26BD\\u26BE\\u26C4\\u26C5\\u26D4\\u26EA\\u26F2\\u26F3\\u26F5\\u26FA\\u26FD\\u2757\\u2B1B\\u2B1C\\u2B50\\u2B55\\u{1F004}\\u{1F21A}\\u{1F22F}]))\\uFE0F";
  return {
    url: new RegExp(`(${before})((https?:\\/\\/)?(${domain})(?::([0-9]+))?(\\/${path}*)?(\\?${query}*${queryEnd})?)`, "gi"),
    ascii: new RegExp(`(?:(?:[\\-a-z0-9${latin}]+)\\.)+(?:${tld})`, "gi"),
    tco: new RegExp(`^https?:\\/\\/t\\.co\\/([a-z0-9]+)(?:\\?${query}*${queryEnd})?`, "i"),
    mention: /(^|[^a-zA-Z0-9_!#$%&*@＠]|(?:^|[^a-zA-Z0-9_+~.-])(?:rt|RT|rT|Rt):?)([@＠])([a-zA-Z0-9_]{1,20})(\/[a-zA-Z][a-zA-Z0-9_-]{0,24})?/g,
    mentionEnd: new RegExp(`^(?:[@＠]|[${latin}]|:\\/\\/)`),
    hashtag: new RegExp(`((?:^|\\uFE0E|\\uFE0F|$|(?!${alnum}|&)[\\s\\S]))([#＃])(?!\\uFE0F|\\u20E3)(${alnum}*[\\p{L}\\p{M}]${alnum}*)`, "giu"),
    hashtagEnd: /^(?:[#＃]|:\/\/)/,
    cashtag: new RegExp(`(^|[${spaces}])(\\$)([a-z]{1,6}(?:[._][a-z]{1,2})?)(?=$|\\s|[${punct}])`, "gi"),
    emoji: new RegExp(`\\p{RI}\\p{RI}|[#*0-9]\\uFE0F?\\u20E3|${pic}(?:\\p{EMod}|${look}|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?(?:\\u200D${pic}(?:\\p{EMod}|${look})?)*`, "gu"),
  };
})();

// The links in a text, as X finds them (extractUrlsWithIndices): with or
// without https://, a domain X knows the ending of.
function xpostUrls(text) {
  const out = [];
  if (!/\./.test(text)) return out;
  const re = XPOST_RE.url;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const [, before, url, protocol, domain, , path] = m;
    const start = m.index + before.length;
    let end = re.lastIndex;
    if (!protocol) {
      if (/[-_./]$/.test(before)) continue;
      let last = null, from = 0;
      XPOST_RE.ascii.lastIndex = 0;
      for (const d of domain.matchAll(XPOST_RE.ascii)) {
        const at = domain.indexOf(d[0], from);
        from = at + d[0].length;
        out.push(last = { start: start + at, end: start + from, url: d[0] });
      }
      if (!last) continue;
      if (path) { last.url = url.replace(domain, last.url); last.end = end; }
    } else {
      let u = url;
      const t = u.match(XPOST_RE.tco);
      if (t) {
        if (t[1].length > 40) continue;
        u = t[0];
        end = start + u.length;
      }
      out.push({ start, end, url: u });
    }
  }
  return out;
}

// What's linked in a text, in order, none over another (extractEntitiesWithIndices):
// [{start, end, kind: url | mention | hashtag | cashtag, text, href}].
function xpostEntities(text) {
  const all = xpostUrls(text).map((u) => ({ ...u, kind: "url", text: text.slice(u.start, u.end) }));
  for (const m of text.matchAll(XPOST_RE.mention)) {
    const at = m.index + m[1].length, end = at + 1 + m[3].length + (m[4] || "").length;
    if (XPOST_RE.mentionEnd.test(text.slice(m.index + m[0].length))) continue;
    all.push({ start: at, end, kind: "mention", text: text.slice(at, end), name: m[3], list: m[4] || "" });
  }
  for (const m of text.matchAll(XPOST_RE.hashtag)) {
    const at = m.index + m[1].length, end = at + 1 + m[3].length;
    if (XPOST_RE.hashtagEnd.test(text.slice(m.index + m[0].length))) continue;
    all.push({ start: at, end, kind: "hashtag", text: text.slice(at, end), tag: m[3] });
  }
  for (const m of text.matchAll(XPOST_RE.cashtag)) {
    const at = m.index + m[1].length;
    all.push({ start: at, end: at + 1 + m[3].length, kind: "cashtag", text: text.slice(at, at + 1 + m[3].length), tag: m[3] });
  }
  all.sort((a, b) => a.start - b.start);
  const out = [];
  for (const e of all) if (!out.length || e.start >= out[out.length - 1].end) out.push(e);
  for (const e of out) {
    e.href = e.kind === "url" ? (/^https?:\/\//i.test(e.url) ? e.url : `https://${e.url}`)
      : e.kind === "mention" ? `https://x.com/${e.name}${e.list}`
      : e.kind === "hashtag" ? `https://x.com/hashtag/${encodeURIComponent(e.tag)}`
      : `https://x.com/search?q=${encodeURIComponent(`$${e.tag}`)}`;
  }
  return out;
}

// A link as X shows it (display_url): no https:// or www., and past its
// domain, 15 characters and "…".
function xpostShortUrl(url) {
  const v = String(url).replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const cut = v.search(/[/?#]/);
  if (cut < 0) return v;
  const rest = v.slice(cut);
  return rest.length > 15 ? `${v.slice(0, cut)}${rest.slice(0, 15)}…` : v;
}

// A character's weight in X's count (config v3): 1 for Latin, Greek,
// Cyrillic, Hebrew, Arabic, Indic scripts... and the general punctuation;
// 2 for anything else (CJK, Hangul).
function xpostWeight(cp) {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
}

// How X weighs a text (parseTweet): a link 23, an emoji 2, every other
// character its weight. {count, cut: where it goes past 280 (its UTF-16
// index; its length when it doesn't), where parseTweet's valid range ends}.
function xpostWeigh(t) {
  const at = new Map();
  for (const u of xpostUrls(t)) at.set(u.start, { end: u.end, w: XPOST_URL });
  for (const m of t.matchAll(XPOST_RE.emoji)) if (!at.has(m.index)) at.set(m.index, { end: m.index + m[0].length, w: 2 });
  let count = 0, cut = t.length;
  for (let i = 0; i < t.length;) {
    const e = at.get(i), cp = t.codePointAt(i);
    count += e ? e.w : xpostWeight(cp);
    if (count > XPOST_LIMIT && cut === t.length) cut = i;
    i = e ? e.end : i + (cp > 0xffff ? 2 : 1);
  }
  return { count, cut };
}

// How long X counts a post: its text normalized (NFC) first, as X does.
function xpostCount(text) {
  return xpostWeigh(String(text || "").normalize("NFC")).count;
}

// A post's address on X: {user, id} (user "" for x.com/i/status/...).
function xpostRef(url) {
  const m = String(url || "").match(/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,20})/i);
  return m ? { user: /^i(\/web)?$/i.test(m[1]) ? "" : m[1], id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` } : null;
}

// X's icons (its web app's own drawings), filled.
const XPOST_ICONS = {
  logo: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  more: "M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z",
  reply: "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
  repost: "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
  like: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
  views: "M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z",
  bookmark: "M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z",
  share: "M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z",
};

function xpostIcon(name, cls) {
  return h("span", { class: `xpost-ic${cls ? ` ${cls}` : ""}`, "aria-hidden": "true",
                     html: `<svg viewBox="0 0 24 24"><path d="${XPOST_ICONS[name]}"/></svg>` });
}

// A picture's or video's own shape, once it's been seen: drawn again, it
// takes its room at once (nothing under it moves as it comes).
const XPOST_SHAPES = new Map();
const XPOST_VIDEO = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;

// The post (a: the block, read by replyParts), as X shows it; media(src): the
// address to load a picture from (a path here or an https URL, through the
// server). {card, count, over: by how much it's over X's limit}.
function xpostView(a, media) {
  const at = a.attrs || {};
  const text = String(a.body || "");
  const handle = String(at.handle || "").trim().replace(/^@/, "") || "you";
  const name = String(at.name || "").trim() || handle;
  const reply = xpostRef(at.reply_to), quote = xpostRef(at.quote);
  const items = String(at.media || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4);

  // The avatar: its picture, else the name's first letter on X's grey.
  const initial = h("span", { class: "xpost-initial" }, (Array.from(name)[0] || "?").toUpperCase());
  const avatar = h("span", { class: "xpost-avatar" }, initial);
  if (String(at.avatar || "").trim()) {
    const img = h("img", { src: media(String(at.avatar).trim()), alt: "", draggable: "false" });
    img.addEventListener("load", () => { initial.remove(); });
    img.addEventListener("error", () => { img.remove(); });
    avatar.prepend(img);
  }

  // The text: as written (its newlines kept), what X links in its blue.
  // Past X's 280, highlighted from where it goes over, as X's composer does.
  const body = h("div", { class: "xpost-text", dir: "auto" });
  // (A text that isn't NFC already is counted as X would, but not marked.)
  const nfc = text.normalize("NFC"), weighed = xpostWeigh(nfc), cut = nfc === text ? weighed.cut : text.length;
  const put = (el, a, b) => {
    if (b <= a) return;
    if (cut >= b) el.append(text.slice(a, b));
    else if (cut <= a) el.append(h("span", { class: "xpost-over" }, text.slice(a, b)));
    else { el.append(text.slice(a, cut)); el.append(h("span", { class: "xpost-over" }, text.slice(cut, b))); }
  };
  let from = 0;
  for (const e of xpostEntities(text)) {
    put(body, from, e.start);
    body.append(h("a", { class: `xpost-link${e.start >= cut ? " xpost-over" : ""}`, href: e.href, target: "_blank", rel: "noopener noreferrer",
      onclick: (ev) => ev.stopPropagation() }, e.kind === "url" ? xpostShortUrl(e.url) : e.text));
    from = e.end;
  }
  put(body, from, text.length);

  const head = h("div", { class: "xpost-head" },
    h("span", { class: "xpost-name", title: name }, name),
    h("span", { class: "xpost-meta" }, h("span", { class: "xpost-handle" }, `@${handle}`), h("span", { class: "xpost-dot" }, "·"), h("span", { class: "xpost-time" }, "now")),
    xpostIcon("more", "xpost-more"));

  const card = h("div", { class: "xpost" },
    h("div", { class: "xpost-side" }, avatar),
    h("div", { class: "xpost-main" }, head,
      reply ? h("div", { class: "xpost-replying" }, "Replying to ", reply.user
        ? h("a", { class: "xpost-link", href: `https://x.com/${reply.user}`, target: "_blank", rel: "noopener noreferrer" }, `@${reply.user}`)
        : h("a", { class: "xpost-link", href: reply.url, target: "_blank", rel: "noopener noreferrer" }, "a post")) : null,
      text ? body : null,
      items.length ? xpostMedia(items, media) : null,
      quote ? h("a", { class: "xpost-quote", href: quote.url, target: "_blank", rel: "noopener noreferrer", onclick: (ev) => ev.stopPropagation() },
        h("span", { class: "xpost-quote-head" }, h("span", { class: "xpost-quote-avatar" }, xpostIcon("logo")),
          h("span", { class: "xpost-name" }, quote.user ? `@${quote.user}` : "A post"), h("span", { class: "xpost-handle" }, "· quoted")),
        h("span", { class: "xpost-quote-link" }, xpostShortUrl(quote.url))) : null,
      h("div", { class: "xpost-actions", "aria-hidden": "true" },
        xpostIcon("reply"), xpostIcon("repost"), xpostIcon("like"), xpostIcon("views"),
        h("span", { class: "xpost-end" }, xpostIcon("bookmark"), xpostIcon("share")))));
  return { card, count: weighed.count, over: Math.max(0, weighed.count - XPOST_LIMIT) };
}

// Its pictures and videos, in X's grid: one at its own shape (no taller
// than 4:5), two side by side, three with the first tall, four in a square;
// 16:9 in all, 2px apart, its corners round. A tap on a picture shows them
// full screen (uiPhoto); a video plays where it is.
function xpostMedia(items, media) {
  const box = h("div", { class: `xpost-media n${items.length}` });
  const shots = items.filter((x) => !XPOST_VIDEO.test(x)).map((x) => ({ src: media(x), label: "" }));
  const shape = (w, ht) => Math.min(Math.max(ht / w, 0.25), 1.25);
  const one = items.length === 1;
  if (one && XPOST_SHAPES.has(items[0])) box.style.aspectRatio = `1 / ${XPOST_SHAPES.get(items[0])}`;
  const failed = (tile, src) => {
    tile.replaceChildren(h("span", { class: "xpost-missing" }, `Can't show ${baseName(src.split("?")[0])}`));
    tile.classList.add("missing");
  };
  for (const src of items) {
    const url = media(src);
    if (XPOST_VIDEO.test(src)) {
      // A video: its first frame (#t: Safari draws none before it plays), X's
      // play button and its length; a tap plays it there, with its controls.
      const v = h("video", { src: `${url}#t=0.1`, playsinline: true, muted: true, preload: "metadata" });
      v.muted = true;
      const long = h("span", { class: "xpost-duration", hidden: true });
      const tile = h("div", { class: "xpost-tile video" }, v, long);
      const play = h("button", { class: "xpost-play", type: "button", "aria-label": "Play the video", onclick: (e) => {
        e.stopPropagation();
        play.remove(); long.remove();
        v.controls = true; v.muted = false;
        v.play().catch(() => {});
      }, html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14z"/></svg>' });
      tile.append(play);
      v.addEventListener("loadedmetadata", () => {
        if (one && v.videoWidth) { const r = shape(v.videoWidth, v.videoHeight); XPOST_SHAPES.set(src, r); box.style.aspectRatio = `1 / ${r}`; }
        if (isFinite(v.duration) && v.duration > 0) {
          const sec = Math.round(v.duration);
          long.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
          long.hidden = false;
        }
      });
      v.addEventListener("error", () => failed(tile, src));
      box.append(tile);
      continue;
    }
    const img = h("img", { src: url, alt: "", draggable: "false" });
    const tile = h("button", { class: "xpost-tile", type: "button", "aria-label": "Show the picture", onclick: (e) => {
      e.stopPropagation();
      if (!tile.classList.contains("missing")) uiPhoto(shots, Math.max(0, shots.findIndex((x) => x.src === url)));
    } }, img);
    img.addEventListener("load", () => {
      if (one && img.naturalWidth) { const r = shape(img.naturalWidth, img.naturalHeight); XPOST_SHAPES.set(src, r); box.style.aspectRatio = `1 / ${r}`; }
    });
    img.addEventListener("error", () => failed(tile, src));
    box.append(tile);
  }
  return box;
}
