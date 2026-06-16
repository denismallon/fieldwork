/**
 * Diagnostic: shows raw Brave search results for missed subdomain cases
 * Usage: npx tsx scripts/probe-search.ts
 */
import { getDomain } from "tldts";
import { BraveSearchProvider } from "../src/lib/search/brave";

const CASES = [
  { company: "Stacker",       domain: "stackerhq.com",  expected: "https://feedback.stackerhq.com/changelog" },
  { company: "Supermove",     domain: "supermove.com",  expected: "https://help.supermove.com/hc/en-us/sections/19410683973780-Monthly-Newsletters" },
  { company: "Deed",          domain: "joindeed.com",   expected: "https://resources.joindeed.com/deed-resources/tag/product-announcements" },
  { company: "Landed",        domain: "gotlanded.com",  expected: "https://employer.gotlanded.com/product-updates" },
  { company: "Warmly",        domain: "warmly.ai",      expected: "https://www.warmly.ai/p/resources/launches" },
  { company: "Elemeno Health", domain: "elemenohealth.com", expected: "https://help.elemenohealth.com/en/articles/6673053-release-notes" },
  { company: "HyperTrack",    domain: "hypertrack.com", expected: "https://stories.hypertrack.com" },
  { company: "Maven",         domain: "maven.com",      expected: "https://maven.com/resources" },
  { company: "Listen Labs",   domain: "listenlabs.ai",  expected: "https://listenlabs.ai/whatsnew" },
  { company: "Catch",         domain: "catch.co",       expected: "https://catch.co/blog" },
];

const search = new BraveSearchProvider();

async function main() {
for (const { company, domain, expected } of CASES) {
  const registrable = getDomain(domain);
  const expectedReg = getDomain(expected);
  const query = `"${company}" changelog`;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`${company} | domain: ${domain} | registrable: ${registrable}`);
  console.log(`Expected: ${expected} (eTLD+1: ${expectedReg})`);
  console.log(`Query: ${query}`);
  console.log("─".repeat(70));

  const results = await search.search(query, 10);

  if (results.length === 0) {
    console.log("  (no results returned)");
    continue;
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rReg = getDomain(r.url);
    const sameReg = rReg === registrable;
    const flag = sameReg ? "✓" : "✗";
    console.log(`  ${flag} ${i + 1}. ${r.url}`);
    if (!sameReg) console.log(`       (eTLD+1: ${rReg} — filtered out)`);
  }

  const passing = results.filter((r) => getDomain(r.url) === registrable);
  console.log(`\n  ${passing.length}/${results.length} passed domain filter`);
  if (passing.length === 0) {
    const expFound = results.find((r) => r.url.includes(domain) || getDomain(r.url) === expectedReg);
    if (expFound) {
      console.log(`  Expected domain appeared but as different eTLD+1: ${expFound.url}`);
    } else {
      console.log(`  Expected URL not in results at all`);
    }
  }
}
}

main().catch((e) => { console.error(e); process.exit(1); });
