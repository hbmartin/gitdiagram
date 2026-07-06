import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPublicLocation,
  isDefaultVariant,
  normalizeRepoVariant,
} from "~/server/storage/cache-key";

describe("normalizeRepoVariant", () => {
  it("treats empty values as the default variant", () => {
    expect(normalizeRepoVariant(undefined)).toEqual({
      ref: null,
      subdir: null,
    });
    expect(normalizeRepoVariant({ ref: "  ", subdir: "" })).toEqual({
      ref: null,
      subdir: null,
    });
  });

  it("strips slashes around subdirs", () => {
    expect(normalizeRepoVariant({ subdir: "/packages/next/" })).toEqual({
      ref: null,
      subdir: "packages/next",
    });
  });
});

describe("isDefaultVariant", () => {
  it("is true only when both ref and subdir are empty", () => {
    expect(isDefaultVariant(undefined)).toBe(true);
    expect(isDefaultVariant({ ref: null, subdir: null })).toBe(true);
    expect(isDefaultVariant({ ref: "main" })).toBe(false);
    expect(isDefaultVariant({ subdir: "src" })).toBe(false);
  });
});

describe("getPublicLocation", () => {
  beforeEach(() => {
    vi.stubEnv("R2_PUBLIC_BUCKET", "public-bucket");
  });

  it("keeps the legacy keys for the default variant", () => {
    const location = getPublicLocation("Acme", "Demo");
    expect(location.artifactKey).toBe("public/v1/acme/demo.json");
    expect(location.statusKey).toBe("status:v1:public:acme:demo");
  });

  it("uses variant keys when a ref or subdir is set", () => {
    const location = getPublicLocation("acme", "demo", {
      ref: "Feature/X",
      subdir: "packages/next",
    });
    expect(location.artifactKey).toBe(
      "public/v1/acme/demo/variants/Feature%2FX/packages%2Fnext.json",
    );
    expect(location.statusKey).toBe(
      "status:v1:public:acme:demo:Feature%2FX:packages%2Fnext",
    );
  });

  it("uses placeholder segments for missing parts of a variant", () => {
    const refOnly = getPublicLocation("acme", "demo", { ref: "main" });
    expect(refOnly.artifactKey).toBe(
      "public/v1/acme/demo/variants/main/@root.json",
    );

    const subdirOnly = getPublicLocation("acme", "demo", { subdir: "src" });
    expect(subdirOnly.artifactKey).toBe(
      "public/v1/acme/demo/variants/@default/src.json",
    );
  });
});
