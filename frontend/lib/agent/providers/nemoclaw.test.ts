import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEMOCLAW_API_KEY;
  delete process.env.NEMOCLAW_INFERENCE_URL;
  delete process.env.NEMOCLAW_MODEL;
});

function mockFetch(response: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
    })
  );
}

describe("NemoClawProvider", () => {
  it("calls the NemoClaw inference URL with the correct payload", async () => {
    process.env.NEMOCLAW_API_KEY = "test-key";
    process.env.NEMOCLAW_INFERENCE_URL = "http://localhost:18789/v1";
    process.env.NEMOCLAW_MODEL = "nvidia/test-model";

    mockFetch({
      choices: [
        {
          message: {
            content: JSON.stringify({
              recommendedRouteId: "A",
              reason: "Most accessible",
              warnings: [],
            }),
          },
        },
      ],
    });

    const { NemoClawProvider } = await import("./nemoclaw");
    const provider = new NemoClawProvider();

    const result = await provider.recommend({
      routes: [],
      preference: { profile: "wheelchair", priority: "most_accessible" },
      journey: { start: "King's Cross", destination: "Victoria" },
    });

    expect(result.recommendedRouteId).toBe("A");
    expect(result.reason).toBe("Most accessible");

    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:18789/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "nvidia/test-model",
    });
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
  });

  it("throws when the inference endpoint returns a non-OK status", async () => {
    process.env.NEMOCLAW_API_KEY = "test-key";
    mockFetch({}, 500);

    const { NemoClawProvider } = await import("./nemoclaw");
    const provider = new NemoClawProvider();

    await expect(
      provider.recommend({
        routes: [],
        preference: { profile: "general", priority: "fastest" },
        journey: { start: "A", destination: "B" },
      })
    ).rejects.toThrow("NemoClaw error: 500");
  });
});
