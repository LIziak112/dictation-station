import { useEffect, useRef, useState } from "react";
import type { Attempt, Task } from "../../../packages/contract/src/index";
import { cardCounts } from "../../../packages/core/src/outputs";

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  lines: number,
) {
  const characters = Array.from(text);
  let line = "",
    row = 0;
  for (let index = 0; index < characters.length; index++) {
    const next = line + characters[index];
    if (context.measureText(next).width > width && line) {
      if (row + 1 >= lines) {
        context.fillText(`${line.slice(0, -1)}…`, x, y + row * lineHeight);
        return;
      }
      context.fillText(line, x, y + row * lineHeight);
      row++;
      line = characters[index];
    } else line = next;
  }
  context.fillText(line, x, y + row * lineHeight);
}
export function ReportCard({ task, attempt }: { task: Task; attempt: Attempt }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [photo, setPhoto] = useState<File>();
  const [image, setImage] = useState<HTMLImageElement>();
  const [message, setMessage] = useState("");
  const counts = cardCounts(task, attempt);
  useEffect(() => {
    setImage(undefined);
    if (!photo) return;
    const url = URL.createObjectURL(photo),
      source = new Image();
    let active = true;
    source.onload = () => {
      if (active) {
        setImage(source);
        setMessage("");
      }
    };
    source.onerror = () => {
      if (active) setMessage("照片无法读取，请重新选择 PNG、JPEG 或 WebP");
    };
    source.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [photo]);
  useEffect(() => {
    const element = canvas.current,
      context = element?.getContext("2d");
    if (!element || !context) return;
    const summary = cardCounts(task, attempt);
    element.width = 1080;
    element.height = image ? 1440 : 960;
    context.fillStyle = "#f8f7f3";
    context.fillRect(0, 0, element.width, element.height);
    context.fillStyle = "#28634e";
    context.font = '600 32px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText("OwnClass · 听写小站", 72, 88);
    context.fillStyle = "#282f2b";
    context.font = '700 52px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    fitText(context, task.title, 72, 176, 936, 68, 2);
    context.fillStyle = "#606b63";
    context.font = '30px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(
      `${task.date} · ${summary.unchecked ? "听写已记录，仍有待核对项" : "本次核对已完成"}`,
      72,
      324,
    );
    context.fillStyle = "#ffffff";
    context.fillRect(72, 374, 936, 260);
    const columns = [
      [summary.total, "本次范围"],
      [summary.correct, "已通过"],
      [summary.pending, "需复习"],
    ] as const;
    columns.forEach(([value, label], index) => {
      const x = 110 + index * 308;
      context.fillStyle = "#28634e";
      context.font = '700 76px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      context.fillText(String(value), x, 480);
      context.fillStyle = "#606b63";
      context.font = '30px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      context.fillText(`${label}（项）`, x, 555, 260);
    });
    context.fillStyle = "#606b63";
    context.font = '30px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(`已订正 ${summary.corrected} 项 · 未核对 ${summary.unchecked} 项`, 72, 700);
    if (image) {
      const scale = Math.min(936 / image.naturalWidth, 560 / image.naturalHeight),
        width = image.naturalWidth * scale,
        height = image.naturalHeight * scale;
      context.drawImage(image, 72 + (936 - width) / 2, 758, width, height);
    } else {
      context.strokeStyle = "#d8ddd5";
      context.strokeRect(72, 754, 936, 88);
      context.fillText("可添加本次书写纸照片", 118, 812);
    }
    context.fillStyle = "#606b63";
    context.font = '24px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.textAlign = "center";
    context.fillText(
      "结果由本人核对记录 · Your data. Your way. All for learning.",
      element.width / 2,
      element.height - 76,
      936,
    );
    context.fillText(
      new URL(".", window.location.href).href,
      element.width / 2,
      element.height - 36,
      936,
    );
  }, [task, attempt, image]);
  async function file() {
    const element = canvas.current;
    if (!element) throw new Error("汇报卡尚未准备好");
    const blob = await new Promise<Blob>((resolve, reject) =>
      element.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("汇报卡生成失败"))),
        "image/png",
      ),
    );
    return new File([blob], `听写汇报-${task.date}.png`, { type: "image/png" });
  }
  return (
    <section className="panel report-card">
      <h2>本次打卡汇报卡</h2>
      <p>
        {counts.total} 项 · 已通过 {counts.correct} 项 · 需复习 {counts.pending} 项 · 未核对{" "}
        {counts.unchecked} 项
      </p>
      <canvas ref={canvas} role="img" aria-label="听写打卡汇报卡预览" />
      <label className="field">
        添加书写纸照片（仅本机）
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setPhoto(e.target.files?.[0])}
        />
      </label>
      <p className="small muted">
        照片只用于这张卡片，不上传；刷新后需重新选择。保存图片后可手动转发到老师群。
      </p>
      {message && <p role="status">{message}</p>}
      <div className="row">
        <button
          className="primary"
          type="button"
          onClick={async () => {
            try {
              const imageFile = await file(),
                url = URL.createObjectURL(imageFile),
                link = document.createElement("a");
              link.href = url;
              link.download = imageFile.name;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "保存失败");
            }
          }}
        >
          保存汇报卡 PNG
        </button>
        {typeof navigator.share === "function" && (
          <button
            type="button"
            onClick={async () => {
              try {
                const imageFile = await file();
                if (!navigator.canShare?.({ files: [imageFile] })) {
                  setMessage("此设备请先保存图片，再手动转发");
                  return;
                }
                await navigator.share({ files: [imageFile], title: "听写记录" });
              } catch (e) {
                if (!(e instanceof DOMException && e.name === "AbortError"))
                  setMessage("分享失败，请先保存图片再转发");
              }
            }}
          >
            系统分享
          </button>
        )}
      </div>
    </section>
  );
}
