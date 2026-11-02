# 听写词表规范 v1

契约来源为 `packages/contract/src/index.ts`，交换格式 JSON Schema 通过 `pnpm schema:export` 生成到 `schema/wordlist.schema.json`。Schema 描述输入形状，跨字段模式要求、唯一 ID 等语义由 Zod 运行时补充校验。

```json
{
  "version": 1,
  "title": "Unit 3 单词听写",
  "subject": "english",
  "grade": "小学三年级",
  "textbook": "自建词表",
  "unit": "Unit 3",
  "entries": [
    {
      "id": "e1",
      "en": "apple",
      "zh": "苹果",
      "pinyin": "",
      "hint": "",
      "alt": [],
      "modes": ["zh2en", "en2en", "en2zh"]
    }
  ]
}
```

缺省 version 为 1；显式未知版本拒绝。导入接受 JSON 对象、数组、json 代码围栏和普通逐行文本；兼容旧 words/list 数组别名，导出统一使用 entries。缺失 ID 按位置生成，已提供的稳定 ID 保留；重复 ID 拒绝，不静默删词或截断超限输入。

一份词表 1–500 词；标题最多 80 字符；en/zh/pinyin 最多 300；hint 最多 500；alt 最多 30 项。英文和中文不能同时为空。subject 为 english/chinese/mixed，只用于描述，不阻止混排。

| 模式         | 提示       | 写什么 | 语音 |
| ------------ | ---------- | ------ | ---- |
| zh2en        | 中文       | 英文   | 中文 |
| en2en        | 无文字答案 | 英文   | 英文 |
| en2zh        | 英文       | 中文   | 英文 |
| zh_dictation | 无文字答案 | 汉字   | 中文 |
| pinyin2hanzi | 拼音       | 汉字   | 无   |

缺省模式按字段推导：中英都有时前三种；只有英文时 en2en；只有中文时 zh_dictation，有拼音再加 pinyin2hanzi。显式 modes 至少一项，每种模式必须具有其提示、答案和语音需要的字段。

重复词条提醒，不自动合并：bank 银行与 bank 河岸可作为不同义项保留。多音字、缺拼音和小型词级读音表辅助人工校对，不声称完整词典覆盖；拼音不控制实际语音，必须试听确认。OCR 错字不静默修正。

API 批次额外包含 id/revision/createdAt/updatedAt；更新和删除必须带当前 revision，冲突返回 409。导出不含运行时字段、OCR 原文、口令、源图或本机记录。

词表接口需登录且只返回本账号的练习词表和参考答案，适用于自主练习，不构成 OwnClass 受限学生接口。对错由本人核对，没有自动匹配或在线判分。

## 内容类型与稳定身份

新增可选 kind（character／word／phrase／sentence，默认 word）、reading（指定读音标识，默认空）。服务端保存时产生账号内稳定 wordId；导入提供的 wordId 不决定所属关系或复用身份。内容、词义、拼音、语境和读音选择共同决定复用，同形异义不合并。任务按发布快照保存，不跟随词表后来编辑。

可选 readings 对象分别设置 en／zh 的读音 ID（默认空）；比通用 reading 更具体，按该练法实际朗读语言选择。中文 pinyin 可帮助定位词典完整词语录音，但不控制设备／服务端合成语音。真人未匹配时须按页面提示试听。任务支持英音／美音选项，明确选择的具体录音优先。
