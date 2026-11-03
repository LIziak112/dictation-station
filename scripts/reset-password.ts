import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Auth } from "../apps/server/src/auth";
import { Store } from "../apps/server/src/store";
import { credentialsSchema } from "../packages/contract/src/index";

if (existsSync(resolve(".env"))) process.loadEnvFile(resolve(".env"));
// 密码通过环境变量传入，避免出现在命令行参数里。
const input = credentialsSchema.parse({
  username: process.argv[2],
  password: process.env.RESET_PASSWORD,
});
const store = new Store(resolve(process.env.DATA_DIR ?? "data"));
try {
  if (!(await new Auth(store).resetPassword(input.username, input.password))) {
    console.error("账号不存在");
    process.exitCode = 1;
  } else console.log("密码已重设，该账号所有会话已退出");
} finally {
  store.close();
}
