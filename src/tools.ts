import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAddress(sidlo: any): string {
  if (!sidlo) return "Unknown";
  const parts = [
    sidlo.nazevUlice,
    sidlo.cisloDomovni
      ? `${sidlo.cisloDomovni}${sidlo.cisloOrientacni ? `/${sidlo.cisloOrientacni}` : ""}`
      : null,
    sidlo.nazevObce,
    sidlo.psc ? String(sidlo.psc).replace(/(\d{3})(\d{2})/, "$1 $2") : null,
  ].filter(Boolean);
  return parts.join(", ");
}

// ─── Register tools ───────────────────────────────────────────────────────────

export function registerTools(server: McpServer) {

  // ── 1. ARES: lookup by IČO ────────────────────────────────────────────────

  server.tool(
    "lookup_company_cz",
    "Look up a Czech company in the ARES registry by IČO. Returns full profile: name, address, VAT number, legal form, NACE codes, registration status across all registries.",
    { ico: z.string().describe("IČO (8-digit Czech company ID), e.g. '27082440'") },
    async ({ ico }) => {
      const cleanIco = ico.replace(/\s/g, "").padStart(8, "0");
      const res = await fetch(
        `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${cleanIco}`
      );
      if (res.status === 404) return { content: [{ type: "text", text: `Company IČO ${cleanIco} not found in ARES.` }] };
      if (!res.ok) throw new Error(`ARES error: ${res.status}`);
      const d = await res.json() as any;

      const nace = (d.czNace2008 ?? d.czNace ?? []).slice(0, 8).join(", ");
      const registries = d.seznamRegistraci ?? {};
      const activeRegs = Object.entries(registries)
        .filter(([, v]) => v === "AKTIVNI")
        .map(([k]) => k.replace("stavZdroje", ""))
        .join(", ");

      let text = `**${d.obchodniJmeno}**\n`;
      text += `IČO: ${d.ico}\n`;
      text += `VAT (DIČ): ${d.dic ?? "Not a VAT payer"}\n`;
      text += `Address: ${formatAddress(d.sidlo)}\n`;
      text += `Legal form code: ${d.pravniForma ?? "—"}\n`;
      text += `Founded: ${d.datumVzniku ?? "—"}\n`;
      if (d.datumZaniku) text += `Dissolved: ${d.datumZaniku}\n`;
      text += `VAT status: ${registries.stavZdrojeDph === "AKTIVNI" ? "✅ Active VAT payer" : "❌ Not a VAT payer"}\n`;
      if (nace) text += `NACE codes: ${nace}\n`;
      if (activeRegs) text += `Active registries: ${activeRegs}`;
      return { content: [{ type: "text", text }] };
    }
  );

  // ── 2. ARES: search by name ───────────────────────────────────────────────

  server.tool(
    "search_companies_cz",
    "Search Czech companies by name in ARES. Returns up to 10 matching companies with IČO and address.",
    {
      name: z.string().describe("Company name or partial name to search for, e.g. 'Alza' or 'České dráhy'"),
      limit: z.number().min(1).max(20).default(10).describe("Max results to return (default 10)"),
    },
    async ({ name, limit }) => {
      const res = await fetch(
        `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ obchodniJmeno: name, pocet: limit, start: 0 }),
        }
      );
      if (!res.ok) throw new Error(`ARES search error: ${res.status}`);
      const d = await res.json() as any;
      const items = d.ekonomickeSubjekty ?? [];

      if (items.length === 0) return { content: [{ type: "text", text: `No companies found matching "${name}".` }] };

      let text = `**Companies matching "${name}"** (${items.length} results)\n\n`;
      for (const c of items) {
        text += `• **${c.obchodniJmeno}** — IČO: ${c.ico}`;
        if (c.sidlo?.textovaAdresa) text += ` — ${c.sidlo.textovaAdresa}`;
        text += "\n";
      }
      return { content: [{ type: "text", text }] };
    }
  );

  // ── 3. ISIR: insolvency check ─────────────────────────────────────────────

  server.tool(
    "check_insolvency_cz",
    "Check if a Czech company or person is in insolvency proceedings via the ISIR (Insolvenční rejstřík). Returns active insolvency cases.",
    {
      ico: z.string().optional().describe("IČO of the company, e.g. '27082440'"),
      name: z.string().optional().describe("Person or company name to search"),
    },
    async ({ ico, name }) => {
      if (!ico && !name) return { content: [{ type: "text", text: "Provide either IČO or name." }] };

      let url: string;
      if (ico) {
        const clean = ico.replace(/\s/g, "").padStart(8, "0");
        url = `https://isir.justice.cz/isir/common/stat.do?kodStavRizeni=&ico=${clean}&nazevFirmy=&jmeno=&prijmeni=&narozeni=&typ=P&datumVzniku=&datumZruseni=&cisloSenatu=&druhSenatu=&rocnik=&cisloVeci=&typVeci=INS&onlyActivePerson=true&onlyActualMatter=true&submitSearch=Vyhledat`;
      } else {
        url = `https://isir.justice.cz/isir/common/stat.do?kodStavRizeni=&ico=&nazevFirmy=${encodeURIComponent(name!)}&jmeno=&prijmeni=&narozeni=&typ=P&datumVzniku=&datumZruseni=&cisloSenatu=&druhSenatu=&rocnik=&cisloVeci=&typVeci=INS&onlyActivePerson=true&onlyActualMatter=true&submitSearch=Vyhledat`;
      }

      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AresMCP/1.0)" } });
      if (!res.ok) throw new Error(`ISIR error: ${res.status}`);
      const html = await res.text();

      // Check for results table
      const hasResults = html.includes("KSBR") || html.includes("MSPH") || html.includes("KSPL") ||
        html.includes("KSOS") || html.includes("KSUL") || html.includes("KSHK") || html.includes("KSCB");
      const noResults = html.includes("Nebyly nalezeny") || html.includes("žádné záznamy") ||
        html.includes("nebyl nalezen");

      if (noResults || !hasResults) {
        return {
          content: [{
            type: "text",
            text: `**Insolvency Check**\n${ico ? `IČO: ${ico}` : `Name: ${name}`}\n\n✅ No active insolvency proceedings found.\n\nVerify manually: https://isir.justice.cz`
          }]
        };
      }

      // Extract case numbers
      const caseMatches = html.match(/INS[\s\d]+\/\d{4}/g) ?? [];
      const cases = [...new Set(caseMatches)].slice(0, 5);

      let text = `**Insolvency Check**\n${ico ? `IČO: ${ico}` : `Name: ${name}`}\n\n`;
      text += `⚠️ ACTIVE INSOLVENCY PROCEEDINGS FOUND!\n\n`;
      if (cases.length > 0) { text += `Case numbers:\n`; cases.forEach(c => text += `• ${c}\n`); }
      text += `\nDetails: https://isir.justice.cz`;
      return { content: [{ type: "text", text }] };
    }
  );

  // ── 4. ORSR: Slovak company lookup ───────────────────────────────────────

  server.tool(
    "lookup_company_sk",
    "Look up a Slovak company in the ORSR (Obchodný register SR) by IČO. Returns company name, address, legal form and registration details.",
    { ico: z.string().describe("IČO of the Slovak company (6-8 digits), e.g. '35800908'") },
    async ({ ico }) => {
      const cleanIco = ico.replace(/\s/g, "");
      const url = `https://www.orsr.sk/vypis.asp?ID=0&IČO=${cleanIco}&SID=0&P=0&V=1`;

      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AresMCP/1.0)", "Accept-Language": "sk-SK,sk;q=0.9" }
      });
      if (!res.ok) throw new Error(`ORSR error: ${res.status}`);
      const html = await res.text();

      // Try to detect if company was found
      const notFound = html.includes("Firma sa nenašla") || html.includes("nenašiel") || html.includes("neexistuje");
      if (notFound) return { content: [{ type: "text", text: `Slovak company with IČO ${cleanIco} not found in ORSR.` }] };

      // Extract company name
      const nameMatch = html.match(/<b>([^<]{3,100})<\/b>/);
      const companyName = nameMatch ? nameMatch[1].trim() : "Name not parsed";

      // Extract address lines
      const addrMatch = html.match(/Sídlo[^:]*:([^<]{10,200})/i);
      const address = addrMatch ? addrMatch[1].replace(/\s+/g, " ").trim() : "See ORSR directly";

      let text = `**Slovak Company (ORSR)**\n`;
      text += `IČO: ${cleanIco}\n`;
      text += `Name: ${companyName}\n`;
      text += `Address: ${address}\n`;
      text += `\nFull record: https://www.orsr.sk/vypis.asp?IČO=${cleanIco}&V=1`;
      return { content: [{ type: "text", text }] };
    }
  );

  // ── 5. ARES: bulk lookup ──────────────────────────────────────────────────

  server.tool(
    "bulk_lookup_companies_cz",
    "Look up multiple Czech companies at once by their IČO numbers. Returns basic info for each. Maximum 10 companies per request.",
    { icos: z.array(z.string()).min(1).max(10).describe("Array of IČO numbers, e.g. ['27082440', '00176638']") },
    async ({ icos }) => {
      const results = await Promise.allSettled(
        icos.map(async (ico) => {
          const clean = ico.replace(/\s/g, "").padStart(8, "0");
          const res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`);
          if (!res.ok) return { ico: clean, error: res.status === 404 ? "Not found" : `Error ${res.status}` };
          const d = await res.json() as any;
          return { ico: clean, name: d.obchodniJmeno, dic: d.dic, address: formatAddress(d.sidlo), vatActive: d.seznamRegistraci?.stavZdrojeDph === "AKTIVNI" };
        })
      );

      let text = `**Bulk Company Lookup (${icos.length} companies)**\n\n`;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          const c = r.value as any;
          if (c.error) { text += `❌ IČO ${c.ico}: ${c.error}\n`; }
          else { text += `✅ **${c.name}** (${c.ico})\n   VAT: ${c.dic ?? "None"} | ${c.vatActive ? "Active VAT" : "No VAT"} | ${c.address}\n\n`; }
        } else {
          text += `❌ IČO ${icos[i]}: ${r.reason}\n`;
        }
      });
      return { content: [{ type: "text", text }] };
    }
  );
}
