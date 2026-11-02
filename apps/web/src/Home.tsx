import { BookOpen, Headphones, Plus, Search } from "lucide-react";
import type { BatchSummary, Draft, Progress } from "../../../packages/contract/src/index";
import { MODES } from "../../../packages/contract/src/index";
import { download } from "./api";
import { blankDraft } from "./Editor";

interface Props {
  list: BatchSummary[];
  filtered: BatchSummary[];
  query: string;
  setQuery: (s: string) => void;
  draft: { value: Draft | null; write: (d: Draft) => boolean };
  progress: { value: Progress | null };
  edit: () => void;
  open: (id: string) => void;
  onResume: () => void;
}
export function Home({
  list,
  filtered,
  query,
  setQuery,
  draft,
  progress,
  edit,
  open,
  onResume,
}: Props) {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">一份词表，多种练法</p>
          <h1>
            今天的听写，
            <br />
            自己也能完成。
          </h1>
          <p>
            网页来报词，孩子用纸笔写。
            <br className="mobile-break" />
            核对答案，再把错词练一遍。
          </p>
          <button type="button" className="primary" onClick={() => edit()}>
            <Plus size={18} aria-hidden="true" />
            新建听写
          </button>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="word-paper">
            <span>今天练一点</span>
            <strong>apple</strong>
            <span>苹果 · 苹 果</span>
            <div className="paper-lines" />
            <span className="paper-note">听见 → 写下 → 记住</span>
          </div>
          <div className="audio-badge">
            <Headphones size={24} />
            <span>慢慢听，认真写</span>
          </div>
        </div>
      </section>
      {draft.value && (
        <section className="resume-banner">
          <div>
            <strong>还有一份词表草稿</strong>
            <p>
              {draft.value.title || "未命名听写"} · {draft.value.entries.length} 词
            </p>
          </div>
          <div className="row">
            <button type="button" onClick={() => onResume()}>
              恢复草稿
            </button>
            <button type="button" onClick={() => download("听写草稿.json", draft.value)}>
              导出备份
            </button>
          </div>
        </section>
      )}
      {progress.value && (
        <section className="resume-banner">
          <div>
            <strong>上次的听写进度已保留</strong>
            <p>
              第 {progress.value.index + 1} 词 · {MODES[progress.value.mode].label}
            </p>
          </div>
          <button type="button" onClick={() => open(progress.value?.batchId ?? "")}>
            查看上次词表
          </button>
        </section>
      )}
      <div className="library-heading">
        <div>
          <p className="eyebrow">我的词表</p>
          <h2>
            挑一份，开始练习 <span className="count">{list.length}</span>
          </h2>
        </div>
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索词表"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、年级、单元"
          />
        </label>
      </div>
      {filtered.length ? (
        <div className="batch-grid">
          {filtered.map((b) => (
            <article className="batch-card" key={b.id}>
              <span className="batch-icon">
                <BookOpen size={22} aria-hidden="true" />
              </span>
              <button type="button" className="batch-title subtle" onClick={() => open(b.id)}>
                <h3>{b.title}</h3>
              </button>
              <p>{[b.grade, b.unit].filter(Boolean).join(" · ") || "自己的学习节奏"}</p>
              <div className="row between">
                <span className="small muted">
                  {b.count} 词 ·{" "}
                  {new Date(b.updatedAt).toLocaleDateString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                </span>
                <button type="button" onClick={() => open(b.id)}>
                  去听写 →
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel empty">
          <h3>{query ? "没有找到这份词表" : "从第一份词表开始"}</h3>
          <p>{query ? "换个关键词试试。" : "粘贴几行词语，或导入作业照片。"}</p>
          {!query && (
            <button
              type="button"
              onClick={() => {
                const sample = blankDraft();
                sample.title = "来试试：日常英语";
                sample.input = "sun  太阳\nmoon  月亮\napple  苹果";
                if (draft.value && !confirm("要用示例替换现有草稿吗？")) return;
                if (draft.write(sample)) onResume();
              }}
            >
              用示例体验
            </button>
          )}
        </section>
      )}
    </>
  );
}
