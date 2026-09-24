export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal REST client — just what the integration needs, no SDK dependency. */
export class GitHubClient {
  constructor(
    private token: string,
    private apiUrl = "https://api.github.com",
  ) {}

  async request<T>(path: string, init?: RequestInit): Promise<{ data: T; headers: Headers }> {
    const url = path.startsWith("http") ? path : `${this.apiUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "flowboard",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
    if (res.status === 204) return { data: undefined as T, headers: res.headers };
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (body as { message?: string }).message ?? res.statusText;
      const hint =
        res.status === 401
          ? " — the token is invalid or expired"
          : res.status === 403 || res.status === 404
            ? " — check the token's repository access and permissions"
            : "";
      throw new GitHubError(res.status, `GitHub ${res.status}: ${detail}${hint}`);
    }
    return { data: body as T, headers: res.headers };
  }

  async get<T>(path: string) {
    return (await this.request<T>(path)).data;
  }

  async post<T>(path: string, body: unknown) {
    return (await this.request<T>(path, { method: "POST", body: JSON.stringify(body) })).data;
  }

  async delete(path: string) {
    await this.request<void>(path, { method: "DELETE" });
  }

  /** Follows Link: rel="next" up to `maxPages`. */
  async paginate<T>(path: string, maxPages = 3): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < maxPages; page++) {
      const { data, headers }: { data: T[]; headers: Headers } = await this.request<T[]>(next);
      out.push(...data);
      next = headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return out;
  }
}
