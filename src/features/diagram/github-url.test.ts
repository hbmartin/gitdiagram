import { describe, expect, it } from "vitest";

import { parseGitHubRepoUrl } from "~/features/diagram/github-url";

describe("parseGitHubRepoUrl", () => {
  it("parses valid repository urls", () => {
    expect(parseGitHubRepoUrl("https://github.com/vercel/next.js")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("parses owner/repo shorthand", () => {
    expect(parseGitHubRepoUrl("facebook/react")).toEqual({
      username: "facebook",
      repo: "react",
    });
  });

  it("trims shorthand input before parsing", () => {
    expect(parseGitHubRepoUrl("  vercel/next.js  ")).toEqual({
      username: "vercel",
      repo: "next.js",
    });
  });

  it("returns null for invalid urls", () => {
    expect(parseGitHubRepoUrl("https://gitlab.com/vercel/next.js")).toBeNull();
    expect(parseGitHubRepoUrl("not-a-url")).toBeNull();
  });

  it("parses tree urls with a branch", () => {
    expect(
      parseGitHubRepoUrl("https://github.com/vercel/next.js/tree/canary"),
    ).toEqual({
      username: "vercel",
      repo: "next.js",
      ref: "canary",
    });
  });

  it("parses tree urls with a branch and subdirectory", () => {
    expect(
      parseGitHubRepoUrl(
        "https://github.com/vercel/next.js/tree/canary/packages/next",
      ),
    ).toEqual({
      username: "vercel",
      repo: "next.js",
      ref: "canary",
      subdir: "packages/next",
    });
  });

  it("parses blob urls by scoping to the file's parent directory", () => {
    expect(
      parseGitHubRepoUrl(
        "https://github.com/vercel/next.js/blob/canary/packages/next/package.json",
      ),
    ).toEqual({
      username: "vercel",
      repo: "next.js",
      ref: "canary",
      subdir: "packages/next",
    });
  });

  it("ignores a blob url pointing at a root file's subdir", () => {
    expect(
      parseGitHubRepoUrl(
        "https://github.com/vercel/next.js/blob/canary/README.md",
      ),
    ).toEqual({
      username: "vercel",
      repo: "next.js",
      ref: "canary",
    });
  });

  it("tolerates trailing slashes on tree urls", () => {
    expect(
      parseGitHubRepoUrl("https://github.com/facebook/react/tree/main/src/"),
    ).toEqual({
      username: "facebook",
      repo: "react",
      ref: "main",
      subdir: "src",
    });
  });
});
