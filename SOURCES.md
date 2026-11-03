# 音频与词表来源

## 已接入

真人录音使用 Wikimedia Commons 的逐文件许可与原始音频，英文目录通过 [Free Dictionary API](https://dictionaryapi.dev/) 查询；中文按已确认带调拼音定位同一 Commons 录音库，并检查来源描述包含所需汉字及 Chinese pronunciation 分类。它是社区词典录音，不冒充商业词书或教材官方配音。

每项保存标题、作者、出处页面、许可名称／链接，页面展示署名；原始文件按许可缓存，不修改文件，播放时可调速。接受 CC BY、CC BY-SA、CC0／公有领域标识；来源缺失、许可不匹配、读音未命中或网络失败则明确合成兜底。不把项目代码许可当成录音许可。

| 实测示例       | 作者                               | 录音与许可来源                                                                                                                           |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| school（英音） | Association Shtooka, Judith Franck | [Commons 原页](https://commons.wikimedia.org/w/index.php?curid=9027379)，[CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/) |
| 太阳（普通话） | Wei Gao, Vion Nicolas              | [Commons 原页](https://commons.wikimedia.org/w/index.php?curid=3053385)，[CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/) |

[Creative Commons 署名许可](https://creativecommons.org/licenses/by/3.0/us/) 要求适当署名、提供许可链接，并在修改时说明。应用提供原页面和原音频出口，不限制许可允许的再使用。音频不随本仓库提交；真实验证缓存存放独立临时目录。

## 可选部署者词书

本地目录索引格式见 DEPLOY.md；必须由部署者提供有权使用的音频，填写真实来源、作者与使用条件。按完整词／短语／句子匹配，不拼接中文单字。

## 未接入候选

- [Merriam-Webster](https://www.dictionaryapi.com/)：有音频 API，免费条件包括非商业、每日每 Key 1000 次、最多两类参考 API；本项目未配置 Key，不依赖该服务。
- [Forvo](https://api.forvo.com/documentation/general-information/)：公开 API 文档限制音频链接有效期与缓存，不作为整卷预下载来源。
