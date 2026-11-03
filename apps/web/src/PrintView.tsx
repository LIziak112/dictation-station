import { useState } from "react";
import { type Attempt, MODES, type Task } from "../../../packages/contract/src/index";
import { type PrintTemplate, worksheetRows } from "../../../packages/core/src/outputs";

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
  const rows = worksheetRows(task, attempt, template);
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
              onChange={(e) => setTemplate(e.target.value as PrintTemplate)}
            >
              <option value="blank">听写空白纸</option>
              <option value="pinyin">看拼音写词语纸</option>
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
        </div>
        <p className="small muted">
          已按标准 A4 紧凑多栏排版设计，节省纸张空间；浏览器打印窗口可直接打印或另存为 PDF。
        </p>
        <div className="row">
          <button className="primary" type="button" onClick={() => window.print()}>
            打印 / 另存 PDF
          </button>
          <button type="button" onClick={onClose}>
            关闭打印预览
          </button>
        </div>
      </div>
      <article className="print-sheet">
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
            日期：{task.date}　姓名：____________　得分：______ / {rows.length}
          </p>
        </header>
        <ol className="worksheet">
          {rows.map((row) => (
            <li
              key={row.number}
              value={row.number}
              className={row.lines === 3 ? "worksheet-item sentence-item" : "worksheet-item"}
            >
              <div className="worksheet-prompt">
                <span className="worksheet-num">{row.number}.</span>
                <span>{row.prompt}</span>
              </div>
              <div className="writing-line" />
              {row.lines === 3 && (
                <>
                  <div className="writing-line" />
                  <div className="writing-line" />
                </>
              )}
            </li>
          ))}
        </ol>
        {!rows.length && <p>暂无可打印的待巩固项。请先完成批改，或选择听写空白纸。</p>}
        {answers && (
          <section className="print-answers" data-testid="print-answers">
            <h2>答案对照页</h2>
            <div className="print-answers-grid">
              {rows.map((row) => (
                <p key={row.number}>
                  <strong>{row.number}.</strong>{" "}
                  {task.items[row.number - 1].entry[MODES[task.mode].answer]}
                </p>
              ))}
            </div>
          </section>
        )}
      </article>
    </section>
  );
}
