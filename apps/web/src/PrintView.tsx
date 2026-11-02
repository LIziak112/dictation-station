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
              <option value="review" disabled={!attempt}>
                待巩固练习纸
              </option>
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
          浏览器打印窗口可另存 PDF。答案页默认关闭；句子会预留更多书写空间。
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
        <header>
          <p>OwnClass · 听写小站</p>
          <h1>{task.title}</h1>
          <p>
            {task.date}　姓名：________________　{rows.length} 项
          </p>
        </header>
        <ol className="worksheet">
          {rows.map((row) => (
            <li key={row.number} value={row.number}>
              <span>{row.prompt}</span>
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
        {!rows.length && <p>本次没有需要打印的待巩固项。</p>}
        {answers && (
          <section className="print-answers" data-testid="print-answers">
            <h2>答案页 · 请与练习纸分开</h2>
            {rows.map((row) => (
              <p key={row.number}>
                {row.number}. {task.items[row.number - 1].entry[MODES[task.mode].answer]}
              </p>
            ))}
          </section>
        )}
      </article>
    </section>
  );
}
