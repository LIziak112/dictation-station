export function RepeatInterval({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      同一词重复朗读间隔（秒）
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: 21 }, (_, i) => i / 2).map((seconds) => (
          <option key={seconds} value={seconds}>
            {seconds} 秒
          </option>
        ))}
      </select>
    </label>
  );
}
