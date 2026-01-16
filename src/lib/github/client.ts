import { Octokit } from "@octokit/rest";

let octokitInstance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
    octokitInstance = new Octokit({ auth: token });
  }
  return octokitInstance;
}

export function parseRepoString(repoString: string): {
  owner: string;
  repo: string;
} {
  const parts = repoString.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo string: ${repoString}. Expected format: owner/repo`);
  }
  return { owner: parts[0], repo: parts[1] };
}
