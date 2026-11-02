// 核对仅更新本轮词条，其他词条的错词标记继续保留。
export function mergeReview(
  previous: string[],
  current: string[],
  results: Record<string, boolean>,
) {
  const scope = new Set(current);
  return [
    ...new Set([
      ...previous.filter((id) => !scope.has(id)),
      ...Object.keys(results).filter((id) => results[id] === false),
    ]),
  ];
}
