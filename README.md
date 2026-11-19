# 北魏洛阳城漫游

本工程是第一人称与第三人称漫游应用的 TypeScript 源码。街区、人物骨骼和纹理随工程保存在 `public/洛阳漫游资源/`。运行时按视距加载街区，解压由 Web Worker 完成。

## 开发

在本目录使用 Node.js 24 和 pnpm。锁文件对应 pnpm 11.1.0。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

默认从 5173 开始，遇到占用就尝试下一个端口。请打开终端打印的开发地址。设置 `PORT` 环境变量可指定固定端口。修改 TypeScript 后会自动重新构建，刷新页面即可查看。

## 验证与发布

```sh
pnpm typecheck
pnpm test
pnpm build
```

构建完成后双击 `dist/index.html` 即可离线漫游。移动版本时将整个 `dist` 目录一并复制。

## 碰撞数据

物体的静态碰撞数据随街区加载。角色依据水平碰撞半径、脚底高度和头顶高度判断通行。陶瓮、筐与马身使用近似椭圆体积，围栏、家具和低檐使用有方向及高度范围的碰撞盒。低檐按坡面分段，桥面和阶梯提供行走高度。

行人使用独立的动态碰撞索引，位置与动作模拟同步。草叶、衣料、贴花及路面细纹作为可穿过的装饰处理。水域与可通行桥面分别记录。

```sh
pnpm audit:collision
pnpm audit:collision --write
```

第一条命令生成 `reports/collisions.json`。第二条同时更新街区的补充碰撞记录。已有基础记录保存在 `c`，补充记录保存在 `extra`，可重复生成。审计规则针对当前随附的几何资产编号，替换模型库后需核对规则。

`src/main.ts` 管理渲染、街区流送、人物和输入。`src/types.ts` 定义资源与运行时类型。`src/physics/collision.ts` 管理静态通行与动态角色碰撞。`tools/build.ts` 生成离线入口和内嵌 Worker。`tests/scene.test.ts` 在实际资源包中检查宫门、南渠桥、台阶、院落物件和园池。
