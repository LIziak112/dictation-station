import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { type Attempt, MODES, type Task } from "../../../packages/contract/src/index";
import { type PrintTemplate, worksheetRows } from "../../../packages/core/src/outputs";

type Grid = "tian" | "mi" | "english" | "line";

function WritingGrid({ grid }: { grid: Grid }) {
  if (grid === "line") return <div className="writing-line" />;
  if (grid === "english")
    return (
      <svg
        className="writing-english"
        viewBox="0 0 160 24"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {[1, 8, 16, 23].map((y) => (
          <line key={y} x1="0" x2="160" y1={y} y2={y} stroke="#555" strokeWidth="0.7" />
        ))}
      </svg>
    );
  return (
    <div className="writing-squares" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 100 100" aria-hidden="true">
          <rect x="1" y="1" width="98" height="98" fill="none" stroke="#555" strokeWidth="2" />
          <path
            d="M 50 1 V 99 M 1 50 H 99"
            fill="none"
            stroke="#888"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          {grid === "mi" && (
            <path
              d="M 1 1 L 99 99 M 99 1 L 1 99"
              fill="none"
              stroke="#888"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}
        </svg>
      ))}
    </div>
  );
}

export function PrintView({
  task,
  attempt,
  onClose,
}: {
  task: Task;
  attempt?: Attempt;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState<PrintTemplate>("blank");
  const [answers, setAnswers] = useState(false);
  const [grid, setGrid] = useState<Grid>(MODES[task.mode].answer === "zh" ? "tian" : "english");
  const [qr, setQr] = useState("");
  const [qrError, setQrError] = useState(false);
  useEffect(() => {
    let active = true;
    const url = new URL(location.href);
    url.search = "";
    url.hash = `check=${encodeURIComponent(task.id)}`;
    QRCode.toDataURL(url.href, { width: 180, margin: 2 })
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => {
        if (active) setQrError(true);
      });
    return () => {
      active = false;
    };
  }, [task.id]);
  const rows = worksheetRows(task, attempt, template);
  // Three items share a row; reserve enough vertical space for its tallest item.
  const fragments = rows.flatMap((row) => {
    const answer = task.items[row.number - 1].entry[MODES[task.mode].answer] || "";
    const lineCount = grid === "tian" || grid === "mi"
      ? Math.max(row.lines, Math.ceil(Array.from(answer.replace(/\s/g, "")).length / 4))
      : row.lines;
    return Array.from({ length: Math.ceil(lineCount / 8) }, (_, index) => ({
      ...row,
      continuation: index > 0,
      gridLines: Math.min(8, lineCount - index * 8),
    }));
  });
  const pages: (typeof fragments)[] = [[]];
  let used = 0;
  for (let i = 0; i < fragments.length; i += 3) {
    const group = fragments.slice(i, i + 3);
    const height = 15 + 15 * Math.max(...group.map((row) => row.gridLines));
    if (used + height > 190 && pages[pages.length - 1].length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(...group);
    used += height;
  }
  return (
    <section className="print-view panel">
      <div className="print-controls">
        <h2>打印练习纸</h2>
        <div className="form-grid">
          <label className="field">
            纸张内容
            <select
              aria-label="纸张内容"
              value={template}
              onChange={(e) => {
                const next = e.target.value as PrintTemplate;
                setTemplate(next);
                if (next === "pinyin") setGrid("tian");
              }}
            >
              <option value="blank">听写空白纸</option>
              {task.items.some((item) => item.entry.pinyin) && (
                <option value="pinyin">看拼音写词语纸</option>
              )}
              <option value="review">待巩固练习纸</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={answers}
              onChange={(e) => setAnswers(e.target.checked)}
            />
            另附答案页
          </label>
          <label className="field">
            书写格线
            <select value={grid} onChange={(e) => setGrid(e.target.value as Grid)}>
              <option value="tian">田字格</option>
              <option value="mi">米字格</option>
              <option value="english">英语四线三格</option>
              <option value="line">横线</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          A4 共 {pages.length} 页，内容自动分页。打印时请选择实际大小（100%）。
        </p>
        {qrError && <p role="alert">二维码生成失败，请刷新后重试。</p>}
        <p className="small muted">扫码核对需登录家长账号，并使用手机可访问的网站地址。</p>
        <div className="row">
          <button className="primary" type="button" disabled={!qr} onClick={() => window.print()}>
            打印 / 另存 PDF
          </button>
          <button type="button" onClick={onClose}>
            关闭打印预览
          </button>
        </div>
      </div>
      {pages.map((page, pageIndex) => (
        <article className="print-sheet" key={pageIndex}>
          <header className="print-header">
            <div className="print-title-group">
              <h1>{task.title}</h1>
              <span className="print-subtitle">
                OwnClass 听写小站 · {MODES[task.mode].label} ·{" "}
                {template === "blank"
                  ? "听写空白纸"
                  : template === "pinyin"
                    ? "看拼音写词语纸"
                    : "待巩固练习纸"}
              </span>
            </div>
            <p className="print-meta">
              {pageIndex === 0 && <>日期：{task.date}　姓名：____________　得分：______ / {rows.length}　</>}第{" "}
              {pageIndex + 1} / {pages.length} 页
            </p>
            {qr && (
              <div className="print-qr">
                <img src={qr} alt="扫码打开任务核对" />
                <span>扫码核对</span>
              </div>
            )}
          </header>
          <ol className="worksheet">
            {page.map((row, index) => (
              <li
                key={`${row.number}-${index}`}
                value={row.number}
                className={row.lines === 3 ? "worksheet-item sentence-item" : "worksheet-item"}
              >
                <div className="worksheet-prompt">
                  <span className="worksheet-num">{row.number}.</span>
                  <span>{row.continuation ? "（续）" : row.prompt}</span>
                </div>
                {Array.from({ length: row.gridLines }, (_, i) => (
                  <WritingGrid key={i} grid={grid} />
                ))}
              </li>
            ))}
          </ol>
          {!rows.length && <p>暂无可打印的待巩固项。请先完成批改，或选择听写空白纸。</p>}
        </article>
      ))}
      {answers &&
        pages.map((page, pageIndex) => (
          <article
            className="print-sheet answer-sheet"
            key={`answers-${pageIndex}`}
          >
            <section className="print-answers" data-testid="print-answers">
              <h2>
                答案对照页 · 第 {pageIndex + 1} / {pages.length} 页
              </h2>
              <div className="print-answers-grid">
                {page.filter((row) => !row.continuation).map((row) => (
                  <p key={row.number}>
                    <strong>{row.number}.</strong>{" "}
                    {task.items[row.number - 1].entry[MODES[task.mode].answer]}
                  </p>
                ))}
              </div>
            </section>
          </article>
        ))}
    </section>
  );
}
