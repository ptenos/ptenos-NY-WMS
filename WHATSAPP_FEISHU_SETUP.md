# 飞书优先接入小白清单

这份清单用于先把飞书消息接入仓库AI秘书系统。普通 WhatsApp 暂时不做自动读取，先用手动复制方式。

## 最终效果

```text
飞书群
  -> n8n Webhook
  -> 统一消息格式
  -> OpenAI 分析
  -> 重要消息提醒
  -> 自动任务表
  -> 每日仓库总日报
```

## 一、先准备 n8n

你需要一个公网可访问的 n8n 地址，例如：

```text
https://你的域名/webhook/warehouse-whatsapp
https://你的域名/webhook/warehouse-feishu
```

如果 n8n 只在自己电脑本地运行，WhatsApp 和飞书通常无法直接推送消息进来。

## 二、飞书接入

需要准备：

- 飞书企业账号
- 飞书开放平台企业自建应用
- App ID
- App Secret
- Verification Token
- 机器人能力
- 消息事件订阅

推荐流程：

1. 登录飞书开放平台。
2. 创建企业自建应用。
3. 开启机器人能力。
4. 把机器人添加到仓库、PMC、QC 等目标群。
5. 在权限管理里申请消息权限。
6. 在事件订阅里选择“接收消息 v2.0”。
7. 请求地址填写：

```text
https://你的域名/webhook/warehouse-feishu
```

8. 飞书验证 URL 时会发送 `challenge`，n8n 需要原样返回。
9. 在 n8n 里把飞书消息整理成：

```json
{
  "source": "飞书",
  "group": "PMC群",
  "sender": "发送人",
  "message": "原始消息内容",
  "time": "消息时间"
}
```

## 三、普通 WhatsApp 怎么办

你现在是普通 WhatsApp，建议先不要做自动后台读取。

第一阶段做法：

1. WhatsApp 群里看到重要消息。
2. 复制消息。
3. 粘贴到系统的“消息分析”页面。
4. 来源选择 `WhatsApp`。
5. 系统会把它和飞书消息一起进入日报。

以后如果要自动化，需要申请 WhatsApp Business Platform / Cloud API。

## 四、OpenAI 分析提示词

把统一后的消息交给 OpenAI，并要求只返回 JSON：

```text
你是仓库AI秘书。请分析下面消息，判断是否重要。

重点识别：
缺料、WO异常、来料延迟、客户催货、库存差异、QC HOLD、叉车故障、BPOM、容器到货、加班、紧急放货。

只返回 JSON：
{
  "important": true,
  "priority": "urgent/high/normal",
  "category": "分类",
  "summary_zh": "中文摘要",
  "translation_zh": "中文翻译",
  "suggested_action": "建议动作",
  "owner": "建议负责人",
  "deadline": "截止时间"
}
```

## 五、小白建议

第一周不要一上来全自动发给很多人。

建议先这样：

1. 只接入一个飞书测试群。
2. 重要消息先只推送给你本人。
3. 看 3 天分类是否准确。
4. 再扩大到仓库管理群、PMC群、QC群、出货群。
5. WhatsApp 先手动复制，后续再升级官方 API。

## 官方参考

- Meta WhatsApp Cloud API 发送消息：https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/
- Meta WhatsApp Messages API：https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/
- 飞书接收消息事件：https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
- 飞书事件订阅概述：https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
