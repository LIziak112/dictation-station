export function parseSiteUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("网站入口必须为不含凭据、查询参数或哈希的 HTTP(S) 地址");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}
