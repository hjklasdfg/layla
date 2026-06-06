import "server-only";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeDdgRedirect(href: string): string {
  if (href.startsWith("//duckduckgo.com/l/?")) {
    try {
      const u = new URL(`https:${href}`);
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    } catch {
      // fall through
    }
  }
  return href;
}

/** Parse DuckDuckGo HTML results (no API key required). */
async function duckDuckGoSearch(
  query: string,
  maxResults: number
): Promise<WebSearchResult[]> {
  const body = new URLSearchParams({ q: query, kl: "uk-en" });

  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Layla/0.1 (accessibility hazard reporting)",
      Accept: "text/html",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Web search failed (${res.status})`);
  }

  const html = await res.text();
  const results: WebSearchResult[] = [];

  const blockRegex =
    /<div class="result results_links[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = blockMatch[1];
    const titleMatch = block.match(
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;

    const snippetMatch = block.match(
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i
    );

    const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();
    const url = decodeDdgRedirect(titleMatch[1].trim());
    const snippet = (snippetMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/** Optional Tavily search when TAVILY_API_KEY is configured (Nebius ecosystem). */
async function tavilySearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return [];

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_domains: ["gov.uk", "tfl.gov.uk", "fixmystreet.com"],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.content ?? "",
    }));
}

/** Run online search — prefers Tavily if configured, else DuckDuckGo. */
export async function webSearch(
  query: string,
  maxResults = 5
): Promise<WebSearchResult[]> {
  const tavily = await tavilySearch(query, maxResults);
  if (tavily.length) return tavily;
  return duckDuckGoSearch(query, maxResults);
}

export async function webSearchMany(
  queries: string[],
  maxPerQuery = 4
): Promise<WebSearchResult[]> {
  const seen = new Set<string>();
  const merged: WebSearchResult[] = [];

  for (const query of queries.slice(0, 4)) {
    try {
      const batch = await webSearch(query, maxPerQuery);
      for (const item of batch) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        merged.push(item);
      }
    } catch {
      // continue with other queries
    }
  }

  return merged;
}
