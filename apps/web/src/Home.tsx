import { BookOpen, Headphones, Plus, Search } from "lucide-react";
import type { BatchSummary, Draft } from "../../../packages/contract/src/index";
import { download } from "./api";
import { blankDraft } from "./Editor";

interface Props {
  list: BatchSummary[];
  filtered: BatchSummary[];
  query: string;
  setQuery: (s: string) => void;
  draft: { value: Draft | null; write: (d: Draft) => boolean };
  edit: () => void;
  open: (id: string) => void;
  onResume: () => void;
}
export function Home({ list, filtered, query, setQuery, draft, edit, open, onResume }: Props) {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">一份词表，多种练法</p>
          <h1>
            准备一份词表，
            <br />
            派发到孩子听写区。
          </h1>
          <p>
            家长在手机或电脑整理词表、确认读音；
            <br className="mobile-break" />
            孩子在平板独立听写，写完交卷由家长核对。
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
            <span className="paper-note">派发 → 听写 → 核对</span>
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
                  查看与听写 →
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel empty">
          <h3>{query ? "没有找到这份词表" : "从第一份词表开始"}</h3>
          <p>{query ? "换个关键词试试。" : "粘贴几行词语，或导入作业照片。"}</p>
          {query && (
            <button type="button" onClick={() => setQuery("")}>
              清除搜索
            </button>
          )}
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
