export const SCHEMA_VERSION = "1.0.0";
export const DEFAULT_PUBLIC_BASE_PATH = "/v1";

export const CACHE_CONTROL = {
  protocol: "public, s-maxage=3600, stale-while-revalidate=86400",
  manifest: "public, s-maxage=300, stale-while-revalidate=3600",
  index: "public, s-maxage=300, stale-while-revalidate=3600",
  schema: "public, max-age=86400, immutable",
};
